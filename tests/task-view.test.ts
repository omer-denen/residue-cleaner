import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskViewList, OPEN_TASK_STATUSES } from '../src/core/task-view.ts';

const tasks = [
  { id: 'T1', title: 'bitti', status: 'done' },
  { id: 'T2', title: 'yarida', status: 'wip' },
  { id: 'T3', title: 'yapilacak', status: 'todo' },
  { id: 'T4', title: 'planlandi', status: 'planned' },
  { id: 'T5', title: 'bekliyor', status: 'blocked' },
];

test('planned acik gorev sayilir (T64 regresyonu)', () => {
  assert.equal(TaskViewList.isOpen('planned'), true);
  const counts = TaskViewList.counts(tasks);
  assert.equal(counts.open, 3, 'todo + planned + blocked');
  assert.equal(counts.done, 1);
  assert.equal(counts.wip, 1);
  assert.equal(counts.unknown, 0);
  assert.equal(counts.total, 5);
});

test('open listesi planned/blocked icerir, done/wip icermez', () => {
  const ids = TaskViewList.open(tasks).map((t) => t.id);
  assert.deepEqual(ids, ['T3', 'T4', 'T5']);
});

test('acik durumlar tek kaynaktan gelir', () => {
  assert.deepEqual([...OPEN_TASK_STATUSES], ['todo', 'planned', 'blocked']);
});

test('taninmayan durum sessizce kaybolmaz', () => {
  const broken = [
    { id: 'T9', title: 'yazim hatasi', status: 'planed' },
    { id: 'T10', title: 'bos', status: '' },
    { id: 'T11', title: 'alansiz' },
  ];
  const counts = TaskViewList.counts(broken);
  assert.equal(counts.unknown, 3);
  assert.equal(counts.open, 0);
  assert.equal(counts.total, 3);
  assert.deepEqual(TaskViewList.unclassified(broken).map((t) => t.id), ['T9', 'T10', 'T11']);
  // toplam = done + wip + open + unknown (hicbir gorev dusmez)
  assert.equal(counts.done + counts.wip + counts.open + counts.unknown, counts.total);
});

test('wip filtresi yalniz yarida kalanlari doner', () => {
  assert.deepEqual(TaskViewList.wip(tasks).map((t) => t.id), ['T2']);
});

test('bos liste', () => {
  const counts = TaskViewList.counts([]);
  assert.deepEqual(counts, { total: 0, done: 0, wip: 0, open: 0, unknown: 0 });
});

test('isKnown durum kumesi', () => {
  for (const s of ['done', 'wip', 'todo', 'planned', 'blocked']) {
    assert.equal(TaskViewList.isKnown(s), true, s);
  }
  for (const s of ['planed', 'DONE', '', undefined]) {
    assert.equal(TaskViewList.isKnown(s), false, String(s));
  }
});
