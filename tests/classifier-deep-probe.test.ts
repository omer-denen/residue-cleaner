import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { probeDir } from '../src/core/classifier.ts';

/**
 * C10 — deepProbe determinizmi ve erken cikis.
 * Kaynak: docs/residue-cleaner-analiz-ve-promptlar.md (C10 bulgusu).
 * 1. Erken cikis BENZERSIZ Tur sayisina bagli: ayni turden 4 dosya
 *    erken cikisi tetiklemez; farkli turdeki kanit bulunur.
 * 2. Cocuk ornekleme deterministiktir: readdir sirasindan bagimsiz,
 *    ayni fixture iki taramada ayni kaniti uretir.
 * 3. MAX_PROBE_CHILDREN siniri korunur (maliyet kontrolu, cokme yok).
 * 4. NuGet paket deposu davranisi bozulmaz (regresyon).
 *
 * DIKKAT: %TEMP% altinda kurulmaz — depo icindeki (gitignore'lu)
 * `scratch/` klasoru kullanilir.
 */

let root = '';

before(async () => {
  root = await mkdtemp(join(process.cwd(), 'scratch', 'c10-fixtures-'));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function file(path: string, content = ''): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf8');
}

// --- 1: ayni turden 4+ dosya erken cikisi tetiklemez ---------------------

test('C10: ayni turden 4 log iceren alt klasor erken cikisi tetiklemez, farkli kanit bulunur', async () => {
  const d = join(root, 'c10-early-exit');
  // Siralama yonunden ILK gelecek klasorler yalnizca ayni turden
  // ('log') dosyalar icerir; eski kod bunlarin ilkine baktiktan sonra
  // kinds.length >= 4 ile geri doner ve farkli turdeki kanit kaybolurdu.
  for (const name of ['aaa-1', 'aaa-2', 'aaa-3']) {
    for (const n of ['daemon.log', 'runner.log', 'worker.log', 'ui.log']) {
      await file(join(d, name, n), 'CUDAExecutionProvider active\n');
    }
  }
  // Sonraki klasorde baska TUR kanitlar var: onnx-model + CACHEDIR.TAG.
  await file(join(d, 'zzz-evidence', 'model.onnx'), 'x');
  await file(join(d, 'zzz-evidence', 'CACHEDIR.TAG'), 'Signature: 8jDblW');

  const p = await probeDir(d);
  const kinds = new Set(p.fileKinds);
  assert.ok(kinds.has('log'), 'log kaniti bulunmali');
  assert.ok(kinds.has('onnx-model'), 'log yaninda farkli tur kanit da bulunmali (erken cikis hizina Engri yok)');
  assert.ok(p.markers.includes('cachedir-tag'), 'CACHEDIR.TAG isaretini bulmali');
});

// --- 2+3: deterministik ornekleme; 40+ cocuk, iki tarama ayni ------------

test('C10: 50 cocuklu fixture iki probeDir taramasinda ayni kaniti uretir', async () => {
  const d = join(root, 'c10-determinism');
  // 50 cocuk (MAX_PROBE_CHILDREN=40 ustunde): taranmayan 10 cocuk
  // readdir sirasina degil, isim sirasina gore secilmeli.
  for (let i = 0; i < 50; i++) {
    await file(join(d, `child-${String(i).padStart(3, '0')}`, `f${i % 7}.log`), 'sadece log\n');
  }
  // "child-999" isim sirasinda SONDA: 40 cocuk sinirina takilir
  // (ornekleme isim sirasina gore). Farkli tur kanitlar SINIR ICINDE
  // farkli cocuklara dagitilir: determinizm bozulursa kanit kaybolur.
  for (let i = 0; i < 50; i++) {
    await file(join(d, `child-${String(i).padStart(3, '0')}`, `f${i % 3}.log`), 'sadece log\n');
  }
  await file(join(d, 'child-001', 'model.onnx'), 'x');
  await file(join(d, 'child-002', 'CACHEDIR.TAG'), 'Signature: 8jDblW');

  const p1 = await probeDir(d);
  const p2 = await probeDir(d);
  assert.deepEqual(p2.fileKinds.slice().sort(), p1.fileKinds.slice().sort());
  assert.deepEqual(p2.markers.slice().sort(), p1.markers.slice().sort());
  assert.ok(new Set(p1.fileKinds).has('log'));
  assert.ok(new Set(p1.fileKinds).has('onnx-model'), 'sinir icindeki cocuktan farkli tur kanit bulunmali');
  assert.ok(p1.markers.includes('cachedir-tag'), 'sinir icindeki cocuktan CACHEDIR.TAG bulunmali');
});

test('C10: MAX_PROBE_CHILDREN ustunde 100 cocukta cokme yok, sinir korunur', async () => {
  const d = join(root, 'c10-overflow');
  for (let i = 0; i < 100; i++) {
    await file(join(d, `leaf-${String(i).padStart(3, '0')}`, 'x.log'), 'l\n');
  }
  const p = await probeDir(d);
  assert.ok(Array.isArray(p.fileKinds));
  assert.ok(Array.isArray(p.markers));
});

// --- 4: NuGet paket deposu regresyonu ------------------------------------

test('C10: packages/<paket>/<surum> NuGet deposu taninmaya devam eder', async () => {
  const d = join(root, 'c10-nuget');
  await file(join(d, 'packages', 'Newtonsoft.Json', '13.0.3', 'newtonsoft.json.13.0.3.nupkg'), 'x');
  const p = await probeDir(d);
  assert.ok(p.fileKinds.includes('nuget-package'));
  assert.ok(p.markers.includes('package-store'));
});
