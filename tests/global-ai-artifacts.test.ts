import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { probeDir } from '../src/core/classifier.ts';
import { classifyPath, detectArchetype } from '../src/core/analyze.ts';

/**
 * T30 — global AI model artiklari (model-store kaniti).
 *
 * Kullanici karari: yalnizca MODEL-STORE kaniti; log klasorleri report-only
 * kalir (genel log adi silme kaniti degildir, kural 13).
 *
 * Kok seviyesinde model deposu KOMBINASYON kanitidir:
 *   - en az bir model agirligi (.onnx / .gguf / .safetensors /
 *     pytorch_model.bin / model.bin; GENEL data.bin SAYILMAZ)
 *   - VE en az bir manifest (config.json / tokenizer.json /
 *     tokenizer_config.json / genai_config.json)
 * Tek basina agirlik da tek basina manifest da kanit degildir (kural 13).
 *
 * Karar her zaman report-only'dir: model-store varsayilan olarak silme
 * hedefi URETMEZ; yalnizca `allow.models` (--nuke-models) ile hedef olur ve
 * o zaman da yuksek risk + yazili onay (ask) korunur.
 */

let root = '';

before(async () => {
  // Kurallar: %TEMP% altina yerlestirilmez (temp-scratch karisir);
  // gitignore'lu scratch klasorunde.
  root = await mkdtemp(join(process.cwd(), 'scratch', 't30-fixtures-'));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function fixture(name: string, files: Array<[string, string]>, dirs: string[] = []): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  for (const d of dirs) await mkdir(join(dir, d), { recursive: true });
  for (const [f, c] of files) await writeFile(join(dir, f), c, 'utf8');
  return dir;
}

// --- 1: kok model.gguf + config.json → model-store, hedef YOK ---------------

test('T30: kok model.gguf + config.json → model-store, hedef YOK, recommend DEGIL', async () => {
  const dir = await fixture('t30-gguf-config', [
    ['model.gguf', 'x'],
    ['config.json', '{}'],
  ]);
  const p = await probeDir(dir);
  assert.equal(p.modelStore, true, 'kombasyon kaniti uretilmeli');

  const ev = { fileKinds: p.fileKinds, markers: p.markers, logSignals: p.logSignals };
  const a = detectArchetype(ev, dir, new Map(), p);
  assert.equal(a, 'model-store', 'kok agirlik+manifest model deposu sayilmali');

  const c = await classifyPath(dir, 'custom');
  assert.ok(c, 'kume uretilmeli');
  assert.equal(c.archetype, 'model-store');
  assert.equal((c.deleteTargets ?? []).length, 0, 'varsayilan hedef YOK (report-only)');
  assert.notEqual(c.verdict.kind, 'recommend', 'varsayilan karari recommend olmamali');
});

// --- 2: kok model.safetensors + tokenizer.json → model-store ----------------

test('T30: kok model.safetensors + tokenizer.json → model-store, hedef YOK', async () => {
  const dir = await fixture('t30-safetensors-tok', [
    ['model.safetensors', 'x'],
    ['tokenizer.json', 'x'],
  ]);
  const p = await probeDir(dir);
  assert.equal(p.modelStore, true);
  const c = await classifyPath(dir, 'custom');
  assert.equal(c?.archetype, 'model-store');
  assert.equal((c?.deleteTargets ?? []).length, 0);
});

// --- 3: kok pytorch_model.bin + config.json → model-store -------------------

test('T30: kok pytorch_model.bin + config.json → model-store', async () => {
  const dir = await fixture('t30-pytorch-bin', [
    ['pytorch_model.bin', 'x'],
    ['config.json', '{}'],
  ]);
  const p = await probeDir(dir);
  assert.equal(p.modelStore, true, 'pytorch_model.bin agirlik olarak sayilmali');
  const c = await classifyPath(dir, 'custom');
  assert.equal(c?.archetype, 'model-store');
});

// --- 4: agirlik TEK BASINA (manifest yok) → model-store DEGIL ---------------

test('T30: kok model.gguf tek basina → model-store DEGIL (kombasyon şart)', async () => {
  const dir = await fixture('t30-gguf-alone', [['model.gguf', 'x']]);
  const p = await probeDir(dir);
  assert.notEqual(p.modelStore, true, 'tek agirlik kanit degil');
  const ev = { fileKinds: p.fileKinds, markers: p.markers, logSignals: p.logSignals };
  const a = detectArchetype(ev, dir, new Map(), p);
  assert.notEqual(a, 'model-store');
});

// --- 5: manifest TEK BASINA → model-store DEGIL ------------------------------

test('T30: kok config.json tek basina → model-store DEGIL', async () => {
  const dir = await fixture('t30-config-alone', [['config.json', '{}']]);
  const p = await probeDir(dir);
  assert.notEqual(p.modelStore, true, 'tek manifest kanit degil');
  const ev = { fileKinds: p.fileKinds, markers: p.markers, logSignals: p.logSignals };
  const a = detectArchetype(ev, dir, new Map(), p);
  assert.notEqual(a, 'model-store');
});

// --- 6: models/model.gguf → model-store (regresyon) ---------------------------

test('T30: models/model.gguf → model-store (regresyon), hedef YOK', async () => {
  const dir = await fixture('t30-models-sub', [['models/model.gguf', 'x']], ['models']);
  const p = await probeDir(dir);
  assert.ok(p.markers.includes('models'), 'models/ icerik kanitiyla isaretlenmeli');
  const c = await classifyPath(dir, 'custom');
  assert.equal(c?.archetype, 'model-store');
  assert.equal((c?.deleteTargets ?? []).length, 0);
});

// --- 7: genel data.bin SAYILMAZ ----------------------------------------------

test('T30: kok data.bin + config.json → model-store DEGIL (genel .bin)', async () => {
  const dir = await fixture('t30-data-bin', [
    ['data.bin', 'x'],
    ['config.json', '{}'],
  ]);
  const p = await probeDir(dir);
  assert.notEqual(p.modelStore, true, 'genel data.bin agirlik sayilmamali');
  const c = await classifyPath(dir, 'custom');
  assert.notEqual(c?.archetype, 'model-store');
});

// --- 8: proje korumasi model kanitini ezer ------------------------------------

test('T30: package.json + node_modules + model.gguf + config.json → project-workspace', async () => {
  const dir = await fixture(
    't30-project',
    [
      ['package.json', '{"name":"proje","version":"1.0.0"}'],
      ['node_modules/.keep', ''],
      ['model.gguf', 'x'],
      ['config.json', '{}'],
    ],
    ['node_modules'],
  );
  const c = await classifyPath(dir, 'custom');
  assert.equal(c?.archetype, 'project-workspace', 'proje korumasi ONCE gelir; model-store degil');
  assert.equal((c?.deleteTargets ?? []).length, 0);
});

// --- 9: --nuke-models ile hedef uretilir; bayraksiz 0 --------------------------

test('T30: allow.models ile hedef uretilir; allow yokken 0', async () => {
  const dir = await fixture('t30-nuke', [
    ['model.gguf', 'x'],
    ['config.json', '{}'],
  ]);
  const plain = await classifyPath(dir, 'custom');
  assert.equal((plain?.deleteTargets ?? []).length, 0, 'bayraksiz hedef YOK');

  const allowed = await classifyPath(dir, 'custom', { allow: { models: true } });
  assert.ok(allowed, 'kume uretilmeli');
  assert.ok((allowed.deleteTargets ?? []).length > 0, '--nuke-models ile hedef uretilmeli');
  assert.equal(allowed.verdict.kind, 'ask', 'yuksek riskli karari yazili onay ister');
  assert.equal(allowed.verdict.risk, 'high');
});

// --- 10: log klasoru T30 kapsam disi; unknown kalir -----------------------------

test('T30: yalniz logs/app.log → unknown (log kapsami disi; regresyon)', async () => {
  const dir = await fixture('t30-logs-only', [['logs/app.log', 'hebelehube']], ['logs']);
  const p = await probeDir(dir);
  assert.notEqual(p.modelStore, true);
  const c = await classifyPath(dir, 'custom');
  assert.equal(c?.archetype, 'unknown', 'log adi tek basina kanit degildir; klasor unknown kalmali');
  assert.equal((c?.deleteTargets ?? []).length, 0);
});
