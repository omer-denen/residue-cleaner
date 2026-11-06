import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextFocusIndex } from '../web/src/a11y/focus-trap.ts';

test('odak tuzagi: ileri sarim son ogeden ilk ogeye', () => {
  assert.equal(nextFocusIndex(0, 3, false, true), 1);
  assert.equal(nextFocusIndex(2, 3, false, true), 0);
});

test('odak tuzagi: geri sarim ilk ogeden son ogeye', () => {
  assert.equal(nextFocusIndex(1, 3, true, true), 0);
  assert.equal(nextFocusIndex(0, 3, true, true), 2);
});

test('odak tuzagi: odak arka plandaysa ilk/son ogeye cekilir', () => {
  assert.equal(nextFocusIndex(-1, 3, false, false), 0);
  assert.equal(nextFocusIndex(-1, 3, true, false), 2);
  assert.equal(nextFocusIndex(2, 3, false, false), 0);
  assert.equal(nextFocusIndex(0, 3, true, false), 2);
});

test('odak tuzagi: bos liste -1 doner', () => {
  assert.equal(nextFocusIndex(-1, 0, false, false), -1);
  assert.equal(nextFocusIndex(0, 0, true, true), -1);
});

test('odak tuzagi: tek oge kendine doner', () => {
  assert.equal(nextFocusIndex(0, 1, false, true), 0);
  assert.equal(nextFocusIndex(0, 1, true, true), 0);
});
