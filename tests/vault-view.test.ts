import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VaultView, foldVaultText, type VaultQuery } from '../src/core/vault-view.ts';
import type { VaultEntryView } from '../src/core/contract.ts';

function entry(
  id: string,
  originalPath: string,
  at: number,
  bytes: number,
  extra: Partial<VaultEntryView> = {},
): VaultEntryView {
  return {
    id,
    batchId: 'b1',
    originalPath,
    storedPath: `C:/vault/${id}`,
    bytes,
    files: 1,
    at,
    ageMs: 1,
    remainingDays: 30,
    originalExists: false,
    ...extra,
  };
}

const ENTRIES: VaultEntryView[] = [
  entry('a', 'C:/Users/Code/AppData/Local/uv', 300, 500, { remainingDays: 2, originalExists: true }),
  entry('b', 'C:/Users/Code/AppData/Local/rattler', 100, 900, { remainingDays: 30 }),
  entry('c', 'D:/Projects/İndirme Klasörü', 200, 100, { remainingDays: 5 }),
  entry('d', 'C:/Temp/eski', 400, 900, { remainingDays: 9 }),
];

function query(overrides: Partial<VaultQuery> = {}): VaultQuery {
  return { search: '', sort: 'newest', page: 1, pageSize: 25, ...overrides };
}

test('varsayilan: en yeni once', () => {
  const view = VaultView.view(ENTRIES, query());
  assert.deepEqual(
    view.rows.map((x) => x.id),
    ['d', 'a', 'c', 'b'],
  );
  assert.equal(view.from, 1);
  assert.equal(view.to, 4);
});

test('eski once', () => {
  const view = VaultView.view(ENTRIES, query({ sort: 'oldest' }));
  assert.deepEqual(
    view.rows.map((x) => x.id),
    ['b', 'c', 'a', 'd'],
  );
});

test('en buyuk once; esit boyutta yol alfabetik', () => {
  const view = VaultView.view(ENTRIES, query({ sort: 'largest' }));
  assert.deepEqual(
    view.rows.map((x) => x.id),
    ['d', 'b', 'a', 'c'],
  );
});

test('yol sirasi ve sure yaklasan', () => {
  assert.deepEqual(
    VaultView.view(ENTRIES, query({ sort: 'path' })).rows.map((x) => x.id),
    ['d', 'b', 'a', 'c'],
  );
  assert.deepEqual(
    VaultView.view(ENTRIES, query({ sort: 'expiring' })).rows.map((x) => x.id),
    ['a', 'c', 'd', 'b'],
  );
});

test('arama: coklu sozcuk + Turkce katlama', () => {
  const view = VaultView.view(ENTRIES, query({ search: 'INDIRME klasoru' }));
  assert.deepEqual(
    view.rows.map((x) => x.id),
    ['c'],
  );
  assert.equal(view.total, 1);
  assert.equal(view.summary.bytes, 100);
});

test('arama: eslesme yoksa bos sayfa, aralik 0', () => {
  const view = VaultView.view(ENTRIES, query({ search: 'yok-boyle-bir-sey' }));
  assert.deepEqual(view.rows, []);
  assert.equal(view.total, 0);
  assert.equal(view.from, 0);
  assert.equal(view.to, 0);
  assert.equal(view.pageCount, 1);
  assert.equal(view.hasPrev, false);
  assert.equal(view.hasNext, false);
});

test('sayfalama: sinirlar kirpilir, aralik dogru', () => {
  const page2 = VaultView.view(ENTRIES, query({ pageSize: 2, page: 2 }));
  assert.deepEqual(
    page2.rows.map((x) => x.id),
    ['c', 'b'],
  );
  assert.equal(page2.page, 2);
  assert.equal(page2.pageCount, 2);
  assert.equal(page2.from, 3);
  assert.equal(page2.to, 4);
  assert.equal(page2.hasPrev, true);
  assert.equal(page2.hasNext, false);

  const beyond = VaultView.view(ENTRIES, query({ pageSize: 2, page: 99 }));
  assert.equal(beyond.page, 2);
  assert.deepEqual(
    beyond.rows.map((x) => x.id),
    ['c', 'b'],
  );
});

test('ozet: filtre uygulanmis kume uzerinden', () => {
  const all = VaultView.view(ENTRIES, query()).summary;
  assert.equal(all.count, 4);
  assert.equal(all.bytes, 2400);
  assert.equal(all.conflicts, 1);
  assert.equal(all.expiring, 2);

  const local = VaultView.view(ENTRIES, query({ search: 'local' })).summary;
  assert.equal(local.count, 2);
  assert.equal(local.conflicts, 1);
});

test('foldVaultText: Turkce karakterler ASCII olur', () => {
  assert.equal(foldVaultText('İndirme ŞĞÜÖÇ'), 'indirme sguoc');
});

test('girdi dizisi degismez', () => {
  const before = ENTRIES.map((x) => x.id);
  VaultView.view(ENTRIES, query({ sort: 'largest' }));
  assert.deepEqual(
    ENTRIES.map((x) => x.id),
    before,
  );
});
