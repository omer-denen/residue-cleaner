import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByVerdict, mergeClusters, summarize } from '../src/core/merge.ts';
import type { Cluster, Part, Verdict } from '../src/core/types.ts';

function part(path: string, bytes: number, lastTouched = 100): Part {
  return { path, bytes, files: 1, lastTouched, reclaimableBytes: bytes, origin: 'home' };
}

function verdict(risk: Verdict['risk'], kind: Verdict['kind'], because: string[] = [], pre = [] as string[]): Verdict {
  return {
    risk,
    kind,
    title: `${risk}-${kind}`,
    what: 'w',
    consequence: 'c',
    because,
    preconditions: pre,
    regenerability: 'regenerable',
    confidence: 'high',
  };
}

function cluster(key: string, over: Partial<Cluster> = {}): Cluster {
  return {
    key,
    title: `title-${key}`,
    archetype: 'pkg-manager-cache',
    parts: [part(`C:/${key}`, 100, 10)],
    totalBytes: 100,
    reclaimableBytes: 100,
    lastTouched: 10,
    evidence: {},
    verdict: verdict('safe', 'recommend'),
    ...over,
  };
}

test('mergeClusters: ayni anahtar parca, hedef, kanit ve karari birlestirir', () => {
  const a = cluster('app', {
    parts: [part('C:/a', 100, 10)],
    totalBytes: 100,
    reclaimableBytes: 80,
    lastTouched: 10,
    archetype: 'unknown',
    deleteTargets: [
      { path: 'C:/a/cache', kind: 'whole', label: 'a', bytes: 80 },
      { path: 'C:/a/log', kind: 'older', minAgeDays: 3, label: 'log', bytes: 5 },
    ],
    evidence: {
      owner: { kind: 'directoryName', name: 'a' },
      fileKinds: ['npm-cache'],
      markers: ['m1'],
      logSignals: [{ means: 'GPU', weight: 1 } as never],
      largeFiles: [{ relPath: 'big', bytes: 2, kind: 'archive' }],
    },
    verdict: verdict('safe', 'recommend', ['because-a'], ['pre-a']),
  });
  const b = cluster('app', {
    parts: [part('C:/b', 200, 30)],
    totalBytes: 200,
    reclaimableBytes: 120,
    lastTouched: 30,
    archetype: 'temp-scratch',
    deleteTargets: [
      { path: 'C:/a/CACHE', kind: 'whole', label: 'dup', bytes: 80 },
      { path: 'C:/b/cache', kind: 'whole', label: 'b', bytes: 120 },
    ],
    evidence: {
      fileKinds: ['venv'],
      markers: ['m1', 'm2'],
      logSignals: [{ means: 'GPU', weight: 2 } as never],
      largeFiles: [{ relPath: 'huge', bytes: 3, kind: 'archive' }],
    },
    verdict: verdict('medium', 'ask', ['because-b'], ['pre-b']),
  });

  const out = mergeClusters([a, b]);
  assert.equal(out.length, 1);
  const m = out[0]!;
  assert.equal(m.parts.length, 2);
  assert.equal(m.totalBytes, 300);
  assert.equal(m.reclaimableBytes, 200);
  assert.equal(m.lastTouched, 30);
  assert.equal(m.archetype, 'temp-scratch');
  assert.equal(m.verdict.risk, 'medium');
  assert.deepEqual(m.verdict.because, ['because-a', 'because-b']);
  assert.deepEqual(m.verdict.preconditions, ['pre-a', 'pre-b']);
  assert.equal(m.deleteTargets?.length, 3, 'case-insensitive ayni yol+kind tekrari elenir');
  assert.deepEqual(m.evidence.fileKinds, ['npm-cache', 'venv']);
  assert.deepEqual(m.evidence.markers, ['m1', 'm2']);
  assert.equal(m.evidence.logSignals?.length, 1);
  assert.equal(m.evidence.largeFiles?.[0]?.bytes, 3);
  assert.equal(m.evidence.owner?.kind, 'directoryName');
});

test('mergeClusters: guvenli mimari onceliklidir ve farkli anahtarlar korunur', () => {
  const safe = cluster('safe', { archetype: 'agent-workspace', verdict: verdict('safe', 'recommend') });
  const unknown = cluster('unknown', { archetype: 'unknown', verdict: verdict('low', 'ask') });
  const out = mergeClusters([unknown, safe]);
  assert.equal(out.length, 2);
  const merged = mergeClusters([
    cluster('x', { archetype: 'temp-scratch' }),
    cluster('x', { archetype: 'os-user-data' }),
  ]);
  assert.equal(merged[0]!.archetype, 'temp-scratch');
});

test('mergeClusters: giris degismez, parca dizisi kopyalanir', () => {
  const input = [cluster('a')];
  const before = JSON.stringify(input);
  const out = mergeClusters(input);
  assert.equal(JSON.stringify(input), before);
  out[0]!.parts.push(part('C:/extra', 1));
  assert.equal(input[0]!.parts.length, 1);
});

test('groupByVerdict dort grubu ayirir', () => {
  const groups = groupByVerdict([
    cluster('a', { verdict: verdict('safe', 'recommend') }),
    cluster('b', { verdict: verdict('low', 'ask') }),
    cluster('c', { verdict: verdict('medium', 'report-only') }),
    cluster('d', { verdict: verdict('high', 'keep') }),
  ]);
  assert.deepEqual(groups.recommend.map((c) => c.key), ['a']);
  assert.deepEqual(groups.ask.map((c) => c.key), ['b']);
  assert.deepEqual(groups['report-only'].map((c) => c.key), ['c']);
  assert.deepEqual(groups.keep.map((c) => c.key), ['d']);
});

test('summarize karar bazli baytlari toplar', () => {
  const s = summarize([
    cluster('a', { reclaimableBytes: 10, verdict: verdict('safe', 'recommend') }),
    cluster('b', { reclaimableBytes: 20, verdict: verdict('low', 'ask') }),
    cluster('c', { reclaimableBytes: 30, verdict: verdict('medium', 'report-only') }),
    cluster('d', { reclaimableBytes: 40, verdict: verdict('high', 'keep') }),
  ]);
  assert.equal(s.totalBytes, 400);
  assert.equal(s.reclaimableBytes, 100);
  assert.equal(s.recommendedBytes, 10);
  assert.equal(s.askBytes, 20);
  assert.equal(s.reportOnlyBytes, 70);
});
