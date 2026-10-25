import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile, utimes } from 'node:fs/promises';
import { join } from 'node:path';

import { classifyPath } from '../src/core/analyze.ts';
import { runScan } from '../src/commands/scan.ts';
import { buildPlan } from '../src/actions/delete.ts';

/**
 * T37 — yarim kalmis guncelleme artiklari (gizli .paket-<rastgele>).
 */

let root = '';

before(async () => {
  root = await mkdtemp(join(process.cwd(), 'scratch', 'partial-install-fixtures-'));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function mkNm(label: string): Promise<string> {
  // Proje koklerinden (repo package.json) kacmak icin derin yuvala.
  const nm = join(root, label, 'a', 'b', 'c', 'd', 'node_modules');
  await mkdir(nm, { recursive: true });
  return nm;
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

test('T37-1: eski artik -> marker var, hedef var', async () => {
  const nm = await mkNm('t37-old');
  const art = join(nm, '.foo-abc123');
  await mkdir(art, { recursive: true });
  await writeFile(join(art, 'x.txt'), 'x');
  await utimes(art, daysAgo(2), daysAgo(2));

  const c = await classifyPath(nm, 'custom');
  assert.ok(c, 'kume uretilmeli');
  assert.ok((c.evidence.markers ?? []).includes('partial-install:.foo-abc123'), 'marker olmali');
  assert.ok((c.deleteTargets ?? []).length > 0, 'hedef olmali');
});

test('T37-2: genc artik -> marker var, hedef yok', async () => {
  const nm = await mkNm('t37-young');
  const art = join(nm, '.foo-abc123');
  await mkdir(art, { recursive: true });
  await writeFile(join(art, 'x.txt'), 'x');

  const c = await classifyPath(nm, 'custom');
  assert.ok(c, 'kume uretilmeli');
  assert.ok((c.evidence.markers ?? []).includes('partial-install:.foo-abc123'), 'marker olmali');
  assert.equal((c.deleteTargets ?? []).length, 0, 'hedef olmamali');
});

test('T37-3: desen disi gizli klasor -> marker yok', async () => {
  const nm = await mkNm('t37-pat');
  await mkdir(join(nm, '.bin'), { recursive: true });
  await mkdir(join(nm, '.cache'), { recursive: true });
  await writeFile(join(nm, '.bin', 'x'), 'x');
  await writeFile(join(nm, '.cache', 'x'), 'x');

  const c = await classifyPath(nm, 'custom');
  assert.ok(c, 'kume uretilmeli');
  const partials = (c.evidence.markers ?? []).filter((m) => m.startsWith('partial-install:'));
  assert.equal(partials.length, 0, 'partial marker olmamali');
});

test('T37-4: gercek paket korumasi -> hedef yok', async () => {
  const nm = await mkNm('t37-prot');
  const art = join(nm, '.foo-abc123');
  await mkdir(art, { recursive: true });
  await writeFile(join(art, 'x.txt'), 'x');
  await writeFile(join(nm, 'package.json'), JSON.stringify({ dependencies: { foo: '^1.0.0' } }));
  await utimes(art, daysAgo(2), daysAgo(2));

  const c = await classifyPath(nm, 'custom');
  assert.ok(c, 'kume uretilmeli');
  assert.ok((c.evidence.markers ?? []).includes('partial-install:.foo-abc123'), 'marker olmali');
  assert.equal((c.deleteTargets ?? []).length, 0, 'koruma nedeniyle hedef olmamali');
});

test('T37-5: depo degil -> marker yok', async () => {
  const plain = join(root, 'plain-' + Date.now());
  await mkdir(plain, { recursive: true });
  const art = join(plain, '.foo-abc123');
  await mkdir(art, { recursive: true });
  await writeFile(join(art, 'x.txt'), 'x');
  await utimes(art, daysAgo(2), daysAgo(2));

  const c = await classifyPath(plain, 'custom');
  // kume uretilmeyebilir (bos olmayan); marker kontrolu
  if (c) {
    const partials = (c.evidence.markers ?? []).filter((m) => m.startsWith('partial-install:'));
    assert.equal(partials.length, 0, 'partial marker olmamali');
  }
});

test('T37-6: proje taramasi -> hedef yok', async () => {
  const proj = join(root, 'proj-' + Date.now());
  await mkdir(proj + '/.git', { recursive: true });
  await writeFile(proj + '/package.json', JSON.stringify({ name: 'p' }));
  const nm = join(proj, 'node_modules');
  const art = join(nm, '.foo-abc123');
  await mkdir(art, { recursive: true });
  await writeFile(join(art, 'x.txt'), 'x');
  await utimes(art, daysAgo(2), daysAgo(2));

  const res = await runScan({ envs: [], roots: [proj], minAgeDays: 0, json: true, quiet: true, includeBytes: true, exclude: [] });
  for (const c of res.clusters) {
    assert.equal((c.deleteTargets ?? []).length, 0, 'proje taramasinda hedef olmamali');
  }
});

test('T37-b-1: eski artik -> ask', async () => {
  const nm = await mkNm('t37b-ask');
  const art = join(nm, '.foo-abc123');
  await mkdir(art, { recursive: true });
  await writeFile(join(art, 'x.txt'), 'x');
  await mkdir(join(nm, '.bin'), { recursive: true });
  await writeFile(join(nm, '.bin', 'foo'), 'x');
  await mkdir(join(nm, 'realpkg'), { recursive: true });
  await writeFile(join(nm, 'realpkg', 'index.js'), 'x');
  await utimes(art, daysAgo(2), daysAgo(2));

  const c = await classifyPath(nm, 'custom');
  assert.ok(c, 'kume uretilmeli');
  assert.equal(c.verdict.kind, 'ask', 'kind ask olmali');
  assert.equal(c.verdict.risk, 'medium', 'risk medium olmali');
  const targets = c.deleteTargets ?? [];
  assert.ok(targets.length > 0, 'hedef olmali');
  for (const t of targets) {
    const base = t.path.split(/[\\\\/]/).filter(Boolean).pop();
    assert.equal(base, '.foo-abc123', 'yalniz artik hedeflenmeli');
  }
  assert.ok(!targets.some((t) => t.path.includes('.bin')), '.bin hedeflenmemeli');
  assert.ok(!targets.some((t) => t.path.includes('realpkg')), 'gercek paket hedeflenmemeli');
});

test('T37-b-2: artik yok -> report-only (regresyon)', async () => {
  const nm = await mkNm('t37b-none');
  await mkdir(join(nm, '.bin'), { recursive: true });
  await writeFile(join(nm, '.bin', 'foo'), 'x');
  await mkdir(join(nm, 'realpkg'), { recursive: true });
  await writeFile(join(nm, 'realpkg', 'index.js'), 'x');

  const c = await classifyPath(nm, 'custom');
  assert.ok(c, 'kume uretilmeli');
  assert.equal(c.verdict.kind, 'report-only', 'kind report-only olmali');
  assert.equal((c.deleteTargets ?? []).length, 0, 'hedef olmamali');
});

test('T37-b-3: plana girebilirlik', async () => {
  // eski artik
  const nmOld = await mkNm('t37b-plan-old');
  const artOld = join(nmOld, '.foo-abc123');
  await mkdir(artOld, { recursive: true });
  await writeFile(join(artOld, 'x.txt'), 'x');
  await utimes(artOld, daysAgo(2), daysAgo(2));
  const cOld = await classifyPath(nmOld, 'custom');
  assert.ok(cOld);
  const planOld = buildPlan([cOld], 'recycle');
  assert.equal(planOld.targets.length, 1, 'eski artikta 1 hedef olmali');

  // genc artik
  const nmYoung = await mkNm('t37b-plan-young');
  const artYoung = join(nmYoung, '.foo-abc123');
  await mkdir(artYoung, { recursive: true });
  await writeFile(join(artYoung, 'x.txt'), 'x');
  const cYoung = await classifyPath(nmYoung, 'custom');
  assert.ok(cYoung);
  const planYoung = buildPlan([cYoung], 'recycle');
  assert.equal(planYoung.targets.length, 0, 'genc artikta 0 hedef olmali');
});