import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { probeDir } from '../src/core/classifier.ts';

/**
 * C7 — probeLogs saglamligi.
 * Kaynak: docs/residue-cleaner-analiz-ve-promptlar.md (C7 bulgusu).
 * 1. logs/ okunamazsa kok dizin okumasi hata sizdirmaz.
 * 2. Yol kurulumu tek yerde: kok loglarina `logs\` oneki EKLENMEZ.
 * 3. LOG_DIR_RE yalniz DIZIN adlarini eslestirir; `daemon.log` gibi bir
 *    DOSYA adini logs dizin adi sanmaz.
 * 4. Kok loglarinin cift okunmasi olmaz — ayni satir aynı sinyali
 *    iki kez uretmez.
 * 5. Mevcut LOG_MARKERS davranisi korunur: bir satir birden fazla
 *    sinyal tasir (regresyon).
 */

let root = '';

before(async () => {
  // DIKKAT: %TEMP% altinda kurulmaz — yol "temp-scratch" olur. Depo
  // icindeki (gitignore'lu) `scratch/` klasoru kullanilir.
  root = await mkdtemp(join(process.cwd(), 'scratch', 'c7-fixtures-'));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function file(path: string, content = ''): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf8');
}

// --- 1: logs/ altındaki GPU log satiri okunur ----------------------------

test('C7: logs/daemon.log içindeki GPU satiri logSignals içindedir', async () => {
  const d = join(root, 'c7-logs-dir');
  await file(join(d, 'logs', 'daemon.log'), 'CUDAExecutionProvider active\n');
  const p = await probeDir(d);
  assert.ok(
    p.logSignals.some((s) => /CUDAExecutionProvider/.test(s.line) && s.means === 'GPU saglayicisi kullanildi'),
  );
  assert.ok(p.markers.includes('logs'));
});

// --- 2: yalniz kokte daemon.log — sinyal okunur, hata firlatmaz ----------

test('C7: logs/ yokken kok daemon.log okunur ve probeDir hata firlatmaz', async () => {
  const d = join(root, 'c7-root-only');
  await file(join(d, 'daemon.log'), 'CUDAExecutionProvider active\n');
  // eski kod: yedek dal `logs\daemon.log` yolunu deniyor, sinyal kaçardı
  const p = await probeDir(d);
  assert.ok(p.logSignals.some((s) => /CUDAExecutionProvider/.test(s.line)));
  assert.ok(!p.markers.includes('logs'));
});

// --- 3: logs bir DOSYA ise kok logu hala okunur, hata sizmaz ------------

test('C7: logs yerine ayni adli dosya — kok logu okunur, hata sizmaz', async () => {
  const d = join(root, 'c7-logs-file');
  await file(join(d, 'logs'), 'not a directory');
  await file(join(d, 'daemon.log'), 'CUDAExecutionProvider active\n');
  const p = await probeDir(d);
  assert.ok(p.logSignals.some((s) => /CUDAExecutionProvider/.test(s.line)));
});

// --- 4: kokteki daemon.log dosyasi logs dizini sayilmaz ------------------

test('C7: kokteki daemon.log dosyasi sahte logs isareti uretmez', async () => {
  const d = join(root, 'c7-fake-logs');
  await file(join(d, 'daemon.log'), 'x');
  const p = await probeDir(d);
  assert.ok(!(p.fileKinds as string[]).includes('logs'));
  assert.ok(!p.markers.includes('logs'));
  assert.ok(!p.markers.includes('daemon.log'));
});

// --- 5: .logs uzantili DIZIN destegi korunur ------------------------------

test('C7: `.logs` uzantılı dizin hala logs isareti alir', async () => {
  const d = join(root, 'c7-logs-ext');
  await mkdir(join(d, 'runtime.logs'), { recursive: true });
  await file(join(d, 'runtime.logs', 'app.log'), 'onnxruntime inference session\n');
  const p = await probeDir(d);
  assert.ok(p.markers.includes('runtime.logs'));
});

// --- 6: kok logu TEK KEZ okunur (cift okuma yok) --------------------------

test('C7: ayni kok log satiri iki kez sinyal üretmez', async () => {
  const d = join(root, 'c7-single-read');
  await file(join(d, 'daemon.log'), 'onnxruntime inference session\n');
  const p = await probeDir(d);
  const count = p.logSignals.filter((s) => s.line.includes('onnxruntime inference session')).length;
  assert.equal(count, 1);
});

// --- 7: LOG_MARKERS regresyonu: tek satir >1 sinyal -----------------------

test('C7: tek log satiri birden fazla sinyal üretir (regresyon)', async () => {
  const d = join(root, 'c7-multi-signal');
  await file(join(d, 'logs', 'run.log'), 'Device: CPU,EPs: CPUExecutionProvider,CUDAExecutionProvider\n');
  const p = await probeDir(d);
  const means = p.logSignals.map((s) => s.means);
  assert.ok(means.some((m) => m === 'cihaz tipi: CPU (GPU kullanilmiyor)'));
  assert.ok(means.some((m) => m === 'GPU saglayicisi kullanildi'));
});
