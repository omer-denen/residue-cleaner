import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlanRecords } from '../src/core/plan-records.ts';
import type { PlanRecord } from '../src/core/plan-records.ts';

function rec(id: string, createdAt: number, status: PlanRecord['status'] = 'pending'): PlanRecord {
  return {
    id,
    name: 'n',
    planId: 'pid',
    createdAt,
    status,
    source: 'api',
    clusterKeys: ['k'],
    clusterTitles: ['t'],
    bytes: 10,
    targetCount: 1,
  };
}

test('list yeni kaydi en uste koyar', () => {
  const records = [rec('a', 1), rec('b', 3), rec('c', 2)];
  const out = PlanRecords.list(records);
  assert.equal(out[0]!.id, 'b');
  assert.equal(out[1]!.id, 'c');
  assert.equal(out[2]!.id, 'a');
});

test('counts dort anahtari dondurur (0 dahil)', () => {
  const records = [rec('a', 1, 'pending'), rec('b', 2, 'executed')];
  const c = PlanRecords.counts(records);
  assert.deepEqual(c, { pending: 1, executed: 1, cancelled: 0, failed: 0 });
});

test('canTransition kurallari', () => {
  assert.equal(PlanRecords.canTransition('pending', 'executed'), true);
  assert.equal(PlanRecords.canTransition('pending', 'cancelled'), true);
  assert.equal(PlanRecords.canTransition('pending', 'failed'), true);
  assert.equal(PlanRecords.canTransition('executed', 'cancelled'), false);
  assert.equal(PlanRecords.canTransition('executed', 'executed'), false);
});

test('apply yasal geciste status+executedAt yazar, girdiyi mutasyona uğratmaz', () => {
  const records = [rec('a', 1, 'pending')];
  const out = PlanRecords.apply(records, 'a', 'executed', 5, { freedBytes: 7, removed: 2 });
  assert.equal(out[0]!.status, 'executed');
  assert.equal(out[0]!.executedAt, 5);
  assert.equal(out[0]!.freedBytes, 7);
  assert.equal(out[0]!.removed, 2);
  assert.equal(records[0]!.status, 'pending');
  assert.equal(records[0]!.executedAt, undefined);
});

test('apply yasal olmayan geciste listeyi aynen dondurur', () => {
  const records = [rec('a', 1, 'executed')];
  const out = PlanRecords.apply(records, 'a', 'cancelled', 5);
  assert.equal(out[0]!.status, 'executed');
  assert.equal(out.length, records.length);
});

test('sync bekleyen kaydin kapsamini tazeler, gecmisi degistirmez', () => {
  const records = [
    rec('a', 1, 'pending'),
    { ...rec('b', 2, 'executed'), planId: 'pid' },
    { ...rec('c', 3, 'pending'), planId: 'other' },
  ];
  const out = PlanRecords.sync(records, {
    planId: 'pid',
    name: 'yeni ad',
    clusterKeys: ['k1', 'k2'],
    clusterTitles: ['t1', 't2'],
    bytes: 99,
    targetCount: 4,
  });
  assert.equal(out[0]!.name, 'yeni ad');
  assert.deepEqual(out[0]!.clusterKeys, ['k1', 'k2']);
  assert.deepEqual(out[0]!.clusterTitles, ['t1', 't2']);
  assert.equal(out[0]!.bytes, 99);
  assert.equal(out[0]!.targetCount, 4);
  assert.equal(out[1]!.name, 'n');
  assert.equal(out[2]!.name, 'n');
});

test('sync degisiklik yoksa ayni referansi dondurur', () => {
  const records = [rec('a', 1, 'pending')];
  const out = PlanRecords.sync(records, {
    planId: 'pid',
    name: 'n',
    clusterKeys: ['k'],
    clusterTitles: ['t'],
    bytes: 10,
    targetCount: 1,
  });
  assert.equal(out, records);
});

test('cancelPlan yalniz o planin bekleyen kaydini iptal eder', () => {
  const records = [
    rec('a', 1, 'pending'),
    { ...rec('b', 2, 'pending'), planId: 'other' },
    { ...rec('c', 3, 'executed'), planId: 'pid' },
  ];
  const out = PlanRecords.cancelPlan(records, 'pid', 7);
  assert.equal(out[0]!.status, 'cancelled');
  assert.equal(out[0]!.executedAt, 7);
  assert.equal(out[1]!.status, 'pending');
  assert.equal(out[2]!.status, 'executed');
});

test('trim 205 kayitta 200 birakir ve en yeni 200u tutar', () => {
  const records: PlanRecord[] = [];
  for (let i = 0; i < 205; i++) records.push(rec(`r${i}`, i + 1));
  const out = PlanRecords.trim(records);
  assert.equal(out.length, 200);
  // en eski 5 (createdAt 1..5) düşmeli
  const ids = new Set(out.map((r) => r.id));
  for (let i = 0; i < 5; i++) assert.equal(ids.has(`r${i}`), false);
  assert.equal(ids.has('r5'), true);
  assert.equal(ids.has('r204'), true);
});