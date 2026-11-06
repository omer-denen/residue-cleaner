import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalRules } from '../src/core/approval.ts';
import { DeleteService } from '../src/services/delete-service.ts';
import type { Cluster, ScanResult } from '../src/core/types.ts';
import { cluster, verdict } from './helpers.ts';

function scan(clusters: Cluster[]): ScanResult {
  return {
    startedAt: 0,
    finishedAt: 0,
    clusters,
    stats: {
      rootsScanned: 0,
      dirsVisited: 0,
      filesSeen: 0,
      bytesSeen: 0,
      denied: 0,
      longPathErrors: 0,
    },
    skipped: [],
  };
}

test('kasa tasima TASI, kalici silme SIL', () => {
  assert.equal(ApprovalRules.phrase('vaultMove'), 'TASI');
  assert.equal(ApprovalRules.phrase('delete'), 'SIL');
  assert.equal(ApprovalRules.matches('vaultMove', ' TASI '), true);
  assert.equal(ApprovalRules.matches('vaultMove', 'SIL'), false);
  assert.equal(ApprovalRules.matches('vaultMove', 'tasi'), false);
  assert.equal(ApprovalRules.matches('delete', 'SIL'), true);
});

test('proje tarifi KUR ister; kaynak silme ifadesi kabul edilmez', () => {
  assert.equal(ApprovalRules.phrase('projectRestore'), 'KUR');
  assert.equal(ApprovalRules.matches('projectRestore', ' KUR '), true);
  assert.equal(ApprovalRules.matches('projectRestore', 'SIL'), false);
  assert.equal(ApprovalRules.matches('projectRestore', 'kur'), false);
});

test('ortam temizligi TEMIZLE ister', () => {
  assert.equal(ApprovalRules.phrase('envClean'), 'TEMIZLE');
  assert.equal(ApprovalRules.matches('envClean', ' TEMIZLE '), true);
  assert.equal(ApprovalRules.matches('envClean', 'temizle'), false);
  assert.equal(ApprovalRules.matches('envClean', 'SIL'), false);
});

test('zamanlanmis plan kurali PLANLA ister', () => {
  assert.equal(ApprovalRules.phrase('schedule'), 'PLANLA');
  assert.equal(ApprovalRules.matches('schedule', ' PLANLA '), true);
  assert.equal(ApprovalRules.matches('schedule', 'planla'), false);
  assert.equal(ApprovalRules.matches('schedule', 'TEMIZLE'), false);
});

test('plan ifadesi TASI; dogrudan yol kalici silme reddedilir', () => {
  const svc = new DeleteService(() => {});
  const safe = scan([cluster({ key: 'safe' })]);

  const recycle = svc.createPlan(safe, ['safe'], 'recycle');
  assert.equal(recycle.approvalKind, 'vaultMove');
  assert.equal(recycle.phrase, 'TASI');
  assert.equal(recycle.requiresPhrase, false);

  assert.throws(() => svc.createPlan(safe, ['safe'], 'purge'), /kaldirildi/);
});

test('orta risk: kasa planinda SIL kabul edilmez, TASI beklenir', () => {
  const svc = new DeleteService(() => {});
  const medium = scan([
    cluster({ key: 'medium', verdict: verdict({ risk: 'medium' }) }),
  ]);
  const plan = svc.createPlan(medium, ['medium'], 'recycle');
  assert.equal(plan.requiresPhrase, true);
  assert.equal(plan.phrase, 'TASI');
  assert.throws(() => svc.execute(plan.planId, 'SIL', false), /TASI/);
  assert.throws(() => svc.execute(plan.planId, 'tasi', false), /TASI/);
});

test('yuksek risk ayrica acik isaretleme ister', () => {
  const svc = new DeleteService(() => {});
  const high = scan([cluster({ key: 'high', verdict: verdict({ risk: 'high' }) })]);
  const plan = svc.createPlan(high, ['high'], 'recycle');
  assert.equal(plan.requiresHighAck, true);
  assert.equal(plan.phrase, 'TASI');
});

test('currentPlan sag panel icin en son gecerli plani dondurur', () => {
  const svc = new DeleteService(() => {});
  assert.equal(svc.currentPlan(), null);

  const safe = scan([cluster({ key: 'safe' })]);
  const first = svc.createPlan(safe, ['safe'], 'recycle');
  assert.equal(svc.currentPlan()?.planId, first.planId);

  const second = svc.createPlan(safe, ['safe'], 'recycle');
  assert.equal(svc.currentPlan()?.planId, second.planId);
  assert.equal(svc.currentPlan()?.plan.clusters[0]?.key, 'safe');
});
