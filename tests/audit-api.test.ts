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
  root = await mkdtemp(join(tmpdir(), 'residue-audit-api-'));
  process.env.LOCALAPPDATA = root;
  const dataDir = join(root, 'residue');
  await mkdir(join(dataDir, 'journals'), { recursive: true });

  const now = Date.now();
  const journalPath = join(dataDir, 'journals', 'j1.jsonl');
  await writeFile(
    journalPath,
    [
      JSON.stringify({ kind: 'item', path: 'C:\\\\a', bytes: 10 }),
      JSON.stringify({ kind: 'item', path: 'C:\\\\b', bytes: 20 }),
    ].join('\n') + '\n',
    'utf8',
  );

  const events = [
    {
      at: new Date(now).toISOString(),
      event: 'delete.done',
      jobId: 'j1',
      planId: 'p1',
      mode: 'recycle',
      freed: 30,
      removed: 2,
      skipped: 0,
      failed: 0,
      journal: journalPath,
    },
    {
      at: new Date(now - 3_600_000).toISOString(),
      event: 'vault.restore',
      id: 'v1',
      to: 'C:\\\\restored',
      verified: true,
    },
    {
      at: new Date(now - 7_200_000).toISOString(),
      event: 'vault.restore.failed',
      id: 'v2',
      from: 'C:\\\\x',
      code: 'EPERM',
      reason: 'nope',
    },
    {
      at: new Date(now - 3 * 86_400_000).toISOString(),
      event: 'vault.purge-items',
      ids: ['z'],
      items: 1,
      bytes: 5,
      failed: 0,
    },
  ];
  await writeFile(
    join(dataDir, 'audit.log'),
    events.map((e) => JSON.stringify(e)).join('\n') + '\n',
    'utf8',
  );

  const { createApiServer } = await import('../src/web/server.ts');
  const created = createApiServer({ persistScan: false, envs: [] });
  server = created.server;
  token = created.token;
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((ok) => server.close(() => ok()));
  await rm(root, { recursive: true, force: true });
});

test('audit api: token', async () => {
  const noToken = await fetch(`${base}/api/audit`);
  assert.equal(noToken.status, 401);
  const withToken = await fetch(`${base}/api/audit`, { headers: { 'x-residue-token': token } });
  assert.equal(withToken.status, 200);
  const body = (await withToken.json()) as { events: unknown[] };
  assert.ok(Array.isArray(body.events));
});

test('audit api: kind filter', async () => {
  const r = await fetch(`${base}/api/audit?kind=restore`, { headers: { 'x-residue-token': token } });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { events: { kind: string }[]; counts: { total: number } };
  assert.ok(body.events.every((e) => e.kind === 'restore'));
  assert.equal(body.counts.total, 4);
});

test('audit api: since filters old', async () => {
  const r = await fetch(`${base}/api/audit?since=24h`, { headers: { 'x-residue-token': token } });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { events: { event: string }[] };
  assert.ok(!body.events.some((e) => e.event === 'vault.purge-items'));
});

test('audit api: invalid kind 400', async () => {
  const bad = await fetch(`${base}/api/audit?kind=xyz`, { headers: { 'x-residue-token': token } });
  assert.equal(bad.status, 400);
});

test('audit api: missing audit.log', async () => {
  const emptyRoot = await mkdtemp(join(tmpdir(), 'residue-audit-empty-'));
  const prev = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = emptyRoot;
  const { createApiServer } = await import('../src/web/server.ts');
  const created = createApiServer({ persistScan: false, envs: [] });
  const srv = created.server;
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
  const addr = srv.address() as { port: number };
  const r = await fetch(`http://127.0.0.1:${addr.port}/api/audit`, { headers: { 'x-residue-token': created.token } });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { events: unknown[]; auditFileExists: boolean };
  assert.deepEqual(body.events, []);
  assert.equal(body.auditFileExists, false);
  srv.closeAllConnections?.();
  await new Promise<void>((ok) => srv.close(() => ok()));
  process.env.LOCALAPPDATA = prev;
  await rm(emptyRoot, { recursive: true, force: true });
});

test('audit api: journal paths', async () => {
  const r = await fetch(`${base}/api/audit?kind=delete`, { headers: { 'x-residue-token': token } });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { events: { paths?: string[]; pathsTruncated?: boolean }[] };
  assert.ok(body.events.length > 0);
  assert.deepEqual((body.events[0] as any).paths, ['C:\\\\a', 'C:\\\\b']);
  assert.ok((((body.events[0] as any).paths?.length ?? 0) <= 200));
});
