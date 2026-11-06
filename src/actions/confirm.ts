import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { ApprovalRules } from '../core/approval.ts';
import type { DeleteMode, DeletePlan } from './delete.ts';

/**
 * Iki asamali onay.
 *
 * Asama 1 — KONTROL: her hedefin yolu, boyutu, ya filtresi ve riski
 *           tek tek listelenir. Kullanici ne silinecegini gorur.
 * Asama 2 — ONAY:  risk duzeyine gore farkli guclu onay istenir.
 *
 *   dusuk risk  → sadece "evet"
 *   orta risk  → yazilması gereken ifade (kasa: "TASI", kalici: "SIL")
 *   yuksek risk → her hedef icin ayri onay + yazili ifade
 *
 * Amac: yanlislikla silmeyi imkansiz kilmak. Onay ekranindaki
 * satirlarda gercek yollar gorunur; "hepsini sil" gibi belirsiz
 * bir islem yapilmaz.
 */

export interface ConfirmOptions {
  /** Etkilesimli mod (false ise --yes varsayilir) */
  interactive: boolean;
  /** Risk duzeyine gore zorunlu yazili onay */
  phrase?: string;
}

export interface ApprovalResult {
  approved: boolean;
  /** Kullaniciya gosterilecek sebep */
  reason?: string;
}

/** Asama 1: plani gorunur sekilde yazdirir. */
export function renderPlan(plan: DeletePlan): void {
  const L: string[] = [];
  L.push('');
  L.push(`  ${plan.clusters.length} kume / ${plan.targets.length} hedef`);
  L.push('');

  for (const c of plan.clusters) {
    const riskTag =
      c.risk === 'high' ? '[YUKSEK RISK]' : c.risk === 'medium' ? '[ORTA RISK]' : '';
    L.push(`  ${riskTag} ${c.title}`);
    if (riskTag) L.push(`         ${c.reason}`);
    for (const pt of c.targets) {
      const t = pt.target;
      const mode = t.kind === 'older' ? `yalnizca ${t.minAgeDays}+ gun eski dosyalar` : 'klasorun tamami';
      L.push(`    -> ${t.path}`);
      L.push(`       ${format(pt.bytes)} · ${mode}`);
    }
    L.push('');
  }
  stdout.write(L.join('\n') + '\n');
}

/** Asama 2: riske gore kademeli onay. */
export async function confirmPlan(
  plan: DeletePlan,
  opts: ConfirmOptions,
): Promise<ApprovalResult> {
  const hasHigh = plan.clusters.some((c) => c.risk === 'high');
  const hasMedium = plan.clusters.some((c) => c.risk === 'medium');

  // 3.0: planlar yalniz kasaya tasima modundadir; kalici silme yolu yok.
  const approvalKind = 'vaultMove' as const;
  const phrase = ApprovalRules.requiresPhrase(plan.clusters.map((c) => c.risk))
    ? ApprovalRules.phrase(approvalKind)
    : (opts.phrase ?? '');
  const label = hasHigh ? 'YUKSEK RISK' : hasMedium ? 'ORTA RISK' : 'dusuk risk';

  if (!opts.interactive) {
    // --yes: yazili onay gerektiren durumlarda yine de calismaz.
    // Bu, "otomatik sil"in guvenli tarafta kalmasi icin kasitlidir.
    if (phrase) {
      return {
        approved: false,
        reason: `${label} islem --yes ile calistirilamaz; elle onay gerekli`,
      };
    }
    return { approved: true };
  }

  const rl = createInterface({ input: stdin, output: stdout });

  if (hasHigh) {
    // En tehlikeli durum: her kumeyi tek tek sor
    for (const c of plan.clusters.filter((x) => x.risk === 'high')) {
      stdout.write(`\n  ${c.title}\n    ${c.reason}\n`);
      const a = await rl.question('    Bu kume kasaya tasinsin mi? (evet/hayir): ');
      if (!isYes(a)) {
        rl.close();
        return { approved: false, reason: 'kullanici vazgecildi' };
      }
    }
  }

  stdout.write(`\n  ${format(plan.totalBytes)} kasaya tasinacak (${label})\n`);
  stdout.write('  Aracin kendi kasasina tasinacak - geri alinabilir.\n');

  const prompt = phrase
    ? `  Onaylamak icin "${phrase}" yaz: `
    : `  Onayliyor musun? (evet/hayir): `;
  const ans = await rl.question(prompt);
  rl.close();

  if (phrase) {
    if (ans.trim() !== phrase) {
      return { approved: false, reason: `onay metni eslesmedi` };
    }
  } else if (!isYes(ans)) {
    return { approved: false, reason: 'kullanici vazgecildi' };
  }

  return { approved: true };
}

function isYes(s: string): boolean {
  // NOT: `h` Turkce'de "hayir" demektir; onay olarak kabul edilmez.
  return /^(evet|e|yes|y|ev)$/i.test(s.trim());
}

function format(n: number): string {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${u[i]}`;
}

export type { DeleteMode };