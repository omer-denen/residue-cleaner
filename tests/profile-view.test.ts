import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFILE_IDS,
  PROFILE_VIEWS,
  profileViewFor,
} from '../web/src/profiles.ts';

test('profile-view: kimlik sirasi', () => {
  assert.deepEqual([...PROFILE_IDS], ['developer', 'vibe', 'hybrid']);
});

test('profile-view: uc profil mevcut', () => {
  for (const id of PROFILE_IDS) {
    assert.ok(PROFILE_VIEWS[id], `${id} eksik`);
  }
});

test('profile-view: navOrder 10 benzersiz, son settings', () => {
  for (const id of PROFILE_IDS) {
    const v = PROFILE_VIEWS[id];
    assert.equal(v.navOrder.length, 10, `${id}: uzunluk`);
    assert.equal(new Set(v.navOrder).size, 10, `${id}: tekrar`);
    assert.equal(v.navOrder[v.navOrder.length - 1], 'settings', `${id}: son`);
  }
});

test('profile-view: initialScreen tablosu', () => {
  assert.equal(PROFILE_VIEWS.developer.initialScreen, 'projects');
  assert.equal(PROFILE_VIEWS.vibe.initialScreen, 'dashboard');
  assert.equal(PROFILE_VIEWS.hybrid.initialScreen, 'dashboard');
});

test('profile-view: gecersiz -> hybrid', () => {
  assert.strictEqual(profileViewFor('admin'), PROFILE_VIEWS.hybrid);
  assert.strictEqual(profileViewFor(null), PROFILE_VIEWS.hybrid);
  assert.strictEqual(profileViewFor(undefined), PROFILE_VIEWS.hybrid);
});

test('profile-view: density farkli', () => {
  assert.equal(PROFILE_VIEWS.developer.density, 'compact');
  assert.equal(PROFILE_VIEWS.vibe.density, 'normal');
  assert.equal(PROFILE_VIEWS.hybrid.density, 'detailed');
  const set = new Set(PROFILE_IDS.map((id) => PROFILE_VIEWS[id].density));
  assert.equal(set.size, 3);
});

test('profile-view: saf fonksiyon', () => {
  assert.deepEqual(profileViewFor('developer'), profileViewFor('developer'));
});