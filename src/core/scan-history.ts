import type { ScanHistoryEntry, ScanHistoryRow, ScanOutcome } from './contract.ts';

export const SCAN_HISTORY_LIMIT = 50;

export interface ScanSummaryFacts {
  finishedAt: number;
  clusters: number;
  files: number;
  bytes: number;
  deletableBytes: number;
  targets: number;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function clampNonNeg(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n;
}

export class ScanHistory {
  /** Yeni kayit en uste; LIMIT'i asan eskiler atilir. Girdi degismez. */
  static add(
    entries: readonly ScanHistoryEntry[],
    entry: ScanHistoryEntry,
    limit = SCAN_HISTORY_LIMIT,
  ): ScanHistoryEntry[] {
    const filtered = entries.filter((e) => e.id !== entry.id);
    const out = [entry, ...filtered];
    if (limit >= 0 && out.length > limit) {
      return out.slice(0, limit);
    }
    return out;
  }

  /** Bitis zamanina gore yeniden eskiye siralar (bozuk `at` en sona). */
  static list(entries: readonly ScanHistoryEntry[]): ScanHistoryEntry[] {
    const indexed = entries.map((e, i) => ({ e, i }));
    indexed.sort((a, b) => {
      const va = isFiniteNumber(a.e.at) ? (a.e.at as number) : null;
      const vb = isFiniteNumber(b.e.at) ? (b.e.at as number) : null;
      if (va === null && vb === null) return a.i - b.i;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (vb !== va) return vb - va;
      return a.i - b.i;
    });
    return indexed.map((x) => x.e);
  }

  /** Ozet: { count, lastAt, firstAt, incomplete } — bos liste icin 0'lar. */
  static summary(
    entries: readonly ScanHistoryEntry[],
  ): { count: number; lastAt: number; firstAt: number; incomplete: number } {
    const incomplete = entries.filter((e) => !ScanHistory.isComplete(e)).length;
    if (entries.length === 0) return { count: 0, lastAt: 0, firstAt: 0, incomplete: 0 };
    const valid = entries
      .map((e) => e.at)
      .filter((v): v is number => isFiniteNumber(v));
    if (valid.length === 0) return { count: entries.length, lastAt: 0, firstAt: 0, incomplete };
    return {
      count: entries.length,
      lastAt: Math.max(...valid),
      firstAt: Math.min(...valid),
      incomplete,
    };
  }

  /** Kaydin sonucu. Alan yoksa `done` (B20 oncesi kayitlar). */
  static outcome(entry: ScanHistoryEntry): ScanOutcome {
    const o = entry.outcome;
    if (o === 'cancelled' || o === 'error') return o;
    return 'done';
  }

  /** Yalniz tamamlanmis tarama "complete"; iptal/hata kismi veridir. */
  static isComplete(entry: ScanHistoryEntry): boolean {
    return ScanHistory.outcome(entry) === 'done';
  }

  /**
   * Gorunum satirlari: arayuz "tamamlanmadi" etiketini bu karardan secer.
   * Girdi sirasi korunur (cagiran `list()` ile siralar).
   */
  static rows(entries: readonly ScanHistoryEntry[]): ScanHistoryRow[] {
    return entries.map((e) => {
      const outcome = ScanHistory.outcome(e);
      const complete = outcome === 'done';
      const done = complete ? 0 : clampNonNeg(e.progress?.done ?? 0);
      const total = complete ? 0 : clampNonNeg(e.progress?.total ?? 0);
      return {
        id: e.id,
        at: e.at,
        outcome,
        complete,
        clusters: clampNonNeg(e.clusters),
        bytes: clampNonNeg(e.bytes),
        done,
        total,
      };
    });
  }

  /** ScanResult benzeri veriden ozet uretir (kume/parca/hedef sayimlari). */
  static summarize(
    facts: ScanSummaryFacts,
    id: string,
    outcome: ScanOutcome = 'done',
    progress?: { done: number; total: number },
  ): ScanHistoryEntry {
    const entry: ScanHistoryEntry = {
      id,
      at: facts.finishedAt,
      clusters: clampNonNeg(facts.clusters),
      files: clampNonNeg(facts.files),
      bytes: clampNonNeg(facts.bytes),
      deletableBytes: clampNonNeg(facts.deletableBytes),
      targets: clampNonNeg(facts.targets),
      outcome,
    };
    if (outcome !== 'done') {
      entry.progress = {
        done: clampNonNeg(progress?.done ?? 0),
        total: clampNonNeg(progress?.total ?? 0),
      };
    }
    return entry;
  }
}