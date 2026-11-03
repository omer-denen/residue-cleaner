import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeCliRepairs, planCliRepairs } from '../src/actions/cli-repair.ts';
import type { CliTool } from '../src/core/cli-inventory-types.ts';

function tool(over: Partial<CliTool> = {}): CliTool {
  return {
    id: 't',
    command: 'demo',
    source: 'npm-global',
    packageName: 'demo',
    version: '1.0.0',
    installPath: 'C:\\npm\\demo',
    shims: [],
    stalePaths: [],
    stateDirs: [],
    installedAt: 0,
    lastAccessAt: 0,
    lastStateAt: 0,
    historyMentions: 0,
    historyLastRatio: 1,
    totalBytes: 1,
    idleDays: 1,
    status: 'unused',
    confidence: 'high',
    evidence: [],
    usageSignals: [],
    atimeSuspect: false,
    uninstall: null,
    ...over,
  };
}

test('planCliRepairs yalniz onarim komutu olanlari alir', () => {
  const plan = planCliRepairs([
    tool({ id: 'a', repair: { kind: 'npm', program: 'npm', args: [], display: 'npm i -g demo' } }),
    tool({ id: 'b' }),
  ]);
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0]!.tool.id, 'a');
  assert.ok(plan.expiresAt > plan.createdAt);
  assert.match(plan.id, /^[0-9a-f]{16}$/);
});

test('executeCliRepairs basarili ve basarisiz komutu raporlar', async () => {
  const ok = await executeCliRepairs({
    id: 'x',
    createdAt: 0,
    expiresAt: 0,
    items: [
      {
        tool: tool({
          repair: { kind: 'npm', program: process.execPath, args: ['-e', 'console.log("ok")'], display: 'node ok' },
        }),
      },
    ],
  });
  assert.equal(ok[0]!.ok, true);
  assert.equal(ok[0]!.verified, true);
  assert.match(ok[0]!.output, /ok/);
  assert.equal(ok[0]!.error, undefined);

  const bad = await executeCliRepairs({
    id: 'x',
    createdAt: 0,
    expiresAt: 0,
    items: [
      {
        tool: tool({
          repair: { kind: 'npm', program: process.execPath, args: ['-e', 'process.exit(1)'], display: 'node fail' },
        }),
      },
    ],
  });
  assert.equal(bad[0]!.ok, false);
  assert.equal(bad[0]!.verified, false);
  assert.match(bad[0]!.error ?? '', /cikis kodu 1/);
});

test('executeCliRepairs onarim komutu yoksa dogrulanmamis hata doner', async () => {
  const out = await executeCliRepairs({ id: 'x', createdAt: 0, expiresAt: 0, items: [{ tool: tool() }] });
  assert.equal(out[0]!.ok, false);
  assert.equal(out[0]!.verified, false);
  assert.match(out[0]!.output, /Onarim komutu yok/);
});
