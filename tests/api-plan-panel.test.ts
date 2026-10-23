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
  root = await mkdtemp(join(tmpdir(), 'residue-api-plan-test-'));
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

// Sag panel plan gorunumu + plandan cikarma (plan paneli).
// Plan kayitlari bu dosyadaki testler arasinda modul degiskenlerinde tasinir.
let planId = '';
let firstTargetId = '';
let remainingIds: string[] = [];

/**
 * SIRA ONEMLI: bu dosyadaki testler onbellege yazilan taramayi kullanir;
 * plan olusturma testi once calismalidir.
 */
test('plan olusturur; panel sayileri plandan dogrulanir', async () => {
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
    ],
    stats: { rootsScanned: 1, dirsVisited: 3, filesSeen: 0, bytesSeen: 0, denied: 0, longPathErrors: 0 },
    skipped: [],
  };
  const scansDir = join(root, 'residue', 'scans');
  await mkdir(scansDir, { recursive: true });
  await writeFile(join(scansDir, 'last-scan.json'), JSON.stringify({
    version: 2,
    savedAt: finishedAt,
    scan,
  }), 'utf8');

  const created = await fetch(`${base}/api/plan`, {
    method: 'POST',
    headers: { 'x-residue-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ keys: ['panel-a', 'panel-b'], mode: 'recycle' }),
  });
  assert.equal(created.status, 200);
  const body = (await created.json()) as {
    planId?: string;
    plan?: { clusters?: unknown[]; targets?: unknown[]; totalBytes?: number };
    panel?: {
      keys?: string[];
      targetCount?: number;
      clusterCount?: number;
      groups?: Array<{
        key?: string;
        bytes?: number;
        items?: Array<{ id?: string; path?: string; bytes?: number }>;
      }>;
    };
  };
  assert.ok(body.planId);
  planId = body.planId!;
  assert.equal(body.plan?.clusters?.length, 2);
  assert.equal(body.plan?.targets?.length, 3);
  assert.equal(body.plan?.totalBytes, 1400);

  // Panel MOTORDAN gelir: sayimlar plandaki yapiyla uyusur.
  assert.equal(body.panel?.clusterCount, body.plan?.clusters?.length);
  assert.equal(body.panel?.targetCount, body.plan?.targets?.length);
  assert.deepEqual(body.panel?.keys, ['panel-a', 'panel-b']);

  // Gruplar bayt azalan; hedefler bayt azalan; ilk hedef kimligi dolu.
  assert.deepEqual(
    body.panel?.groups?.map((g) => g.key),
    ['panel-a', 'panel-b'],
  );
  assert.deepEqual(
    body.panel?.groups?.[0]?.items?.map((i) => i.bytes),
    [700, 200],
  );
  const id = body.panel?.groups?.[0]?.items?.[0]?.id ?? '';
  assert.ok(id.length > 0);
  firstTargetId = id;
});

test('plandan tek hedef cikarilir; plan kimligi korunur', async () => {
  const r = await fetch(`${base}/api/plan/remove`, {
    method: 'POST',
    headers: { 'x-residue-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ planId, targetId: firstTargetId }),
  });
  assert.equal(r.status, 200);
  const body = (await r.json()) as {
    planId?: string;
    plan?: { targets?: unknown[]; totalBytes?: number };
    panel?: {
      keys?: string[];
      targetCount?: number;
      groups?: Array<{ key?: string; items?: Array<{ id?: string; path?: string }> }>;
    };
  };
  assert.equal(body.planId, planId);
  assert.equal(body.plan?.targets?.length, 2);
  assert.equal(body.plan?.totalBytes, 700);

  // GET ayni kayidi dondurur; panelden cikan hedef kimligi gercekten gitmistir.
  const get = await fetch(`${base}/api/plan`, { headers: { 'x-residue-token': token } });
  assert.equal(get.status, 200);
  const live = (await get.json()) as typeof body;
  assert.equal(live.planId, planId);
  assert.equal(live.plan?.targets?.length, 2);
  assert.ok(
    !(live.panel?.groups ?? []).some((g) => (g.items ?? []).some((i) => i.id === firstTargetId)),
  );
  // panel-a icinde yalnizca eski hedef kaldi; bayt sirasi degisir.
  assert.deepEqual(live.panel?.groups?.map((g) => g.key), ['panel-b', 'panel-a']);
  remainingIds = (live.panel?.groups ?? []).flatMap((g) => (g.items ?? []).map((i) => i.id ?? ''));
});

test('bilinmeyen hedef kimligi 404; plan degismeden kalir', async () => {
  const r = await fetch(`${base}/api/plan/remove`, {
    method: 'POST',
    headers: { 'x-residue-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ planId, targetId: 't-yok' }),
  });
  assert.equal(r.status, 404);

  const get = await fetch(`${base}/api/plan`, { headers: { 'x-residue-token': token } });
  const live = (await get.json()) as { planId?: string; plan?: { targets?: unknown[]; totalBytes?: number } };
  assert.equal(live.planId, planId);
  assert.equal(live.plan?.targets?.length, 2);
  assert.equal(live.plan?.totalBytes, 700);
});

test('kalan hedefler cikarilinca plan duser ve ucu null doner', async () => {
  assert.equal(remainingIds.length, 2);
  for (let i = 0; i < remainingIds.length; i++) {
    const r = await fetch(`${base}/api/plan/remove`, {
      method: 'POST',
      headers: { 'x-residue-token': token, 'content-type': 'application/json' },
      body: JSON.stringify({ planId, targetId: remainingIds[i] }),
    });
    assert.equal(r.status, 200);
    const body: unknown = await r.json();
    if (i === remainingIds.length - 1) {
      assert.equal(body, null);
    } else {
      assert.ok(body && typeof body === 'object');
    }
  }

  const get = await fetch(`${base}/api/plan`, { headers: { 'x-residue-token': token } });
  assert.equal(get.status, 200);
  assert.equal(await get.json(), null);
});

test('plan kimligi olmayan cikarma istegi 400', async () => {
  const withId = await fetch(`${base}/api/plan/remove`, {
    method: 'POST',
    headers: { 'x-residue-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'panel-a' }),
  });
  assert.equal(withId.status, 400);

  const empty = await fetch(`${base}/api/plan/remove`, {
    method: 'POST',
    headers: { 'x-residue-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(empty.status, 400);
});
