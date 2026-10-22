import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

// E10d: GPU algilama sabit yolu. Fixture koku %TEMP% ALTINDA DEGIL —
// `scratch/` kullanir; cunku sabit `C:\Windows` yerine env yolu `SystemRoot`
// kullaniliyor ve bunu gercek sistem dizininden ayirt edilebilir hale
// getirmek icin disarida (repo icinde) bir fixture gerekir.
let fixtureRoot = '';

before(async () => {
  const base = join(import.meta.dirname, '..', 'scratch', 'tmp');
  // mkdtemp yalnizca sonuncu patika bilesenini olusturur; kok scratch/tmp once.
  await mkdir(base, { recursive: true });
  fixtureRoot = await mkdtemp(join(base, 'e10d-gpu-fix-'));
});
after(async () => {
  delete process.env.SystemRoot;
  if (fixtureRoot !== '') await rm(fixtureRoot, { recursive: true, force: true });
});

// Her test kendi alt fixture'ini kurar (testten once yazilan dosya
// sonraki testi kirletmesin); ebeveyn `fixtureRoot` after'da temizlenir.
async function newFixtureRoot(): Promise<string> {
  return await mkdtemp(join(fixtureRoot, 'case-'));
}

async function writeNvcuda(
  root: string,
  subdir: 'System32' | 'SysWOW64',
): Promise<void> {
  const dir = join(root, subdir);
  await mkdir(dir, { recursive: true });
  // Icerik onemli degil, varlik kanitidir (gercek DLL kopyasi yazilmez).
  await writeFile(join(dir, 'nvcuda.dll'), 'fixture-not-a-real-dll', 'utf8');
}

interface GpuEnvSnapshot {
  SystemRoot?: string;
  SystemDrive?: string;
}

function snapshotEnv(): GpuEnvSnapshot {
  const snap: GpuEnvSnapshot = {};
  if (process.env.SystemRoot !== undefined) snap.SystemRoot = process.env.SystemRoot;
  if (process.env.SystemDrive !== undefined) snap.SystemDrive = process.env.SystemDrive;
  return snap;
}

function restoreEnv(snap: GpuEnvSnapshot): void {
  for (const key of ['SystemRoot', 'SystemDrive'] as const) {
    if (snap[key] !== undefined) process.env[key] = snap[key];
    else delete process.env[key];
  }
}

test('System32 altinda nvcuda.dll varsa nvidia tespit edilir', async () => {
  const snap = snapshotEnv();
  process.env.SystemRoot = await newFixtureRoot();
  try {
    await writeNvcuda(process.env.SystemRoot!, 'System32');
    const { detectGpu } = await import('../src/core/analyze.ts');
    const gpu = await detectGpu();
    assert.equal(gpu.hasNvidia, true);
    assert.match(gpu.note, /bulundu/);
  } finally {
    restoreEnv(snap);
  }
});

test('dosya hic yoksa yoktur ve notta "yok" der', async () => {
  const snap = snapshotEnv();
  process.env.SystemRoot = await newFixtureRoot();
  try {
    const { detectGpu } = await import('../src/core/analyze.ts');
    const gpu = await detectGpu();
    assert.equal(gpu.hasNvidia, false);
    assert.match(gpu.note, /yok/);
    // Erisim hatasi degil dosya yok senaryosu: "bilinmiyor" karismamali.
    assert.doesNotMatch(gpu.note, /erisim engellendi/);
  } finally {
    restoreEnv(snap);
  }
});

test('yalniz SysWOW64 altinda nvcuda.dll varsa da tespit edilir (ek kanit yolu)', async () => {
  const snap = snapshotEnv();
  process.env.SystemRoot = await newFixtureRoot();
  try {
    await writeNvcuda(process.env.SystemRoot!, 'SysWOW64');
    const { detectGpu } = await import('../src/core/analyze.ts');
    const gpu = await detectGpu();
    assert.equal(gpu.hasNvidia, true);
    // Kanitin hangi yoldan geldigi notta gorunur olmali.
    assert.match(gpu.note, /SysWOW64/);
  } finally {
    restoreEnv(snap);
  }
});

test('SystemRoot tanimsizken cokmez; makul bir yola duser', async () => {
  const snap = snapshotEnv();
  delete process.env.SystemRoot;
  try {
    const { detectGpu, systemRootPath } = await import('../src/core/analyze.ts');
    // SystemDrive (varsa) ile makul dusus; her durumda cifte nokta+Windows bitisi.
    const root = systemRootPath();
    assert.match(root, /\\Windows\\?$/i);
    const gpu = await detectGpu();
    assert.equal(typeof gpu.hasNvidia, 'boolean');
    assert.ok(gpu.note.length > 0);
  } finally {
    restoreEnv(snap);
  }
});

test('sabit C:\\Windows KULLANILMAZ: fixture bosken sonuc fixture\sina gore false', async () => {
  const snap = snapshotEnv();
  try {
    // Test koşullari: SystemRoot fixture'a cekilir. Fixture'da nvcuda.dll
    // YOK. Bu makinede gercek C:\Windows\System32\nvcuda.dll bile olsa(mutlaka
    // olmayabilir) ESKI kod "hasNvidia:true" dondururdu; dogru davranis
    // fixture'a gore false dondurmesidir. Böylece env yolu kanitlanir.
    process.env.SystemRoot = await newFixtureRoot();
    // Fixture'da nvcuda.dll hic yazilmamistir; inert dogrula:
    const sys32Fixture = join(process.env.SystemRoot, 'System32');
    let fixtureHasDll = true;
    try {
      await stat(join(sys32Fixture, 'nvcuda.dll'));
    } catch {
      fixtureHasDll = false;
    }
    assert.equal(fixtureHasDll, false, "Fixture'da nvcuda.dll olmamali (test kurulum hatasi)");
    const { detectGpu } = await import('../src/core/analyze.ts');
    const gpu = await detectGpu();
    assert.equal(gpu.hasNvidia, false);
    assert.match(gpu.note, /yok/);
  } finally {
    restoreEnv(snap);
  }
});
