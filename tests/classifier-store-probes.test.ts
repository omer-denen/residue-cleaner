import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { probeDir } from '../src/core/classifier.ts';

/**
 * B14 — kanit toplarken gereksiz syscall yok.
 *
 * `probeDir` kok dizini BIR kez okur; paket deposu / package.json / log
 * probu ayni listeden karar verir. Bu testler hizli yolun KANITI
 * degistirmedigini kilitler: pnpm, yarn, bun deposu, kimlik kaynagi ve
 * log sinyali eskisi gibi bulunur.
 */

let root = '';

before(async () => {
  root = await mkdtemp(join(process.cwd(), 'scratch', 'b14-fixtures-'));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function file(path: string, content = ''): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf8');
}

const HEX40 = 'a'.repeat(40);

test('B14-1: pnpm deposu (store/v3/files/xx/<hash>) hizli yolda taninir', async () => {
  const dir = join(root, 'pnpm');
  await file(join(dir, 'store', 'v3', 'files', 'ab', HEX40), 'x');
  const p = await probeDir(dir);
  assert.ok(p.markers.includes('store'), 'store isareti yok');
  assert.ok(p.markers.includes('pnpm-store'), 'pnpm-store isareti yok');
});

test('B14-2: yarn v1 onbellegi (Cache/v6/<paket>/.yarn-metadata.json) taninir', async () => {
  const dir = join(root, 'yarn');
  await file(join(dir, 'Cache', 'v6', 'pkg-a', '.yarn-metadata.json'), '{}');
  await file(join(dir, 'Cache', 'v6', 'pkg-b', '.yarn-metadata.json'), '{}');
  const p = await probeDir(dir);
  assert.ok(p.markers.includes('yarn-cache'), 'yarn-cache isareti yok');
});

test('B14-3: bun deposu (install/cache/pkg@surum + package.json) taninir', async () => {
  const dir = join(root, 'bun');
  await file(join(dir, 'install', 'cache', 'left-pad@1.0.0', 'package.json'), '{}');
  await file(join(dir, 'install', 'cache', 'is-number@7.0.0', 'package.json'), '{}');
  await file(join(dir, 'install', 'cache', 'left-pad@1.0.0', '.bun-tag'), '');
  const p = await probeDir(dir);
  assert.ok(p.markers.includes('bun-cache'), 'bun-cache isareti yok');
});

test('B14-4: package.json kimlik kaynagi olarak okunur', async () => {
  const dir = join(root, 'with-pkg');
  await file(join(dir, 'package.json'), JSON.stringify({ name: 'probe-owner', version: '1.2.3' }));
  const p = await probeDir(dir);
  assert.deepEqual(p.owner, { kind: 'packageJson', name: 'probe-owner', version: '1.2.3' });
});

test('B14-5: package.json yoksa kimlik klasor adindan gelir', async () => {
  const dir = join(root, 'no-pkg-owner');
  await file(join(dir, 'readme.txt'), 'x');
  const p = await probeDir(dir);
  assert.equal(p.owner?.kind, 'directoryName');
  assert.equal(p.owner?.name, 'no-pkg-owner');
});

test('B14-6: logs/ altindaki log sinyali okunur', async () => {
  const dir = join(root, 'has-logs');
  await file(join(dir, 'logs', 'daemon.log'), 'provider=CUDAExecutionProvider\n');
  const p = await probeDir(dir);
  assert.ok(
    p.logSignals.some((s) => s.kind === 'gpu-provider'),
    'gpu-provider sinyali yok',
  );
});

test('B14-7: `Logs` (buyuk harf) klasoru de log kaniti sayilir', async () => {
  const dir = join(root, 'upper-logs');
  await file(join(dir, 'Logs', 'app.log'), 'Device: CPU\n');
  const p = await probeDir(dir);
  assert.ok(
    p.logSignals.some((s) => s.kind === 'cpu-device'),
    'cpu-device sinyali yok',
  );
});

test('B14-8: logs klasoru yoksa log sinyali uretilmez, hata sizmaz', async () => {
  const dir = join(root, 'no-logs');
  await file(join(dir, 'data.txt'), 'x');
  const p = await probeDir(dir);
  assert.equal(p.logSignals.length, 0);
});

test('B14-9: siradan klasor depo sayilmaz (yanlis pozitif kapisi)', async () => {
  const dir = join(root, 'plain');
  await file(join(dir, 'a.txt'), 'x');
  await file(join(dir, 'b.txt'), 'x');
  const p = await probeDir(dir);
  for (const m of ['store', 'pnpm-store', 'yarn-cache', 'bun-cache']) {
    assert.equal(p.markers.includes(m), false, `${m} yanlis pozitif`);
  }
});

test('B14-10: probeDir iki kez ayni kaniti uretir (onbellek yok)', async () => {
  const dir = join(root, 'determinism');
  await file(join(dir, 'Cache', 'v6', 'pkg-a', '.yarn-metadata.json'), '{}');
  await file(join(dir, 'Cache', 'v6', 'pkg-b', '.yarn-metadata.json'), '{}');
  const a = await probeDir(dir);
  const b = await probeDir(dir);
  assert.deepEqual(a.markers, b.markers);
  assert.deepEqual(a.fileKinds, b.fileKinds);
});
