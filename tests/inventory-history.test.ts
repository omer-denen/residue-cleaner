import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findHistoryMentions, usageVerdict } from '../src/core/cli-inventory.ts';
import type { HistoryData, UsageInput } from '../src/core/cli-inventory.ts';

// T69/F4 (K19): kabuk gecmis ayristiricisi paket calistiricilarini tanir
// (npx @scope/pkg, pnpm dsh web, dotnet tool run x, yarn dlx/bunx/uvx/pipx)
// ve kurulum satirlarini kullanim saymaz. Salt nesnelerle kurulur; dosya
// G/CI yoktur. Gecmis yalniz "en az bir kez kullanildi" kanitidir; zaman
// tasiyamaz (kural 21) — karar tarafi bunu `recent` icin kullanmaz.

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-23T12:00:00Z');

function hist(...lines: string[]): HistoryData {
  return { files: ['h'], lines, lastWrite: NOW, available: true };
}

function usageInput(over: Partial<UsageInput> = {}): UsageInput {
  return {
    now: NOW,
    unusedDays: 21,
    command: 'ornek',
    source: 'standalone',
    packageName: 'ornek',
    installedAt: NOW - 60 * DAY,
    lastAccessAt: 0,
    state: { dirs: [], lastMtime: 0, lastAtime: 0 },
    history: { files: ['h'], lines: [], lastWrite: 0, available: true },
    atimeReliable: true,
    ...over,
  };
}

test('F4-1: npx @scope/ornek web - kapsamli paket belirteci son parca ile eslesir', () => {
  assert.equal(findHistoryMentions(hist('npx @scope/ornek web'), 'ornek').mentions, 1);
  // packageName ayniysa da eslesir
  assert.equal(
    findHistoryMentions(hist('npx @scope/ornek web'), 'ornek', '@scope/ornek').mentions,
    1,
  );
});

test('F4-2: paket yoneticisi calistirma bicimleri (pnpm/yarn dlx/bunx)', () => {
  assert.equal(findHistoryMentions(hist('pnpm ornek web'), 'ornek').mentions, 1);
  assert.equal(findHistoryMentions(hist('pnpm run ornek'), 'ornek').mentions, 1);
  assert.equal(findHistoryMentions(hist('yarn dlx ornek'), 'ornek').mentions, 1);
  assert.equal(findHistoryMentions(hist('bunx ornek'), 'ornek').mentions, 1);
  assert.equal(findHistoryMentions(hist('bun ornek'), 'ornek').mentions, 1);
  assert.equal(findHistoryMentions(hist('bun run ornek'), 'ornek').mentions, 1);
  assert.equal(findHistoryMentions(hist('yarn ornek'), 'ornek').mentions, 1);
});

test('F4-3: dotnet tool run ve dotnet <ad>', () => {
  assert.equal(findHistoryMentions(hist('dotnet tool run ornek'), 'ornek').mentions, 1);
  assert.equal(findHistoryMentions(hist('dotnet ornek'), 'ornek').mentions, 1);
  // dotnet SDK fiilleri paket konumu saglamaz
  assert.equal(findHistoryMentions(hist('dotnet test'), 'ornek').mentions, 0);
  assert.equal(findHistoryMentions(hist('dotnet build'), 'ornek').mentions, 0);
});

test('F4-4: kurulum satirlari kullanim DEGIL', () => {
  assert.equal(findHistoryMentions(hist('npm install -g ornek'), 'ornek').mentions, 0);
  assert.equal(findHistoryMentions(hist('npm i -g ornek'), 'ornek').mentions, 0);
  assert.equal(findHistoryMentions(hist('npm uninstall ornek'), 'ornek').mentions, 0);
  assert.equal(findHistoryMentions(hist('npm remove ornek'), 'ornek').mentions, 0);
  assert.equal(findHistoryMentions(hist('npm rm ornek'), 'ornek').mentions, 0);
  assert.equal(findHistoryMentions(hist('pnpm add ornek'), 'ornek').mentions, 0);
  assert.equal(findHistoryMentions(hist('pnpm install ornek'), 'ornek').mentions, 0);
  assert.equal(findHistoryMentions(hist('pnpm remove ornek'), 'ornek').mentions, 0);
  assert.equal(findHistoryMentions(hist('yarn add ornek'), 'ornek').mentions, 0);
  assert.equal(findHistoryMentions(hist('yarn install ornek'), 'ornek').mentions, 0);
  assert.equal(findHistoryMentions(hist('yarn remove ornek'), 'ornek').mentions, 0);
  assert.equal(findHistoryMentions(hist('bun add ornek'), 'ornek').mentions, 0);
  assert.equal(findHistoryMentions(hist('bun install ornek'), 'ornek').mentions, 0);
  assert.equal(findHistoryMentions(hist('bun remove ornek'), 'ornek').mentions, 0);
  assert.equal(findHistoryMentions(hist('pipx install ornek'), 'ornek').mentions, 0);
  assert.equal(findHistoryMentions(hist('uv tool install ornek'), 'ornek').mentions, 0);
  assert.equal(findHistoryMentions(hist('dotnet tool install ornek'), 'ornek').mentions, 0);
  // Muhafazakar: kurulum satirinin ilerisindeki komut da sayilmaz
  assert.equal(
    findHistoryMentions(hist('npm install -g ornek && ornek --surum'), 'ornek').mentions,
    0,
  );
  // sudo onceki kurulum satiri
  assert.equal(findHistoryMentions(hist('sudo npm install -g ornek'), 'ornek').mentions, 0);
});

test('F4-5: komut konumunda olmayan belirtec eslesmez (mevcut davranis)', () => {
  assert.equal(findHistoryMentions(hist('baska ornek'), 'ornek').mentions, 0);
});

test('F4-6: yalin komut, surum bayragi ve sudo (mevcut davranis korunur)', () => {
  assert.equal(findHistoryMentions(hist('ornek --surum'), 'ornek').mentions, 1);
  assert.equal(findHistoryMentions(hist('sudo ornek'), 'ornek').mentions, 1);
  assert.equal(findHistoryMentions(hist('ornek'), 'ornek').mentions, 1);
});

test('F4-7: && sonrasi calistirici cagrisi', () => {
  assert.equal(findHistoryMentions(hist('foo && npx @scope/ornek'), 'ornek').mentions, 1);
});

test('F4-8: packageName farkliyken paket son parcasiyla eslesme', () => {
  // paket son parcasi eslesir -> kullanim
  assert.equal(
    findHistoryMentions(hist('npx @scope/ornek-cli'), 'ornek', '@scope/ornek-cli').mentions,
    1,
  );
  assert.equal(
    findHistoryMentions(hist('pnpm dlx @scope/ornek-cli'), 'ornek', '@scope/ornek-cli')
      .mentions,
    1,
  );
  // belirtecin son parcasi komut adinin kendisi -> kullanim
  assert.equal(
    findHistoryMentions(hist('npx @scope/ornek'), 'ornek', '@scope/ornek-cli').mentions,
    1,
  );
  // baska paket: son parca ne komut ne paket -> 0
  assert.equal(
    findHistoryMentions(hist('npx @scope/altyapici'), 'ornek', '@scope/ornek-cli').mentions,
    0,
  );
});

test('F4-9: dogrudan bicimler (./ .\\ .exe tirnak tam yol)', () => {
  assert.equal(findHistoryMentions(hist('./ornek --flag'), 'ornek').mentions, 1);
  assert.equal(findHistoryMentions(hist('.\\ornek --flag'), 'ornek').mentions, 1);
  assert.equal(findHistoryMentions(hist('ornek.exe arg'), 'ornek').mentions, 1);
  assert.equal(findHistoryMentions(hist('"ornek" --flag'), 'ornek').mentions, 1);
  assert.equal(findHistoryMentions(hist("'ornek' --flag"), 'ornek').mentions, 1);
  // tam yol: son bilesen alinir
  assert.equal(findHistoryMentions(hist('C:\\py\\ornek.exe --health'), 'ornek').mentions, 1);
});

test('F4-10: calistirici bayraklari paket konumunu karistirmaz', () => {
  assert.equal(findHistoryMentions(hist('npx -y ornek'), 'ornek').mentions, 1);
  assert.equal(findHistoryMentions(hist('npx --yes ornek --flag'), 'ornek').mentions, 1);
  assert.equal(findHistoryMentions(hist('npx -p x ornek'), 'ornek').mentions, 1);
  assert.equal(findHistoryMentions(hist('uvx -p 3.11 ornek'), 'ornek').mentions, 1);
  assert.equal(findHistoryMentions(hist('npm exec -- ornek'), 'ornek').mentions, 1);
  assert.equal(findHistoryMentions(hist('pnpm exec ornek'), 'ornek').mentions, 1);
  assert.equal(findHistoryMentions(hist('pipx run ornek'), 'ornek').mentions, 1);
});

test('F4-11: baska aracin kurulmasi/calistirilmasi eslesmez', () => {
  const h = hist('npm install -g baskapaket', 'baskapaket --v');
  assert.equal(findHistoryMentions(h, 'ornek').mentions, 0);
});

test('F4-12: buyuk/kucuk harf duyarsiz eslesme', () => {
  assert.equal(findHistoryMentions(hist('NPX @SCOPE/Ornek web'), 'ornek').mentions, 1);
  assert.equal(findHistoryMentions(hist('Ornek.EXE --flag'), 'ornek').mentions, 1);
});

test('F4-13: gecmis tek dogrulayiciyken unknown (medium); recent DEGIL', () => {
  // K19 gercek durumu: npx @deepseek-ai/dsh web, komut dsh
  const v = usageVerdict(
    usageInput({
      command: 'dsh',
      packageName: '@deepseek-ai/dsh',
      history: hist('npx @deepseek-ai/dsh web', 'pnpm dsh web'),
    }),
  );
  assert.equal(v.mentions, 2);
  assert.equal(v.status, 'unknown');
  assert.equal(v.confidence, 'medium');
});

test('F4-14: lastRatio satir sirasi orani; sayac kumesi genislemesinden etkilenmez', () => {
  const h = hist('ilgisiz satir', 'npx ornek', 'ilgisiz diger');
  const r = findHistoryMentions(h, 'ornek');
  assert.equal(r.mentions, 1);
  assert.ok(Math.abs(r.lastRatio - 2 / 3) < 1e-9, `lastRatio=${r.lastRatio}`);
});

// T69/F4b: paket calistiricisinda paket/alt komut, bayraklar atlandiktan
// sonraki ILK belirteçtir; sonraki belirtecler argumandir ve kullanim sayilmaz.

test('F4-15: calistirici argumani kullanim sayilmaz', () => {
  // 'ornek' burada bir-baska-arac'in argümanidir, paket degildir
  assert.equal(findHistoryMentions(hist('npx bir-baska-arac ornek'), 'ornek').mentions, 0);
});

test('F4-16: bayraklar sonrasi ilk belirtec pakettir', () => {
  assert.equal(findHistoryMentions(hist('npx ornek --flag'), 'ornek').mentions, 1);
});

test('F4-17: degerli bayrak --from atlanir (uvx --from pkg cmd)', () => {
  // --from baska degeridir; ilk aday 'ornek' olmali
  assert.equal(findHistoryMentions(hist('uvx --from baska ornek'), 'ornek').mentions, 1);
});

test('F4-18: pnpm dlx argumani kullanim sayilmaz', () => {
  assert.equal(
    findHistoryMentions(hist('pnpm dlx bir-baska-arac ornek'), 'ornek').mentions,
    0,
  );
});
