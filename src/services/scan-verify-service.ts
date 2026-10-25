import { probeDirs } from '../core/freshness.ts';
import { MeasureCache } from '../core/analyze.ts';
import { walk } from '../core/walker.ts';
import type { Cluster, DeleteTarget, ScanResult } from '../core/types.ts';

export interface TargetCheck {
  key: string;
  path: string;
  status: 'ok' | 'missing' | 'changed' | 'skipped';
  fromBytes: number;
  toBytes: number;
}

export interface VerifyOutcome {
  scan: ScanResult;
  checkedAt: number;
  targets: TargetCheck[];
}

function cloneScan(scan: ScanResult): ScanResult {
  return {
    ...scan,
    clusters: scan.clusters.map((c) => ({
      ...c,
      parts: c.parts.map((p) => ({ ...p })),
      subparts: c.subparts ? c.subparts.map((s) => ({ ...s })) : undefined,
      deleteTargets: c.deleteTargets ? c.deleteTargets.map((t) => ({ ...t })) : undefined,
      evidence: { ...c.evidence },
      verdict: { ...c.verdict, because: [...c.verdict.because], preconditions: [...c.verdict.preconditions] },
    })),
    stats: { ...scan.stats },
    skipped: scan.skipped.map((s) => ({ ...s })),
  };
}

export async function verifyScanTargets(
  scan: ScanResult,
  now?: number,
): Promise<VerifyOutcome> {
  const checkedAt = now ?? Date.now();
  const outScan = cloneScan(scan);
  const targets: TargetCheck[] = [];
  const measure = new MeasureCache();

  for (const cluster of outScan.clusters) {
    const currentTargets = cluster.deleteTargets ? [...cluster.deleteTargets] : [];
    const kept: DeleteTarget[] = [];

    for (const t of currentTargets) {
      const fromBytes = t.bytes;
      const probe = await probeDirs(t.path);

      if (!probe.exists) {
        targets.push({ key: cluster.key, path: t.path, status: 'missing', fromBytes, toBytes: 0 });
        continue;
      }

      if (probe.capped) {
        targets.push({ key: cluster.key, path: t.path, status: 'skipped', fromBytes, toBytes: fromBytes });
        kept.push({ ...t });
        continue;
      }

      const suspicious = probe.newestMtime > scan.finishedAt;

      if (!suspicious) {
        targets.push({ key: cluster.key, path: t.path, status: 'ok', fromBytes, toBytes: fromBytes });
        kept.push({ ...t });
        continue;
      }

      let toBytes = fromBytes;
      if (t.kind === 'whole') {
        const w = await measure.measure(t.path);
        toBytes = w.bytes;
      } else {
        const w = await walk({
          root: t.path,
          olderThanDays:
            typeof t.minAgeDays === 'number' && t.minAgeDays > 0 ? [t.minAgeDays] : [],
        });
        toBytes = w.olderBytes.get(t.minAgeDays ?? 0) ?? 0;
      }

      const changed = toBytes !== fromBytes;
      targets.push({
        key: cluster.key,
        path: t.path,
        status: changed ? 'changed' : 'ok',
        fromBytes,
        toBytes,
      });
      kept.push({ ...t, bytes: toBytes });
    }

    cluster.deleteTargets = kept.length > 0 ? kept : [];
    cluster.reclaimableBytes = kept.reduce((a, tt) => a + (tt.bytes ?? 0), 0);
    if (kept.length === 0) cluster.reclaimableBytes = 0;
  }

  outScan.verifiedAt = checkedAt;

  return { scan: outScan, checkedAt, targets };
}
