import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { formatBytes, formatDateTime } from '../util/format.ts';
import { prettyPath } from '../util/longpath.ts';
import { findVaultEntry, listVaultEntries, restoreAllVault, restoreVaultEntry } from '../actions/vault.ts';

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
  cyan: '\x1b[36m', gray: '\x1b[90m',
};

/**
 * Geri alma: Windows Geri Donusum Kutusu yerine aracin KENDI kasasi.
 *
 * Kaynak: `%LOCALAPPDATA%\residue\vault\<batch>\manifest.json`.
 * Kalici silinen (purge) kayitlar geri getirilemez.
 */
export async function runUndo(args: string[]): Promise<void> {
  const allowRestore = args.includes('--restore');
  const idIdx = args.indexOf('--id');
  const id = idIdx >= 0 ? args[idIdx + 1] : undefined;
  if (allowRestore && id) {
    const entry = await findVaultEntry(id);
    if (!entry) {
      console.log(`${C.red}Kasa kaydi bulunamadi:${C.reset} ${id}\n`);
      return;
    }
    const r = await restoreVaultEntry(entry);
    if (r.restored) {
      console.log(`\n${C.green}Geri yuklendi:${C.reset} ${prettyPath(r.to)}`);
      if (r.conflict) {
        const label =
          r.targetState === 'newer'
            ? 'orijinal konumda daha yeni icerik vardi'
            : r.targetState === 'older'
              ? 'orijinal konumda daha eski icerik vardi'
              : r.targetState === 'empty'
                ? 'orijinal konumda bos klasor vardi'
                : 'orijinal yolda baska icerik vardi';
        console.log(`${C.yellow}Cakisma: ${label}; kopya yan ada kondu.${C.reset}`);
      }
      if (!r.verified) console.log(`${C.red}Dogrulama basarisiz; dosyalari kontrol edin.${C.reset}`);
    } else {
      console.log(`${C.red}Geri yuklenemedi:${C.reset} ${r.reason ?? 'bilinmeyen hata'}`);
    }
    console.log('');
    return;
  }
  const entries = await listVaultEntries();

  console.log(`\n${C.bold}Residue — kasa / geri alma${C.reset}\n`);
  if (entries.length === 0) {
    console.log(`${C.yellow}Kasada geri alinacak kayit yok.${C.reset}`);
    console.log(`${C.dim}Kalici silinen dosyalar geri getirilemez.${C.reset}\n`);
    return;
  }

  const total = entries.reduce((a, e) => a + e.bytes, 0);
  console.log(
    `  ${C.green}Kasada (geri alinabilir):${C.reset} ${entries.length} kayit, ${formatBytes(total)}`,
  );
  console.log(`\n${C.bold}Son kasaya alinanlar:${C.reset}`);
  for (const e of entries.slice(0, 12)) {
    console.log(
      `  ${C.green}[kasa]${C.reset} ${prettyPath(e.originalPath)} ${C.gray}${formatBytes(e.bytes)}${C.reset} ${C.gray}${formatDateTime(e.at)}${C.reset}`,
    );
  }
  if (entries.length > 12) {
    console.log(`  ${C.dim}... +${entries.length - 12} kayit daha${C.reset}`);
  }

  if (!allowRestore) {
    console.log(`\n${C.gray}Geri yuklemek icin:${C.reset} ${C.cyan}residue undo --restore${C.reset}\n`);
    return;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  const ans = await rl.question(`${C.yellow}Kasayi geri yuklemek icin 'evet': ${C.reset}`);
  rl.close();

  if (!/^evet|^e$|^yes|^y$/i.test(ans.trim())) {
    console.log(`${C.yellow}Iptal.${C.reset}`);
    return;
  }

  const r = await restoreAllVault();
  console.log(`\n${C.green}Geri yuklendi: ${r.restored} kayit${C.reset}`);
  if (r.conflict > 0) {
    console.log(
      `${C.yellow}Cakisma: ${r.conflict} kayit orijinal yolda icerik oldugu icin ".restored-<zaman>" olarak geri kondu.${C.reset}`,
    );
  }
  if (r.failed > 0) console.log(`${C.red}Basarisiz: ${r.failed}${C.reset}`);
  if (r.unverified > 0) {
    console.log(`${C.yellow}Dogrulanamayan: ${r.unverified} (dosya sayisi/boyutu eslesmedi)${C.reset}`);
  }
  console.log('');
}
