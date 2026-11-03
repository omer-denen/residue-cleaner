import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeDirs } from '../src/core/freshness.ts';

function tree(): string {
  const root = mkdtempSync(join(tmpdir(), 'residue-probe-'));
  writeFileSync(join(root, 'a.txt'), 'x');
  mkdirSync(join(root, 'sub'));
  mkdirSync(join(root, 'sub', 'deep'));
  writeFileSync(join(root, 'sub', 'b.txt'), 'x');
  return root;
}

test('probeDirs olmayan yolu exists=false dondurur', async () => {
  const out = await probeDirs(join(tmpdir(), 'residue-does-not-exist-xyz'));
  assert.deepEqual(out, { exists: false, dirs: 0, entries: 0, newestMtime: 0, capped: false });
});

test('probeDirs dosyayi klasor saymaz', async () => {
  const root = tree();
  const out = await probeDirs(join(root, 'a.txt'));
  assert.equal(out.exists, false);
});

test('probeDirs alt klasorleri ve girdileri sayar', async () => {
  const root = tree();
  const out = await probeDirs(root);
  assert.equal(out.exists, true);
  assert.equal(out.dirs, 3);
  assert.ok(out.entries >= 3);
  assert.ok(out.newestMtime > 0);
  assert.equal(out.capped, false);
});

test('probeDirs maxDepth sinirinda alt klasore inmez', async () => {
  const root = tree();
  const out = await probeDirs(root, { maxDepth: 0 });
  assert.equal(out.dirs, 1);
  assert.equal(out.entries, 0);
});

test('probeDirs maxDirs sinirinda capped isaretler', async () => {
  const root = tree();
  const out = await probeDirs(root, { maxDirs: 1 });
  assert.equal(out.dirs, 1);
  assert.equal(out.capped, true);
});

test('probeDirs junction hedefini izlemez', async (t) => {
  const root = tree();
  const outside = mkdtempSync(join(tmpdir(), 'residue-outside-'));
  mkdirSync(join(outside, 'hidden'));
  try {
    symlinkSync(outside, join(root, 'link'), 'junction');
  } catch {
    t.skip('junction olusturulamadi');
    return;
  }
  const out = await probeDirs(root);
  assert.equal(out.dirs, 3);
});
