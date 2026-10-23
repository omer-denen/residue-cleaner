import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { classifyPath, detectArchetype } from '../src/core/analyze.ts';
import type { Archetype, Evidence, LogSignal } from '../src/core/types.ts';

/**
 * E10a/b — mimari tip hijyeni.
 *
 * 1. E10a: `editor-workspace` hicbir yerden URETILMIYORDU; yalniz tip
 *    birligi ve tablolarda yasiyordu (olu kod). Tip birliginden cikarildi.
 * 2. E10b: `detectArchetype` icinde 3b ve 7 adimlari ayni
 *    `skill-store` / `skill-lock` kosullarini iki kez kontrol ediyordu;
 *    7'deki tekrar oluydu. Ayrica yalniz log satiri ("notebook
 *    calistirma ortami" gibi) adim 7'de `agent-workspace` uretebiliyordu;
 *    log tek basina yapisal kanit degildir (C1 felsefesi).
 *
 * Fixture kokleri `%TEMP%` altinda DEGIL — deponun gitignore'lu `scratch/`
 * klasoru kullanilir; aksi halde her yol `temp-scratch` olur.
 */

let root = '';

before(async () => {
  root = await mkdtemp(join(process.cwd(), 'scratch', 'e10ab-fixtures-'));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

function ev(over: Partial<Evidence> = {}): Evidence {
  return { fileKinds: [], markers: [], logSignals: [], ...over };
}

function signal(line: string, means: string): LogSignal {
  return { line, means };
}

async function file(path: string, content: string | Buffer): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf8');
}

// --- E10a: olu archetype kaldi mi? -----------------------------------------

// Tip testi: `editor-workspace` tip birligindeki yeri bos birakildiysa bu
// koşul `true` tur; hâlâ birlikteyse koşul tamamen belirgin kalmaz
// ve `editor-workspace` tipi tanimlanmaz — derleme yalnizca temiz
// durumda gecer.
type EditorArchetypeRemoved = 'editor-workspace' extends Archetype ? false : true;
const editorRemoved: EditorArchetypeRemoved = true;

test('E10a: editor-workspace Archetype birliginden cikarildi (tip testi)', () => {
  assert.equal(editorRemoved, true);
});

test('E10a: hicbir kanit dizisi editor-workspace uretmez', () => {
  const fixtures: Evidence[] = [
    // editor benzeri: ayarlar + proje dosyalari + oturum izleri
    ev({ markers: ['sessions', 'dist'], fileKinds: ['sqlite'] }),
    ev({ markers: ['skills'], fileKinds: ['sqlite'] }),
    ev({ markers: ['skill-store', 'models'], fileKinds: ['onnx-model'] }),
    ev({ logSignals: [signal('editor oturumu acildi', 'gunlendirme gunlugu')] }),
  ];
  for (const f of fixtures) {
    const a = detectArchetype(f, `${root}\\u-x`, new Map());
    assert.notEqual(a, 'editor-workspace' as Archetype);
  }
});

// --- E10b: 3b regresyonu — kesin beceri kaniti ------------------------------

test('E10b: skills/SKILL.md agent-workspace kalir ve hedef uretmez (3b regresyonu)', async () => {
  const dir = join(root, 'skills-store');
  await file(join(dir, 'skills', 'demo', 'SKILL.md'), '# demo beceri\n');
  const p = await classifyPath(dir, 'custom');
  assert.ok(p, 'kume uretilmeli');
  assert.equal(p.archetype, 'agent-workspace');
  assert.equal((p.deleteTargets ?? []).length, 0, 'beceri deposu hedef uretmez');
});

test('E10b: .skill-lock.json agent-workspace uretir (kesin beceri kaniti)', async () => {
  const dir = join(root, 'skill-lockbox');
  await file(join(dir, '.skill-lock.json'), '{"skills":[]}\n');
  const p = await classifyPath(dir, 'custom');
  assert.ok(p, 'kume uretilmeli');
  assert.equal(p.archetype, 'agent-workspace');
  assert.equal((p.deleteTargets ?? []).length, 0);
});

// --- E10b: yapisal oturum/hafiza marker'lari --------------------------------

test('E10b: yalniz sessions/ marker agent-workspace uretir ve hedef uretmez', async () => {
  const dir = join(root, 'agent-sessions');
  await file(join(dir, 'sessions', 'state.bin'), Buffer.alloc(64, 1));
  const p = await classifyPath(dir, 'custom');
  assert.ok(p, 'kume uretilmeli');
  assert.equal(p.archetype, 'agent-workspace');
  assert.equal((p.deleteTargets ?? []).length, 0);
});

// --- E10b: yalniz log yetmez (C1 regresyonu) --------------------------------

test('E10b: yalniz "notebook calistirma ortami" logu agent-workspace DEGIL', () => {
  const a = detectArchetype(
    ev({ logSignals: [signal('INFO Notebook kernel started', 'notebook calistirma ortami')] }),
    join(root, 'logonly'),
    new Map(),
  );
  assert.notEqual(a, 'agent-workspace');
  assert.equal(a, 'unknown', 'kanitsiz log gerekcesiz olarak bilinmez olur');
});

test('E10b: log + yapisal marker birlikte yine agent-workspace', () => {
  const a = detectArchetype(
    ev({
      markers: ['sessions'],
      logSignals: [signal('INFO Notebook kernel started', 'notebook calistirma ortami')],
    }),
    join(root, 'logplus'),
    new Map(),
  );
  assert.equal(a, 'agent-workspace');
});

// --- Regresyon: guncelleyici artigi dalila ayni siniflanir ------------------

test('E10a regresyon: app-<surum> + Update.exe versioned-app-store kalir', async () => {
  const base = join(root, 'u-vstore');
  await file(join(base, 'app-1.2.3', 'icudtl.dat'), Buffer.alloc(128, 1));
  await file(join(base, 'app-1.2.4', 'icudtl.dat'), Buffer.alloc(128, 1));
  await file(join(base, 'Update.exe'), Buffer.alloc(256, 1));
  const p = await classifyPath(base, 'custom');
  assert.ok(p, 'kume uretilmeli');
  assert.equal(p.archetype, 'versioned-app-store');
  assert.equal(
    (p.deleteTargets ?? []).length,
    0,
    'guncel surum dogrulanamadiysa hicbir surum hedeflenmez',
  );
});
