import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.LOCALAPPDATA = await mkdtemp(join(tmpdir(), 'residue-schedule-env-'));

const { ScheduleService } = await import('../src/services/schedule-service.ts');
const { ServiceError } = await import('../src/services/errors.ts');
const { ApprovalRules } = await import('../src/core/approval.ts');
const { envOptionsOf, envPreview } = await import('../src/core/plan-engine.ts');
const { loadScheduleStore, saveScheduleStore, upsertRule } = await import(
  '../src/store/schedules.ts'
);

const svc = new ScheduleService({} as never, {} as never);
const PLANLA = ApprovalRules.phrase('schedule');
const TEMIZLE = ApprovalRules.phrase('envClean');

function input(over: Record<string, unknown> = {}) {
  return {
    name: 'Ortam plani',
    frequency: 'daily',
    hour: 3,
    minute: 0,
    selector: {},
    ...over,
  } as never;
}

function envInput(over: Record<string, unknown> = {}) {
  return input({ mode: 'env', ...over });
}

const envApprove = { envPhrase: TEMIZLE };

async function rejects(fn: () => Promise<unknown>, status: number, pattern?: RegExp) {
  await assert.rejects(fn, (err: unknown) => {
    assert.ok(err instanceof ServiceError, 'ServiceError bekleniyordu');
    assert.equal(err.status, status);
    if (pattern) assert.match(err.message, pattern);
    return true;
  });
}

test('E1: envOptionsOf varsayilanlari dondurur', () => {
  const rule = { env: undefined } as never;
  assert.deepEqual(envOptionsOf(rule), {
    scope: 'user',
    removeMissing: true,
    removeDuplicates: true,
  });
});

test('E2: envOptionsOf gecersiz kapsami user yapar, false secenegi korur', () => {
  const rule = { env: { scope: 'gecersiz', removeMissing: false } } as never;
  const options = envOptionsOf(rule);
  assert.equal(options.scope, 'user');
  assert.equal(options.removeMissing, false);
  assert.equal(options.removeDuplicates, true);
});

test('E3: envPreview degisiklikleri tasir, kasaya tasima yok', () => {
  const rule = { id: 'r1', mode: 'env' } as never;
  const preview = envPreview(rule, [{ scope: 'machine', name: 'PATH', reason: 'olmayan dizin' }]);
  assert.equal(preview.ruleId, 'r1');
  assert.equal(preview.mode, 'env');
  assert.equal(preview.items.length, 0);
  assert.equal(preview.totalBytes, 0);
  assert.deepEqual(preview.envChanges, [
    { scope: 'machine', name: 'PATH', reason: 'olmayan dizin' },
  ]);
});

test('E4: env kurali yazili TEMIZLE onayi olmadan olusturulamaz', async () => {
  await rejects(
    () => svc.create(input({ mode: 'env' })),
    400,
    /TEMIZLE/,
  );
  await rejects(() => svc.create(input({ mode: 'env', envPhrase: 'sil' })), 400, /TEMIZLE/);
});

test('E5: env kurali TEMIZLE ile olusur ve onay kaydi yazilir', async () => {
  const rule = await svc.create(envInput({ env: { scope: 'both', removeDuplicates: false } }), envApprove);
  assert.equal(rule.mode, 'env');
  assert.deepEqual(rule.env, { scope: 'both', removeMissing: true, removeDuplicates: false });
  assert.equal(typeof rule.envApprovedAt, 'number');
  assert.ok((rule.envApprovedAt ?? 0) > 0);
  await svc.remove(rule.id);
});

test('E6: vault kurali varsayilan kalir, env alanlari tasimaz', async () => {
  const rule = await svc.create(input());
  assert.equal(rule.mode, 'vault');
  assert.equal(rule.env, undefined);
  assert.equal(rule.envApprovedAt, undefined);
  await svc.remove(rule.id);
});

test('E7: env kuralinda selector risk siniri uygulanmaz', async () => {
  const rule = await svc.create(envInput({ selector: { maxRisk: 'high' } }), envApprove);
  assert.equal(rule.mode, 'env');
  await svc.remove(rule.id);
  await rejects(() => svc.create(input({ selector: { maxRisk: 'high' } })), 400);
});

test('E8: env kurali en az bir temizlik kurali ister', async () => {
  await rejects(
    () => svc.create(envInput({ env: { removeMissing: false, removeDuplicates: false } }), envApprove),
    400,
    /en az bir/,
  );
});

test('E9: gecersiz env kapsami user olarak kaydedilir', async () => {
  const rule = await svc.create(envInput({ env: { scope: 'gecersiz' } }), envApprove);
  assert.equal(rule.env?.scope, 'user');
  await svc.remove(rule.id);
});

test('E10: env kuralini etkinlestirmek TEMIZLE onayi ister', async () => {
  const rule = await svc.create(envInput(), envApprove);
  await svc.update(rule.id, { enabled: false });
  await rejects(
    () => svc.update(rule.id, { enabled: true }, { phrase: PLANLA }),
    400,
    /TEMIZLE/,
  );
  const enabled = await svc.update(rule.id, { enabled: true }, { phrase: PLANLA, envPhrase: TEMIZLE });
  assert.equal(enabled.enabled, true);
  assert.ok((enabled.envApprovedAt ?? 0) >= (rule.envApprovedAt ?? 0));
  await svc.remove(rule.id);
});

test('E11: vault kurali env moduna cevrilirken TEMIZLE ister', async () => {
  const rule = await svc.create(input());
  await rejects(
    () => svc.update(rule.id, { mode: 'env' }, { phrase: PLANLA }),
    400,
    /TEMIZLE/,
  );
  const switched = await svc.update(
    rule.id,
    { mode: 'env' },
    { phrase: PLANLA, envPhrase: TEMIZLE },
  );
  assert.equal(switched.mode, 'env');
  assert.equal(typeof switched.envApprovedAt, 'number');
  await svc.remove(rule.id);
});

test('E12: onay kaydi olmayan env kurali CALISMAZ ve PATH yazilmaz', async () => {
  const store = await loadScheduleStore();
  const now = Date.now();
  await upsertRule({
    id: 'env-no-approval',
    name: 'Onaysiz ortam',
    mode: 'env',
    frequency: 'daily',
    hour: 3,
    minute: 0,
    selector: { maxRisk: 'safe', maxItems: 10 },
    env: { scope: 'user', removeMissing: true, removeDuplicates: true },
    enabled: true,
    createdAt: now,
    compensateMissed: false,
  });
  assert.ok(store.rules.every((r) => r.id !== 'env-no-approval'));

  const run = await svc.run('env-no-approval');
  assert.equal(run.status, 'failed');
  assert.match(run.error ?? '', /TEMIZLE onayi/);
  assert.equal(run.envBackup, undefined);

  const after = await loadScheduleStore();
  assert.equal(after.runs.some((r) => r.id === run.id), true);
});

test('E13: depo normalizasyonu env alanlarini ve onay kaydini temizler', async () => {
  const now = Date.now();
  const base = {
    frequency: 'daily',
    hour: 3,
    minute: 0,
    selector: { maxRisk: 'safe', maxItems: 10 },
    enabled: true,
    createdAt: now,
    compensateMissed: true,
  };
  await saveScheduleStore({
    version: 1,
    rules: [
      { ...base, id: 'vault-junk', name: 'Vault', mode: 'vault', env: { scope: 'both' }, envApprovedAt: now },
      { ...base, id: 'env-bare', name: 'Env', mode: 'env' },
      { ...base, id: 'env-bad-at', name: 'Env2', mode: 'env', envApprovedAt: 'dun' },
    ] as never,
    runs: [],
  });
  const store = await loadScheduleStore();
  const vault = store.rules.find((r) => r.id === 'vault-junk');
  assert.ok(vault);
  assert.equal(vault.env, undefined);
  assert.equal(vault.envApprovedAt, undefined);

  const bare = store.rules.find((r) => r.id === 'env-bare');
  assert.ok(bare);
  assert.deepEqual(bare.env, { scope: 'user', removeMissing: true, removeDuplicates: true });

  const badAt = store.rules.find((r) => r.id === 'env-bad-at');
  assert.ok(badAt);
  assert.equal(badAt.envApprovedAt, undefined);
});

after(async () => {
  await rm(process.env.LOCALAPPDATA!, { recursive: true, force: true });
});
