import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

/**
 * Kaynak hijyeni — C11.
 *
 * AGENTS.md kural 1: kaynak kodda tek bir uygulama adi gecmez. Siniflandirma
 * kararlari yalnizca kanit turlerinden gelir (CACHEDIR.TAG, nupkg duzeni,
 * log satiri imzasi...); bir urunun adina kodda ozel kural yazilmaz.
 *
 * Bu test `src/` altindaki .ts dosyalarini satir satir tarar ve yasakli
 * uygulama adlarini arar. Test dosyalari ve fixture'lar kapsam disidir
 * (yalnizca src/ yurur). `Residue` (kendi urun adimiz) yasakli DEGILDIR.
 */

const SRC_ROOT = join(process.cwd(), 'src');

/** Yasakli uygulama adlari: ad-metin, icinde gecen her yerde ihlaldir. */
const BANNED: Array<{ label: string; re: RegExp }> = [
  { label: 'MuhasibPro', re: /muhasibpro/i },
  { label: 'muhasib', re: /muhasib/i },
  { label: 'opencode', re: /opencode/i },
  { label: 'claude', re: /claude/i },
  { label: 'VS Code', re: /\bvs\s?code\b/i },
  { label: 'vscode', re: /vscode/i },
  { label: 'Figma', re: /\bfigma\b/i },
  { label: 'Mullvad', re: /\bmullvad\b/i },
  { label: 'KiloDesktop', re: /kilodesktop/i },
  { label: 'Azure AI Foundry', re: /azure\s+ai\s+foundry/i },
  { label: 'clicleaner', re: /clicleaner/i },
];

async function collectTsFiles(dir: string, out: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      // Derlenmis cikti / bagimlilik klasorleri kaynak degildir.
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      await collectTsFiles(full, out);
    } else if (e.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

test('kaynak hijyeni: src/ altinda teslim edilen .ts dosyasi sayisi sifirdan buyuk', async () => {
  const files = await collectTsFiles(SRC_ROOT);
  assert.ok(
    files.length > 0,
    `src/ altinda .ts dosyasi bulunamadi (kok: ${process.cwd()}) — test bozuk dizinden calisiyor olabilir`,
  );
});

test('kaynak hijyeni: src/ icinde yasakli uygulama adi gecmez', async () => {
  const files = await collectTsFiles(SRC_ROOT);
  const violations: string[] = [];
  for (const f of files) {
    const lines = (await readFile(f, 'utf8')).split(/\r?\n/);
    for (const [i, line] of lines.entries()) {
      for (const b of BANNED) {
        if (b.re.test(line)) {
          violations.push(`${relative(process.cwd(), f)}:${i + 1} — yasakli ad: ${b.label}`);
        }
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `kaynak kodda uygulama adi geciyor (kural 1):\n${violations.join('\n')}`,
  );
});
