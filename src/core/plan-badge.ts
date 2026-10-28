/**
 * Plan menüsü rozeti motoru (saf TS, node builtin YOK).
 *
 * Sol menüdeki "Plan" maddesi, kayıtlı plan sayısını rozet olarak
 * gösterir. Sayı MOTORDA hesaplanır; arayüz yalnız basar (AGENTS.md
 * kural 18). Sıfırsa rozet çizilmez (kasa rozetiyle aynı davranış).
 */

import type { PlanRecordView } from './contract.ts';

export interface PlanBadgeView {
  /** Toplam kayit sayisi (menude rozet olarak gosterilir). */
  total: number;
  /** Durumu 'pending' olan kayit sayisi (aria-label icin). */
  pending: number;
  /** Rozet cizilsin mi? (total > 0) */
  show: boolean;
}

export class PlanBadge {
  static view(records: readonly PlanRecordView[]): PlanBadgeView {
    const total = records.length;
    const pending = records.filter((r) => r.status === 'pending').length;
    return { total, pending, show: total > 0 };
  }
}
