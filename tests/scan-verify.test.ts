import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cluster } from './helpers.ts';
import type { ScanResult } from '../src/core/types.ts';
import type { Server } from 'node:http';

let root = '';
let verify: typeof import('../src/services/scan-verify-service.ts');
let cache: typeof import('../src/store/scan-cache.ts');

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'residue-verify-test-'));
  process.env.LOCALAPPDATA = root;
  verify = await import('../src/services/scan-verify-service.ts');
  cache = await import('../src/store/scan-cache.ts');
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

function makeScan(clusters: any[], finishedAt: number): ScanResult {
  return {
    startedAt: finishedAt - 1000,
    finishedAt,
    clusters,
    stats: { rootsScanned: 1, dirsVisited: 1, filesSeen: 0, bytesSeen: 0, denied: 0, longPathErrors: 0 },
    skipped: [],
  };
}

test('kaybolan hedef: missing, kumeden duser, missingBytes dogru', async () => {
  const c = cluster({
    key: 'k1',
    deleteTargets: [{ path: join(root, 'yok-klasor'), kind: 'whole', label: 'x', bytes: 500 }],
    reclaimableBytes: 500,
    totalBytes: 1000,
  });
  const scan = makeScan([c], Date.now() - 1000);
  const out = await verify.verifyScanTargets(scan);
  assert.equal(out.targets.length, 1);
  assert.equal(out.targets[0]!.status, 'missing');
  assert.equal(out.targets[0]!.toBytes, 0);
  assert.equal(out.targets[0]!.fromBytes, 500);
  const cl = out.scan.clusters[0]!;
  assert.deepEqual(cl!.deleteTargets, []);
  assert.equal(cl.reclaimableBytes, 0);
  assert.equal(cl.totalBytes, 1000);
  // missingBytes endpoint hesabi degil; burada targets uzerinden kontrol
});

test('degisen boyut: dosya eklenince changed, toBytes > fromBytes', async () => {
  const dir = join(root, 'degisen');
  await mkdir(dir, { recursive: true });
  const finishedAt = Date.now() - 100_000;
  const c = cluster({
    key: 'k2',
    deleteTargets: [{ path: dir, kind: 'whole', label: 'x', bytes: 1 }],
    reclaimableBytes: 1,
    totalBytes: 10,
  });
  const scan = makeScan([c], finishedAt);
  // dizine dosya ekle -> klasor mtime guncel
  await writeFile(join(dir, 'a.txt'), 'hello');
  const out = await verify.verifyScanTargets(scan);
  assert.equal(out.targets[0]!.status, 'changed');
  assert.ok(out.targets[0]!.toBytes > out.targets[0]!.fromBytes);
  const cl = out.scan.clusters[0]!;
  assert.equal(cl!.deleteTargets![0]!.bytes, out.targets[0]!.toBytes);
  assert.equal(cl.reclaimableBytes, out.targets[0]!.toBytes);
});

test('degismeyen hedef: finishedAt=now, ok, olcum yapilmaz', async () => {
  const dir = join(root, 'degismeyen');
  await mkdir(dir, { recursive: true });
  const now = Date.now() + 10;
  const c = cluster({
    key: 'k3',
    deleteTargets: [{ path: dir, kind: 'whole', label: 'x', bytes: 42 }],
    reclaimableBytes: 42,
    totalBytes: 42,
  });
  const scan = makeScan([c], now);
  const out = await verify.verifyScanTargets(scan, now);
  assert.equal(out.targets[0]!.status, 'ok');
  assert.equal(out.targets[0]!.fromBytes, 42);
  assert.equal(out.targets[0]!.toBytes, 42);
});

test('hedef kalmayan kume: deleteTargets [], reclaimableBytes 0, totalBytes ayni', async () => {
  const c = cluster({
    key: 'k4',
    deleteTargets: [{ path: join(root, 'yok2'), kind: 'whole', label: 'x', bytes: 7 }],
    reclaimableBytes: 7,
    totalBytes: 99,
  });
  const scan = makeScan([c], Date.now() - 1000);
  const out = await verify.verifyScanTargets(scan);
  const cl = out.scan.clusters[0]!;
  assert.deepEqual(cl!.deleteTargets, []);
  assert.equal(cl.reclaimableBytes, 0);
  assert.equal(cl.totalBytes, 99);
});

test('girdi mutasyona ugramaz', async () => {
  const c = cluster({
    key: 'k5',
    deleteTargets: [{ path: join(root, 'yok3'), kind: 'whole', label: 'x', bytes: 3 }],
    reclaimableBytes: 3,
    totalBytes: 5,
  });
  const scan = makeScan([c], Date.now() - 1000);
  const before = JSON.stringify(scan);
  await verify.verifyScanTargets(scan);
  const after = JSON.stringify(scan);
  assert.equal(before, after);
  assert.equal(scan.verifiedAt, undefined);
});

test('uc: cache yokken POST /api/scan/verify -> 200 scanAt null', async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'residue-api-verify-'));
  process.env.LOCALAPPDATA = tmpRoot;
  const { createApiServer } = await import('../src/web/server.ts');
  const created = createApiServer({ persistScan: false, envs: [] });
  const server = created.server;
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  const addr = server.address();
  const base = `http://127.0.0.1:${(addr as any).port}`;
  const r = await fetch(`${base}/api/scan/verify`, {
    method: 'POST',
    headers: { 'x-residue-token': created.token },
  });
  assert.equal(r.status, 200);
  const body = await r.json() as any;
  assert.equal(body.scanAt, null);
  assert.equal(body.checkedTargets, 0);
  server.closeAllConnections?.();
  await new Promise<void>((ok) => server.close(() => ok()));
  await rm(tmpRoot, { recursive: true, force: true });
});

test('uc: cache varken POST /api/scan/verify -> 200 alanlar', async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'residue-api-verify2-'));
  process.env.LOCALAPPDATA = tmpRoot;
  const cacheMod = await import('../src/store/scan-cache.ts');
  const finishedAt = Date.now() - 1000;
  const c = cluster({
    key: 'kv',
    deleteTargets: [{ path: join(tmpRoot, 'yokx'), kind: 'whole', label: 'x', bytes: 9 }],
    reclaimableBytes: 9,
    totalBytes: 9,
  });
  const scan: ScanResult = {
    startedAt: finishedAt - 1000,
    finishedAt,
    clusters: [c],
    stats: { rootsScanned: 1, dirsVisited: 1, filesSeen: 0, bytesSeen: 0, denied: 0, longPathErrors: 0 },
    skipped: [],
  };
  await cacheMod.saveScanCache(scan);
  const { createApiServer } = await import('../src/web/server.ts');
  const created = createApiServer({ persistScan: false, envs: [] });
  const server = created.server;
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  const addr = server.address();
  const base = `http://127.0.0.1:${(addr as any).port}`;
  const r = await fetch(`${base}/api/scan/verify`, {
    method: 'POST',
    headers: { 'x-residue-token': created.token },
  });
  assert.equal(r.status, 200);
  const body = await r.json() as any;
  assert.equal(body.scanAt, finishedAt);
  assert.equal(body.checkedTargets, 1);
  assert.equal(body.missing.length, 1);
  assert.equal(body.missingBytes, 9);
  server.closeAllConnections?.();
  await new Promise<void>((ok) => server.close(() => ok()));
  await rm(tmpRoot, { recursive: true, force: true });
});
