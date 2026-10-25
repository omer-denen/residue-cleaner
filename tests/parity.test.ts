import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DiskView } from '../src/core/disk-view.ts';
import { scanJson } from '../src/core/cli-json.ts';
import { buildPlan } from '../src/actions/delete.ts';
import { cluster, verdict } from './helpers.ts';

function fixture() {
  return [
    cluster({
      key: 'a',
      title: 'A',
      totalBytes: 1000,
      reclaimableBytes: 1000,
    }),
    cluster({
      key: 'b',
      title: 'B',
      totalBytes: 500,
      reclaimableBytes: 400,
      verdict: verdict({ kind: 'ask', risk: 'medium', regenerability: 'unknown' }),
    }),
    cluster({
      key: 'c',
      title: 'C',
      totalBytes: 300,
      reclaimableBytes: 300,
    }),
  ];
}

test('kume esitligi: scanJson ve DiskView ayni sirada ayni key kumesi', () => {
  const clusters = fixture();
  const jsonKeys = scanJson({ startedAt: 0, finishedAt: 0, stats: {} as any, clusters, skipped: [] }).clusters.map((c) => c.key);
  const viewKeys = new DiskView(clusters, []).view().clusters.map((c) => c.key);
  assert.deepEqual(jsonKeys, viewKeys);
});

test('bayt esitligi: totalBytes ve reclaimableBytes birebir', () => {
  const clusters = fixture();
  const r = { startedAt: 0, finishedAt: 0, stats: {} as any, clusters, skipped: [] } as any;
  const j = scanJson(r).clusters;
  const v = new DiskView(clusters, []).view().clusters;
  for (let i = 0; i < clusters.length; i++) {
    assert.equal(j[i]!.totalBytes, v[i]!.totalBytes);
    assert.equal(j[i]!.reclaimableBytes, v[i]!.reclaimableBytes);
  }
});

test('toplam esitligi: scanJson reclaimable toplami = DiskView totals', () => {
  const clusters = fixture();
  const r = { startedAt: 0, finishedAt: 0, stats: {} as any, clusters, skipped: [] } as any;
  const sum = scanJson(r).clusters.reduce((a, c) => a + c.reclaimableBytes, 0);
  const totals = new DiskView(clusters, []).view().totals.reclaimableBytes;
  assert.equal(sum, totals);
});

test('plan esitligi: buildPlan hedef baytlari = scanJson deleteTargets baytlari', () => {
  const clusters = fixture();
  const plan = buildPlan(clusters, 'recycle');
  const planBytes = plan.totalBytes;
  const r = { startedAt: 0, finishedAt: 0, stats: {} as any, clusters, skipped: [] } as any;
  const jsonBytes = scanJson(r).clusters.reduce(
    (a, c) => a + (c.deleteTargets ?? []).reduce((x, t) => x + t.bytes, 0),
    0,
  );
  assert.equal(planBytes, jsonBytes);
});

test('verdict esitligi: scanJson verdict.kind = DiskView verdictKind', () => {
  const clusters = fixture();
  const r = { startedAt: 0, finishedAt: 0, stats: {} as any, clusters, skipped: [] } as any;
  const j = scanJson(r).clusters;
  const v = new DiskView(clusters, []).view().clusters;
  for (let i = 0; i < clusters.length; i++) {
    assert.equal(j[i]!.verdict.kind, v[i]!.verdictKind);
  }
});