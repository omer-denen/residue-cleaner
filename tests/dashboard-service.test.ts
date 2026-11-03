import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DashboardService } from '../src/services/dashboard-service.ts';
import { ScanStatusView } from '../src/core/scan-status-view.ts';
import type { CliInventory, CliTool } from '../src/core/cli-inventory-types.ts';

function statusView() {
  return new ScanStatusView({
    state: 'current',
    lastScanAt: Date.now() - 60_000,
    ageMs: 60_000,
    ttlMs: 86_400_000,
    nextRecommendedAt: null,
    dirty: false,
    scanning: false,
    clusters: 2,
    disk: null,
  } as never).view();
}

function tool(over: Partial<CliTool> = {}): CliTool {
  return {
    id: 't',
    command: 't',
    source: 'npm-global',
    packageName: 't',
    version: '1',
    installPath: 'C:\\t',
    shims: [],
    stalePaths: [],
    stateDirs: [],
    installedAt: 0,
    lastAccessAt: 0,
    lastStateAt: 0,
    historyMentions: 0,
    historyLastRatio: 1,
    totalBytes: 10,
    idleDays: 3,
    status: 'unused',
    confidence: 'high',
    evidence: [],
    usageSignals: [],
    atimeSuspect: false,
    uninstall: null,
    ...over,
  };
}

function service(opts: { inv?: CliInventory | null; env?: unknown; graph?: unknown; schedules?: unknown[] } = {}) {
  const scan = {
    status: async () => ({
      state: 'current',
      lastScanAt: Date.now() - 1000,
      ageMs: 1000,
      ttlMs: 1000,
      nextRecommendedAt: null,
      dirty: false,
      scanning: false,
      clusters: 1,
      disk: null,
      view: statusView(),
    }),
    last: () => null,
    settings: async () => ({ vaultRetentionDays: 7 }),
  };
  const inventory = { getLast: () => (opts.inv === undefined ? null : opts.inv) };
  const env = { analyze: async () => opts.env };
  const graph = { viewCached: async () => opts.graph };
  const schedules = { list: async () => opts.schedules ?? [] };
  return new DashboardService(
    scan as never,
    env as never,
    graph as never,
    schedules as never,
    inventory as never,
  );
}

test('dashboard envanter, ortam, graf ve zamanlama verisini toplar', async () => {
  const out = await service({
    inv: {
      tools: [
        tool({ id: 'a', totalBytes: 10, health: 'broken' }),
        tool({ id: 'b', totalBytes: 20, status: 'recent' }),
      ],
    } as unknown as CliInventory,
    env: {
      findings: [
        { kind: 'missing-path', severity: 'warning', reason: 'yok' },
        { kind: 'duplicate-path', severity: 'warning', reason: 'tekrar' },
        { kind: 'orphan-variable', severity: 'info', reason: 'yetim' },
      ],
      commandShadows: [{ command: 'x', winner: 'a', shadowed: ['b', 'c'] }],
    },
    graph: {
      edges: [{ id: 'e', from: 'a', to: 'b', state: 'broken', kind: 'k', evidence: 'ev' }],
      summary: { broken: 1, critical: 2, shadowed: 3 },
    },
    schedules: [
      { id: 's1', name: 'bir', missed: 2, due: false },
      { id: 's2', name: 'iki', missed: 0, due: true },
      { id: 's3', name: 'uc', missed: 0, due: false },
    ],
  }).view();
  const cli = out.ledgers.find((l) => l.id === 'cli');
  assert.equal(cli?.bytes, 30);
  assert.equal(cli?.known, true);
  assert.equal(out.cards.find((c) => c.id === 'broken-installs')?.count, 1);
  assert.equal(out.cards.find((c) => c.id === 'path-issues')?.count, 2);
  assert.equal(out.cards.find((c) => c.id === 'shadowed-commands')?.count, 1);
  assert.equal(out.cards.find((c) => c.id === 'orphan-vars')?.count, 1);
  assert.equal(out.cards.find((c) => c.id === 'schedule-missed')?.count, 2);
  assert.equal(out.cards.find((c) => c.id === 'schedule-due')?.count, 1);
});

test('dashboard bilinmeyen envanter ve hatali servislerde sifir doner', async () => {
  const out = await service({
    inv: null,
    env: null,
    graph: null,
    schedules: undefined,
  }).view();
  const cli = out.ledgers.find((l) => l.id === 'cli');
  assert.equal(cli?.known, false);
  assert.equal(cli?.bytes, 0);
  assert.equal(out.cards.some((c) => c.id === 'broken-installs'), false);
  assert.equal(out.cards.some((c) => c.id === 'path-issues'), false);
  assert.equal(out.cards.some((c) => c.id === 'schedule-missed'), false);
});
