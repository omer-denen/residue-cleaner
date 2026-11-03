import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bar,
  daysSince,
  formatAge,
  formatBytes,
  formatCount,
  formatDate,
  formatDateTime,
  padEnd,
  padStart,
  truncatePath,
  visibleWidth,
} from '../src/util/format.ts';

test('formatBytes: gecersiz, birim gecisi ve basamak kurali', () => {
  assert.equal(formatBytes(-1), '-');
  assert.equal(formatBytes(Number.NaN), '-');
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1023), '1023 B');
  assert.equal(formatBytes(1024), '1 KB');
  assert.equal(formatBytes(1536), '2 KB');
  assert.equal(formatBytes(5 * 1024 ** 2), '5.00 MB');
  assert.equal(formatBytes(42 * 1024 ** 2), '42.0 MB');
  assert.equal(formatBytes(150 * 1024 ** 2), '150 MB');
  assert.equal(formatBytes(1024 ** 4 * 2), '2.00 TB');
  assert.equal(formatBytes(1024, 1), '1.0 KB');
});

test('tarih ve yas: sifir/bilinmiyor ve tum araliklar', () => {
  assert.equal(formatDate(0), '-');
  assert.equal(formatDateTime(0), '-');
  assert.equal(formatAge(0), 'bilinmiyor');
  assert.equal(daysSince(0), Number.POSITIVE_INFINITY);

  const now = Date.UTC(2026, 10, 3, 12, 0, 0);
  assert.match(formatAge(now - 30_000, now), /^1 dk once$/);
  assert.match(formatAge(now - 3 * 3600_000, now), /^3 saat once$/);
  assert.match(formatAge(now - 5 * 86400_000, now), /^5 gun once$/);
  assert.match(formatAge(now - 60 * 86400_000, now), /^2 ay once$/);
  assert.match(formatAge(now - 800 * 86400_000, now), /^2 yil once$/);
  assert.equal(daysSince(now - 2 * 86400_000, now), 2);
  assert.match(formatDate(now), /^3 Kas 2026$/);
  assert.match(formatDateTime(now), /^03\.11\.2026 /);
});

test('bar: sinirlar ve genislik', () => {
  assert.equal(bar(0, 5), '.....');
  assert.equal(bar(1, 5), '#####');
  assert.equal(bar(2, 5), '#####');
  assert.equal(bar(-1, 5), '.....');
  assert.equal(bar(0.5, 4), '##..');
});

test('pad/width: ANSI renkleri gorunur genislige sayilmaz', () => {
  const red = '\x1b[31mabc\x1b[0m';
  assert.equal(visibleWidth(red), 3);
  assert.equal(padEnd('ab', 4), 'ab  ');
  assert.equal(padEnd('abcdef', 3), 'abcdef');
  assert.equal(padStart('ab', 4), '  ab');
  assert.equal(padStart('abcdef', 3), 'abcdef');
});

test('truncatePath: kisa yol aynen, uzun yol ortadan', () => {
  assert.equal(truncatePath('C:\\a', 10), 'C:\\a');
  const out = truncatePath('C:\\very\\long\\path\\that\\must\\shrink', 20);
  assert.equal(out.length, 20);
  assert.ok(out.includes('...'));
  assert.ok(out.startsWith('C:\\v'));
});

test('formatCount Turkce binlik ayirici kullanir', () => {
  assert.equal(formatCount(1234567), '1.234.567');
});
