import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  InstallShadowReport,
  type InstalledCopy,
} from '../src/core/install-shadow.ts';
import { probeInstalls } from '../src/util/install-probe.ts';

const PKG = 'residue-cleaner';

function copy(
  root: string,
  version: string | null,
  scope: InstalledCopy['scope'] = 'local',
): InstalledCopy {
  return { root, version, scope, evidence: 'test' };
}

function report(
  runningVersion: string | null,
  copies: InstalledCopy[],
  runningRoot = 'C:\\global\\node_modules\\residue-cleaner',
) {
  return new InstallShadowReport(PKG, { root: runningRoot, version: runningVersion }, copies);
}

// ---------------------------------------------------------------- saf karar

test('ayni surumdeki kopya golge degildir', () => {
  const r = report('3.0.0', [copy('C:\\Users\\x\\node_modules\\residue-cleaner', '3.0.0')]);
  assert.equal(r.status(), 'ok');
  assert.deepEqual(r.findings(), []);
  assert.match(r.summary(), /Golge kopya yok/);
  assert.deepEqual(r.advice(), []);
});

test('eski yerel kopya golgedir; yerel kaldirma komutu uretilir', () => {
  const r = report('3.0.0', [copy('C:\\Users\\x\\node_modules\\residue-cleaner', '2.2.0')]);
  assert.equal(r.status(), 'warn');
  const findings = r.findings();
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.relation, 'older');
  assert.equal(findings[0]?.scope, 'local');
  const advice = r.advice();
  assert.ok(
    advice.some((a) => a.includes('npm uninstall residue-cleaner --prefix "C:\\Users\\x"')),
    advice.join('\n'),
  );
  // Calisan kopya daha yeni oldugu icin "global guncelle" tavsiyesi gerekmiyor.
  assert.ok(!advice.some((a) => a.includes('npm install -g')));
});

test('calisan kopya eskiyse global guncelleme tavsiye edilir', () => {
  const r = report('2.2.0', [copy('C:\\npm\\node_modules\\residue-cleaner', '3.0.0', 'global')]);
  const findings = r.findings();
  assert.equal(findings[0]?.relation, 'newer');
  assert.ok(r.advice().some((a) => a.includes('npm install -g residue-cleaner@latest')));
});

test('surumu okunamayan kopya sessizce yutulmaz', () => {
  const r = report('3.0.0', [copy('C:\\somewhere', null, 'path')]);
  assert.equal(r.status(), 'warn');
  assert.equal(r.findings()[0]?.relation, 'unknown');
  assert.match(r.summary(), /v\?/);
  assert.ok(r.advice().some((a) => a.includes('Surumu okunamayan kopya: C:\\somewhere')));
});

test('ayni kok tekrarlanmaz (harf ve ayirici farki)', () => {
  const r = report('3.0.0', [
    copy('C:/Users/x/node_modules/residue-cleaner', '2.2.0'),
    copy('c:\\users\\x\\node_modules\\residue-cleaner\\', '2.2.0'),
  ]);
  assert.equal(r.all().length, 1);
  assert.equal(r.findings().length, 1);
});

test('calisan kopya kendisi golge sayilmaz', () => {
  const r = report('3.0.0', [copy('C:/GLOBAL/node_modules/residue-cleaner', '3.0.0', 'global')]);
  assert.deepEqual(r.findings(), []);
  assert.equal(r.status(), 'ok');
});

test('prerelease surum siralama dogru: 3.0.1-beta.1 < 3.0.1', () => {
  const r = report('3.0.1', [copy('C:\\x\\node_modules\\residue-cleaner', '3.0.1-beta.1')]);
  assert.equal(r.findings()[0]?.relation, 'older');
});

test('npx onbellegi icin surum belirtme tavsiyesi', () => {
  const r = report('3.0.0', [
    copy('C:\\cache\\_npx\\abc\\node_modules\\residue-cleaner', '2.0.1', 'npx'),
  ]);
  assert.ok(r.advice().some((a) => a.includes('npx residue-cleaner@latest')));
});

test('ozet kopya sayisini ve calisan surumu tasir', () => {
  const r = report('3.0.0', [
    copy('C:\\Users\\x\\node_modules\\residue-cleaner', '2.2.0'),
    copy('C:\\cache\\_npx\\abc\\node_modules\\residue-cleaner', '2.0.1', 'npx'),
  ]);
  const s = r.summary();
  assert.match(s, /^2 golge kopya: /);
  assert.match(s, /v2\.2\.0 yerel proje/);
  assert.match(s, /v2\.0\.1 npx onbellegi/);
  assert.match(s, /calisan v3\.0\.0/);
});

// ------------------------------------------------------------- disk kaniti

async function sandbox(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'residue-install-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writePackage(root: string, version: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: PKG, version }),
    'utf8',
  );
}

test('cwd atalarindaki yerel kopya bulunur', async () => {
  await sandbox(async (dir) => {
    await writePackage(join(dir, 'node_modules', PKG), '2.2.0');
    const deep = join(dir, 'a', 'b');
    await mkdir(deep, { recursive: true });
    const copies = await probeInstalls({
      packageName: PKG,
      binNames: ['residue'],
      cwd: deep,
      pathValue: '',
      npxCacheDirs: [],
    });
    const local = copies.filter((c) => c.scope === 'local');
    assert.equal(local.length, 1);
    assert.equal(local[0]?.version, '2.2.0');
    assert.match(local[0]?.evidence ?? '', /ust klasor:/);
  });
});

test('PATH girdisindeki global kopya bulunur', async () => {
  await sandbox(async (dir) => {
    const prefix = join(dir, 'npm-global');
    await writePackage(join(prefix, 'node_modules', PKG), '3.0.0');
    const copies = await probeInstalls({
      packageName: PKG,
      binNames: ['residue'],
      cwd: dir,
      pathValue: prefix,
      npxCacheDirs: [],
    });
    const global = copies.filter((c) => c.scope === 'global');
    assert.equal(global.length, 1);
    assert.equal(global[0]?.version, '3.0.0');
  });
});

test('paket klasoru olmayan shim "PATH girdisi" olarak raporlanir', async () => {
  await sandbox(async (dir) => {
    const bindir = join(dir, 'bin');
    await mkdir(bindir, { recursive: true });
    await writeFile(join(bindir, 'residue.cmd'), '@echo off\n', 'utf8');
    const copies = await probeInstalls({
      packageName: PKG,
      binNames: ['residue', 'residue-cleaner'],
      cwd: dir,
      pathValue: bindir,
      npxCacheDirs: [],
    });
    const pathCopies = copies.filter((c) => c.scope === 'path');
    assert.equal(pathCopies.length, 1);
    assert.equal(pathCopies[0]?.version, null);
    assert.match(pathCopies[0]?.evidence ?? '', /shim:/);
  });
});

test('npx onbellegindeki kopya bulunur', async () => {
  await sandbox(async (dir) => {
    const cache = join(dir, '_npx');
    await writePackage(join(cache, 'abc123', 'node_modules', PKG), '2.0.1');
    const copies = await probeInstalls({
      packageName: PKG,
      binNames: ['residue'],
      cwd: dir,
      pathValue: '',
      npxCacheDirs: [cache],
    });
    const npx = copies.filter((c) => c.scope === 'npx');
    assert.equal(npx.length, 1);
    assert.equal(npx[0]?.version, '2.0.1');
  });
});

test('BOM lu package.json da okunur (elle olusturulmus kopya)', async () => {
  await sandbox(async (dir) => {
    const root = join(dir, 'node_modules', PKG);
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, 'package.json'),
      '\uFEFF' + JSON.stringify({ name: PKG, version: '1.9.0' }),
      'utf8',
    );
    const copies = await probeInstalls({
      packageName: PKG,
      binNames: ['residue'],
      cwd: dir,
      pathValue: '',
      npxCacheDirs: [],
      maxParents: 0,
    });
    assert.equal(copies.length, 1);
    assert.equal(copies[0]?.version, '1.9.0');
  });
});

test('kopya yoksa bos liste doner', async () => {
  await sandbox(async (dir) => {
    const copies = await probeInstalls({
      packageName: PKG,
      binNames: ['residue'],
      cwd: dir,
      pathValue: '',
      npxCacheDirs: [],
      maxParents: 0,
    });
    assert.deepEqual(copies, []);
  });
});
