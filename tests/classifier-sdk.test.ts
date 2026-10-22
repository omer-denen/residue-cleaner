import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { probeDir } from '../src/core/classifier.ts';
import { classifyPath, detectArchetype } from '../src/core/analyze.ts';

/**
 * C9 — SDK kurulumu kanıtı güçlendirildi ve ölü kod kaldırıldı.
 * Kaynak: docs/residue-cleaner-analiz-ve-promptlar.md (C9 bulgusu).
 *
 * ESKİ DAVRANIŞ: `sdk/`, `shared/`, `tools/`, `host/` adlı TEK dizin bile
 * `probe.sdkInstall = true` veriyordu; `tools/` her uygulamada geçebilir
 * ve bu, sıradan klasörleri gereksiz SDK kurulumu (report-only,
 * os-user-data) kümü yapar.
 *
 * YENİ KANIT (kombinasyon):
 *   `sdk/`                                → yeterli (ör. .NET `<kok>/sdk`)
 *   `shared/` + `tools/` (aynı kökte)     → yeterli
 *   `sdk/` + diğer herhangi biri          → yeterli (`sdk/` zaten yeterli)
 * YETMEZ: tek başına `tools/`, `host/`, `shared/`.
 *
 * Ölü `hasSdkMarker` (analyze.ts) silindi: hiçbir yerden çağrılmıyor;
 * SDK kanıtının tek kaynağı `probeDir`'deki kombinasyon kuralıdır.
 */

let root = '';

before(async () => {
  // Kurallar: %TEMP% altında yerleştirilmez (temp-scratch taraması
  // testi boşuna yapardı); gitignore'lu scratch klasorunde.
  root = await mkdtemp(join(process.cwd(), 'scratch', 'c9-fixtures-'));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function sdkDirs(dir: string, ...names: string[]): Promise<void> {
  for (const n of names) {
    // Her SDK klasorunde bir dosya olsun ki klasor gercekten dolu gorunsun.
    const sub = join(dir, n);
    await mkdir(sub, { recursive: true });
    await writeFile(join(sub, 'kernel.dll'), 'x', 'utf8');
  }
}

// --- 1: sdk/ + shared/ + tools/ → SDK kurulumu, hedef yok ------------------

test('C9: sdk+shared+tools kokte SDK kuruludur; os-user-data, hedef YOK', async () => {
  const dir = join(root, 'c9-full-sdk');
  await sdkDirs(dir, 'sdk', 'shared', 'tools');
  const p = await probeDir(dir);
  assert.equal(p.sdkInstall, true, 'sdkInstall true olmalı (uç kombinasyon)');

  const ev = { fileKinds: p.fileKinds, markers: p.markers, logSignals: p.logSignals };
  const a = detectArchetype(ev, dir, new Map(), p);
  assert.equal(a, 'os-user-data', 'SDK kurulumu os-user-data etiketlemeye devam etmeli');

  // report-only değişmiyor: kullanıcı verisi kümesi SILME HEDEFI üretmez.
  const c = await classifyPath(dir, 'custom');
  assert.ok(c, 'küme üretilmeli');
  assert.equal((c.deleteTargets ?? []).length, 0, 'os-user-data hedef üretmemeli');
});

// --- 2: yalnız sdk/ → SDK kurulumu (regresyon) ------------------------------

test('C9: yalnız sdk/ dizini SDK kurulumu sayılır', async () => {
  const dir = join(root, 'c9-sdk-only');
  await sdkDirs(dir, 'sdk');
  const p = await probeDir(dir);
  assert.equal(p.sdkInstall, true, 'sdk/ tek başına yeterli olmalı');
});

test('C9: sdk/ + host/ kombinasyonu da SDK kurulumu sayılır', async () => {
  const dir = join(root, 'c9-sdk-host');
  await sdkDirs(dir, 'sdk', 'host');
  const p = await probeDir(dir);
  assert.equal(p.sdkInstall, true, 'sdk/ varken ek dizin davranışı değişmemeli');
});

// --- 3: yalnız tools/ → SDK kanıtı YOK --------------------------------------

test('C9: yalnız tools/ dizini sdkInstall vermez (yanlış pozitif kapatıldı)', async () => {
  const dir = join(root, 'c9-tools-only');
  await sdkDirs(dir, 'tools');
  const p = await probeDir(dir);
  assert.notEqual(p.sdkInstall, true, 'tek başına tools/ SDK kanıtı olmalı değil');

  const a = detectArchetype({ ...p }, dir, new Map());
  assert.notEqual(a, 'model-store');
});

// --- 4: yalnız shared/ ve host/ → SDK kanıtı YOK -----------------------------

test('C9: yalnız shared/ dizini sdkInstall vermez', async () => {
  const dir = join(root, 'c9-shared-only');
  await sdkDirs(dir, 'shared');
  const p = await probeDir(dir);
  assert.notEqual(p.sdkInstall, true, 'shared/ tek başına yeterli olmalı değil');
});

test('C9: yalnız host/ dizini sdkInstall vermez', async () => {
  const dir = join(root, 'c9-host-only');
  await sdkDirs(dir, 'host');
  const p = await probeDir(dir);
  assert.notEqual(p.sdkInstall, true);
});

test('C9: host+tools (sdk/shared YOK) SDK kurulumu sayılmaz', async () => {
  const dir = join(root, 'c9-host-tools');
  await sdkDirs(dir, 'host', 'tools');
  const p = await probeDir(dir);
  assert.notEqual(p.sdkInstall, true, 'sdk kanıtı olmadan host+tools YETMEZ');
});

// --- 5: shared/ + tools/ → yeterli -------------------------------------------

test('C9: shared+tools birlikte SDK kurulumu sayılır', async () => {
  const dir = join(root, 'c9-shared-tools');
  await sdkDirs(dir, 'shared', 'tools');
  const p = await probeDir(dir);
  assert.equal(p.sdkInstall, true, 'shared/ + tools/ birlikte yeterli olmalı');
});

// --- 6: SDK kanıtının tek kaynağı kombinasyondur ------------------------------

test('C9: kok adına değil kokteki dizin kombinasyonuna bakılır', async () => {
  // Kök adı "tools" olan bir klasörde SDK kanıtı olması için yine kokte
  // dile KOMBINASYON beklenir; kanıt kök adından çıkarılmaz.
  const dir = join(root, 'tools');
  await sdkDirs(dir, 'tools');
  const p = await probeDir(dir);
  assert.notEqual(p.sdkInstall, true, 'kok adi "tools" tek basina kanit degil');
  const c = await classifyPath(dir, 'custom');
  assert.ok(c, 'küme üretilmeli');
  assert.equal((c.deleteTargets ?? []).length, 0);
});
