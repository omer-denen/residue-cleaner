/**
 * E2E calistirici — `npm run e2e`.
 *
 * Her senaryo kendi izole sunucusunu ve tarayicisini kurar (agir veri
 * cekmeyen senaryolar icin tek kosu tercih edilir). Cikis kodu: basarisiz
 * kontrol varsa 1.
 */
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Harness } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENARIOS = join(HERE, 'scenarios');

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));

async function main() {
  const files = readdirSync(SCENARIOS)
    .filter((f) => f.endsWith('.mjs'))
    .sort()
    .filter((f) => (only.length === 0 ? true : only.some((o) => f.includes(o))));
  if (files.length === 0) {
    console.error('senaryo bulunamadi');
    process.exitCode = 1;
    return;
  }

  const results = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(join(SCENARIOS, file)).href);
    const title = mod.title ?? file;
    const attempts = [];
    const runOnce = async () => {
      console.log(`\n== ${title}${attempts.length > 0 ? ' (yeniden)' : ''} ==`);
      const h = new Harness();
      const started = Date.now();
      try {
        await h.start();
        const ctx = await h.open(mod.browserOptions ?? {});
        await mod.run(h, ctx);
      } catch (error) {
        h.check(`${title}: senaryo hatasiz kosmali`, false, String(error?.message ?? error).slice(0, 400));
      } finally {
        await h.stop();
      }
      const s = h.summary();
      console.log(
        `  ${s.failed === 0 ? 'TEMIZ' : 'HATA'} — ${s.total - s.failed}/${s.total} kontrol, ${Date.now() - started} ms`,
      );
      return { title, ...s, ms: Date.now() - started };
    };
    // Zaman duyarli kontroller (hizli iptal yarisi, dar ekran olcumu) yuklu
    // makinede tek seferlik dusebilir; bir kez yeniden denenir ve sonuc
    // "yeniden" etiketiyle gorunur. Kalici regresyon iki kosuda da duser.
    let result = await runOnce();
    attempts.push(result);
    if (result.failed > 0) {
      result = await runOnce();
      attempts.push(result);
    }
    results.push(result);
  }

  const total = results.reduce((n, r) => n + r.total, 0);
  const failed = results.reduce((n, r) => n + r.failed, 0);
  console.log(`\nE2E: ${total - failed}/${total} kontrol · ${failed === 0 ? 'TEMIZ' : 'BASARISIZ'}`);
  for (const r of results) {
    if (r.failed > 0) console.log(`  - ${r.title}: ${r.failedNames.join(', ')}`);
  }
  if (failed > 0) process.exitCode = 1;
}

await main();
