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
  root = await mkdtemp(join(tmpdir(), 'residue-profile-api-'));
  process.env.LOCALAPPDATA = root;
  const { createApiServer } = await import('../src/web/server.ts');
  const created = createApiServer({ persistScan: false, envs: [] });
  server = created.server;
  token = created.token;
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  base = `http://127.0.0.1:${addr.port}`;

  const finishedAt = Date.now();
  const scan = {
    startedAt: finishedAt,
    finishedAt,
    clusters: [
      {
        key: 'p-a',
        title: 'P A',
        archetype: 'pkg-manager-cache',
        parts: [{ path: 'C:\\Cache\\p-a', bytes: 1000, files: 10, lastTouched: finishedAt - 10 * 86400000, reclaimableBytes: 1000, origin: 'custom' }],
        totalBytes: 1000,
        reclaimableBytes: 1000,
        lastTouched: finishedAt - 10 * 86400000,
        evidence: { markers: ['cache'] },
        verdict: { risk: 'safe', kind: 'recommend', title: 't', what: 'w', consequence: 'c', because: [], preconditions: [], regenerability: 'regenerable', confidence: 'high' },
        deleteTargets: [{ path: 'C:\\Cache\\p-a', kind: 'whole', label: 'p a', bytes: 1000 }],
      },
      {
        key: 'p-b',
        title: 'P B',
        archetype: 'pkg-manager-cache',
        parts: [{ path: 'C:\\Cache\\p-b', bytes: 500, files: 5, lastTouched: finishedAt - 10 * 86400000, reclaimableBytes: 500, origin: 'custom' }],
        totalBytes: 500,
        reclaimableBytes: 500,
        lastTouched: finishedAt - 10 * 86400000,
        evidence: { markers: ['cache'] },
        verdict: { risk: 'safe', kind: 'recommend', title: 't', what: 'w', consequence: 'c', because: [], preconditions: [], regenerability: 'regenerable', confidence: 'high' },
        deleteTargets: [{ path: 'C:\\Cache\\p-b', kind: 'whole', label: 'p b', bytes: 500 }],
      },
    ],
    stats: { rootsScanned: 1, dirsVisited: 3, filesSeen: 0, bytesSeen: 0, denied: 0, longPathErrors: 0 },
    skipped: [],
  };
  const scansDir = join(root, 'residue', 'scans');
  await mkdir(scansDir, { recursive: true });
  await writeFile(join(scansDir, 'last-scan.json'), JSON.stringify({ version: 2, savedAt: finishedAt, scan }), 'utf8');
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((ok) => server.close(() => ok()));
  await rm(root, { recursive: true, force: true });
});

function hdr(extra: Record<string, string> = {}): Record<string, string> {
  return { 'x-residue-token': token, 'content-type': 'application/json', ...extra };
}

test('PROFILE API-01/02: settings default + normalize', async () => {
  const r1 = await fetch(`${base}/api/settings`, { headers: { 'x-residue-token': token } });
  assert.equal(r1.status, 200);
  const b1 = await r1.json() as { uiProfile: string };
  assert.equal(b1.uiProfile, 'hybrid');

  const r2 = await fetch(`${base}/api/settings`, { method: 'PUT', headers: hdr(), body: JSON.stringify({ uiProfile: 'vibe' }) });
  assert.equal(r2.status, 200);
  const b2 = await r2.json() as { uiProfile: string };
  assert.equal(b2.uiProfile, 'vibe');

  const r3 = await fetch(`${base}/api/settings`, { method: 'PUT', headers: hdr(), body: JSON.stringify({ uiProfile: 'admin' }) });
  assert.equal(r3.status, 200);
  const b3 = await r3.json() as { uiProfile: string };
  assert.equal(b3.uiProfile, 'hybrid');
});

test('PROFILE API-03: /api/disk identical across profiles', async () => {
  // reset to hybrid first
  await fetch(`${base}/api/settings`, { method: 'PUT', headers: hdr(), body: JSON.stringify({ uiProfile: 'hybrid' }) });
  const r0 = await fetch(`${base}/api/disk`, { headers: { 'x-residue-token': token } });
  const snap0 = JSON.stringify(await r0.json());

  for (const p of ['developer', 'vibe', 'hybrid']) {
    await fetch(`${base}/api/settings`, { method: 'PUT', headers: hdr(), body: JSON.stringify({ uiProfile: p }) });
    const r = await fetch(`${base}/api/disk`, { headers: { 'x-residue-token': token } });
    const snap = JSON.stringify(await r.json());
    assert.equal(snap, snap0, p);
  }
});

test('PROFILE API-04: plan phrase and counts identical across profiles', async () => {
  const results: Array<{ phrase: string; targets: number; totalBytes: number }> = [];
  for (const p of ['developer', 'vibe', 'hybrid']) {
    await fetch(`${base}/api/settings`, { method: 'PUT', headers: hdr(), body: JSON.stringify({ uiProfile: p }) });
    const r = await fetch(`${base}/api/plan`, { method: 'POST', headers: hdr(), body: JSON.stringify({ keys: ['p-a', 'p-b'], mode: 'recycle' }) });
    assert.equal(r.status, 200);
    const b = await r.json() as { phrase: string; plan: { targets?: unknown[]; totalBytes?: number } };
    results.push({ phrase: b.phrase, targets: b.plan?.targets?.length ?? 0, totalBytes: b.plan?.totalBytes ?? 0 });
  }
  const first = results[0]!;
  // Tautoloji kilidi: plan gercekten hedef uretmis olmali (0/0 karsilastirma kanit degildir).
  assert.equal(first.targets, 2, 'plan iki hedef uretmeli');
  assert.equal(first.totalBytes, 1500, 'plan bayt toplami fixture ile ayni olmali');
  for (const res of results) {
    assert.equal(res.phrase, first.phrase);
    assert.equal(res.targets, first.targets);
    assert.equal(res.totalBytes, first.totalBytes);
  }
});

test('PROFILE API-05: settings change does not start scan', async () => {
  const before = await fetch(`${base}/api/scan/status`, { headers: { 'x-residue-token': token } });
  const bj = await before.json() as { scanning: boolean };
  assert.equal(bj.scanning, false);

  await fetch(`${base}/api/settings`, { method: 'PUT', headers: hdr(), body: JSON.stringify({ uiProfile: 'vibe' }) });

  const after = await fetch(`${base}/api/scan/status`, { headers: { 'x-residue-token': token } });
  const aj = await after.json() as { scanning: boolean };
  assert.equal(aj.scanning, false);
});