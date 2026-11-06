import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walk } from '../src/core/walker.ts';

let root = '';
let vault: typeof import('../src/actions/vault.ts');

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'residue-vault-test-'));
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

test('kasaya tasima: kararli id, meta ve manifest', async () => {
  const src = await makeSource('one');
  const w = await walk({ root: src, largeThreshold: Infinity, maxLarge: 0 });
  const batch = await vault.newVaultBatch();
  const entry = await vault.moveIntoVault(batch, src, w.bytes, w.files);
  assert.ok(entry.id.startsWith('v-'));
  assert.ok(entry.storedPath.endsWith('payload'));
  const meta = JSON.parse(await readFile(join(entry.storedPath, '..', 'meta.json'), 'utf8'));
  assert.equal(meta.id, entry.id);
  assert.equal(meta.originalPath, src);
  const manifest = JSON.parse(await readFile(join(batch.dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, 2);
  assert.equal(manifest.entries[0].id, entry.id);

  const listed = await vault.listVaultEntries();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.id, entry.id);
});

test('cakisma: rename orijinali korur, cancel hic dokunmaz', async () => {
  const src = await makeSource('two');
  const w = await walk({ root: src, largeThreshold: Infinity, maxLarge: 0 });
  const batch = await vault.newVaultBatch();
  const entry = await vault.moveIntoVault(batch, src, w.bytes, w.files);

  // Orijinal yolu yeniden doldur.
  await mkdir(src, { recursive: true });
  await writeFile(join(src, 'new.txt'), 'new');

  const cancelled = await vault.restoreVaultEntry(entry, { conflict: 'cancel' });
  assert.equal(cancelled.restored, false);
  assert.equal(cancelled.conflict, true);
  assert.ok(await vault.findVaultEntry(entry.id));

  const restored = await vault.restoreVaultEntry(entry, { conflict: 'rename' });
  assert.equal(restored.restored, true);
  assert.equal(restored.conflict, true);
  assert.equal(restored.verified, true);
  assert.ok(restored.to.includes('.restored-'));
  assert.equal(await readFile(join(src, 'new.txt'), 'utf8'), 'new');
  assert.equal(await vault.findVaultEntry(entry.id), null);
});

test('secili oge bosaltma digerlerine dokunmaz', async () => {
  const a = await makeSource('purge-a');
  const b = await makeSource('purge-b');
  const wa = await walk({ root: a, largeThreshold: Infinity, maxLarge: 0 });
  const wb = await walk({ root: b, largeThreshold: Infinity, maxLarge: 0 });
  const batchA = await vault.newVaultBatch();
  const batchB = await vault.newVaultBatch();
  const ea = await vault.moveIntoVault(batchA, a, wa.bytes, wa.files);
  const eb = await vault.moveIntoVault(batchB, b, wb.bytes, wb.files);

  const r = await vault.purgeVaultItems([ea.id]);
  assert.equal(r.ok, true);
  assert.equal(r.items, 1);
  assert.equal(await vault.findVaultEntry(eb.id) !== null, true);
});

test('bosaltma: orijinalde daha yeni icerik varsa bildiri uretir', async () => {
  const src = await makeSource('purge-newer');
  const w = await walk({ root: src, largeThreshold: Infinity, maxLarge: 0 });
  const batch = await vault.newVaultBatch();
  const entry = await vault.moveIntoVault(batch, src, w.bytes, w.files);

  // Orijinal konumda sonradan olusmus (daha yeni) icerik.
  await mkdir(src, { recursive: true });
  const newer = join(src, 'new.txt');
  await writeFile(newer, 'new');
  const newerAt = new Date(entry.at + 60_000);
  await utimes(newer, newerAt, newerAt);

  const r = await vault.purgeVaultItems([entry.id]);
  assert.equal(r.ok, true);
  assert.equal(r.items, 1);
  assert.equal(r.pruned, 0);
  assert.equal(r.notices.length, 1);
  assert.equal(r.notices[0]!.id, entry.id);
  assert.equal(r.notices[0]!.targetState, 'newer');
  assert.equal(r.notices[0]!.currentNewestAt, entry.at + 60_000);
  assert.equal(await vault.findVaultEntry(entry.id), null);
});

test('bosaltma: payload yoksa yalniz kayit temizlenir, orijinal korunur', async () => {
  const src = await makeSource('purge-phantom');
  const w = await walk({ root: src, largeThreshold: Infinity, maxLarge: 0 });
  const batch = await vault.newVaultBatch();
  const entry = await vault.moveIntoVault(batch, src, w.bytes, w.files);

  // Payload zaten yok (ornek: yarim kalmis geri yukleme). Orijinal yeniden var.
  await mkdir(src, { recursive: true });
  await writeFile(join(src, 'a.txt'), 'a'.repeat(100));
  await rm(entry.storedPath, { recursive: true, force: true });

  const r = await vault.purgeVaultItems([entry.id]);
  assert.equal(r.ok, true);
  assert.equal(r.items, 0);
  assert.equal(r.pruned, 1);
  assert.equal(r.prunedEntries[0]!.id, entry.id);
  assert.equal(await readFile(join(src, 'a.txt'), 'utf8'), 'a'.repeat(100));
  assert.equal(await vault.findVaultEntry(entry.id), null);
});

test('purgeVault CLI yedek klasorlerini korur', async () => {
  const cliDir = join(vault.vaultRoot(), '2026-01-01-quarantine');
  await mkdir(cliDir, { recursive: true });
  await writeFile(join(cliDir, 'manifest.json'), JSON.stringify({ kind: 'cli-backup' }));
  const r = await vault.purgeVault();
  assert.ok(r.batches >= 0);
  const stillThere = await readFile(join(cliDir, 'manifest.json'), 'utf8');
  assert.ok(stillThere.includes('cli-backup'));
});

test('indeks manifestlerden yeniden olusturulur', async () => {
  const r = await vault.rebuildVaultIndex();
  assert.ok(r.entries >= 0);
  const idx = await vault.loadVaultIndex();
  assert.equal(idx.rebuilt, false);
});
