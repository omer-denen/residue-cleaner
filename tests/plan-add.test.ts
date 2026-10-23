import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { cluster, verdict } from './helpers.ts';

let root = '';
let server: Server;
let base = '';
let token = '';

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'residue-plan-add-test-'));
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

/**
 * W2-a: plana EKLEME (`addToPlan`) + coklu cikarma.
 *
 * SIRA ONEMLI: plan kayitlari modul degiskenlerinde yasar; once plan
 * kurulur, eklemeler oyala, sonra bosaltilir. `GET /api/plan` en son
 * gecerli plani dondurdugu icin "yeni plan kur" testi SONDA calisir.
 */
let planId = '';
let expiresAt = 0;
let newPlanId = '';

interface PlanBody {
  planId?: string;
  expiresAt?: number;
  requiresPhrase?: boolean;
  requiresHighAck?: boolean;
  plan?: { clusters?: Array<{ key?: string }>; targets?: unknown[]; totalBytes?: number };
  panel?: { keys?: string[]; groups?: Array<{ key?: string; bytes?: number }> };
}

function post(path: string, body: Record<string, unknown>, expect: number): Promise<PlanBody | null> {
  return (async () => {
    const r = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'x-residue-token': token, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(r.status, expect);
    if (expect === 204) return null;
    return (await r.json()) as PlanBody;
  })();
}

async function getPlan(): Promise<PlanBody | null> {
  const r = await fetch(`${base}/api/plan`, { headers: { 'x-residue-token': token } });
  assert.equal(r.status, 200);
  return (await r.json()) as PlanBody | null;
}

test('ekleme plan kimligini ve suresini korur; toplamlar yeniden hesaplanir', async () => {
  const finishedAt = Date.now();
  const scan = {
    startedAt: finishedAt,
    finishedAt,
    clusters: [
      cluster({
        key: 'panel-a',
        deleteTargets: [
          { path: 'C:\\Cache\\panel-a-old', kind: 'older', minAgeDays: 3, label: 'panel a eski', bytes: 200 },
          { path: 'C:\\Cache\\panel-a', kind: 'whole', label: 'panel a', bytes: 700 },
        ],
      }),
      cluster({
        key: 'panel-b',
        deleteTargets: [
          { path: 'C:\\Cache\\panel-b', kind: 'whole', label: 'panel b', bytes: 500 },
        ],
      }),
      // Hedefsiz kume: eklenmeye calisilinca 400 vermeli.
      cluster({ key: 'panel-empty', deleteTargets: [] }),
      // Yuksek riskli kume: risk yeniden hesabi icin.
      cluster({
        key: 'panel-high',
        verdict: verdict({ risk: 'high', kind: 'ask' }),
        deleteTargets: [
          { path: 'C:\\Cache\\panel-high', kind: 'whole', label: 'panel high', bytes: 400 },
        ],
      }),
    ],
    stats: { rootsScanned: 1, dirsVisited: 5, filesSeen: 0, bytesSeen: 0, denied: 0, longPathErrors: 0 },
    skipped: [],
  };
  const scansDir = join(root, 'residue', 'scans');
  await mkdir(scansDir, { recursive: true });
  await writeFile(join(scansDir, 'last-scan.json'), JSON.stringify({
    version: 2,
    savedAt: finishedAt,
    scan,
  }), 'utf8');

  const created = await post('/api/plan', { keys: ['panel-a'], mode: 'recycle' }, 200);
  assert.ok(created?.planId);
  assert.equal(created.plan?.totalBytes, 900);
  planId = created.planId!;
  expiresAt = created.expiresAt!;
  assert.ok(expiresAt > 0);
  // Yalniz guvenli kume: yazili onay da acik isaretleme de yok.
  assert.equal(created.requiresPhrase, false);
  assert.equal(created.requiresHighAck, false);

  const added = await post(
    '/api/plan/add',
    { planId, keys: ['panel-b'] },
    200,
  );
  assert.ok(added);
  // Plan kimligi ve suresi KORUNUR (TTL uzatilmaz).
  assert.equal(added.planId, planId);
  assert.equal(added.expiresAt, expiresAt);
  assert.equal(added.plan?.totalBytes, 1400);
  assert.deepEqual(added.panel?.keys, ['panel-a', 'panel-b']);
  const cloned = await getPlan();
  assert.equal(cloned?.planId, planId);
  assert.equal(cloned?.plan?.totalBytes, 1400);
});

test('ekleme idempotenttir: ayni anahtar plani degistirmez', async () => {
  const again = await post('/api/plan/add', { planId, keys: ['panel-b'] }, 200);
  assert.ok(again);
  assert.equal(again.planId, planId);
  assert.equal(again.expiresAt, expiresAt);
  assert.equal(again.plan?.totalBytes, 1400);
  assert.deepEqual(again.panel?.keys, ['panel-a', 'panel-b']);
});

test('hedefsiz kume 400; plan degismeden kalir', async () => {
  await post('/api/plan/add', { planId, keys: ['panel-empty'] }, 400);
  const live = await getPlan();
  assert.equal(live?.planId, planId);
  assert.equal(live?.plan?.totalBytes, 1400);
  assert.ok(!(live?.panel?.keys ?? []).includes('panel-empty'));
});

test('bilinmeyen plan 404; bos anahtar listesi 400', async () => {
  await post('/api/plan/add', { planId: 'yok', keys: ['panel-b'] }, 404);
  await post('/api/plan/add', { planId, keys: [] }, 400);
  await post('/api/plan/add', { planId }, 400);
  const live = await getPlan();
  assert.equal(live?.planId, planId);
});

test('yuksek riskli ekleme onay gereksinimlerini yeniden hesaplar', async () => {
  const added = await post('/api/plan/add', { planId, keys: ['panel-high'] }, 200);
  assert.ok(added);
  assert.equal(added.planId, planId);
  assert.equal(added.plan?.totalBytes, 1800);
  assert.equal(added.requiresPhrase, true);
  assert.equal(added.requiresHighAck, true);

  // Cikarildiginda yalniz guvenli kumeler kalir: ikisi de false.
  const removed = await post('/api/plan/remove', { planId, keys: ['panel-high'] }, 200);
  assert.ok(removed);
  assert.equal(removed.planId, planId);
  assert.equal(removed.plan?.totalBytes, 1400);
  assert.equal(removed.requiresPhrase, false);
  assert.equal(removed.requiresHighAck, false);
});

test('coklu cikarma tek istekte plani bosaltir; ucu null doner', async () => {
  const out = await post('/api/plan/remove', { planId, keys: ['panel-a', 'panel-b'] }, 200);
  assert.equal(out, null);
  const live = await getPlan();
  assert.equal(live, null);
});

test('planda degilse cikarma 404', async () => {
  await post('/api/plan/remove', { planId, keys: ['panel-a'] }, 404);
});

test('plan yokken tek oge yeni plan kurar; kismi cikarma kimligi korur', async () => {
  const created = await post('/api/plan/add', { key: 'panel-a' }, 200);
  assert.ok(created?.planId);
  assert.notEqual(created.planId, planId); // yeni kayit, eski kimlik degil
  assert.equal(created.plan?.totalBytes, 900);
  newPlanId = created.planId!;

  const added = await post('/api/plan/add', { planId: newPlanId, key: 'panel-b' }, 200);
  assert.equal(added?.planId, newPlanId);
  assert.deepEqual(added?.panel?.keys, ['panel-a', 'panel-b']);

  // Kismi cikarma: kimlik korunur, yalniz kalan kume gorunur.
  const partial = await post('/api/plan/remove', { planId: newPlanId, keys: ['panel-a'] }, 200);
  assert.ok(partial);
  assert.equal(partial.planId, newPlanId);
  assert.deepEqual(partial.panel?.keys, ['panel-b']);
  assert.equal(partial.plan?.totalBytes, 500);
});
