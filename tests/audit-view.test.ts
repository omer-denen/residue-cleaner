import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditView } from '../src/core/audit-view.ts';

test('audit-view: delete.done', () => {
  const line = JSON.stringify({
    at: '2026-10-21T10:00:00.000Z',
    event: 'delete.done',
    jobId: 'j1',
    planId: 'p1',
    mode: 'recycle',
    freed: 100,
    removed: 2,
    skipped: 1,
    failed: 0,
  });
  const r = AuditView.parse(line);
  assert.ok(r);
  assert.equal(r.kind, 'delete');
  assert.equal(r.ok, true);
  assert.equal(r.counts?.removed, 2);
  assert.equal(r.counts?.freed, 100);
  assert.equal(r.counts?.skipped, 1);
});

test('audit-view: delete.error', () => {
  const line = JSON.stringify({
    at: '2026-10-21T10:00:00.000Z',
    event: 'delete.error',
    jobId: 'j1',
    planId: 'p1',
    error: 'boom',
    code: 'EPERM',
  });
  const r = AuditView.parse(line);
  assert.ok(r);
  assert.equal(r.kind, 'delete');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'EPERM');
  assert.equal(r.reason, 'boom');
});

test('audit-view: vault.restore', () => {
  const line = JSON.stringify({
    at: '2026-10-21T10:00:00.000Z',
    event: 'vault.restore',
    id: 'v1',
    to: 'C:\\\\x',
    verified: true,
  });
  const r = AuditView.parse(line);
  assert.ok(r);
  assert.equal(r.kind, 'restore');
  assert.equal(r.ok, true);
  assert.equal(r.path, 'C:\\\\x');
  assert.equal(r.bytes, undefined);
});

test('audit-view: vault.restore.failed', () => {
  const line = JSON.stringify({
    at: '2026-10-21T10:00:00.000Z',
    event: 'vault.restore.failed',
    id: 'v1',
    from: 'C:\\\\x',
    code: 'EPERM',
    reason: 'nope',
  });
  const r = AuditView.parse(line);
  assert.ok(r);
  assert.equal(r.kind, 'restore');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'EPERM');
  assert.equal(r.reason, 'nope');
  // path from 'from' (two backslashes preserved)
  assert.equal(r.path, 'C:\\\\x');
});

test('audit-view: vault.purge-items', () => {
  const line = JSON.stringify({
    at: '2026-10-21T10:00:00.000Z',
    event: 'vault.purge-items',
    ids: ['a', 'b'],
    items: [{ path: 'C:\\\\first' }],
    bytes: 50,
    failed: 1,
  });
  const r = AuditView.parse(line);
  assert.ok(r);
  assert.equal(r.kind, 'purge');
  assert.equal(r.path, 'C:\\\\first');
  assert.equal(r.counts?.items, 2);
  assert.equal(r.counts?.bytes, 50);
  assert.equal(r.counts?.failed, 1);
});

test('audit-view: vault.purge-all', () => {
  const line = JSON.stringify({
    at: '2026-10-21T10:00:00.000Z',
    event: 'vault.purge-all',
    batches: 3,
    bytes: 10,
    failed: 0,
  });
  const r = AuditView.parse(line);
  assert.ok(r);
  assert.equal(r.kind, 'purge');
  assert.equal(r.counts?.batches, 3);
  assert.equal(r.counts?.bytes, 10);
  assert.equal(r.counts?.failed, 0);
});

test('audit-view: broken/empty skipped', () => {
  const valid = JSON.stringify({ at: '2026-10-21T10:00:00.000Z', event: 'vault.restore', id: 'v', to: 'C:\\\\x' });
  const recs = AuditView.parseLines(['{bozuk', '', valid]);
  assert.equal(recs.length, 1);
  assert.equal(AuditView.parse('{bozuk'), null);
  assert.equal(AuditView.parse(''), null);
});

test('audit-view: sort/filter/limit', () => {
  const now = Date.now();
  const r1 = { at: new Date(now - 1000).toISOString(), event: 'vault.restore', id: 'a', to: 'x' };
  const r2 = { at: new Date(now - 100000).toISOString(), event: 'vault.restore', id: 'b', to: 'y' };
  const lines = [JSON.stringify(r2), JSON.stringify(r1)];
  const recs = AuditView.parseLines(lines);
  assert.equal((recs[0] as any).id, 'a'); // newest first
  const filtered = AuditView.filter(recs, { sinceMs: 5000, now, limit: 1 });
  assert.equal(filtered.length, 1);
  assert.equal((filtered[0] as any).id, 'a');
  const all = AuditView.filter(recs, { kind: 'all' });
  assert.equal(all.length, 2);
});

test('audit-view: counts + unknown', () => {
  const lines = [
    JSON.stringify({ at: '2026-10-21T10:00:00.000Z', event: 'foo.bar' }),
  ];
  const recs = AuditView.parseLines(lines);
  assert.equal((recs[0] as any).kind, 'other');
  assert.equal((recs[0] as any).ok, true);
  const c = AuditView.counts(recs);
  assert.equal(c.total, 1);
  assert.equal(c.delete, 0);
  assert.equal(c.restore, 0);
  assert.equal(c.purge, 0);
  assert.equal(c.failed, 0);
});

test('audit-view: parse does not mutate input', () => {
  const line = JSON.stringify({ at: '2026-10-21T10:00:00.000Z', event: 'vault.restore', id: 'v', to: 'x' });
  const before = line;
  AuditView.parse(line);
  assert.equal(line, before);
});
