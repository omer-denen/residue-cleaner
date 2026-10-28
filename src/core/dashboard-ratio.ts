import type { DashboardRatioView, RatioShare } from './contract.ts';

export interface RatioFacts {
  diskTotalBytes: number | null;
  diskFreeBytes: number | null;
  scannedBytes: number;
  reclaimableBytes: number;
}

function clampNonNeg(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n;
}

function share(numeratorRaw: number, denominatorRaw: number): RatioShare {
  const denominator = clampNonNeg(denominatorRaw);
  const numerator = clampNonNeg(numeratorRaw);
  if (!Number.isFinite(denominatorRaw) || denominator <= 0) {
    return { known: false, numerator: null, denominator: null, ratio: null };
  }
  let ratio = numerator / denominator;
  if (!Number.isFinite(ratio)) ratio = 0;
  if (ratio < 0) ratio = 0;
  if (ratio > 1) ratio = 1;
  ratio = Math.round(ratio * 10000) / 10000;
  return { known: true, numerator, denominator, ratio };
}

export class DashboardRatio {
  static view(facts: RatioFacts): DashboardRatioView {
    const total = facts.diskTotalBytes;
    const free = facts.diskFreeBytes;
    if (total === null || free === null) {
      const unknown: RatioShare = { known: false, numerator: null, denominator: null, ratio: null };
      return { used: unknown, reclaimable: unknown, scanned: unknown };
    }
    const usedBytesRaw = total - free;
    const usedBytes = Number.isFinite(usedBytesRaw) ? Math.max(0, usedBytesRaw) : 0;
    return {
      used: share(usedBytes, total),
      reclaimable: share(facts.reclaimableBytes, usedBytes),
      scanned: share(facts.scannedBytes, usedBytes),
    };
  }
}