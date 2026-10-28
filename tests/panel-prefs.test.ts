import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PanelPrefs } from '../src/core/panel-prefs.ts';

test('sanitize: taninmayan kimligi atar', () => {
  assert.deepEqual(PanelPrefs.sanitize(['x', 'evidence']), ['evidence']);
});

test('sanitize: tekrarlari atar, string olmayani atar, dizi olmayan girdi -> []', () => {
  assert.deepEqual(PanelPrefs.sanitize(['evidence', 'evidence', 5, null, '']), ['evidence']);
  assert.deepEqual(PanelPrefs.sanitize('nope' as unknown), []);
  assert.deepEqual(PanelPrefs.sanitize(null), []);
});

test('sanitize: baska ekranda gizlenen kimlik korunur (global tercih)', () => {
  // 'planned' Dashboard modulu; Tools ekraninda da gizli kalmali.
  assert.deepEqual(PanelPrefs.sanitize(['planned']), ['planned']);
});

test('resolve: sirayi ekran planindan alir', () => {
  const r = PanelPrefs.resolve(['evidence', 'action', 'context'], ['action']);
  assert.deepEqual(r.visible, ['evidence', 'context']);
  assert.deepEqual(r.hidden, ['action']);
});

test('resolve: hepsi gizliyse modules[0] gorunur kalir ve hidden dan cikar', () => {
  const r = PanelPrefs.resolve(['evidence', 'action'], ['evidence', 'action']);
  assert.deepEqual(r.visible, ['evidence']);
  assert.deepEqual(r.hidden, ['action']);
});

test('resolve: bu ekranda bulunmayan gizli kimlik yok sayilir', () => {
  const r = PanelPrefs.resolve(['evidence', 'action'], ['planned', 'action']);
  assert.deepEqual(r.visible, ['evidence']);
  assert.deepEqual(r.hidden, ['action']);
});

test('toggle: gizler (listeye ekler) ve mutasyonsuz', () => {
  const input = ['action'];
  const out = PanelPrefs.toggle(input, 'context', ['evidence', 'action', 'context']);
  assert.deepEqual(out, ['action', 'context']);
  assert.deepEqual(input, ['action']);
});

test('toggle: acar (listeden cikarir)', () => {
  const out = PanelPrefs.toggle(['action', 'context'], 'context', ['evidence', 'action', 'context']);
  assert.deepEqual(out, ['action']);
});

test('toggle: son gorunur modulu gizlemez', () => {
  // yalniz evidence gorunur; evidence gizlenemez
  const out = PanelPrefs.toggle(['action', 'context'], 'evidence', ['evidence', 'action', 'context']);
  assert.deepEqual(out, ['action', 'context']);
});

test('toggle: baska ekranda gizlenen kimligi silmez (regresyon)', () => {
  // Dashboard'da 'planned' gizli; Tools ekraninda 'action' gizleniyor.
  const out = PanelPrefs.toggle(['planned'], 'action', ['evidence', 'action']);
  assert.deepEqual(out, ['planned', 'action']);
  assert.deepEqual(out.slice().sort(), ['action', 'planned']);
});

test('toggle: taninmayan kimlik eklenmez', () => {
  assert.deepEqual(PanelPrefs.toggle([], 'nope', ['evidence', 'action']), []);
});

test('parse: null / bos / bozuk JSON / obje -> []; string dizi temizlenir', () => {
  assert.deepEqual(PanelPrefs.parse(null), []);
  assert.deepEqual(PanelPrefs.parse(''), []);
  assert.deepEqual(PanelPrefs.parse('{bad}'), []);
  assert.deepEqual(PanelPrefs.parse('{"a":1}'), []);
  assert.deepEqual(PanelPrefs.parse('["context",""]'), ['context']);
  assert.deepEqual(PanelPrefs.parse('["context","nope"]'), ['context']);
});

test('MODULE_IDS: dort modul, sabit sira', () => {
  assert.deepEqual(PanelPrefs.MODULE_IDS, ['evidence', 'action', 'planned', 'context']);
});
