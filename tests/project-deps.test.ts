import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  analyzeProject,
  commandExists,
  detectEcosystem,
  findArtifacts,
  hashFile,
  planProjectCleanup,
  restoreProjects,
  runProjectRecipe,
} from '../src/core/project-deps.ts';

async function fixture(kind: 'npm' | 'pnpm'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `residue-project-${kind}-`));
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies: { left: '^1.0.0' } }),
  );
  await writeFile(join(root, kind === 'pnpm' ? 'pnpm-lock.yaml' : 'package-lock.json'), 'lockfile');
  await mkdir(join(root, 'node_modules', 'left'), { recursive: true });
  await writeFile(join(root, 'node_modules', 'left', 'index.js'), 'x'.repeat(1000));
  return root;
}

test('npm projesi ve lockfile tespiti', async () => {
  const root = await fixture('npm');
  try {
    const eco = await detectEcosystem(root);
    assert.equal(eco.ecosystem, 'npm');
    assert.equal(eco.lockfile, 'package-lock.json');
    const artifacts = await analyzeProject(root, { recentDays: 0 });
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0]!.artifactName, 'node_modules');
    assert.ok(artifacts[0]!.recipe.installCommand.includes('npm ci'));
    assert.ok(artifacts[0]!.lockfileHash);
    assert.equal(artifacts[0]!.regenerable, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('pnpm gercekci kazanc tahmini', async () => {
  const root = await fixture('pnpm');
  try {
    const artifacts = await analyzeProject(root, { recentDays: 0 });
    assert.equal(artifacts[0]!.ecosystem, 'pnpm');
    assert.ok(artifacts[0]!.realisticBytes < artifacts[0]!.bytes);
    assert.ok(artifacts[0]!.recipe.installCommand.includes('--frozen-lockfile'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('yamali proje plana alinmaz', async () => {
  const root = await fixture('npm');
  try {
    await mkdir(join(root, 'patches'));
    const artifacts = await analyzeProject(root, { recentDays: 0 });
    assert.equal(artifacts[0]!.regenerable, false);
    const plan = planProjectCleanup(artifacts, 'recipe');
    assert.equal(plan.projects.length, 0);
    assert.equal(plan.blocked.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('alt klasorlerde artifact bulunur', async () => {
  const root = await mkdtemp(join(tmpdir(), 'residue-artifacts-'));
  try {
    await mkdir(join(root, 'pkg', 'node_modules'), { recursive: true });
    const found = await findArtifacts(root);
    assert.ok(found.some((p) => p.endsWith(join('pkg', 'node_modules'))));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('hashFile ayni icerik icin ayni hash', async () => {
  const root = await mkdtemp(join(tmpdir(), 'residue-hash-'));
  try {
    const f = join(root, 'x');
    await writeFile(f, 'abc');
    assert.equal(await hashFile(f), await hashFile(f));
    assert.equal((await hashFile(f))?.length, 64);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function detectFixture(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'residue-eco-'));
  try {
    for (const [name, body] of Object.entries(files)) {
      await writeFile(join(root, name), body);
    }
    return await detectEcosystem(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('ekosistem imzalari: yarn, bun, uv, poetry, pipenv, python, rust, dotnet, bilinmeyen', async () => {
  assert.equal((await detectFixture({ 'package.json': '{}', 'yarn.lock': 'x' })).ecosystem, 'yarn');
  assert.equal((await detectFixture({ 'package.json': '{}', 'bun.lockb': 'x' })).ecosystem, 'bun');
  assert.equal((await detectFixture({ 'pyproject.toml': '[project]', 'uv.lock': 'x' })).ecosystem, 'python-uv');
  assert.equal((await detectFixture({ 'pyproject.toml': '[tool.poetry]', 'poetry.lock': 'x' })).ecosystem, 'python-poetry');
  assert.equal((await detectFixture({ Pipfile: '[packages]', 'Pipfile.lock': '{}' })).ecosystem, 'python-pipenv');
  assert.equal((await detectFixture({ 'requirements.txt': 'x' })).ecosystem, 'python');
  assert.equal((await detectFixture({ 'Cargo.toml': '[package]', 'Cargo.lock': 'x' })).ecosystem, 'rust');
  assert.equal((await detectFixture({ 'app.csproj': '<Project/>' })).ecosystem, 'dotnet');
  assert.equal((await detectFixture({ 'README.md': 'x' })).ecosystem, 'unknown');
});

test('npm shrinkwrap ve workspace imzalari', async () => {
  const shrink = await detectFixture({ 'package.json': '{}', 'npm-shrinkwrap.json': '{}' });
  assert.equal(shrink.lockfile, 'npm-shrinkwrap.json');
  const mono = await detectFixture({ 'package.json': JSON.stringify({ workspaces: ['a'] }) });
  assert.equal(mono.monorepo, true);
  assert.equal(mono.workspaceRoot !== null, true);
  const bad = await detectFixture({ 'package.json': '{bozuk' });
  assert.equal(bad.monorepo, false);
});

test('findArtifacts derinlik siniri ve .git atlama', async () => {
  const root = await mkdtemp(join(tmpdir(), 'residue-artifacts-depth-'));
  try {
    await mkdir(join(root, 'a', 'b', 'node_modules'), { recursive: true });
    await mkdir(join(root, '.git', 'node_modules'), { recursive: true });
    const shallow = await findArtifacts(root, 0);
    assert.equal(shallow.length, 0);
    const deep = await findArtifacts(root, 3);
    assert.equal(deep.some((p) => p.includes('.git')), false);
    assert.equal(deep.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('ekosistemle uyumsuz artifact analizde atlanir', async () => {
  const root = await mkdtemp(join(tmpdir(), 'residue-artifacts-skip-'));
  try {
    await writeFile(join(root, 'package.json'), '{}');
    for (const name of ['target', 'bin', '.venv']) {
      await mkdir(join(root, name), { recursive: true });
      await writeFile(join(root, name, 'x'), 'y');
    }
    const artifacts = await analyzeProject(root, { recentDays: 0 });
    assert.equal(artifacts.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('plan modlari: vault ve cache-only uyarilari', async () => {
  const root = await fixture('npm');
  try {
    const [artifact] = await analyzeProject(root, { recentDays: 0 });
    assert.ok(artifact);
    const vault = planProjectCleanup([artifact], 'vault');
    assert.equal(vault.projects.length, 1);
    assert.equal(vault.warnings.length, 1);
    const cache = planProjectCleanup([artifact], 'cache-only');
    assert.equal(cache.warnings.length, 1);
    const blocked = planProjectCleanup([{ ...artifact, regenerable: false, risks: [] }], 'recipe');
    assert.equal(blocked.blocked[0]?.reason, 'yeniden uretilebilirlik kanitlanamadi');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bilinmeyen kurulum komutu bos doner ve tarif calismaz', async () => {
  const recipe = {
    version: 1 as const,
    ecosystem: 'unknown' as const,
    projectRoot: process.cwd(),
    artifactPaths: [],
    cachePaths: [],
    manifest: null,
    lockfile: null,
    lockfileHash: null,
    runtime: { name: 'unknown', version: null, installed: false },
    installCommand: '',
    verifyCommand: null,
    createdAt: 0,
  };
  const out = await runProjectRecipe(recipe);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'kurulum komutu bilinmiyor');
  const many = await restoreProjects([recipe, recipe], { concurrency: 2 });
  assert.equal(many.length, 2);
  assert.equal(many.every((r) => !r.ok), true);
});

test('commandExists node icin true, olmayan komut icin false', async () => {
  assert.equal(await commandExists('node'), true);
  assert.equal(await commandExists('residue-komut-yok-12345'), false);
});
