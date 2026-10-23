import type { Cluster } from './types.ts';

/**
 * Kategori tureti — TEK kaynak.
 *
 * Kategoriler UYGULAMA ADINDAN degil, KANITTAN turetilir: mimari tip
 * (archetype), dosya turu (fileKind), karar ve sahiplik sinyalleri.
 * Sirasi onemlidir: korunan bir oge "unused" sayilmaz.
 *
 * Bu modul yalnizca SINIFLANDIRIR: hicbir yolu silmez, hedef uretmez.
 */

export type CategoryKey =
  | 'protected'
  | 'duplicate'
  | 'old-version'
  | 'orphan'
  | 'unused'
  | 'ai-debris'
  | 'ghost-envs'
  | 'unknown';

/** Kategori sirasi (kararli; arayuz bunu kullanir). */
export const CATEGORY_ORDER: CategoryKey[] = [
  'protected',
  'duplicate',
  'old-version',
  'orphan',
  'unused',
  'ai-debris',
  'ghost-envs',
  'unknown',
];

export const CATEGORY_LABEL: Record<CategoryKey, string> = {
  protected: 'Korumalı',
  duplicate: 'Çift kurulum',
  'old-version': 'Eski sürüm',
  orphan: 'Yetim kalıntı',
  unused: 'Kullanılmayan',
  'ai-debris': 'AI artığı',
  'ghost-envs': 'Hayalet ortam',
  unknown: 'Belirsiz',
};

/** AI artiklari: model depolari, ajan calisma alanlari, GPU/vektor runtime. */
const AI_ARCHETYPES = new Set(['model-store', 'agent-workspace', 'accelerator-runtime']);
const AI_FILE_KINDS = new Set(['onnx-model', 'embedding-index', 'cuda-runtime']);

/** Global CLI kurulumlari (shim tabanli) = sahibi bilinmeyen yetim kalinti. */
const CLI_ARCHETYPES = new Set(['global-packages']);

/** Derlenmis yorumlayici ortamlari ve proje ici bagimliliklar. */
const ENV_ARCHETYPES = new Set(['runtime-pool', 'project-artifact', 'project-workspace']);

/** Yeniden uretilebilir / atil kalmis onbellekler. */
const UNUSED_ARCHETYPES = new Set([
  'pkg-manager-cache',
  'updater-staging',
  'temp-scratch',
  'crash-artifacts',
  'editor-extension-store',
  'electron-app-data',
]);

export interface CategoryStat {
  key: CategoryKey;
  /** Kume sayisi */
  count: number;
  /** Toplam boyut */
  bytes: number;
  /** Silinebilir (reclaimable) boyut */
  reclaimable: number;
}

/**
 * Tek bir kumenin kategorisi. Kararli bir oncelik sirasi vardir:
 * protected > duplicate > old-version > orphan > unused > AI > env > unknown.
 */
export function categoryOf(c: Cluster): CategoryKey {
  const archetype = c.evidence.archetype ?? c.archetype;
  const kinds = c.evidence.fileKinds ?? [];
  const markers = new Set((c.evidence.markers ?? []).map((m) => m.toLowerCase()));

  // 1) Korunan: kullanici verisi, kural/oturum, acik "keep" karari.
  if (
    c.verdict.kind === 'keep' ||
    c.verdict.regenerability === 'user-data' ||
    markers.has('chat-history') ||
    markers.has('rules-files') ||
    markers.has('identity')
  ) {
    return 'protected';
  }

  // 2) Cift kurulum: ayni komut/paket birden fazla yerde.
  if (markers.has('duplicate') || markers.has('shadowed-install') || markers.has('multi-owner')) {
    return 'duplicate';
  }

  // 3) Eski surum: surumlu uygulama deposu / editor uzanti eski surumu.
  if (
    archetype === 'versioned-app-store' ||
    markers.has('old-version') ||
    markers.has('stale-version') ||
    markers.has('obsolete-extension')
  ) {
    return 'old-version';
  }

  // 4) Yetim kalinti: sahibi olmayan global paket/shim deposu.
  if (CLI_ARCHETYPES.has(archetype) || markers.has('orphan') || markers.has('orphan-shim')) {
    return 'orphan';
  }

  // 5) Kullanilmayan / yeniden uretilebilir onbellek.
  if (UNUSED_ARCHETYPES.has(archetype)) return 'unused';

  // 6) AI artigi.
  if (AI_ARCHETYPES.has(archetype)) return 'ai-debris';
  if (kinds.some((k) => AI_FILE_KINDS.has(k))) return 'ai-debris';

  // 7) Hayalet ortam (derlenmis runtime / proje ici bagimlilik).
  if (ENV_ARCHETYPES.has(archetype)) return 'ghost-envs';

  return 'unknown';
}

/** Kategori bazli ozet. */
export function categoryStats(clusters: Cluster[]): Record<CategoryKey, CategoryStat> {
  const out = {} as Record<CategoryKey, CategoryStat>;
  for (const key of CATEGORY_ORDER) out[key] = { key, count: 0, bytes: 0, reclaimable: 0 };
  for (const c of clusters) {
    const s = out[categoryOf(c)];
    s.count += 1;
    s.bytes += c.totalBytes;
    s.reclaimable += c.reclaimableBytes;
  }
  return out;
}

/**
 * "Ajan kirliligi": AI artiklarinin toplam taranan bayt icindeki payi.
 * Disk dolulugu ayrica `diskUsage` ile olculur; bu oran tarama sonucundan
 * hesaplanir ve ayri bir gostergedir.
 */
export function agentClutter(clusters: Cluster[]): number {
  let total = 0;
  let ai = 0;
  for (const c of clusters) {
    total += c.totalBytes;
    if (categoryOf(c) === 'ai-debris') ai += c.totalBytes;
  }
  if (total <= 0) return 0;
  return ai / total;
}
