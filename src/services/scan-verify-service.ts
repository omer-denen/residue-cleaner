import { probeDirs, type DirProbe } from '../core/freshness.ts';
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

const CONCURRENCY = 4;

export async function verifyScanTargets(
  scan: ScanResult,
  now?: number,
): Promise<VerifyOutcome> {
  const checkedAt = now ?? Date.now();
  const outScan = cloneScan(scan);
  const measure = new MeasureCache();

  // Hazırlık: (küme sırası, hedef sırası) korunarak düz liste.
  interface WorkItem {
    clusterIndex: number;
    targetIndex: number;
    cluster: (typeof outScan.clusters)[number];
    target: DeleteTarget;
    fromBytes: number;
  }
  const items: WorkItem[] = [];
  outScan.clusters.forEach((cluster, ci) => {
    const currentTargets = cluster.deleteTargets ? [...cluster.deleteTargets] : [];
    currentTargets.forEach((t, ti) => {
      items.push({ clusterIndex: ci, targetIndex: ti, cluster, target: t, fromBytes: t.bytes });
    });
  });

  // Aynı yol birden çok hedefte geçerse tek okuma: Map<path, Promise<DirProbe>>.
  const probePromises = new Map<string, Promise<DirProbe>>();

  function getProbe(path: string): Promise<DirProbe> {
    const existing = probePromises.get(path);
    if (existing) return existing;
    const p = probeDirs(path);
    probePromises.set(path, p);
    return p;
  }

  interface ItemResult {
    status: 'ok' | 'missing' | 'changed' | 'skipped';
    fromBytes: number;
    toBytes: number;
    keptTarget: DeleteTarget | null;
  }

  const results: ItemResult[] = new Array(items.length);

  async function processItem(item: WorkItem): Promise<ItemResult> {
    const t = item.target;
    const fromBytes = item.fromBytes;
    const probe = await getProbe(t.path);

    if (!probe.exists) {
      return { status: 'missing', fromBytes, toBytes: 0, keptTarget: null };
    }

    if (probe.capped) {
      return { status: 'skipped', fromBytes, toBytes: fromBytes, keptTarget: { ...t } };
    }

    const suspicious = probe.newestMtime > scan.finishedAt;

    if (!suspicious) {
      return { status: 'ok', fromBytes, toBytes: fromBytes, keptTarget: { ...t } };
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
    const keptTarget = { ...t, bytes: toBytes };
    return {
      status: changed ? 'changed' : 'ok',
      fromBytes,
      toBytes,
      keptTarget,
    };
  }

  // Sabit eşzamanlılık (4) ile ölçüm; sonuçlar indekslerine göre yazılır.
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      const item = items[i]!;
      const res = await processItem(item);
      results[i] = res;
    }
  }

  const workerCount = Math.min(CONCURRENCY, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  // Sonuçlar toplandıktan sonra hedef listesi (girdi sırasıyla aynı).
  const targets: TargetCheck[] = [];
  for (let i = 0; i < items.length; i++) {
    const r = results[i]!;
    const it = items[i]!;
    targets.push({
      key: it.cluster.key,
      path: it.target.path,
      status: r.status,
      fromBytes: r.fromBytes,
      toBytes: r.toBytes,
    });
  }

  // Küme güncellemesi sonuçlar toplandıktan sonra, mevcut sırayla.
  const clusterKept = new Map<number, DeleteTarget[]>();
  for (let i = 0; i < items.length; i++) {
    const r = results[i]!;
    const it = items[i]!;
    const ci = it.clusterIndex;
    if (!clusterKept.has(ci)) clusterKept.set(ci, []);
    if (r.keptTarget) clusterKept.get(ci)!.push(r.keptTarget);
  }

  outScan.clusters.forEach((cluster, ci) => {
    const kept = clusterKept.get(ci) ?? [];
    cluster.deleteTargets = kept.length > 0 ? kept : [];
    cluster.reclaimableBytes = kept.reduce((a, tt) => a + (tt.bytes ?? 0), 0);
    if (kept.length === 0) cluster.reclaimableBytes = 0;
  });

  outScan.verifiedAt = checkedAt;

  return { scan: outScan, checkedAt, targets };
}
