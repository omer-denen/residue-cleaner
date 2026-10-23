import { stat, readdir, readFile } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { longPath, errorCode } from '../util/longpath.ts';
import { debug, warn } from '../util/log.ts';
import { probeDir, ownerFromName, type Probe } from './classifier.ts';
import { isOwnDataPath, isProtectedUserPath } from './discover.ts';
import { isGitTracked } from './git.ts';
import { walk, type WalkResult } from './walker.ts';
import { buildClusterEvidence } from './evidence-tree.ts';
import {
  compareVersions as compareSemVer,
  parseVersion,
} from './semver.ts';
import { readExeInfo } from './exe-info.ts';
import type {
  Archetype,
  Cluster,
  Confidence,
  DeleteTarget,
  Evidence,
  LogSignal,
  Part,
  Regenerability,
  Risk,
  SensitiveAllow,
  SkippedEntry,
  Verdict,
} from './types.ts';
import { daysSince, formatAge } from '../util/format.ts';

/**
 * Kanit -> Mimari tip -> Karar.
 *
 * Burada kararlar "uygulama adi" ile degil, "tür" ile verilir:
 * bir klasor CUDA DLL'leri + model dosyalari iceriyorsa, adi ne olursa
 * olsun bir model calistirma deposudur.
 */

export interface ClassifyOptions {
  now?: number;
  /** Bu yastan eskiyse sadece raporla, silme onerisi verme */
  minAgeDays?: number;
  /** Iptal sinyali: yurume durur, yarim sonuc kumeye cevrilmez. */
  signal?: AbortSignal;
  /** T28: hassas siniflarin (gecmis/model/kural) acik izni. */
  allow?: SensitiveAllow;
  /**
   * E10c: GPU kaniti; `detectGpu()` sonucu bir kez alinip CAGRI
   * yerinde enjekte edilir. Modul duzeyinde paylasilan durum yoktur;
   * iki classifyPath cagrisi birbirinin GPU durumunu tasmaz. `null`
   * veya verilmediyse "bilinmiyor" demektir ve "GPU yok" SAYILMAZ;
   * yokluk yalnizca kanitla dogrulanir.
   */
  gpu?: GpuEvidence;
  /**
   * Erisilemeyen/atlanan yollar. Tarama sonucundaki `skipped` listesine
   * akar; "sessizce eksik sayma" yerine kanit olur.
   */
  onSkipped?: (skipped: SkippedEntry[]) => void;
  /** Alt dizin ilerlemesi: buyuk tek hedefte de canli geri bildirim. */
  onProgress?: (dirs: number, bytes: number) => void;
  /**
   * Salt okunur tarama (profil `readOnly`): kanit toplanir, karar
   * uretilir ama SILME HEDEFI olusmaz. Karar katmani bunu zorunlu kilar.
   */
  readOnly?: boolean;
}

/**
 * Windows kurulum kokunu sabitsiz cozer: %SystemRoot% > SystemDrive > C:\Windows.
 * Sabit `C:\Windows` kullanmak, Windows baska surucuye kurulmus makinelerde
 * (veya %SystemRoot% farkliysa) `nvcuda.dll`'i bulamayip fiilen KULLANILABILIR
 * CUDA runtime'ini "yok" sansti (E10d). Yol kurulumu tek yerdedir; `longPath`
 * korunur.
 */
export function systemRootPath(env: NodeJS.ProcessEnv = process.env): string {
  const root = (env.SystemRoot ?? '').trim();
  if (root !== '') return root;
  const drive = (env.SystemDrive ?? '').trim();
  if (drive !== '') return drive.endsWith('\\') ? drive + 'Windows' : drive + '\\Windows';
  return 'C:\\Windows';
}

interface NvcudaCandidate {
  file: string;
  /** Gerekce metninde gosterilecek yer etiketi */
  where: string;
}

function nvcudaCandidates(root: string): NvcudaCandidate[] {
  return [
    { file: join(root, 'System32', 'nvcuda.dll'), where: '%SystemRoot%\\System32' },
    { file: join(root, 'SysWOW64', 'nvcuda.dll'), where: '%SystemRoot%\\SysWOW64' },
  ];
}

/**
 * GPU kanitinin UCLU durumu (E10c/E10d):
 *  - `{ hasNvidia: true/false, note }` → kanit toplanabildi.
 *    `false` yalnizca "tum adaylar gercekten yok (ENOENT)" demektir.
 *  - `null` → kanit toplanamadi (erisim engellendi): "bilinmiyor".
 *    "GPU yok" hukmu VERILEMEZ; kullanilabilir CUDA runtime'in silme
 *    teklifine donmesi boylece engellenir.
 */
export type GpuEvidence = { hasNvidia: boolean; note: string } | null;

/** Bir nvcuda adayinin toplama sonucu (saf yardimcinin girdisi). */
export interface GpuCandidateResult {
  /** Gerekce metninde gosterilecek yer etiketi */
  where: string;
  outcome: 'found' | 'missing' | 'denied';
  /** outcome === 'denied' icin erisim hatasi kodu (EACCES/EPERM) */
  code?: string;
}

/**
 * Saf GPU karar yardimcisi (E10d): aday basina toplama sonucunu UCLU
 * duruma cevirir. I/O BILMEZ; testler stat enjeksiyonu olmadan buradan
 * uc durumu dogrulayabilir.
 *  - Bir adayda nvcuda.dll bulundu → `{ hasNvidia: true }`
 *  - TUM adaylar gercekten yok (ENOENT) → `{ hasNvidia: false }`
 *  - Erisim engellendi (EACCES/EPERM) → `null`: "bilinmiyor". Kanit
 *    olmadigi icin "yok" denmez.
 */
export function interpretGpuEvidence(
  candidates: readonly GpuCandidateResult[],
): GpuEvidence {
  const hit = candidates.find((c) => c.outcome === 'found');
  if (hit) {
    return {
      hasNvidia: true,
      note: `NVIDIA CUDA surucusu bulundu (${hit.where}\\nvcuda.dll)`,
    };
  }
  if (candidates.some((c) => c.outcome === 'denied')) return null;
  return { hasNvidia: false, note: 'NVIDIA CUDA surucusu yok (GPU runtime kullanilamaz)' };
}

/**
 * Ortam tespiti: makinede GPU var mi?
 *
 * Sonuc UCLU durumdur (bkz. `GpuEvidence`). Erisim hatasi (EACCES/EPERM)
 * "dosya yok" DEGILDIR: o durumda null doner ve cagran "GPU yok"
 * varsayimiyla hareket EDEMEZ. Ek kanit: System32'de bulunamazsa
 * SysWOW64 (WOW64 CUDA stub'i) denenir. Karar mantigi saf yardimci
 * `interpretGpuEvidence` icindedir.
 */
export async function detectGpu(): Promise<GpuEvidence> {
  const candidates = nvcudaCandidates(systemRootPath());
  const results: GpuCandidateResult[] = [];
  for (const c of candidates) {
    try {
      const s = await stat(longPath(c.file));
      void s;
      results.push({ where: c.where, outcome: 'found' });
    } catch (err) {
      const code = errorCode(err);
      // ENOENT: bu yolda gercekten yok; siradaki kanit yoluna bak.
      results.push({
        where: c.where,
        outcome: code === 'EACCES' || code === 'EPERM' ? 'denied' : 'missing',
        code,
      });
    }
  }
  const verdict = interpretGpuEvidence(results);
  if (verdict === null) {
    // E10d: erisim engellendiyse "yok" denmez; kanit toplanamadi ayri
    // durumdur. Kodlar gunluge acik yazilir (sessiz eksiklik yok).
    const denied = results
      .filter((r) => r.outcome === 'denied')
      .map((r) => `${r.where}(${r.code})`)
      .join(', ');
    warn('NVIDIA kaniti toplanamadi: erisim engellendi (GPU durumu bilinmiyor)', {
      erisen: denied,
    });
  }
  return verdict;
}

/** Tek bir kok klasoru inceler ve (varsa) kumeye cevirir. */
export async function classifyPath(
  root: string,
  origin: Part['origin'],
  opts: ClassifyOptions = {},
): Promise<Cluster | null> {
  // Aracin kendi veri dizini (kasa, gunluk, tarama onbellegi) hicbir
  // kosulda "artik" olarak gosterilmez; tarama kapsamina da girmez.
  if (isOwnDataPath(root)) {
    debug('kendi veri dizini atlandi', { root, origin });
    return null;
  }

  // Kimlik bilgisi klasorleri (.ssh, .gnupg, .aws, .azure, .kube):
  // icinde onbellek gibi gorunen dosyalar olsa bile siniflandirilmaz.
  if (isProtectedUserPath(root)) {
    debug('kimlik bilgisi klasoru atlandi', { root, origin });
    return null;
  }

  const now = opts.now ?? Date.now();
  const probe = await probeDir(root);
  // Yasla kisitli hedefler icin kirilimlar: temp 3 gun, ortam havuzu 90 gun.
  const w = await walk({
    root,
    largeThreshold: 32 * 1024 * 1024,
    maxLarge: 12,
    signal: opts.signal,
    onProgress: opts.onProgress,
    olderThanDays: [3, 90],
    now,
  });
  if (w.skipped.length > 0) opts.onSkipped?.(w.skipped);

  // Iptal edildiyse yarim olcumle kume uretme.
  if (opts.signal?.aborted) return null;

  if (w.bytes === 0 && w.files === 0) {
    debug('bos klasor atlandi', { root, origin });
    return null;
  }

  const ev: Evidence = {
    owner: probe.owner,
    fileKinds: probe.fileKinds,
    markers: probe.markers,
    logSignals: dedupeLogSignals(probe.logSignals),
    largeFiles: w.largeFiles.map((f) => ({ ...f, kind: 'onnx-model' })),
    lastTouched: w.lastTouched,
  };

  const archetype = detectArchetype(ev, root, w.extensionCounts, probe);
  // E10c: GPU kaniti cagrandan (opsiyonlardan) gelir; global durum yok.
  const gpu = opts.gpu ?? null;
  let reclaimable = estimateReclaimable(archetype, w.bytes, w.extensionCounts, w.olderBytes, gpu);
  // T28: --nuke-models verildiyse tum model deposu hedeflenir.
  if (archetype === 'model-store' && opts.allow?.models) reclaimable = w.bytes;

  // Alt parca olcumleri ayni yolu birden fazla kez yurumesin (E8):
  // tek bir `MeasureCache` tum alt parca olcumlerini paylasir.
  const measure = new MeasureCache();

  // T32: pnpm/bun ana klasorleri uygulamayi da icerir. Depo kokü
  // taranan klasorden farkliysa YALNIZCA depo olculur ve hedeflenir.
  if (archetype === 'pkg-manager-cache' && probe.cacheRoot) {
    const cw = await measure.measure(probe.cacheRoot);
    if (!opts.signal?.aborted) {
      ev.cacheRoot = probe.cacheRoot;
      reclaimable = cw.bytes;
    }
  }

  const key = clusterKey(ev, root);

  // E6b/E6c: guncel surum ek kanitsiz secildi ise bu, karar metnine
  // yaziyor; "kanit tam" sanilmasin (bkz. K10/K16 deneyimi).
  let versionEvidenceIncomplete = false;

  // Bilesik mimari: model deposunun icinde kullanilamayan GPU runtime'i
  // varsa, tum kume "temizlenebilir" degil, parca parca olur.
  // Onemli: alt parca yollari TAHMIN edilmez, gercekten olculur.
  //
  // Editor uzanti depolarinda eski surumler, surumlu uygulama
  // klasorlerinde ise kullanilmayan app-<surum> klasorleri ayni
  // sekilde GERCEK YOLDAN olculur.
  const extra: SubPart[] = [];
  if (probe.editorExtensions) extra.push(...(await detectEditorOrphans(root, measure)));
  if (probe.appVersions) {
    const orphans = await detectAppVersionOrphans(root, measure);
    extra.push(...orphans.parts);
    if (orphans.keepBasis === 'highest-only' && orphans.parts.length > 0) {
      versionEvidenceIncomplete = true;
    }
  }
  if (archetype === 'agent-workspace') extra.push(...(await detectAgentParts(root, ev, measure)));
  // Ic ice parca olmaz: bir parca digerinin icindeyse yalnizca DIS olan
  // kalir. Aksi halde bayt iki kez sayilir ve silme hedefleri cakisir
  // (or. CUDA dizini "-gpu" varyant dizininin icinde).
  const sub = dropNestedSubParts([...extra, ...(await detectSubParts(root, ev, now, measure, { gpu }))]);
  // Yalnizca GERCEKTEN geri kazanilabilir alt parcalar toplanir. Ajan
  // calisma alanindaki beceri/plan (keep) ve bagimlilik (report-only)
  // parcalari "silinebilir" sayiya KATILMAZ.
  const reclaimableSub = sub.filter(
    (s) => s.verdictKind === 'recommend' || s.verdictKind === 'ask',
  );
  if (reclaimableSub.length > 0) {
    reclaimable += reclaimableSub.reduce((a, b) => a + b.bytes, 0);
  }

  const verdict = decide({
    archetype,
    ev: { ...ev, markerSubpartCount: sub.length },
    root,
    reclaimable,
    totalBytes: w.bytes,
    now,
    minAgeDays: opts.minAgeDays ?? 0,
    allow: opts.allow,
    gpu,
  });

  // Her kararin gerekcesi kaydedilir: "bu klasor neden guvenli sayildi"
  debug('siniflandirma', {
    root,
    archetype,
    risk: verdict.risk,
    kind: verdict.kind,
    totalMB: Math.round(w.bytes / 1048576),
    reclaimMB: Math.round(reclaimable / 1048576),
    files: w.files,
    evidence: {
      fileKinds: ev.fileKinds,
      markers: ev.markers,
      logMeans: (ev.logSignals ?? []).map((s) => s.means),
      subparts: sub.length,
    },
    because: verdict.because,
  });

  // Kanit yetersizse acikca uyari ver (bu, en sik hatadir)
  if (archetype === 'unknown') {
    warn('kanit yetersiz, kullanici dogrulamasi gerekiyor', {
      root,
      sizeMB: Math.round(w.bytes / 1048576),
      markers: ev.markers,
      fileKinds: ev.fileKinds,
    });
  }

  if (sub.length > 0) {
    verdict.because.unshift(
      `Icinde ${sub.length} ayri degerlendirilebilir parca var: ${sub.map((s) => s.label).join(', ')}`,
    );
  }
  if (versionEvidenceIncomplete) {
    verdict.because.push(
      'Guncel surum ek kanitla dogrulanamadi (Update.exe surumu okunamadi); eski surumler report-only, silme hedefi uretilmez',
    );
  }

  const part: Part = {
    path: root,
    bytes: w.bytes,
    files: w.files,
    lastTouched: w.lastTouched,
    reclaimableBytes: reclaimable,
    origin,
  };

  // --- Gercek silme hedefleri ---
  // Kume seviyesindeki "silinebilir" bayt tek basina yeterli degildir;
  // hangi YOLUN ne kadarinin silineceği burada belirlenir.
  // T28: hassas siniflar (sohbet gecmisi / kural dosyalari) yalnizca
  // ilgili bayrak verildiyse hedef uretir. Proje ici taramalar bu kapiya
  // dahil DEGILDIR (AGENTS kural 9 korunur).
  const projectLike = archetype === 'project-workspace' || archetype === 'project-artifact';
  const sensitive = projectLike ? [] : buildSensitiveTargets(root, ev, opts.allow);
  if (sensitive.length > 0) {
    verdict.kind = 'ask';
    verdict.risk = 'high';
    verdict.preconditions.push(
      'Hassas veri: geri gelmez; once yedekle, iki asamali onay korunur',
    );
    verdict.consequence += ` Yalnizca acik bayrakla acildi (${sensitive
      .map((t) => t.label.split(' (')[1]?.replace(')', '') ?? '')
      .filter(Boolean)
      .join(', ')}).`;
    verdict.because.push('Hassas sinif: kullanici acikca istedi');
  }
  const rawTargets = [
    ...buildDeleteTargets(root, archetype, sub, w.bytes, now, ev, opts.allow, w.olderBytes),
    ...sensitive,
  ];
  // T32: depo alt klasoru hedefleniyorsa boyutu olculmus degerden al.
  if (ev.cacheRoot) {
    for (const t of rawTargets) {
      if (t.path.toLowerCase() === ev.cacheRoot.toLowerCase()) t.bytes = reclaimable;
    }
  }
  // Git farkindaligi (T27): tracked yollar silme hedefinden cikarilir.
  // Ters yon korumasi (D7): tarama koku kendi veri dizinini ya da bir
  // kimlik bilgisi klasorunu ICERIYORSA alt hedefler arasinda o yol
  // kalabilir; hedef listesine giremez.
  const targets: DeleteTarget[] = [];
  let gitSkipped = 0;
  let protectedSkipped = 0;
  for (const t of rawTargets) {
    if (isOwnDataPath(t.path) || isProtectedUserPath(t.path)) {
      protectedSkipped++;
      continue;
    }
    if (isGitTracked(t.path)) {
      gitSkipped++;
      continue;
    }
    targets.push(t);
  }
  if (protectedSkipped > 0) {
    verdict.preconditions.push(
      `${protectedSkipped} korunan yol (kendi veri dizini / kimlik bilgisi) hedef alinmadi`,
    );
  }
  if (gitSkipped > 0) {
    verdict.preconditions.push(
      `${gitSkipped} git tarafindan takip edilen yol atlandi (tracked dosyalar silinmez)`,
    );
    if (!ev.markers) ev.markers = [];
    if (!ev.markers.includes('git-tracked')) ev.markers.push('git-tracked');
  }

  // TUTARLILIK KURALI: Silme hedefi olmayan bir kume "onerilen"
  // OLABILMEZ. Aksi halde kullanici "sil" derse hicbir sey olmaz ve
  // arac bozuk gorunur. Hedef yoksa karar en kotu "dogrulama"ya iner.
  if (targets.length === 0) enforceTargetConsistency(verdict, root, archetype);

  // Boyutu 0 olan hedefleri (Electron onbellegi, hassas klasorler) GERCEK
  // yoldan olc. Tek yerde yapilir; olcum sonucu bos kalan hedef dusurulur.
  //
  // YASLA KISITLI hedef (`older`) ASLA bu yolla olculmez: "3 gunden eski
  // dosyalar" hedefinin bayti yas kirilimindan gelir. Burada tum klasoru
  // olcmek hedefi sessizce "tamami" yapardi.
  let finalTargets = targets;
  if (targets.some((t) => t.bytes === 0 && t.kind === 'whole')) {
    const measured = await Promise.all(
      targets.map(async (t) => {
        if (t.bytes > 0 || t.kind !== 'whole') return t;
        const cw = await measure.measure(t.path);
        return { ...t, bytes: cw.bytes };
      }),
    );
    finalTargets = measured;
  }
  // 0 baytlik hedef "silinecek dosya yok" demektir (yas kirilimi bos ya
  // da olcum bos). Tutarlilik kurali burada da gecerlidir.
  if (finalTargets.some((t) => t.bytes === 0)) {
    finalTargets = finalTargets.filter((t) => t.bytes > 0);
    if (finalTargets.length === 0) enforceTargetConsistency(verdict, root, archetype);
  }

  // Salt okunur profil (`audit`): kanit ve karar kalir, hedef KALMAZ.
  // Bu, arayuz dugmesinin pasifligine guvenmek yerine motorun kendisinde
  // uygulanan bir garantidir.
  if (opts.readOnly) {
    finalTargets = [];
    reclaimable = 0;
    verdict.kind = verdict.kind === 'keep' ? 'keep' : 'report-only';
    verdict.preconditions.push('Salt okunur profil: silme hedefi uretilmez');
  }

  const targetBytes = finalTargets.reduce((a, t) => a + t.bytes, 0);
  // Tek kaynak: kume seviyesindeki "geri kazanilabilir" = gercek silme
  // hedeflerinin toplami (git/koruma suzgecinden SONRA). Tahmin ile
  // hedef toplami ayrisamaz (E4).
  reclaimable = targetBytes;

  return {
    key,
    title: verdict.title,
    archetype,
    parts: [part],
    subparts: sub,
    deleteTargets: finalTargets,
    totalBytes: w.bytes,
    reclaimableBytes: reclaimable,
    lastTouched: w.lastTouched,
    evidence: ev,
    evidenceTree: buildClusterEvidence({
      key,
      title: verdict.title,
      archetype,
      parts: [part],
      subparts: sub,
      deleteTargets: finalTargets,
      totalBytes: w.bytes,
      reclaimableBytes: reclaimable,
      lastTouched: w.lastTouched,
      evidence: ev,
      verdict,
    }),
    verdict,
  };
}

/**
 * TUTARLILIK KURALI (tek kaynak).
 *
 * "Onerilen" karar, silinecek bir yol varsa anlamlidir. Hedef yoksa
 * karar "dogrulama"ya iner ve gerekceye not dusulur; boylece arayuzde
 * kilitli gorunen bir "onerilen" satir olusmaz.
 */
function enforceTargetConsistency(verdict: Verdict, root: string, archetype: Archetype): void {
  if (verdict.kind !== 'recommend') return;
  verdict.kind = 'ask';
  verdict.risk = verdict.risk === 'safe' ? 'low' : verdict.risk;
  verdict.consequence += ' (silinecek yol belirlenemedi, bu yuzden otomatik secilmedi)';
  verdict.preconditions.push('Silme hedefi uretilemedi — icerik elle incelenmeli');
  warn('hedefsiz kume oneriliyordu, guvenli tarafa cekildi', {
    root,
    archetype,
    hedef: 0,
  });
}

/**
 * Silme hedeflerini uretir.
 *
 * Kritik kural: "guvenli" sinif her zaman tum klasoru silmek demek
 * DEGILDIR. Gecici klasorlerde sadece yasli dosyalar hedeflenir;
 * model depolarda sadece bilesik (kullanilamayan) parcalar.
 */
function buildDeleteTargets(
  root: string,
  archetype: Archetype,
  sub: SubPart[],
  totalBytes: number,
  now: number,
  ev?: Evidence,
  allow?: SensitiveAllow,
  olderBytes?: Map<number, number>,
): DeleteTarget[] {
  switch (archetype) {
    case 'virtual-disk':
    case 'os-user-data':
    case 'project-artifact':
      return []; // HICBIR ZAMAN otomatik hedeflenmez

    case 'temp-scratch':
      // Sadece 3 gunden eski gecici dosyalar. Bayt, YAS KIRILIMINDAN gelir:
      // tum klasoru "silinecek" gibi gostermek yanlis olur.
      return [
        {
          path: root,
          kind: 'older',
          minAgeDays: 3,
          label: `${baseName(root)} — 3 gunden eski gecici dosyalar`,
          bytes: olderBytes ? (olderBytes.get(3) ?? 0) : totalBytes,
        },
      ];

    case 'model-store': {
      // T28: --nuke-models verilmedikce YALNIZCA bilesik parcalar
      // (kullanilamayan GPU runtime/varyant) hedeflenir. Bayrakla tum
      // model deposu hedef olur; risk yuksektir.
      // E6a/E6c: 'report-only' alt parcalar (sinirli tarama / dogrulan-
      // mamis surum) hedef URETMEZ; yalnizca kanitli adaylar hedeflenir.
      if (allow?.models) {
        return [
          {
            path: root,
            kind: 'whole',
            label: `${baseName(root)} — TUM model deposu (--nuke-models)`,
            bytes: totalBytes,
          },
        ];
      }
      return sub
        .filter((s) => s.verdictKind === 'recommend' || s.verdictKind === 'ask')
        .map((s) => ({
          path: s.path,
          kind: 'whole' as const,
          label: s.label,
          bytes: s.bytes,
        }));
    }

    case 'editor-extension-store':
    case 'versioned-app-store':
      // Yalnizca artik kalmis alt parcalar (eski uzanti surumu veya
      // eski app-<surum> klasoru) hedeflenir; kok klasor SILINMEZ.
      // E6a/E6c: 'report-only' alt parcalar (kanit tam degil) hedef URETMEZ.
      return sub
        .filter((s) => s.verdictKind === 'recommend' || s.verdictKind === 'ask')
        .map((s) => ({
          path: s.path,
          kind: 'whole' as const,
          label: s.label,
          bytes: s.bytes,
        }));

    case 'accelerator-runtime':
      return [
        { path: root, kind: 'whole', label: `${baseName(root)} — kullanilamayan GPU runtime`, bytes: totalBytes },
      ];

    case 'electron-app-data': {
      // Yalnizca onbellek alt klasorleri. "Local Storage",
      // "Preferences", "Session Storage" SILINMEZ.
      const CACHE_DIRS = [
        'Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache',
        'DawnWebGPUCache', 'ShaderCache', 'GrShaderCache', 'blob_storage',
        'Service Worker', 'CacheStorage',
      ];
      const found = CACHE_DIRS.filter((d) =>
        (ev?.markers ?? []).some((m) => m.toLowerCase() === d.toLowerCase()),
      );
      if (found.length === 0) return [];
      return found.map((d) => ({
        path: `${root}\\${d}`,
        kind: 'whole' as const,
        label: `${baseName(root)}\\${d}`,
        bytes: 0, // yürüyüş sırasında doldurulur
      }));
    }

    case 'pkg-manager-cache': {
      // T32: depo kokü taranan klasorden farkliysa (pnpm/bun ana
      // klasoru) yalnizca depo alt klasoru hedeflenir.
      const cacheRoot = ev?.cacheRoot ?? root;
      return [
        {
          path: cacheRoot,
          kind: 'whole',
          label: `${baseName(cacheRoot)} — paket deposu`,
          bytes: cacheRoot === root ? totalBytes : 0,
        },
      ];
    }

    case 'crash-artifacts':
    case 'updater-staging':
      return [
        { path: root, kind: 'whole', label: `${baseName(root)} — onbellek`, bytes: totalBytes },
      ];

    case 'runtime-pool':
      // Ortam havuzu: yasla kisitla (90 gunden eski ortamlar). Bayt yas
      // kirilimindan gelir; tum havuz hedef gibi gosterilmez.
      return [
        {
          path: root,
          kind: 'older',
          minAgeDays: 90,
          label: `${baseName(root)} — 90 gunden eski ortamlar`,
          bytes: olderBytes ? (olderBytes.get(90) ?? 0) : totalBytes,
        },
      ];

    default:
      return [];
  }
}

/**
 * T28: yalnizca acik bayrakla uretilen hassas hedefler.
 *
 * - `--clear-history`: koke dogrudan bagli sessions/history/chats klasorleri.
 * - `--reset-rules`:   `rules/` klasoru veya kokteki `*.rules` dosyalari.
 *
 * Klasorun TAMAMI hedeflenmez; yalnizca kanitla bulunan alt yollar.
 * Proje taramalari bu fonksiyonu cagirmaz (AGENTS kural 9).
 */
function buildSensitiveTargets(
  root: string,
  ev: Evidence,
  allow?: SensitiveAllow,
): DeleteTarget[] {
  if (!allow || (!allow.history && !allow.rules)) return [];
  const markers = new Set((ev.markers ?? []).map((m) => m.toLowerCase()));
  const out: DeleteTarget[] = [];
  const seen = new Set<string>();
  const push = (path: string, label: string) => {
    const k = path.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ path, kind: 'whole', label, bytes: 0 });
  };
  const addDir = (name: string, flag: string) => {
    const p = `${root}\\${name}`;
    try {
      if (statSync(longPath(p)).isDirectory()) push(p, `${name} — ${flag}`);
    } catch {
      /* yok */
    }
  };

  // Sohbet gecmisi: dizin ADI yetmez. Yalnizca kendi kaniti olan
  // dizinler hedeflenir (classifier `chat-dir:<ad>` isareti uretir).
  // Kokteki `chat*.json` dosyasi da isaret uretir ama bu, diger
  // dizinleri hedef yapmaz.
  if (allow.history) {
    for (const m of markers) {
      if (!m.startsWith('chat-dir:')) continue;
      const name = m.slice('chat-dir:'.length);
      if (name && !/[\\/]/.test(name)) addDir(name, 'sohbet gecmisi (--clear-history)');
    }
  }

  if (allow.rules && markers.has('rules-files')) {
    addDir('rules', 'kural dosyalari (--reset-rules)');
    try {
      for (const e of readdirSync(longPath(root), { withFileTypes: true }).slice(0, 300)) {
        if (e.isFile() && /\.rules$/i.test(e.name)) {
          push(`${root}\\${e.name}`, `${e.name} — kural dosyasi (--reset-rules)`);
        }
      }
    } catch {
      /* okunamadi */
    }
  }

  return out;
}

function baseName(p: string): string {
  return p.split('\\').filter(Boolean).pop() ?? p;
}

/**
 * Bilesik degerlendirme: bir klasorun icinde hem "kullanilir" hem
 * "gereksiz" seyler olabilir. Ornek (bu makinede gercek):
 *
 *   .MuhasibPro\cache\models           4.9 GB → silinebilir (yeniden indirilir)
 *   .MuhasibPro\ep\cuda-ep            2.3 GB → SILINEBILIR, makinede GPU yok
 *   .MuhasibPro\cache\models\...\gpu  1.2 GB → SILINEBILIR, cihaz CPU
 *
 * Kullaniciya "7.1 GB sil" demek dogru olurdu ama "tumunu sil" yanlis
 * olurdu: uygulama CPU modellerini kullaniyor. Bu yuzden her parca
 * GERCEK YOLUNDAN olculur ve ayri karar verilir.
 */
export interface SubPart {
  path: string;
  bytes: number;
  label: string;
  verdictKind: Verdict['kind'];
  reason: string;
}

/**
 * Ajan calisma alaninin ALT PARCALARI.
 *
 * Kanit: `skills/<ad>/SKILL.md` veya kokte `.skill-lock.json`. Boyle bir
 * klasorde ajanin eklenti bagimliliklari (node_modules / .venv) da bulunur.
 * Ucunu AYRI gosteririz:
 *  - beceriler ve planlar: kullanici degeri (keep)
 *  - bagimliliklar: yeniden uretilebilir (report-only)
 *
 * Hicbiri silme hedefi olmaz; `agent-workspace` zaten hedef uretmez.
 * Buradaki amac, "52 MB var ama dokunulmaz" ayrimini gorunur kilmaktir.
 */
async function detectAgentParts(root: string, ev: Evidence, measure: MeasureCache): Promise<SubPart[]> {
  const markers = new Set(ev.markers ?? []);
  if (!markers.has('skill-store') && !markers.has('skill-lock')) return [];

  const out: SubPart[] = [];

  const skills = await measureChild(root, 'skills', measure);
  if (skills) {
    out.push({
      path: `${root}\\skills`,
      bytes: skills.bytes,
      label: 'Ajan becerileri (kullanici verisi)',
      // 'keep' bilincli: bu bayt "silinebilir" toplamina girmez.
      verdictKind: 'keep',
      reason: 'SKILL.md iceriyor; ogrenilmis beceriler kullanici/ajan emegidir',
    });
  }

  if (markers.has('agent-plan')) {
    const plan = await measureChild(root, 'plan', measure);
    if (plan) {
      out.push({
        path: `${root}\\plan`,
        bytes: plan.bytes,
        label: 'Ajan planlari (kullanici verisi)',
        verdictKind: 'keep',
        reason: 'Plan dosyalari oturum kararlarini tasir; silme hedefi uretilmez',
      });
    }
  }

  const lock = [...markers].find((m) => m.startsWith('lockfile:'))?.slice('lockfile:'.length);
  for (const name of ['node_modules', '.venv', 'venv']) {
    const deps = await measureChild(root, name, measure);
    if (!deps) continue;
    out.push({
      path: `${root}\\${name}`,
      bytes: deps.bytes,
      label: `Ajan eklenti bagimliliklari (${name})`,
      // 'report-only': gorunur ama silinebilir sayilmaz, hedef uretmez.
      verdictKind: 'report-only',
      reason: lock
        ? `${lock} ile birebir yeniden kurulabilir; beceri ve plan dosyalari korunur`
        : 'Manifestten yeniden kurulabilir; beceri ve plan dosyalari korunur',
    });
  }

  return out;
}

/** Tek bir alt klasoru (varsa) olcer. Yoksa null. */
async function measureChild(
  root: string,
  name: string,
  measure: MeasureCache,
): Promise<{ bytes: number; files: number } | null> {
  const dir = `${root}\\${name}`;
  try {
    const st = await stat(longPath(dir));
    if (!st.isDirectory()) return null;
  } catch {
    return null;
  }
  const w = await measure.measure(dir);
  if (w.bytes === 0 && w.files === 0) return null;
  return { bytes: w.bytes, files: w.files };
}

/**
 * Ic ice alt parcalari ayiklar: bir yol digerinin altindaysa yalnizca
 * DIS (kapsayan) yol kalir.
 *
 * Iki sorunu birden cozer: baytlar iki kez sayilmaz ve silme hedefleri
 * ic ice girmez (ust hedef zaten alt hedefi kapsar).
 */
export function dropNestedSubParts(parts: SubPart[]): SubPart[] {
  const norm = (p: string) => p.toLowerCase().replace(/\\+$/, '');
  return parts.filter((p, i) => {
    const child = norm(p.path);
    return !parts.some((o, j) => {
      if (i === j) return false;
      const parent = norm(o.path);
      return child !== parent && child.startsWith(`${parent}\\`);
    });
  });
}

/**
 * Alt parca olcum onbellegi (E8).
 *
 * Ayni klasor birden fazla yoldan olculebilir (or. hem "eski uygulama
 * surumu" hem "GPU varyanti"). Her olcum tam bir yuruyustur; ayni yolu
 * ikinci kez yurumek bos maliyettir. Anahtar yolun kendisidir; ayni
 * yoldan gelen istekler AYNI promise'i paylasir.
 */
export class MeasureCache {
  private readonly pending = new Map<string, Promise<WalkResult>>();

  measure(path: string): Promise<WalkResult> {
    const key = path.toLowerCase();
    const hit = this.pending.get(key);
    if (hit) return hit;
    const p = walk({ root: path, largeThreshold: Infinity, maxLarge: 0 });
    this.pending.set(key, p);
    return p;
  }
}

export function logGpuVerdict(signals: LogSignal[]): { gpuUsed: boolean; cpuLine: boolean; cpuOnly: boolean } {
  const means = signals.map((s) => s.means).join(' | ');
  const gpuUsed = /GPU saglayicisi kullanildi/i.test(means);
  const cpuLine = signals.some((s) => /Device: CPU|CPUExecutionProvider/i.test(s.line));
  // Olumlu sinyal olumsuzu veto eder: log "Device: CPU" yazsa bile ayni
  // dosyada GPU saglayicisi kaydi varsa (CUDAExecutionProvider vb.) GPU
  // kullanilmis demektir. Model katalogu loglari CPU satirini da yazar.
  return { gpuUsed, cpuLine, cpuOnly: cpuLine && !gpuUsed };
}

export async function detectSubParts(
  root: string,
  ev: Evidence,
  now: number,
  measure: MeasureCache,
  opts?: { maxDirs?: number; gpu?: GpuEvidence },
): Promise<SubPart[]> {
  const out: SubPart[] = [];
  // E10c: GPU bilgisi parametreden gelir. null/yok = "bilinmiyor":
  // gpuAbsent false kalir, GPU'nun YOK sayilmasi yalnizca kanitla olur.
  const gpuAbsent = opts?.gpu != null ? !opts.gpu.hasNvidia : false;
  const cpuOnly = logGpuVerdict(ev.logSignals ?? []).cpuOnly;
  const gpuUnusable = gpuAbsent || cpuOnly;

  if (!gpuUnusable) return out;

  // E6a: sinirli tarama yarim kalirsa kanit TAM sayilmaz. Alt parca
  // "silinebilir" olarak uretilmez; alistirma ve not saklanir.
  const truncNotes: string[] = [];

  // --- 1. CUDA runtime dizinlerini GERCEK yoldan bul ---
  const cudaScan = await findDirsContaining(
    root,
    4,
    (name) =>
      /^cu(dnn|blas|blaslt|fft|rand|solver|art|graph)[a-z0-9_]*64[_-]\d+\.dll$/i.test(name) ||
      /^onnxruntime[_-].*cuda.*\.dll$/i.test(name),
    opts?.maxDirs,
  );
  if (cudaScan.truncated) truncNotes.push('CUDA runtime taramasi sinira takildi');
  for (const d of cudaScan.dirs) {
    const w = await measure.measure(d);
    out.push({
      path: d,
      bytes: w.bytes,
      label: 'GPU hizlandirici runtime (bu makinede kullanilamaz)',
      verdictKind: 'recommend',
      reason: (gpuAbsent
        ? 'NVIDIA CUDA surucusu yok; bu DLL yigini calistirilamaz'
        : 'Uygulama gunlugu CPU saglayicisini kullaniyor'),
    });
  }

  // --- 2. GPU icin derlenmis model varyantlari ---
  //
  // Guvenilir yontem: yol adinda GPU/CUDA ipucu tasiyan her dizini
  // dogrudan olcer. Model dosyasi adi degisebilir (model.onnx.data),
  // dizin adi degismez ("...-gpu-2", "...-trtrtx-gpu-2").
  const gpuScan = await findDirsNamed(root, 5, /(gpu|cuda|trt|rtx)/i, opts?.maxDirs);
  if (gpuScan.truncated) truncNotes.push('GPU varyant taramasi sinira takildi');
  const gpuSeen = new Set<string>();
  for (const variantDir of gpuScan.dirs) {
    const key = variantDir.toLowerCase();
    if (gpuSeen.has(key)) continue;
    gpuSeen.add(key);

    // CUDA runtime dizini zaten eklendiyse tekrar ekleme
    if (out.some((o) => variantDir.toLowerCase().startsWith(o.path.toLowerCase()))) continue;

    const variant = variantDir.split('\\').pop() ?? '';

    // Onemli ayrim: "-gpu" / "-trtrtx-gpu" gibi MODEL VARYANTLARI
    // yalnizca GPU'da calisir. Ama "webgpu-ep" bir CALISTIRMA
    // SAGLAYICISIDIR (execution provider) ve CPU'da da kullanilabilir;
    // onu silmek uygulamayi bosuna yorar. Ayrim isimden degil,
    // dizinin iceriginden yapilir.
    const isModelVariant = await looksLikeModelDir(variantDir);
    if (!isModelVariant) continue;

    const w = await measure.measure(variantDir);
    if (w.bytes < 8 * 1024 * 1024) continue; // isaretsiz kucuk klasorleri atla
    out.push({
      path: variantDir,
      bytes: w.bytes,
      label: `GPU icin derlenmis model: ${variant}`,
      verdictKind: 'recommend',
      reason: `Model agirliklari yalnizca GPU icin derlenmis ("${variant}"), cihaz ise CPU`,
    });
  }

  // E6a: Tarama siniri asildiysa bulunan alt parcalar KANIT TAM
  // sayilmaz: 'report-only' uretilir (silme hedefi olmaz), gerekceye
  // eksiklik notu eklenir. Liste yarim olabilecegi icin buradan
  // silme Onerisi uretilmez (guvenli taraf).
  if (truncNotes.length > 0) {
    for (const s of out) {
      if (s.verdictKind !== 'recommend') continue;
      s.verdictKind = 'report-only';
      s.reason += ` Tarama sinirina ulasildi (${truncNotes.join('; ')}); liste eksik olabilir, kanit tam sayilmaz. Yeniden taramadan sonra yeniden degerlendirin.`;
    }
  }

  // Ayni yolu iki kez eklemeyi engelle
  const seen = new Set<string>();
  return out.filter((s) => {
    const k = s.path.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return s.bytes > 0;
  });
}

/**
 * Editor uzanti deposunda ARTIK kalmis surumleri bulur.
 *
 * Aktif surumun tek guvenilir kaynagi extensions.json'dur.
 * .obsolete dosyasi ise editorun acikca "artik" dedigi klasorleri
 * listeler. Ikisinde de yoksa ve ad uzanti surumu kalibindaysa artik
 * sayilir. Klasorun TAMAMI hedeflenmez; yalnizca bu alt klasorler.
 */
async function detectEditorOrphans(root: string, measure: MeasureCache): Promise<SubPart[]> {
  const extDir = `${root}\\extensions`;
  let entries: Dirent[];
  try {
    entries = await readdir(longPath(extDir), { withFileTypes: true });
  } catch {
    return [];
  }

  const manifest = await readExtensionManifest(`${extDir}\\extensions.json`);
  const active = manifest.list;
  const obsolete = await readObsoleteFile(`${extDir}\\.obsolete`);
  const out: SubPart[] = [];

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const key = e.name.toLowerCase();
    if (active.has(key)) continue;
    // Yalnizca uzanti klasoru gibi gorunen adlar (publisher.ad-surum)
    // veya editorun acikca artik dedigi kayitlar.
    //
    // DIKKAT: manifest okunamadiysa "aktif surum" bilinmiyor demektir.
    // Bu durumda ad desenine bakip "artik" demek yanlistir; yalnizca
    // .obsolete listesine guvenilir. Aksi halde bozuk bir extensions.json
    // butun kurulu uzantilari silme onerisine cevirirdi.
    const looksLikeVersion = /-\d+\.\d+/.test(e.name);
    if (!obsolete.has(key) && (!manifest.ok || !looksLikeVersion)) continue;

    const dir = `${extDir}\\${e.name}`;
    const w = await measure.measure(dir);
    if (w.bytes === 0) continue;
    out.push({
      path: dir,
      bytes: w.bytes,
      label: `${e.name} — kullanilmayan uzanti surumu`,
      verdictKind: 'recommend',
      reason: obsolete.has(key)
        ? 'Editor bu klasoru .obsolete listesinde artik olarak isaretlemis'
        : 'extensions.json icinde aktif kaydi yok; aktif surum korunur',
    });
  }

  return out.sort((a, b) => b.bytes - a.bytes).slice(0, 40);
}

async function readExtensionManifest(
  manifest: string,
): Promise<{ list: Set<string>; ok: boolean }> {
  const out = new Set<string>();
  try {
    const j = JSON.parse(await readFile(longPath(manifest), 'utf8')) as unknown;
    if (!Array.isArray(j)) return { list: out, ok: false };
    for (const item of j) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      if (typeof o.relativeLocation === 'string') out.add(o.relativeLocation.toLowerCase());
      const loc = o.location as Record<string, unknown> | undefined;
      if (loc && typeof loc.path === 'string') {
        const base = loc.path.split(/[\\/]/).filter(Boolean).pop();
        if (base) out.add(base.toLowerCase());
      }
    }
    return { list: out, ok: true };
  } catch {
    /* manifest okunamadi: aktif surum bilinmiyor, yalnizca .obsolete kullanilir */
    return { list: out, ok: false };
  }
}

async function readObsoleteFile(file: string): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const j = JSON.parse(await readFile(longPath(file), 'utf8')) as unknown;
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      for (const k of Object.keys(j as Record<string, unknown>)) out.add(k.toLowerCase());
    }
  } catch {
    /* .obsolete yok: normal durum */
  }
  return out;
}

/**
 * app-<surum> kardesleri arasinda en guncel VE gecerli olani secer;
 * digerlerini silinebilir parca olarak dondurur.
 *
 * Kanit: her klasor bir Electron/Chromium uygulama yuklemesidir
 * (resources/app/package.json veya Chromium runtime dosyalari).
 * Tek surum varsa parca uretilmez; uygulama guncel surumdedir.
 *
 * E6b: Surum metni eklerle birlikte ayristirilir. `app-1.2.4-beta`,
 * `app-1.2.4` KARDESIDIR ama on surum olarak KUCUKTUR; guncel secimin
 * stabil surumden tarafa donmesi icin `semver.ts` tek kaynak kullanilir.
 * Esitlikte siralama klasor adiyla deterministik kirilir.
 *
 * E6c: "En yuksek surum duruyor" TEK BASINA silme kaniti degildir:
 * en yuksek dizin yarim kalmis bir guncelleme olabilir; fiilen
 * kullanilan eski surum o zaman silme adayi olur. Bu yuzden guncel
 * surumun EK KANITI araniyor (varsayilan: kokteki Update.exe'nin
 * VersionInfo surumu). Ek kanit yoksa eski surumler yalnizca
 * `report-only` olarak raporlanir; silme hedefi uretilmez.
 */
export interface AppVersionOrphanResult {
  parts: SubPart[];
  /** Hangi klasor "guncel" kabul edildi (klasor adi). */
  keep: string | null;
  /** Guncel secim hangi kanita dayanir? */
  keepBasis: 'updater-evidence' | 'highest-only';
}

export async function detectAppVersionOrphans(
  root: string,
  measure: MeasureCache,
  opts?: { updaterVersion?: string | null },
): Promise<AppVersionOrphanResult> {
  let entries: Dirent[];
  try {
    entries = await readdir(longPath(root), { withFileTypes: true });
  } catch {
    return { parts: [], keep: null, keepBasis: 'highest-only' };
  }

  const candidates: Array<{ name: string; path: string; verText: string }> = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    // E6b: on surum/derleme eki de yakalanmali: app-1.2.4-beta,
    // app-1.2.4+build.7 gibi. Eski regex eki kirpar, surumleri yalnis
    // esitlerdi.
    const verText = /^app-(\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.]+)?)/i.exec(e.name)?.[1];
    if (!verText) continue;
    const dir = `${root}\\${e.name}`;
    if (!(await looksLikeElectronRuntime(dir))) continue;
    candidates.push({ name: e.name, path: dir, verText });
  }

  if (candidates.length < 2) {
    return { parts: [], keep: null, keepBasis: 'highest-only' };
  }

  // On surum duyarli siralama (buyukten kucuge), sonra deterministik
  // isim kirilimi: ayni girdi her zaman ayni "guncel"i secer.
  candidates.sort(
    (a, b) =>
      compareSemVer(b.verText, a.verText) ||
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
  );

  // E6c: Guncel surumun EK kaniti. Testler gercagi asabilir: acik bir
  // `updaterVersion` verilirse diskteki Update.exe okunmaz.
  let updaterVersion: string | null;
  if (opts && 'updaterVersion' in opts) {
    updaterVersion = opts.updaterVersion ?? null;
  } else {
    // readExeInfo surec acmaz; okuma hatasi "surum bilinmiyor" anlamina
    // gelir ve ek kanit sayilmaz.
    const info = await readExeInfo(`${root}\\Update.exe`);
    updaterVersion = info.version?.replace(/^v/i, '') ?? null;
    if (updaterVersion && !parseVersion(updaterVersion)) {
      // "1.2.4_build" gibi surum bicimi olmayan metin kanit degildir.
      updaterVersion = null;
    }
  }
  // Update.exe surumu, kardes klasorlerin TAM birine esit (on surumle
  // birlikte) olmalidir; eslesen yoksa ek kanit sayilmez.
  const matched =
    updaterVersion !== null
      ? candidates.filter((c) => compareSemVer(c.verText, updaterVersion!) === 0)
      : [];
  const keepBasis: AppVersionOrphanResult['keepBasis'] =
    matched.length > 0 ? 'updater-evidence' : 'highest-only';
  // Ek kanitla eslesen surum en yuksek olmasa bile korunur: yarim
  // guncelleme dizini en yuksek olabilir; fiilen KULLANILAN korunur.
  const keep = keepBasis === 'updater-evidence' ? matched[0]! : candidates[0]!;

  const out: SubPart[] = [];
  for (const c of candidates) {
    if (c.path.toLowerCase() === keep.path.toLowerCase()) continue;
    const w = await measure.measure(c.path);
    if (w.bytes === 0) continue;
    if (keepBasis === 'updater-evidence') {
      out.push({
        path: c.path,
        bytes: w.bytes,
        label: `${c.name} — eski uygulama surumu`,
        verdictKind: 'recommend',
        reason: `Guncel surum dururken (${keep.name}; Update.exe surumu ${updaterVersion} ile dogrulandi) bu surum kullanilmaz`,
      });
    } else {
      // E6c: Ek kanit yok. Hangi surumun fiilen kullanildigini yalnizca
      // tahminle secemeyiz: "en yuksek" secim yarim guncelleme olabilir.
      out.push({
        path: c.path,
        bytes: w.bytes,
        label: `${c.name} — eski uygulama surumu (guncel surum dogrulanamadi)`,
        verdictKind: 'report-only',
        reason: `"${keep.name}" en yuksek surum dururken bu surum kullanilmayabilir; ancak guncel surum ek kanitla (Update.exe surumu, calisan surec, kayit girdisi) dogrulanamadi ve yarim guncelleme olasiligi var. Silme hedefi uretilmez; kanit bulunursa yeniden degerlendirilir`,
      });
    }
  }
  return { parts: out, keep: keep.name, keepBasis };
}

async function looksLikeElectronRuntime(dir: string): Promise<boolean> {
  const markers = [
    'resources\\app\\package.json',
    'icudtl.dat',
    'chrome_100_percent.pak',
    'ffmpeg.dll',
  ];
  for (const f of markers) {
    try {
      const st = await stat(longPath(`${dir}\\${f}`));
      if (st.isFile()) return true;
    } catch {
      /* yok */
    }
  }
  return false;
}

/** (E6b: Eski sayisal compareVersions kaldirildi; tek kaynak `semver.ts`.) */

/**
 * Bu dizin bir MODEL varyanti mi, yoksa bir CALISTIRMA SAGLAYICISI mi
 * (execution provider) mi?
 *
 * Ayrim isimden yapilamaz: "webgpu-ep" icinde "gpu" gecer ama WebGPU
 * saglayicisi CPU'da da calisabilir. Kesin ayrim: model agirligi dosyalari
 * (model.onnx, *.onnx.data, tokenizer.json) iceriyor mu?
 */
async function looksLikeModelDir(dir: string): Promise<boolean> {
  try {
    const ents = await readdir(longPath(dir), { withFileTypes: true, recursive: false });
    for (const e of ents) {
      if (e.isFile() && /^model\.onnx(\.data)?$|^tokenizer\.json$|^genai_config\.json$/i.test(e.name)) {
        return true;
      }
    }
    // Bir alt duzey daha (v1/ v2/ v4 klasorleri yaygin)
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      const sub = await readdir(longPath(`${dir}\\${e.name}`), { withFileTypes: true });
      for (const f of sub) {
        if (f.isFile() && /^model\.onnx(\.data)?$|^tokenizer\.json$|^genai_config\.json$/i.test(f.name)) {
          return true;
        }
      }
    }
  } catch {
    /* okunamadi */
  }
  return false;
}

/**
 * Agac icinde adi bir duzenli ifadeyle eslesen dizinleri dondurur.
 * Model varyantlari icin: "qwen2.5-0.5b-instruct-trtrtx-gpu-2" gibi
 * klasor adlari dosya adindan daha guvenilir bir isaret.
 *
 * E6a: Sinirli tarama SESSIZCE yarim kalmaz — `truncated: true` ile acik
 * bildirir. Cagran, yarim listeyi "kanit tam" saymamali ve silme Onerisi
 * uretmemelidir (bkz. `detectSubParts`).
 */
export interface DirScanResult {
  dirs: string[];
  /** Tarama siniri asildi mi (E6a: yarim kanit = tam kanit degil)? */
  truncated: boolean;
}

export async function findDirsNamed(
  root: string,
  maxDepth: number,
  nameRe: RegExp,
  maxDirs: number = 4000,
): Promise<DirScanResult> {
  const found: string[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  let visited = 0;

  while (queue.length > 0 && visited < maxDirs) {
    const { dir, depth } = queue.shift()!;
    visited++;
    if (depth >= maxDepth) continue;
    let ents;
    try {
      ents = await readdir(longPath(dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const child = `${dir}\\${e.name}`;
      // Kokten (depth 0) itibaren kontrol etme: ".MuhasibPro" gibi
      // kok adlar da eslesebilir, ilgilenmedigimiz yerler bunlar.
      if (depth >= 1 && nameRe.test(e.name)) found.push(child);
      queue.push({ dir: child, depth: depth + 1 });
    }
  }
  return { dirs: found.sort(), truncated: visited >= maxDirs && queue.length > 0 };
}

/**
 * Klasor agacinda, icinde "tetikleyici dosya" bulunan alt dizinleri
 * gercek yollariyla dondurur. Tahmin yok, olcum var.
 *
 * E6a: `truncated: true` dondenebilir; cagran bunu "kanit tam" sayarak
 * silme Onerisi uretmemelidir.
 */
export async function findDirsContaining(
  root: string,
  maxDepth: number,
  match: (fileName: string) => boolean,
  maxDirs: number = 6000,
): Promise<DirScanResult> {
  const found: string[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];

  let visited = 0;
  while (queue.length > 0 && visited < maxDirs) {
    const { dir, depth } = queue.shift()!;
    visited++;
    if (depth >= maxDepth) continue;

    let ents;
    try {
      ents = await readdir(longPath(dir), { withFileTypes: true });
    } catch {
      continue;
    }
    let hit = false;
    for (const e of ents) {
      if (e.isFile() && match(e.name)) hit = true;
      else if (e.isDirectory() && depth < maxDepth - 1) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        queue.push({ dir: `${dir}\\${e.name}`, depth: depth + 1 });
      }
    }
    if (hit) found.push(dir);
  }
  return { dirs: found, truncated: visited >= maxDirs && queue.length > 0 };
}

/**
 * Kume anahtari: ayni uygulamanin parcalarini birlestirmek icin.
 *
 * ONEMLI: Ayni isim Local ve Roaming'de varsa bunlar AYRI kumelerdir.
 * Ornek: Local\uv bir Python paket ONBELLEGI, Roaming\uv ise kurulu
 * Python surumlerinin KENDISI. Ikisini birlestirip "riskli" olani
 * guvenli olana tasimak, kullaniciya yanlis bilgi verir.
 * Birlestirme yalnizca AYNI kokun altinda yapilir.
 */
export function clusterKey(ev: Evidence, root: string): string {
  const scope = rootScope(root);
  if (ev.owner?.kind === 'packageJson') return `${scope}:pkg:${ev.owner.name.toLowerCase()}`;
  if (ev.owner?.kind === 'directoryName') {
    const n = ev.owner.name;
    // nokta ile baslayan gizli klasorler icin nokta haric
    return `${scope}:dir:${n.toLowerCase()}`;
  }
  if (ev.owner?.kind === 'logFile') return `${scope}:log:${ev.owner.product.toLowerCase()}`;
  const base = root.split('\\').filter(Boolean).pop() ?? 'root';
  return `${scope}:dir:${base.toLowerCase()}`;
}

/**
 * Yol sinir kontrolu: child, parent'a ESIT mi yoksa parent'in ALTINDA mi?
 *
 * startsWith tek basina yetmez (E7): parent `...\\Local` iken
 * `child.startsWith(parent)` kontrolu `...\\Local2` kardes dizinini de
 * parent altinda sayar. Bu yuzden eslesme ya tam esitlik ya da
 * `parent + '\\'` oneki olmalidir.
 *
 * Normalize: `\\?\` on eki (surucu harfli) atilir, egik cizgiler ters
 * cizgiye cevrilir, sonundaki ayiricilar dusulur, `.`/`..` parcalari
 * leksik (dosya sistemi gritmeden) cozulur; karsilastirma Windows
 * uyumlu olarak buyuk/kucuk harf duyarsizdir.
 */
function normalizeBoundary(p: string): string {
  let s = p.trim();
  if (/^\\\\\?\\[a-z]:/i.test(s)) s = s.slice(4);
  const segments = s.replace(/\//g, '\\').split('\\');
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('\\').toLowerCase();
}

function isPathInside(child: string, parent: string): boolean {
  const c = normalizeBoundary(child);
  const p = normalizeBoundary(parent);
  if (p === '' || c === '') return false;
  return c === p || c.startsWith(`${p}\\`);
}

/** Koke gore kapsam: home / local / roaming. */
function rootScope(root: string): string {
  const e = process.env;
  if (e.LOCALAPPDATA && isPathInside(root, e.LOCALAPPDATA)) return 'local';
  if (e.APPDATA && isPathInside(root, e.APPDATA)) return 'roaming';
  if (e.USERPROFILE && isPathInside(root, e.USERPROFILE)) return 'home';
  return 'other';
}

/**
 * Mimari tip tespiti. Sıralama onemli: daha guclu isaret once gelir.
 */
export function detectArchetype(
  ev: Evidence,
  root: string,
  extCounts: Map<string, number>,
  probe?: Probe,
): Archetype {
  const kinds = new Set(ev.fileKinds);
  const markers = new Set((ev.markers ?? []).map((m) => m.toLowerCase()));
  const logs = (ev.logSignals ?? []).map((s) => s.means).join(' | ');

  // 1. Gecici klasorler: buradaki HICBIR sey anlamli degildir.
  //    Tem klasorunde tesadufen bulunan bir cuDNN .dll dosyasi, klasoru
  //    "GPU runtime" yapmaz. Oyun/sifre verisi de olabilir.
  if (isTempPath(root)) return 'temp-scratch';

  // 2. Gercek sanal disk (WSL, docker, vm) -> asla otomatik silme
  if (kinds.has('wsl-disk')) return 'virtual-disk';

  // 3. SDK / runtime KURULUMU. Bunlar silinmez: proje derlemeleri
  //     bozulur. Ornek: ~/.dotnet 1.37 GB -> SDK, onbellek DEGIL.
  if (probe?.sdkInstall) return 'os-user-data';

  // 4. Editor uzanti deposu: extensions/ + extensions.json.
  //     Bu bir depodur; eski surumler ayri parca olarak secilir,
  //     klasorun tamami ASLA hedeflenmez. AI eklentileri model
  //     dosyasi tasisa bile birincil tip uzanti deposudur.
  if (probe?.editorExtensions) return 'editor-extension-store';

  // 5. Surumlu uygulama deposu: app-<surum> kardesleri + updater.
  //     Guncelleyici eski surumu birakabilir; yalnizca eski surum
  //     klasorleri hedeflenir, guncel surum korunur.
  if (probe?.appVersions) return 'versioned-app-store';

  // 6. Model deposu, CUDA'dan ONCE gelir.
  //    Onemli: .MuhasibPro gibi klasorlerde hem CUDA runtime hem model
  //    vardir. Birincil tip "model deposu" olmali; kullanilamayan CUDA
  //    parcasi alt parca olarak ayrica degerlendirilir. Aksi halde
  //    uygulamanin kullandigi CPU modelleri de silinebilir gorunur.
  //
  //    ANCAK: kaynak manifesti olan bir klasor (package.json / lockfile)
  //    ya da ajan calisma alani model dosyasi tasisa bile PROJE'dir.
  //    "models" adli bir alt klasor, kullanicinin veri klasorunu model
  //    deposu yapmaz; bu yuzden proje/ajan korumasi ONCE gelir.
  const agentWorkspace = markers.has('skill-store') || markers.has('skill-lock');
  const modelEvidence =
    kinds.has('onnx-model') || markers.has('models') || /model katalogu|model calistirma/i.test(logs);
  if (modelEvidence && !probe?.projectManifest && !agentWorkspace) return 'model-store';

  // 7. CUDA/cuDNN runtime yigini (model icermeyen)
  if (kinds.has('cuda-runtime')) return 'accelerator-runtime';

  // 8. AJAN CALISMA ALANI (kesin beceri kaniti): skills/*/SKILL.md veya
  //    beceri kilidi.
  //
  // Ajanlar eklenti bagimliliklarini (package.json + node_modules) ya da
  // Python ortamlarini KENDI klasorlerine kurabilir. Bu, klasoru "kullanici
  // projesi" yapmaz: plan ve beceri dosyalari kullanici degeridir. Bagimlilik
  // klasorleri alt parca olarak "yeniden uretilebilir" raporlanir; silme
  // hedefi URETILMEZ. (Proje koku ayrimi icin bkz. 12.)
  if (markers.has('skill-store') || markers.has('skill-lock')) return 'agent-workspace';

  // 9. Ortam HAVUZU, paket ONBELLEGI'nden once gelir.
  //    Ikisi de "paket" icerir ama riski farklidir: onbellek yeniden
  //    indirilir, sanal ortam yeniden DERLENIR ve projeyi bozabilir.
  //
  //    Log satiri TEK BASINA yetmez: herhangi bir uygulama gunlugu
  //    "jupyter", "kernel" ya da "pipe" sozcugu icerebilir. Yapisal kanit
  //    (envs/, runtimed/, pyvenv.cfg, site-packages) aranir.
  //
  //    C8b: kaynak manifesti olan bir kok (package.json, pyproject.toml,
  //    ...) venv / site-packages / pyvenv.cfg kanidi tasisa bile PROJE'dir;
  //    bu zayif havuz kanitlari tek basina kumu runtime-pool yapamaz.
  //    Karar 12'ye (proje calisma alani) kalir — ayni sinif hatasi
  //    6. adimda model-store icin duzeltilmisti. Guclu havuz kaniti
  //    (envs/, runtimed/) manifest olsa bile havuz sayilmaya devam eder.
  if (
    markers.has('envs') || markers.has('runtimed') ||
    (!probe?.projectManifest &&
      (kinds.has('python-env') || kinds.has('venv') || markers.has('site-packages')))
  ) {
    return 'runtime-pool';
  }

  // 10. PROJE ICI BAGIMLILIK KLASORU (T31).
  //
  // node_modules / .venv tek basina "global paket kurulumu" gibi gorunur.
  // Ust dizinde kaynak manifesti varsa bu, kullanicinin projesine ait bir
  // bagimlilik klasorudur; yeniden uretilebilirligi (lockfile, yama,
  // yerel yol bagimliligi) kanitla yazilir. Yine de silme hedefi URETILMEZ:
  // proje ici tarama zorunlu olarak rapor modudur (AGENTS kural 9).
  if (probe?.projectArtifact) return 'project-artifact';

  // 11. GLOBAL PAKET KURULUMU: komut shim'i + node_modules.
  //
  // npm prefix (or. %APPDATA%\\npm) node_modules + shim'ler icerir; bu
  // bir KURULUMDUR, onbellek DEGIL. Paket onbelleginden (14) ONCE
  // gelmeli: aksi halde global prefix yalnizca "cache" icerigiyle
  // gorundugu icin yanlis siniflanir.
  if (markers.has('node_modules') && (markers.has('shim-dir') || markers.has('.bin'))) {
    return 'global-packages';
  }

  // 12. PROJE CALISMA ALANI: kaynak manifesti + bagimlilik klasoru.
  //
  // Bu bir ARTIK DEGIL, kullanicinin kendi projesidir. Kaynak kod ve
  // bagimliliklar kullanici emegidir; hicbir kosulda silme hedefi
  // uretilmez (AGENTS kural 9). "package-lock.json var" tek basina
  // "onbellek" DEMEK DEGILDIR; ondan once bu kontrol gelir.
  if (
    probe?.projectManifest &&
    (markers.has('node_modules') || kinds.has('venv') || kinds.has('python-env') ||
      markers.has('site-packages') || markers.has('.venv') || markers.has('venv') ||
      markers.has('dist') || markers.has('build') || markers.has('target'))
  ) {
    return 'project-workspace';
  }

  // 13. Yalnizca node_modules/.bin (manifest yok): kurulu paketler.
  if (markers.has('.bin') || markers.has('node_modules')) return 'global-packages';

  // 14. Paket yoneticisi ONBELLEGI (yeniden indirilebilir, guvenli)
  //
  // CACHEDIR.TAG en guvenilir isaret: paket yoneticileri (npm, conda,
  // rattler, uv, pip) bu klasoru standart olarak "cache" olarak isaretler.
  if (
    markers.has('cachedir-tag') || markers.has('package-store') ||
    markers.has('_cacache') || /npm paket onbellegi/i.test(logs) ||
    markers.has('store') ||
    kinds.has('nuget-package') || /NuGet paket onbellegi/i.test(logs) ||
    markers.has('conda') || markers.has('pixi') ||
    probe?.vectorStore ||
    isPackageStoreDir(root, markers, extCounts)
  ) {
    return 'pkg-manager-cache';
  }

  // 15. Electron/Chromium masaustu uygulama verisi.
  //    Icerisinde hem yeniden uretilir onbellek hem kalici durum vardir
  //    (Local Storage, Preferences). Klasorun TAMAMI silinmez; sadece
  //    onbellek alt klasorleri hedeflenir.
  if (probe?.electronCache) return 'electron-app-data';

  // 16. Ajan calisma alani (oturum/hafiza marker'lari)
  //
  // Kesin beceri kaniti (SKILL.md / .skill-lock.json) 8. adimda
  // yakalandi; burada tekrar kontrol edilmez. Bu adim yalnizca
  // oturum/beceri/hafiza/ajan dizin MARKER'larina bakar: bunlar
  // "artik" degil, kullanicinin ajanla urettigi degerdir.
  //
  // E10b (C1): yalniz log satiri yetmez. Herhangi bir uygulama gunlugu
  // "notebook", "gunlendirme gunlugu" ya da "arka plan servisi" sozleri
  // icerebilir; log tek basina yapisal kanit degildir.
  if (
    markers.has('sessions') || markers.has('skills') ||
    markers.has('memories') || markers.has('agents')
  ) {
    return 'agent-workspace';
  }

  // 17. Guncelleyici artigi
  //    DIKKAT: her installer bir ARTIK degildir. Bir kurulum dizinindeki
  //    uygulama exe'leri de installer sayilir. Gercek artik, yolun
  //    kendisinin "updater" olmasidir.
  if (/-updater$|\\updater$/i.test(root)) return 'updater-staging';
  // Program Files / Programs altindaki exe'ler KURULUMDUR, artik degil
  if (/\\programs?\\|\\app-[^\\]+\\/i.test(root)) return 'os-user-data';

  // 18. Gecici / cokme
  if (kinds.has('crash-dump')) return 'crash-artifacts';

  // 19. Kullanici verisi sinyalleri (dokunma)
  if (kinds.has('vpn-config')) return 'os-user-data';

  void extCounts;
  return 'unknown';
}

/** Gecici klasor yolu mu? (env degiskenleri uzerinden de kontrol edilir; sinir kontrolu icin bkz. E7) */
function isTempPath(root: string): boolean {
  const temp = process.env.TEMP;
  return temp !== undefined && temp !== '' && isPathInside(root, temp);
}

/**
 * Paket deposu kalibi: cogu dosya tek bir paket turunden (nupkg, .tar.gz,
 * blob/indeks) ve karisik icerik yok. dizin adindan da anlasilir.
 */
function isPackageStoreDir(
  root: string,
  markers: Set<string>,
  extCounts: Map<string, number>,
): boolean {
  const base = root.split('\\').filter(Boolean).pop()?.toLowerCase() ?? '';
  // Ad, tek basina yalnizca PAKET DEPOSUNA OZGU adlar icin kanit sayilir.
  // "cache" gibi genel adlar BILEREK listede degil: her uygulama "cache"
  // klasoru kullanir ve kanitsiz silme hedefi uretirdi.
  if (/_cacache$|^packs$|^archives$|^pkgs$|^store$|^pnpm-store$/.test(base)) return true;
  if (markers.has('_cacache') || markers.has('cachedir-tag') || markers.has('store')) return true;

  // Uzanti dagilimi: tek tur baskin ise depo olabilir
  const total = [...extCounts.values()].reduce((a, b) => a + b, 0);
  if (total < 200) return false;
  const storeExts = ['nupkg', 'tgz', 'whl', 'gz', 'zip', 'conda', 'json'];
  const storeCount = storeExts.reduce((a, e) => a + (extCounts.get(e) ?? 0), 0);
  return storeCount / total > 0.85;
}

/**
 * Ne kadarinin gercekten silinebilecegini kestirir.
 * Dizenin tamamini silmek cogu zaman dogru degildir: ornek .MuhasibPro'da
 * 7.1 GB'nin sadece bir kismi gereksiz.
 */
export function estimateReclaimable(
  archetype: Archetype,
  totalBytes: number,
  extCounts: Map<string, number>,
  olderBytes?: Map<number, number>,
  gpu?: GpuEvidence,
): number {
  switch (archetype) {
    case 'pkg-manager-cache':
    case 'crash-artifacts':
      return totalBytes; // tamami yeniden uretilebilir
    case 'updater-staging':
      return totalBytes;
    case 'temp-scratch':
      // Hedef yalnizca 3 gunden eski dosyalar; tahmin de o kirilimdan gelir.
      return olderBytes ? (olderBytes.get(3) ?? 0) : 0;
    case 'accelerator-runtime':
      // Yalnizca cihazda GPU YOKSA (kanitla) tamami artik sayilir; GPU
      // varsa veya kanit yoksa (bilinmiyor) kullanici karar vermeli.
      return gpu != null && !gpu.hasNvidia ? totalBytes : 0;
    case 'virtual-disk':
      return 0; // ASLA otomatik
    case 'model-store':
      // Tum model deposu silinmez: CPU modelleri kullaniliyor olabilir.
      // Sadece altinda hesaplanan bilesik parcalar (GPU runtime/varyant)
      // temizlenebilir. Bu yuzden burada 0 doner.
      return 0;
    case 'editor-extension-store':
    case 'versioned-app-store':
      // Yalnizca artik kalmis alt klasorler (eski uzanti/uygulama
      // surumu) silinebilir; kok klasor hedeflenmez.
      return 0;
    case 'runtime-pool':
      // Hedef 90 gunden eski ortamlar.
      return olderBytes ? (olderBytes.get(90) ?? 0) : 0;
    case 'global-packages':
      // Global paket kurulumu bir ONBELLEK DEGILDIR; silmek kurulu
      // araclari ve PATH baglantilarini bozar.
      return 0;
    case 'project-workspace':
      // Kaynak projesi: bagimliliklar yeniden kurulabilir olsa da bu
      // kullanicinin emegidir ve varsayilan olarak hicbir sey hedeflenmez.
      return 0;
    case 'project-artifact':
      // Proje ici bagimlilik klasoru: rapor modunda gosterilir, silme
      // hedefi uretmez (AGENTS kural 9).
      return 0;
    case 'agent-workspace':
      // Oturum gecmisi, beceriler ve hafiza kullanici degeridir;
      // "bosta kalan bayt" gibi raporlanmasi yaniltici olur.
      return 0;
    case 'os-user-data':
    case 'unknown':
    case 'electron-app-data':
    default:
      // KANIT YOKSA TAHMIN DE YOK (E4). Eski varsayilan dal, log/db
      // sayisindan pozitif "geri kazanilabilir" uretiyordu; oysa karar
      // "silinmez" idi. Artik 0; gercek deger silme hedeflerinden gelir.
      void extCounts;
      return 0;
  }
}

/**
 * Mimari tip -> yeniden uretilebilirlik ekseni (T34).
 * Risk'ten BAGIMSIZDIR; onun yerine gecmez, ona ikinci boyut ekler.
 */
const REGENERABILITY: Record<Archetype, Regenerability> = {
  'pkg-manager-cache': 'regenerable',
  'temp-scratch': 'regenerable',
  'crash-artifacts': 'regenerable',
  'updater-staging': 'regenerable',
  'accelerator-runtime': 'regenerable',
  'runtime-pool': 'regenerable',
  'global-packages': 'regenerable',
  'model-store': 'regenerable',
  'editor-extension-store': 'unknown',
  'versioned-app-store': 'unknown',
  'electron-app-data': 'unknown',
  'agent-workspace': 'user-data',
  'project-workspace': 'user-data',
  'project-artifact': 'regenerable',
  'os-user-data': 'user-data',
  'virtual-disk': 'user-data',
  'unknown': 'unknown',
};

/** Mimari tip -> kanit guveni (T34). */
const CONFIDENCE: Record<Archetype, Confidence> = {
  'pkg-manager-cache': 'high',
  'temp-scratch': 'high',
  'crash-artifacts': 'high',
  'updater-staging': 'medium',
  'accelerator-runtime': 'medium',
  'runtime-pool': 'high',
  'global-packages': 'high',
  'model-store': 'medium',
  'editor-extension-store': 'high',
  'versioned-app-store': 'high',
  'electron-app-data': 'medium',
  'agent-workspace': 'medium',
  'project-workspace': 'high',
  'project-artifact': 'medium',
  'os-user-data': 'medium',
  'virtual-disk': 'high',
  'unknown': 'low',
};

/**
 * Kanitlari karara cevirir ve iki ekseni (yeniden uretilebilirlik +
 * guven) ekler. Icerideki karar mantigi decideBase'tedir.
 */
function decide(ctx: {
  archetype: Archetype;
  ev: Evidence;
  root: string;
  reclaimable: number;
  totalBytes: number;
  now: number;
  minAgeDays: number;
  allow?: SensitiveAllow;
  gpu?: GpuEvidence;
}): Verdict {
  const base = decideBase(ctx);
  let regenerability: Regenerability = REGENERABILITY[ctx.archetype] ?? 'unknown';
  let confidence: Confidence = CONFIDENCE[ctx.archetype] ?? 'low';

  if (ctx.archetype === 'pkg-manager-cache') {
    const ms = new Set((ctx.ev.markers ?? []).map((m) => m.toLowerCase()));
    const strongCache = ms.has('cachedir-tag') || ms.has('_cacache') || ms.has('store') || ms.has('package-store');
    // Vektor deposu yeniden uretilir ama yeniden indeksleme pahali olabilir.
    if (ms.has('vector-index')) confidence = 'medium';
    else if (!strongCache) confidence = 'medium';
  }

  // Proje ici bagimlilik (T31): yeniden uretilebilirlik KANITLA belirlenir.
  // Kilit dosyasi yoksa hangi surumlerin kurulacagi belirsizdir; bu yuzden
  // "yeniden uretilebilir" demek yerine "belirsiz" denir.
  if (ctx.archetype === 'project-artifact') {
    const ms = new Set(ctx.ev.markers ?? []);
    const hasLock = [...ms].some((m) => m.startsWith('lockfile:'));
    const caveat = ms.has('patched-deps') || ms.has('local-path-deps');
    if (hasLock) {
      regenerability = 'regenerable';
      confidence = caveat ? 'medium' : 'high';
    } else {
      regenerability = 'unknown';
      confidence = 'low';
    }
  }

  return { ...base, regenerability, confidence };
}

/** Karar mantigi (regenerability/confidence eklenmeden). */
function decideBase(ctx: {
  archetype: Archetype;
  ev: Evidence;
  root: string;
  reclaimable: number;
  totalBytes: number;
  now: number;
  minAgeDays: number;
  allow?: SensitiveAllow;
  gpu?: GpuEvidence;
}): Omit<Verdict, 'regenerability' | 'confidence'> {
  const { archetype, ev, root, reclaimable, totalBytes, now, minAgeDays, allow, gpu } = ctx;
  const name = displayName(ev, root);
  const age = daysSince(ev.lastTouched ?? 0, now);
  const because: string[] = [];
  const logs = ev.logSignals ?? [];

  const push = (s: string) => {
    if (!because.includes(s)) because.push(s);
  };

  for (const l of logs.slice(0, 4)) push(`${l.means}: "${l.line}"`);

  // ---- SANAL DISK: en riskli, sadece raporla ----
  if (archetype === 'virtual-disk') {
    return {
      risk: 'high',
      kind: 'report-only',
      title: `${name} — sanal disk (WSL / Docker / VM)`,
      what: 'Isletim sistemi veya dagitim sanal diski. Icerindeki tum Linux/VM verisi burada yasar.',
      consequence: 'SILINMEZ. WSL dagitimi veya sanal makine tamamen bozulur.',
      because: [...because, 'Icinde .vhdx/.vhd dosyasi tespit edildi'],
      preconditions: ['Bu siniftan hicbir sey otomatik silinmez'],
    };
  }

  // ---- HIZLANDIRICI RUNTIME: dongu/dongu kontrolu ile ----
  if (archetype === 'accelerator-runtime') {
    const cpuOnly = /CPUExecutionProvider|Device: CPU/i.test(
      logs.map((l) => l.line).join(' '),
    );
    const gpuDead = gpu != null && !gpu.hasNvidia;
    if (gpuDead) {
      push(`Bu makinede NVIDIA CUDA surucusu yok (${gpu!.note})`);
    }
    if (cpuOnly) {
      push('Loglar "Device: CPU / CPUExecutionProvider" diyor: GPU saglayicisi kaydedilmemis');
    }
    const unused = cpuOnly || gpuDead;
    return {
      risk: unused ? 'low' : 'medium',
      kind: unused ? 'recommend' : 'ask',
      title: `${name} — GPU hizlandirici runtime'i (kullanilamiyor)`,
      what: 'cuBLAS / cuDNN / ONNX Runtime CUDA DLL kumesi. Yapay zeka modelini GPUda calistirmak icin indirilir.',
      consequence: unused
        ? 'Bu makinede kullanilamiyor. Silmek model dosyalarina dokunmaz, sadece ileride GPU ile calistirmak istersen yeniden indirilir.'
        : 'Silmek, GPU hizlandirmasini bozar.',
      because,
      preconditions: ['Silmeden once kapatildigindan emin ol (calisan model varsa dosyalar kilitli kalir)'],
    };
  }

  // ---- MODEL DEPOSU ----
  if (archetype === 'model-store') {
    // T28: --nuke-models acikca verilmedikce TUM depo hedeflenmez.
    if (allow?.models) {
      return {
        risk: 'high',
        kind: 'ask',
        title: `${name} — TUM model deposu (--nuke-models)`,
        what: 'Indirilmis tum model agirliklari, tokenizer dosyalari ve calistirma kutuphaneleri.',
        consequence:
          'TUM model deposu silinecek. Modeller yeniden indirilir; bu saatler/gunler surebilir ve internet gerektirir. CPU modelleri de dahildir.',
        because: [...because, 'Kullanici --nuke-models bayragiyla acikca istedi'],
        preconditions: ['Uygulama kapali olmali', 'Yeniden indirme maliyetini goze al'],
      };
    }
    const cpuOnly = /Device: CPU|CPUExecutionProvider/i.test(logs.map((l) => l.line).join(' '));
    const gpuVariants = (ev.largeFiles ?? []).filter((f) => /gpu|cuda|trt/i.test(f.relPath));
    const gpuAbsent = gpu != null && !gpu.hasNvidia;
    const hasCuda = (ev.fileKinds ?? []).includes('cuda-runtime');

    const hasDeadGpu = hasCuda && (gpuAbsent || cpuOnly);
    const deadBytes = gpuVariants.reduce((a, b) => a + b.bytes, 0);

    if (hasDeadGpu || deadBytes > 0) {
      push(
        gpuAbsent
          ? 'Bu makinede NVIDIA CUDA surucusu yok; GPU modelleri calistirilamaz'
          : 'Loglar "Device: CPU / CPUExecutionProvider" diyor',
      );
      // Varyant sayisini SABIT bir yerden degil, olculmus alt
      // parcalardan al: buyuk dosya listesi kirpilmis olabilir.
      const subCount = (ev.markerSubpartCount ?? 0);
      if (subCount > 0) push(`${subCount} kullanilamayan GPU parcasi tespit edildi`);
      return {
        risk: 'low',
        kind: 'recommend',
        title: `${name} — yerel model deposu (yari silinebilir)`,
        what: 'Indirilmis yapay zeka model agirligi ve GPU calistirma kutuphaneleri. Uygulama bunlari yerel calistirmak icin saklar.',
        consequence: `Sadece kullanilamayan kisim temizlenir: GPU runtime${hasCuda ? ' ve GPU varyantli modeller' : ''}. CPU modellerine (uygulamanin gercekten kullandigi kismi) dokunulmaz.`,
        because,
        preconditions: ['Uygulama kapali olmali; dosyalar kilitliyse atlanir'],
      };
    }

    // Hepsi kullanilir durumda: silme
    return {
      risk: 'medium',
      kind: 'ask',
      title: `${name} — yerel model deposu`,
      what: 'Indirilmis model agirliklari ve tokenizer dosyalari. Yerel olarak calistirilir.',
      consequence: 'Tamamen silersen uygulama modelleri yeniden indirir (internet gerekir, saatler surebilir).',
      because: [...because, `Toplam ${totalBytes} bayt, kullanilabilir cihaz uyumu tespit edilemedi`],
      preconditions: ['Hangi modellerin kullanildigini bilmiyorsan silme'],
    };
  }

  // ---- PAKET ONBELLEGI: en guvenli ----
  if (archetype === 'pkg-manager-cache') {
    // Onbellek silmek KURULU BIR PAKETI BOZMAZ; yalnizca bir sonraki
    // kurulumda yeniden indirme gerektirir. Bu yuzden risk, "yeni
    // kullanildi" bilgisiyle YUKSELMEZ. Oncelik her zaman mimari
    // turden gelir; yas sadece aciklama metnini zenginlestirir.
    const fresh = age < 7;
    const mset = new Set((ev.markers ?? []).map((m) => m.toLowerCase()));
    // npm cacache duzeni: "_cacache" / "_npx" isaretleri kanittir.
    const npmManaged =
      mset.has('_cacache') || mset.has('_npx') || /npm paket onbellegi/i.test(logs.map((l) => l.means).join(' '));
    const isVector = mset.has('vector-index');

    // Vektor/embedding depolar: yeniden uretilir ama YENIDEN INDEKSLEME
    // (gomsu/embedding) pahali olabilir; bu yuzden "onerilen" degil,
    // kullaniciya sorulan bir karardir.
    if (isVector) {
      return {
        risk: 'medium',
        kind: 'ask',
        title: `${name} — vektor / embedding indeksi`,
        what: 'Vektor veritabani veya embedding onbellegi (indeks + gomsu dosyalari). Uygulama bunlari yerel arama/RAG icin uretir.',
        consequence:
          'Silinirse uygulama yeniden indeksleme yapar; bu islem uzun surebilir veya dis servis/kota gerektirebilir. Kaynak belgeler silinmez.',
        because: [
          ...because,
          'Vektor indeks dosyalari (faiss/lance/npy/parquet) veya sqlite + UUID klasor duzeni bulundu',
          `${formatAge(ev.lastTouched ?? 0, now)} son kullanildi`,
        ],
        preconditions: ['Uygulama kapali olmali', 'Yeniden indeksleme maliyetini (sure/kota) goze al'],
      };
    }

    return {
      risk: 'safe',
      kind: fresh ? 'ask' : 'recommend',
      title: `${name} — paket indirme onbellegi`,
      what: 'Paket yoneticisinin indirdigi arsiv ve indeks dosyalari. Kaynak kod degil, sadece "hizli kurulum" kopyasi.',
      consequence: npmManaged
        ? 'Silmek hicbir kurulu paketi bozmaz. Bir sonraki kurulumda paket yeniden indirilir (biraz yavas). Istenirse paket yoneticisinin kendi komutu da kullanilabilir.'
        : 'Silmek hicbir kurulu paketi bozmaz. Bir sonraki kurulumda paket yeniden indirilir (biraz yavas).',
      because: [
        ...because,
        `${formatAge(ev.lastTouched ?? 0, now)} son kullanildi`,
        'Icerik yeniden uretilebilir',
        ...(ev.cacheRoot
          ? [`Depo kokü: ${ev.cacheRoot} (silme hedefi yalnizca bu klasor)`]
          : []),
        ...(npmManaged ? ['npm onbellegi: butunluk icin "npm cache verify" de kullanilabilir'] : []),
        ...(fresh ? ['Cok guncel: bir sonraki kurulum biraz gecikebilir'] : []),
      ],
      preconditions: [
        ...(npmManaged
          ? ['npm/Node calismiyorken calistir', 'Guvenli alternatif: "npm cache verify" (butunluk + cop toplama)']
          : []),
        ...(ev.cacheRoot ? ['Uygulama klasoru korunur; yalnizca paket deposu silinir'] : []),
      ],
    };
  }

  // ---- AGENT CALISMA ALANI: oturum gecmisi var ----
  if (archetype === 'agent-workspace') {
    const markers = new Set(ev.markers ?? []);
    const history = markers.has('chat-history');
    const hasSkills = markers.has('skill-store') || markers.has('skill-lock');
    const hasPlan = markers.has('agent-plan');
    const hasDeps =
      markers.has('node_modules') || markers.has('venv') || markers.has('.venv') ||
      markers.has('site-packages');
    const hasSessions =
      hasSkills || hasPlan || [...markers].some((m) => /session|memory|chat/i.test(m));

    return {
      risk: allow?.history && history ? 'high' : 'medium',
      kind: 'ask',
      title: `${name} — AI ajan calisma alani`,
      what: hasSkills
        ? 'Ajanin beceri deposu, planlari ve eklenti bagimliliklari.'
        : 'Ajanin oturum gecmisi, becerileri, hafizasi ve onbellegi.',
      consequence: hasSkills
        ? 'SILMEZ: beceri ve plan dosyalari kullanici degeridir. Eklenti bagimliliklari yeniden kurulabilir; yine de silme hedefi uretilmez.'
        : hasSessions
          ? 'SILMEZ: eski oturumlar ve ogrenilmis beceriler kaybolur.'
          : 'Onbellek ve gunlukler silinir; ajan yeniden indirme yapar.',
      because: [
        ...because,
        ...(hasSkills ? ['SKILL.md / beceri kilidi kaniti'] : []),
        ...(hasPlan ? ['Plan dosyalari oturum kararlarini tasir (kullanici degeri)'] : []),
        ...(hasSkills && hasDeps
          ? ['Eklenti bagimliliklari (node_modules / ortam) yeniden kurulabilir; hedef uretilmez']
          : []),
        ...(allow?.history && history
          ? ['--clear-history: yalnizca sohbet/oturum klasorleri hedeflenir']
          : []),
      ],
      preconditions: [
        hasSkills ? 'Beceri ve plan dosyalari her durumda korunur' : 'Ajanin kapali oldugundan emin ol',
        ...(allow?.history && history ? ['Sohbet gecmisi geri gelmez; once yedekle'] : []),
      ],
    };
  }

  // ---- PROJE CALISMA ALANI: kullanici emegi, dokunma ----
  //
  // Icerisinde kaynak manifesti + bagimlilik klasoru var. Bu bir
  // "artik" degil, kullanicinin projesidir. Proje ici artiklar
  // (node_modules, .venv, dist) yalnizca `--root` + rapor modunda
  // gosterilir; sistem taramasinda HICBIR silme hedefi uretilmez.
  if (archetype === 'project-workspace') {
    return {
      risk: 'high',
      kind: 'report-only',
      title: `${name} — proje calisma alani`,
      what: 'Kaynak manifesti (package.json / pyproject.toml ...) ve bagimlilik klasoru (node_modules / .venv / dist). Kullanici projesi.',
      consequence:
        'SILINMEZ. Bagimliliklar yeniden kurulabilir ama kaynak kod ve yerel degisiklikler geri gelmez. Proje ici artiklari gormek icin "Projeyi Tara" (--root) kullanin.',
      because: [
        ...because,
        'Kaynak manifesti + bagimlilik klasoru birlikte bulundu',
        'Proje ici tarama zorunlu olarak salt rapordur',
      ],
      preconditions: ['Bu siniftan hicbir sey otomatik silinmez'],
    };
  }

  // ---- PROJE ICI BAGIMLILIK KLASORU (T31) ----
  //
  // node_modules / .venv, ust dizindeki manifest nedeniyle "projeye ait"
  // kabul edilir. Yeniden uretilebilirlik lockfile ile kanitlanir; yine de
  // silme hedefi URETILMEZ (proje ici tarama rapor modudur).
  if (archetype === 'project-artifact') {
    const ms = new Set(ev.markers ?? []);
    const lock = [...ms].find((m) => m.startsWith('lockfile:'))?.slice('lockfile:'.length);
    const patches = ms.has('patched-deps');
    const local = ms.has('local-path-deps');
    const py = ms.has('project-deps:python');
    const kindName = py ? 'Python sanal ortami' : 'node_modules';
    return {
      risk: 'low',
      kind: 'report-only',
      title: `${name} — proje bagimlilik klasoru`,
      what: `${kindName}. Kaynak kod DEGIL; proje manifesti ve kilit dosyasindan yeniden kurulabilen paketler.`,
      consequence: lock
        ? `SILINMEZ (proje taramasi rapor modu). Silinirse "${lock}" ile birebir yeniden kurulur; internet veya ozel paket kaynagi gerekebilir.`
        : 'SILINMEZ (proje taramasi rapor modu). Kilit dosyasi yok: yeniden kurulumda paket surumleri degisebilir.',
      because: [
        ...because,
        `Ust dizinde kaynak manifesti (${py ? 'pyproject.toml / requirements.txt' : 'package.json'}) bulundu`,
        lock ? `Kilit dosyasi: ${lock} (birebir yeniden kurulum)` : 'Kilit dosyasi yok (surumler sabit degil)',
        ...(patches ? ['Yamali bagimliliklar (patches/) tespit edildi'] : []),
        ...(local ? ['Yerel yol bagimliligi (file:/link:/workspace:) tespit edildi'] : []),
        `${formatAge(ev.lastTouched ?? 0, now)} son dokunuldu`,
      ],
      preconditions: [
        'Proje ici tarama rapor modudur; silme hedefi uretilmez',
        ...(patches ? ['Yamalarin yeniden uygulanmasi gerekir'] : []),
        ...(local ? ['Yerel paket yollari proje disinda da mevcut olmali'] : []),
      ],
    };
  }

  // ---- GLOBAL PAKET KURULUMU: silinmez ----
  //
  // Buradaki node_modules/.bin bir "onbellek" degil, KURULU ARAclarin
  // kendisidir. Klasoru silmek komutlari PATH'te baglantisiz birakir;
  // dogru islem paket yoneticisinin uninstall akisidir.
  if (archetype === 'global-packages') {
    return {
      risk: 'high',
      kind: 'report-only',
      title: `${name} — global paket kurulumu`,
      what: 'Kurulu CLI araclarinin kendisi (komut dosyalari, paket klasorleri, baglantilar). Onbellek degil, kurulum.',
      consequence:
        'SILINMEZ. Klasoru silmek komutlari PATH uzerinde baglantisiz birakir; arac kaldirilmis gibi gorunur ama kalintilari farkli yerlerde kalir.',
      because: [...because, 'node_modules / .bin yapisi bulundu (kurulum, onbellek degil)'],
      preconditions: [
        'Kaldirmak icin paket yoneticisinin uninstall komutunu kullan',
        'Once hangi komutlarin buna bagli oldugunu kontrol et',
      ],
    };
  }

  // ---- RUNTIME HAVUZU ----
  if (archetype === 'runtime-pool') {
    // Ortam havuzunda risk SABIT: silmek projeleri bozabilir. Yalnizca
    // "silme hedefi" yasla kisitlanir (90 gun). Risk, guncellige gore
    // degismez — cunku bir "belirsizlik" degil, "yapisal risk"tir.
    return {
      risk: 'medium',
      kind: 'ask',
      title: `${name} — Python/Node ortam havuzu`,
      what: 'Onceden derlenmis yorumlayici ortamlari (conda / pixi / uv / sanal ortam). Kaynak kod DEGIL, derlenmis ortam kopyalari.',
      consequence: 'Silmek calisan projeleri bozabilir; ortamlar yeniden kurulur ve bu dakikalar/gunler surebilir.',
      because: [...because, `Son kullanma: ${formatAge(ev.lastTouched ?? 0, now)}`],
      preconditions: [
        'Bu ortamlara bagli calisan bir is olmadigindan emin ol',
        'Yalnizca 90 gunden eski ortamlar hedeflenir; yenileri korunur',
      ],
    };
  }

  // ---- EDITOR UZANTI DEPOSU ----
  //
  // Kurulu uzantilar bir "kurulum"dur; klasorun tamami SILINMEZ.
  // Yalnizca editorun artik dedigi (extensions.json / .obsolete ile
  // dogrulanan) eski surum klasorleri hedeflenir.
  if (archetype === 'editor-extension-store') {
    const count = ev.markerSubpartCount ?? 0;
    return {
      risk: 'low',
      kind: count > 0 ? 'recommend' : 'report-only',
      title: `${name} — editor uzanti deposu`,
      what: 'Kurulu uzantilar ve surumleri. Editor her guncellemede eski surumu diskte birakabilir.',
      consequence:
        count > 0
          ? `Yalnizca artik kalmis ${count} uzanti surumu silinir; aktif surumler ve ayarlar korunur.`
          : 'Silinecek eski uzanti surumu bulunamadi; hicbir sey hedeflenmedi.',
      because: [
        ...because,
        count > 0
          ? `${count} kullanilmayan uzanti surumu tespit edildi`
          : 'Tum uzanti surumleri aktif kayitli',
      ],
      preconditions: [
        'Editor kapali olmali',
        'Elle kurulmus uzantilar da yeniden kurulabilir; listeyi gozden gecir',
      ],
    };
  }

  // ---- SURUMLU UYGULAMA DEPOSU ----
  //
  // Guncelleyiciler yeni surumu yanina acar. En guncel surum korunur;
  // eski app-<surum> klasorleri ayri parca olarak hedeflenir.
  if (archetype === 'versioned-app-store') {
    const count = ev.markerSubpartCount ?? 0;
    return {
      risk: 'low',
      kind: count > 0 ? 'recommend' : 'report-only',
      title: `${name} — cok surumlu uygulama deposu`,
      what: 'Guncelleyicinin actigi surum klasorleri (app-<surum>). Guncelleme sonrasi eski surum diskte kalabilir.',
      consequence:
        count > 0
          ? `Yalnizca eski ${count} surum klasoru silinir; uygulamanin kullandigi guncel surum ve ayarlar korunur.`
          : 'Tek surum var (guncel); silinecek eski surum bulunamadi.',
      because: [
        ...because,
        count > 0 ? `${count} eski surum klasoru tespit edildi` : 'Eski surum klasoru bulunamadi',
      ],
      preconditions: ['Uygulama kapali olmali'],
    };
  }

  // ---- KULLANICI VERISI: dokunma ----
  if (archetype === 'os-user-data') {
    return {
      risk: 'high',
      kind: 'report-only',
      title: `${name} — kullanici verisi`,
      what: 'Sifreler, VPN ayarlari, oturum bilgileri veya oyun kayitlari.',
      consequence: 'SILINMEZ. Silmek hesaplari ve ayarlari sifirlar.',
      because: [...because, 'Yapilandirma/hesap dosyasi tespit edildi'],
      preconditions: ['Bu siniftan hicbir sey otomatik silinmez'],
    };
  }

  // ---- ELECTRON MASAUSTU UYGULAMA ----
  if (archetype === 'electron-app-data') {
    const cacheMarkers = (ev.markers ?? []).filter((m) =>
      /^(Cache|Code Cache|GPUCache|DawnCache|DawnGraphiteCache|DawnWebGPUCache|ShaderCache|GrShaderCache|blob_storage|Service Worker|CacheStorage|Crashpad|logs)$/i.test(m),
    );
    return {
      risk: 'safe',
      kind: 'recommend',
      title: `${name} — masaustu uygulama onbellegi`,
      what: 'Electron/Chromium tabanli bir uygulamanin verisi. Icerinde hem yeniden uretilir onbellek hem de ayarlar ve oturum durumu var.',
      consequence: `Sadece onbellek klasorleri (${cacheMarkers.slice(0, 4).join(', ')}) temizlenir. Ayarlar, oturumlar ve yerel veri KORUNUR.`,
      because: [
        ...because,
        `${cacheMarkers.length} onbellek klasoru tespit edildi`,
        'Chromium onbellegi yeniden uretilir, veri kaybi olmaz',
      ],
      preconditions: ['Uygulama kapali olmali'],
    };
  }

  // ---- GECICI DOSYALAR ----
  if (archetype === 'temp-scratch') {
    // Sadece yasli dosyalar: 3 gunden eski gecici dosya zaten ise yaramaz,
    // yeniden kullanilmaz. Yeni dosyalar (aktif kurulum/indirme) korunur.
    return {
      risk: 'safe',
      kind: 'recommend',
      title: `${name} — gecici dosyalar`,
      what: 'Kurulum, guncelleme ve uygulamalarin biraktigi gecici dosyalar. Amacindan sonra bosaltilmamis olabilir.',
      consequence: 'Yalnizca 3 gunden eski dosyalar temizlenir; kullanilabilir gecici dosyalara dokunulmaz. Calisan bir kurulum varsa dosyalar kilitlidir ve atlanir.',
      because: [...because, `Son kullanma: ${formatAge(ev.lastTouched ?? 0, now)}`],
      preconditions: ['Aktif kurulum/indirme surerken calistirma'],
    };
  }

  // ---- COKME DOKUMLERI ----
  if (archetype === 'crash-artifacts') {
    return {
      risk: 'safe',
      kind: 'recommend',
      title: `${name} — cokme dokumleri`,
      what: 'Coken uygulamalarin bellek/veri dokumleri. Yalnizca hata ayiklama icin.',
      consequence: 'Silmek uygulamayi etkilemez. Geçmiş hatalari analiz edemezsin.',
      because: [...because, '.dmp/.mdmp dosyasi bulundu'],
      preconditions: [],
    };
  }

  // ---- GUNCELLEYICI ARTIKLARI ----
  if (archetype === 'updater-staging') {
    return {
      risk: 'safe',
      kind: 'recommend',
      title: `${name} — guncelleyici artigi`,
      what: 'Guncelleme icin indirilmis paket. Kurulum zaten yapildiysa bu klasor bos kalir.',
      consequence: 'Silmek guncellemeyi etkilemez; guncelleme yeniden indirir.',
      because: [...because, 'Klasor adi guncelleyici olarak isaretli'],
      preconditions: [],
    };
  }

  // ---- YAS POLITIKASI ----
  if (minAgeDays > 0 && age < minAgeDays) {
    return {
      risk: 'low',
      kind: 'report-only',
      title: `${name} — ${formatAge(ev.lastTouched ?? 0, now)} kullanildi`,
      what: 'Yeni kullanilmis bir klasor.',
      consequence: `${minAgeDays} gunluk yas filtresi: silinmedi, sadece raporlandi.`,
      because,
      preconditions: [],
    };
  }

  // ---- BILINMEYEN: kanit yetersiz ----
  return {
    risk: 'medium',
    kind: 'ask',
    title: `${name} — tanimlanamayan klasor`,
    what: 'Icerigi incelendi ama anlamli bir tur isareti bulunamadi.',
    consequence: 'Silmeden once `residue explain` ile incele.',
    because: [...because, `Toplam ${totalBytes} bayt, ${(ev.markers ?? []).length} isaret`],
    preconditions: ['Kanit yetersiz: elle dogrula'],
  };
}

/** Goruntulenecek baslik icin en iyi isim. */
export function displayName(ev: Evidence, root: string): string {
  if (ev.owner?.kind === 'packageJson') {
    const scope = ev.owner.name.includes('/') ? ev.owner.name.split('/')[1] : ev.owner.name;
    return scope ?? ev.owner.name;
  }
  if (ev.owner?.kind === 'logFile') return ev.owner.product;
  if (ev.owner?.kind === 'binaryProduct') return ev.owner.product;
  const base = root.split('\\').filter(Boolean).pop() ?? 'root';
  return base.replace(/^\./, '') || base;
}

/** Tekrarlanan log sinyallerini indirger (TUI kalabaliklasin diye). */
function dedupeLogSignals<T extends { means: string }>(signals: T[]): T[] {
  const byMeans = new Map<string, T>();
  for (const s of signals) {
    if (!byMeans.has(s.means)) byMeans.set(s.means, s);
  }
  return [...byMeans.values()].slice(0, 6);
}

// E10c: Modul duzeyi GPU globalleri KALDIRILDI. GPU kaniti
// ClassifyOptions.gpu alani (UCLU durum) ile parametre olarak gecer;
// iki classifyPath cagrisi birbirinin durumunu tasmaz.

export { ownerFromName };