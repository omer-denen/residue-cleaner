/**
 * HATA GORUNUMU — durum semasi hijyeni.
 *
 * Iki farkli `bugs[]` semasi ayni anda gecerlidir:
 *   - eski: { id, symptom, cause, fix, at }  (durum/onem yok)
 *   - yeni: { title, symptom, cause, fix, status, severity }
 *
 * Bu modul saf TypeScript'tir: node builtin importu YOKTUR. Karar mantigi
 * tek bir yerde toplanir; `status.ts` ve `renderHandoff` yalniz gosterir.
 */
export type BugSeverity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';
export type BugStatus = 'fixed' | 'open' | 'partial';

/** Iki semayi da karsilayan girdi: alanlarin hepsi opsiyonel. */
export interface BugLike {
  id?: string;
  title?: string;
  symptom?: string;
  cause?: string;
  fix?: string;
  status?: string;
  severity?: string;
}

export interface BugView {
  id: string;
  label: string;
  symptom: string;
  cause: string;
  fix: string;
  status: BugStatus;
  severity: BugSeverity;
}

const VALID_SEVERITIES: ReadonlySet<string> = new Set([
  'critical',
  'high',
  'medium',
  'low',
]);

function normalizeStatus(raw: string | undefined): BugStatus {
  if (raw === 'fixed') return 'fixed';
  if (raw === 'partial') return 'partial';
  return 'open';
}

function normalizeSeverity(raw: string | undefined): BugSeverity {
  if (raw !== undefined && VALID_SEVERITIES.has(raw)) {
    return raw as BugSeverity;
  }
  return 'unknown';
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  let idx = -1;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '.' || ch === '!' || ch === '?') {
      idx = i;
      break;
    }
  }
  if (idx >= 0) return trimmed.slice(0, idx + 1).trim();
  return trimmed;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '...';
}

function normalizeOne(b: BugLike): BugView {
  const id = b.id ?? '';
  const title = (b.title ?? '').trim();
  let label: string;
  if (title !== '') {
    label = title;
  } else {
    const sent = firstSentence(b.symptom ?? '');
    if (sent !== '') {
      label = truncate(sent, 80);
    } else {
      const trimmedId = id.trim();
      if (trimmedId !== '') {
        label = trimmedId;
      } else {
        label = 'hata';
      }
    }
  }

  return {
    id,
    label,
    symptom: b.symptom ?? '',
    cause: b.cause ?? '',
    fix: b.fix ?? '',
    status: normalizeStatus(b.status),
    severity: normalizeSeverity(b.severity),
  };
}

export class BugViewList {
  static normalize(bugs: readonly BugLike[]): BugView[] {
    return bugs.map((b) => normalizeOne(b));
  }

  static open(bugs: readonly BugLike[]): BugView[] {
    return this.normalize(bugs).filter((v) => v.status !== 'fixed');
  }

  static counts(bugs: readonly BugLike[]): { open: number; critical: number; high: number } {
    const openViews = this.normalize(bugs).filter((v) => v.status !== 'fixed');
    let critical = 0;
    let high = 0;
    for (const v of openViews) {
      if (v.severity === 'critical') critical++;
      else if (v.severity === 'high') high++;
    }
    return { open: openViews.length, critical, high };
  }
}