import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommandView, fold, type CommandCandidate } from '../src/core/command-view.ts';

const ITEMS: CommandCandidate[] = [
  { id: 'disk', label: 'Disk', keywords: ['tarama', 'scan'] },
  { id: 'env', label: 'PATH & Ortam', keywords: ['environment'] },
  { id: 'settings', label: 'Ayarlar', keywords: ['settings'] },
  { id: 'scan', label: 'Yeniden tara', keywords: ['scan'] },
];

test('fold: Turkce karakterler ASCII olur', () => {
  assert.equal(fold('Ayarlar'), 'ayarlar');
  assert.equal(fold('İşlem Görüşü'), 'islem gorusu');
  assert.equal(fold('  ÇOK   Boşluk '), 'cok bosluk');
});

test('filter: bos sorgu girdi sirasini korur ve limit uygular', () => {
  assert.deepEqual(
    CommandView.filter('', ITEMS, 2).map((x) => x.id),
    ['disk', 'env'],
  );
});

test('filter: baslangic > sozcuk baslangici > icinde', () => {
  const ids = CommandView.filter('or', ITEMS).map((x) => x.id);
  // "Ortam" sozcuk baslangici; "Ayarlar" icinde "ar" yok, "Yeniden tara" icinde var.
  assert.deepEqual(ids, ['env']);
});

test('filter: anahtar sozcukle bulur', () => {
  assert.deepEqual(
    CommandView.filter('environment', ITEMS).map((x) => x.id),
    ['env'],
  );
  assert.deepEqual(
    CommandView.filter('tarama', ITEMS).map((x) => x.id),
    ['disk'],
  );
});

test('filter: eslesme yoksa bos dizi', () => {
  assert.deepEqual(CommandView.filter('zzzz', ITEMS), []);
});

test('move: sinirda basa/sona doner, bos liste -1', () => {
  assert.equal(CommandView.move(2, 1, 3), 0);
  assert.equal(CommandView.move(0, -1, 3), 2);
  assert.equal(CommandView.move(0, 1, 0), -1);
});

test('filter girdi dizisini degistirmez', () => {
  const before = ITEMS.map((x) => x.id);
  CommandView.filter('a', ITEMS);
  assert.deepEqual(
    ITEMS.map((x) => x.id),
    before,
  );
});
