import { lstat, rename, rm, stat, readdir } from 'node:fs/promises';
import { lstatSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { longPath, isDenied, isLongPathError } from '../util/longpath.ts';
import { debug, error as logError, info, warn } from '../util/log.ts';
import type { DeleteTarget, Cluster, SensitiveAllow } from '../core/types.ts';
import { assertSafeTarget } from './guard.ts';
import { gitTrackerFor } from '../core/git.ts';
import { isOwnDataPath } from '../core/discover.ts';
import { moveIntoVault, newVaultBatch } from './vault.ts';

/**
 * Silme katmani.
 *
 * Guvenlik ilkeleri:
 *  1. Hicbir sey dogrudan KALICI silinmez varsayilan olarak.
 *  2. Silmeden once yol KILIT MI kontrol edilir (atomik rename denemesi).
 *  3. Her islem gunluklenir (journal) -> undo mumkun.
 *  4. 'older' hedeflerinde yas filtresi DOSYA bazinda uygulanir;
 *     yeni dosyalar korunur.
 */

export type DeleteMode = 'recycle' | 'purge';

export type RiskLevel = 'safe' | 'low' | 'medium' | 'high';

/**
 * Silme plani: onay ekraninda gosterilecek butun butunluk.
 * Silme ancak plan onaylandiktan sonra yurutulur.
 */
export interface PlannedTarget {
  target: DeleteTarget;
  bytes: number;
}

export interface PlannedCluster {
  /**
   * Kume anahtari. Plan ekraninda "plandan cikar" isleminde hangi kumenin
   * cikarildigini TUTARLI secmek icin gereklidir (basliga gore eslestirme
   * kirilgandir).
   */
  key: string;
  title: string;
  reason: string;
  risk: RiskLevel;
  /** Kume icindeki hedeflerin toplam bayti (motor hesaplar). */
  bytes: number;
  targets: PlannedTarget[];
}

export interface DeletePlan {
  mode: DeleteMode;
  clusters: PlannedCluster[];
  targets: PlannedTarget[];
  totalBytes: number;
}

/**
 * T28: bir kume hangi hassas sinifa ait? Hedefleri varsa bile ilgili
 * bayrak verilmedikce plana ALINMAZ.
 */
function requiredFlag(c: Cluster): keyof SensitiveAllow | null {
  const m = new Set((c.evidence.markers ?? []).map((x) => x.toLowerCase()));
  if (m.has('vector-index')) return 'models';
  if (m.has('chat-history')) return 'history';
  if (m.has('rules-files')) return 'rules';
  return null;
}

/** Kume risk seviyesine gore onay planina cevrilir. */
const ADVANCED_EXCLUDED_ARCHETYPES = new Set([
  'virtual-disk',
  'project-workspace',
  'project-artifact',
  'agent-workspace',
  'os-user-data',
]);

export function buildPlan(
  clusters: Cluster[],
  mode: DeleteMode,
  only?: string[],
  allow?: SensitiveAllow,
  advanced = false,
): DeletePlan {
  const f = only?.map((o) => o.toLowerCase());

  const planned: PlannedCluster[] = [];
  let total = 0;

  for (const c of clusters) {
    if (!advanced && (c.verdict.kind === 'report-only' || c.verdict.kind === 'keep')) continue;
    // T28: hassas siniflar yalnizca acik bayrakla plana girer.
    const need = requiredFlag(c);
    if (need && !allow?.[need]) continue;
    if (f && f.length > 0) {
      const hit = f.some(
        (o) => c.key.toLowerCase().includes(o) || c.title.toLowerCase().includes(o),
      );
      if (!hit) continue;
    }

    // Gelismis mod: istisna archetype'lar HICBIR kosulda hedef uretmez.
    if (advanced && ADVANCED_EXCLUDED_ARCHETYPES.has(c.archetype)) continue;

    let targets: DeleteTarget[] = [];
    if (advanced) {
      const existing = (c.deleteTargets ?? []).filter((t) => t.bytes > 0);
      if (existing.length > 0) {
        for (const t of existing) {
          try {
            assertSafeTarget(t);
            targets.push(t);
          } catch {
            /* guvenlik reddi: hedef atlanir */
          }
        }
      } else {
        // Hedef listesi bos: parcalardan uret.
        for (const part of c.parts ?? []) {
          if (!part || !part.path) continue;
          if (isOwnDataPath(part.path)) continue;
          // Reparse point parcalari atlanir.
          try {
            const st = lstatSync(longPath(part.path));
            if (st.isSymbolicLink()) continue;
          } catch (err) {
            // Yol yoksa (ENOENT) reparse point degildir; plana girebilir.
            // Diger erisim hatalarinda guvenli tarafta kal: atla.
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') continue;
          }
          const t: DeleteTarget = {
            path: part.path,
            kind: 'whole',
            label: `${basename(part.path)} — gelişmiş hedef`,
            bytes: part.bytes,
          };
          if (t.bytes <= 0) continue;
          try {
            assertSafeTarget(t);
          } catch {
            continue;
          }
          targets.push(t);
        }
      }
      if (targets.length === 0) continue;
    } else {
      targets = (c.deleteTargets ?? []).filter((t) => t.bytes > 0);
      if (targets.length === 0) continue;
      // Guvenlik kapisi: korunan yollarin atasi olan hedefler plana
      // hicbir zaman girmez. Kontrol burada, kullanici onayindan ONCE.
      for (const t of targets) assertSafeTarget(t);
    }

    const bytes = targets.reduce((a, t) => a + t.bytes, 0);
    planned.push({
      key: c.key,
      title: c.title,
      reason: c.verdict.consequence,
      bytes,
      risk: c.verdict.risk,
      targets: targets.map((t) => ({ target: t, bytes: t.bytes })),
    });
    total += bytes;
  }

  return {
    mode,
    clusters: planned,
    targets: planned.flatMap((p) => p.targets),
    totalBytes: total,
  };
}

export interface DeleteResult {
  target: DeleteTarget;
  removed: number;
  bytesFreed: number;
  skipped: Array<{ path: string; reason: string }>;
  failed: Array<{ path: string; reason: string }>;
}

export interface JournalEntry {
  at: number;
  mode: DeleteMode;
  action: 'deleted' | 'skipped' | 'failed';
  path: string;
  bytes: number;
  reason?: string;
}

/**
 * Sembolik bag veya junction (reparse point) mi?
 *
 * KRITIK: boyle bir yolun "icerigi" hedef klasordur. Silme islemi
 * hedefi degil, bagin kendisini kaldirmali — hatta en guvenlisi hic
 * dokunmamaktir. `npm link`, `pnpm` ve gelistirici kurulumlari bunu
 * yaygin kullanir; yanlis davranis BASKA bir projenin kodunu siler.
 */
async function isReparsePoint(path: string): Promise<boolean> {
  try {
    return (await lstat(longPath(path))).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Hedefe giden yolun herhangi bir ust klasoru junction/symlink mi?
 *
 * Lexical guard bir junction uzerinden BASKA bir dizini hedefleyebilir.
 * Boyle bir yolda silme yapmak, kullanicinin gormedigi bir yeri siler;
 * bu yuzden ust zincirde reparse point varsa hedef atlanir.
 */
async function reparseAncestor(path: string): Promise<string | null> {
  let cur = dirname(resolve(path));
  for (let i = 0; i < 64; i++) {
    const up = dirname(cur);
    if (up === cur) return null;
    try {
      if ((await lstat(longPath(cur))).isSymbolicLink()) return cur;
    } catch (err) {
      // Ust klasor yoksa hedef de yoktur: silme asamasinda "yok" olarak
      // raporlanir. Erisim hatasinda ise "reparse degil" varsayimi
      // yapmamak icin atlanir.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      return cur;
    }
    cur = up;
  }
  return null;
}

/** Klasor kilit mi? Atomik rename dener (dosya sistemi bunu garantiler). */
export async function isLocked(path: string): Promise<boolean> {
  const tmp = `${path}.residue-locktest-${Date.now()}`;
  try {
    await rename(longPath(path), longPath(tmp));
    // basarili: geri al
    await rename(longPath(tmp), longPath(path));
    return false;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') return true;
    void isDenied(err);
    void isLongPathError(err);
    return false;
  }
}

/**
 * Bir silme hedefini isler.
 *
 * kind='whole'  -> klasorun tamami
 * kind='older'  -> yalnizca minAgeDays eski dosyalar
 *
 * Geri donusum modunda: butun dosyalar tek tek geri donusum kutusuna
 * gonderilir. Boylece kota asilirsa yalnizca bir kismi tasinir,
 * hicbir sey kalici silinmez.
 */
export async function deleteTarget(
  target: DeleteTarget,
  mode: DeleteMode,
  now = Date.now(),
): Promise<DeleteResult> {
  // Savunma katmani: buildPlan'i atlayan dogrudan cagrilar da korunur.
  assertSafeTarget(target);

  try {
    await lstat(longPath(target.path));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        target,
        removed: 0,
        bytesFreed: 0,
        skipped: [{ path: target.path, reason: 'yol artik yok (plan bayat)' }],
        failed: [],
      };
    }
  }

  const ancestor = await reparseAncestor(target.path);
  if (ancestor) {
    return {
      target,
      removed: 0,
      bytesFreed: 0,
      skipped: [
        {
          path: target.path,
          reason: `ust klasor junction/symlink: ${ancestor} (hedef korunur)`,
        },
      ],
      failed: [],
    };
  }

  const res: DeleteResult = { target, removed: 0, bytesFreed: 0, skipped: [], failed: [] };

  // Git farkindaligi (T27): tek depo cozumu + bellekteki kume.
  // Dosya basina yukari yurume veya git sureci BASLATILMAZ.
  const git = gitTrackerFor(target.path);
  if (target.kind === 'whole' && git.isTrackedAnyUnder(target.path)) {
    res.skipped.push({ path: target.path, reason: 'git tarafindan takip ediliyor (tracked)' });
    return res;
  }

  // Sembolik bag / junction: hedefi degil bagin kendisini silmek
  // gerekir; en guvenlisi hic dokunmamaktir. npm link ile bagli bir
  // kaynak projenin kodu bu yolla korunur.
  if (await isReparsePoint(target.path)) {
    res.skipped.push({ path: target.path, reason: 'sembolik bag/junction (hedef korunur)' });
    return res;
  }

  if (target.kind === 'whole') {
    const measured = await measureTree(target.path);
    const w = measured.bytes;

    info('hedef isleniyor', {
      path: target.path,
      mode,
      sizeMB: Math.round(w / 1048576),
    });

    if (mode === 'purge') {
      try {
        await rm(longPath(target.path), { recursive: true, force: true, maxRetries: 3 });
        // Sayaclar YALNIZCA basarili rm'den sonra guncellenir. Aksi
        // halde basarisiz bir silme "yer kazanildi" gibi raporlanirdi.
        res.bytesFreed = w;
        res.removed = 1;
        info('kalici silindi', { path: target.path, bytes: w });
      } catch (err) {
        logError('kalici silme basarisiz', { path: target.path, err: describe(err) });
        res.failed.push({ path: target.path, reason: describe(err) });
      }
      return res;
    }

    // Kasa modu: sayaclar tasima basarili olduktan sonra artar.
    try {
      const batch = await newVaultBatch();
      await moveIntoVault(batch, target.path, w, measured.files || 1);
      res.bytesFreed = w;
      res.removed = 1;
      info('kasaya tasindi', { path: target.path, bytes: w, batch: batch.id });
    } catch (err) {
      const msg = describe(err);
      logError('kasaya tasinamadi', { path: target.path, err: msg });
      res.failed.push({ path: target.path, reason: `${msg} — kasa tasima basarisiz` });
      res.bytesFreed = 0;
      res.removed = 0;
    }
    return res;
  }

  // --- 'older': yas filtresi ---
  // 116.956 dosya oldugu icin BURADA dosya basina surec acilmaz.
  // Tek geri donusum surecu kullanilir ve dosyalar tek tek akitilir.
  const minMs = (target.minAgeDays ?? 0) * 86400_000;
  const files = await collectFiles(target.path);

  // Once yas filtresi: yalnizca hedeflenen dosyalar
  const eligible: Array<{ path: string; size: number }> = [];
  for (const f of files) {
    try {
      const st = await lstat(longPath(f));
      // Reparse point: boyutu/mtime'i HEDEFE ait olur; silmek de
      // hedefi etkileyebilir. Dokunulmaz.
      if (st.isSymbolicLink()) {
        res.skipped.push({ path: f, reason: 'sembolik bag/junction (hedef korunur)' });
        continue;
      }
      if (git.isTracked(f)) {
        res.skipped.push({ path: f, reason: 'git tarafindan takip ediliyor (tracked)' });
        continue;
      }
      // minAgeDays: 0 "yas filtresi yok" demektir. Kosulu `minMs > 0` ile
      // sinirlamak gerekir: Windows dosya zaman damgasi saat tikine
      // yuvarlandigi icin yeni yazilan bir dosyanin mtime'i Date.now()'dan
      // birkac ms ILERIDE kalabilir; bu durumda `now - mtime` negatif olur
      // ve dosya yanlislikla "cok yeni" sayilirdi.
      if (minMs > 0 && now - st.mtimeMs < minMs) {
        res.skipped.push({ path: f, reason: 'cok yeni' });
        continue;
      }
      eligible.push({ path: f, size: st.size });
    } catch {
      /* erisilemedi */
    }
  }

  if (eligible.length === 0) return res;

  if (mode === 'purge') {
    // Kalici silme: dogrudan rm, surec gerekmez (cok daha hizli)
    const CONC = 16;
    for (let i = 0; i < eligible.length; i += CONC) {
      await Promise.all(
        eligible.slice(i, i + CONC).map(async (e) => {
          try {
            await rm(longPath(e.path), { force: true, maxRetries: 1 });
            res.bytesFreed += e.size;
            res.removed++;
          } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
              res.skipped.push({ path: e.path, reason: 'dosya kilitli (uygulama acik)' });
            } else {
              res.failed.push({ path: e.path, reason: describe(err) });
            }
          }
        }),
      );
    }
    return res;
  }

  // Kendi kasamiz: her dosya tek tek tasinir (yas filtresi zaten uygulandi).
  let batch: Awaited<ReturnType<typeof newVaultBatch>> | null = null;
  try {
    batch = await newVaultBatch();
  } catch (err) {
    res.failed.push({ path: target.path, reason: `kasa olusturulamadi: ${describe(err)}` });
    return res;
  }
  for (const e of eligible) {
    try {
      await moveIntoVault(batch, e.path, e.size, 1);
      res.bytesFreed += e.size;
      res.removed++;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
        res.skipped.push({ path: e.path, reason: 'dosya kilitli (uygulama acik)' });
      } else {
        res.failed.push({ path: e.path, reason: describe(err) });
      }
    }
  }
  return res;
}

/**
 * GERI DONUSUM KUTUSUNA TOPLU TASIMA.
 *
 * Kritik tasarim karari: Dosya BASINA PowerShell sureci baslatmak
 * performans olarak felakettir. 116.956 dosyalik bir klasorde bu
 * 117.000 kez `powershell.exe` demektir — saatlerce surer ve
 * surec sifiri birakir.
 *
 * Cozum: TEK bir PowerShell sureci baslatilir ve dosyalar oraya
 * stdin uzerinden akitilir. Tek baslatma, N dosya.
 */
export class RecycleBin {
  private child: ChildProcess | null = null;
  private queue: string[] = [];
  private pending = new Map<string, { ok: boolean; reason: string }>();
  private ready = false;
  private starting: Promise<void> | null = null;

  private async ensureStarted(): Promise<void> {
    if (this.child && this.ready) return;
    if (this.starting) return this.starting;

    this.starting = (async () => {
      const { spawn } = await import('node:child_process');

      // DIKKAT: PowerShell'in ReadLine ciktisi "\r\n" ile gelir.
      // Ayirici olarak '\n' kullanmak yeterlidir ama tampon temizligi
      // icin '\r' de atilir.
      const script = [
        "$ErrorActionPreference = 'Continue'",
        'Add-Type -AssemblyName Microsoft.VisualBasic',
        "Write-Output 'READY'",
        'while ($true) {',
        '  $line = [Console]::In.ReadLine()',
        "  if ($null -eq $line) { break }",
        // PING yalnizca hazirlik dogrulamasidir; cevap uretmez ve
        // donguyu bozmaz. (Daha once 'quit' ile ayni guvenlik kontrolune
        // takiliyordu ve surec hemen kapaniyordu.)
        "  if ($line -eq '__PING__') { continue }",
        "  if ($line -eq '__QUIT__') { break }",
        '  try {',
        '    if (Test-Path -LiteralPath $line) {',
        '      $i = Get-Item -LiteralPath $line -Force',
        '      if ($i.PSIsContainer) {',
        '        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(',
        "          $line, 'OnlyErrorDialogs', 'SendToRecycleBin')",
        '      } else {',
        '        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(',
        "          $line, 'OnlyErrorDialogs', 'SendToRecycleBin')",
        '      }',
        "      Write-Output 'OK'",
        '    } else {',
        "      Write-Output 'GONE'",
        '    }',
        '  } catch {',
        "    Write-Output ('ERR:' + $_.Exception.Message)",
        '  }',
        '}',
      ].join('\n');

      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.child = child;

      let buf = '';
      child.stdout!.setEncoding('utf8');
      child.stdout!.on('data', (chunk: string) => {
        buf += chunk;
        let idx: number;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (line === '') continue;
          if (line === 'READY') {
            this.ready = true;
            continue;
          }
          const item = this.queue.shift();
          if (item) {
            this.pending.set(item, {
              ok: line.startsWith('OK') || line === 'GONE',
              reason: line === 'GONE' ? 'dosya zaten yok' : line.replace(/^ERR:/, ''),
            });
          }
        }
      });
      child.stderr!.resume(); // hata ciktisini yoksay

      // once betigi gonder, sonra READY bekle
      child.stdin!.write(script + '\n');
      child.stdin!.write('__PING__\n');

      // Surec olurken haber ver (bu bir nokta olcum noktasi:
      // surec acilamazsa butun silme sessizce basarisiz olur)
      debug('geri donusum sureci baslatiliyor', { pid: child.pid });

      // READY gelene kadar bekle (sonsuz dongu guvenligi ile)
      for (let i = 0; i < 200; i++) {
        if (this.ready) {
          info('geri donusum kutusu hazir', { pid: child.pid });
          return;
        }
        if (child.exitCode !== null) {
          logError('PowerShell erken sonlandi', { exitCode: child.exitCode, pid: child.pid });
          throw new Error(`PowerShell erken sonlandi (kod ${child.exitCode})`);
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      logError('PowerShell hazir olmadi', { pid: child.pid });
      throw new Error('PowerShell hazir olmadi (10 saniye zaman asimi)');
    })();

    try {
      return await this.starting;
    } catch (err) {
      this.starting = null;
      this.child?.kill();
      this.child = null;
      logError('geri donusum sureci kurulamadi', { err: String(err) });
      throw err;
    }
  }

  /** Tek bir yolu geri donusum kutusuna gonderir. */
  async send(path: string): Promise<{ ok: boolean; reason: string }> {
    await this.ensureStarted();
    if (!this.child || this.child.killed) return { ok: false, reason: 'surec kapali' };

    this.queue.push(path);
    try {
      this.child.stdin!.write(path + '\n');
    } catch {
      this.queue.pop();
      return { ok: false, reason: 'yazilamadi' };
    }

    // Cevap bekle. Geri donusum kutusu yavas olabilir (ozellikle
    // buyuk klasorlerde), bu yuzden surun bitmesi beklenmez.
    for (let i = 0; i < 120_000; i++) {
      const r = this.pending.get(path);
      if (r) {
        this.pending.delete(path);
        return r;
      }
      if (this.child.exitCode !== null) {
        logError('geri donusum sureci sonlandi', { path, exitCode: this.child.exitCode });
        return { ok: false, reason: 'surec sonlandi' };
      }
      await new Promise((r) => setImmediate(r));
    }
    logError('geri donusum zaman asimi', { path });
    return { ok: false, reason: 'zaman asimi' };
  }

  close(): void {
    if (!this.child) return;
    try {
      this.child.stdin!.write('__QUIT__\n');
      this.child.stdin!.end();
    } catch {
      /* yoksay */
    }
    this.child.kill();
    this.child = null;
    this.ready = false;
    this.starting = null;
  }
}

let sharedBin: RecycleBin | null = null;
export function recycle(): RecycleBin {
  if (!sharedBin) sharedBin = new RecycleBin();
  return sharedBin;
}
export function closeRecycle(): void {
  sharedBin?.close();
  sharedBin = null;
}

/**
 * Tek yol icin geri donusum kutusu (uyumluluk katmani).
 * Tercih edilen yol: recycle().send() toplu kullanimi.
 */
async function recycleViaShell(path: string, isDir: boolean): Promise<void> {
  void isDir;
  const r = await recycle().send(path);
  if (!r.ok) throw new Error(r.reason || 'geri donusum kutusuna gonderilemedi');
}

/**
 * Geri donusum kutusunda yer var mi?
 *
 * ONCELEME: Bu bir SORGUDUR ve bir kez cagrilir, dosya basina degil.
 * 117.000 dosya icin 117.000 kez sorgulamak ayni felaketi uretirdi.
 * Sonuc onbellege alinir.
 */
let roomCache: { hasRoom: boolean; at: number } | null = null;

export async function recycleBinHasRoom(needBytes: number): Promise<boolean> {
  // 5 dakika icinde hesaplanan sonucu tekrar kullan
  if (roomCache && Date.now() - roomCache.at < 300_000 && needBytes === 0) {
    return roomCache.hasRoom;
  }
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    const ps = `
$ErrorActionPreference='SilentlyContinue'
Add-Type -AssemblyName Microsoft.VisualBasic
$shell = New-Object -ComObject Shell.Application
$bin = $shell.Namespace(10)
$size = 0
if ($bin) {
  foreach ($i in $bin.Items()) {
    $s = $bin.GetDetailsOf($i, 1)
    if ($s) { $size += [double]($s -replace '[^0-9.]','') }
  }
}
$free = (Get-PSDrive C).Free
# Geri donusum kutusu kotalari: en fazla diskin %5'i veya 10 GB
$quota = [Math]::Min($free * 0.05, 10GB)
Write-Output ('SIZE=' + [Math]::Round($size))
Write-Output ('QUOTA=' + [Math]::Round($quota))
Write-Output ('FREE=' + [Math]::Round($free))
`;
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      timeout: 60_000,
    });
    const get = (k: string) => {
      const m = new RegExp(`${k}=([0-9.]+)`).exec(stdout);
      return m ? Number(m[1]) : NaN;
    };
    const quota = get('QUOTA');
    const size = get('SIZE');
    if (Number.isNaN(quota)) return true; // bilinemiyorsa engel olma
    const freeQuota = Math.max(0, quota - size);
    // 1 GB pay birak: kotanin tamami doluysa hicbir sey giremez
    const hasRoom = needBytes <= freeQuota - 1024 * 1024 * 1024;
    if (needBytes === 0) roomCache = { hasRoom, at: Date.now() };
    return hasRoom;
  } catch {
    return true; // bilinemiyorsa izin ver
  }
}

async function measureTree(path: string): Promise<{ bytes: number; files: number }> {
  let total = 0;
  let files = 0;
  const stack = [path];
  while (stack.length) {
    const dir = stack.pop()!;
    let ents;
    try {
      ents = await readdir(longPath(dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      const full = `${dir}\\${e.name}`;
      if (e.isDirectory()) stack.push(full);
      else {
        try {
          const st = await stat(longPath(full));
          total += st.size;
          files++;
        } catch {
          /* atla */
        }
      }
    }
  }
  return { bytes: total, files };
}

/**
 * Klasordeki dosyalari toplar.
 *
 * 116.956 dosyalik bir agac 100k limitine takilirsa SILME ISLEMESI
 * YARIM KALIR ve kullaniciya yanlis bilgi verilir. Bu yuzden esik
 * yoktur; liste akis halinde uretilir.
 */
async function collectFiles(root: string, max = Number.MAX_SAFE_INTEGER): Promise<string[]> {
  const out: string[] = [];
  const stack = [root];
  while (stack.length && out.length < max) {
    const dir = stack.pop()!;
    let ents;
    try {
      ents = await readdir(longPath(dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      const full = `${dir}\\${e.name}`;
      if (e.isDirectory()) stack.push(full);
      else out.push(full);
    }
  }
  return out;
}

function describe(err: unknown): string {
  const e = err as NodeJS.ErrnoException & { stderr?: string };
  return e.code ? `${e.code}: ${e.message.split('\n')[0]}` : String(err).slice(0, 120);
}

/** Silme gunlugu: geri alma icin. */
export class Journal {
  private entries: JournalEntry[] = [];

  add(e: JournalEntry): void {
    this.entries.push(e);
  }

  all(): JournalEntry[] {
    return this.entries;
  }

  async save(dir: string): Promise<string> {
    const { writeFile } = await import('node:fs/promises');
    const path = `${dir}\\residue-journal-${Date.now()}.json`;
    await writeFile(path, JSON.stringify(this.entries, null, 2), 'utf8');
    return path;
  }
}