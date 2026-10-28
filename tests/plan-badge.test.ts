import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlanBadge } from '../src/core/plan-badge.ts';
import type { PlanRecordView } from '../src/core/contract.ts';

function rec(status: PlanRecordView['status'], id = 'r'): PlanRecordView {
  return {
    id,
    name: 'plan',
    planId: 'p',
    createdAt: 1,
    status,
    source: 'dashboard',
    clusterKeys: ['k'],
    clusterTitles: ['t'],
    clusterCount: 1,
    targetCount: 1,
    bytes: 100,
  };
}

test('plan-badge: boş liste', () => {
  assert.deepEqual(PlanBadge.view([]), { total: 0, pending: 0, show: false });
});

test('plan-badge: iki pending + bir executed', () => {
  const records = [rec('pending', 'a'), rec('pending', 'b'), rec('executed', 'c')];
  assert.deepEqual(PlanBadge.view(records), { total: 3, pending: 2, show: true });
});

test('plan-badge: yalnız executed → show true, pending 0', () => {
  const records = [rec('executed', 'a'), rec('executed', 'b')];
  assert.deepEqual(PlanBadge.view(records), { total: 2, pending: 0, show: true });
});

test('plan-badge: cancelled + failed da total a girer', () => {
  const records = [rec('cancelled', 'a'), rec('failed', 'b')];
  assert.deepEqual(PlanBadge.view(records), { total: 2, pending: 0, show: true });
});

test('plan-badge: girdi dizisi değiştirilmez', () => {
  const records = [rec('pending', 'a'), rec('executed', 'b')];
  const before = records.map((r) => r.id);
  const beforeLen = records.length;
  PlanBadge.view(records);
  assert.equal(records.length, beforeLen);
  assert.deepEqual(records.map((r) => r.id), before);
});
