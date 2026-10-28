import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';

let server: Server;
let base = '';
let token = '';

before(async () => {
  const root = await mkdtemp(join(tmpdir(), 'residue-bg-api-'));
  process.env.LOCALAPPDATA = root;
  await mkdir(join(root, 'residue', 'journals'), { recursive: true });
  const { createApiServer } = await import('../src/web/server.ts');
  const created = createApiServer({ persistScan: false, envs: [] });
  server = created.server;
  token = created.token;
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  base = 'http://127.0.0.1:' + (addr as { port: number }).port;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((ok) => server.close(() => ok()));
});

test('activity api: 200 + 6 rows + automatic false', async () => {
  const r = await fetch(base + '/api/activity', { headers: { 'x-residue-token': token } });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { busy: unknown; automatic: boolean; rows: unknown[] };
  assert.equal(body.automatic, false);
  assert.equal(body.rows.length, 6);
});

test('activity api: tokenless 401', async () => {
  const r = await fetch(base + '/api/activity');
  assert.equal(r.status, 401);
});
