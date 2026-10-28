import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { longPath } from '../util/longpath.ts';
import { dataDir } from '../core/data-dir.ts';
import type { ScanHistoryEntry } from '../core/contract.ts';
import { ScanHistory } from '../core/scan-history.ts';

export function scanHistoryPath(): string {
  return join(dataDir(), 'scans', 'index.json');
}

export async function loadScanHistory(): Promise<ScanHistoryEntry[]> {
  try {
    const txt = await readFile(longPath(scanHistoryPath()), 'utf8');
    const parsed = JSON.parse(txt) as { version?: unknown; entries?: unknown } | unknown;
    const rawEntries = Array.isArray((parsed as { entries?: unknown })?.entries)
      ? ((parsed as { entries: unknown[] }).entries)
      : Array.isArray(parsed)
        ? (parsed as unknown[])
        : [];
    const out: ScanHistoryEntry[] = [];
    for (const e of rawEntries) {
      if (!e || typeof e !== 'object') continue;
      const o = e as Record<string, unknown>;
      if (typeof o.id !== 'string') continue;
      if (typeof o.at !== 'number') continue;
      out.push({
        id: o.id,
        at: o.at,
        clusters: typeof o.clusters === 'number' ? o.clusters : 0,
        files: typeof o.files === 'number' ? o.files : 0,
        bytes: typeof o.bytes === 'number' ? o.bytes : 0,
        deletableBytes: typeof o.deletableBytes === 'number' ? o.deletableBytes : 0,
        targets: typeof o.targets === 'number' ? o.targets : 0,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export async function appendScanHistory(entry: ScanHistoryEntry): Promise<void> {
  const file = scanHistoryPath();
  try {
    await mkdir(longPath(dirname(file)), { recursive: true });
    const current = await loadScanHistory();
    const next = ScanHistory.add(current, entry);
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(longPath(tmp), JSON.stringify({ version: 1, entries: next }), 'utf8');
    await rename(longPath(tmp), longPath(file));
  } catch {
    /* gecmis yazilamadi; tarama yine de gecerli */
  }
}