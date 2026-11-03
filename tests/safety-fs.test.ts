import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deleteTarget } from '../src/actions/delete.ts';
import { clearGitCache } from '../src/core/git.ts';
import type { DeleteTarget } from '../src/core/types.ts';

const sandbox = await mkdtemp(join(tmpdir(), 'residue-safety-fs-'));
const hasGit = spawnSync('git', ['--version'], { windowsHide: true }).status === 0;

before(() => clearGitCache());
after(async () => {
  clearGitCache();
  await rm(sandbox, { recursive: true, force: true });
});

function whole(path: string): DeleteTarget {
  return { path, kind: 'whole', label: 'test', bytes: 1 };
}

function older(path: string): DeleteTarget {
  return { path, kind: 'older', label: 'test', bytes: 1, minAgeDays: 1 };
}

async function old(path: string): Promise<void> {
  const at = new Date(Date.now() - 3 * 86400_000);
  await utimes(path, at, at);
}

test('SAFE-02: git tracked klasor butun olarak silinmez', { skip: !hasGit }, async () => {
  const repo = join(sandbox, 'repo-whole');
  await mkdir(repo, { recursive: true });
  await writeFile(join(repo, 'tracked.txt'), 't', 'utf8');
  await writeFile(join(repo, 'untracked.txt'), 'u', 'utf8');
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['add', 'tracked.txt'], { cwd: repo, stdio: 'ignore', windowsHide: true });
  await old(join(repo, 'tracked.txt'));
  await old(join(repo, 'untracked.txt'));

  const res = await deleteTarget(whole(repo), 'recycle');
  assert.equal(res.removed, 0);
  assert.match(res.skipped[0]?.reason ?? '', /git tarafindan takip ediliyor/);
  assert.equal(existsSync(join(repo, 'tracked.txt')), true);
  assert.equal(existsSync(join(repo, 'untracked.txt')), true);
});

test('SAFE-02: git tracked dosya older hedefte atlanir, untracked tasinir', { skip: !hasGit }, async () => {
  const repo = join(sandbox, 'repo-older');
  await mkdir(repo, { recursive: true });
  const tracked = join(repo, 'tracked.txt');
  const untracked = join(repo, 'untracked.txt');
  await writeFile(tracked, 't', 'utf8');
  await writeFile(untracked, 'u', 'utf8');
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['add', 'tracked.txt'], { cwd: repo, stdio: 'ignore', windowsHide: true });
  await old(tracked);
  await old(untracked);

  const previousLocal = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = sandbox;
  try {
    const res = await deleteTarget(older(repo), 'recycle');
    assert.equal(res.removed, 1);
    assert.ok(res.skipped.some((s) => s.path === tracked && /tracked/.test(s.reason)));
    assert.equal(existsSync(tracked), true);
    assert.equal(existsSync(untracked), false);
  } finally {
    if (previousLocal === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocal;
  }
});

test('SAFE-08: junction hedefi silinmez, baga dokunulmaz', async () => {
  const real = join(sandbox, 'junction-real');
  await mkdir(real, { recursive: true });
  await writeFile(join(real, 'keep.txt'), 'k', 'utf8');
  const link = join(sandbox, 'junction-link');
  await symlink(real, link, 'junction');

  const res = await deleteTarget(whole(link), 'recycle');
  assert.equal(res.removed, 0);
  assert.match(res.skipped[0]?.reason ?? '', /sembolik bag\/junction/);
  assert.equal(existsSync(join(real, 'keep.txt')), true);
  assert.equal(existsSync(link), true);
});

test('SAFE-08: ust klasoru junction olan hedef atlanir', async () => {
  const real = join(sandbox, 'ancestor-real');
  await mkdir(join(real, 'sub'), { recursive: true });
  await writeFile(join(real, 'sub', 'keep.txt'), 'k', 'utf8');
  const link = join(sandbox, 'ancestor-link');
  await symlink(real, link, 'junction');

  const res = await deleteTarget(whole(join(link, 'sub')), 'recycle');
  assert.equal(res.removed, 0);
  assert.match(res.skipped[0]?.reason ?? '', /ust klasor junction\/symlink/);
  assert.equal(existsSync(join(real, 'sub', 'keep.txt')), true);
});
