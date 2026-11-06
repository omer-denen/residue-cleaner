import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translate, type MessageKey } from '../web/src/i18n.ts';
import type { RestoreTargetState } from '../src/core/restore-target.ts';

/**
 * Kasa geri yukleme mesaji: "klasor dolu" gibi yanlis/eksik ifade yerine
 * hedefin gercek durumu (daha yeni / daha eski / bos / bilinmiyor) soylenir.
 * Motor siniflandirmasi `tests/vault-restore.test.ts` test 11-12'de kilitli;
 * burada TR/EN metinlerin eksiksiz ve ayirt edici oldugu dogrulanir.
 */

const STATES: readonly RestoreTargetState[] = ['newer', 'older', 'empty', 'unknown'];

test('kasa hedef durumu: her durum icin TR ve EN metin var', () => {
  for (const state of STATES) {
    const key = `vault.target.${state}` as MessageKey;
    const tr = translate('tr', key);
    const en = translate('en', key);
    assert.notEqual(tr, key, `TR eksik: ${key}`);
    assert.notEqual(en, key, `EN eksik: ${key}`);
    assert.notEqual(tr, en, `TR/EN ayni olmamali: ${key}`);
  }
});

test('kasa hedef durumu: "dolu" yerine icerik yasi anlatilir', () => {
  const generic = translate('tr', 'vault.conflict');
  assert.doesNotMatch(generic, /dolu/i);
  for (const state of STATES) {
    const text = translate('tr', `vault.target.${state}` as MessageKey);
    assert.doesNotMatch(text, /dolu/i, `yaniltici ifade: ${state}`);
    assert.match(text, /içerik|klasör/i, `icerik/klasor gecmeli: ${state}`);
  }
  assert.match(translate('tr', 'vault.target.newer'), /sonradan|güncel/i);
  assert.match(translate('tr', 'vault.target.older'), /daha eski/i);
});

test('kasa hedef durumu: newer mesaji tarih degiskenini yerlestirir', () => {
  const text = translate('tr', 'vault.target.newer', { at: '5 Kas 2026 10:00' });
  assert.match(text, /5 Kas 2026 10:00/);
  assert.doesNotMatch(text, /\{at\}/);
});

test('kasa bosaltma: daha yeni icerik nedeniyle eski kopya silindi bildirimi', () => {
  const tr = translate('tr', 'vault.purgeNewer');
  const en = translate('en', 'vault.purgeNewer');
  assert.notEqual(tr, 'vault.purgeNewer');
  assert.notEqual(en, 'vault.purgeNewer');
  assert.notEqual(tr, en);
  assert.match(tr, /daha yeni/);
  assert.match(tr, /kalıcı olarak silindi/);
  assert.match(en, /newer/);
  assert.match(en, /permanently deleted/);
  assert.doesNotMatch(tr, /dolu/i);
});

test('kasa bosaltma: bos kayit bildirimi veri silinmedigini soyler', () => {
  const tr = translate('tr', 'vault.purgePruned');
  const en = translate('en', 'vault.purgePruned');
  assert.notEqual(tr, 'vault.purgePruned');
  assert.notEqual(en, 'vault.purgePruned');
  assert.notEqual(tr, en);
  assert.match(tr, /kayıt temizlendi/i);
  assert.match(tr, /korundu/i);
  assert.match(en, /record was cleared/i);
  assert.match(en, /kept/i);
});
