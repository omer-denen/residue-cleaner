import { readdir, realpath, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { longPath } from '../util/longpath.ts';
import { readExeInfo } from './exe-info.ts';
import { compareVersions as compareSemVer } from './semver.ts';
import type {
  NodeRuntimeCopy,
  NodeRuntimeKind,
  NodeRuntimeReport,
} from './cli-inventory-types.ts';

/**
 * Node surum yoneticisi kopyalari (T36).
 *
 * Node surum yoneticileri (nvm/fnm/volta) her Node surumunu AYRI bir
 * klasorde tutar ve her surumun kendi global paket klasoru olabilir.
 * Surum degisince eski surumun altindaki global paketler "yetim" kalir:
 * diskte yer kaplar ama o surum artik aktif degildir.
 *
 * Bu modul SALT OKUNUR'dur ve SILME KARARI URETMEZ:
 *   - kokleri yapidann tanir (node-versions/, tools/image/node/, settings.txt),
 *   - node.exe kopyalarini ve surumlerini bulur,
 *   - hangi kopyanin AKTIF oldugunu calisan node.exe / PATH ile belirler,
 *   - aktif olmayan ve global paket iceren kopyalari "review" isaretler.
 *
 * Kaldirma yine o surumun kendi npm'i ile yapilir; bu modul yalnizca
 * kanit ve inceleme komutu uretir.
 */

const MAX_DEPTH = 5;
const MAX_DIRS = 4000;
const MAX_COPIES = 64;
const SKIP_DIRS = new Set(['node_modules', 'site-packages', '.git', 'cache', 'caches']);

export interface NodeRuntimeScanOptions {
  /** Test/ileri kullanim icin acik kok listesi. Verilmezse standart kokler. */
  roots?: string[];
  /** Aktif kabul edilecek node.exe (varsayilan: process.execPath + PATH). */
  activeExe?: string;
  env?: NodeJS.ProcessEnv;
}

/** Bilinen kokler: once ortam degiskenleri, sonra standart yerlesimler. */
export function nodeRuntimeRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  const add = (p: string | undefined) => {
    if (!p) return;
    const clean = p.trim().replace(/^"|"$/g, '');
    if (!clean) return;
    const norm = clean.replace(/\//g, '\\').replace(/\\+$/, '');
    if (!out.some((x) => x.toLowerCase() === norm.toLowerCase())) out.push(norm);
  };

  add(env.NVM_HOME);
  add(env.FNM_DIR);
  add(env.VOLTA_HOME);

  const appData = env.APPDATA;
  const local = env.LOCALAPPDATA;
  const home = env.USERPROFILE ?? env.HOME;
  if (appData) add(join(appData, 'nvm'));
  if (local) {
    add(join(local, 'fnm'));
    add(join(local, 'Volta'));
  }
  if (home) add(join(home, '.volta'));

  return out.filter((p) => existsSync(longPath(p)));
}

/**
 * Kok turu: AD degil YAPI kanittir.
 *  - node-versions/          -> fnm
 *  - tools/image/node/       -> volta
 *  - settings.txt + vX/      -> nvm-windows
 */
export async function nodeRootKind(root: string): Promise<NodeRuntimeKind> {
  if (existsSync(longPath(join(root, 'node-versions')))) return 'fnm';
  if (existsSync(longPath(join(root, 'tools', 'image', 'node')))) return 'volta';
  if (existsSync(longPath(join(root, 'settings.txt')))) return 'nvm';
  try {
    const ents = await readdir(longPath(root), { withFileTypes: true });
    if (ents.some((e) => e.isDirectory() && /^v?\d+\.\d+\.\d+/.test(e.name))) return 'nvm';
  } catch {
    /* okunamadi */
  }
  return 'unknown';
}

/** Kok altindaki node.exe kopyalari (sinirli BFS; tam agac taramasi yok). */
async function findNodeExes(root: string): Promise<string[]> {
  const out: string[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  let visited = 0;

  while (queue.length > 0 && visited < MAX_DIRS && out.length < MAX_COPIES) {
    const { dir, depth } = queue.shift()!;
    if (depth >= MAX_DEPTH) continue;
    visited++;
    let ents;
    try {
      ents = await readdir(longPath(dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      const full = join(dir, e.name);
      if (e.isFile()) {
        if (e.name.toLowerCase() === 'node.exe') out.push(full);
        continue;
      }
      if (!e.isDirectory()) continue;
      const n = e.name.toLowerCase();
      if (SKIP_DIRS.has(n)) continue;
      queue.push({ dir: full, depth: depth + 1 });
    }
  }
  return out;
}

/** Bir yol parcasindan surum numarasi: v22.14.0 / 22.14.0 */
function versionFromPath(nodeExe: string, root: string): string | null {
  const rel = nodeExe
    .slice(root.length)
    .split(/[\\/]/)
    .filter(Boolean);
  for (let i = rel.length - 1; i >= 0; i--) {
    const m = /^v?(\d+\.\d+\.\d+(?:[-+][\w.]+)?)$/.exec(rel[i] ?? '');
    if (m?.[1]) return m[1];
  }
  return null;
}

/**
 * Surum klasorunun global paket klasoru.
 *
 * nvm-windows: <kok>\vX\node_modules
 * fnm:         <kok>\node-versions\vX\installation\node_modules
 * volta:       surum bazli global klasor yok (paket imajlari ayri tutulur)
 */
function globalModulesFor(nodeExe: string, kind: NodeRuntimeKind): string | null {
  const dir = dirname(nodeExe);
  const candidates = kind === 'volta' ? [] : [join(dir, 'node_modules')];
  if (kind === 'fnm' && basename(dir).toLowerCase() === 'installation') {
    candidates.unshift(join(dir, 'node_modules'));
  }
  // nvm/fnm disinda kalan yapilarda da bir ust seviyeye bakilir.
  if (kind === 'unknown') candidates.push(join(dirname(dir), 'node_modules'));
  return candidates.find((p) => existsSync(longPath(p))) ?? null;
}

/** Global paket sayisi: npm/corepack gibi araçlar sayilmaz. */
async function countGlobalPackages(dir: string | null): Promise<number> {
  if (!dir) return 0;
  let ents;
  try {
    ents = await readdir(longPath(dir), { withFileTypes: true });
  } catch {
    return 0;
  }
  const ignore = new Set(['npm', 'corepack', '.bin', '.package-lock.json']);
  let count = 0;
  for (const e of ents) {
    if (ignore.has(e.name.toLowerCase())) continue;
    if (e.name.startsWith('@')) {
      try {
        const scoped = await readdir(longPath(join(dir, e.name)), { withFileTypes: true });
        count += scoped.filter((s) => s.isDirectory()).length;
      } catch {
        /* scope okunamadi */
      }
      continue;
    }
    if (e.isDirectory()) count++;
  }
  return count;
}

async function realOrSelf(p: string): Promise<string> {
  try {
    return (await realpath(longPath(p))).toLowerCase();
  } catch {
    return p.toLowerCase();
  }
}

function pathNode(env: NodeJS.ProcessEnv): string | null {
  for (const dir of (env.PATH ?? '').split(';')) {
    const d = dir.trim();
    if (!d) continue;
    const exe = join(d, 'node.exe');
    if (existsSync(longPath(exe))) return exe;
  }
  return null;
}

/** Aktif node.exe adaylari: calisan surec, PATH ve nvm symlink'i. */
async function activeCandidates(opts: NodeRuntimeScanOptions): Promise<string[]> {
  const out: string[] = [];
  const add = (p: string | null | undefined) => {
    if (p && !out.some((x) => x.toLowerCase() === p.toLowerCase())) out.push(p);
  };
  add(opts.activeExe);
  if (!opts.roots) {
    add(process.execPath);
    const env = opts.env ?? process.env;
    add(pathNode(env));
    if (env.NVM_SYMLINK) add(join(env.NVM_SYMLINK.replace(/^"|"$/g, ''), 'node.exe'));
  }
  return out;
}

/**
 * Kokleri tarar. Ayni node.exe iki kokten de bulunursa tekilleştirilir.
 */
export async function scanNodeRuntimes(
  opts: NodeRuntimeScanOptions = {},
): Promise<NodeRuntimeReport> {
  const env = opts.env ?? process.env;
  const roots = (opts.roots ?? nodeRuntimeRoots(env)).map((r) => r.replace(/\\+$/, ''));
  const rootKinds = new Map<string, NodeRuntimeKind>();
  for (const root of roots) rootKinds.set(root, await nodeRootKind(root));

  const seen = new Set<string>();
  const raw: Array<{ nodeExe: string; root: string; kind: NodeRuntimeKind }> = [];
  for (const root of roots) {
    const kind = rootKinds.get(root) ?? 'unknown';
    for (const nodeExe of await findNodeExes(root)) {
      const key = nodeExe.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      raw.push({ nodeExe, root, kind });
    }
  }

  const activeReal = await Promise.all((await activeCandidates(opts)).map(realOrSelf));
  const copies: NodeRuntimeCopy[] = [];

  for (const { nodeExe, root, kind } of raw) {
    const dir = dirname(nodeExe);
    let version = versionFromPath(nodeExe, root);
    if (!version) {
      const info = await readExeInfo(nodeExe);
      version = info.version?.replace(/\.0$/, '') ?? 'bilinmiyor';
    }

    const globalModules = globalModulesFor(nodeExe, kind);
    const globalPackageCount = await countGlobalPackages(globalModules);

    let lastTouched = 0;
    for (const p of [nodeExe, globalModules].filter(Boolean) as string[]) {
      const st = await stat(longPath(p)).catch(() => null);
      if (st && st.mtimeMs > lastTouched) lastTouched = st.mtimeMs;
    }

    const dirReal = await realOrSelf(dir);
    const active =
      activeReal.length > 0 &&
      activeReal.some((a) => a === dirReal || a.startsWith(dirReal + '\\'));

    copies.push({
      version,
      nodeExe,
      dir,
      kind,
      active,
      globalModules,
      globalPackageCount,
      lastTouched,
      review: !active && globalPackageCount > 0,
    });
  }

  copies.sort((a, b) => compareSemVer(b.version, a.version));
  const activeVersion = copies.find((c) => c.active)?.version ?? null;
  const rootsOut = roots.map((path) => ({ path, kind: rootKinds.get(path) ?? 'unknown' }));

  return {
    roots: rootsOut,
    copies,
    activeVersion,
    note:
      copies.length === 0
        ? 'Node surum yoneticisi kopyasi bulunamadi'
        : copies.length === 1
          ? 'Tek Node surumu var; karsilastirilacak eski kopya yok'
          : undefined,
  };
}

/**
 * (E6b) Yerel sayisal karsilastirma kaldirildi: eski karsilastirici
 * `1.2.3-beta` ile `1.2.3`'u ESIT sayiyor ve on surumlu kopyalarin
 * siralamasini bozuyordu. Tek kaynak `semver.ts` (on surum siralamasi
 * dahil).
 */
