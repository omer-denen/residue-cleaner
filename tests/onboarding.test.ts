import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldOnboard, onboardingChoice, ONBOARDING_DONE, ONBOARDING_KEY } from '../web/src/onboarding.ts';
import { normalizeUserProfile } from '../src/core/profile.ts';

test('onboarding: shouldOnboard', () => {
  assert.equal(shouldOnboard(null), true);
  assert.equal(shouldOnboard('1'), false);
  assert.equal(shouldOnboard('0'), true);
  assert.equal(shouldOnboard(''), true);
});

test('onboarding: constants', () => {
  assert.equal(ONBOARDING_DONE, '1');
  assert.equal(ONBOARDING_KEY, 'residue.onboarded');
});

test('onboarding: onboardingChoice', () => {
  assert.equal(onboardingChoice(undefined), 'hybrid');
  assert.equal(onboardingChoice(null), 'hybrid');
  assert.equal(onboardingChoice('developer'), 'developer');
  assert.equal(onboardingChoice('vibe'), 'vibe');
  assert.equal(onboardingChoice('hybrid'), 'hybrid');
  assert.equal(onboardingChoice('admin' as never), 'hybrid');
});

test('onboarding: parity with normalizeUserProfile', () => {
  const inputs: Array<UserProfileLike> = [undefined, null, 'developer', 'vibe', 'hybrid', 'admin', ''];
  for (const v of inputs) {
    assert.equal(onboardingChoice(v as any), normalizeUserProfile(v), String(v));
  }
});

type UserProfileLike = string | null | undefined;