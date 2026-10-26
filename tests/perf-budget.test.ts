import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { runScan } from '../src/commands/scan.ts';

const BUDGET_KEYS = [
  'scan10kMs',
  'scan10kRssMb',
  'diskView100P95Ms',
  'vaultFilesPerSecMin',
  'load100kMs',
  'load100kRssMb',
];

const ENV_KEYS = ['LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'TEMP', 'TMP', 'HOME', 'npm_config_prefix'];

let sandbox = '';
const origEnv: Record<string, string | undefined> = {};

before(async () => {
  const systemTmp = tmpdir();
  sandbox = await mkdtemp(join(systemTmp, 'residue-perf-test-env-'));
  for (const k of ENV_KEYS) {
    origEnv[k] = process.env[k];
    process.env[k] = sandbox;
  }
});

after(async () => {
  for (const k of ENV_KEYS) {
    if (origEnv[k] === undefined) delete process.env[k];
    else process.env[k] = origEnv[k];
  }
  await rm(sandbox, { recursive: true, force: true });
});

function readBudget() {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'scripts/perf-budget.json'), 'utf8'));
}

test('perf-budget.json gecerli JSON ve pozitif butceler', () => {
  const b = readBudget() as any;
  assert.equal(b.version, 1);
  assert.ok(b.budgets && typeof b.budgets === 'object');
  assert.ok(b.rationale && typeof b.rationale === 'object');
  for (const k of BUDGET_KEYS) {
    assert.equal(typeof b.budgets[k], 'number', `${k} sayi olmali`);
    assert.ok(b.budgets[k] > 0, `${k} pozitif olmali`);
    assert.equal(typeof b.rationale[k], 'string', `${k} rationale string olmali`);
    assert.ok(String(b.rationale[k]).trim().length > 0, `${k} rationale dolu olmali`);
  }
});

test('perf-budget.json measured alanlari dolu', () => {
  const b = readBudget() as any;
  assert.ok(b.measured && typeof b.measured === 'object');
  for (const k of BUDGET_KEYS) {
    assert.equal(typeof b.measured[k], 'number', `${k} measured sayi olmali`);
    assert.ok(b.measured[k] > 0, `${k} measured pozitif olmali`);
  }
  assert.equal(b.machine.platform, process.platform);
});

test('kaba tarama kapisi (2000 dosya, 5x esik)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'residue-perf-test-scan-'));
  const folders = 40;
  const files = 50;
  for (let i = 0; i < folders; i++) {
    const dir = join(root, `d${i}`);
    await mkdir(dir, { recursive: true });
    for (let j = 0; j < files; j++) {
      await writeFile(join(dir, `f${j}.txt`), 'x'.repeat(1024));
    }
  }
  const budget = readBudget() as any;
  const limit = budget.budgets.scan10kMs * 5;
  const t0 = performance.now();
  await runScan({
    envs: [],
    minAgeDays: 0,
    json: true,
    includeBytes: true,
    exclude: [],
    quiet: true,
    roots: [root],
  });
  const elapsed = performance.now() - t0;
  await rm(root, { recursive: true, force: true });
  assert.ok(elapsed < limit, `tarama ${elapsed.toFixed(0)} ms >= ${limit} ms`);
});