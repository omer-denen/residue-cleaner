import type { Risk } from './types.ts';

/**
 * ONAY KURALLARI.
 *
 * Yazili onay ifadeleri ve "hangi risk hangi onayi ister" kurali TEK
 * yerde yasar. Arayuz, HTTP adaptoru, servisler ve CLI ayni kurali
 * kullanir; boylece istemci ile sunucu farkli ifade bekleyemez.
 *
 * Kurallar:
 *   - Orta veya yuksek risk -> yazili ifade zorunlu.
 *     Kasa tasima: "TASI" · kalici silme: "SIL".
 *   - Yuksek risk -> ayrica acik isaretleme zorunlu.
 *   - Yuksek risk -> her yuksek riskli kumenin ADI da yazilir (B15); onay
 *     kutusu tek basina yetmez. Ad karsilastirmasi buyuk/kucuk harf
 *     duyarli degildir; ifade karsilastirmasi hassas kalir.
 *   - Karsilastirma buyuk/kucuk harf duyarlidir; bas/son bosluk yok sayilir.
 *
 * Bu modul SAF TypeScript'tir: node builtin importu YOKTUR.
 */

export type ApprovalKind =
  | 'delete'
  | 'vaultMove'
  | 'repair'
  | 'quarantine'
  | 'vaultPurge'
  | 'projectRestore'
  | 'envClean'
  | 'schedule'
  | 'advanced';

const PHRASES = {
  /** CLI araci kaldirma (dogrudan yol kalici silme 3.0'da kaldirildi). */
  delete: 'SIL',
  /** Kasaya tasima: geri alinabilir; "sil" demek yaniltici olur. */
  vaultMove: 'TASI',
  repair: 'ONAR',
  quarantine: 'KARANTINA',
  vaultPurge: 'BOŞALT',
  /** Proje tarifini (bagimliliklari) yeniden kurma. */
  projectRestore: 'KUR',
  /** PATH / ortam degiskeni duzenlemesi (yedek alinir). */
  envClean: 'TEMIZLE',
  /** Otomatik/zamanlanmis plan kurali olusturma. */
  schedule: 'PLANLA',
  /** Gelismis mod: keep/report-only kumeleri de plana alir (yalniz kasaya). */
  advanced: 'GELİŞMİŞ',
} as const satisfies Record<ApprovalKind, string>;

export class ApprovalRules {
  /** Turun bekledigi yazili ifade. */
  static phrase<K extends ApprovalKind>(kind: K): (typeof PHRASES)[K] {
    return PHRASES[kind];
  }

  /** Kullanici girdisi beklenen ifadeyle ayni mi? (bas/son bosluk yok sayilir) */
  static matches(kind: ApprovalKind, input: string | null | undefined): boolean {
    return (input ?? '').trim() === PHRASES[kind];
  }

  /** Bu risklerden herhangi biri yazili onay gerektirir mi? */
  static requiresPhrase(risks: Iterable<Risk>): boolean {
    for (const r of risks) {
      if (r === 'medium' || r === 'high') return true;
    }
    return false;
  }

  /** Bu risklerden herhangi biri ayrica acik isaretleme gerektirir mi? */
  static requiresHighAck(risks: Iterable<Risk>): boolean {
    for (const r of risks) {
      if (r === 'high') return true;
    }
    return false;
  }
}

/**
 * B15 — YUKSEK RISK OVERRIDE.
 *
 * Yuksek riskli bir plan icin onay kutusu tek basina yetmez: kullanici her
 * yuksek riskli kumenin ADINI yazar. Kural burada yasar; arayuz yalniz
 * `items` listesini cizer ve `missing` sonucuna gore dugmeyi kapatir.
 * Sunucu AYNI kurali dogrular (istemciye guvenilmez).
 *
 * Ad = kume anahtari (or. `npm-cache`). Kucuk/buyuk harf farki ve bas/son
 * bosluk yok sayilir; anahtar Turkce karakter icermez.
 */
export interface OverrideCluster {
  key: string;
  title: string;
  risk: Risk;
  /** Kume hedefleri (Cluster: deleteTargets, plan gorunumu: targets). */
  targets?: readonly unknown[];
  deleteTargets?: readonly unknown[];
}

export interface OverrideItem {
  key: string;
  title: string;
  targets: number;
}

export class HighRiskOverride {
  /** Yuksek riskli kumeler (motor karari; arayuz filtrelemez). */
  static items(clusters: readonly OverrideCluster[]): OverrideItem[] {
    const out: OverrideItem[] = [];
    for (const c of clusters) {
      if (c.risk !== 'high') continue;
      const targets = c.deleteTargets ?? c.targets ?? [];
      out.push({ key: c.key, title: c.title, targets: targets.length });
    }
    return out;
  }

  /** Ad yazma zorunlu mu? (gelismis mod phrase ile ayri kapidan gecer) */
  static required(clusters: readonly OverrideCluster[]): boolean {
    return this.items(clusters).length > 0;
  }

  /** Kullanici girdisi kume adiyla ayni mi? (trim + kucuk/buyuk harf yok sayilir) */
  static matches(key: string, input: string | null | undefined): boolean {
    return (input ?? '').trim().toLocaleLowerCase('en-US') === key.trim().toLocaleLowerCase('en-US');
  }

  /** Adi yazilmamis veya yanlis yazilmis kumelerin anahtarlari. */
  static missing(
    clusters: readonly OverrideCluster[],
    names: Record<string, string> | null | undefined,
  ): string[] {
    const given = names ?? {};
    const out: string[] = [];
    for (const item of this.items(clusters)) {
      if (!this.matches(item.key, given[item.key])) out.push(item.key);
    }
    return out;
  }

  /** Kutu isaretli + her ad dogru mu? */
  static satisfied(
    clusters: readonly OverrideCluster[],
    names: Record<string, string> | null | undefined,
    acknowledged: boolean,
  ): boolean {
    return acknowledged === true && this.missing(clusters, names).length === 0;
  }
}
