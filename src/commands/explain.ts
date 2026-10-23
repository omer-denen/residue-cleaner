import { runScan } from './scan.ts';
import { formatBytes, formatDateTime, formatAge } from '../util/format.ts';
import { prettyPath } from '../util/longpath.ts';
import type { Cluster } from '../core/types.ts';

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
  cyan: '\x1b[36m', gray: '\x1b[90m',
};

/**
 * Bir kumenin kararini kanitlariyla birlikte aciklar.
 *
 * Kullanim:  residue explain ornek-kume
 * Tarama yapip anahtarla eslesen kume(leri) bulur.
 */
export async function runExplain(query: string | undefined, opts: { json?: boolean } = {}): Promise<void> {
  if (!query) {
    console.log(`Kullanim: residue explain <ad>`);
    console.log(`Ornek : residue explain ornek-kume`);
    console.log(`        residue explain npm-cache`);
    console.log(`        residue explain wsl`);
    return;
  }

  const q = query.toLowerCase();
  const result = await runScan({
    envs: ['dotfolders', 'localappdata', 'roamingappdata'],
    minAgeDays: 0,
    json: true,
    includeBytes: true,
    exclude: [],
    quiet: true,
  });

  const matches = result.clusters.filter(
    (c) => c.key.toLowerCase().includes(q) || c.title.toLowerCase().includes(q),
  );

  if (matches.length === 0) {
    console.log(`${C.yellow}"${query}" icin eslesen kume yok.${C.reset}`);
    console.log(`${C.dim}En buyuk kumeler:${C.reset}`);
    for (const c of result.clusters.slice(0, 8)) {
      console.log(`  ${c.title}  ${C.gray}${formatBytes(c.totalBytes)}${C.reset}`);
    }
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(matches.map(toJson), null, 2));
    return;
  }

  for (const c of matches.slice(0, 3)) printCluster(c);
}

function printCluster(c: Cluster): void {
  const v = c.verdict;
  const riskColor =
    v.risk === 'safe' ? C.green : v.risk === 'low' ? C.cyan : v.risk === 'medium' ? C.yellow : C.red;
  const kindLabel = {
    recommend: 'ONERILEN (otomatik secili)',
    ask: 'DOGRULAMA GEREKIYOR',
    'report-only': 'RAPOR OLUR, SILINMEZ',
    keep: 'KORUNUYOR',
  }[v.kind];

  console.log(`\n${C.bold}${v.title}${C.reset}`);
  console.log(`${C.gray}${'='.repeat(74)}${C.reset}`);
  console.log(`${C.bold}Karar      :${C.reset} ${riskColor}${v.risk.toUpperCase()}${C.reset}  ${C.gray}${kindLabel}${C.reset}`);
  console.log(`${C.bold}Ne         :${C.reset} ${v.what}`);
  console.log(`${C.bold}Sonuc      :${C.reset} ${v.consequence}`);
  console.log(`${C.bold}Boyut      :${C.reset} toplam ${formatBytes(c.totalBytes)}, silinebilir ${C.green}${formatBytes(c.reclaimableBytes)}${C.reset}`);
  console.log(`${C.bold}Son hareket: ${C.reset}${formatDateTime(c.lastTouched)} ${C.gray}(${formatAge(c.lastTouched)})${C.reset}`);
  console.log(`${C.bold}Mimari     : ${C.reset}${C.cyan}${c.archetype}${C.reset}`);

  if (v.because.length > 0) {
    console.log(`\n${C.bold}Neden bu karar:${C.reset}`);
    for (const b of v.because) console.log(`  ${C.gray}-${C.reset} ${b}`);
  }

  if (v.preconditions.length > 0) {
    console.log(`\n${C.bold}Silmeden once:${C.reset}`);
    for (const p of v.preconditions) console.log(`  ${C.yellow}!${C.reset} ${p}`);
  }

  if (c.subparts && c.subparts.length > 0) {
    console.log(`\n${C.bold}Ic parcalar:${C.reset}`);
    for (const s of c.subparts) {
      console.log(`  ${C.green}->${C.reset} ${s.label}  ${C.gray}${formatBytes(s.bytes)}${C.reset}`);
      console.log(`     ${C.gray}${prettyPath(s.path)}${C.reset}`);
      console.log(`     ${C.dim}${s.reason}${C.reset}`);
    }
  }

  if (c.deleteTargets && c.deleteTargets.length > 0) {
    console.log(`\n${C.bold}Silinecek yollar:${C.reset}`);
    for (const t of c.deleteTargets) {
      const mode = t.kind === 'older' ? `sadece ${t.minAgeDays}+ gun eski dosyalar` : 'klasorun tamami';
      console.log(`  ${C.cyan}->${C.reset} ${prettyPath(t.path)}`);
      console.log(`     ${C.dim}${mode}${C.reset}`);
    }
  }

  if (c.parts.length > 1) {
    console.log(`\n${C.bold}Birlestirilen parcalar (${c.parts.length}):${C.reset}`);
    for (const p of c.parts) {
      console.log(`  ${C.gray}${prettyPath(p.path)}  ${formatBytes(p.bytes)}${C.reset}`);
    }
  }

  const ev = c.evidence;
  console.log(`\n${C.bold}Toplanan kanitlar:${C.reset}`);
  console.log(`  ${C.gray}dosya turleri : ${JSON.stringify(ev.fileKinds ?? [])}${C.reset}`);
  console.log(`  ${C.gray}isaretler     : ${JSON.stringify(ev.markers ?? [])}${C.reset}`);
  if (ev.owner) console.log(`  ${C.gray}sahip          : ${JSON.stringify(ev.owner)}${C.reset}`);
  if (ev.logSignals?.length) {
    console.log(`  ${C.gray}log sinyalleri :${C.reset}`);
    for (const l of ev.logSignals) {
      console.log(`    ${C.dim}[${l.means}]${C.reset} ${C.gray}${l.line}${C.reset}`);
    }
  }
  console.log('');
}

function toJson(c: Cluster) {
  return {
    key: c.key,
    title: c.title,
    archetype: c.archetype,
    totalBytes: c.totalBytes,
    reclaimableBytes: c.reclaimableBytes,
    lastTouched: c.lastTouched,
    verdict: c.verdict,
    evidence: c.evidence,
    subparts: c.subparts,
    deleteTargets: c.deleteTargets,
    parts: c.parts,
  };
}