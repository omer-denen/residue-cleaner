import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.LOCALAPPDATA = await mkdtemp(join(tmpdir(), 'residue-schedule-service-'));

const { ScheduleService } = await import('../src/services/schedule-service.ts');
const { ServiceError } = await import('../src/services/errors.ts');

const svc = new ScheduleService({} as never, {} as never);

function input(over: Record<string, unknown> = {}) {
  return {
    name: 'Test plani',
    frequency: 'daily',
    hour: 3,
    minute: 0,
    selector: {},
    ...over,
  } as never;
}

async function rejects(fn: () => Promise<unknown>, status: number) {
  await assert.rejects(fn, (err: unknown) => err instanceof ServiceError && err.status === status);
}

test('create dogrulama: ad, siklik, saat ve risk siniri', async () => {
  await rejects(() => svc.create(input({ name: 'a' })), 400);
  await rejects(() => svc.create(input({ name: 'x'.repeat(81) })), 400);
  await rejects(() => svc.create(input({ frequency: 'monthly' })), 400);
  await rejects(() => svc.create(input({ hour: 24 })), 400);
  await rejects(() => svc.create(input({ minute: -1 })), 400);
  await rejects(() => svc.create(input({ selector: { maxRisk: 'high' } })), 400);
  await rejects(() => svc.create(input({ selector: { maxRisk: 'medium' } })), 400);
});

test('create sinirlari kirpar ve varsayilanlari uygular', async () => {
  const weekly = await svc.create(input({ frequency: 'weekly', weekday: 99, selector: { maxItems: 1000 } }));
  assert.equal(weekly.weekday, 6);
  assert.equal(weekly.selector.maxItems, 100);
  const daily = await svc.create(
    input({ hour: 0, minute: 0, enabled: false, compensateMissed: false, selector: { minIdleDays: -5, maxItems: 0, keys: ['a', 2], categories: ['cache'] } }),
  );
  assert.equal(daily.enabled, false);
  assert.equal(daily.compensateMissed, false);
  assert.deepEqual(daily.selector.keys, ['a']);
  assert.equal(daily.selector.minIdleDays, 0);
  assert.equal(daily.selector.maxItems, 1);
  const once = await svc.create(input({ frequency: 'once', runAt: 1 }));
  assert.ok((once.runAt ?? 0) > Date.now());
  const later = await svc.create(input({ frequency: 'once', runAt: Date.now() + 600_000 }));
  assert.ok((later.runAt ?? 0) > Date.now() + 300_000);
});

test('update ve remove olmayan kuralda 404 dondurur', async () => {
  await rejects(() => svc.update('yok', { name: 'Yeni' }), 404);
  await rejects(() => svc.remove('yok'), 404);
  const created = await svc.create(input());
  const updated = await svc.update(created.id, { enabled: false });
  assert.equal(updated.enabled, false);
  await svc.remove(created.id);
});

after(async () => {
  await rm(process.env.LOCALAPPDATA!, { recursive: true, force: true });
});
