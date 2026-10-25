import type { ScanStatusRow } from '../../src/core/contract.ts';
import type { Lang } from './i18n.ts';

/** Yalnizca SUNUM: bayt ve yas bicimlendirme. Karar yok. */

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function formatAge(ms: number | null, lang: Lang): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (ms < minute) return lang === 'tr' ? 'az önce' : 'just now';
  if (ms < hour) {
    const m = Math.round(ms / minute);
    return lang === 'tr' ? `${m} dk önce` : `${m} min ago`;
  }
  if (ms < day) {
    const h = Math.round(ms / hour);
    return lang === 'tr' ? `${h} saat önce` : `${h} h ago`;
  }
  const d = Math.round(ms / day);
  return lang === 'tr' ? `${d} gün önce` : `${d} d ago`;
}

/** Sure (TTL, yas): "24 saat" / "3 gün". */
export function formatDuration(ms: number, lang: Lang): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (ms < minute) {
    const s = Math.max(1, Math.round(ms / 1000));
    return lang === 'tr' ? `${s} sn` : `${s}s`;
  }
  if (ms < hour) {
    const m = Math.round(ms / minute);
    return lang === 'tr' ? `${m} dk` : `${m}m`;
  }
  if (ms < day) {
    const h = Math.round(ms / hour);
    return lang === 'tr' ? `${h} saat` : `${h}h`;
  }
  const d = Math.round(ms / day);
  return lang === 'tr' ? `${d} gün` : `${d}d`;
}

/** Mutlak tarih-saat. */
export function formatTimestamp(ms: number, lang: Lang): string {
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Sayi: binlik ayraci yerele gore. */
export function formatCount(n: number, lang: Lang): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US');
}

/** Oran 0..1 -> "%57" / "%5,7". */
export function formatRatio(ratio: number, lang: Lang): string {
  if (!Number.isFinite(ratio)) return '—';
  const pct = ratio * 100;
  const digits = pct >= 10 ? 0 : 1;
  if (lang === 'tr') return `%${pct.toFixed(digits).replace('.', ',')}`;
  return `${pct.toFixed(digits)}%`;
}

/**
 * Tarama raporu satiri: deger TURU motorun kararidir, bicim burada.
 */
export function formatScanRow(row: ScanStatusRow, lang: Lang): string {
  if (row.text !== undefined) return row.text;
  if (row.amount === undefined) return '—';
  switch (row.unit) {
    case 'timestamp':
      return formatTimestamp(row.amount, lang);
    case 'duration':
      return formatDuration(row.amount, lang);
    case 'bytes':
      return formatBytes(row.amount);
    case 'count':
      return formatCount(row.amount, lang);
    case 'ratio':
      return formatRatio(row.amount, lang);
    case 'percent':
      return `${Math.round(row.amount)}%`;
    default:
      return String(row.amount);
  }
}
