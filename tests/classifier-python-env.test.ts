import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { probeDir } from '../src/core/classifier.ts';

/**
 * C8 — ölü Python ortamı kanıtları.
 * Kaynak: docs/residue-cleaner-analiz-ve-promptlar.md (C8 bulgusu).
 * 1. `pyvenv.cfg` bir DOSYADIR; python-env kanıtı dosya dalında üretilir
 *    (eski kod bu türü dizin dalına yazmıştı → yol ölü kalıyordu).
 * 2. `venv` / `.venv` dizini `venv` fileKind üretir (karar katmanı
 *    `kinds.has('venv')` derecesini bekliyordu; tür hiç üretilmiyordu).
 * 3. `Scripts` dizini YALNIZCA destekleyici kanıtla (pyvenv.cfg /
 *    site-packages) işaret sayılır; büyük harf karşılaştırması orijinal
 *    adla yapılır. Küçük `scripts` sıradan proje klasörüdür ve hiçbir
 *    Python ortamı kanıtı üretmez (kural 13: genel ad tek başına kanıt
 *    değildir).
 * 4. Mevcut conda-meta / site-packages davranışı korunur.
 */

let root = '';

before(async () => {
  // DİKKAT: %TEMP% altında kurulmaz — görev kuralı; deponun
  // gitignore'lu `scratch/` klasörü kullanılır.
  root = await mkdtemp(join(process.cwd(), 'scratch', 'c8-fixtures-'));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function file(path: string, content = ''): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf8');
}

// --- 1: pyvenv.cfg DOSYASI → python-env kanıtı ----------------------------

test('C8: kökte pyvenv.cfg DOSYASI varsa fileKinds python-env içerir', async () => {
  const d = join(root, 'c8-venv-root');
  await file(join(d, 'pyvenv.cfg'), 'home = C:\\Python312\ninclude-system-site-packages = false\n');
  const p = await probeDir(d);
  assert.ok(
    p.fileKinds.includes('python-env'),
    `beklenen fileKinds python-env, gelen: ${p.fileKinds.join(',')}`,
  );
  // işaret: dosya adı gerçek kanıt taşıyıcısıdır
  assert.ok(p.markers.includes('pyvenv.cfg'));
});

// --- 2: venv/ dizini → venv türü ------------------------------------------

test('C8: venv/ dizini varsa fileKinds içinde venv vardır', async () => {
  const d = join(root, 'c8-with-venv');
  await mkdir(join(d, 'venv', 'Scripts'), { recursive: true });
  const p = await probeDir(d);
  assert.ok(
    p.fileKinds.includes('venv'),
    `beklenen fileKinds venv, gelen: ${p.fileKinds.join(',')}`,
  );
  assert.ok(p.markers.includes('venv'));
});

// --- 3: .venv/ dizini → venv türü (davranış dönüşümü korunur) --------------

test('C8: .venv/ dizini varsa fileKinds içinde venv vardır', async () => {
  const d = join(root, 'c8-with-dotvenv');
  await mkdir(join(d, '.venv', 'Scripts'), { recursive: true });
  const p = await probeDir(d);
  assert.ok(p.fileKinds.includes('venv'));
  // mevcut işaret davranışı korunur
  assert.ok(p.markers.includes('.venv'));
});

// --- 4: Scripts/ + pyvenv.cfg → Python ortam kanıtı -----------------------

test('C8: Scripts/ + pyvenv.cfg birlikte Python ortam kanıtı üretir', async () => {
  const d = join(root, 'c8-venv-scripts');
  await mkdir(join(d, 'Scripts'), { recursive: true });
  await file(join(d, 'pyvenv.cfg'), 'home = C:\\Python312\n');
  await file(join(d, 'Scripts', 'activate.bat'), '@echo off\n');
  const p = await probeDir(d);
  assert.ok(p.fileKinds.includes('python-env'));
  // destekleyici kanıt varken Scripts artık işaret taşır (eski kod hiç
  // eşleşmiyordu: PYENV_MARKERS'ta büyük harfli giris, karsilastirma
  // kucuk harfle)
  assert.ok(p.markers.includes('Scripts'), `Scripts isareti yok: ${p.markers.join(',')}`);
});

// --- 5: yanlış pozitif: scripts/ + package.json — hiçbir kanıt yok ---------

test('C8: sıradan projede scripts/ + package.json Python ortam kanıtı ÜRETMEZ', async () => {
  const d = join(root, 'c8-plain-project');
  await mkdir(join(d, 'scripts'), { recursive: true });
  await file(join(d, 'package.json'), '{"name":"orn","version":"1.0.0"}\n');
  await file(join(d, 'scripts', 'build.mjs'), 'console.log(1)\n');
  const p = await probeDir(d);
  assert.ok(!p.fileKinds.includes('python-env'), 'python-env kanıtı üretildi (yalnız scripts/)');
  assert.ok(!p.fileKinds.includes('venv'), 'venv kanıtı üretildi (yalnız scripts/)');
  assert.ok(!p.markers.includes('Scripts'), 'Scripts işareti üretildi (yalnız scripts/)');
});

// --- 5b: büyük harfli Scripts/ TEK BAŞINA işaret üretmez -------------------

test('C8: Scripts/ dizini tek başına, gerçek kanıt olmadan işaret üretmez', async () => {
  const d = join(root, 'c8-scripts-only');
  await mkdir(join(d, 'Scripts'), { recursive: true });
  await file(join(d, 'Scripts', 'task.ps1'), 'Write-Output "build"\n');
  const p = await probeDir(d);
  assert.ok(!p.fileKinds.includes('python-env'));
  assert.ok(!p.fileKinds.includes('venv'));
  assert.ok(!p.markers.includes('Scripts'), `tek basina Scripts isaretlendi: ${p.markers.join(',')}`);
});

// --- 6: regresyon — conda-meta / site-packages davranışı korunur -----------

test('C8: conda-meta/ dizini mevcut işaretleri üretmeye devam eder', async () => {
  const d = join(root, 'c8-conda');
  await mkdir(join(d, 'conda-meta'), { recursive: true });
  await file(join(d, 'conda-meta', 'python-3.12-0.json'), '{}\n');
  const p = await probeDir(d);
  assert.ok(p.markers.includes('conda-meta'));
  // mevcut tur/dizin semasi: conda-meta ayrica "store" pendiri sayilir
  assert.ok(p.markers.includes('store'));
});

test('C8: site-packages/ dizini mevcut işaretini üretmeye devam eder', async () => {
  const d = join(root, 'c8-site-packages');
  await mkdir(join(d, 'site-packages', 'pip'), { recursive: true });
  await file(join(d, 'site-packages', 'pip', '__init__.py'), '');
  const p = await probeDir(d);
  assert.ok(p.markers.includes('site-packages'));
});
