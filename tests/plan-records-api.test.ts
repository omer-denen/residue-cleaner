import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { cluster } from './helpers.ts';

let root = '';
let server: Server;
let base = '';
let token = '';

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'residue-plan-records-api-'));
  process.env.LOCALAPPDATA = root;
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

test('GET /api/plans bos', async () => {
  const r = await fetch(`${base}/api/plans`, { headers: { 'x-residue-token': token } });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { records: unknown[]; counts: Record<string, number> };
  assert.deepEqual(body.records, []);
  assert.deepEqual(body.counts, { pending: 0, executed: 0, cancelled: 0, failed: 0 });
});

test('POST /api/plans bos clusterKeys 400 ve bogus source 400', async () => {
  const r1 = await fetch(`${base}/api/plans`, {
    method: 'POST',
    headers: { 'x-residue-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ clusterKeys: [] }),
  });
  assert.equal(r1.status, 400);

  const finishedAt = Date.now();
  const scan = {
    startedAt: finishedAt,
    finishedAt,
    clusters: [cluster({ key: 'panel-a' })],
    stats: { rootsScanned: 1, dirsVisited: 1, filesSeen: 0, bytesSeen: 0, denied: 0, longPathErrors: 0 },
    skipped: [],
  };
  const scansDir = join(root, 'residue', 'scans');
  await mkdir(scansDir, { recursive: true });
  await writeFile(join(scansDir, 'last-scan.json'), JSON.stringify({ version: 2, savedAt: finishedAt, scan }), 'utf8');

  const r2 = await fetch(`${base}/api/plans`, {
    method: 'POST',
    headers: { 'x-residue-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ clusterKeys: ['panel-a'], source: 'bogus' }),
  });
  assert.equal(r2.status, 400);
});

test('POST /api/plans basarili 201', async () => {
  const finishedAt = Date.now();
  const scan = {
    startedAt: finishedAt,
    finishedAt,
    clusters: [cluster({ key: 'panel-a' })],
    stats: { rootsScanned: 1, dirsVisited: 1, filesSeen: 0, bytesSeen: 0, denied: 0, longPathErrors: 0 },
    skipped: [],
  };
  const scansDir = join(root, 'residue', 'scans');
  await mkdir(scansDir, { recursive: true });
  await writeFile(join(scansDir, 'last-scan.json'), JSON.stringify({ version: 2, savedAt: finishedAt, scan }), 'utf8');

  const created = await fetch(`${base}/api/plans`, {
    method: 'POST',
    headers: { 'x-residue-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ clusterKeys: ['panel-a'], source: 'dashboard' }),
  });
  assert.equal(created.status, 201);
  const body = (await created.json()) as { record: any; plan: any };
  assert.equal(body.record.status, 'pending');
  assert.ok(body.record.planId);
  assert.ok(body.record.bytes > 0);
  assert.equal(body.plan.planId, body.record.planId);
});

test('GET /api/plans kayit en ustte', async () => {
  const r = await fetch(`${base}/api/plans`, { headers: { 'x-residue-token': token } });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { records: any[]; counts: { pending: number } };
  assert.ok(body.records.length >= 1);
  assert.equal(body.counts.pending, 1);
});

// Kalicilik DISKTEN dogrulanir: ikinci bir sunucu acmak test surecini
// asili birakiyordu (undici keep-alive soketleri). Depo dosyasi + yukleyici
// ayni kaniti verir; HTTP katmani yukarida zaten sinandi.
test('kalıcılık: kayıt diske yazıldı ve yeniden yüklenebiliyor', async () => {
  const { loadPlanRecords, planRecordsPath } = await import('../src/store/plan-records.ts');
  const file = planRecordsPath();
  assert.ok(file.endsWith('plans.json'));
  const fromDisk = await loadPlanRecords();
  assert.ok(fromDisk.length >= 1);
  assert.equal(fromDisk[0]!.status, 'pending');
});