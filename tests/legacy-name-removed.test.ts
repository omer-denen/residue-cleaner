import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isOwnDataPath, ownDataDirs } from '../src/core/discover.ts';
import { dataDir } from '../src/core/data-dir.ts';

/**
 * T54 — eski proje adi kaynak kodda tamamen kaldirildi.
 *
 * Kararti (kullanici karari, 23.10.2026): eski ad hicbir yerde
 * kullanilmiyor; gecis korumasi gereksiz. Bu test gerileyis engeller:
 * birini yeniden ekleyen degisiklik burada patlar.
 */

const SRC_ROOT = join(process.cwd(), 'src');
const ENV = {
  LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local',
  USERPROFILE: 'C:\\Users\\x',
};

function listTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) listTsFiles(p, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

test('T54: src/**/*.ts(x) icinde eski ad gecmez', () => {
  const offenders: string[] = [];
  for (const file of listTsFiles(SRC_ROOT)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/clicleaner/i.test(line)) offenders.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('T54: eski veri dizini "kendi veri" olarak taninmaz', () => {
  assert.equal(isOwnDataPath('C:\\Users\\x\\AppData\\Local\\residue\\vault', ENV), true);
  assert.equal(isOwnDataPath('C:\\Users\\x\\AppData\\Local\\clicleaner\\vault', ENV), false);
});

test('T54: ownDataDirs yalnizca guncel dizinleri dondurur', () => {
  assert.deepEqual(ownDataDirs(ENV), [
    'C:\\Users\\x\\AppData\\Local\\residue',
    'C:\\Users\\x\\.residue',
  ]);
  for (const d of ownDataDirs(ENV)) assert.ok(!/clicleaner/i.test(d), d);
});

test('T54: dataDir guncel ad tanir', () => {
  assert.equal(dataDir(ENV), 'C:\\Users\\x\\AppData\\Local\\residue');
});

/**
 * B17 — eski ad kullanici-gorunur yuzeylerden de kaldirildi.
 *
 * T54 testi yalniz `src/` altini tariyordu; kullaniciya gorunen dosyalar
 * (`package.json`, README, `bin/`, `web/src/`) kapsam disindaydi. Tarihsel
 * arsiv (HANDOVER / CHANGELOG / eski plan belgeleri) BILEREK kapsam disi:
 * gecmisi yeniden yazmak kanit degil, gurultu uretir.
 */

const ROOT = process.cwd();
const VISIBLE_TREES = ['bin', 'web/src'];
const VISIBLE_FILES = ['package.json', 'README.md'];
const ALLOWED_TREES = new Set(['node_modules', 'dist', 'build']);

function listVisibleFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (ALLOWED_TREES.has(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) listVisibleFiles(p, out);
    else if (/\.(ts|tsx|css|mjs|js|json|md)$/.test(entry)) out.push(p);
  }
  return out;
}

test('B17: kullanici-gorunur yuzeylerde eski ad gecmez', () => {
  const files = [
    ...VISIBLE_FILES.map((f) => join(ROOT, f)),
    ...VISIBLE_TREES.flatMap((d) => listVisibleFiles(join(ROOT, d))),
  ];
  const offenders: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/clicleaner/i.test(line)) offenders.push(`${file}:${i + 1}`);
    });
  }
  assert.ok(files.length > 5, `yuzey dosyasi bulunamadi (${files.length})`);
  assert.deepEqual(offenders, []);
});

test('B17: kendi veri dizini korumasi eski adi tanimaz', () => {
  // Korumali yollar SILINMEZ; bu test onlarin yerinde durdugunu dogrular.
  assert.equal(isOwnDataPath('C:\\Users\\x\\AppData\\Local\\clicleaner', ENV), false);
  assert.equal(isOwnDataPath('C:\\Users\\x\\AppData\\Local\\residue', ENV), true);
  assert.deepEqual(ownDataDirs(ENV).length, 2);
});
