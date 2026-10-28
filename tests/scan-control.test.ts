import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScanControl } from '../src/core/scan-control.ts';

test('phase', () => {
  assert.equal(ScanControl.phase(false, false), 'idle');
  assert.equal(ScanControl.phase(true, false), 'running');
  assert.equal(ScanControl.phase(true, true), 'paused');
  assert.equal(ScanControl.phase(false, true), 'idle');
});

test('keyIntent p', () => {
  assert.equal(ScanControl.keyIntent('p', 'running'), 'pause');
  assert.equal(ScanControl.keyIntent('P', 'paused'), 'resume');
  assert.equal(ScanControl.keyIntent('p', 'idle'), 'none');
});

test('keyIntent Escape never cancel', () => {
  for (const phase of ['idle', 'running', 'paused'] as const) {
    assert.equal(ScanControl.keyIntent('Escape', phase), 'none');
  }
});

test('keyIntent others none', () => {
  assert.equal(ScanControl.keyIntent('c', 'running'), 'none');
  assert.equal(ScanControl.keyIntent('Enter', 'running'), 'none');
});

test('cancelNeedsConfirm', () => {
  assert.equal(ScanControl.cancelNeedsConfirm(), true);
});

test('notice', () => {
  assert.equal(ScanControl.notice('cancelled'), 'cancelled');
  assert.equal(ScanControl.notice('paused'), 'paused');
  assert.equal(ScanControl.notice('resumed'), null);
  assert.equal(ScanControl.notice('done'), null);
  assert.equal(ScanControl.notice('error'), null);
  assert.equal(ScanControl.notice('progress'), null);
});

test('keyIntent buyuk P her iki yonde', () => {
  assert.equal(ScanControl.keyIntent('P', 'running'), 'pause');
  assert.equal(ScanControl.keyIntent('p', 'paused'), 'resume');
  assert.equal(ScanControl.keyIntent('P', 'idle'), 'none');
});

test('keyIntent bosluk ve satir tuslari taramayi durdurmaz', () => {
  // Space satir secimi, Enter satir eylemi — ikisi de tarama kontrolu DEGIL.
  assert.equal(ScanControl.keyIntent(' ', 'running'), 'none');
  assert.equal(ScanControl.keyIntent('Enter', 'paused'), 'none');
  assert.equal(ScanControl.keyIntent('Escape', 'paused'), 'none');
});

test('notice tam eslesme ister', () => {
  // Alt dize eslesmesi (includes) regresyonu: 'cancelled.done' bilgi URETMEZ.
  assert.equal(ScanControl.notice('cancelled.done'), null);
  assert.equal(ScanControl.notice('CANCELLED'), null);
  assert.equal(ScanControl.notice(''), null);
});

test('phase paused bayragi tarama yokken yok sayilir', () => {
  // Tarama bitmis ama son olay 'paused' kalmis olabilir: faz yine 'idle'.
  assert.equal(ScanControl.phase(false, true), 'idle');
  assert.equal(ScanControl.keyIntent('p', ScanControl.phase(false, true)), 'none');
});
