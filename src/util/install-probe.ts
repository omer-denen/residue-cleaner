/**
 * KURULUM KOPYASI KANITI — diskteki kurulumlari bulur (SALT OKUNUR).
 *
 * `core/install-shadow.ts` karari verir; bu modul yalnizca kanit toplar:
 *
 *   1. cwd ve atalari  -> `<dir>/node_modules/<paket>` (yerel proje kopyasi)
 *      npx/npm exec bu zinciri izledigi icin home dizinindeki bir kopya
 *      butun alt klasorleri golgeler.
 *   2. PATH girdileri  -> `<entry>/node_modules/<paket>` (global kurulum)
 *      ya da yalniz shim varsa "PATH girdisi" (paket klasoru okunamadi).
 *   3. npx onbellegi   -> `%LOCALAPPDATA%\npm-cache\_npx\*\node_modules\<paket>`
 *      (`npx` eski bir kopyayi burada tutabilir; surum kendiliginden artmaz).
 *
 * Hicbir dosya yazilmaz, silinmez; yalniz okunur. Cozulemeyen yol sessizce
 * atlanir, "surum yok" ise `null` olarak raporlanir (surum uydurulmaz).
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import type { InstalledCopy } from '../core/install-shadow.ts';
import { longPath } from './longpath.ts';

export interface ProbeOptions {
  /** Paket adi (or. `residue-cleaner`). */
  packageName: string;
  /** Komut shim adlari (or. `residue`, `residue-cleaner`). */
  binNames: string[];
  /** Baslangic klasoru (varsayilan: process.cwd()). */
  cwd?: string;
  /** PATH degeri (varsayilan: process.env.PATH). */
  pathValue?: string;
  /**
   * npx onbellek klasorleri. Testte enjekte edilir; verilmezse
   * `%LOCALAPPDATA%\npm-cache\_npx` ve `~/.npm/_npx` denenir.
   */
  npxCacheDirs?: string[];
  /** Guvenlik siniri: en fazla kac ust klasor gezilir. */
  maxParents?: number;
}

const SHIM_EXTS = ['', '.cmd', '.ps1', '.exe', '.bat'];

async function exists(p: string): Promise<boolean> {
  try {
    await stat(longPath(p));
    return true;
  } catch {
    return false;
  }
}

interface VersionProbe {
  found: boolean;
  version: string | null;
}

/** `<root>/package.json` okunur. Surum yoksa/bozuksa `null` (uydurma yok). */
async function readVersion(root: string): Promise<VersionProbe> {
  try {
    const txt = await readFile(longPath(join(root, 'package.json')), 'utf8');
    // BOM'lu dosya da okunur: kullanici elle olusturmus olabilir.
    const j = JSON.parse(txt.replace(/^\uFEFF/, '')) as { version?: unknown };
    return {
      found: true,
      version: typeof j.version === 'string' && j.version.length > 0 ? j.version : null,
    };
  } catch {
    return { found: false, version: null };
  }
}

/** Klasorde paket shim'i var mi? Varsa yolunu dondurur. */
async function findShim(dir: string, binNames: readonly string[]): Promise<string | null> {
  for (const name of binNames) {
    for (const ext of SHIM_EXTS) {
      const p = join(dir, `${name}${ext}`);
      if (await exists(p)) return p;
    }
  }
  return null;
}

function defaultNpxCacheDirs(): string[] {
  const out: string[] = [];
  const local = process.env.LOCALAPPDATA;
  if (local) out.push(join(local, 'npm-cache', '_npx'));
  try {
    out.push(join(homedir(), '.npm', '_npx'));
  } catch {
    /* homedir okunamadi */
  }
  return out;
}

function splitPath(value: string): string[] {
  return value
    .split(delimiter)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** cwd'den yukari yurur; her seviyede yerel `node_modules/<paket>` arar. */
async function probeAncestors(
  cwd: string,
  packageName: string,
  maxParents: number,
): Promise<InstalledCopy[]> {
  const out: InstalledCopy[] = [];
  let dir = resolve(cwd);
  for (let i = 0; i <= maxParents; i++) {
    const root = join(dir, 'node_modules', packageName);
    const v = await readVersion(root);
    if (v.found) {
      out.push({
        root,
        version: v.version,
        scope: 'local',
        evidence: `ust klasor: ${dir}`,
      });
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return out;
}

/** PATH girdileri: paket klasoru (global) ya da yalniz shim (path). */
async function probePathEntries(
  pathValue: string,
  packageName: string,
  binNames: readonly string[],
): Promise<InstalledCopy[]> {
  const out: InstalledCopy[] = [];
  for (const entry of splitPath(pathValue)) {
    const root = join(entry, 'node_modules', packageName);
    const v = await readVersion(root);
    if (v.found) {
      out.push({
        root,
        version: v.version,
        scope: 'global',
        evidence: `PATH: ${entry}`,
      });
      continue;
    }
    const shim = await findShim(entry, binNames);
    if (shim) {
      out.push({
        root: entry,
        version: null,
        scope: 'path',
        evidence: `shim: ${shim}`,
      });
    }
  }
  return out;
}

/** npx onbellegi: her hash klasorunde kurulmus kopyalar. */
async function probeNpxCaches(
  dirs: readonly string[],
  packageName: string,
): Promise<InstalledCopy[]> {
  const out: InstalledCopy[] = [];
  for (const dir of dirs) {
    let entries: string[] = [];
    try {
      entries = await readdir(longPath(dir));
    } catch {
      continue; // onbellek yok
    }
    for (const name of entries) {
      const root = join(dir, name, 'node_modules', packageName);
      const v = await readVersion(root);
      if (!v.found) continue;
      out.push({
        root,
        version: v.version,
        scope: 'npx',
        evidence: `onbellek: ${join(dir, name)}`,
      });
    }
  }
  return out;
}

/** Tum kanit kaynaklarini birlestirir. Tekrarlar `InstallShadowReport`ta elenir. */
export async function probeInstalls(opts: ProbeOptions): Promise<InstalledCopy[]> {
  const [ancestors, pathCopies] = await Promise.all([
    probeAncestors(opts.cwd ?? process.cwd(), opts.packageName, opts.maxParents ?? 24),
    probePathEntries(
      opts.pathValue ?? process.env.PATH ?? '',
      opts.packageName,
      opts.binNames,
    ),
  ]);
  const npxCopies = await probeNpxCaches(
    opts.npxCacheDirs ?? defaultNpxCacheDirs(),
    opts.packageName,
  );
  return [...ancestors, ...pathCopies, ...npxCopies];
}
