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
  root = await mkdtemp(join(tmpdir(), 'residue-plan-name-test-'));
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
 * W2-c: plan adi (`name`) + `PATCH /api/plan/:id`.
 *
 * SIRA ONEMLI: plan kayitlari modul degiskenlerinde yasar; tek plan
 * kurulur, adi sonraki adimlarda korunur.
 */
let planId = '';
let expiresAt = 0;

interface PlanBody {
  planId?: string;
  name?: string;
  expiresAt?: number;
  plan?: { totalBytes?: number };
}

function request(
  method: string,
  path: string,
  body: Record<string, unknown> | null,
  expect: number,
): Promise<PlanBody | null> {
  return (async () => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: {
        'x-residue-token': token,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
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

test('POST /api/plan ad verilmezse bos string döndürür', async () => {
  const finishedAt = Date.now();
  const scan = {
    startedAt: finishedAt,
    finishedAt,
    clusters: [
      cluster({
        key: 'name-a',
        deleteTargets: [
          { path: 'C:\\Cache\\name-a', kind: 'whole', label: 'name a', bytes: 700 },
        ],
      }),
      cluster({
        key: 'name-b',
        deleteTargets: [
          { path: 'C:\\Cache\\name-b', kind: 'whole', label: 'name b', bytes: 500 },
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

  const created = await request('POST', '/api/plan', { keys: ['name-a'], mode: 'recycle' }, 200);
  assert.ok(created?.planId);
  assert.equal(created.name, '');
  planId = created.planId!;
  expiresAt = created.expiresAt!;
  assert.ok(expiresAt > 0);
});

test('PATCH ad trim eder; kimlik ve süre KORUNUR', async () => {
  const renamed = await request(
    'PATCH',
    `/api/plan/${planId}`,
    { name: '  Haftalik temizlik  ' },
    200,
  );
  assert.ok(renamed);
  assert.equal(renamed.planId, planId);
  assert.equal(renamed.name, 'Haftalik temizlik');
  assert.equal(renamed.expiresAt, expiresAt); // TTL degismez
  assert.equal(renamed.plan?.totalBytes, 700);
});

test('POST /api/plan/add sonrasi ad korunur', async () => {
  const added = await request(
    'POST',
    '/api/plan/add',
    { planId, keys: ['name-b'] },
    200,
  );
  assert.ok(added);
  assert.equal(added.planId, planId);
  // W2-g: ekleme icerigi degistirdigi icin TTL yenilenir (>= onceki
  // deger); "expiresAt degismez" eski kosulu yeni kuralla celisir.
  assert.ok(added.expiresAt! >= expiresAt);
  assert.equal(added.name, 'Haftalik temizlik');
});

test('gecersiz ad 400; plan degismez', async () => {
  await request('PATCH', `/api/plan/${planId}`, { name: '   ' }, 400);
  await request(
    'PATCH',
    `/api/plan/${planId}`,
    { name: 'a'.repeat(61) },
    400,
  );
  // Hatali istekler plani DEGISTIRMEDI: ayni kimlik + ayni ad.
  const live = await getPlan();
  assert.equal(live?.planId, planId);
  assert.equal(live?.name, 'Haftalik temizlik');
  assert.equal(live?.plan?.totalBytes, 1200);
  // 60 karakter sinirdadir; 61 -> 400 yukarida dogrulandi.
  const ok = await request('PATCH', `/api/plan/${planId}`, { name: 'a'.repeat(60) }, 200);
  assert.equal(ok?.name, 'a'.repeat(60));
});

test('bilinmeyen kimlik 404', async () => {
  await request('PATCH', '/api/plan/yok', { name: 'x' }, 404);
});
