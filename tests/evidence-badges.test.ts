import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { UsageSignal } from '../src/core/cli-inventory-types.ts';
import { translate, type MessageKey } from '../web/src/i18n.ts';

/**
 * WEB-17: "F5 kanit rozetleri" — kullanim kanitinin HANGI kaynaga
 * dayandigini gosteren rozetler. Motor tarafi
 * `tests/inventory-usage-verdict.test.ts` (F5-1..F5-4) ile kilitli;
 * burada arayuz etiketlerinin her sinyal turu icin TR/EN mevcut
 * oldugunu dogrulariz. Eksik anahtar ham `tools.signal.*` metni olarak
 * gorunur ve bu test onu yakalar.
 */

const SIGNALS: readonly UsageSignal[] = ['install', 'state', 'atime', 'history'];

test('WEB-17: her kullanim sinyali icin TR ve EN etiket var', () => {
  for (const signal of SIGNALS) {
    const key = `tools.signal.${signal}` as MessageKey;
    for (const lang of ['tr', 'en'] as const) {
      const text = translate(lang, key);
      assert.ok(text.length > 0, `${lang}:${signal} bos`);
      assert.notEqual(text, key, `${lang}:${signal} ceviri anahtari ham gorunuyor`);
    }
    assert.notEqual(
      translate('tr', key),
      translate('en', key),
      `${signal}: TR/EN ayni olmamali`,
    );
  }
});

test('WEB-17: atime kurulum ani uyarisi TR/EN etiketli', () => {
  const key: MessageKey = 'tools.signal.atimeSuspect';
  assert.notEqual(translate('tr', key), key);
  assert.notEqual(translate('en', key), key);
  assert.notEqual(translate('tr', key), translate('en', key));
});

test('WEB-17: rozet ipucu metni TR/EN etiketli', () => {
  const key: MessageKey = 'tools.signals.hint';
  assert.match(translate('tr', key), /kan[ıi]t/i);
  assert.match(translate('en', key), /evidence/i);
});
