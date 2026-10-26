import { createHash, randomBytes } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { longPath } from '../util/longpath.ts';
import { dataDir } from '../core/data-dir.ts';
import { RestoreTarget } from '../core/restore-target.ts';
import { walk } from '../core/walker.ts';
import { warn } from '../util/log.ts';
import { audit } from '../util/audit.ts';

/**
 * Residue kasasi (quarantine vault).
 *
 * Windows Geri Donusum Kutusu KULLANILMAZ. Silinen yollar aracin kendi
 * veri dizinindeki kasaya tasinir; her parti icin manifest tutulur:
 *   %LOCALAPPDATA%\residue\vault\<batch>\manifest.json
 *   %LOCALAPPDATA%\residue\vault\<batch>\items\<itemId>\payload
 *   %LOCALAPPDATA%\residue\vault\<batch>\items\<itemId>\meta.json
 *
 * 2.1.0 ile eklenenler (mevcut partiler BOZULMADAN okunur):
 *  - her oge icin KARARLI `id` (manifestte saklanir; eski kayitlarda
 *    storedPath'ten turetilir, boylece sira degisince kimlik kaymaz),
 *  - oge basina `meta.json` (ozgun yol, boyut, kanit/plan ozeti),
 *  - atomik manifest yazimi (tmp + rename),
 *  - `index.json` ve manifestlerden yeniden olusturma,
 *  - secili oge bosaltma (purgeVaultItems) ve saklama suresi.
 *
 * Ayni surucude `rename` atomiktir ve hizlidir; farkli surucude
 * kopyala+dogrula+sil yedegine dusulur.
 */

export type VaultItemState = 'vaulted' | 'restoring' | 'restored' | 'deleted';
export type RestoreMode = 'files' | 'repair' | 'side-by-side';
export type RestoreConflict = 'rename' | 'overwrite' | 'cancel';

export interface VaultEntry {
  /** Kararli kimlik. Eski manifestlerde yoksa okurken turetilir. */
  id: string;
  originalPath: string;
  storedPath: string;
  bytes: number;
  files: number;
  at: number;
  /** Yasam dongusu; journal-first islemler icin. */
  state?: VaultItemState;
  /** Plana/kumeye geri bag (kanit agaci ve grup geri yukleme icin). */
  planId?: string;
  clusterKey?: string;
  group?: string[];
  /** Icerik dogrulama ozeti. */
  integrity?: { files: number; bytes: number; verifiedAt?: number };
}

export interface VaultBatch {
  id: string;
  dir: string;
  at: number;
  entries: VaultEntry[];
}

export interface VaultIndexEntry extends VaultEntry {
  batchId: string;
}

export interface RestoreOptions {
  mode?: RestoreMode;
  conflict?: RestoreConflict;
  now?: number;
}

export interface RestoreResult {
  restored: boolean;
  to: string;
  conflict: boolean;
  mode: RestoreMode;
  verified: boolean;
  reason?: string;
  attempts?: number;
  code?: string;
}

export interface PurgeItemsResult {
  ok: boolean;
  items: number;
  bytes: number;
  failed: number;
  errors: Array<{ id: string; reason: string }>;
}

function sha(text: string, length = 12): string {
  return createHash('sha1').update(text).digest('hex').slice(0, length);
}

/** Eski manifestlerde id yoksa storedPath'ten deterministik kimlik. */
export function stableVaultId(storedPath: string): string {
  return `v-${sha(storedPath.toLowerCase())}`;
}

export function vaultRoot(): string {
  return join(dataDir(), 'vault');
}

function indexFile(): string {
  return join(vaultRoot(), 'index.json');
}

function isInside(root: string, candidate: string): boolean {
  const r = resolve(root).toLowerCase().replace(/[\\/]+$/, '');
  const c = resolve(candidate).toLowerCase().replace(/[\\/]+$/, '');
  return c === r || c.startsWith(r + sep);
}

export async function newVaultBatch(now = Date.now()): Promise<VaultBatch> {
  const id = `b-${now}-${randomBytes(4).toString('hex')}`;
  const dir = join(vaultRoot(), id);
  await mkdir(longPath(join(dir, 'items')), { recursive: true });
  return { id, dir, at: now, entries: [] };
}

/** Atomik manifest yazimi: yarim kalan JSON butun partiyi gorunmez yapmasin. */
export async function saveVaultManifest(batch: VaultBatch): Promise<void> {
  await mkdir(longPath(batch.dir), { recursive: true });
  const file = join(batch.dir, 'manifest.json');
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const body = JSON.stringify(
    { version: 2, id: batch.id, at: batch.at, entries: batch.entries },
    null,
    2,
  );
  await writeFile(longPath(tmp), body, 'utf8');
  await rename(longPath(tmp), longPath(file));
}

async function saveItemMeta(batch: VaultBatch, entry: VaultEntry): Promise<void> {
  // Yeni duzen: items/<id>/meta.json. Eski duzende payload tek dosya
  // oldugu icin meta yazilamaz; manifest yeterlidir.
  const itemDir = dirname(entry.storedPath);
  if (resolve(itemDir).toLowerCase() === resolve(join(batch.dir, 'items')).toLowerCase()) return;
  try {
    await mkdir(longPath(itemDir), { recursive: true });
    const meta = {
      version: 1,
      id: entry.id,
      batchId: batch.id,
      originalPath: entry.originalPath,
      storedPath: entry.storedPath,
      bytes: entry.bytes,
      files: entry.files,
      at: entry.at,
      state: entry.state ?? 'vaulted',
      planId: entry.planId,
      clusterKey: entry.clusterKey,
      group: entry.group,
      integrity: entry.integrity,
    };
    const file = join(itemDir, 'meta.json');
    const tmp = `${file}.tmp`;
    await writeFile(longPath(tmp), JSON.stringify(meta, null, 2), 'utf8');
    await rename(longPath(tmp), longPath(file));
  } catch (err) {
    // Meta kaybi geri yuklemeyi engellemez; manifest yine de dogrudur.
    warn('kasa meta yazilamadi', { path: itemDir, err: (err as Error).message });
  }
}

/**
 * Tek bir yolu kasaya tasir. `bytes/files` cagiranda olculmus olmali.
 * Basarisizlikta kaynak YERINDE kalir; yarim kopya temizlenir.
 */
export async function moveIntoVault(
  batch: VaultBatch,
  src: string,
  bytes: number,
  files: number,
): Promise<VaultEntry> {
  const id = `v-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  const itemDir = join(batch.dir, 'items', id);
  const storedPath = join(itemDir, 'payload');
  await mkdir(longPath(itemDir), { recursive: true });

  try {
    await rename(longPath(src), longPath(storedPath));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'EACCES') {
      await removeQuiet(itemDir);
      throw err;
    }
    // Farkli surucu veya kilit: kopyala -> dogrula -> kaynagi sil.
    try {
      await cp(longPath(src), longPath(storedPath), {
        recursive: true,
        preserveTimestamps: true,
        force: true,
      });
      await verifyCopy(src, storedPath, bytes, files);
      await rm(longPath(src), { recursive: true, force: true });
    } catch (copyErr) {
      await removeQuiet(itemDir);
      throw copyErr;
    }
  }

  const entry: VaultEntry = {
    id,
    originalPath: src,
    storedPath,
    bytes,
    files,
    at: Date.now(),
    state: 'vaulted',
    integrity: { files, bytes },
  };
  batch.entries.push(entry);

  try {
    await saveVaultManifest(batch);
    await saveItemMeta(batch, entry);
  } catch (err) {
    // Manifest yazilamadiysa payload "sahipsiz" kalmasin: geri tasi.
    batch.entries = batch.entries.filter((e) => e.id !== entry.id);
    try {
      await rename(longPath(storedPath), longPath(src));
      await removeQuiet(itemDir);
    } catch {
      /* geri tasima da basarisiz: hata yine de raporlanir */
    }
    throw err;
  }
  return entry;
}

async function verifyCopy(src: string, dst: string, bytes: number, files: number): Promise<void> {
  const st = await stat(longPath(src));
  if (!st.isDirectory()) {
    const d = await stat(longPath(dst));
    if (Number(d.size) !== Number(st.size)) {
      throw new Error('kasa kopyasi dogrulanamadi (boyut farkli)');
    }
    return;
  }
  // Dizin: kaba boyut/dosya sayisi karsilastirmasi. Tam hash maliyetli
  // oldugu icin yalnizca kopyalama sonrasi bir kez yapilir.
  const srcWalk = await walk({ root: src, largeThreshold: Infinity, maxLarge: 0 });
  const dstWalk = await walk({ root: dst, largeThreshold: Infinity, maxLarge: 0 });
  if (srcWalk.bytes !== dstWalk.bytes || srcWalk.files !== dstWalk.files) {
    throw new Error(
      `kasa kopyasi dogrulanamadi (kaynak ${srcWalk.files}/${srcWalk.bytes}, hedef ${dstWalk.files}/${dstWalk.bytes})`,
    );
  }
  void bytes;
  void files;
}

async function removeQuiet(path: string): Promise<void> {
  try {
    await rm(longPath(path), { recursive: true, force: true });
  } catch {
    /* en iyi caba */
  }
}

function normalizeEntry(raw: Partial<VaultEntry>, batchDir: string): VaultEntry | null {
  if (!raw || typeof raw.originalPath !== 'string' || typeof raw.storedPath !== 'string') return null;
  // Manifest kurcalanmissa kasa disina isaret eden kayit kabul edilmez.
  if (!isInside(batchDir, raw.storedPath)) return null;
  const id =
    typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : stableVaultId(raw.storedPath);
  return {
    id,
    originalPath: raw.originalPath,
    storedPath: raw.storedPath,
    bytes: typeof raw.bytes === 'number' && raw.bytes >= 0 ? raw.bytes : 0,
    files: typeof raw.files === 'number' && raw.files >= 0 ? raw.files : 0,
    at: typeof raw.at === 'number' ? raw.at : 0,
    state: raw.state ?? 'vaulted',
    planId: raw.planId,
    clusterKey: raw.clusterKey,
    group: Array.isArray(raw.group) ? raw.group.filter((g): g is string => typeof g === 'string') : undefined,
    integrity: raw.integrity,
  };
}

async function readBatch(dir: string): Promise<VaultBatch | null> {
  try {
    const j = JSON.parse(await readFile(longPath(join(dir, 'manifest.json')), 'utf8')) as {
      id?: string;
      at?: number;
      entries?: Array<Partial<VaultEntry>>;
    };
    if (!Array.isArray(j.entries) || typeof j.id !== 'string') return null;
    const entries: VaultEntry[] = [];
    for (const raw of j.entries) {
      const e = normalizeEntry(raw, dir);
      if (e) entries.push(e);
    }
    return {
      id: j.id,
      dir,
      at: typeof j.at === 'number' ? j.at : 0,
      entries,
    };
  } catch {
    return null;
  }
}

/** Tum kasalar (yeni -> eski). */
export async function listVaultBatches(): Promise<VaultBatch[]> {
  let ents;
  try {
    ents = await readdir(longPath(vaultRoot()), { withFileTypes: true });
  } catch {
    return [];
  }
  const out: VaultBatch[] = [];
  for (const e of ents) {
    if (!e.isDirectory()) continue;
    const b = await readBatch(join(vaultRoot(), e.name));
    if (b) out.push(b);
  }
  return out.sort((a, b) => b.at - a.at);
}

export interface VaultEntryRef extends VaultEntry {
  batchId: string;
  /** Geriye uyumluluk: eskiden `<batchId>:<index>` idi. Artik kararli id. */
  id: string;
}

/** Kasada duran kayitlar (yeni -> eski). */
export async function listVaultEntries(): Promise<VaultEntryRef[]> {
  const batches = await listVaultBatches();
  const out: VaultEntryRef[] = [];
  for (const b of batches) {
    for (const e of b.entries) out.push({ ...e, batchId: b.id });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Kimlikten kaydi bulur (istemci YOL gondermez). */
export async function findVaultEntry(id: string): Promise<VaultEntryRef | null> {
  return (await listVaultEntries()).find((e) => e.id === id) ?? null;
}

/** Basariyla geri yuklenen kaydi manifestten cikarir (liste kirlenmesin). */
export async function removeVaultEntry(entry: VaultEntry): Promise<void> {
  const batches = await listVaultBatches();
  const batch = batches.find((b) => b.entries.some((e) => e.id === entry.id));
  if (!batch) return;
  batch.entries = batch.entries.filter((e) => e.id !== entry.id);
  await saveVaultManifest(batch);
  await rebuildVaultIndex().catch(() => undefined);
}

async function moveBack(src: string, dst: string): Promise<void> {
  await mkdir(longPath(dirname(dst)), { recursive: true });
  try {
    await rename(longPath(src), longPath(dst));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'EACCES') throw err;
    await cp(longPath(src), longPath(dst), {
      recursive: true,
      preserveTimestamps: true,
      force: true,
    });
    await rm(longPath(src), { recursive: true, force: true });
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await lstat(longPath(p));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

async function verifyRestored(dst: string, entry: VaultEntry): Promise<boolean> {
  try {
    const st = await lstat(longPath(dst));
    if (!st.isDirectory()) return Number(st.size) === entry.bytes;
    if (!entry.integrity) return true;
    const w = await walk({ root: dst, largeThreshold: Infinity, maxLarge: 0 });
    return w.files === entry.integrity.files && w.bytes === entry.integrity.bytes;
  } catch {
    return false;
  }
}

/**
 * Kasaya tasinmis tek kaydi geri yukler.
 *
 * Cakisma politikasi ACIKCA secilir:
 *  - rename (varsayilan): `<yol>.restored-<zaman>`
 *  - overwrite: mevcut hedef `.replaced-<zaman>` olarak yedeklenir
 *  - cancel: hicbir sey yapilmaz (veri kaybi yok)
 *
 * Eski davranistaki "stat hatasi her seydir" hatasi giderildi: yalnizca
 * ENOENT "bos" sayilir; izin hatasi geri yuklemeyi durdurur.
 */
export async function restoreVaultEntry(
  entry: VaultEntry,
  opts: RestoreOptions = {},
): Promise<RestoreResult> {
  const mode = opts.mode ?? 'files';
  const conflictPolicy = opts.conflict ?? 'rename';
  const now = opts.now ?? Date.now();

  let exists: boolean;
  try {
    exists = await pathExists(entry.originalPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const reason = `hedef kontrol edilemedi: ${(err as Error).message}`;
    try {
      await audit('vault.restore.failed', {
        id: entry.id,
        from: entry.storedPath,
        to: entry.originalPath,
        code,
        reason,
        attempts: 0,
      });
    } catch {
      /* audit hatasi yutulur */
    }
    return {
      restored: false,
      to: entry.originalPath,
      conflict: false,
      mode,
      verified: false,
      reason,
      attempts: 0,
      code,
    };
  }

  // Cakisma politikasi: hedef ASLA ezilmez (overwrite haric, o da yedekler).
  let to: string;
  if (!exists) {
    to = RestoreTarget.initial(entry.originalPath, now, false);
  } else if (conflictPolicy === 'cancel') {
    return {
      restored: false,
      to: entry.originalPath,
      conflict: true,
      mode,
      verified: false,
      reason: 'hedef dolu; cakisma politikasi "cancel"',
    };
  } else if (conflictPolicy === 'overwrite') {
    const backup = `${entry.originalPath}.replaced-${now}`;
    try {
      await rename(longPath(entry.originalPath), longPath(backup));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const reason = `mevcut hedef yedeklenemedi: ${(err as Error).message}`;
      try {
        await audit('vault.restore.failed', {
          id: entry.id,
          from: entry.storedPath,
          to: entry.originalPath,
          code,
          reason,
          attempts: 0,
        });
      } catch {
        /* audit hatasi yutulur */
      }
      return {
        restored: false,
        to: entry.originalPath,
        conflict: true,
        mode,
        verified: false,
        reason,
        attempts: 0,
        code,
      };
    }
    to = entry.originalPath;
  } else {
    to = RestoreTarget.initial(entry.originalPath, now, true);
  }

  // Ilk suffix de doluysa benzersiz yeniden deneme adi.
  if (await pathExists(to)) {
    to = RestoreTarget.retry(entry.originalPath, now, 1, randomBytes(2).toString('hex'));
  }

  // moveBack en fazla 3 deneme: retryable kodlarda yeni ad uret.
  let attempts = 0;
  let moveErr: unknown = null;
  while (attempts < 3) {
    attempts++;
    try {
      await moveBack(entry.storedPath, to);
      moveErr = null;
      break;
    } catch (err) {
      moveErr = err;
      const code = (err as NodeJS.ErrnoException).code;
      if (!RestoreTarget.isRetryableCode(code) || attempts >= 3) break;
      to = RestoreTarget.retry(entry.originalPath, now, attempts, randomBytes(2).toString('hex'));
    }
  }

  if (moveErr) {
    const code = (moveErr as NodeJS.ErrnoException).code;
    const reason = (moveErr as Error).message;
    try {
      await audit('vault.restore.failed', {
        id: entry.id,
        from: entry.storedPath,
        to,
        code,
        reason,
        attempts,
      });
    } catch {
      /* audit hatasi yutulur */
    }
    return {
      restored: false,
      to,
      conflict: exists,
      mode,
      verified: false,
      reason,
      attempts,
      code,
    };
  }

  const verified = await verifyRestored(to, entry);
  // Manifest temizligi basaridan SONRA ve AYRI ele alinir: temizlik
  // hatasi geri yuklenmis dosyayi "basarisiz" gostermemeli.
  try {
    await removeVaultEntry(entry);
  } catch (err) {
    void err;
  }
  void audit('vault.restore', {
    id: entry.id,
    to,
    conflict: exists,
    mode,
    verified,
    attempts,
  });
  return {
    restored: true,
    to,
    conflict: exists,
    mode,
    verified,
    attempts,
    ...(verified ? {} : { reason: 'geri yukleme sonrasi dogrulama basarisiz' }),
  };
}

/** Tum kasa kayitlarini geri yukler (yeni -> eski). */
export async function restoreAllVault(
  opts: RestoreOptions = {},
): Promise<{ restored: number; conflict: number; failed: number; unverified: number }> {
  const entries = await listVaultEntries();
  let restored = 0;
  let conflict = 0;
  let failed = 0;
  let unverified = 0;
  for (const e of entries) {
    const r = await restoreVaultEntry(e, opts);
    if (!r.restored) failed++;
    else {
      restored++;
      if (r.conflict) conflict++;
      if (!r.verified) unverified++;
    }
  }
  return { restored, conflict, failed, unverified };
}

/**
 * Secili kasa ogelerini KALICI olarak siler.
 *
 * API yalnizca kasa kimligi kabul eder; yol kabul etmez. Her hedef
 * kasa kokunun icinde oldugu dogrulanir. Oge once manifestten dusurulur,
 * sonra payload silinir: yarida kalirsa "sahipsiz veri" degil,
 * "silinememis kayit" olur ve yeniden denenebilir.
 */
export async function purgeVaultItems(ids: string[]): Promise<PurgeItemsResult> {
  const wanted = new Set(ids.filter((x) => typeof x === 'string' && x.length > 0));
  const result: PurgeItemsResult = { ok: true, items: 0, bytes: 0, failed: 0, errors: [] };
  if (wanted.size === 0) return result;

  const entries = await listVaultEntries();
  for (const entry of entries) {
    if (!wanted.has(entry.id)) continue;
    if (!isInside(vaultRoot(), entry.storedPath)) {
      result.failed++;
      result.errors.push({ id: entry.id, reason: 'kasa koku disinda yol' });
      continue;
    }
    const itemDir = dirname(entry.storedPath);
    const itemsDir = join(vaultRoot(), entry.batchId, 'items');
    const payloadIsItemDir =
      resolve(itemDir).toLowerCase() !== resolve(itemsDir).toLowerCase();
    try {
      const st = await lstat(longPath(entry.storedPath));
      if (st.isSymbolicLink()) throw new Error('sembolik bag/junction silinmez');
      const w = st.isDirectory()
        ? await walk({ root: entry.storedPath, largeThreshold: Infinity, maxLarge: 0 })
        : { bytes: Number(st.size) };
      // Once manifest: kayit artik listelenmez.
      await removeVaultEntry(entry);
      await rm(
        longPath(payloadIsItemDir ? itemDir : entry.storedPath),
        { recursive: true, force: true, maxRetries: 3 },
      );
      result.items++;
      result.bytes += w.bytes;
    } catch (err) {
      result.failed++;
      result.errors.push({ id: entry.id, reason: (err as Error).message });
    }
  }
  result.ok = result.failed === 0;
  await rebuildVaultIndex().catch(() => undefined);
  void audit('vault.purge-items', {
    ids: [...wanted],
    items: result.items,
    bytes: result.bytes,
    failed: result.failed,
  });
  return result;
}

/**
 * Kasadaki TUM disk silme partilerini KALICI olarak siler (bosalt).
 *
 * Guvenlik:
 *  - Yalnizca `b-` ile baslayan ve gecerli manifesti olan partiler.
 *  - CLI yedek/karantina klasorleri (manifestleri farkli) KORUNUR.
 *  - Kasa kokunun kendisi silinmez.
 *  - Reparse point atlanir.
 */
export async function purgeVault(): Promise<{ batches: number; bytes: number; failed: number }> {
  let ents;
  try {
    ents = await readdir(longPath(vaultRoot()), { withFileTypes: true });
  } catch {
    return { batches: 0, bytes: 0, failed: 0 };
  }

  let batches = 0;
  let bytes = 0;
  let failed = 0;

  for (const e of ents) {
    if (!e.isDirectory() || !e.name.startsWith('b-')) continue;
    const dir = join(vaultRoot(), e.name);
    if (!isInside(vaultRoot(), dir)) continue;
    try {
      const batch = await readBatch(dir);
      if (!batch) continue;
      const st = await lstat(longPath(dir));
      if (st.isSymbolicLink()) continue;
      const w = await walk({ root: dir, largeThreshold: Infinity, maxLarge: 0 });
      await rm(longPath(dir), { recursive: true, force: true, maxRetries: 3 });
      batches++;
      bytes += w.bytes;
    } catch {
      failed++;
    }
  }

  await rebuildVaultIndex().catch(() => undefined);
  void audit('vault.purge-all', { batches, bytes, failed });
  return { batches, bytes, failed };
}

// ---------------------------------------------------------------------------
// Saklama suresi / indeks
// ---------------------------------------------------------------------------

/** Saklama suresi dolmus ogeler (silme yapmaz; plan icin). */
export async function expiredVaultEntries(retentionDays: number, now = Date.now()): Promise<VaultEntryRef[]> {
  const days = Math.max(0, retentionDays);
  const cutoff = now - days * 86_400_000;
  return (await listVaultEntries()).filter((e) => e.at > 0 && e.at < cutoff);
}

/** Suresi dolmus ogeleri kalici siler; cagiran acikca karar verir. */
export async function purgeExpiredVault(
  retentionDays: number,
  now = Date.now(),
): Promise<PurgeItemsResult> {
  const expired = await expiredVaultEntries(retentionDays, now);
  return purgeVaultItems(expired.map((e) => e.id));
}

/** Manifestlerden `vault/index.json` dosyasini yeniden olusturur. */
export async function rebuildVaultIndex(): Promise<{ entries: number; batches: number }> {
  const batches = await listVaultBatches();
  const entries = await listVaultEntries();
  const body = {
    version: 1,
    at: Date.now(),
    batches: batches.length,
    totalBytes: entries.reduce((a, e) => a + e.bytes, 0),
    entries: entries.map((e) => ({
      id: e.id,
      batchId: e.batchId,
      originalPath: e.originalPath,
      storedPath: e.storedPath,
      bytes: e.bytes,
      files: e.files,
      at: e.at,
      state: e.state ?? 'vaulted',
    })),
  };
  await mkdir(longPath(vaultRoot()), { recursive: true });
  const file = indexFile();
  const tmp = `${file}.tmp`;
  await writeFile(longPath(tmp), JSON.stringify(body, null, 2), 'utf8');
  await rename(longPath(tmp), longPath(file));
  return { entries: entries.length, batches: batches.length };
}

/** Indeksi okur; yoksa/bozuksa manifestlerden yeniden olusturur. */
export async function loadVaultIndex(): Promise<{
  entries: VaultIndexEntry[];
  rebuilt: boolean;
}> {
  try {
    const j = JSON.parse(await readFile(longPath(indexFile()), 'utf8')) as {
      entries?: VaultIndexEntry[];
    };
    if (Array.isArray(j.entries)) return { entries: j.entries, rebuilt: false };
  } catch {
    /* asagida yeniden olusturulur */
  }
  await rebuildVaultIndex();
  try {
    const j = JSON.parse(await readFile(longPath(indexFile()), 'utf8')) as {
      entries?: VaultIndexEntry[];
    };
    return { entries: Array.isArray(j.entries) ? j.entries : [], rebuilt: true };
  } catch {
    return { entries: [], rebuilt: true };
  }
}
