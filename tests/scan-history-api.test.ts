import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';

let root = '';
let server: Server;
let base = '';
let token = '';

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'residue-scan-history-api-'));
  process.env.LOCALAPPDATA = root;
  const dataDir = join(root, 'residue');
  await mkdir(join(dataDir, 'scans'), { recursive: true });

  const { createApiServer } = await import('../src/web/server.ts');
  const created = createApiServer({ persistScan: false, envs: [] });
  server = created.server;
  token = created.token;
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  base = `http://127.0.0.1:${(addr as any).port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((ok) => server.close(() => ok()));
  await rm(root, { recursive: true, force: true });
});

test('scan-history api: empty history', async () => {
  const r = await fetch(`${base}/api/scans`, { headers: { 'x-residue-token': token } });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { entries: unknown[]; limit: number };
  assert.deepEqual(body.entries, []);
  assert.equal(body.limit, 50);
});

test('scan-history api: append then read', async () => {
  const { appendScanHistory } = await import('../src/store/scan-history.ts');
  await appendScanHistory({
    id: 'sc-1',
    at: 123,
    clusters: 2,
    files: 5,
    bytes: 100,
    deletableBytes: 40,
    targets: 3,
  });
  const r = await fetch(`${base}/api/scans`, { headers: { 'x-residue-token': token } });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { entries: any[]; limit: number };
  assert.equal(body.entries.length, 1);
  assert.equal(body.entries[0].id, 'sc-1');
  assert.equal(body.entries[0].at, 123);
  assert.equal(body.entries[0].targets, 3);
});

test('scan-history api: invalid index.json returns []', async () => {
  const dataDir = join(root, 'residue');
  await writeFile(join(dataDir, 'scans', 'index.json'), '{not json', 'utf8');
  const r = await fetch(`${base}/api/scans`, { headers: { 'x-residue-token': token } });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { entries: unknown[] };
  assert.deepEqual(body.entries, []);
});