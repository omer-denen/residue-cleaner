import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  withPreservedFileTimes,
  readExeInfoPreservingTimes,
  annotateHealth,
} from '../src/core/cli-inventory.ts';
import type { CliTool } from '../src/core/cli-inventory-types.ts';

// Fixture koku %TEMP% DEGIL; gorev kurali geregi scratch/ altinda.
let root = '';

before(async () => {
  root = join(process.cwd(), 'scratch', 'atime-fixture');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Tolerans: utimes ms cozunurlugunde; 50 ms icerisinde esit sayilir. */
function assertNear(actual: number, expected: number, label: string): void {
  assert.ok(
    Math.abs(actual - expected) <= 50,
    `${label}: beklenen ${expected}, gelen ${actual}`,
  );
}

async function timesOf(p: string): Promise<{ atimeMs: number; mtimeMs: number }> {
  const st = await stat(p);
  return { atimeMs: st.atimeMs, mtimeMs: st.mtimeMs };
}

const OLD_ATIME = Date.parse('2020-01-02T03:04:05Z');
const OLD_MTIME = Date.parse('2021-06-07T08:09:10Z');
const NEW_ATIME = Date.parse('2023-03-03T03:03:03Z');
const NEW_MTIME = Date.parse('2024-04-04T04:04:04Z');

test('withPreservedFileTimes: callback zaman damgalarini bozsa bile eski degerlere döner', async () => {
  const file = join(root, 'helper.txt');
  await writeFile(file, 'icerik');
  // NOT: bu ortamda (win32 + Node 24) fs.utimes sayi ms argumani ile
  // EINVAL verir; Date nesnesi her platformda calisir.
  await utimes(file, new Date(OLD_ATIME), new Date(OLD_MTIME));

  const out = await withPreservedFileTimes(file, async () => {
    await utimes(file, new Date(NEW_ATIME), new Date(NEW_MTIME));
    return 42;
  });
  assert.equal(out, 42);

  const t = await timesOf(file);
  assertNear(t.atimeMs, OLD_ATIME, 'atime eski degere dönmeli');
  assertNear(t.mtimeMs, OLD_MTIME, 'mtime eski degere dönmeli');
});

test('withPreservedFileTimes: callback hata firlatsa bile zamanlar geri yazilir', async () => {
  const file = join(root, 'throwing.txt');
  await writeFile(file, 'icerik');
  await utimes(file, new Date(OLD_ATIME), new Date(OLD_MTIME));

  const boom = new Error('callback hata firlatti');
  await assert.rejects(
    withPreservedFileTimes(file, async () => {
      await utimes(file, new Date(NEW_ATIME), new Date(NEW_MTIME));
      throw boom;
    }),
    (err: unknown) => err === boom,
  );

  const t = await timesOf(file);
  assertNear(t.atimeMs, OLD_ATIME, 'hata durumunda atime geri yazilmali');
  assertNear(t.mtimeMs, OLD_MTIME, 'hata durumunda mtime geri yazilmali');
});

test('withPreservedFileTimes: dosya yoksa cökmez, stat/utimes hatasi yutulur', async () => {
  const missing = join(root, 'yok.txt');
  const out = await withPreservedFileTimes(missing, async () => 'ok');
  assert.equal(out, 'ok');
});

test('readExeInfoPreservingTimes: küçük gecersiz PE shim okunurken atime/mtime degismez', async () => {
  // Gecerli PE basligi yok (MZ imzasi yok): stub davranisi.
  const shim = join(root, 'ornek-arac.exe');
  await writeFile(shim, Buffer.from('bu bir stub shim dosyasidir; PE basligi yok'.repeat(4)));
  await utimes(shim, new Date(OLD_ATIME), new Date(OLD_MTIME));

  const info = await readExeInfoPreservingTimes(shim);
  assert.equal(info.valid, false);

  const t = await timesOf(shim);
  assertNear(t.atimeMs, OLD_ATIME, 'okuma atime kirletmemeli');
  assertNear(t.mtimeMs, OLD_MTIME, 'okuma mtime kirletmemeli');
});

test('annotateHealth: küçük stub dosya "broken" isaretlenir ve atime degismez', async () => {
  const stub = join(root, 'stub-arac.exe');
  await writeFile(stub, Buffer.from('A'.repeat(300))); // 4096 B alti, gecersiz PE
  await utimes(stub, new Date(OLD_ATIME), new Date(OLD_MTIME));

  const tool: CliTool = {
    id: 'teknik-onay:stub-arac',
    command: 'stub-arac',
    source: 'standalone',
    packageName: 'stub-arac',
    version: '',
    installPath: root,
    shims: [stub],
    stalePaths: [],
    stateDirs: [],
    installedAt: OLD_MTIME,
    lastAccessAt: OLD_ATIME,
    lastStateAt: 0,
    historyMentions: 0,
    historyLastRatio: 0,
    totalBytes: 300,
    idleDays: 0,
    status: 'unused',
    confidence: 'low',
    evidence: [],
    usageSignals: [],
    atimeSuspect: false,
    uninstall: null,
  };

  await annotateHealth([tool]);
  assert.equal(tool.health, 'broken');
  assert.ok(Array.isArray(tool.healthEvidence) && tool.healthEvidence.length > 0);
  assert.equal(tool.repair, undefined);

  const t = await timesOf(stub);
  assertNear(t.atimeMs, OLD_ATIME, 'stub okumasi atime kirletmemeli');
  assertNear(t.mtimeMs, OLD_MTIME, 'stub okumasi mtime kirletmemeli');
});
