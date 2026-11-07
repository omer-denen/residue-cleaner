import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HighRiskOverride, type OverrideCluster } from '../src/core/approval.ts';
import { DeleteService } from '../src/services/delete-service.ts';
import type { Cluster, ScanResult } from '../src/core/types.ts';
import type { ExecuteEvent } from '../src/core/contract.ts';
import { cluster, verdict } from './helpers.ts';

let root = '';
let dataDir = '';

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'residue-b15-'));
  process.env.LOCALAPPDATA = root;
  dataDir = join(root, 'residue');
});

after(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
});

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

const ref = (key: string, risk: OverrideCluster['risk'], targets = 2): OverrideCluster => ({
  key,
  title: `${key} basligi`,
  risk,
  targets: Array.from({ length: targets }, () => ({})),
});

test('B15-1: override listesi YALNIZ yuksek riskli kumeleri tasir', () => {
  const items = HighRiskOverride.items([
    ref('safe', 'safe'),
    ref('medium', 'medium'),
    ref('high-a', 'high', 3),
    ref('high-b', 'high', 1),
  ]);
  assert.deepEqual(
    items.map((i) => [i.key, i.targets]),
    [
      ['high-a', 3],
      ['high-b', 1],
    ],
  );
});

test('B15-2: deleteTargets ve targets ayni sekilde sayilir', () => {
  const fromTargets = HighRiskOverride.items([ref('a', 'high', 2)]);
  const fromDelete = HighRiskOverride.items([
    { key: 'a', title: 'a', risk: 'high', deleteTargets: [{}, {}, {}] },
  ]);
  assert.equal(fromTargets[0]?.targets, 2);
  assert.equal(fromDelete[0]?.targets, 3);
});

test('B15-3: required yalniz yuksek risk varsa true', () => {
  assert.equal(HighRiskOverride.required([ref('a', 'safe'), ref('b', 'medium')]), false);
  assert.equal(HighRiskOverride.required([ref('a', 'high')]), true);
});

test('B15-4: ad karsilastirmasi trim + kucuk/buyuk harf duyarsiz', () => {
  assert.equal(HighRiskOverride.matches('npm-cache', ' npm-cache '), true);
  assert.equal(HighRiskOverride.matches('npm-cache', 'NPM-Cache'), true);
  assert.equal(HighRiskOverride.matches('npm-cache', 'npm-cach'), false);
  assert.equal(HighRiskOverride.matches('npm-cache', ''), false);
  assert.equal(HighRiskOverride.matches('npm-cache', undefined), false);
});

test('B15-5: missing eksik ve yanlis adlari listeler', () => {
  const clusters = [ref('high-a', 'high'), ref('high-b', 'high'), ref('safe', 'safe')];
  assert.deepEqual(HighRiskOverride.missing(clusters, {}), ['high-a', 'high-b']);
  assert.deepEqual(HighRiskOverride.missing(clusters, { 'high-a': 'high-a' }), ['high-b']);
  assert.deepEqual(HighRiskOverride.missing(clusters, { 'high-a': 'yanlis', 'high-b': 'HIGH-B' }), [
    'high-a',
  ]);
  assert.deepEqual(HighRiskOverride.missing(clusters, undefined), ['high-a', 'high-b']);
  assert.deepEqual(HighRiskOverride.missing([ref('safe', 'safe')], {}), []);
});

test('B15-6: satisfied kutu isaretli + tum adlar dogru olmali', () => {
  const clusters = [ref('high-a', 'high'), ref('high-b', 'high')];
  const names = { 'high-a': 'high-a', 'high-b': 'high-b' };
  assert.equal(HighRiskOverride.satisfied(clusters, names, true), true);
  assert.equal(HighRiskOverride.satisfied(clusters, names, false), false);
  assert.equal(HighRiskOverride.satisfied(clusters, { 'high-a': 'high-a' }, true), false);
});

test('B15-7: plan yaniti override listesini ve kurali tasir', () => {
  const svc = new DeleteService(() => {});
  const s = scan([
    cluster({ key: 'high-a', verdict: verdict({ risk: 'high' }) }),
    cluster({ key: 'high-b', verdict: verdict({ risk: 'high' }) }),
    cluster({ key: 'safe', verdict: verdict({ risk: 'safe' }) }),
  ]);
  const plan = svc.createPlan(s, ['high-a', 'high-b', 'safe'], 'recycle');
  assert.equal(plan.requiresHighAck, true);
  assert.equal(plan.override.required, true);
  assert.deepEqual(
    plan.override.items.map((i) => i.key),
    ['high-a', 'high-b'],
  );
  assert.equal(plan.override.items[0]?.targets, 1);
});

test('B15-8: yuksek risk yoksa override bos', () => {
  const svc = new DeleteService(() => {});
  const s = scan([cluster({ key: 'safe', verdict: verdict({ risk: 'safe' }) })]);
  const plan = svc.createPlan(s, ['safe'], 'recycle');
  assert.equal(plan.override.required, false);
  assert.deepEqual(plan.override.items, []);
});

test('B15-9: execute adlar olmadan reddeder (kutu isaretli olsa bile)', () => {
  const svc = new DeleteService(() => {});
  const s = scan([cluster({ key: 'high-a', verdict: verdict({ risk: 'high' }) })]);
  const plan = svc.createPlan(s, ['high-a'], 'recycle');
  assert.throws(() => svc.execute(plan.planId, 'TASI', true), /adi yazilmali/);
  assert.throws(() => svc.execute(plan.planId, 'TASI', true, { 'high-a': 'yanlis' }), /high-a/);
  // Plan hala kullanilabilir (reddedilen deneme TTL/plani yakmaz).
  assert.equal(svc.currentPlan()?.planId, plan.planId);
});

test('B15-10: execute yanlis kutu ile reddeder', () => {
  const svc = new DeleteService(() => {});
  const s = scan([cluster({ key: 'high-a', verdict: verdict({ risk: 'high' }) })]);
  const plan = svc.createPlan(s, ['high-a'], 'recycle');
  assert.throws(() => svc.execute(plan.planId, 'TASI', false, { 'high-a': 'high-a' }), /Yuksek risk/);
});

test('B15-11: adlar dogruysa execute baslar ve denetim kaydi yazar', async () => {
  const dir = await mkdtemp(join(root, 'hedef-'));
  await writeFile(join(dir, 'a.txt'), 'aaa', 'utf8');
  const events: ExecuteEvent[] = [];
  const svc = new DeleteService((_id, ev) => events.push(ev));
  const s = scan([
    cluster({
      key: 'high-a',
      verdict: verdict({ risk: 'high' }),
      parts: [
        { path: dir, bytes: 3, files: 1, lastTouched: 0, reclaimableBytes: 3, origin: 'custom' },
      ],
      deleteTargets: [{ path: dir, kind: 'whole', bytes: 3, label: 'test' }],
    }),
  ]);
  const plan = svc.createPlan(s, ['high-a'], 'recycle');
  const started = svc.execute(plan.planId, 'TASI', true, { 'high-a': ' HIGH-A ' });
  assert.ok(started.jobId);

  // Is bitene kadar bekle (kasa tasima gercek gecici dizinde).
  for (let i = 0; i < 100; i++) {
    const job = svc.getJob(started.jobId);
    if (job && job.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 25));
  }

  const file = join(dataDir, 'audit.log');
  let text = '';
  for (let i = 0; i < 40; i++) {
    text = await readFile(file, 'utf8').catch(() => '');
    if (text.includes('delete.high-ack')) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.match(text, /"event":"delete\.high-ack"/);
  const line = text
    .trim()
    .split('\n')
    .find((l) => l.includes('delete.high-ack')) as string;
  const rec = JSON.parse(line) as Record<string, unknown>;
  assert.equal(rec.planId, plan.planId);
  assert.equal(rec.acknowledged, true);
  assert.match(String(rec.reason), /high-a/);
  assert.deepEqual(rec.names, ['high-a']);
});

test('B15-12: gelismis modda yuksek risk yoksa ad listesi bos kalir', () => {
  const svc = new DeleteService(() => {});
  const s = scan([cluster({ key: 'safe', verdict: verdict({ risk: 'safe' }) })]);
  const plan = svc.createPlan(s, ['safe'], 'recycle', undefined, true);
  assert.equal(plan.requiresPhrase, true);
  assert.equal(plan.requiresHighAck, true);
  assert.equal(plan.override.required, false);
  assert.deepEqual(plan.override.items, []);
});
