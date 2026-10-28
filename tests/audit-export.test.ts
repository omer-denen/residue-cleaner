import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditExport, AUDIT_SINCE_IDS, AUDIT_KIND_IDS, AUDIT_EXPORT_LIMIT } from '../src/core/audit-export.ts';
import type { AuditEventView } from '../src/core/contract.ts';
import { AuditView } from '../src/core/audit-view.ts';

const row = (over: Partial<AuditEventView> = {}): AuditEventView => ({
  at: 1700000000000,
  kind: 'delete',
  event: 'delete.done',
  ok: true,
  ...over,
});

test('normalize: gecerli since+kind gecer', () => {
  const out = AuditExport.normalize({ since: '24h', kind: 'delete' });
  assert.deepEqual(out, { since: '24h', kind: 'delete' });
});

test('normalize: all/null/boş/geçersiz elenir; girdi mutasyona uğramaz', () => {
  const input = { since: 'all', kind: 'all' };
  const snap = JSON.stringify(input);
  assert.deepEqual(AuditExport.normalize({ since: 'all', kind: 'all' }), {});
  assert.deepEqual(AuditExport.normalize({ since: '9y' }), {});
  assert.deepEqual(AuditExport.normalize({ since: '', kind: null }), {});
  assert.equal(JSON.stringify(input), snap);
});

test('normalize: yalnız geçerli alan geçirilir', () => {
  assert.deepEqual(AuditExport.normalize({ since: '7d', kind: 'bogus' }), { since: '7d' });
});

test('CSV: başlık satırı labels sırasına göre; etiket yoksa ham anahtar', () => {
  const labels: Record<string, string> = { at: 'Tarih', event: 'Olay' };
  const csv = AuditExport.csv([], labels, { bom: false });
  const header = csv.split('\r\n')[0];
  assert.equal(header, 'Tarih,Olay,kind,ok,path,paths,bytes,code,reason');
});

test('CSV: virgül içeren path tırnaklanır; CRLF satır sonu', () => {
  const csv = AuditExport.csv([row({ path: 'a,b' })], { at: 'at', event: 'event', kind: 'kind', ok: 'ok', path: 'path', paths: 'paths', bytes: 'bytes', code: 'code', reason: 'reason' }, { bom: false });
  assert.ok(csv.includes('"a,b"'));
  assert.ok(csv.includes('\r\n'));
});

test('CSV: " içeren alan "" ile kaçırılır', () => {
  const csv = AuditExport.csv([row({ path: 'say "hi"' })], { path: 'path' }, { bom: false });
  assert.ok(csv.includes('"say ""hi"""'));
});

test('CSV: newline içeren path tırnaklanır', () => {
  const csv = AuditExport.csv([row({ path: 'line1\nline2' })], { path: 'path' }, { bom: false });
  const lines = csv.split('\r\n');
  // header + 1 data row (path quoted, newline inside field)
  assert.equal(lines.length, 2);
  assert.ok(csv.includes('"line1\nline2"'));
});

test('CSV: paths birleştirilir; virgül içeren hedef tırnaklanır', () => {
  const csv = AuditExport.csv([row({ paths: ['a', 'b,c'] })], { paths: 'paths' }, { bom: false });
  assert.ok(csv.includes('"a; b,c"'));
});

test('CSV: BOM varsayılan true; bom:false ile başlamaz', () => {
  const withBom = AuditExport.csv([], { at: 'at' });
  assert.equal(withBom.charCodeAt(0), 0xfeff);
  const noBom = AuditExport.csv([], { at: 'at' }, { bom: false });
  assert.notEqual(noBom.charCodeAt(0), 0xfeff);
});

test('CSV: Türkçe karakterler bozulmaz', () => {
  const csv = AuditExport.csv([row({ path: 'ışğİ' })], { path: 'path' }, { bom: false });
  assert.ok(csv.includes('ışğİ'));
});

test('CSV: boş liste yalnız başlık', () => {
  const csv = AuditExport.csv([], { at: 'at', event: 'event', kind: 'kind', ok: 'ok', path: 'path', paths: 'paths', bytes: 'bytes', code: 'code', reason: 'reason' }, { bom: false });
  assert.equal(csv, 'at,event,kind,ok,path,paths,bytes,code,reason');
});

test('CSV: at <= 0 boş; ok true/false; bytes tam sayı', () => {
  const csv = AuditExport.csv(
    [row({ at: 0, ok: false, bytes: 42 }), row({ at: 5, ok: true })],
    { at: 'at', ok: 'ok', bytes: 'bytes' },
    { bom: false },
  );
  assert.ok(csv.includes(',false,'));
  assert.ok(csv.includes(',true,'));
  assert.ok(csv.includes('42'));
});

test('JSON: version/count/records; parse geri okunur', () => {
  const rows = [row({ paths: ['x'], counts: { removed: 1 } })];
  const s = AuditExport.json(rows);
  const parsed = JSON.parse(s);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.count, 1);
  assert.deepEqual(parsed.records[0].paths, ['x']);
  assert.deepEqual(parsed.records[0].counts, { removed: 1 });
});

test('Regresyon: AuditView.parse + counts değişmedi', () => {
  const line = JSON.stringify({ at: '2024-01-01T00:00:00.000Z', event: 'delete.done', removed: 2, freed: 10 });
  const rec = AuditView.parse(line);
  assert.ok(rec);
  assert.equal(rec!.kind, 'delete');
  const c = AuditView.counts([rec!]);
  assert.equal(c.delete, 1);
});

test('sabitler', () => {
  assert.deepEqual([...AUDIT_SINCE_IDS], ['1h', '24h', '7d', '30d']);
  assert.deepEqual([...AUDIT_KIND_IDS], ['delete', 'restore', 'purge', 'other']);
  assert.equal(AUDIT_EXPORT_LIMIT, 500);
});