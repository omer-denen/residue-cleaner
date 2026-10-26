import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BugViewList } from '../src/core/bug-view.ts';
import type { BugLike } from '../src/core/bug-view.ts';
import { renderHandoff } from '../src/util/state.ts';
import type { ProjectState } from '../src/util/state.ts';

/** Ilk normalize edilmis kaydi dondurur; bos liste testte hata sayilir. */
function firstOf(bugs: BugLike[]) {
  const view = BugViewList.normalize(bugs)[0];
  assert.ok(view);
  return view;
}

test('B7-1 eski sema: acik, unknown, label belirtiden', () => {
  const bugs: BugLike[] = [{ id: 'B7', symptom: 'Tarama surerken ilerleme yoktu.' }];
  const open = BugViewList.open(bugs);
  assert.equal(open.length, 1);
  const first = firstOf(bugs);
  assert.equal(first.severity, 'unknown');
  assert.equal(first.label, 'Tarama surerken ilerleme yoktu.');
});

test('B7-2 yeni sema duzeltilmis: open bos, counts open 0', () => {
  const bugs: BugLike[] = [{ title: 'X', symptom: '...', status: 'fixed', severity: 'high' }];
  assert.equal(BugViewList.open(bugs).length, 0);
  assert.equal(BugViewList.counts(bugs).open, 0);
});

test('B7-3 sayimlar: karisik liste', () => {
  const bugs: BugLike[] = [
    { title: 'a', symptom: 's', status: 'open', severity: 'critical' },
    { title: 'b', symptom: 's', status: 'open', severity: 'high' },
    { title: 'c', symptom: 's', status: 'fixed', severity: 'high' },
    { title: 'd', symptom: 's', status: 'open', severity: 'low' },
  ];
  assert.deepEqual(BugViewList.counts(bugs), { open: 3, critical: 1, high: 1 });
});

test('B7-4 etiket onceligi: title doluysa title; bos string ise symptoma duser', () => {
  const withTitle: BugLike[] = [{ title: 'Baslik', symptom: 'belirti', status: 'open', severity: 'low' }];
  assert.equal(firstOf(withTitle).label, 'Baslik');

  const emptyTitle: BugLike[] = [{ title: '   ', symptom: 'belirti cumlesi.', status: 'open', severity: 'low' }];
  assert.equal(firstOf(emptyTitle).label, 'belirti cumlesi.');
});

test('B7-5 uzun belirti: label <=83 ve ... ile biter, undefined yok', () => {
  const long = 'a'.repeat(200);
  const bugs: BugLike[] = [{ id: 'B', symptom: long, status: 'open' }];
  const label = firstOf(bugs).label;
  assert.ok(label.length <= 83, `length ${label.length}`);
  assert.ok(label.endsWith('...'));
  assert.ok(!label.includes('undefined'));
});

test('B7-6 durum eslemesi: partial acikta gorunur; status yok -> open', () => {
  const partial: BugLike[] = [{ title: 'p', symptom: 's', status: 'partial', severity: 'low' }];
  assert.equal(firstOf(partial).status, 'partial');
  assert.equal(BugViewList.open(partial).length, 1);

  const noStatus: BugLike[] = [{ title: 'n', symptom: 's', severity: 'low' }];
  assert.equal(firstOf(noStatus).status, 'open');
});

test('B7-7 renderHandoff regresyonu: undefined gecmiyor, symptom yer aliyor', () => {
  const state: ProjectState = {
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    project: { name: 'P', purpose: 'p', stack: 's', entry: 'e' },
    commands: [],
    tasks: [],
    bugs: [{ id: 'B7', symptom: 'Tarama surerken ilerleme yoktu.' } as any],
    perf: [],
    actionsPerformed: [],
    openQuestions: [],
  };
  const out = renderHandoff(state);
  assert.ok(!out.includes('undefined'));
  assert.ok(out.includes('Tarama surerken ilerleme yoktu.'));
});

test('B7-8 girdi degismiyor: normalize girdiyi degistirmiyor', () => {
  const bugs: BugLike[] = [{ id: 'B7', symptom: 'Tarama surerken ilerleme yoktu.' }];
  const before = JSON.stringify(bugs);
  BugViewList.normalize(bugs);
  const after = JSON.stringify(bugs);
  assert.equal(before, after);
});