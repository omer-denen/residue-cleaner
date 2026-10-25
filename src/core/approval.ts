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
  /** Kalici silme (yalniz purge). */
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
