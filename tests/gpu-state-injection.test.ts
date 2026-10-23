import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  classifyPath,
  detectSubParts,
  estimateReclaimable,
  interpretGpuEvidence,
  MeasureCache,
} from '../src/core/analyze.ts';
import type { Evidence } from '../src/core/types.ts';
import type { GpuEvidence } from '../src/core/analyze.ts';

/**
 * E10c — GPU globali kapali, enjeksiyon acik.
 *
 * 1. `ClassifyOptions.gpu` ile CUDA alt parcasi davranisi DEGISir:
 *    yok kaniti → alt parca `recommend`; var kaniti → parca uretilmez.
 * 2. `gpu: null` → "bilinmiyor": GPU YOK SAYILMAZ (eski davranis korunur).
 * 3. Ardisik classifyPath cagrilari GPU durumunu birbirine tasmaz
 *    (eski `GPU_STATE` globalinin durum sizinti bug'u).
 * 4. `setGpuState` / `GPU_STATE` src/ icinde HIC gecmiyor.
 * 5. `interpretGpuEvidence` UCLU durum: erisim hatasi → null,
 *    tum adaylar ENOENT → `{ hasNvidia:false }`, kanit → `{ hasNvidia:true }`.
 * 6. `estimateReclaimable` gpu parametresi eski cagrilari bozmaz.
 *
 * Fixture kokleri %TEMP% ALTINDA DEGIL — deponun gitignore'lu
 * `scratch/` klasoru kullanilir (gorev kurali).
 */

let fixtureRoot = '';

before(async () => {
  fixtureRoot = await mkdtemp(join(process.cwd(), 'scratch', 'e10c-gpu-inject-'));
});

after(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

/** CUDA fixture'i: base/ep/cuda-ep/cudnn64_8.dll */
async function buildCudaFixture(base: string): Promise<void> {
  await mkdir(join(base, 'ep', 'cuda-ep'), { recursive: true });
  await writeFile(join(base, 'ep', 'cuda-ep', 'cudnn64_8.dll'), Buffer.alloc(512, 1));
}

const GPU_ABSENT: NonNullable<GpuEvidence> = { hasNvidia: false, note: 'fixture: surucu yok' };
const GPU_PRESENT: NonNullable<GpuEvidence> = { hasNvidia: true, note: 'fixture: nvcuda bulundu' };

const emptyEvidence: Evidence = { fileKinds: [], markers: [] };

const cpuEvidence: Evidence = {
  fileKinds: [],
  markers: [],
  logSignals: [{ line: 'Device: CPU,EPs: CPUExecutionProvider', means: 'Device: CPU' }],
};

const isCudaSubPart = (label: string): boolean => /GPU hizlandirici runtime/i.test(label);

// --- 1. Enjeksiyon davranisi: ayni fixture, farkli gpu kaniti ---------------

test('E10c: gpu yok kaniti CUDA alt parcasini recommend yapar; gpu var kaniti parca uretmez', async () => {
  const base = join(fixtureRoot, 'e2e-1');
  await buildCudaFixture(base);

  const absent = await classifyPath(base, 'custom', { gpu: GPU_ABSENT });
  assert.ok(absent, 'kume uretilmeli (accelerator-runtime)');
  assert.equal(absent.archetype, 'accelerator-runtime');
  const cudaPart = absent.subparts?.find((s) => isCudaSubPart(s.label));
  assert.ok(cudaPart, 'cuda alt parcasi bulunmali');
  assert.equal(cudaPart!.verdictKind, 'recommend', 'gpu yok kaniti ile parca bicilir: recommend');
  assert.ok(
    cudaPart!.reason.includes('NVIDIA CUDA surucusu yok'),
    'gerekce gpu kanitindan geliyor',
  );
  assert.equal(absent.verdict.kind, 'recommend', 'GPU yok: kullanilamayan runtime onerilir');
  assert.ok((absent.deleteTargets ?? []).length > 0, 'silme hedefi uretilir');

  const present = await classifyPath(base, 'custom', { gpu: GPU_PRESENT });
  assert.ok(present, 'kume uretilmeli');
  assert.equal((present.subparts ?? []).length, 0, 'GPU var kanitinda olumlu alt parca uretilmez');
  assert.equal(present.verdict.kind, 'ask', 'GPU var: yalnizca kullaniciya sorulur, onerilmez');
  assert.ok(!(present.deleteTargets ?? []).some((t) => /cuda-ep/i.test(t.path)),
    'GPU varken cuda alt klasoru hedef alinmaz');
});

// --- 2. gpu null: "bilinmiyor" yani GPU YOK SAYILMAZ ------------------------

test('E10c: gpu null → GPU yok sayilmaz; cuda kaniti tek basina parca uretmez', async () => {
  const base = join(fixtureRoot, 'cuda-only');
  await buildCudaFixture(base);
  const measure = new MeasureCache();

  const unknown = await detectSubParts(base, emptyEvidence, Date.now(), measure, { gpu: null });
  assert.equal(unknown.length, 0, 'gpu null (bilinmiyor) gpuAbsent sayilamaz');

  const noParam = await detectSubParts(base, emptyEvidence, Date.now(), new MeasureCache());
  assert.equal(noParam.length, 0, 'paramsiz cagri da bilinmiyor davranisi korur');

  const absent = await detectSubParts(base, emptyEvidence, Date.now(), new MeasureCache(), {
    gpu: GPU_ABSENT,
  });
  assert.equal(absent.length, 1, 'kontrol: yalnizca yok kaniti parca uretir');

  const cpuLog = await detectSubParts(base, cpuEvidence, Date.now(), new MeasureCache(), { gpu: null });
  assert.equal(
    cpuLog.length,
    1,
    'Device: CPU kanitli durumda (cpuOnly) gpu null olsa da parca uretilir (eski davranis)',
  );
});

// --- 3. Global sizinti: ardisik cagilar birbirini etkilemez ---------------

test('E10c: ardisik classifyPath cagrilari gpu durumunu tasmaz (global sizinti yok)', async () => {
  const base = join(fixtureRoot, 'e2e-3');
  await buildCudaFixture(base);

  const out: boolean[] = [];
  for (const gpu of [GPU_ABSENT, GPU_PRESENT, GPU_ABSENT, GPU_PRESENT]) {
    const c = await classifyPath(base, 'custom', { gpu });
    out.push((c?.subparts ?? []).some((s) => isCudaSubPart(s.label)));
  }
  assert.deepEqual(
    out,
    [true, false, true, false],
    'siradaki cagri kendinden once olandan durum almamali (global sizinti yok)',
  );
});

// --- 4. Derleme duzeyi: src/ icinde global kalmadi ---------------------------

test('E10c: setGpuState / GPU_STATE src/ icinde hic gecmiyor (derleme)', async () => {
  const offenders: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(p);
      } else if (/\.tsx?$/.test(entry.name)) {
        const text = await readFile(p, 'utf8');
        if (/GPU_STATE|setGpuState/.test(text)) offenders.push(p);
      }
    }
  };
  await walk(join(import.meta.dirname, '..', 'src'));

  assert.deepEqual(offenders, [], 'modul-duzeyi GPU globali src/ icinde kalmamali');
});

// --- 5. detectGpu UCLU durum: saf karar yardimcisi ---------------------------

test('E10c: interpretGpuEvidence tum adaylar ENOENT → {hasNvidia:false}, notta "yok"', () => {
  const all = interpretGpuEvidence([
    { where: '%SystemRoot%\\System32', outcome: 'missing' },
    { where: '%SystemRoot%\\SysWOW64', outcome: 'missing' },
  ]);
  assert.ok(all);
  assert.equal(all.hasNvidia, false);
  assert.match(all.note, /yok/);
  // Dosya-yok senaryosu "bilinmiyor" ile karismamali (E10d siniri).
  assert.doesNotMatch(all.note, /erisim engellendi/);
});

test('E10c: erisim engellendi (EACCES/EPERM) → null; "yok" hukmu verilmez', () => {
  const mixed = interpretGpuEvidence([
    { where: '%SystemRoot%\\System32', outcome: 'missing' },
    { where: '%SystemRoot%\\SysWOW64', outcome: 'denied', code: 'EACCES' },
  ]);
  assert.equal(mixed, null, 'kanit toplanamadi; "GPU bulunamadi" hukmu verilemez');

  const allDenied = interpretGpuEvidence([
    { where: '%SystemRoot%\\System32', outcome: 'denied', code: 'EPERM' },
  ]);
  assert.equal(allDenied, null);
});

test('E10c: nvcuda bulundu → {hasNvidia:true}; olumlu kanit uzere karar verir', () => {
  const withHit = interpretGpuEvidence([
    { where: '%SystemRoot%\\SysWOW64', outcome: 'denied', code: 'EACCES' },
    { where: '%SystemRoot%\\System32', outcome: 'found' },
  ]);
  assert.ok(withHit);
  assert.equal(withHit.hasNvidia, true);
  assert.match(withHit.note, /bulundu/);
  assert.match(withHit.note, /System32/);
});

// --- 6. estimateReclaimable: opsiyonel gpu parametresi geriye uyumlu ---------

test('E10c: estimateReclaimable accelerator-runtime gpu kanitina duyarli, paramsiz cagrilar eski gibi', () => {
  const ext = new Map<string, number>();
  // Bilinmiyor (gpu olmayabilir/undefined): eski davranis — 0.
  assert.equal(estimateReclaimable('accelerator-runtime', 1000, ext), 0);
  assert.equal(estimateReclaimable('accelerator-runtime', 1000, ext, undefined, null), 0);
  // GPU VAR: kullanici karari — 0.
  assert.equal(estimateReclaimable('accelerator-runtime', 1000, ext, undefined, GPU_PRESENT), 0);
  // GPU YOK: tamami artik — 1000.
  assert.equal(estimateReclaimable('accelerator-runtime', 1000, ext, undefined, GPU_ABSENT), 1000);
});
