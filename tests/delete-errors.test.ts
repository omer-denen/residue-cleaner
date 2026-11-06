import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deleteTarget, type DeleteHooks } from '../src/actions/delete.ts';
import type { DeleteTarget } from '../src/core/types.ts';

const sandbox = await mkdtemp(join(tmpdir(), 'residue-delete-errors-'));
const previousLocal = process.env.LOCALAPPDATA;
process.env.LOCALAPPDATA = sandbox;

after(async () => {
  if (previousLocal === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = previousLocal;
  await rm(sandbox, { recursive: true, force: true });
});

let seq = 0;
async function targetDir(name: string, files: Record<string, string> = {}): Promise<string> {
  const dir = join(sandbox, `t-${++seq}-${name}`);
  await mkdir(dir, { recursive: true });
  for (const [file, body] of Object.entries(files)) {
    await writeFile(join(dir, file), body, 'utf8');
  }
  return dir;
}

function whole(path: string, bytes = 1): DeleteTarget {
  return { path, kind: 'whole', label: 'test', bytes };
}

function older(path: string, minAgeDays = 1): DeleteTarget {
  return { path, kind: 'older', label: 'test', bytes: 1, minAgeDays };
}

async function age(path: string, days: number): Promise<void> {
  const at = new Date(Date.now() - days * 86400_000);
  await utimes(path, at, at);
}

test('ERR-01: kaybolan hedef atlanir, hata uretmez', async () => {
  const path = join(sandbox, 'does-not-exist');
  const res = await deleteTarget(whole(path), 'recycle');
  assert.equal(res.removed, 0);
  assert.equal(res.failed.length, 0);
  assert.match(res.skipped[0]?.reason ?? '', /yol artik yok/);
});

test('kasa tasima basarili: kaynak kalkar, sayaclar tasimadan sonra artar', async () => {
  const path = await targetDir('ok', { 'a.txt': 'hello' });
  const res = await deleteTarget(whole(path, 5), 'recycle');
  assert.equal(res.removed, 1);
  assert.equal(res.bytesFreed, 5);
  assert.equal(res.failed.length, 0);
  assert.equal(existsSync(path), false);
});

test('ERR-05: kasa olusturulamazsa hedef yerinde kalir', async () => {
  const path = await targetDir('batch-fail', { 'a.txt': 'x' });
  const hooks: DeleteHooks = {
    newBatch: async () => {
      const err = new Error('kasa yazilamadi') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    },
  };
  const res = await deleteTarget(whole(path), 'recycle', Date.now(), hooks);
  assert.equal(res.removed, 0);
  assert.equal(res.bytesFreed, 0);
  assert.match(res.failed[0]?.reason ?? '', /kasa tasima basarisiz/);
  assert.equal(existsSync(path), true);
});

test('ERR-02: kasa tasima hatasi raporlanir, yarim basari sayilmaz', async () => {
  const path = await targetDir('move-fail', { 'a.txt': 'x' });
  const hooks: DeleteHooks = {
    move: async () => {
      const err = new Error('erisim reddedildi') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    },
  };
  const res = await deleteTarget(whole(path), 'recycle', Date.now(), hooks);
  assert.equal(res.removed, 0);
  assert.equal(res.bytesFreed, 0);
  assert.equal(res.failed.length, 1);
  assert.equal(existsSync(path), true);
});

test('3.0: kalici silme yolu kaldirildi; hedef yerinde kalir', async () => {
  const path = await targetDir('purge-rejected', { 'a.txt': 'x' });
  await assert.rejects(() => deleteTarget(whole(path, 5), 'purge'), /kaldirildi/);
  assert.equal(existsSync(join(path, 'a.txt')), true);
});

test("older: yas filtresi yeni dosyayi korur, kilitli dosya skipped olur", async () => {
  const path = await targetDir('older-mixed');
  const oldFile = join(path, 'old.txt');
  const newFile = join(path, 'new.txt');
  await writeFile(oldFile, 'o', 'utf8');
  await writeFile(newFile, 'n', 'utf8');
  await age(oldFile, 3);

  const res = await deleteTarget(older(path), 'recycle');
  assert.equal(res.removed, 1);
  assert.equal(res.skipped.length, 1);
  assert.ok(res.skipped.some((s) => /cok yeni/.test(s.reason)));
  assert.equal(existsSync(newFile), true);
  assert.equal(existsSync(oldFile), false);
});

test('ERR-05: older kasa partisi kurulamazsa failed ve tasima yok', async () => {
  const path = await targetDir('older-batch-fail');
  const oldFile = join(path, 'old.txt');
  await writeFile(oldFile, 'o', 'utf8');
  await age(oldFile, 3);
  const hooks: DeleteHooks = {
    newBatch: async () => {
      throw new Error('batch yok');
    },
  };
  const res = await deleteTarget(older(path), 'recycle', Date.now(), hooks);
  assert.equal(res.removed, 0);
  assert.match(res.failed[0]?.reason ?? '', /kasa olusturulamadi/);
  assert.equal(existsSync(oldFile), true);
});

test('ERR-02: older tasima hatalari kilitli/failed olarak ayrilir', async () => {
  const path = await targetDir('older-move-fail');
  const locked = join(path, 'locked.txt');
  const broken = join(path, 'broken.txt');
  await writeFile(locked, 'l', 'utf8');
  await writeFile(broken, 'b', 'utf8');
  await age(locked, 3);
  await age(broken, 3);

  const hooks: DeleteHooks = {
    move: async (_batch, src) => {
      const err = new Error(src.endsWith('locked.txt') ? 'kilit' : 'bozuk') as NodeJS.ErrnoException;
      err.code = src.endsWith('locked.txt') ? 'EBUSY' : 'EIO';
      throw err;
    },
  };
  const res = await deleteTarget(older(path), 'recycle', Date.now(), hooks);
  assert.equal(res.removed, 0);
  assert.ok(res.skipped.some((s) => /dosya kilitli/.test(s.reason)));
  assert.ok(res.failed.some((s) => /EIO/.test(s.reason)));
});

test('older: uygun dosya yoksa kasa olusturulmaz', async () => {
  const path = await targetDir('older-none');
  await writeFile(join(path, 'new.txt'), 'n', 'utf8');
  let called = 0;
  const hooks: DeleteHooks = {
    newBatch: async () => {
      called++;
      throw new Error('cagrilmamali');
    },
  };
  const res = await deleteTarget(older(path), 'recycle', Date.now(), hooks);
  assert.equal(called, 0);
  assert.equal(res.removed, 0);
});
