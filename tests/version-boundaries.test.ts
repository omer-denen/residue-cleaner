import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  detectAppVersionOrphans,
  detectSubParts,
  findDirsContaining,
  findDirsNamed,
  MeasureCache,
  classifyPath,
  type SubPart,
} from '../src/core/analyze.ts';
import type { Evidence } from '../src/core/types.ts';
import { scanNodeRuntimes } from '../src/core/node-runtimes.ts';

/**
 * E6 — tarama sinirlari ve surum karsilastirma sinirlari.
 *
 * 1. E6a: `findDirsNamed` / `findDirsContaining` sinira carptiginda
 *    `truncated: true` doner; yarim kanit "kanit tam" sayilmaz ve
 *    alt parca `recommend` olarak URETILMEZ.
 * 2. E6b: on surum duyarli karsilastirma (`app-1.2.4-beta`
 *    < `app-1.2.4`), `semver.ts` tek kaynak.
 * 3. E6c: guncel surumun ek kaniti (Update.exe surumu) yoksa eski
 *    surumler report-only; silme hedefi uretilmez.
 *
 * Fixture kokler `%TEMP%` altinda DEGIL — deponun gitignore'lu
 * `scratch/` klasoru kullanilir (gorev kurali).
 */

let root = '';

before(async () => {
  root = await mkdtemp(join(process.cwd(), 'scratch', 'e6-fixtures-'));
  // E10c: GPU artik global degil, parametredir. Bu dosyadaki alt parca
  // testleri `Device: CPU` kanitini dogrudan tasidigindan (cpuOnly)
  // burada GPU kurulumuna gerek kalmadi; setGpuState cagrisi kaldirildi.
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function dir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function file(path: string, bytes = 64): Promise<void> {
  await dir(join(path, '..'));
  await writeFile(path, Buffer.alloc(bytes, 1), 'utf8');
}

/** Electron kurulum kaniti: her app-<surum> klasorune marker koy. */
async function electronDir(path: string): Promise<void> {
  await dir(path);
  await file(join(path, 'icudtl.dat'), 128);
}

// --- E6a: sinir gorunurlugu -------------------------------------------------

test('E6a: findDirsNamed siniri asarsa truncated=true ve yarim liste doner', async () => {
  const base = join(root, 'tr-named');
  // Dikkat: findDirsNamed, eslesen dizini kendi ziyareti yerine
  // PARENT ziyareti sirasinda bulur; eslesenler ikinci seviyede.
  await dir(join(base, 'g1', 'alpha-gpu-2'));
  await dir(join(base, 'g2', 'beta-gpu-3'));
  await dir(join(base, 'g3', 'gamma-gpu-4'));

  const ok = await findDirsNamed(base, 3, /gpu|cuda/i, 100);
  assert.equal(ok.truncated, false, 'sirada hedef yeterli');
  assert.equal(ok.dirs.length, 3);

  const limited = await findDirsNamed(base, 3, /gpu|cuda/i, 2);
  assert.equal(limited.truncated, true, 'maxDirs=2 ile tarama yarim kalir');
  // Sinira carpmadan once bulunanlar kaybolmaz.
  assert.ok(limited.dirs.length >= 1);
  assert.ok(limited.dirs.length < 3, 'yarim liste dolu liste degil');
});

test('E6a: findDirsContaining siniri asarsa truncated=true doner', async () => {
  const base = join(root, 'tr-containing');
  await dir(join(base, 'one-gpu'));
  await dir(join(base, 'two-gpu'));
  await dir(join(base, 'three-gpu'));
  const dll = 'cudnn64_8.dll';
  await file(join(base, 'one-gpu', dll));
  await file(join(base, 'two-gpu', dll));
  await file(join(base, 'three-gpu', dll));

  const ok = await findDirsContaining(base, 2, (n) => n === dll, 100);
  assert.equal(ok.truncated, false);
  assert.equal(ok.dirs.length, 3);

  const limited = await findDirsContaining(base, 2, (n) => n === dll, 2);
  assert.equal(limited.truncated, true, 'maxDirs=2 ile tarama yarim kalir');
  assert.ok(limited.dirs.length >= 1);
  assert.ok(limited.dirs.length < 3);
});

const cpuEvidence: Evidence = {
  fileKinds: [],
  markers: [],
  logSignals: [{ line: 'Device: CPU,EPs: CPUExecutionProvider', means: 'Device: CPU' }],
};

test('E6a: tarama sinirina takilan alt parca recommend URETILMEZ (guvenli taraf)', async () => {
  const base = join(root, 'sub-truncated');
  // Alfabetik gidiyor: root(0) -> a-sub(1) -> a-gpu-9(2) eslesen;
  // model agirligi 9 MB, isaretli varyant esigi (8 MB) astigi icin
  // parca uretilir.
  await dir(join(base, 'a-sub', 'a-gpu-9'));
  await dir(join(base, 'z-tanimlanamayan'));
  // 9 MB tek dosya; model.onnx adi looksLikeModelDir kanitidir.
  await writeFile(join(base, 'a-sub', 'a-gpu-9', 'model.onnx'), Buffer.alloc(9 * 1024 * 1024, 0));

  const measure = new MeasureCache();
  const truncated = await detectSubParts(base, cpuEvidence, Date.now(), measure, { maxDirs: 2 });
  assert.equal(truncated.length >= 1, true, 'sinirli tarama da varyant bulunmali');
  assert.ok(
    truncated.every((s) => s.verdictKind !== 'recommend'),
    'yarim kanitla silme onerisi uretilemez',
  );
  assert.ok(
    truncated.every((s) => s.reason.includes('Tarama sinirina ulasildi')),
    'gerekce eksiklik notu tasiyor',
  );

  // Tam taramada ayni yapi eskisi gibi onerilir (davranis regresyonu).
  const full = await detectSubParts(base, cpuEvidence, Date.now(), new MeasureCache(), { maxDirs: 1000 });
  const gpuPart = full.find((s) => s.path.endsWith('a-gpu-9'));
  assert.ok(gpuPart, 'tam taramada varyant bulunmali');
  assert.equal(gpuPart!.verdictKind, 'recommend');
});

// --- E6b: on surum duyarli surum karsilastirma -------------------------------

test('E6b: app-1.2.4-beta + app-1.2.4 -> stabil 1.2.4 guncel sayilir', async () => {
  const base = join(root, 'v-beta');
  await electronDir(join(base, 'app-1.2.4'));
  await electronDir(join(base, 'app-1.2.4-beta'));

  const r = await detectAppVersionOrphans(base, new MeasureCache(), {});
  assert.equal(r.keep, 'app-1.2.4', 'stabil surum, on surumsuz kardesten tarafa doner');
  assert.equal(r.keepBasis, 'highest-only');
  const beta = r.parts.find((p) => p.path.endsWith('app-1.2.4-beta'));
  assert.ok(beta, 'on surum klasoru parca olarak raporlanir');
  assert.ok(!r.parts.some((p) => p.path.endsWith('\\app-1.2.4')), 'stabil surum korunur');
});

test('E6b: app-1.2.3 + app-1.2.3-rc -> stabil korunur', async () => {
  const base = join(root, 'v-rc');
  await electronDir(join(base, 'app-1.2.3'));
  await electronDir(join(base, 'app-1.2.3-rc'));

  const r = await detectAppVersionOrphans(base, new MeasureCache(), {});
  assert.equal(r.keep, 'app-1.2.3');
  assert.ok(r.parts.some((p) => p.path.endsWith('app-1.2.3-rc')));
});

test('E6b: esit surumlerde sonuc deterministik (ayni girdi -> ayni guncel)', async () => {
  const mk = async (name: string): Promise<string> => {
    const base = join(root, name);
    await electronDir(join(base, 'app-1.2.3+b2'));
    await electronDir(join(base, 'app-1.2.3+a1'));
    return base;
  };
  const a = await detectAppVersionOrphans(await mk('v-eq-1'), new MeasureCache(), {});
  const b = await detectAppVersionOrphans(await mk('v-eq-2'), new MeasureCache(), {});
  assert.equal(a.keep, b.keep, 'ayni girdi farkli koklerde ayni sonucu uretmeli');
  assert.equal(a.keep, 'app-1.2.3+a1', 'isim kirilimi deterministik');});

// --- E6c: guncel surumun kaniti ---------------------------------------------

test('E6c: ek kanit yokken eski surum report-only (silme hedefi uretilmez)', async () => {
  const base = join(root, 'v-noevidence');
  await electronDir(join(base, 'app-1.2.4'));
  await electronDir(join(base, 'app-1.2.3'));

  const r = await detectAppVersionOrphans(base, new MeasureCache(), { updaterVersion: null });
  assert.equal(r.keepBasis, 'highest-only', 'Update.exe surumu okunamadi');
  assert.equal(r.keep, 'app-1.2.4');
  const old = r.parts.find((p) => p.path.endsWith('app-1.2.3'));
  assert.ok(old);
  assert.equal(old!.verdictKind, 'report-only', 'tek basina yukceklik silme kaniti degil');
});

test('E6c kayit: Update.exe surumu eslesirse eski surum recommend (mevcut davranis)', async () => {
  const base = join(root, 'v-regression');
  await electronDir(join(base, 'app-1.2.3'));
  await electronDir(join(base, 'app-1.2.4'));

  const r = await detectAppVersionOrphans(base, new MeasureCache(), { updaterVersion: '1.2.4' });
  assert.equal(r.keepBasis, 'updater-evidence');
  assert.equal(r.keep, 'app-1.2.4');
  const oldPart = r.parts.find((p) => p.path.endsWith('app-1.2.3'));
  assert.ok(oldPart);
  assert.equal(oldPart!.verdictKind, 'recommend', 'kanitli durumda eski davranis korunur');

  // Ek kanit "en yukcek" dizini degil, fiilen KULLANILANI gosterir:
  // yarim guncelleme dizini yukcek olsa bile kullanilmayan eski korunur.
  const half = join(root, 'v-halfupdate');
  await electronDir(join(half, 'app-1.2.4'));
  await electronDir(join(half, 'app-1.2.5-beta')); // yarim guncelleme
  const r2 = await detectAppVersionOrphans(half, new MeasureCache(), { updaterVersion: '1.2.4' });
  assert.equal(r2.keep, 'app-1.2.4', 'kanitli guncel surum korunur, yukcek yarim guncelleme degil');
  assert.equal(r2.keepBasis, 'updater-evidence');
  assert.ok(r2.parts.some((p) => p.path.endsWith('app-1.2.5-beta')));
});

test('E6c uc uca: classifyPath versioned-app-store icin silme hedefi uretmez (Update.exe kanitsiz)', async () => {
  const base = join(root, 'e2e-store');
  await electronDir(join(base, 'app-1.2.4'));
  await electronDir(join(base, 'app-1.2.3'));
  // Probe kapisini acar (gesdeger: exe gecerli degil, surum okunmaz).
  await file(join(base, 'Update.exe'), 256);

  const c = await classifyPath(base, 'custom');
  assert.ok(c, 'kume uretilmeli');
  assert.equal(c.archetype, 'versioned-app-store');
  // E6c: guncel surum dogrulanamadi -> hicbir app klasoru silme hedefi degil.
  assert.equal((c.deleteTargets ?? []).length, 0, 'kanitsiz guncel secim hedef uretmez');
  const oldPart: SubPart | undefined = c.subparts?.find((p) => p.path.endsWith('app-1.2.3'));
  assert.ok(oldPart, 'eski surum hala raporlanir');
  assert.equal(oldPart!.verdictKind, 'report-only');
  assert.ok(
    c.verdict.because.some((b) => b.includes('dogrulanamadi')),
    'karar gerekcesinde eksik kanit notu var',
  );
});

// --- E6b: node-runtimes siralamasi ------------------------------------------

test('node-runtimes: v20.11.0-beta < v20.11.0 (on surum siralamasi)', async () => {
  const base = join(root, 'node-mgr');
  await dir(join(base, 'node-versions', 'v20.11.0', 'installation'));
  await dir(join(base, 'node-versions', 'v20.11.0-beta', 'installation'));
  await file(join(base, 'node-versions', 'v20.11.0', 'installation', 'node.exe'), 256);
  await file(join(base, 'node-versions', 'v20.11.0-beta', 'installation', 'node.exe'), 256);

  const report = await scanNodeRuntimes({ roots: [base], env: {} });
  const versions = report.copies.map((c) => c.version);
  assert.deepEqual(versions, ['20.11.0', '20.11.0-beta']);
  assert.equal(report.activeVersion, null, 'fixture icinde aktif kopya yok');
});

test('node-runtimes: eski sayisal siralama regresyonu yok (20.9.9 < 20.10.0)', async () => {
  const base = join(root, 'node-mgr2');
  await dir(join(base, 'node-versions', 'v20.9.9', 'installation'));
  await dir(join(base, 'node-versions', 'v20.10.0', 'installation'));
  await file(join(base, 'node-versions', 'v20.9.9', 'installation', 'node.exe'), 256);
  await file(join(base, 'node-versions', 'v20.10.0', 'installation', 'node.exe'), 256);
  await file(join(base, 'node-versions', 'v20.9.1', 'installation', 'node.exe'), 256);

  const report = await scanNodeRuntimes({ roots: [base], env: {} });
  assert.deepEqual(
    report.copies.map((c) => c.version),
    ['20.10.0', '20.9.9', '20.9.1'],
  );
});
