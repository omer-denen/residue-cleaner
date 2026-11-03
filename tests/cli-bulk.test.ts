import test from 'node:test';
import assert from 'node:assert/strict';
import { CliBulk } from '../src/core/cli-bulk.ts';
import type { CliTool } from '../src/core/cli-inventory-types.ts';

function tool(over: Partial<CliTool>): CliTool {
  return {
    id: 'a',
    command: 'a',
    source: 'standalone',
    packageName: 'a',
    version: '1.0.0',
    installPath: 'C:/tools/a',
    shims: ['C:/bin/a.cmd'],
    stalePaths: [],
    stateDirs: [],
    installedAt: 0,
    lastAccessAt: 0,
    lastStateAt: 0,
    historyMentions: 0,
    historyLastRatio: 0,
    totalBytes: 10,
    idleDays: 30,
    status: 'unused',
    confidence: 'high',
    evidence: [],
    usageSignals: [],
    atimeSuspect: false,
    uninstall: null,
    ...over,
  };
}

test('kaldirilabilir arac selectableIds ile secilebilir', () => {
  const t = tool({ id: 'npm-tool', source: 'npm-global', uninstall: { kind: 'npm', program: 'npm', args: [], display: 'npm rm x' } });
  assert.equal(CliBulk.isSelectable(t, []), false);
  assert.equal(CliBulk.isSelectable(t, ['npm-tool']), true);
});

test('onarim komutu olan arac secilebilir ve onarim listesine girer', () => {
  const broken = tool({ id: 'broken', repair: { kind: 'npm', program: 'npm', args: [], display: 'npm i -g x' } });
  const ok = tool({ id: 'ok' });
  assert.equal(CliBulk.isSelectable(broken, []), true);
  assert.deepEqual(CliBulk.repairIds([broken, ok]), ['broken']);
});

test('karantina yalniz standalone + shim olanlari alir', () => {
  const standalone = tool({ id: 'standalone', source: 'standalone' });
  const npm = tool({ id: 'npm', source: 'npm-global' });
  const shimless = tool({ id: 'shimless', source: 'standalone', shims: [] });
  assert.deepEqual(CliBulk.quarantineIds([standalone, npm, shimless]), ['standalone']);
  assert.deepEqual(CliBulk.idsFor([standalone, npm, shimless], 'quarantine'), ['standalone']);
});

test('sayimlar gorunen liste uzerinden hesaplanir', () => {
  const npm = tool({ id: 'npm', source: 'npm-global', uninstall: { kind: 'npm', program: 'npm', args: [], display: '' } });
  const broken = tool({ id: 'broken', repair: { kind: 'npm', program: 'npm', args: [], display: '' } });
  const standalone = tool({ id: 'standalone' });
  assert.deepEqual(CliBulk.counts([npm, broken, standalone], ['npm']), {
    selectable: 3,
    repair: 1,
    quarantine: 2,
  });
});
