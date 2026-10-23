import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BUILTIN_PROFILES,
  discover,
  filterProtectedTargets,
  findVirtualDiskDirs,
  isOwnDataPath,
  isProtectedUserPath,
} from '../src/core/discover.ts';
import { classifyPath } from '../src/core/analyze.ts';
import { unsafeTargetReason } from '../src/actions/guard.ts';

/**
 * P3 — kesif ve koruma.
 * Kaynak: docs/residue-cleaner-analiz-ve-promptlar.md (Prompt 3).
 *
 * DIKKAT: fixture koku `scratch/` altinda olmali; %TEMP% yolu
 * `temp-scratch` olarak siniflandirilir ve test anlamsizlasir.
 */

let root = '';

before(async () => {
  root = await mkdtemp(join(process.cwd(), 'scratch', 'p3-fixtures-'));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function file(path: string, content = ''): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf8');
}

const ENV = {
  LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local',
  APPDATA: 'C:\\Users\\x\\AppData\\Roaming',
  USERPROFILE: 'C:\\Users\\x',
  TEMP: 'C:\\Users\\x\\AppData\\Local\\Temp',
};

// --- D6: kasa yolu her yazimda taninir ------------------------------------

test('D6: kasa yolu egik cizgi, buyuk harf, trailing slash ile taninir', () => {
  assert.equal(isOwnDataPath('C:/Users/x/AppData/Local/residue/sub', ENV), true);
  assert.equal(isOwnDataPath('c:\\users\\X\\appdata\\local\\RESIDUE', ENV), true);
  assert.equal(isOwnDataPath('C:\\Users\\x\\AppData\\Local\\residue\\', ENV), true);
  assert.equal(isOwnDataPath('C:\\Users\\x\\.residue\\logs', ENV), true);
  // Eski veri dizini adi artik "kendi veri" olarak taninmaz (23.10.2026).
  assert.equal(isOwnDataPath('C:\\Users\\x\\AppData\\Local\\clicleaner\\vault', ENV), false);
});

test('D6: .. ile dolasan yol ve \\\\?\\ oneki cozulur', () => {
  assert.equal(
    isOwnDataPath('C:\\Users\\x\\AppData\\Local\\other\\..\\residue\\vault', ENV),
    true,
  );
  assert.equal(isOwnDataPath('\\\\?\\C:\\Users\\x\\AppData\\Local\\residue\\cache', ENV), true);
});

test('D6: benzer adli komsu dizin kasa sayilmaz', () => {
  assert.equal(isOwnDataPath('C:\\Users\\x\\AppData\\Local\\residue2', ENV), false);
  assert.equal(isOwnDataPath('C:\\Users\\x\\AppData\\Local\\other', ENV), false);
});

// --- D7: ters yon koruma (kasa, tarama kokunun icinde) --------------------

test('D7: kasa ve kimlik yollari hedef listesinden cikarilir', () => {
  const { kept, removed } = filterProtectedTargets(
    [
      { path: 'C:\\Users\\x\\AppData\\Local\\residue\\vault' },
      { path: 'C:\\Users\\x\\.ssh' },
      { path: 'C:\\Projects\\app\\cache' },
    ],
    ENV,
  );
  assert.deepEqual(kept.map((k) => k.path), ['C:\\Projects\\app\\cache']);
  assert.equal(removed.length, 2);
});

// --- D8: kimlik bilgisi klasorleri korunur --------------------------------

test('D8: kimlik klasorleri ve alt yollari tespit edilir', () => {
  for (const p of [
    'C:\\Users\\x\\.ssh',
    'C:\\Users\\x\\.ssh\\config',
    'C:\\Users\\x\\.gnupg\\private-keys-v1.d',
    'C:\\Users\\x\\.aws\\credentials',
    'C:\\Users\\x\\.azure\\token',
    'C:\\Users\\x\\.kube\\config',
  ]) {
    assert.equal(isProtectedUserPath(p), true, p);
  }
  assert.equal(isProtectedUserPath('C:\\Users\\x\\.sshfs-cache'), false);
  assert.equal(isProtectedUserPath('C:\\Users\\x\\.sshfs-cache'), false);
  // Bilincli olarak GUVENLI taraf: adi `.aws` olan her klasor korunur.
  // Bir proje klasoru bile olsa "kimlik bilgisi olabilir" varsayimi
  // yanlis silmeden daha az maliyetlidir.
  assert.equal(isProtectedUserPath('C:\\Users\\x\\projects\\.aws'), true);
});

test('D8: silme kapisi kimlik klasorunu reddeder', () => {
  const reason = unsafeTargetReason('C:\\Users\\x\\.ssh');
  assert.ok(reason && reason.includes('kimlik'));
});

// --- D1: temp ortami tum LocalAppData'yi taramaz --------------------------

test('D1: --env temp yalnizca %TEMP% koku ekler', async () => {
  const local = join(root, 'appdata-local');
  const temp = join(root, 'appdata-local', 'Temp');
  await mkdir(join(local, 'SomeApp'), { recursive: true });
  await mkdir(temp, { recursive: true });
  const result = await discover(['temp'], {
    env: { LOCALAPPDATA: local, USERPROFILE: join(root, 'home'), TEMP: temp },
  });
  const paths = result.targets.map((t) => t.path.toLowerCase());
  assert.deepEqual(paths, [temp.toLowerCase()]);
});

// --- D3: sanal diskler dar kesifle bulunur, hedef olmaz -------------------

test('D3: WSL dagitim diski LocalState klasorunden bulunur', async () => {
  const local = join(root, 'vdisk-local');
  const state = join(local, 'Packages', 'SomeDistro', 'LocalState');
  await file(join(state, 'ext4.vhdx'), '');
  await mkdir(join(local, 'Packages', 'OtherApp'), { recursive: true });
  await file(join(local, 'Packages', 'OtherApp', 'data.bin'), 'x');

  const dirs = await findVirtualDiskDirs([join(local, 'Packages'), join(local, 'wsl')]);
  assert.deepEqual(dirs, [state]);

  const result = await discover(['vdisk'], {
    env: { LOCALAPPDATA: local, USERPROFILE: join(root, 'home') },
  });
  assert.deepEqual(result.virtualDisks, [state]);
  assert.deepEqual(result.targets.map((t) => t.path), [state]);
});

test('D3: sanal disk koku report-only siniflanir', async () => {
  const local = join(root, 'vdisk-report');
  const state = join(local, 'wsl', 'SomeDistro');
  await file(join(state, 'ext4.vhdx'), '');
  const c = await classifyPath(state, 'custom');
  assert.ok(c);
  assert.equal(c.archetype, 'virtual-disk');
  assert.equal((c.deleteTargets ?? []).length, 0);
});

// --- D9: kesif hatalari sessiz yutulmaz -----------------------------------

test('D9: okunamayan kok uyari uretir, sessiz 0 klasor olmaz', async () => {
  const result = await discover(['localappdata'], {
    env: { LOCALAPPDATA: join(root, 'does-not-exist-xyz'), USERPROFILE: join(root, 'home') },
  });
  assert.equal(result.targets.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0]!, /bulunamadi/);
});

test('D9: ortam degiskeni bos ise uyari uretir', async () => {
  const result = await discover(['localappdata'], { env: { USERPROFILE: join(root, 'home') } });
  assert.ok(result.warnings.some((w) => /ortam degiskeni bos/.test(w)));
});

// --- D5: salt okunur profil motor tarafinda zorlanir ----------------------

test('D5: audit profili readOnly, lean degil', () => {
  assert.equal(BUILTIN_PROFILES.audit?.readOnly, true);
  assert.equal(BUILTIN_PROFILES.lean?.readOnly, undefined);
});

test('D5: readOnly taramada silme hedefi olusmaz', async () => {
  const dir = join(root, 'readonly-cache');
  await file(join(dir, 'CACHEDIR.TAG'), 'Signature: 8a477f597d28d172789f06886806bc55');
  await file(join(dir, 'blob.bin'), 'x');
  const normal = await classifyPath(dir, 'custom');
  assert.ok(normal);
  assert.ok((normal.deleteTargets ?? []).length > 0, 'normal taramada hedef var');

  const ro = await classifyPath(dir, 'custom', { readOnly: true });
  assert.ok(ro);
  assert.equal((ro.deleteTargets ?? []).length, 0);
  assert.equal(ro.verdict.kind, 'report-only');
  assert.equal(ro.reclaimableBytes, 0);
});

// --- D2: lean profili temp ile celismez -----------------------------------

test('D2: lean profili Temp dislamaz, temp ortamini tarar', () => {
  const lean = BUILTIN_PROFILES.lean!;
  assert.ok(lean.envs.includes('temp'));
  const excludes = (lean.exclude ?? []).map((e) => e.toLowerCase());
  assert.ok(!excludes.includes('temp'));
});

test('D2: lean ile gercek kesifte %TEMP% aday olur', async () => {
  const local = join(root, 'lean-local');
  const temp = join(local, 'Temp');
  await mkdir(join(local, 'App'), { recursive: true });
  await mkdir(temp, { recursive: true });
  const lean = BUILTIN_PROFILES.lean!;
  const result = await discover(lean.envs, {
    exclude: lean.exclude ?? [],
    env: { LOCALAPPDATA: local, USERPROFILE: join(root, 'home'), TEMP: temp },
  });
  assert.ok(result.targets.some((t) => t.path.toLowerCase() === temp.toLowerCase()));
});

// --- Kimlik klasoru siniflandirilmaz --------------------------------------

test('korumali kimlik klasoru classifyPath icinde atlanir', async () => {
  const dir = join(root, 'home', '.ssh');
  await file(join(dir, 'config'), 'x');
  const c = await classifyPath(dir, 'custom');
  assert.equal(c, null);
});
