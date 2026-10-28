import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScanHistory, SCAN_HISTORY_LIMIT } from '../src/core/scan-history.ts';

function e(id: string, at: number): any {
  return { id, at, clusters: 1, files: 2, bytes: 3, deletableBytes: 4, targets: 5 };
}

test('scan-history: add puts new entry first and drops oldest at limit', () => {
  const entries = [e('a', 1), e('b', 2), e('c', 3)];
  const out = ScanHistory.add(entries, e('d', 4), 3);
  assert.equal(out.length, 3);
  assert.equal(out[0]!.id, 'd');
  assert.deepEqual(out.map((x: any) => x.id), ['d', 'a', 'b']);
});

test('scan-history: add duplicate id replaces, count stays', () => {
  const entries = [e('a', 1), e('b', 2)];
  const out = ScanHistory.add(entries, e('a', 9), 5);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.id, 'a');
  assert.equal(out[0]!.at, 9);
});

test('scan-history: add does not mutate input', () => {
  const entries = [e('a', 1), e('b', 2)];
  const snap = entries.map((x: any) => x.id);
  ScanHistory.add(entries, e('c', 3), 5);
  assert.deepEqual(entries.map((x: any) => x.id), snap);
});

test('scan-history: list sorts by at desc', () => {
  const entries = [e('a', 1), e('b', 5), e('c', 3)];
  const out = ScanHistory.list(entries);
  assert.deepEqual(out.map((x: any) => x.id), ['b', 'c', 'a']);
});

test('scan-history: list puts invalid at last', () => {
  const entries = [e('a', NaN as any), e('b', 5), e('c', 'x' as any)];
  const out = ScanHistory.list(entries);
  assert.equal(out[0]!.id, 'b');
  assert.equal(out[out.length - 1]!.id === 'a' || out[out.length - 1]!.id === 'c', true);
  // both invalid remain, not dropped
  assert.equal(out.length, 3);
});

test('scan-history: summary empty', () => {
  assert.deepEqual(ScanHistory.summary([]), { count: 0, lastAt: 0, firstAt: 0 });
});

test('scan-history: summary fills last/first', () => {
  const entries = [e('a', 1), e('b', 5), e('c', 3)];
  const s = ScanHistory.summary(entries);
  assert.equal(s.count, 3);
  assert.equal(s.lastAt, 5);
  assert.equal(s.firstAt, 1);
});

test('scan-history: summarize clamps negatives and maps fields', () => {
  const out = ScanHistory.summarize(
    { finishedAt: 42, clusters: -1, files: 2, bytes: -5, deletableBytes: 0, targets: 3 },
    'id-x',
  );
  assert.equal(out.id, 'id-x');
  assert.equal(out.at, 42);
  assert.equal(out.clusters, 0);
  assert.equal(out.files, 2);
  assert.equal(out.bytes, 0);
  assert.equal(out.deletableBytes, 0);
  assert.equal(out.targets, 3);
});

test('scan-history: SCAN_HISTORY_LIMIT default 50', () => {
  assert.equal(SCAN_HISTORY_LIMIT, 50);
});