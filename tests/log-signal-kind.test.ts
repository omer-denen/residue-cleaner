import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { probeDir, signalKind } from '../src/core/classifier.ts';
import { detectArchetype, dedupeLogSignals, logGpuVerdict } from '../src/core/analyze.ts';
import type { Evidence, LogSignal } from '../src/core/types.ts';

/**
 * E11 — log kanitina STABIL kimlik (`kind`).
 *
 * Problemler:
 * - `logGpuVerdict` karari `means` metnine bagli regex ile veriyordu:
 *   gosterim metninde tek kelime degisse karar sessizce degisiyordu.
 * - `dedupeLogSignals` anahtari da means dizesi idi; ayni karar kimigi
 *   tasiyan iki farkli metin iki kanit gibi gorunuyordu.
 *
 * Cozum: karar `kind`e baglanir; `kind` yoksa `signalKind()` kanonik
 * means metninden esler (geriye donuk uyumluluk). `means` yalniz
 * gosterim/kanit aciklamasi icin kalir.
 *
 * Fixture kokleri `%TEMP%` altinda DEGIL — deponun gitignore'lu
 * `scratch/` klasoru kullanilir.
 */

let root = '';

before(async () => {
  root = await mkdtemp(join(process.cwd(), 'scratch', 'e11-fixtures-'));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

function ev(over: Partial<Evidence> = {}): Evidence {
  return { fileKinds: [], markers: [], logSignals: [], ...over };
}

async function file(path: string, content: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf8');
}

// --- E11-A: kind doluysa means metni degistikce karar degismez -------------

test('E11-A: ayni kind farkli means ile logGpuVerdict ayni sonucu uretir', () => {
  const build = (means: string): LogSignal => ({
    line: 'Device: CPU, EPs: CUDAExecutionProvider',
    means,
    kind: 'gpu-provider',
  });
  const canonical = logGpuVerdict([build('GPU saglayicisi kullanildi')]);
  const renamed = logGpuVerdict([build('TAMAMEN FARKLI gosterim metni')]);
  assert.deepEqual(renamed, canonical);
  assert.equal(renamed.gpuUsed, true);
  assert.equal(renamed.cpuOnly, false, 'olumlu sinyal CPU satiri vetolar');
});

test('E11-A: ayni kind farkli means ile model birdir (model-catalog)', () => {
  const kindli = (means: string): LogSignal => ({ line: 'foundry catalog hit', means, kind: 'model-catalog' });
  const a = detectArchetype(
    ev({ logSignals: [kindli('Azure AI Foundry model katalogu')] }),
    join(root, 'ml-a'),
    new Map(),
  );
  const b = detectArchetype(
    ev({ logSignals: [kindli('Gosterim metni komple degistirildi')] }),
    join(root, 'ml-b'),
    new Map(),
  );
  assert.equal(a, 'model-store');
  assert.equal(b, 'model-store');
});

// --- E11-C: npm/nuget dali means metnine bakmadan calisir -------------------

test('E11-C: kind npm-cache pkg-manager-cache uretir (means onemsiz)', () => {
  const dir = join(root, 'npmapp');
  const a = detectArchetype(
    ev({ logSignals: [{ line: 'npm ci basladi', means: 'Gosterim degisti', kind: 'npm-cache' }] }),
    dir,
    new Map(),
  );
  assert.equal(a, 'pkg-manager-cache');
});

test('E11-C: kind nuget-cache pkg-manager-cache uretir (means onemsiz)', () => {
  const dir = join(root, 'nugetapp');
  const a = detectArchetype(
    ev({ logSignals: [{ line: 'nuget.org vuran paket', means: 'Gosterim degisti', kind: 'nuget-cache' }] }),
    dir,
    new Map(),
  );
  assert.equal(a, 'pkg-manager-cache');
});

// --- E11-D: kind notebook tek basina runtime-pool yapmaz (C1 regresyonu) ---

test('E11-D: kind notebook tek basina runtime-pool yapmaz', () => {
  const a = detectArchetype(
    ev({
      logSignals: [{ line: 'INFO Notebook kernel started', means: 'Gosterim degisti', kind: 'notebook' }],
    }),
    join(root, 'logonly'),
    new Map(),
  );
  assert.notEqual(a, 'runtime-pool');
  assert.equal(a, 'unknown', 'yapisal kanit yoksa bilinmez kalir');
});

// --- E11-E/F: dedupeLogSignals kind anahtari --------------------------------

test('E11-E: ayni kind tekillestirilir, farkli kind korunur', () => {
  const d = dedupeLogSignals([
    { line: 'a', means: 'GPU saglayicisi kullanildi', kind: 'gpu-provider' },
    { line: 'b', means: 'FARKLI GOSTERIM', kind: 'gpu-provider' },
    { line: 'c', means: 'npm paket onbellegi', kind: 'npm-cache' },
  ]);
  assert.equal(d.length, 2);
  assert.equal(d[0]?.kind, 'gpu-provider');
  assert.equal(d[1]?.kind, 'npm-cache');
});

test('E11-F: kind yoksa eski sinyaller means anahtariyla tekillestirilir', () => {
  const legacy = [
    { line: 'a', means: 'X' },
    { line: 'b', means: 'X' },
    { line: 'c', means: 'Y' },
  ] as LogSignal[];
  const d = dedupeLogSignals(legacy);
  assert.equal(d.length, 2);
  assert.equal(d[0]?.means, 'X');
  assert.equal(d[1]?.means, 'Y');
});

// --- E11-G/H: geriye donuk uyumluluk (kind'siz eski sinyaller) ---------------

test('E11-G: signalKind kind yoksa kanonik means metninden esler', () => {
  // Kanonik means metinleri LOG_MARKERS ile 1:1 eslesir:
  assert.equal(signalKind({ line: '', means: 'GPU saglayicisi kullanildi' }), 'gpu-provider');
  assert.equal(signalKind({ line: '', means: 'npm paket onbellegi' }), 'npm-cache');
  assert.equal(signalKind({ line: '', means: 'cihaz tipi: CPU (GPU kullanilmiyor)' }), 'cpu-device');
  assert.equal(signalKind({ line: '', means: 'ONNX Runtime model calistirma' }), 'onnx-runtime');
  assert.equal(signalKind({ line: '', means: 'Azure AI Foundry model katalogu' }), 'model-catalog');
  // kind doluysa kesin kazanir:
  assert.equal(signalKind({ line: '', means: 'GPU saglayicisi kullanildi', kind: 'npm-cache' }), 'npm-cache');
  // Kanonik olmayan means bilinmez olur ("kanit yok"):
  assert.equal(signalKind({ line: '', means: 'Device: CPU' }), undefined);
});

test('E11-H: kindless eski GPU sinyali ilk davranis gibi calisir (C5)', () => {
  const legacy = logGpuVerdict([
    { line: 'Device: CPU, EPs: CPUExecutionProvider', means: 'cihaz tipi: CPU (GPU kullanilmiyor)' },
    { line: 'Applied CUDAExecutionProvider', means: 'GPU saglayicisi kullanildi' },
  ]);
  assert.deepEqual(legacy, { gpuUsed: true, cpuLine: true, cpuOnly: false });

  const cpuOnly = logGpuVerdict([
    { line: 'Device: CPU, EPs: CPUExecutionProvider', means: 'cihaz tipi: CPU (GPU kullanilmiyor)' },
  ]);
  assert.deepEqual(cpuOnly, { gpuUsed: false, cpuLine: true, cpuOnly: true });
});

test('E11-H: kindless eski npm means ilk davranis gibi pkg-manager-cache', () => {
  const a = detectArchetype(
    ev({ logSignals: [{ line: 'npm ci basladi', means: 'npm paket onbellegi' }] }),
    join(root, 'npmapp-legacy'),
    new Map(),
  );
  assert.equal(a, 'pkg-manager-cache');
});

// --- E11-I: classifier urettigi her sinyal kind tasir -----------------------

test('E11-I: probeDir urettigi sinyallerde kind HER ZAMAN dolu', async () => {
  const dir = join(root, 'signal-factory');
  await file(join(dir, 'logs', 'app.log'), 'Device: CPU,EPs: CPUExecutionProvider\nCUDAExecutionProvider aktif\nnpm-cache\\_cacache gorundu\n');
  const p = await probeDir(dir);
  assert.ok(p.logSignals.length > 0, 'log sinyal uretilmeli');
  for (const s of p.logSignals) {
    assert.ok(s.kind, `kind dolu olmali: ${s.means}`);
    assert.ok(typeof s.means === 'string' && s.means.length > 0);
  }
  assert.ok(p.logSignals.some((s) => s.kind === 'gpu-provider'));
  assert.ok(p.logSignals.some((s) => s.kind === 'npm-cache'));
});
