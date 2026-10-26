/**
 * Denetim kaydi (audit.log) gorunum motoru.
 *
 * Saf TypeScript: node builtin importu YOK. Motor IO yapmaz; satir
 * dizilerini isler. Servis katmani dosyayi okur ve bu sinifa verir.
 */

export type AuditKind = 'delete' | 'restore' | 'purge' | 'other';

export interface AuditRecord {
  at: number;
  event: string;
  kind: AuditKind;
  ok: boolean;
  id?: string;
  path?: string;
  bytes?: number;
  code?: string;
  reason?: string;
  counts?: {
    removed?: number;
    freed?: number;
    skipped?: number;
    failed?: number;
    batches?: number;
    bytes?: number;
    items?: number;
  };
  paths?: string[];
  journal?: string;
}

export class AuditView {
  static parse(line: string): AuditRecord | null {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      return null;
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const event = typeof obj.event === 'string' ? obj.event : null;
    if (!event) return null;

    let at = 0;
    if (typeof obj.at === 'string') {
      const ms = Date.parse(obj.at);
      if (!Number.isNaN(ms)) at = ms;
    } else if (typeof obj.at === 'number' && Number.isFinite(obj.at)) {
      at = obj.at;
    }

    let kind: AuditKind = 'other';
    if (event.startsWith('delete.')) kind = 'delete';
    else if (event === 'vault.restore' || event === 'vault.restore.failed') kind = 'restore';
    else if (event.startsWith('vault.purge-')) kind = 'purge';

    const ok = !(event.endsWith('.failed') || event.endsWith('.error'));

    let id: string | undefined;
    if (typeof obj.id === 'string') id = obj.id;
    else if (typeof obj.planId === 'string') id = obj.planId;
    else if (typeof obj.jobId === 'string') id = obj.jobId;

    let path: string | undefined;
    if (typeof obj.to === 'string' && obj.to) path = obj.to;
    else if (typeof obj.from === 'string' && obj.from) path = obj.from;
    else if (Array.isArray(obj.items) && obj.items.length > 0) {
      const first = obj.items[0];
      if (first && typeof first === 'object' && typeof first.path === 'string' && first.path) {
        path = first.path;
      } else if (typeof first === 'string' && first) {
        path = first;
      }
    }

    let bytes: number | undefined;
    if (typeof obj.bytes === 'number' && Number.isFinite(obj.bytes)) bytes = obj.bytes;
    else if (typeof obj.freed === 'number' && Number.isFinite(obj.freed)) bytes = obj.freed;

    const code = typeof obj.code === 'string' ? obj.code : undefined;
    const reason =
      typeof obj.reason === 'string'
        ? obj.reason
        : typeof obj.error === 'string'
          ? obj.error
          : undefined;

    const counts: AuditRecord['counts'] = {};
    if (event === 'delete.done') {
      if (typeof obj.removed === 'number') counts.removed = obj.removed;
      if (typeof obj.freed === 'number') counts.freed = obj.freed;
      if (typeof obj.skipped === 'number') counts.skipped = obj.skipped;
      if (typeof obj.failed === 'number') counts.failed = obj.failed;
    }
    if (event.startsWith('vault.purge-')) {
      if (typeof obj.batches === 'number') counts.batches = obj.batches;
      if (typeof obj.bytes === 'number') counts.bytes = obj.bytes;
      if (typeof obj.failed === 'number') counts.failed = obj.failed;
      if (Array.isArray(obj.ids)) counts.items = obj.ids.length;
      else if (typeof obj.items === 'number') counts.items = obj.items;
    }
    const hasCounts = Object.keys(counts).length > 0;

    const journal = typeof obj.journal === 'string' ? obj.journal : undefined;

    const rec: AuditRecord = {
      at,
      event,
      kind,
      ok,
      id,
      path,
      bytes,
      code,
      reason,
      counts: hasCounts ? counts : undefined,
      journal,
    };
    return rec;
  }

  static parseLines(lines: readonly string[]): AuditRecord[] {
    const parsed: { idx: number; rec: AuditRecord }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const rec = this.parse(lines[i] as string);
      if (rec) parsed.push({ idx: i, rec });
    }
    parsed.sort((a, b) => {
      if (b.rec.at !== a.rec.at) return b.rec.at - a.rec.at;
      return b.idx - a.idx;
    });
    return parsed.map((p) => p.rec);
  }

  static filter(
    records: readonly AuditRecord[],
    q: { kind?: AuditKind | 'all'; sinceMs?: number; now?: number; limit?: number },
  ): AuditRecord[] {
    let out = [...records];
    if (q.kind && q.kind !== 'all') {
      out = out.filter((r) => r.kind === q.kind);
    }
    if (q.sinceMs !== undefined) {
      const now = q.now ?? Date.now();
      out = out.filter((r) => r.at >= now - q.sinceMs!);
    }
    if (q.limit !== undefined && Number.isFinite(q.limit) && q.limit >= 0) {
      out = out.slice(0, q.limit);
    }
    return out;
  }

  static counts(records: readonly AuditRecord[]): {
    total: number;
    delete: number;
    restore: number;
    purge: number;
    failed: number;
  } {
    let del = 0;
    let restore = 0;
    let purge = 0;
    let failed = 0;
    for (const r of records) {
      if (r.kind === 'delete') del++;
      else if (r.kind === 'restore') restore++;
      else if (r.kind === 'purge') purge++;
      if (!r.ok) failed++;
    }
    return { total: records.length, delete: del, restore, purge, failed };
  }
}
