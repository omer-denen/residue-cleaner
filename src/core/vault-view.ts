/**
 * KASA GORUNUMU — saf motor (AGENTS.md kural 18).
 *
 * Arama, siralama, sayfalama ve ozet BURADA hesaplanir; arayuz yalnizca
 * sonucu cizer. Girdi dizisi DEGISTIRILMEZ.
 *
 * Kasa API'si en fazla 500 kayit dondurur (`truncated`); sayfalama bu
 * yuklenen kume uzerinde calisir, toplam sayi sozlesmeden gelir.
 */

import type { VaultEntryView } from './contract.ts';

export type VaultSort = 'newest' | 'oldest' | 'largest' | 'path' | 'expiring';

export const VAULT_SORT_IDS: readonly VaultSort[] = [
  'newest',
  'oldest',
  'largest',
  'path',
  'expiring',
];

export const VAULT_PAGE_SIZES = [25, 50, 100] as const;

export interface VaultQuery {
  /** Bos ya da birden cok sozcuk; hepsi eslesmeli. */
  search: string;
  sort: VaultSort;
  /** 1 tabanli; sinirlar icinde kirpilir. */
  page: number;
  pageSize: number;
}

export interface VaultSummary {
  count: number;
  bytes: number;
  /** Orijinal yolu hala dolu olan kayitlar (geri yuklemede cakisma). */
  conflicts: number;
  /** Kalan gun <= 7. */
  expiring: number;
}

export interface VaultPageView {
  rows: VaultEntryView[];
  /** Filtreden gecen toplam kayit. */
  total: number;
  /** Yuklenen (kirpilmamis) kayit sayisi. */
  loaded: number;
  /** 1 tabanli, kirpilmis sayfa. */
  page: number;
  pageCount: number;
  /** 1 tabanli aralik; bos sonucta 0. */
  from: number;
  to: number;
  hasPrev: boolean;
  hasNext: boolean;
  summary: VaultSummary;
}

const FOLD: Record<string, string> = {
  ı: 'i',
  İ: 'i',
  ş: 's',
  Ş: 's',
  ğ: 'g',
  Ğ: 'g',
  ü: 'u',
  Ü: 'u',
  ö: 'o',
  Ö: 'o',
  ç: 'c',
  Ç: 'c',
  â: 'a',
  Â: 'a',
};

/** Kucuk harf + Turkce katlama; yol aramasi icin yeterli. */
export function foldVaultText(text: string): string {
  return text
    .toLocaleLowerCase('tr')
    .replace(/[ıİşŞğĞüÜöÖçÇâÂ]/g, (ch) => FOLD[ch] ?? ch);
}

export class VaultView {
  static view(entries: readonly VaultEntryView[], query: VaultQuery): VaultPageView {
    const terms = foldVaultText(query.search)
      .split(/\s+/)
      .filter((term) => term.length > 0);

    const filtered = entries.filter((entry) => {
      if (terms.length === 0) return true;
      const path = foldVaultText(entry.originalPath);
      return terms.every((term) => path.includes(term));
    });

    const sorted = [...filtered].sort((a, b) => compare(a, b, query.sort));

    const summary: VaultSummary = {
      count: sorted.length,
      bytes: sorted.reduce((sum, entry) => sum + entry.bytes, 0),
      conflicts: sorted.filter((entry) => entry.originalExists).length,
      expiring: sorted.filter((entry) => entry.remainingDays <= 7).length,
    };

    const pageSize = Math.max(1, Math.floor(query.pageSize) || 25);
    const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
    const page = Math.min(Math.max(1, Math.floor(query.page) || 1), pageCount);
    const start = (page - 1) * pageSize;
    const rows = sorted.slice(start, start + pageSize);

    return {
      rows,
      total: sorted.length,
      loaded: entries.length,
      page,
      pageCount,
      from: rows.length === 0 ? 0 : start + 1,
      to: start + rows.length,
      hasPrev: page > 1,
      hasNext: page < pageCount,
      summary,
    };
  }
}

function compare(a: VaultEntryView, b: VaultEntryView, sort: VaultSort): number {
  switch (sort) {
    case 'oldest':
      return a.at - b.at;
    case 'largest':
      return b.bytes - a.bytes || a.originalPath.localeCompare(b.originalPath, 'tr');
    case 'path':
      return a.originalPath.localeCompare(b.originalPath, 'tr');
    case 'expiring':
      return a.remainingDays - b.remainingDays || a.at - b.at;
    case 'newest':
    default:
      return b.at - a.at || a.originalPath.localeCompare(b.originalPath, 'tr');
  }
}
