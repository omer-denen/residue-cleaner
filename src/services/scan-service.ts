import { runScan } from '../commands/scan.ts';
import {
  loadScanCache,
  loadScanDirtyAt,
  markScanDirty,
  saveScanCache,
  SCAN_CACHE_TTL_MS,
} from '../store/scan-cache.ts';
import {
  MAX_CACHE_HOURS,
  MIN_CACHE_HOURS,
  loadSettings,
  saveSettings,
} from '../store/settings.ts';
import { debug, info } from '../util/log.ts';
import { primaryPath, scanItemId } from '../core/scan-items.ts';
import { diskUsage } from '../core/disk-usage.ts';
import { ServiceError, describeError } from './errors.ts';
import { newId } from './ids.ts';
import type { Cluster, Env, ScanResult } from '../core/types.ts';
import type {
  ScanStatusFacts,
  ScanStatusResponse,
  ScanStreamEvent,
  SettingsResponse,
} from '../core/contract.ts';
import { scanStatusView } from '../core/scan-status-view.ts';

/**
 * Disk tarama servisi.
 *
 * Durum (is listesi, aktif tarama, 24 saatlik onbellek) burada tutulur.
 * HTTP/SSE bilgisi YOKTUR: olaylar `emit` kancasiyla disari verilir;
 * server bunlari SSE istemcilerine yazar.
 */

export interface ScanJob {
  id: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  /** Duraklatildi mi? Is bitene kadar paused=true kalabilir. */
  paused: boolean;
  progress: { done: number; total: number; bytes: number };
  /** Taranacak alanlarin tam listesi (sol sutun). */
  targets: string[];
  /** Simdiye kadar siniflandirilan kumeler: gec baglanan istemciye replay. */
  found: Cluster[];
  /** SSE yeniden baglanma: olay kimligi + son N olay (Last-Event-ID). */
  events: Array<{ id: number; event: ScanStreamEvent }>;
  nextEventId: number;
  result?: ScanResult;
  error?: string;
  startedAt: number;
}

export type ScanEmit = (jobId: string, event: ScanStreamEvent, id?: number) => void;

export interface ScanArgs {
  envs: Env[];
  profile?: string;
  exclude: string[];
  minAgeDays: number;
  root?: string;
  roots?: string[];
}

export class ScanService {
  private readonly scans = new Map<string, ScanJob>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly pauseWaiters = new Map<string, Set<() => void>>();
  private active: ScanJob | null = null;
  private lastScan: { scan: ScanResult; at: number } | null = null;
  private cacheLoaded = false;
  /** Ayni anda gelen istekler yuklemeyi BEKLER (yarim durum donmez). */
  private cacheLoad: Promise<void> | null = null;
  private ttlMs = SCAN_CACHE_TTL_MS;
  private dirtyAt = 0;
  private settingsLoaded = false;
  private settingsLoad: Promise<void> | null = null;
  private readonly emit: ScanEmit;
  private readonly persistScan: boolean;

  constructor(emit: ScanEmit, persistScan: boolean) {
    this.emit = emit;
    this.persistScan = persistScan;
  }

  /** Ayni anda tek tarama; suruyorsa 409. */
  start(args: ScanArgs): ScanJob {
    if (this.active) {
      throw new ServiceError(409, 'Tarama zaten suruyor');
    }
    const job: ScanJob = {
      id: newId(),
      status: 'running',
      paused: false,
      progress: { done: 0, total: 0, bytes: 0 },
      targets: [],
      found: [],
      events: [],
      nextEventId: 0,
      startedAt: Date.now(),
    };
    const controller = new AbortController();
    this.scans.set(job.id, job);
    this.controllers.set(job.id, controller);
    this.active = job;

    void this.runJob(job, controller, args);
    return job;
  }

  get(id: string): ScanJob | undefined {
    return this.scans.get(id);
  }

  activeJobId(): string | null {
    return this.active?.id ?? null;
  }

  last(): { scan: ScanResult; at: number } | null {
    return this.lastScan;
  }

  /**
   * Son tarama sonucunu disk onbelleginden BIR KEZ yukler.
   * 24 saatten eskiyse loadScanCache null doner.
   */
  async ensureCacheLoaded(): Promise<void> {
    if (this.lastScan) return;
    if (this.cacheLoaded) {
      // Yukleme basladi ama bitmedi: YARIM durum donme, bekle.
      if (this.cacheLoad) await this.cacheLoad;
      return;
    }
    this.cacheLoaded = true;
    // Suresi dolmus sonuc da yuklenir: kullaniciya "eski" olarak
    // gosterilebilir; yeniden tarama ENGELLENMEZ.
    this.cacheLoad = (async () => {
      const [cached, dirtyAt] = await Promise.all([
        loadScanCache(Date.now(), Number.POSITIVE_INFINITY),
        loadScanDirtyAt(),
      ]);
      this.dirtyAt = Math.max(this.dirtyAt, dirtyAt);
      if (cached) {
        this.lastScan = cached;
        info('tarama onbellegi yuklendi', {
          at: new Date(cached.at).toISOString(),
          kume: cached.scan.clusters.length,
        });
      } else {
        debug('tarama onbellegi yok');
      }
    })();
    try {
      await this.cacheLoad;
    } finally {
      this.cacheLoad = null;
    }
  }

  /** Ayarlari (onbellek suresi) bir kez yukler. */
  async ensureSettingsLoaded(): Promise<void> {
    if (this.settingsLoaded) {
      if (this.settingsLoad) await this.settingsLoad;
      return;
    }
    this.settingsLoaded = true;
    this.settingsLoad = (async () => {
      const s = await loadSettings();
      this.ttlMs = Math.max(MIN_CACHE_HOURS, s.scanCacheHours) * 3_600_000;
    })();
    try {
      await this.settingsLoad;
    } finally {
      this.settingsLoad = null;
    }
  }

  /** Tarama durumu: never / current / stale / scanning. */
  async status(): Promise<ScanStatusResponse> {
    await Promise.all([this.ensureCacheLoaded(), this.ensureSettingsLoaded()]);
    // CLI temizligi ayri surecte dirty.json yazar; her durum sorgusunda
    // diskteki isaret okunur (ucuz tek dosya).
    this.dirtyAt = Math.max(this.dirtyAt, await loadScanDirtyAt());
    const at = this.lastScan?.at ?? null;
    const ageMs = at !== null ? Math.max(0, Date.now() - at) : null;
    const dirty = at !== null && this.dirtyAt > at;
    const expired = ageMs !== null && ageMs > this.ttlMs;
    const state = this.active
      ? 'scanning'
      : at === null
        ? 'never'
        : dirty || expired
          ? 'stale'
          : 'current';
    const facts: ScanStatusFacts = {
      state,
      lastScanAt: at,
      ageMs,
      ttlMs: this.ttlMs,
      nextRecommendedAt: at !== null ? at + this.ttlMs : null,
      dirty,
      scanning: !!this.active,
      paused: this.active?.paused ?? false,
      clusters: this.lastScan?.scan.clusters.length ?? null,
      // Surucu dolulugu: salt okunur tek sistem cagrisi (P4 gostergesi).
      disk: diskUsage(),
    };
    // Ayristirma ve etiket karari MOTORDA: "stale" iki sebebi birlestirir.
    return { ...facts, view: scanStatusView(facts) };
  }

  async settings(): Promise<SettingsResponse> {
    await this.ensureSettingsLoaded();
    const s = await loadSettings();
    return {
      scanCacheHours: Math.round(this.ttlMs / 3_600_000),
      minCacheHours: MIN_CACHE_HOURS,
      maxCacheHours: MAX_CACHE_HOURS,
      vaultRetentionDays: s.vaultRetentionDays,
      updateCheck: s.updateCheck,
      scanOnLaunch: s.scanOnLaunch,
    };
  }

  async updateSettings(patch: {
    scanCacheHours?: number;
    vaultRetentionDays?: number;
    updateCheck?: 'off' | 'daily' | 'weekly';
    scanOnLaunch?: 'always' | 'daily' | 'manual';
  }): Promise<SettingsResponse> {
    const saved = await saveSettings(patch);
    this.ttlMs = saved.scanCacheHours * 3_600_000;
    this.settingsLoaded = true;
    info('ayarlar guncellendi', { ...saved });
    return this.settings();
  }

  /** Disk degisti (silme vb.): sonucu eski isaretle. */
  async markDirty(): Promise<void> {
    this.dirtyAt = Date.now();
    if (this.persistScan) await markScanDirty(this.dirtyAt);
  }

  cancel(id: string): void {
    const job = this.scans.get(id);
    if (!job) throw new ServiceError(404, 'Tarama bulunamadi');
    if (job.status !== 'running') throw new ServiceError(409, 'Tarama zaten bitti');
    this.controllers.get(id)?.abort();
    // Duraklatilmis tarama iptal edilirse bekleyen is bolumleri uyandirilir.
    this.wakePaused(id);
    info('tarama iptal istendi', {
      scanId: job.id,
      ilerleme: `${job.progress.done}/${job.progress.total}`,
    });
  }

  /** Taramayi hedef sinirinda duraklatir (aktif is bolumu bitirir). */
  pause(id: string): void {
    const job = this.scans.get(id);
    if (!job) throw new ServiceError(404, 'Tarama bulunamadi');
    if (job.status !== 'running') throw new ServiceError(409, 'Tarama zaten bitti');
    if (job.paused) return;
    job.paused = true;
    this.pushEvent(job, { type: 'paused' });
    info('tarama duraklatildi', { scanId: job.id, ilerleme: `${job.progress.done}/${job.progress.total}` });
  }

  /** Duraklatilmis taramayi devam ettirir. */
  resume(id: string): void {
    const job = this.scans.get(id);
    if (!job) throw new ServiceError(404, 'Tarama bulunamadi');
    if (job.status !== 'running') throw new ServiceError(409, 'Tarama zaten bitti');
    if (!job.paused) return;
    job.paused = false;
    this.pushEvent(job, { type: 'resumed' });
    this.wakePaused(id);
    info('tarama devam ediyor', { scanId: job.id });
  }

  private wakePaused(id: string): void {
    const waiters = this.pauseWaiters.get(id);
    if (!waiters) return;
    for (const wake of [...waiters]) wake();
    this.pauseWaiters.delete(id);
  }

  private waitIfPaused(job: ScanJob, signal: AbortSignal): Promise<void> {
    if (!job.paused) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let waiters = this.pauseWaiters.get(job.id);
      if (!waiters) {
        waiters = new Set();
        this.pauseWaiters.set(job.id, waiters);
      }
      const wake = () => {
        waiters!.delete(wake);
        signal.removeEventListener('abort', wake);
        resolve();
      };
      waiters.add(wake);
      signal.addEventListener('abort', wake, { once: true });
    });
  }

  /**
   * Olayi artan kimlikle yayinlar ve son 2000 olayi tutar. Yeniden
   * baglanan istemci `Last-Event-ID` gonderirse buradan tekrar oynatilir.
   */
  private pushEvent(job: ScanJob, event: ScanStreamEvent): void {
    const id = ++job.nextEventId;
    job.events.push({ id, event });
    if (job.events.length > 2000) job.events.splice(0, job.events.length - 2000);
    this.emit(job.id, event, id);
  }

  private async runJob(job: ScanJob, controller: AbortController, args: ScanArgs): Promise<void> {
    try {
      const result = await runScan({
        envs: args.envs,
        profile: args.profile,
        minAgeDays: args.minAgeDays,
        root: args.root,
        roots: args.roots,
        json: true,
        includeBytes: true,
        exclude: args.exclude,
        quiet: true,
        signal: controller.signal,
        beforeTarget: () => this.waitIfPaused(job, controller.signal),
        onSkipped: (skipped) => this.pushEvent(job, { type: 'skipped', skipped }),
        onProgress: (done, total, bytes) => {
          job.progress = { done, total, bytes };
          this.pushEvent(job, { type: 'progress', done, total, bytes });
        },
        onTargets: (paths) => {
          job.targets = paths;
          this.pushEvent(job, { type: 'targets', paths });
        },
        onTargetStart: (path, done, total) => {
          this.pushEvent(job, { type: 'target-start', path, done, total });
        },
        onTargetDone: (path, done, total, cluster) => {
          // Once kume olayi (eski istemci/uyumluluk), sonra oge duzeyi
          // olay. Istemci oge kimligiyle tekillestirir.
          if (cluster) job.found.push(cluster);
          this.pushEvent(job, { type: 'target-done', path, done, total, cluster });
          if (cluster) {
            this.pushEvent(job, {
              type: 'item',
              id: scanItemId(cluster),
              key: cluster.key,
              path: primaryPath(cluster),
              cluster,
              done,
              total,
            });
          }
        },
      });

      if (controller.signal.aborted) {
        job.status = 'cancelled';
        info('tarama iptal edildi', {
          scanId: job.id,
          ilerleme: `${job.progress.done}/${job.progress.total}`,
          kume: result.clusters.length,
        });
        this.pushEvent(job, { type: 'cancelled' });
        return;
      }

      job.status = 'done';
      job.result = result;
      this.cacheLoaded = true;
      // Proje ici (--root) tarama SISTEM onbellegini temsil etmez:
      // ne son tarama olarak saklanir ne de 24 saatlik diske yazilir.
      // Aksi halde 27 kumelik kismi bir proje taramasi "son tam
      // tarama" gibi gorunurdu.
      if (!args.root && !(args.roots && args.roots.length > 0)) {
        // Damga `result.finishedAt` olmalı: `Date.now()` kayıt anını verir ve
        // diskten okunduğunda (`scan-cache.ts` -> finishedAt) farkli deger
        // ortaya cikar. Ayni veriden ayni zaman damgasi: "dirty" karari
        // yeniden baslatmada degismesin.
        this.lastScan = { scan: result, at: result.finishedAt };
        // Sonraki sunucu baslangicinda / sayfa yenilemesinde kullanilir.
        // Testler kismi taramalari onbellege yazmasin (persistScan: false).
        if (this.persistScan) await saveScanCache(result);
      }
      this.pushEvent(job, { type: 'done', result });
    } catch (err) {
      if (controller.signal.aborted) {
        job.status = 'cancelled';
        this.pushEvent(job, { type: 'cancelled' });
      } else {
        job.status = 'error';
        job.error = describeError(err);
        this.pushEvent(job, { type: 'error', message: job.error });
      }
    } finally {
      this.active = null;
      this.controllers.delete(job.id);
      this.wakePaused(job.id);
      job.paused = false;
    }
  }
}
