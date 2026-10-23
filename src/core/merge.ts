import type { Cluster, DeleteTarget, Part, ScanResult, ScanStats, SkippedEntry } from './types.ts';

/**
 * Kumelestirme: ayni uygulamanin/env'in bosta kalan parcalarini birlestirir.
 *
 * Ornek (bu makinede gercek):
 *   ~/.MuhasibPro/cache/models   -> 4.9 GB
 *   ~/.MuhasibPro/ep/cuda-ep     -> 2.3 GB
 *   AppData/Roaming/MuhasibPro   -> 0.8 MB
 *   => tek kume: "MuhasibPro — yerel model deposu"
 *
 * Birlestirme anahtari `analyze.ts` icindeki clusterKey() ile ayni mantikla
 * hesaplanir: paket adi, dizin adi veya gunlukteki urun adi.
 */
export function mergeClusters(clusters: Cluster[]): Cluster[] {
  const byKey = new Map<string, Cluster>();

  for (const c of clusters) {
    const existing = byKey.get(c.key);
    if (!existing) {
      byKey.set(c.key, { ...c, parts: [...c.parts] });
      continue;
    }

    // Parcalari birlestir
    existing.parts.push(...c.parts);
    existing.totalBytes += c.totalBytes;
    existing.reclaimableBytes += c.reclaimableBytes;
    existing.lastTouched = Math.max(existing.lastTouched, c.lastTouched);

    // SILME HEDEFLERI DE BIRLESIR. Aksi halde ikinci parcanin hedefleri
    // sessizce kaybolur: kullanici kumeyi siler, yalnizca ilk parca
    // temizlenir. Ayni yol iki kez eklenmez.
    const merged = new Map<string, DeleteTarget>();
    for (const t of [...(existing.deleteTargets ?? []), ...(c.deleteTargets ?? [])]) {
      merged.set(`${t.path.toLowerCase()}|${t.kind}`, t);
    }
    existing.deleteTargets = [...merged.values()];

    // Kanitlari birlestir (yinelenmeden)
    existing.evidence = {
      owner: existing.evidence.owner ?? c.evidence.owner,
      fileKinds: uniq([
        ...(existing.evidence.fileKinds ?? []),
        ...(c.evidence.fileKinds ?? []),
      ]),
      markers: uniq([...(existing.evidence.markers ?? []), ...(c.evidence.markers ?? [])]),
      logSignals: dedupe([...(existing.evidence.logSignals ?? []), ...(c.evidence.logSignals ?? [])]),
      largeFiles: [...(existing.evidence.largeFiles ?? []), ...(c.evidence.largeFiles ?? [])]
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 12),
      lastTouched: existing.evidence.lastTouched,
    };

    // Karar: en yuksek risk ve en geri durucu tur korunur.
    existing.archetype = strongerArchetype(existing.archetype, c.archetype);
    existing.verdict = mergeVerdict(existing.verdict, c.verdict);
    existing.title = existing.title;
  }

  const out = [...byKey.values()];
  // Siralama: once gercekten silinebilecek miktar, sonra toplam boyut
  out.sort((a, b) => b.reclaimableBytes - a.reclaimableBytes || b.totalBytes - a.totalBytes);
  return out;
}

const ARCHETYPE_RANK: Record<string, number> = {
  'virtual-disk': 100,
  'os-user-data': 95,
  'project-workspace': 90,
  'project-artifact': 88,
  'agent-workspace': 80,
  'global-packages': 65,
  'model-store': 50,
  'runtime-pool': 45,
  'accelerator-runtime': 40,
  'editor-extension-store': 35,
  'versioned-app-store': 30,
  'pkg-manager-cache': 20,
  'updater-staging': 15,
  'crash-artifacts': 10,
  'temp-scratch': 8,
  'electron-app-data': 25,
  unknown: 50,
};

/**
 * Mimari tip secimi: guvenli tarafa dogru degismez.
 *
 * Niye: bir klasorun "paket onbellegi" olarak TANIMLANMASI zaten bir
 * kanit kararidir. Kume icinde baska bir parc "tanimlanamayan" olsa
 * bile, onbellegi olarak siniflanan bir yol onbellek olarak kalir.
 * Aksi halde her cumle iceren bir log, guvenli bir onbellegi
 * "dogrulama"ya dusururdu.
 */
const SAFEST_ARCHETYPES = new Set([
  'pkg-manager-cache',
  'crash-artifacts',
  'updater-staging',
  'temp-scratch',
  'electron-app-data',
  'editor-extension-store',
  'versioned-app-store',
]);

function strongerArchetype(a: Cluster['archetype'], b: Cluster['archetype']): Cluster['archetype'] {
  const inA = SAFEST_ARCHETYPES.has(a);
  const inB = SAFEST_ARCHETYPES.has(b);
  if (inA && !inB) return a;
  if (inB && !inA) return b;
  return (ARCHETYPE_RANK[a] ?? 50) >= (ARCHETYPE_RANK[b] ?? 50) ? a : b;
}

/**
 * Karar birlestirme.
 *
 * Onemli: risk, en YUKSEK degil, EN ANLAMLI olandan gelir. Bir kume
 * icinde "tanimlanamayan klasor" diye bir parc varsa, tum kume
 * tanimlanamayan sayilmaz — aks halde 15 GB'lik onbellek, icindeki
 * tek bir log dosyasi yuzunden "dogrulama"ya dusuyordu.
 */
function mergeVerdict(a: Cluster['verdict'], b: Cluster['verdict']) {
  const riskRank = { safe: 0, low: 1, medium: 2, high: 3 } as const;
  const pick = riskRank[a.risk] >= riskRank[b.risk] ? a : b;
  return {
    ...pick,
    because: uniq([...a.because, ...b.because]).slice(0, 10),
    preconditions: uniq([...a.preconditions, ...b.preconditions]),
  };
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function dedupe<T extends { means: string }>(xs: T[]): T[] {
  const m = new Map<string, T>();
  for (const x of xs) if (!m.has(x.means)) m.set(x.means, x);
  return [...m.values()].slice(0, 8);
}

/** Kumeleri risk ve karar turune gore bol. */
export function groupByVerdict(clusters: Cluster[]) {
  const groups = {
    recommend: [] as Cluster[],
    ask: [] as Cluster[],
    'report-only': [] as Cluster[],
    keep: [] as Cluster[],
  };
  for (const c of clusters) groups[c.verdict.kind].push(c);
  return groups;
}

/** Ozet istatistik. */
export function summarize(clusters: Cluster[], stats?: ScanStats): {
  totalBytes: number;
  reclaimableBytes: number;
  recommendedBytes: number;
  askBytes: number;
  reportOnlyBytes: number;
} {
  let total = 0;
  let reclaim = 0;
  let rec = 0;
  let ask = 0;
  let ro = 0;
  for (const c of clusters) {
    total += c.totalBytes;
    reclaim += c.reclaimableBytes;
    if (c.verdict.kind === 'recommend') rec += c.reclaimableBytes;
    else if (c.verdict.kind === 'ask') ask += c.reclaimableBytes;
    else ro += c.reclaimableBytes;
  }
  void stats;
  return {
    totalBytes: total,
    reclaimableBytes: reclaim,
    recommendedBytes: rec,
    askBytes: ask,
    reportOnlyBytes: ro,
  };
}

export type { ScanResult, SkippedEntry, Part };