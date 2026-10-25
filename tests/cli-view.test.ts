import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CliInventory, CliTool, UninstallSpec } from '../src/core/cli-inventory-types.ts';
import { CliView } from '../src/core/cli-view.ts';

function spec(command: string): UninstallSpec {
  return {
    kind: 'npm',
    program: 'npm',
    args: ['uninstall', '-g', command],
    display: `npm uninstall -g ${command}`,
  };
}

function tool(overrides: Partial<CliTool> & { id: string; command: string }): CliTool {
  return {
    source: 'npm-global',
    packageName: overrides.command,
    version: '1.0.0',
    installPath: `C:\\tools\\${overrides.command}`,
    shims: [`C:\\shims\\${overrides.command}.cmd`],
    stalePaths: [],
    stateDirs: [],
    installedAt: 0,
    lastAccessAt: 0,
    lastStateAt: 0,
    historyMentions: 0,
    historyLastRatio: 1,
    totalBytes: 1000,
    idleDays: 30,
    status: 'unused',
    confidence: 'high',
    evidence: ['shim atime 40 gün önce'],
    usageSignals: [],
    atimeSuspect: false,
    uninstall: spec(overrides.command),
    ...overrides,
  };
}

const tools: CliTool[] = [
  tool({ id: 'npm:old', command: 'old-cli', totalBytes: 1000, idleDays: 40 }),
  tool({
    id: 'standalone:recent',
    command: 'recent-cli',
    source: 'standalone',
    status: 'recent',
    totalBytes: 500,
    idleDays: 1,
    uninstall: spec('recent-cli'),
  }),
  tool({
    id: 'uv:unknown',
    command: 'uv-cli',
    source: 'uv-tool',
    status: 'unknown',
    totalBytes: 2000,
    idleDays: 10,
    health: 'broken',
    evidence: ['uv-receipt.toml', 'son kullanım bilinmiyor'],
  }),
  tool({
    id: 'npm:protected',
    command: 'npm',
    status: 'protected',
    totalBytes: 3000,
    idleDays: 100,
    uninstall: null,
  }),
];

const inventory: CliInventory = {
  scannedAt: 1_700_000_000_000,
  unusedDays: 21,
  tools,
  duplicates: [],
  roots: ['C:\\tools'],
  notes: [],
  shimIssues: [],
  pathShadows: [],
};

test('arac listesi: durum sayimlari ve filtre', () => {
  const view = new CliView(inventory);
  const all = view.view();
  assert.equal(all.counts.total, 4);
  assert.equal(all.counts.unused, 1);
  assert.equal(all.counts.unknown, 1);
  assert.equal(all.counts.protected, 1);
  assert.equal(all.counts.broken, 1);
  assert.equal(all.summary.total, 4);
  assert.equal(all.summary.visible, 4);
  assert.equal(all.summary.recent, 1);
  assert.equal(all.summary.unusedBytes, 1000);
  assert.equal(all.summary.totalBytes, 6500);
  assert.equal(all.summary.removable, 3);
  assert.deepEqual(
    all.tools.map((x) => x.command),
    ['old-cli', 'uv-cli', 'recent-cli', 'npm'],
  );

  const unused = view.view({ status: 'unused' });
  assert.equal(unused.tools.length, 1);
  assert.equal(unused.tools[0]?.command, 'old-cli');
  assert.deepEqual(unused.selectableIds, ['npm:old']);

  const protectedView = view.view({ status: 'protected' });
  assert.equal(protectedView.tools.length, 1);
  assert.deepEqual(protectedView.selectableIds, []);
});

test('arac listesi: kaynak, arama ve siralama motorda', () => {
  const view = new CliView(inventory);
  assert.deepEqual(
    view.view({ source: 'standalone' }).tools.map((x) => x.command),
    ['recent-cli'],
  );
  assert.deepEqual(
    view.view({ text: 'UV-CLI' }).tools.map((x) => x.command),
    ['uv-cli'],
  );
  assert.deepEqual(
    view.view({ text: 'uv-receipt' }).tools.map((x) => x.command),
    ['uv-cli'],
  );
  assert.deepEqual(
    view.view({ text: 'yok' }).tools.map((x) => x.command),
    [],
  );

  assert.deepEqual(
    view.view({ sort: 'size' }).tools.map((x) => x.command),
    ['npm', 'uv-cli', 'old-cli', 'recent-cli'],
  );
  assert.deepEqual(
    view.view({ sort: 'idle' }).tools.map((x) => x.command),
    ['npm', 'old-cli', 'uv-cli', 'recent-cli'],
  );
  assert.deepEqual(
    view.view({ sort: 'name' }).tools.map((x) => x.command),
    ['npm', 'old-cli', 'recent-cli', 'uv-cli'],
  );
});

test('arac listesi: kaynak sayimlari ve filtre yankisi', () => {
  const view = new CliView(inventory);
  const out = view.view({ text: ' cli ', status: 'unused', source: 'npm-global', sort: 'size' });
  assert.deepEqual(out.filter, {
    text: 'cli',
    status: 'unused',
    source: 'npm-global',
    sort: 'size',
  });
  assert.equal(out.sources.length, 3);
  const npm = out.sources.find((s) => s.source === 'npm-global');
  assert.equal(npm?.count, 2);
  assert.equal(npm?.bytes, 4000);
});

test('arac listesi: bilinmeyen filtre guvenli varsayilana duser', () => {
  const out = new CliView(inventory).view({
    text: '',
    status: 'bozuk',
    source: 'bozuk',
    sort: 'bozuk',
  });
  assert.equal(out.filter.status, 'all');
  assert.equal(out.filter.source, 'all');
  assert.equal(out.filter.sort, 'status');
  assert.equal(out.tools.length, 4);
});
