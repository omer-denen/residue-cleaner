import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exists } from '../src/util/path-exists.ts';

let root = '';

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'residue-path-exists-'));
});

after(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test('exists: var olan dizin ve dosya true', async () => {
  const file = join(root, 'a.txt');
  await writeFile(file, 'x');
  assert.equal(await exists(root), true);
  assert.equal(await exists(file), true);
});

test('exists: olmayan yol false (hata firlatmaz)', async () => {
  assert.equal(await exists(join(root, 'yok', 'b.txt')), false);
});
