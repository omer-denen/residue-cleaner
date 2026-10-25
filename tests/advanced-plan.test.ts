import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { buildPlan } from '../src/actions/delete.ts';
import { DeleteService } from '../src/services/delete-service.ts';
import { ApprovalRules } from '../src/core/approval.ts';
import type { Cluster, ScanResult } from '../src/core/types.ts';
import { cluster, verdict } from './helpers.ts';

function scan(clusters: Cluster[]): ScanResult {
  return {
    startedAt: 0,
    finishedAt: 0,
    clusters,
    stats: {
      rootsScanned: 0,
      dirsVisited: 0,
      filesSeen: 0,
      bytesSeen: 0,
      denied: 0,
      longPathErrors: 0,
    },
    skipped: [],
  };
}

test('advanced kapali: keep ve report-only kumeleri atlanir (0 hedef)', () => {
  const clusters = [
    cluster({ key: 'keep-c', verdict: verdict({ kind: 'keep' }) }),
    cluster({ key: 'report-c', verdict: verdict({ kind: 'report-only' }) }),
  ];
  const plan = buildPlan(clusters, 'recycle');
  assert.equal(plan.clusters.length, 0);
  assert.equal(plan.targets.length, 0);
  assert.equal(plan.totalBytes, 0);
});

test('advanced acik: keep kumesi parcalardan hedef uretir; bayt = parca bayti', () => {
  const partBytes = 1234;
  const c = cluster({
    key: 'keep-parts',
    verdict: verdict({ kind: 'keep' }),
    parts: [{ path: 'C:\\Cache\\keep-parts', bytes: partBytes, files: 2, lastTouched: Date.now(), reclaimableBytes: partBytes, origin: 'custom' }],
    deleteTargets: [],
  });
  const plan = buildPlan([c], 'recycle', undefined, undefined, true);
  assert.equal(plan.clusters.length, 1);
  assert.equal(plan.targets.length, 1);
  assert.equal(plan.totalBytes, partBytes);
  assert.equal(plan.clusters[0]!.targets[0]!.target.path, 'C:\\Cache\\keep-parts');
  assert.equal(plan.clusters[0]!.targets[0]!.bytes, partBytes);
});

test('advanced acik: report-only kumesi plana girer', () => {
  const c = cluster({
    key: 'report-parts',
    verdict: verdict({ kind: 'report-only' }),
    parts: [{ path: 'C:\\Cache\\report-parts', bytes: 900, files: 1, lastTouched: Date.now(), reclaimableBytes: 900, origin: 'custom' }],
    deleteTargets: [],
  });
  const plan = buildPlan([c], 'recycle', undefined, undefined, true);
  assert.equal(plan.clusters.length, 1);
  assert.ok(plan.targets.length > 0);
  assert.equal(plan.totalBytes, 900);
});

test('advanced acik: istisna archetype girmez', () => {
  const archetypes = ['virtual-disk', 'project-workspace', 'project-artifact', 'agent-workspace'] as const;
  for (const a of archetypes) {
    const c = cluster({
      key: `exc-${a}`,
      archetype: a as any,
      verdict: verdict({ kind: 'recommend' }),
      deleteTargets: [{ path: 'C:\\Cache\\exc', kind: 'whole', label: 'x', bytes: 500 }],
    });
    const plan = buildPlan([c], 'recycle', undefined, undefined, true);
    assert.equal(plan.clusters.length, 0, `${a} plana girmemeli`);
    assert.equal(plan.targets.length, 0, `${a} hedef uretmemeli`);
  }
});

test('advanced acik: kendi veri dizini altindaki part hedef degil', () => {
  const original = process.env.LOCALAPPDATA;
  const root = 'C:\\TmpAdvOwnData';
  process.env.LOCALAPPDATA = root;
  try {
    const ownPath = `${root}\\residue\\vault\\x`;
    const c = cluster({
      key: 'own-data',
      verdict: verdict({ kind: 'keep' }),
      parts: [{ path: ownPath, bytes: 500, files: 1, lastTouched: Date.now(), reclaimableBytes: 500, origin: 'custom' }],
      deleteTargets: [],
    });
    const plan = buildPlan([c], 'recycle', undefined, undefined, true);
    assert.equal(plan.targets.length, 0);
  } finally {
    if (original === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = original;
  }
});

test('advanced acik: guard korumali kokun atasi (C:\\Windows) hedef degil', () => {
  const c = cluster({
    key: 'guard-win',
    verdict: verdict({ kind: 'keep' }),
    parts: [{ path: 'C:\\Windows', bytes: 500, files: 1, lastTouched: Date.now(), reclaimableBytes: 500, origin: 'custom' }],
    deleteTargets: [],
  });
  const plan = buildPlan([c], 'recycle', undefined, undefined, true);
  assert.equal(plan.targets.length, 0);
});

test('advanced plan onay: GELISMIS, advanced, requiresHighAck true', () => {
  const svc = new DeleteService(() => {});
  const c = cluster({ key: 'adv-approval', deleteTargets: [{ path: 'C:\\Cache\\adv', kind: 'whole', label: 'adv', bytes: 100 }] });
  const s = scan([c]);
  const plan = svc.createPlan(s, ['adv-approval'], 'recycle', undefined, true);
  assert.equal(plan.phrase, 'GELİŞMİŞ');
  assert.equal(plan.approvalKind, 'advanced');
  assert.equal(plan.requiresHighAck, true);
  assert.equal(plan.requiresPhrase, true);
  assert.equal(plan.advanced, true);
  assert.equal(ApprovalRules.phrase('advanced'), 'GELİŞMİŞ');
  assert.equal(ApprovalRules.matches('advanced', 'GELİŞMİŞ'), true);
});

describe('API advanced', () => {
  let root = '';
  let server: Server;
  let base = '';
  let token = '';

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'residue-adv-api-'));
    process.env.LOCALAPPDATA = root;
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
    server?.closeAllConnections?.();
    await new Promise<void>((ok) => server?.close(() => ok()));
    await rm(root, { recursive: true, force: true });
  });

  test('API: advanced kapaliyken 403', async () => {
    const finishedAt = Date.now();
    const scanObj = {
      startedAt: finishedAt,
      finishedAt,
      clusters: [
        cluster({
          key: 'adv-api',
          deleteTargets: [{ path: 'C:\\Cache\\adv-api', kind: 'whole', label: 'adv api', bytes: 100 }],
        }),
      ],
      stats: { rootsScanned: 1, dirsVisited: 1, filesSeen: 0, bytesSeen: 0, denied: 0, longPathErrors: 0 },
      skipped: [],
    };
    const scansDir = join(root, 'residue', 'scans');
    await mkdir(scansDir, { recursive: true });
    await writeFile(join(scansDir, 'last-scan.json'), JSON.stringify({ version: 2, savedAt: finishedAt, scan: scanObj }), 'utf8');

    const res = await fetch(`${base}/api/plan`, {
      method: 'POST',
      headers: { 'x-residue-token': token, 'content-type': 'application/json' },
      body: JSON.stringify({ keys: ['adv-api'], mode: 'recycle', advanced: true }),
    });
    assert.equal(res.status, 403);
  });

  test('API: ayar acilinca 200 ve phrase GELISMIS', async () => {
    const upd = await fetch(`${base}/api/settings`, {
      method: 'PUT',
      headers: { 'x-residue-token': token, 'content-type': 'application/json' },
      body: JSON.stringify({ advancedDelete: true }),
    });
    assert.ok(upd.status === 200 || upd.status === 202);

    const res = await fetch(`${base}/api/plan`, {
      method: 'POST',
      headers: { 'x-residue-token': token, 'content-type': 'application/json' },
      body: JSON.stringify({ keys: ['adv-api'], mode: 'recycle', advanced: true }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { phrase?: string; approvalKind?: string; advanced?: boolean };
    assert.equal(body.phrase, 'GELİŞMİŞ');
    assert.equal(body.approvalKind, 'advanced');
    assert.equal(body.advanced, true);
  });
});
