import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DashboardRatio } from '../src/core/dashboard-ratio.ts';

test('disk bilinmiyor (null) -> uc pay bilinmiyor', () => {
  const v = DashboardRatio.view({
    diskTotalBytes: null,
    diskFreeBytes: null,
    scannedBytes: 300,
    reclaimableBytes: 100,
  });
  assert.equal(v.used.known, false);
  assert.equal(v.used.ratio, null);
  assert.equal(v.reclaimable.known, false);
  assert.equal(v.scanned.known, false);
});

test('normal olcum', () => {
  const v = DashboardRatio.view({
    diskTotalBytes: 1000,
    diskFreeBytes: 600,
    scannedBytes: 300,
    reclaimableBytes: 100,
  });
  assert.equal(v.used.known, true);
  assert.equal(v.used.numerator, 400);
  assert.equal(v.used.denominator, 1000);
  assert.equal(v.used.ratio, 0.4);
  assert.equal(v.reclaimable.numerator, 100);
  assert.equal(v.reclaimable.denominator, 400);
  assert.equal(v.reclaimable.ratio, 0.25);
  assert.equal(v.scanned.numerator, 300);
  assert.equal(v.scanned.denominator, 400);
  assert.equal(v.scanned.ratio, 0.75);
});

test('yuvarlama 4 hane', () => {
  const v = DashboardRatio.view({
    diskTotalBytes: 1000,
    diskFreeBytes: 1,
    scannedBytes: 0,
    reclaimableBytes: 1,
  });
  // usedBytes = 999, reclaimable 1/999 = 0.001001... -> 0.001
  assert.equal(v.reclaimable.ratio, 0.001);
});

test('kirpma: geri kazanilabilir kullanilandan buyukse ratio 1', () => {
  const v = DashboardRatio.view({
    diskTotalBytes: 1000,
    diskFreeBytes: 600,
    scannedBytes: 0,
    reclaimableBytes: 900,
  });
  assert.equal(v.reclaimable.ratio, 1);
});

test('diskTotal 0 -> used bilinmiyor', () => {
  const v = DashboardRatio.view({
    diskTotalBytes: 0,
    diskFreeBytes: 0,
    scannedBytes: 10,
    reclaimableBytes: 5,
  });
  assert.equal(v.used.known, false);
  assert.equal(v.used.ratio, null);
  assert.equal(v.reclaimable.known, false);
  assert.equal(v.scanned.known, false);
});

test('diskFree toplamdan buyuk -> kullanilan 0, reclaimable/scanned bilinmiyor ama used bilinir', () => {
  const v = DashboardRatio.view({
    diskTotalBytes: 1000,
    diskFreeBytes: 1500,
    scannedBytes: 300,
    reclaimableBytes: 100,
  });
  assert.equal(v.used.known, true);
  assert.equal(v.used.numerator, 0);
  assert.equal(v.used.ratio, 0);
  assert.equal(v.reclaimable.known, false);
  assert.equal(v.scanned.known, false);
});

test('negatif girdiler 0a kirpilir, NaN yok', () => {
  const v = DashboardRatio.view({
    diskTotalBytes: 1000,
    diskFreeBytes: 600,
    scannedBytes: -5,
    reclaimableBytes: -3,
  });
  assert.equal(v.scanned.numerator, 0);
  assert.equal(v.reclaimable.numerator, 0);
  assert.equal(v.scanned.ratio, 0);
  assert.equal(v.reclaimable.ratio, 0);
  assert.equal(Number.isNaN(v.scanned.ratio as number), false);
});

test('Number.isFinite olmayan (NaN) -> bilinmiyor', () => {
  const v = DashboardRatio.view({
    diskTotalBytes: Number.NaN,
    diskFreeBytes: 600,
    scannedBytes: 10,
    reclaimableBytes: 5,
  });
  assert.equal(v.used.known, false);
  assert.equal(v.reclaimable.known, false);
  assert.equal(v.scanned.known, false);
});