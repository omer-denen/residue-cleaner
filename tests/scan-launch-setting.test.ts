import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';

let root = '';
let server: Server;
let base = '';
let token = '';

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'residue-scanlaunch-test-'));
  process.env.LOCALAPPDATA = root;
  const { createApiServer } = await import('../src/web/server.ts');
  const created = createApiServer({ persistScan: false, envs: [] });
  server = created.server;
  token = created.token;
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  base = `http://127.0.0.1:${(addr as { port: number }).port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((ok) => server.close(() => ok()));
  await rm(root, { recursive: true, force: true });
});

test('varsayilan settings.scanOnLaunch === always', async () => {
  const r = await fetch(`${base}/api/settings`, {
    headers: { 'x-residue-token': token },
  });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { scanOnLaunch?: string };
  assert.equal(body.scanOnLaunch, 'always');
});

test('PUT scanOnLaunch daily -> 200, GET ayni', async () => {
  const put = await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: { 'x-residue-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ scanOnLaunch: 'daily' }),
  });
  assert.equal(put.status, 200);
  const saved = (await put.json()) as { scanOnLaunch?: string };
  assert.equal(saved.scanOnLaunch, 'daily');

  const get = await fetch(`${base}/api/settings`, {
    headers: { 'x-residue-token': token },
  });
  assert.equal(get.status, 200);
  const body = (await get.json()) as { scanOnLaunch?: string };
  assert.equal(body.scanOnLaunch, 'daily');
});

test('gecersiz scanOnLaunch -> varsayilan always kalir (400 degil)', async () => {
  const put = await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: { 'x-residue-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ scanOnLaunch: 'sometimes' }),
  });
  assert.equal(put.status, 200);
  const saved = (await put.json()) as { scanOnLaunch?: string };
  assert.equal(saved.scanOnLaunch, 'always');
});

test('scanCacheHours/vaultRetentionDays davranisi degismez', async () => {
  const put = await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: { 'x-residue-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ scanCacheHours: 12, vaultRetentionDays: 14 }),
  });
  assert.equal(put.status, 200);
  const saved = (await put.json()) as {
    scanCacheHours?: number;
    vaultRetentionDays?: number;
  };
  assert.equal(saved.scanCacheHours, 12);
  assert.equal(saved.vaultRetentionDays, 14);
});