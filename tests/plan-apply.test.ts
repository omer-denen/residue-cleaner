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
  root = await mkdtemp(join(tmpdir(), 'residue-plan-apply-test-'));
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
 * W2-g: "Planı uygula" aninda plan GUNCEL taramadan yeniden kurulur
 * (taze hedefler + guard) ve 10 dakikalik TTL O ANDA baslar
 * (`armed: true`). Checkbox ile kurulan plan uygulanmamistir
 * (`armed: false`); icerik degisir/add/cikar olursa yeniden
 * uygulanmali olur (`armed: false` + TTL yenilenir).
 *
 * Kurulum `tests/plan-add.test.ts` deseni. SIRA ONEMLI:
 * `GET /api/plan` en son gecerli plani dondurur; plan kurma/atma/uygulama
 * akisi bu sirayla tasarlandi (atilan planlar yokolur).
 */
let planId = '';

interface PlanBody {
  planId?: string;
  expiresAt?: number;
  armed?: boolean;
  ok?: boolean;
  plan?: { totalBytes?: number };
  panel?: { keys?: string[] };
}

function post(
  path: string,
  body: Record<string, unknown>,
  expect: number,
): Promise<PlanBody | null> {
  return (async () => {
    const r = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'x-residue-token': token, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(r.status, expect);
    if (expect >= 400) return null;
    return (await r.json()) as PlanBody;
  })();
}

async function getPlan(): Promise<PlanBody | null> {
  const r = await fetch(`${base}/api/plan`, { headers: { 'x-residue-token': token } });
  assert.equal(r.status, 200);
  return (await r.json()) as PlanBody | null;
}

async function writeScanFile(keys: string[]): Promise<void> {
  const finishedAt = Date.now();
  const scan = {
    startedAt: finishedAt,
    finishedAt,
    clusters: keys.map((key) =>
      cluster({
        key,
        deleteTargets: [
          { path: `C:\\Cache\\${key}`, kind: 'whole', label: key, bytes: 100 },
        ],
      }),
    ),
    stats: { rootsScanned: 1, dirsVisited: keys.length, filesSeen: 0, bytesSeen: 0, denied: 0, longPathErrors: 0 },
    skipped: [],
  };
  const scansDir = join(root, 'residue', 'scans');
  await mkdir(scansDir, { recursive: true });
  await writeFile(join(scansDir, 'last-scan.json'), JSON.stringify({
    version: 2,
    savedAt: finishedAt,
    scan,
  }), 'utf8');
}

test('POST /api/plan ile kurulan plan uygulanmamistir (armed: false)', async () => {
  await writeScanFile(['apply-a', 'apply-b']);
  const created = await post('/api/plan', { keys: ['apply-a'], mode: 'recycle' }, 200);
  assert.ok(created?.planId);
  assert.equal(created.armed, false);
  planId = created.planId!;
});

test('POST /api/plan/apply: guncel taramadan yeniden kurulur (armed, yeni kimlik, 10 dk TTL)', async () => {
  const t0 = Date.now();
  const applied = await post('/api/plan/apply', { planId }, 200);
  const t1 = Date.now();
  assert.ok(applied);
  const ttl = 10 * 60_000;
  // Plan guncel taramadan REBUILD edildi: armed: true, YENI kimlik.
  assert.equal(applied.armed, true);
  assert.notEqual(applied.planId, planId);
  assert.deepEqual(applied.panel?.keys, ['apply-a']);
  assert.equal(applied.plan?.totalBytes, 100);
  // TTL O ANDA baslar: expiresAt ≈ now + 10 dk (±5 sn pencere).
  assert.ok(
    applied.expiresAt! >= t0 + ttl - 5_000 && applied.expiresAt! <= t1 + ttl + 5_000,
    `expiresAt beklenmedik: ${applied.expiresAt}`,
  );
  planId = applied.planId!;
  const live = await getPlan();
  assert.equal(live?.planId, planId);
  assert.equal(live?.armed, true);
});

test('apply sonrasi ekleme icerigi degistirdigi icin armed: false olur ve TTL yenilenir', async () => {
  const prevExpires = (await getPlan())?.expiresAt!;
  const added = await post('/api/plan/add', { planId, keys: ['apply-b'] }, 200);
  assert.ok(added);
  // icerik degisti -> yeniden uygulanmali (armed: false) + TTL yenilenir.
  assert.equal(added.armed, false);
  assert.ok(added.expiresAt! >= prevExpires);
  assert.deepEqual(added.panel?.keys, ['apply-a', 'apply-b']);
});

test('uygulanmamis plan discard ile atilir; GET /api/plan null döner', async () => {
  const discarded = await post('/api/plan/discard', { planId }, 200);
  assert.ok(discarded?.ok);
  const live = await getPlan();
  assert.equal(live, null);
  // Atilan plana tekrar islem hedeflenemez.
  await post('/api/plan/apply', { planId }, 404);
  await post('/api/plan/discard', { planId }, 404);
});

test('apply sonrasi discard 409; plan durur (10 dk kurali)', async () => {
  const created = await post('/api/plan', { keys: ['apply-a'], mode: 'recycle' }, 200);
  assert.ok(created?.planId);
  const applied = await post('/api/plan/apply', { planId: created.planId }, 200);
  assert.ok(applied);
  const r = await fetch(`${base}/api/plan/discard`, {
    method: 'POST',
    headers: { 'x-residue-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ planId: applied.planId }),
  });
  assert.equal(r.status, 409);
  const body = (await r.json()) as { error?: string };
  assert.equal(body.error, 'Uygulanmis plan atilamaz');
  // 409 ile plan degismez: hâlâ yerinde ve armed.
  const live = await getPlan();
  assert.equal(live?.planId, applied.planId);
  assert.equal(live?.armed, true);
});

test('bilinmeyen planId 404; bos gövde 400 (apply + discard)', async () => {
  await post('/api/plan/apply', { planId: 'yok' }, 404);
  await post('/api/plan/discard', { planId: 'yok' }, 404);
  await post('/api/plan/apply', {}, 400);
  await post('/api/plan/discard', {}, 400);
  await post('/api/plan/apply', { planId: '' }, 400);
  await post('/api/plan/discard', { planId: '' }, 400);
});

test('rebuildPlan: taramada bulunamayan anahtar 409; eski plan korunur', async () => {
  const { DeleteService } = await import('../src/services/delete-service.ts');
  const svc = new DeleteService(() => {});
  const finishedAt = Date.now();
  const mkScan = (keys: string[]) => ({
    startedAt: finishedAt,
    finishedAt,
    clusters: keys.map((key) =>
      cluster({
        key,
        deleteTargets: [
          { path: `C:\\Cache\\${key}`, kind: 'whole', label: key, bytes: 100 },
        ],
      }),
    ),
    stats: { rootsScanned: 1, dirsVisited: keys.length, filesSeen: 0, bytesSeen: 0, denied: 0, longPathErrors: 0 },
    skipped: [],
  });

  const plan = svc.createPlan(mkScan(['taze-a', 'kayip-x']), ['taze-a', 'kayip-x'], 'recycle');
  assert.equal(plan.armed, false);

  // Guncel taramada "kayip-x" yok: 409 + deterministik mesaj.
  assert.throws(
    () => svc.rebuildPlan(plan.planId, mkScan(['taze-a'])),
    (err: { status?: number; message?: string }) => {
      assert.equal(err.status, 409);
      assert.match(err.message ?? '', /Guncel taramada bulunamayan ogeler: kayip-x/u);
      return true;
    },
  );
  // 409 plan kaydini DEGISTIRMEZ; plan hâlâ yerinde (TTL suresi dolmus degil).
  const still = svc.currentPlan();
  assert.ok(still);
  assert.equal(still?.planId, plan.planId);
});

test('rebuildPlan: scan yoksa 400; basarili rebuild armed: true; eski kayit silinir', async () => {
  const { DeleteService } = await import('../src/services/delete-service.ts');
  const svc = new DeleteService(() => {});
  const finishedAt = Date.now();
  const scan = {
    startedAt: finishedAt,
    finishedAt,
    clusters: [
      cluster({
        key: 'rebuild-a',
        verdict: verdict({ risk: 'low', kind: 'recommend' }),
        deleteTargets: [
          { path: 'C:\\Cache\\rebuild-a', kind: 'whole', label: 'rebuild a', bytes: 100 },
        ],
      }),
    ],
    stats: { rootsScanned: 1, dirsVisited: 1, filesSeen: 0, bytesSeen: 0, denied: 0, longPathErrors: 0 },
    skipped: [],
  };
  const plan = svc.createPlan(scan, ['rebuild-a'], 'recycle');

  // Scan yok: createPlan ile ayni metin, 400.
  assert.throws(
    () => svc.rebuildPlan(plan.planId, null),
    (err: { status?: number; message?: string }) => {
      assert.equal(err.status, 400);
      assert.equal(err.message, 'Once tarama yapilmali');
      return true;
    },
  );

  // Basarili rebuild: armed: true; ESKI kayit silinmis (bellek sizintisi yok).
  const rebuilt = svc.rebuildPlan(plan.planId, scan);
  assert.equal(rebuilt.armed, true);
  assert.notEqual(rebuilt.planId, plan.planId);
  assert.ok(rebuilt.expiresAt > Date.now() + 9 * 60_000);
  assert.equal(svc.currentPlan()?.planId, rebuilt.planId);

  // Bilinmeyen plan 404 (removeFromPlan ile ayni metin).
  assert.throws(
    () => svc.rebuildPlan('yok', scan),
    (err: { status?: number; message?: string }) => {
      assert.equal(err.status, 404);
      assert.equal(err.message, 'Plan bulunamadi veya zaten kullanildi');
      return true;
    },
  );
});
