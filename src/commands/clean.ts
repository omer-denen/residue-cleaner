import { runScan } from './scan.ts';
import { deleteTarget, Journal, buildPlan, closeRecycle, type DeleteMode } from '../actions/delete.ts';
import { renderPlan, confirmPlan } from '../actions/confirm.ts';
import { formatBytes } from '../util/format.ts';
import { info, warn, debug } from '../util/log.ts';
import type { Env, SensitiveAllow } from '../core/types.ts';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { longPath, prettyPath } from '../util/longpath.ts';
import { dataDir } from '../core/data-dir.ts';
import { markScanDirty } from '../store/scan-cache.ts';

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
  cyan: '\x1b[36m', gray: '\x1b[90m',
};

export interface CleanArgs {
  envs: Env[];
  profile?: string;
  yes: boolean;
  only?: string[];
  exclude: string[];
  /** Sadece plani goster; hicbir sey silme (guvenli mod) */
  dryRun?: boolean;
  /**
   * T28: hassas siniflar (sohbet gecmisi / modeller / kurallar) varsayilan
   * olarak plana GIRMEZ; yalnizca acik bayrakla acilir. Iki asamali onay
   * her durumda korunur.
   */
  allow?: SensitiveAllow;
}

/**
 * Temizleme akisi — iki asama:
 *
 *   1. LISTELE : tara, kume olustur, silme planini yazdir
 *   2. ONAYLA  : riske gore kademeli onay, sonra ARACIN KENDI KASASINA
 *
 * Kasa varsayilandir (Windows Geri Donusum Kutusu kullanilmaz).
 * 3.0: dogrudan yol kalici silme kaldirildi; bu akis yalniz kasaya tasir.
 */
export async function runClean(args: CleanArgs): Promise<void> {
  const mode: DeleteMode = 'recycle';

  info('temizleme basladi', {
    mode,
    envs: args.envs,
    profile: args.profile,
    only: args.only,
    yes: args.yes,
  });

  console.log(`${C.dim}  Tarama yapiliyor...${C.reset}`);

  const result = await runScan({
    envs: args.envs,
    profile: args.profile,
    minAgeDays: 0,
    json: true,
    includeBytes: true,
    exclude: args.exclude,
    quiet: true,
    allow: args.allow,
  });

  // --- ASAMA 1: listeleme ---
  const plan = buildPlan(result.clusters, mode, args.only, args.allow);

  const flags = [
    args.allow?.history ? '--clear-history' : '',
    args.allow?.models ? '--nuke-models' : '',
    args.allow?.rules ? '--reset-rules' : '',
  ].filter(Boolean);
  if (flags.length > 0) {
    console.log(
      `${C.red}${C.bold}  Hassas temizlik acik: ${flags.join(' ')}${C.reset} ${C.gray}(iki asamali onay yine gecerli)${C.reset}`,
    );
  }

  if (plan.targets.length === 0) {
    console.log(`${C.yellow}Silinecek uygun hedef bulunamadi.${C.reset}`);
    console.log(`${C.dim}Yalnizca "onerilen" ve "dogrulama" gruplarindaki hedefler silinir.${C.reset}\n`);
    warn('hedef bulunamadi', { kume: result.clusters.length, only: args.only });
    return;
  }

  info('plan olusturuldu', {
    kume: plan.clusters.length,
    hedef: plan.targets.length,
    toplamMB: Math.round(plan.totalBytes / 1048576),
    riskDagilimi: plan.clusters.reduce<Record<string, number>>((a, c) => {
      a[c.risk] = (a[c.risk] ?? 0) + 1;
      return a;
    }, {}),
  });

  renderPlan(plan);

  // --- GUVENLI MOD: yalnizca plan ---
  // Kullanici "once ne silinecegini goreyim" derse onay istemeden
  // cikilir. Hicbir dosyaya dokunulmaz; plan tekrar uretilebilir.
  if (args.dryRun) {
    console.log(`${C.yellow}  DRY-RUN: yukaridaki plan gosterildi, hicbir sey silinmedi.${C.reset}`);
    console.log(`${C.dim}  Gercekten silmek icin --dry-run olmadan calistir.${C.reset}\n`);
    info('dry-run tamamlandi', {
      kume: plan.clusters.length,
      hedef: plan.targets.length,
      toplamMB: Math.round(plan.totalBytes / 1048576),
    });
    return;
  }

  // --- ASAMA 2: onay ---
  const approval = await confirmPlan(plan, { interactive: !args.yes });

  if (!approval.approved) {
    info('kullanici iptal etti', { sebep: approval.reason, planMB: Math.round(plan.totalBytes / 1048576) });
    console.log(`${C.yellow}\n  Iptal edildi (${approval.reason}). Hicbir sey silinmedi.${C.reset}\n`);
    return;
  }

  info('onay alindi', { mode, hedef: plan.targets.length });

  // --- Silme ---
  console.log('');
  const journal = new Journal();
  let freed = 0;
  let removed = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const startedAt = Date.now();

  try {
    for (const pt of plan.targets) {
      process.stdout.write(`  ${C.dim}${pt.target.label}...${C.reset} `);
      const r = await deleteTarget(pt.target, mode);
      freed += r.bytesFreed;
      removed += r.removed;
      skippedCount += r.skipped.length;
      failedCount += r.failed.length;

      for (const s of r.skipped) {
        journal.add({ at: Date.now(), mode, action: 'skipped', path: s.path, bytes: 0, reason: s.reason });
      }
      for (const f of r.failed) {
        journal.add({ at: Date.now(), mode, action: 'failed', path: f.path, bytes: 0, reason: f.reason });
      }
      if (r.removed > 0) {
        journal.add({ at: Date.now(), mode, action: 'deleted', path: pt.target.path, bytes: r.bytesFreed });
      }

      const status =
        r.failed.length > 0
          ? `${C.yellow}${r.failed.length} hata${C.reset}`
          : r.skipped.length > 0
            ? `${C.gray}${r.skipped.length} atlandi${C.reset}`
            : `${C.green}ok${C.reset}`;
      const secs = ((Date.now() - startedAt) / 1000).toFixed(0);
      console.log(`${formatBytes(r.bytesFreed)} ${status} ${C.dim}(${secs}s)${C.reset}`);
    }
  } finally {
    // Kalici PowerShell surecini kapat
    closeRecycle();
    info('temizleme bitti', {
      bosaltilanMB: Math.round(freed / 1048576),
      hedef: removed,
      atlandi: skippedCount,
      hata: failedCount,
      sureSn: ((Date.now() - startedAt) / 1000).toFixed(1),
    });
  }

  // --- Gunluk ---
  let journalPath = '';
  try {
    const dir = join(dataDir(), 'journals');
    await mkdir(longPath(dir), { recursive: true });
    journalPath = await journal.save(dir);
  } catch {
    /* gunluk yazilamadi */
  }

  // Web arayuzu sonra acilirsa "son tarama eski" gorunsun: disk degisti.
  if (removed > 0) await markScanDirty();

  // --- Ozet ---
  console.log(`\n${C.bold}  ${'─'.repeat(58)}${C.reset}`);
  console.log(`${C.green}${C.bold}  Bosaltilan : ${formatBytes(freed)}${C.reset}  ${C.gray}(${removed} dosya/klasor)${C.reset}`);
  if (skippedCount > 0) {
    console.log(`${C.gray}  Atlandi    : ${skippedCount} ${C.dim}(kilitli, cok yeni veya kota dolu)${C.reset}`);
  }
  if (failedCount > 0) {
    console.log(`${C.red}  Hata       : ${failedCount}${C.reset}`);
  }
  if (removed > 0) {
    console.log(`${C.cyan}  Geri al    : "residue undo --restore" ile kasadan${C.reset}`);
  }
  if (journalPath) {
    console.log(`${C.dim}  Gunluk     : ${prettyPath(journalPath)}${C.reset}`);
  }
  console.log('');
}