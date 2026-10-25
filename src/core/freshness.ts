import { readdir, lstat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { longPath } from '../util/longpath.ts';

export interface DirProbe {
  exists: boolean;
  dirs: number;
  entries: number;
  newestMtime: number;
  capped: boolean;
}

/**
 * Ucuz varlik/yas probu: yalniz klasor yuruyusu.
 *
 * Dosyalar icin `stat` cagrilMAZ (maliyet nedeni). `entries` dirent
 * sayisindan gelir. Reparse point/junction `lstat` ile atlanir.
 */
export async function probeDirs(
  root: string,
  opts?: { maxDirs?: number; maxDepth?: number },
): Promise<DirProbe> {
  const maxDirs = opts?.maxDirs ?? 20000;
  const maxDepth = opts?.maxDepth ?? 10;
  const out: DirProbe = {
    exists: false,
    dirs: 0,
    entries: 0,
    newestMtime: 0,
    capped: false,
  };

  let rootStat;
  try {
    rootStat = await lstat(longPath(root));
  } catch {
    return out;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    // Kök yok veya klasör değil -> varlık false.
    return out;
  }
  out.exists = true;

  // Reparse point tespiti: Windows'ta junction/symlink lstat ile
  // isSymbolicLink false donebilir; ek olarak mode & reparse biti.
  const isReparse = (s: { mode: number; isSymbolicLink: () => boolean }): boolean => {
    if (s.isSymbolicLink()) return true;
    // IO_REPARSE_TAG_MOUNT_POINT / symlink reparse biti (0xA000).
    return (s.mode & 0xf000) === 0xa000;
  };

  const stack: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];

  while (stack.length > 0 && out.dirs < maxDirs) {
    const cur = stack.pop()!;
    let dirStat;
    try {
      dirStat = await lstat(longPath(cur.path));
    } catch {
      continue;
    }
    if (!dirStat.isDirectory() || isReparse(dirStat)) continue;

    out.dirs++;
    if (dirStat.mtimeMs > out.newestMtime) out.newestMtime = dirStat.mtimeMs;

    if (cur.depth >= maxDepth) continue;

    let ents: Dirent<string>[];
    try {
      ents = await readdir(longPath(cur.path), { withFileTypes: true, encoding: 'utf8' });
    } catch {
      continue;
    }
    for (const e of ents) {
      out.entries++;
      if (e.isSymbolicLink()) continue;
      if (!e.isDirectory()) continue;
      const full = join(cur.path, e.name);
      // Reparse point kontrolu: lstat ile dogrula.
      let ls;
      try {
        ls = await lstat(longPath(full));
      } catch {
        continue;
      }
      if (isReparse(ls)) continue;
      if (!ls.isDirectory()) continue;
      stack.push({ path: full, depth: cur.depth + 1 });
    }

    if (out.dirs >= maxDirs) {
      out.capped = true;
    }
  }

  if (stack.length > 0 && out.dirs >= maxDirs) out.capped = true;
  return out;
}
