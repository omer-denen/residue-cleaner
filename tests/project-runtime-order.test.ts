import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { classifyPath } from '../src/core/analyze.ts';
import { probeDir } from '../src/core/classifier.ts';

/**
 * C8b — tanı sıralaması: `runtime-pool` PROJE korumasından önce gelmesin.
 *
 * C8 ile `venv`/`.venv` (fileKind `venv`) ve `pyvenv.cfg` (fileKind
 * `python-env`) kanıtları üretilmeye başlandı. Adım 4b bu türleri proje
 * kontrolünden (4e) önce `runtime-pool` yapıyordu; adım 4e'deki proje
 * koruması sıra nedeniyle hiç çalışmıyordu. Sonuç: kökünde `package.json`
 * + `.venv` olan gerçek bir proje "ortam havuzu" etiketi alıyordu —
 * model-store için step 2'de düzeltilen aynı sınıf hata.
 *
 * Düzeltme: `probe?.projectManifest` varken yalnızca ZAYIF havuz
 * kanıtları (python-env / venv / site-packages) tek başına runtime-pool
 * yapamaz; karar 4e'ye kalır. GÜÇLÜ havuz kanıtı (`envs`/`runtimed`)
 * manifest olsa bile havuz sayılmaya devam eder.
 *
 * Her test `classifyPath` ile GERÇEK sınıflandırma yapar (`probeDir`
 * yalnızca kanıt toplayıcıdır; karar katmanı burada sınanır).
 */

let root = '';

before(async () => {
  // DİKKAT: %TEMP% altında kurulmaz — her yol "temp-scratch" olur ve
  // sınıflandırma anlamsızlaşır. Deponun gitignore'lu `scratch/` klasörü
  // kullanılır (görev kuralı).
  root = await mkdtemp(join(process.cwd(), 'scratch', 'c8b-fixtures-'));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function file(path: string, content = ''): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf8');
}

/**
 * `classifyPath` boş klasörü atlar (files === 0 → null döner);
 * venv dizinine en az bir gerçek dosya koy.
 */
async function venvDir(dir: string, name: 'venv' | '.venv'): Promise<void> {
  await file(join(dir, name, 'Scripts', 'activate.bat'), '@echo off\n');
}

// --- 1-4: manifest + zayif havuz kanidi -> PROJE ---------------------------

test('C8b: package.json + venv/ projesi runtime-pool DEĞİL, project-workspace', async () => {
  const d = join(root, 'c8b-node-venv');
  await file(join(d, 'package.json'), '{"name":"orn","version":"1.0.0"}\n');
  await venvDir(d, 'venv');
  const p = await probeDir(d);
  assert.ok(p.projectManifest, 'manifest kanıtı toplanmalı');
  assert.ok(p.fileKinds.includes('venv'), 'venv kanıtı toplanmalı');
  const c = await classifyPath(d, 'custom');
  assert.ok(c, 'küme üretilmeli');
  assert.equal(c.archetype, 'project-workspace');
  // report-only: proje korunmaya devam eder, silme hedefi YOK
  assert.equal(c.verdict.kind, 'report-only');
  assert.equal((c.deleteTargets ?? []).length, 0);
});

test('C8b: package.json + .venv/ projesi project-workspace', async () => {
  const d = join(root, 'c8b-node-dotvenv');
  await file(join(d, 'package.json'), '{"name":"orn","version":"1.0.0"}\n');
  await venvDir(d, '.venv');
  const c = await classifyPath(d, 'custom');
  assert.ok(c, 'küme üretilmeli');
  assert.equal(c.archetype, 'project-workspace');
  assert.equal(c.verdict.kind, 'report-only');
  assert.equal((c.deleteTargets ?? []).length, 0);
});

test('C8b: package.json + pyvenv.cfg (python-env) projesi project-workspace', async () => {
  const d = join(root, 'c8b-node-pyvenvcfg');
  await file(join(d, 'package.json'), '{"name":"orn","version":"1.0.0"}\n');
  await file(join(d, 'pyvenv.cfg'), 'home = C:\\Python312\n');
  const c = await classifyPath(d, 'custom');
  assert.ok(c, 'küme üretilmeli');
  assert.equal(c.archetype, 'project-workspace');
  assert.equal((c.deleteTargets ?? []).length, 0);
});

test('C8b: package.json + site-packages/ projesi project-workspace', async () => {
  const d = join(root, 'c8b-node-sitepkg');
  await file(join(d, 'package.json'), '{"name":"orn","version":"1.0.0"}\n');
  await mkdir(join(d, 'site-packages'), { recursive: true });
  await file(join(d, 'site-packages', 'pip', '__init__.py'), '');
  const c = await classifyPath(d, 'custom');
  assert.ok(c, 'küme üretilmeli');
  assert.equal(c.archetype, 'project-workspace');
  assert.equal((c.deleteTargets ?? []).length, 0);
});

// --- 5: manifest yokken eski davranis korunur -------------------------------

test('C8b: manifest yokken venv/ TEK BAŞINA runtime-pool (regresyon)', async () => {
  const d = join(root, 'c8b-bare-venv');
  await venvDir(d, 'venv');
  const p = await probeDir(d);
  assert.ok(!p.projectManifest, 'manifest olmamalı');
  const c = await classifyPath(d, 'custom');
  assert.ok(c, 'küme üretilmeli');
  assert.equal(c.archetype, 'runtime-pool');
});

// --- 6: guclu havuz kaniti manifestten once gelir ---------------------------

test('C8b: envs/ + package.json GÜÇLÜ havuz kanıtı olarak runtime-pool kalır', async () => {
  const d = join(root, 'c8b-envs-pool');
  await file(join(d, 'package.json'), '{"name":"orn","version":"1.0.0"}\n');
  await mkdir(join(d, 'envs'), { recursive: true });
  await file(join(d, 'envs', 'py312', 'python312._pth'), 'python312.zip\n');
  const c = await classifyPath(d, 'custom');
  assert.ok(c, 'küme üretilmeli');
  assert.equal(c.archetype, 'runtime-pool');
});

// --- 7: ajan calisma alani sirasi degisir (3b < 4b) --------------------------

test('C8b: skills/SKILL.md + venv/ ajan çalışma alanı olarak kalır (3b regresyonu)', async () => {
  const d = join(root, 'c8b-agent-venv');
  await file(join(d, 'skills', 'demo', 'SKILL.md'), '# demo beceri\n');
  await venvDir(d, 'venv');
  const c = await classifyPath(d, 'custom');
  assert.ok(c, 'küme üretilmeli');
  assert.equal(c.archetype, 'agent-workspace');
  // ajan çalışma alanı hiçbir koşulda silme hedefi üretmez
  assert.equal((c.deleteTargets ?? []).length, 0);
});
