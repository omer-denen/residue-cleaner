import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DashboardSummary, type DashboardFacts } from '../src/core/dashboard-summary.ts';
import { scanStatusView } from '../src/core/scan-status-view.ts';
import type { ScanStatusFacts } from '../src/core/contract.ts';
import type { Cluster } from '../src/core/types.ts';
import { cluster, verdict } from './helpers.ts';

const TTL = 86_400_000;

/** Ham tarama gercekleri (motor bunu karara cevirir). */
function scanFacts(over: Partial<ScanStatusFacts> = {}): ScanStatusFacts {
  return {
    state: 'current',
    lastScanAt: 900,
    ageMs: 100,
    ttlMs: TTL,
    nextRecommendedAt: 900 + TTL,
    dirty: false,
    scanning: false,
    clusters: 0,
    disk: null,
    ...over,
  };
}

/** Dashboard'in tarama bolumu: gorunum MOTORDA uretilir. */
function scanPart(clusters: Cluster[], over: Partial<ScanStatusFacts> = {}) {
  const f = scanFacts(over);
  return {
    state: f.state,
    at: f.lastScanAt,
    ageMs: f.ageMs,
    scanning: f.scanning,
    clusters,
    view: scanStatusView(f),
  };
}

function facts(over: Partial<DashboardFacts> = {}): DashboardFacts {
  return {
    now: 1_000,
    scan: scanPart([]),
    inventory: {
      diskBytes: 0,
      diskCount: 0,
      cliBytes: 0,
      cliCount: 0,
      brokenInstalls: 0,
      cliKnown: true,
    },
    env: null,
    graph: null,
    recover: { interrupted: 0 },
    vault: { entries: 0, bytes: 0, expired: 0, lastAt: null },
    schedules: { rules: 0, due: 0, missed: 0 },
    details: [],
    ...over,
  };
}

test('iki defter: korunan = toplam - geri kazanilabilir', () => {
  const view = new DashboardSummary(
    facts({
      scan: scanPart([
        cluster({ key: 'a', totalBytes: 1000, reclaimableBytes: 400 }),
        cluster({ key: 'b', totalBytes: 2000, reclaimableBytes: 0 }),
      ]),
      vault: { entries: 2, bytes: 500, expired: 1, lastAt: 123 },
      inventory: {
        diskBytes: 3000,
        diskCount: 2,
        cliBytes: 700,
        cliCount: 3,
        brokenInstalls: 0,
        cliKnown: true,
      },
    }),
  ).view();

  const ledgers = Object.fromEntries(view.ledgers.map((l) => [l.id, l.bytes]));
  assert.equal(ledgers.protected, 2600);
  assert.equal(ledgers.reclaimable, 400);
  assert.equal(ledgers.vault, 500);
  assert.equal(ledgers.cli, 700);
  assert.equal(view.ledgers.find((l) => l.id === 'vault')?.count, 2);
  assert.equal(view.totals.scannedBytes, 3000);
  assert.equal(view.totals.deletableBytes, 400);
  assert.equal(view.lastVaultAt, 123);
  assert.equal(view.ledgers.find((l) => l.id === 'cli')?.known, true);
  assert.equal(view.ledgers.find((l) => l.id === 'cli')?.detailId, 'ledger-cli');
});

test('envanter yoksa CLI defteri bilinmiyor', () => {
  const view = new DashboardSummary(facts({ inventory: null })).view();
  const cli = view.ledgers.find((l) => l.id === 'cli');
  assert.equal(cli?.known, false);
  assert.equal(cli?.bytes, 0);
});

test('guvenli kazanimlar yalnizca DefaultSelection kuralini gecenler', () => {
  const clusters = [
    cluster({ key: 'safe-big', reclaimableBytes: 900, totalBytes: 900 }),
    cluster({ key: 'safe-small', reclaimableBytes: 100, totalBytes: 100 }),
    cluster({ key: 'ask', verdict: verdict({ kind: 'ask', risk: 'medium' }) }),
    cluster({ key: 'keep', verdict: verdict({ kind: 'keep' }) }),
    cluster({ key: 'user-data', verdict: verdict({ regenerability: 'user-data' }) }),
    cluster({ key: 'no-target', deleteTargets: [] }),
  ];
  const view = new DashboardSummary(
    facts({
      scan: scanPart(clusters),
    }),
  ).view();

  assert.deepEqual(
    view.safeWins.map((w) => w.clusterKey),
    ['safe-big', 'safe-small'],
  );
  assert.equal(view.safeWins[0]?.category, 'unused');
  assert.equal(view.safeWins[0]?.regenerability, 'regenerable');
});

test('kartlar: tarama, ortam, kurtarma, kasa ve planlar', () => {
  const view = new DashboardSummary(
    facts({
      scan: scanPart([], { ageMs: TTL + 1_000 }),
      inventory: {
        diskBytes: 0,
        diskCount: 0,
        cliBytes: 0,
        cliCount: 0,
        brokenInstalls: 2,
        cliKnown: true,
      },
      env: { pathIssues: 3, orphanVars: 1, shadowedCommands: 4 },
      graph: { broken: 1, critical: 0, shadowed: 2 },
      recover: { interrupted: 1 },
      vault: { entries: 0, bytes: 0, expired: 3, lastAt: null },
      schedules: { rules: 2, due: 1, missed: 2 },
    }),
  ).view();

  assert.deepEqual(
    view.cards.map((c) => c.id),
    [
      'scan-stale',
      'broken-installs',
      'broken-dependencies',
      'path-issues',
      'shadowed-commands',
      'orphan-vars',
      'interrupted',
      'vault-expired',
      'schedule-missed',
      'schedule-due',
    ],
  );
  assert.equal(view.cards.find((c) => c.id === 'path-issues')?.count, 3);
  assert.equal(view.cards.find((c) => c.id === 'interrupted')?.tone, 'danger');
  assert.deepEqual(view.cards.find((c) => c.id === 'scan-stale')?.meta, {
    at: 900,
    ageMs: TTL + 1_000,
  });
});

test('tarama karti meta tasir; kart kimlikleri benzersiz', () => {
  const view = new DashboardSummary(
    facts({
      scan: scanPart([], { dirty: true }),
      schedules: { rules: 2, due: 1, missed: 2 },
    }),
  ).view();
  const scan = view.cards.find((c) => c.id === 'scan-dirty');
  assert.equal(scan?.tone, 'danger');
  assert.deepEqual(scan?.meta, { at: 900, ageMs: 100 });
  assert.equal(new Set(view.cards.map((c) => c.id)).size, view.cards.length);
});

test('tarama hic yapilmadiysa bilgi karti cikar, sayilar sifir', () => {
  const view = new DashboardSummary(
    facts({ scan: scanPart([], { state: 'never', lastScanAt: null, ageMs: null }) }),
  ).view();

  assert.deepEqual(
    view.cards.map((c) => c.id),
    ['scan-missing'],
  );
  assert.equal(view.scan.clusters, 0);
  assert.equal(view.totals.clusters, 0);
  assert.equal(view.lastVaultAt, null);
});

test('gorunum yalniz kimlik + sayi tasir (metin yok)', () => {
  const view = new DashboardSummary(facts()).view();
  const text = JSON.stringify(view);
  assert.equal(text.includes('Korunan'), false);
  assert.equal(text.includes('Geri kazan'), false);
  assert.equal(typeof view.generatedAt, 'number');
});
