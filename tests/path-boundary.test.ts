import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { detectArchetype, clusterKey } from '../src/core/analyze.ts';
import type { Evidence } from '../src/core/types.ts';

/**
 * E7 — yol siniri (startsWith) duzeltmesi.
 *
 * Eski kod `root.toLowerCase().startsWith(parentPrefix)` kullaniyordu;
 * `Temp2` ve `Local2` gibi KARDES dizinler de eslestigi icin
 * temp-scratch siniflamasi ve `local`/`home` kume kapsami bozuluyordu.
 *
 * Not: Bu testler saf kapsam bilgisidir (dosya sistemi okuması yok);
 * fixture kokunden bagimsizdir. Env degiskenleri set edilir ve
 * test sonunda geri yuklenir (kural: kanit/environment hijyeni).
 */

const ORIGINAL: Record<string, string | undefined> = {};

const HOME = 'c:\\e7-home';
const LOCALAPPDATA = `${HOME}\\appdata\\local`;
const APPDATA = `${HOME}\\appdata\\roaming`;
const TEMP = `${HOME}\\temp`;

function ev(over: Partial<Evidence> = {}): Evidence {
  return { fileKinds: [], markers: [], logSignals: [], ...over };
}

before(() => {
  for (const key of ['TEMP', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE']) {
    ORIGINAL[key] = process.env[key];
  }
  process.env.USERPROFILE = 'C:\\e7-home';
  process.env.LOCALAPPDATA = 'C:\\e7-home\\AppData\\Local';
  process.env.APPDATA = 'C:\\e7-home\\AppData\\Roaming';
  process.env.TEMP = 'C:\\e7-home\\temp';
});

after(() => {
  for (const key of Object.keys(ORIGINAL)) {
    const value = ORIGINAL[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('E7-1: TEMP altindaki yol temp-scratch kalir (regresyon)', () => {
  const a = detectArchetype(ev(), `${TEMP}\\sub\\X`, new Map());
  assert.equal(a, 'temp-scratch');
});

test('E7-2: kardes dizin Temp2 temp-scratch DEGIL', () => {
  const a = detectArchetype(ev({ markers: ['skills'] }), `${TEMP}2\\X`, new Map());
  assert.notEqual(a, 'temp-scratch');
  assert.equal(a, 'agent-workspace');
});

test("E7-3: '<TEMP>\\..\\Komsu' leksik cozuldugunde temp sayilmaz", () => {
  const a = detectArchetype(ev(), `${TEMP}\\..\\Komsu`, new Map());
  assert.notEqual(a, 'temp-scratch');
  assert.equal(a, 'unknown'); // guclu kanit yok: temp-scratch DEGIL
});

test('E7-4: LOCALAPPDATA altindaki yol clusterKey local: onekli kalir', () => {
  const root = `${LOCALAPPDATA}\\X\\Y`;
  assert.ok(clusterKey(ev(), root).startsWith('local:'), clusterKey(ev(), root));
});

test('E7-5: kardes dizin Local2 local: DEGIL', () => {
  const root = `${LOCALAPPDATA}2\\X\\Y`;
  const key = clusterKey(ev(), root);
  // UserProfile2 altindadir -> kapsam home: olabilir (dogru davranis);
  // yanlis eslesme olan `local:` olmamalidir.
  assert.ok(!key.startsWith('local:'), key);
});

test('E7-6: kardes dizin UserProfile2 home: DEGIL', () => {
  const root = 'C:\\e7-home2\\X\\Y';
  const key = clusterKey(ev(), root);
  assert.ok(!key.startsWith('home:'), key);
  assert.ok(key.startsWith('other:'), key);
});

test('E7-7: \\\\?\\ onekli ve egik cizgili ayni yol dogru eslesir', () => {
  const tempVariant = '\\\\?\\C:' + '\\e7-home/Temp/sub/X'; // egik cizgili
  const a = detectArchetype(ev(), tempVariant, new Map());
  assert.equal(a, 'temp-scratch');
  const key = clusterKey(ev(), '\\\\?\\C:/e7-home/AppData/Local/X/Y');
  assert.ok(key.startsWith('local:'), key);
});

test('E7-7b: tam esitlik (kokun kendisi) kapsam icindedir', () => {
  assert.equal(detectArchetype(ev(), TEMP, new Map()), 'temp-scratch');
  assert.ok(clusterKey(ev(), LOCALAPPDATA).startsWith('local:'));
});
