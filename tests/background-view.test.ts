import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BackgroundView } from '../src/core/background-view.ts';
import type { BackgroundFacts } from '../src/core/contract.ts';

function facts(over: Partial<BackgroundFacts> = {}): BackgroundFacts {
  return {
    busy: null,
    scheduleRules: 0,
    schedulesDueToday: 0,
    missedRuns: 0,
    updateCheck: 'off',
    scanOnLaunch: 'manual',
    vaultRetentionDays: 0,
    pendingPlans: 0,
    ...over,
  };
}

const ORDER = ['busy', 'schedules', 'plans', 'update', 'launch', 'retention'];

test('bos gercekler: 6 satir, automatic false, busy ok', () => {
  const v = BackgroundView.view(facts());
  assert.equal(v.automatic, false);
  assert.equal(v.rows.length, 6);
  assert.equal(v.rows.map((r) => r.id).join(','), ORDER.join(','));
  const busy = v.rows.find((r) => r.id === 'busy')!;
  assert.equal(busy.tone, 'ok');
});

test('busy scan: warn + busy alani scan', () => {
  const v = BackgroundView.view(facts({ busy: 'scan' }));
  assert.equal(v.busy, 'scan');
  const busy = v.rows.find((r) => r.id === 'busy')!;
  assert.equal(busy.tone, 'warn');
});

test('schedulesDueToday > 0: schedules warn', () => {
  const v = BackgroundView.view(facts({ scheduleRules: 2, schedulesDueToday: 1 }));
  const row = v.rows.find((r) => r.id === 'schedules')!;
  assert.equal(row.tone, 'warn');
});

test('missedRuns > 0: schedules warn', () => {
  const v = BackgroundView.view(facts({ scheduleRules: 2, missedRuns: 1 }));
  const row = v.rows.find((r) => r.id === 'schedules')!;
  assert.equal(row.tone, 'warn');
});

test('pendingPlans: 0 dim, >0 warn', () => {
  const a = BackgroundView.view(facts({ pendingPlans: 0 }));
  const b = BackgroundView.view(facts({ pendingPlans: 3 }));
  assert.equal(a.rows.find((r) => r.id === 'plans')!.tone, 'dim');
  assert.equal(b.rows.find((r) => r.id === 'plans')!.tone, 'warn');
  assert.equal(b.rows.find((r) => r.id === 'plans')!.count, 3);
});

test('updateCheck off dim, daily ok; scanOnLaunch manual dim', () => {
  const v = BackgroundView.view(facts({ updateCheck: 'off', scanOnLaunch: 'manual' }));
  assert.equal(v.rows.find((r) => r.id === 'update')!.tone, 'dim');
  assert.equal(v.rows.find((r) => r.id === 'launch')!.tone, 'dim');
  const v2 = BackgroundView.view(facts({ updateCheck: 'daily', scanOnLaunch: 'always' }));
  assert.equal(v2.rows.find((r) => r.id === 'update')!.tone, 'ok');
  assert.equal(v2.rows.find((r) => r.id === 'launch')!.tone, 'ok');
});

test('negatif/NaN sayilar 0a kirpilir, satir sayisi 6', () => {
  const v = BackgroundView.view(facts({ scheduleRules: -5, pendingPlans: Number.NaN, vaultRetentionDays: -1 }));
  assert.equal(v.rows.length, 6);
  assert.equal(v.rows.find((r) => r.id === 'schedules')!.count, 0);
  assert.equal(v.rows.find((r) => r.id === 'plans')!.count, 0);
  assert.equal(v.rows.find((r) => r.id === 'retention')!.count, 0);
});

test('satir sirasi sabit', () => {
  const v = BackgroundView.view(facts({ scheduleRules: 5, pendingPlans: 2, updateCheck: 'weekly', scanOnLaunch: 'daily', vaultRetentionDays: 30 }));
  assert.deepEqual(v.rows.map((r) => r.id), ORDER);
});

test('automatic her kosulda false', () => {
  const v = BackgroundView.view(facts({ busy: 'inventory', scheduleRules: 9, pendingPlans: 9, updateCheck: 'weekly', scanOnLaunch: 'always', vaultRetentionDays: 100 }));
  assert.equal(v.automatic, false);
});

test('busy inventory: warn', () => {
  const v = BackgroundView.view(facts({ busy: 'inventory' }));
  assert.equal(v.busy, 'inventory');
  assert.equal(v.rows.find((r) => r.id === 'busy')!.tone, 'warn');
});

test('retention <=0 dim', () => {
  const v = BackgroundView.view(facts({ vaultRetentionDays: 0 }));
  assert.equal(v.rows.find((r) => r.id === 'retention')!.tone, 'dim');
});

test('valueId: busy / update / launch secenek kimligi tasir', () => {
  const v = BackgroundView.view(facts({ busy: 'scan', updateCheck: 'weekly', scanOnLaunch: 'daily' }));
  assert.equal(v.rows.find((r) => r.id === 'busy')!.valueId, 'scan');
  assert.equal(v.rows.find((r) => r.id === 'update')!.valueId, 'weekly');
  assert.equal(v.rows.find((r) => r.id === 'launch')!.valueId, 'daily');
});

test('valueId: bos durumda busy none, update off, launch manual', () => {
  const v = BackgroundView.view(facts());
  assert.equal(v.rows.find((r) => r.id === 'busy')!.valueId, 'none');
  assert.equal(v.rows.find((r) => r.id === 'update')!.valueId, 'off');
  assert.equal(v.rows.find((r) => r.id === 'launch')!.valueId, 'manual');
});
