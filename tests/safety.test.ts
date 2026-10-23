import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unsafeTargetReason, assertSafeTarget } from '../src/actions/guard.ts';
import { categoryOf } from '../src/core/categories.ts';
import { ownerStatusOfCluster } from '../src/core/owner-status.ts';
import { cluster, verdict } from './helpers.ts';

test('surucu koku (D:\\) reddedilir', () => {
  assert.notEqual(unsafeTargetReason('D:\\'), null);
  assert.notEqual(unsafeTargetReason('C:\\'), null);
  assert.notEqual(unsafeTargetReason('D:/'), null);
});

test('korumali yol ve atasi reddedilir', () => {
  const home = process.env.USERPROFILE!;
  assert.notEqual(unsafeTargetReason(home), null);
  assert.notEqual(unsafeTargetReason(process.env.LOCALAPPDATA!), null);
  assert.throws(() => assertSafeTarget({ path: 'D:\\', kind: 'whole', label: 'x', bytes: 1 }));
});

test('kendi veri dizini korunur', () => {
  const local = process.env.LOCALAPPDATA;
  if (!local) return;
  assert.notEqual(unsafeTargetReason(`${local}\\residue\\vault\\b-1`), null);
});

test('kategori onceligi: protected > old-version > unused', () => {
  assert.equal(
    categoryOf(cluster({ evidence: { markers: ['chat-history'] }, verdict: verdict({ kind: 'keep' }) })),
    'protected',
  );
  assert.equal(
    categoryOf(cluster({ archetype: 'versioned-app-store', evidence: { markers: ['old-version'] } })),
    'old-version',
  );
  assert.equal(categoryOf(cluster({ archetype: 'pkg-manager-cache' })), 'unused');
  assert.equal(categoryOf(cluster({ archetype: 'model-store' })), 'ai-debris');
  assert.equal(categoryOf(cluster({ archetype: 'runtime-pool' })), 'ghost-envs');
});

test('sahip durumu', () => {
  assert.equal(
    ownerStatusOfCluster(cluster({ verdict: verdict({ regenerability: 'user-data' }) })),
    'active',
  );
  assert.equal(ownerStatusOfCluster(cluster({ archetype: 'global-packages', evidence: {} })), 'orphaned');
  assert.equal(
    ownerStatusOfCluster(
      cluster({ evidence: { markers: ['shared'] }, archetype: 'pkg-manager-cache' }),
    ),
    'shared',
  );
});
