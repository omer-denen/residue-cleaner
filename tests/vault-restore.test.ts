import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walk } from '../src/core/walker.ts';
import { RestoreTarget } from '../src/core/restore-target.ts';

let root = '';
let vault: typeof import('../src/actions/vault.ts');

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'residue-vault-restore-test-'));
  process.env.LOCALAPPDATA = root;
  vault = await import('../src/actions/vault.ts');
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function makeSource(name: string): Promise<string> {
  const dir = join(root, 'source', name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'a.txt'), 'a'.repeat(100));
  await writeFile(join(dir, 'b.txt'), 'b'.repeat(50));
  return dir;
}

test('1. hedef yok: geri yukleme basarili, manifest temizlenir', async () => {
  const src = await makeSource('r1');
  const w = await walk({ root: src, largeThreshold: Infinity, maxLarge: 0 });
  const batch = await vault.newVaultBatch();
  const entry = await vault.moveIntoVault(batch, src, w.bytes, w.files);

  const r = await vault.restoreVaultEntry(entry);
  assert.equal(r.restored, true);
  assert.equal(r.verified, true);
  assert.equal(r.to, src);
  assert.equal(r.targetState, 'absent');
  assert.ok((r.attempts ?? 0) >= 1);
  assert.equal(await vault.findVaultEntry(entry.id), null);
  // icerik geri geldi
  assert.equal(await readFile(join(src, 'a.txt'), 'utf8'), 'a'.repeat(100));
});

test('2. hedef var (bos klasor): conflict, hedef ezilmez', async () => {
  const src = await makeSource('r2');
  const w = await walk({ root: src, largeThreshold: Infinity, maxLarge: 0 });
  const batch = await vault.newVaultBatch();
  const entry = await vault.moveIntoVault(batch, src, w.bytes, w.files);

  await mkdir(src, { recursive: true });
  const r = await vault.restoreVaultEntry(entry, { conflict: 'rename' });
  assert.equal(r.restored, true);
  assert.equal(r.conflict, true);
  assert.equal(r.targetState, 'empty');
  assert.ok(r.to.startsWith(`${src}.restored-`));
  // bos klasor hala duruyor
  const st = await (await import('node:fs/promises')).stat(src);
  assert.ok(st.isDirectory());
  // to ayri bir dizin
  assert.notEqual(r.to, src);
});

test('3. hedef var (dolu klasor): icerik birebir korunur', async () => {
  const src = await makeSource('r3');
  const w = await walk({ root: src, largeThreshold: Infinity, maxLarge: 0 });
  const batch = await vault.newVaultBatch();
  const entry = await vault.moveIntoVault(batch, src, w.bytes, w.files);

  await mkdir(src, { recursive: true });
  await writeFile(join(src, 'new.txt'), 'new-content');
  const newerAt = entry.at + 60_000;
  await utimes(join(src, 'new.txt'), new Date(newerAt), new Date(newerAt));
  const r = await vault.restoreVaultEntry(entry, { conflict: 'rename' });
  assert.equal(r.restored, true);
  assert.equal(r.conflict, true);
  assert.equal(r.targetState, 'newer');
  assert.equal(r.currentNewestAt, newerAt);
  // dolu klasorun icerigi korunur
  assert.equal(await readFile(join(src, 'new.txt'), 'utf8'), 'new-content');
  // geri yuklenen to ayri
  assert.ok(r.to.startsWith(`${src}.restored-`));
  assert.equal(await readFile(join(r.to, 'a.txt'), 'utf8'), 'a'.repeat(100));
});

test('4. ilk suffix de dolu: benzersiz ada yazar, suffix korunur', async () => {
  const src = await makeSource('r4');
  const w = await walk({ root: src, largeThreshold: Infinity, maxLarge: 0 });
  const batch = await vault.newVaultBatch();
  const entry = await vault.moveIntoVault(batch, src, w.bytes, w.files);

  await mkdir(src, { recursive: true });
  const now = 1234567890;
  const suffix = `${src}.restored-${now}`;
  await mkdir(suffix, { recursive: true });
  await writeFile(join(suffix, 'keep.txt'), 'keep-me');

  const r = await vault.restoreVaultEntry(entry, { conflict: 'rename', now });
  assert.equal(r.restored, true);
  assert.ok(r.to !== suffix);
  assert.ok(r.to.startsWith(`${src}.restored-${now}-`));
  assert.ok((r.attempts ?? 0) >= 1);
  // suffix klasoru korunur
  assert.equal(await readFile(join(suffix, 'keep.txt'), 'utf8'), 'keep-me');
});

test('5. isRetryableCode matrisi', async () => {
  const yes = ['ENOTEMPTY', 'EEXIST', 'ENOTDIR', 'EPERM', 'EACCES', 'EBUSY'];
  const no = ['ENOENT', 'EXDEV', undefined];
  for (const c of yes) assert.equal(RestoreTarget.isRetryableCode(c), true, c);
  for (const c of no) assert.equal(RestoreTarget.isRetryableCode(c), false, String(c));
});

test('6. RestoreTarget.initial / retry saf fonksiyon', async () => {
  const orig = '/tmp/x';
  assert.equal(RestoreTarget.initial(orig, 5, false), orig);
  assert.equal(RestoreTarget.initial(orig, 5, true), `${orig}.restored-5`);
  const r = RestoreTarget.retry(orig, 5, 1, 'ab');
  assert.equal(r, `${orig}.restored-5-1-ab`);
  // girdi degismez
  assert.equal(orig, '/tmp/x');
});

test('7. basarisizlik audit: storedPath yok -> ENOENT, audit kaydi var', async () => {
  const src = await makeSource('r7');
  const w = await walk({ root: src, largeThreshold: Infinity, maxLarge: 0 });
  const batch = await vault.newVaultBatch();
  const entry = await vault.moveIntoVault(batch, src, w.bytes, w.files);

  // storedPath'i fiziksel olarak sil
  await (await import('node:fs/promises')).rm(entry.storedPath, { recursive: true, force: true });

  const r = await vault.restoreVaultEntry(entry);
  assert.equal(r.restored, false);
  assert.ok(r.reason && r.reason.length > 0);
  assert.equal(r.code, 'ENOENT');
  assert.ok((r.attempts ?? 0) >= 1);

  // audit dosyasinda kayit olmali
  const auditFile = join(root, 'residue', 'audit.log');
  let content = '';
  try { content = await readFile(auditFile, 'utf8'); } catch { content = ''; }
  assert.ok(content.includes('vault.restore.failed'));
  assert.ok(content.includes('reason'));
});

test('8. manifest temizligi basarisizlikta yapilmaz', async () => {
  // r7 senaryosundan sonra kayit hala listede olmali; yeni bir entry ile dogrula
  const src = await makeSource('r8');
  const w = await walk({ root: src, largeThreshold: Infinity, maxLarge: 0 });
  const batch = await vault.newVaultBatch();
  const entry = await vault.moveIntoVault(batch, src, w.bytes, w.files);
  await (await import('node:fs/promises')).rm(entry.storedPath, { recursive: true, force: true });
  await vault.restoreVaultEntry(entry);
  const found = await vault.findVaultEntry(entry.id);
  assert.ok(found, 'basarisiz geri yuklemede kayit silinmemeli');
});

test('9. attempts raporu: basari >=1, suffix cakismasinda benzersiz yol', async () => {
  const src = await makeSource('r9');
  const w = await walk({ root: src, largeThreshold: Infinity, maxLarge: 0 });
  const batch = await vault.newVaultBatch();
  const entry = await vault.moveIntoVault(batch, src, w.bytes, w.files);

  await mkdir(src, { recursive: true });
  const now = 999;
  const suffix = `${src}.restored-${now}`;
  await mkdir(suffix, { recursive: true });

  const r = await vault.restoreVaultEntry(entry, { conflict: 'rename', now });
  assert.equal(r.restored, true);
  assert.ok((r.attempts ?? 0) >= 1);
  assert.ok(!r.to.includes(suffix) || r.to !== suffix);
  assert.ok(r.to.startsWith(`${src}.restored-`));
});

test('10. hedefteki icerik silme anindan eski: older', async () => {
  const src = await makeSource('r10');
  const w = await walk({ root: src, largeThreshold: Infinity, maxLarge: 0 });
  const batch = await vault.newVaultBatch();
  const entry = await vault.moveIntoVault(batch, src, w.bytes, w.files);

  await mkdir(src, { recursive: true });
  await writeFile(join(src, 'old.txt'), 'old-content');
  const olderAt = entry.at - 60_000;
  await utimes(join(src, 'old.txt'), new Date(olderAt), new Date(olderAt));
  await utimes(src, new Date(olderAt), new Date(olderAt));

  const r = await vault.restoreVaultEntry(entry, { conflict: 'rename' });
  assert.equal(r.restored, true);
  assert.equal(r.conflict, true);
  assert.equal(r.targetState, 'older');
  assert.equal(r.currentNewestAt, olderAt);
});

test('11. RestoreTarget.classify saf siniflandirici', () => {
  const at = 1_000_000;
  assert.equal(RestoreTarget.classify(null, at), 'absent');
  assert.equal(RestoreTarget.classify({ entries: 0, newestAt: 0 }, at), 'empty');
  assert.equal(RestoreTarget.classify({ entries: 1, newestAt: at + 5_000 }, at), 'newer');
  assert.equal(RestoreTarget.classify({ entries: 1, newestAt: at - 5_000 }, at), 'older');
  // tolerans icinde: iddia yok
  assert.equal(RestoreTarget.classify({ entries: 1, newestAt: at + 500 }, at), 'unknown');
  // zaman okunamadi
  assert.equal(RestoreTarget.classify({ entries: 1, newestAt: 0 }, at), 'unknown');
  // tolerans parametresi
  assert.equal(RestoreTarget.classify({ entries: 1, newestAt: at + 500 }, at, 100), 'newer');
});

test('12. iptal politikasi da hedef durumunu raporlar', async () => {
  const src = await makeSource('r12');
  const w = await walk({ root: src, largeThreshold: Infinity, maxLarge: 0 });
  const batch = await vault.newVaultBatch();
  const entry = await vault.moveIntoVault(batch, src, w.bytes, w.files);

  await mkdir(src, { recursive: true });
  await writeFile(join(src, 'kept.txt'), 'kept');
  const newerAt = entry.at + 60_000;
  await utimes(join(src, 'kept.txt'), new Date(newerAt), new Date(newerAt));

  const r = await vault.restoreVaultEntry(entry, { conflict: 'cancel' });
  assert.equal(r.restored, false);
  assert.equal(r.conflict, true);
  assert.equal(r.targetState, 'newer');
  assert.equal(r.currentNewestAt, newerAt);
  assert.ok(r.reason && r.reason.includes('cancel'));
});