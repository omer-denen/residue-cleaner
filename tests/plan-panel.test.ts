import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlanPanel, planTargetId } from '../src/core/plan-panel.ts';
import type {
  PlanView,
  PlannedClusterView,
  PlannedTargetView,
} from '../src/core/contract.ts';

function targetView(
  path: string,
  bytes: number,
  kind: 'whole' | 'older' = 'whole',
): PlannedTargetView {
  const target = { path, kind, label: `label: ${path}`, bytes };
  return {
    target: kind === 'older' ? { ...target, minAgeDays: 3 } : target,
    bytes,
  };
}

/** Kumeler ve hedefler girdide buyukten kucuge DEGIL sirada: siralama motorun isi. */
function view(): PlanView {
  const tAOld = targetView('C:\\Cache\\panel-a-old', 200, 'older');
  const tA = targetView('C:\\Cache\\panel-a', 700);
  const tB = targetView('C:\\Cache\\panel-b', 500);
  const a: PlannedClusterView = {
    key: 'panel-a',
    title: 'Panel A',
    reason: 'r-a',
    risk: 'safe',
    bytes: 900,
    targets: [tAOld, tA],
  };
  const b: PlannedClusterView = {
    key: 'panel-b',
    title: 'Panel B',
    reason: 'r-b',
    risk: 'medium',
    bytes: 500,
    targets: [tB],
  };
  return { mode: 'recycle', clusters: [b, a], targets: [tB, tAOld, tA], totalBytes: 1400 };
}

test('gruplar ve hedefler bayta gore azalan siralanir', () => {
  const panel = PlanPanel.from(view());

  // Gruplar: bayt azalan (panel-a 900 > panel-b 500); girdi sirasi ters.
  assert.deepEqual(
    panel.groups.map((g) => g.key),
    ['panel-a', 'panel-b'],
  );

  // Hedefler: bayt azalan (700 once, 200 sonra); girdi sirasi ters.
  const a = panel.groups[0]!;
  assert.deepEqual(
    a.items.map((i) => i.bytes),
    [700, 200],
  );
  assert.equal(a.items[1]!.kind, 'older');
  assert.equal(a.items[1]!.minAgeDays, 3);
  assert.equal(a.bytes, 900);
  assert.equal(a.targetCount, 2);
});

test('keys, targetCount ve totalBytes korunur', () => {
  const panel = PlanPanel.from(view());
  assert.deepEqual(panel.keys, ['panel-a', 'panel-b']);
  assert.equal(panel.clusterCount, 2);
  assert.equal(panel.targetCount, 3);
  assert.equal(panel.totalBytes, 1400);
  assert.equal(panel.mode, 'recycle');
});

test('planTargetId deterministiktir; kume degisse kimlik degisir', () => {
  const id = planTargetId('panel-a', 'C:\\Cache\\panel-a');
  assert.ok(id.startsWith('t-'));
  assert.equal(planTargetId('panel-a', 'C:\\Cache\\panel-a'), id);
  assert.notEqual(planTargetId('panel-b', 'C:\\Cache\\panel-a'), id);
  assert.notEqual(planTargetId('panel-a', 'C:\\Cache\\panel-b'), id);
});

test('bos plan cokmez; gruplar bos, sayilar sifir', () => {
  const panel = PlanPanel.from({ mode: 'purge', clusters: [], targets: [], totalBytes: 0 });
  assert.deepEqual(panel.groups, []);
  assert.deepEqual(panel.keys, []);
  assert.equal(panel.clusterCount, 0);
  assert.equal(panel.targetCount, 0);
  assert.equal(panel.totalBytes, 0);
});
