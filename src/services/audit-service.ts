import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { auditPath } from '../util/audit.ts';
import { dataDir } from '../core/data-dir.ts';
import { longPath } from '../util/longpath.ts';
import { AuditView } from '../core/audit-view.ts';
import type { AuditEventView, AuditResponse } from '../core/contract.ts';
import { ServiceError } from './errors.ts';

/**
 * Denetim servisi — salt okunur.
 *
 * audit.log dosyasini okur, motor ile parse eder, delete olaylari icin
 * ilgili journal dosyasindan yolları (best-effort) toplar.
 */
export class AuditService {
  async list(params: {
    since?: string;
    kind?: string;
    limit?: number;
  } = {}): Promise<AuditResponse> {
    const kind = (params.kind ?? 'all').trim();
    const validKinds = ['all', 'delete', 'restore', 'purge', 'other'];
    if (!validKinds.includes(kind)) {
      throw new ServiceError(400, 'Gecersiz kind');
    }

    let sinceMs: number | undefined;
    if (params.since && params.since.trim() !== '') {
      const m = String(params.since).trim().match(/^(\d+)([hd])$/i);
      if (!m) throw new ServiceError(400, 'Gecersiz since');
      const n = Number(m[1] as string);
      const unit = (m[2] as string).toLowerCase();
      sinceMs = n * (unit === 'h' ? 3_600_000 : 86_400_000);
    }

    let limit = params.limit ?? 100;
    if (!Number.isFinite(limit) || limit < 1) limit = 100;
    if (limit > 500) limit = 500;

    const file = auditPath();
    let auditFileExists = false;
    let lines: string[] = [];
    try {
      const raw = await readFile(longPath(file), 'utf8');
      auditFileExists = true;
      const allLines = raw.split(/\r?\n/);
      lines = allLines.slice(-5000);
    } catch {
      auditFileExists = false;
    }

    const records = AuditView.parseLines(lines);
    const filtered = AuditView.filter(records, {
      kind: kind as any,
      sinceMs,
      now: Date.now(),
      limit,
    });

    const events: AuditEventView[] = [];
    for (const r of filtered) {
      const ev: AuditEventView = {
        at: r.at,
        kind: r.kind,
        event: r.event,
        ok: r.ok,
        id: r.id,
        path: r.path,
        bytes: r.bytes,
        code: r.code,
        reason: r.reason,
        counts: r.counts,
      };
      if (r.journal && r.kind === 'delete') {
        const enriched = await this.readJournalPaths(r.journal);
        if (enriched.paths.length > 0) {
          ev.paths = enriched.paths;
          if (enriched.truncated) ev.pathsTruncated = true;
        }
      }
      events.push(ev);
    }

    const counts = AuditView.counts(records);

    let journalCount = 0;
    try {
      const ents = await readdir(longPath(join(dataDir(), 'journals')), { withFileTypes: true });
      journalCount = ents.filter((e) => e.isFile()).length;
    } catch {
      journalCount = 0;
    }

    return {
      events,
      counts,
      journalCount,
      auditFileExists,
    };
  }

  private async readJournalPaths(journal: string): Promise<{ paths: string[]; truncated: boolean }> {
    let filePath = journal;
    if (!/^[a-zA-Z]:[\\/]/.test(filePath) && !filePath.startsWith('/')) {
      filePath = join(dataDir(), 'journals', filePath);
    }
    const all: string[] = [];
    try {
      const raw = await readFile(longPath(filePath), 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let obj: any;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
        if (obj.kind !== 'item') continue;
        let p: string | undefined;
        if (typeof obj.path === 'string' && obj.path) p = obj.path;
        if (p) all.push(p);
        if (all.length > 200) break;
      }
    } catch {
      // best-effort: dosya yok/bozuk -> bos
    }
    const truncated = all.length > 200;
    const paths = truncated ? all.slice(0, 200) : all;
    return { paths, truncated };
  }
}
