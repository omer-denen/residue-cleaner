import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { translate } from '../web/src/i18n.ts';

const ROOT = process.cwd();
const I18N_PATH = join(ROOT, 'web', 'src', 'i18n.ts');
const CLI_PATH = join(ROOT, 'src', 'cli.ts');
const I18N_SRC = readFileSync(I18N_PATH, 'utf8');

/**
 * W2-4: uc eksenin adi ayri kalir (docs/PROFILE-MODEL.md §1, §6).
 *  - Kullanici profili (persona)  -> settings.profile.* / profile.copy.*
 *  - Tarama kapsami               -> disk.filter.profile
 *  - Graf bakis profili           -> graph.profile.*
 * Ayrica CLI `--profile` yardimi "tarama kapsami" der.
 */

function dictionaryKeys(dict: 'tr' | 'en'): string[] {
  const marker = dict === 'tr' ? 'const tr = {' : 'const en:';
  const start = I18N_SRC.indexOf(marker);
  if (start < 0) throw new Error('dictionary not found: ' + dict);
  const endMarker = dict === 'tr' ? '\n} as const;' : '\n};';
  const end = I18N_SRC.indexOf(endMarker, start);
  if (end < 0) throw new Error('dictionary end not found: ' + dict);
  const block = I18N_SRC.slice(start, end);
  return [...block.matchAll(/^\s*'([^']+)'\s*:/gm)].map((m) => m[1] as string);
}

test('W2-4: disk.filter.profile TR/EN renamed', () => {
  assert.equal(translate('tr', 'disk.filter.profile'), 'Tarama kapsamı');
  assert.equal(translate('en', 'disk.filter.profile'), 'Scan scope');
});

test('W2-4: old profile scope wording absent', () => {
  assert.ok(!I18N_SRC.includes('Ortam profili'), 'TR old label remains');
  assert.ok(!I18N_SRC.includes('Environment profile'), 'EN old label remains');
});

test('W2-4: graph profile label preserved', () => {
  assert.equal(translate('tr', 'graph.profile.label'), 'Bakış profili');
});

test('W2-4: cli help uses scan scope wording', () => {
  const cli = readFileSync(CLI_PATH, 'utf8');
  assert.ok(cli.includes('Kayitli tarama kapsami'), 'new help wording missing');
  assert.ok(!cli.includes('Kayitli profil'), 'old help wording remains');
});

test('W2-4: persona keys present', () => {
  assert.equal(translate('tr', 'settings.profile.developer'), 'Developer');
  assert.equal(translate('tr', 'settings.profile.vibe'), 'Vibe coder');
  assert.equal(translate('tr', 'settings.profile.hybrid'), 'Melez');
  assert.equal(translate('en', 'settings.profile.developer'), 'Developer');
  assert.equal(translate('en', 'settings.profile.vibe'), 'Vibe coder');
  assert.equal(translate('en', 'settings.profile.hybrid'), 'Hybrid');
  assert.equal(
    translate('tr', 'profile.copy.developer'),
    'Projelerim ve kanıt; gürültüsüz liste, Git farkındalığı.',
  );
  assert.equal(
    translate('en', 'profile.copy.developer'),
    'Projects and evidence; quiet list, Git awareness.',
  );
});

test('W2-4: TR and EN dictionaries share key set', () => {
  const trKeys = dictionaryKeys('tr');
  const enKeys = dictionaryKeys('en');
  assert.equal(trKeys.length, enKeys.length);
  assert.equal(new Set(trKeys).size, trKeys.length);
  assert.equal(new Set(enKeys).size, enKeys.length);
  assert.deepEqual(new Set(trKeys), new Set(enKeys));
});
