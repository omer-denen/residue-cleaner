import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeleteService } from '../src/services/delete-service.ts';
import { ServiceError } from '../src/services/errors.ts';
import type { Cluster, ScanResult } from '../src/core/types.ts';
import { cluster } from './helpers.ts';

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

function expired(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch (err) {
    return err instanceof ServiceError && err.status === 410;
  }
}

test('ERR-08: uygulanmis plan TTL dolunca 410 verir ve execute etmez', () => {
  const svc = new DeleteService(() => undefined);
  const data = scan([cluster({ key: 'ttl-a' })]);
  const draft = svc.createPlan(data, ['ttl-a'], 'recycle');
  assert.equal(draft.expiresAt, 0, 'taslakta sure yok');
  const armed = svc.rebuildPlan(draft.planId, data);
  assert.ok(armed.expiresAt > Date.now());

  const realNow = Date.now;
  try {
    Date.now = () => armed.expiresAt! + 1;
    assert.equal(expired(() => svc.execute(armed.planId, undefined, false)), true);
    assert.throws(
      () => svc.discardPlan(armed.planId),
      (err) => err instanceof ServiceError && err.status === 404,
    );
  } finally {
    Date.now = realNow;
  }
});

test('ERR-08: suresi dolan plan kaydi silinir, ikinci cagri 404', () => {
  const svc = new DeleteService(() => undefined);
  const data = scan([cluster({ key: 'ttl-b' })]);
  const draft = svc.createPlan(data, ['ttl-b'], 'recycle');
  const armed = svc.rebuildPlan(draft.planId, data);

  const realNow = Date.now;
  try {
    Date.now = () => armed.expiresAt! + 1;
    assert.equal(expired(() => svc.discardPlan(armed.planId)), true);
  } finally {
    Date.now = realNow;
  }
  assert.throws(
    () => svc.discardPlan(armed.planId),
    (err) => err instanceof ServiceError && err.status === 404,
  );
});
