import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * KABUK SINIRI.
 *
 * Web yalnizca istek/gosterim katmanidir. Node builtin'i, servis/aksiyon
 * katmani veya cekirdek karar siniflari import EDILEMEZ. Tek istisna:
 * sozlesme tipleri (`contract.ts`) ve saf onay kurali (`approval.ts`);
 * ikisi de Node'a bagimli degildir ve ayni kurali paylasir.
 */

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('web kabugu node builtin ve servis/aksiyon import edemez', async () => {
  const files = await walk(join('web', 'src'));
  assert.ok(files.length > 0);

  for (const file of files) {
    const text = await readFile(file, 'utf8');
    assert.equal(/from ['"]node:/.test(text), false, `${file}: node builtin`);
    assert.equal(
      /from ['"][^'"]*src\/(services|actions|web)\//.test(text),
      false,
      `${file}: servis/aksiyon importu`,
    );
    for (const match of text.matchAll(/from ['"]([^'"]*src\/core\/[^'"]+)['"]/g)) {
      const path = match[1] ?? '';
      assert.ok(
        path.endsWith('contract.ts') ||
          path.endsWith('approval.ts') ||
          // saf biçimlendirici; Node'a bağımlı değil; sütun sırası ve kaçış kuralı motorda kalır (AGENTS.md kural 18)
          path.endsWith('audit-export.ts') ||
          // tarama kontrolü (faz + tuş niyeti + SSE olay → bilgi türü); saf TS, DOM/node builtin yok (B19/B21)
          path.endsWith('scan-control.ts') ||
          // plan menusu rozeti (kayit sayimi + bekleyen sayisi); saf TS, yalniz
          // contract tipi import eder — sayim motorda kalir (AGENTS.md kural 18)
          path.endsWith('plan-badge.ts'),
        `${file}: izin verilmeyen cekirdek importu: ${path}`,
      );
    }
  }
});
