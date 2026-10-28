/**
 * Denetim kaydi (audit) disa aktarma motoru.
 *
 * Saf TypeScript: node builtin importu YOK, IO yok. Yalnizca string/dizi islemi.
 * Sutun sirasi, kacis kurali ve filtre eslemesi MOTORDA kalir (AGENTS.md 18).
 */

import type { AuditEventView } from './contract.ts';

export const AUDIT_SINCE_IDS = ['1h', '24h', '7d', '30d'] as const;
export type AuditSinceId = (typeof AUDIT_SINCE_IDS)[number];

export const AUDIT_KIND_IDS = ['delete', 'restore', 'purge', 'other'] as const;
export type AuditKindId = (typeof AUDIT_KIND_IDS)[number];

/** Dışa aktarma tavanı: sunucu `limit > 500` değerini 500'e kırpar. */
export const AUDIT_EXPORT_LIMIT = 500;

export interface AuditFilterInput {
  since?: string | null;
  kind?: string | null;
}

export interface AuditQueryOptions {
  since?: AuditSinceId;
  kind?: AuditKindId;
}

export interface AuditCsvOptions {
  bom?: boolean;
}

const CSV_COLUMNS = ['at', 'event', 'kind', 'ok', 'path', 'paths', 'bytes', 'code', 'reason'] as const;

function isSinceId(v: string): v is AuditSinceId {
  return (AUDIT_SINCE_IDS as readonly string[]).includes(v);
}

function isKindId(v: string): v is AuditKindId {
  return (AUDIT_KIND_IDS as readonly string[]).includes(v);
}

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export class AuditExport {
  static normalize(input: AuditFilterInput): AuditQueryOptions {
    const out: AuditQueryOptions = {};
    if (typeof input?.since === 'string') {
      const s = input.since.trim();
      if (s && isSinceId(s)) out.since = s;
    }
    if (typeof input?.kind === 'string') {
      const k = input.kind.trim();
      if (k && isKindId(k)) out.kind = k;
    }
    return out;
  }

  static csv(
    rows: readonly AuditEventView[],
    labels: Readonly<Record<string, string>>,
    options?: AuditCsvOptions,
  ): string {
    const bom = options?.bom !== false;
    const lines: string[] = [];
    const header = CSV_COLUMNS.map((col) => escapeCsvField(labels[col] ?? col)).join(',');
    lines.push(header);

    for (const row of rows) {
      const atVal = row.at && row.at > 0 ? new Date(row.at).toISOString() : '';
      const pathsVal = Array.isArray(row.paths) ? row.paths.join('; ') : '';
      const fields: string[] = [
        escapeCsvField(atVal),
        escapeCsvField(row.event ?? ''),
        escapeCsvField(row.kind ?? ''),
        escapeCsvField(row.ok ? 'true' : 'false'),
        escapeCsvField(row.path ?? ''),
        escapeCsvField(pathsVal),
        escapeCsvField(row.bytes !== undefined && row.bytes !== null ? String(row.bytes) : ''),
        escapeCsvField(row.code ?? ''),
        escapeCsvField(row.reason ?? ''),
      ];
      lines.push(fields.join(','));
    }

    const body = lines.join('\r\n');
    return bom ? '\uFEFF' + body : body;
  }

  static json(rows: readonly AuditEventView[]): string {
    return JSON.stringify({ version: 1, count: rows.length, records: rows });
  }
}