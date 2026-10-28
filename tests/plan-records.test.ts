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