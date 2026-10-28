import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeleteService } from '../src/services/delete-service.ts';
import type { ScanService } from '../src/services/scan-service.ts';

let root = '';

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'residue-plan-record-service-'));
  process.env.LOCALAPPDATA = root;
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

const fakeScan = { last: () => ({ scan: { clusters: [{ key: 'k1', title: 'Kume 1' }] } }) };
const fakeDelete = {
  createPlan: () => ({
    planId: 'p1',
    name: '',
    plan: {
      mode: 'recycle',
      clusters: [{ key: 'k1', title: 'Kume 1' }],
      targets: [{ target: { path: 'C:\\x' }, bytes: 1000 }],
      totalBytes: 1000,
    },
  }),
};

test('create -> pending, bytes 1000, targetCount 1, clusterCount yok', async () => {
  const { PlanRecordService } = await import('../src/services/plan-record-service.ts');
  const svc = new PlanRecordService(
    fakeDelete as unknown as DeleteService,
    fakeScan as unknown as ScanService,
  );
  const out = await svc.create({ clusterKeys: ['k1'], source: 'dashboard' });
  assert.equal(out.record.status, 'pending');
  assert.equal(out.record.bytes, 1000);
  assert.equal(out.record.targetCount, 1);
  assert.equal('clusterCount' in out.record, false);
});

test('list ayni kaydi dondurur ve counts.pending === 1 (diskten okur)', async () => {
  const { PlanRecordService } = await import('../src/services/plan-record-service.ts');
  const svc = new PlanRecordService(
    fakeDelete as unknown as DeleteService,
    fakeScan as unknown as ScanService,
  );
  const { records, counts } = await svc.list();
  assert.equal(records.length, 1);
  assert.equal(records[0]!.status, 'pending');
  assert.equal(counts.pending, 1);
});

test('markExecuted -> executed, executedAt sayi, freedBytes, removed; list gosterir', async () => {
  const { PlanRecordService } = await import('../src/services/plan-record-service.ts');
  const svc = new PlanRecordService(
    fakeDelete as unknown as DeleteService,
    fakeScan as unknown as ScanService,
  );
  const out = await svc.markExecuted('p1', { freedBytes: 1000, removed: 3 });
  const rec = out.find((r) => r.planId === 'p1')!;
  assert.equal(rec.status, 'executed');
  assert.equal(typeof rec.executedAt, 'number');
  assert.equal(rec.freedBytes, 1000);
  assert.equal(rec.removed, 3);
  const listed = await svc.list();
  assert.equal(listed.records.find((r) => r.planId === 'p1')!.status, 'executed');
});

test('executed kayda mark cancelled -> durum degismez', async () => {
  const { PlanRecordService } = await import('../src/services/plan-record-service.ts');
  const svc = new PlanRecordService(
    fakeDelete as unknown as DeleteService,
    fakeScan as unknown as ScanService,
  );
  const out = await svc.mark('p1', 'cancelled');
  const rec = out.find((r) => r.planId === 'p1')!;
  assert.equal(rec.status, 'executed');
  assert.equal(rec.error, undefined);
});