/**
 * TARAMA KONTROLÜ (B19 + B21).
 *
 * Tarama sahnesinin klavye niyeti ve SSE olay → kalıcı bilgi türü
 * dönüşümü burada tek yerde yasar. Arayüz hesap yapmaz; bu modul
 * saf TypeScript'tir (node builtin / DOM importu YOK).
 *
 * Kural (AGENTS.md 18): karar mantigi arayuzde degil motorda.
 */

export type ScanPhase = 'idle' | 'running' | 'paused';
export type ScanIntent = 'pause' | 'resume' | 'cancel' | 'none';
export type ScanNoticeKind = 'cancelled' | 'paused';

export class ScanControl {
  /** Tarama yoksa 'idle'; paused bayragi yalnizca calisirken anlamlidir. */
  static phase(scanning: boolean, paused: boolean): ScanPhase {
    if (!scanning) return 'idle';
    return paused ? 'paused' : 'running';
  }

  /** Tus → niyet. 'p'/'P' → running: 'pause', paused: 'resume', idle: 'none'.
   *  'Escape' → HER ZAMAN 'none' (yanlislikla iptal yok). Diger tuslar 'none'. */
  static keyIntent(key: string, phase: ScanPhase): ScanIntent {
    if (key === 'Escape') return 'none';
    if (key === 'p' || key === 'P') {
      if (phase === 'running') return 'pause';
      if (phase === 'paused') return 'resume';
      return 'none';
    }
    return 'none';
  }

  /** Iptal her zaman iki adimlidir. */
  static cancelNeedsConfirm(): boolean {
    return true;
  }

  /** SSE olayi → kalici bilgi türü. 'cancelled' → 'cancelled',
   *  'paused' → 'paused', digerleri (resumed/done/error/progress/...) → null. */
  static notice(eventType: string): ScanNoticeKind | null {
    if (eventType === 'cancelled') return 'cancelled';
    if (eventType === 'paused') return 'paused';
    return null;
  }
}
