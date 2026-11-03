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

/** Canli planin kayda yazilacak ozeti (kapsam degistikce tazelenir). */
export interface PlanRecordSnapshot {
  planId: string;
  name: string;
  clusterKeys: string[];
  clusterTitles: string[];
  bytes: number;
  targetCount: number;
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

  /**
   * Canli plan degistikce (kume ekleme/cikarma, yeniden kurma, ad degisme)
   * ona bagli BEKLEYEN kaydin kapsamini tazeler.
   *
   * Yalnizca ayni `planId` + `pending` kayit dokunulur; gecmis kayitlar ve
   * baska planin kaydi DEGISMEZ. Degisiklik yoksa girdi referansi aynen
   * doner (gereksiz disk yazimi yok).
   */
  static sync(records: PlanRecord[], snap: PlanRecordSnapshot): PlanRecord[] {
    let changed = false;
    const next = records.map((r) => {
      if (r.status !== 'pending' || r.planId !== snap.planId) return r;
      const same =
        r.name === snap.name &&
        r.bytes === snap.bytes &&
        r.targetCount === snap.targetCount &&
        sameList(r.clusterKeys, snap.clusterKeys) &&
        sameList(r.clusterTitles, snap.clusterTitles);
      if (same) return r;
      changed = true;
      return {
        ...r,
        name: snap.name,
        clusterKeys: [...snap.clusterKeys],
        clusterTitles: [...snap.clusterTitles],
        bytes: snap.bytes,
        targetCount: snap.targetCount,
      };
    });
    return changed ? next : records;
  }

  /** Bir planin bekleyen kaydini iptal eder (plan atildiginda). */
  static cancelPlan(records: PlanRecord[], planId: string, at: number): PlanRecord[] {
    let next = records;
    for (const r of records) {
      if (r.status === 'pending' && r.planId === planId) {
        next = this.apply(next, r.id, 'cancelled', at);
      }
    }
    return next;
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

function sameList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
