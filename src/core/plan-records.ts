/**
 * Tarihli plan kaydi motoru (saf TS, node builtin YOK).
 *
 * Bir plan olusturuldugunda kalici bir kayit tutulur; yurutulunce/iptal
 * edilince/iptal basarisiz olunca durumu guncellenir. Arayuz hesap yapmaz.
 */

export type PlanRecordStatus = 'pending' | 'executed' | 'cancelled' | 'failed';
export type PlanRecordSource = 'dashboard' | 'disk' | 'api';

export interface PlanRecord {
  id: string;
  name: string;
  planId: string;
  createdAt: number;
  executedAt?: number;
  status: PlanRecordStatus;
  source: PlanRecordSource;
  clusterKeys: string[];
  clusterTitles: string[];
  bytes: number;
  /** Plan hedef sayisi (kayit aninda dondurulur). */
  targetCount: number;
  /** Yurutme sonucu (yalniz terminal durumda). */
  freedBytes?: number;
  removed?: number;
  error?: string;
}

export interface PlanRecordOutcome {
  freedBytes?: number;
  removed?: number;
  error?: string;
}

export class PlanRecords {
  static readonly MAX = 200;

  static counts(records: PlanRecord[]): Record<PlanRecordStatus, number> {
    const out: Record<PlanRecordStatus, number> = {
      pending: 0,
      executed: 0,
      cancelled: 0,
      failed: 0,
    };
    for (const r of records) {
      if (r.status in out) out[r.status]++;
    }
    return out;
  }

  static list(records: PlanRecord[]): PlanRecord[] {
    return [...records].sort((a, b) => {
      if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
      return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
    });
  }

  static canTransition(from: PlanRecordStatus, to: PlanRecordStatus): boolean {
    if (from !== 'pending') return false;
    if (to === 'pending') return false;
    return to === 'executed' || to === 'cancelled' || to === 'failed';
  }

  static apply(
    records: PlanRecord[],
    id: string,
    to: PlanRecordStatus,
    at: number,
    outcome?: PlanRecordOutcome,
  ): PlanRecord[] {
    const idx = records.findIndex((r) => r.id === id);
    if (idx < 0) return records;
    const rec = records[idx]!;
    if (!this.canTransition(rec.status, to)) return records;

    const copy: PlanRecord[] = records.map((r, i) => {
      if (i !== idx) return r;
      const next: PlanRecord = { ...r, status: to };
      if (to === 'executed' || to === 'cancelled' || to === 'failed') {
        next.executedAt = at;
      }
      if (outcome) {
        if (outcome.freedBytes !== undefined) next.freedBytes = outcome.freedBytes;
        if (outcome.removed !== undefined) next.removed = outcome.removed;
        if (outcome.error !== undefined) next.error = outcome.error;
      }
      return next;
    });
    return copy;
  }

  static trim(records: PlanRecord[]): PlanRecord[] {
    const sorted = [...records].sort((a, b) => a.createdAt - b.createdAt);
    const keep = sorted.length > this.MAX ? sorted.slice(sorted.length - this.MAX) : sorted;
    return this.list(keep);
  }
}
