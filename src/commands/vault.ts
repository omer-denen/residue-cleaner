import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import {
  expiredVaultEntries,
  listVaultEntries,
  loadVaultIndex,
  purgeExpiredVault,
  purgeVaultItems,
  rebuildVaultIndex,
  restoreVaultEntry,
} from '../actions/vault.ts';
import { ApprovalRules } from '../core/approval.ts';
import { loadSettings } from '../store/settings.ts';
import { formatBytes, formatDateTime } from '../util/format.ts';
import { prettyPath } from '../util/longpath.ts';

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
  cyan: '\x1b[36m', gray: '\x1b[90m',
};

/**
 * `residue vault` — kasa envanteri, saklama suresi ve kalici silme.
 *
 * Kalici silme YALNIZCA kasa kimligi ile yapilir ve yazili onay ister.
 * Suresi dolmus ogeler otomatik silinmez; kullanici acikca ister.
 */
export async function runVault(args: string[]): Promise<void> {
  const json = args.includes('--json');
  const sub = args.find((a) => !a.startsWith('-')) ?? 'list';
  const settings = await loadSettings();

  if (sub === 'list' || sub === 'expired') {
    const entries = await listVaultEntries();
    const now = Date.now();
    const rows = entries.map((e) => {
      const ageDays = Math.floor(Math.max(0, now - e.at) / 86_400_000);
      return {
        ...e,
        ageDays,
        remainingDays: Math.max(0, settings.vaultRetentionDays - ageDays),
        expired: ageDays >= settings.vaultRetentionDays,
      };
    });
    const selected = sub === 'expired' ? rows.filter((r) => r.expired) : rows;
    if (json) {
      console.log(JSON.stringify({ retentionDays: settings.vaultRetentionDays, entries: selected }, null, 2));
      return;
    }
    console.log(`\n  ${C.bold}Residue — kasa${C.reset} (saklama: ${settings.vaultRetentionDays} gun)\n`);
    if (selected.length === 0) {
      console.log(`  ${C.gray}Kayit yok.${C.reset}\n`);
      return;
    }
    for (const e of selected) {
      const tag = e.expired ? `${C.red}suresi dolmus${C.reset}` : `${C.gray}${e.remainingDays} gun kaldi${C.reset}`;
      console.log(`  ${C.cyan}${e.id}${C.reset} ${prettyPath(e.originalPath)}`);
      console.log(`    ${formatBytes(e.bytes)} · ${e.files} dosya · ${formatDateTime(e.at)} · ${tag}`);
    }
    console.log('');
    return;
  }

  if (sub === 'restore') {
    const id = valueOf(args, '--id');
    if (!id) throw new Error('Kullanim: residue vault restore --id <kasa-id>');
    const entry = (await listVaultEntries()).find((e) => e.id === id);
    if (!entry) {
      console.log(`  ${C.red}Kayit bulunamadi:${C.reset} ${id}\n`);
      return;
    }
    const r = await restoreVaultEntry(entry);
    if (json) console.log(JSON.stringify(r, null, 2));
    else {
      console.log(
        `\n  ${r.restored ? C.green + 'Geri yuklendi' : C.red + 'Basarisiz'}${C.reset} ` +
          `${prettyPath(r.to)}${r.verified ? '' : ' (dogrulanamadi)'}\n`,
      );
    }
    return;
  }

  if (sub === 'index') {
    const r = await rebuildVaultIndex();
    const idx = await loadVaultIndex();
    if (json) console.log(JSON.stringify({ ...r, rebuilt: idx.rebuilt }, null, 2));
    else console.log(`  ${C.green}Indeks yeniden olusturuldu:${C.reset} ${r.entries} kayit / ${r.batches} parti\n`);
    return;
  }

  if (sub === 'purge') {
    const id = valueOf(args, '--id');
    const expired = args.includes('--expired');
    if (!id && !expired) {
      throw new Error('Kullanim: residue vault purge --id <kasa-id> | --expired');
    }
    let phrase = valueOf(args, '--phrase') ?? '';
    if (!phrase && stdin.isTTY) {
      const rl = createInterface({ input: stdin, output: stdout });
      phrase = await rl.question(`  Kalici silme icin "${ApprovalRules.phrase('vaultPurge')}" yaz: `);
      rl.close();
    }
    if (!ApprovalRules.matches('vaultPurge', phrase)) {
      console.log(`  ${C.red}Onay ifadesi hatali.${C.reset}\n`);
      return;
    }
    const r = id
      ? await purgeVaultItems([id])
      : await purgeExpiredVault(settings.vaultRetentionDays);
    if (json) {
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    console.log(
      `\n  ${r.ok ? C.green : C.red}${r.ok ? 'Kalici silindi' : 'Kismi basarisiz'}${C.reset} — ` +
        `${r.items} oge, ${formatBytes(r.bytes)}, ${r.failed} hata\n`,
    );
    for (const n of r.notices) {
      console.log(
        `  ${C.yellow}!${C.reset} ${prettyPath(n.originalPath)}: orijinal konumda daha yeni icerik var; ` +
          'kasadaki eski kopya kalici olarak silindi.',
      );
    }
    for (const p of r.prunedEntries) {
      console.log(
        `  ${C.cyan}!${C.reset} ${prettyPath(p.originalPath)}: ${p.reason}. Veri silinmedi.`,
      );
    }
    for (const e of r.errors) console.log(`  ${C.red}!${C.reset} ${e.id}: ${e.reason}`);
    return;
  }

  console.log('  Kullanim: residue vault [list|expired|restore|purge|index] [--json]');
}

function valueOf(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}
