import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFindings,
  cliFindings,
  diskFindings,
  findingClusterKey,
  mergeFindings,
} from '../src/core/findings.ts';
import type { CliInventory, CliTool } from '../src/core/cli-inventory-types.ts';
import type { Cluster } from '../src/core/types.ts';

function cluster(over: Partial<Cluster> = {}): Cluster {
  return {
    key: 'demo',
    title: 'Demo',
    archetype: 'pkg-manager-cache',
    parts: [{ path: 'C:\\demo', bytes: 10, files: 1, lastTouched: 0, reclaimableBytes: 10, origin: 'home' }],
    totalBytes: 10,
    reclaimableBytes: 10,
    lastTouched: 0,
    evidence: { fileKinds: ['npm-cache'], markers: ['m1', 'm2', 'm3', 'm4'] },
    verdict: {
      risk: 'safe',
      kind: 'recommend',
      title: '',
      what: '',
      consequence: 'onbellek',
      because: [],
      preconditions: [],
      regenerability: 'regenerable',
      confidence: 'high',
    },
    ...over,
  };
}

function tool(over: Partial<CliTool> = {}): CliTool {
  return {
    id: 't1',
    command: 't1',
    source: 'npm-global',
    packageName: 't1',
    version: '1.0.0',
    installPath: 'C:\\npm\\t1',
    shims: ['C:\\bin\\t1.cmd'],
    stalePaths: [],
    stateDirs: ['C:\\state'],
    installedAt: 0,
    lastAccessAt: 0,
    lastStateAt: 0,
    historyMentions: 0,
    historyLastRatio: 1,
    totalBytes: 5,
    idleDays: 40,
    status: 'unused',
    confidence: 'high',
    evidence: ['e1'],
    usageSignals: [],
    atimeSuspect: false,
    uninstall: null,
    ...over,
  };
}

test('diskFindings yol, kanit, yas ve hedef sayisini tasir', () => {
  const out = diskFindings([cluster({ deleteTargets: [{ path: 'C:\\demo', kind: 'whole', label: 'd', bytes: 10 }] })]);
  assert.equal(out.length, 1);
  const f = out[0]!;
  assert.equal(f.id, 'disk:demo');
  assert.equal(f.path, 'C:\\demo');
  assert.equal(f.idleDays, null);
  assert.equal(f.targets, 1);
  assert.deepEqual(f.evidence, ['npm-cache', 'm1', 'm2', 'm3']);
  assert.equal(f.selectable, true);
  assert.equal(f.risk, 'safe');
});

test('diskFindings parca yoksa bos yol ve gecmis tarih kullanir', () => {
  const [f] = diskFindings([cluster({ parts: [], lastTouched: Date.now() - 5 * 86_400_000 })]);
  assert.equal(f!.path, '');
  assert.equal(f!.idleDays, 5);
});

test('cliFindings envanter yoksa bos doner', () => {
  assert.deepEqual(cliFindings(null), []);
  assert.deepEqual(cliFindings({ tools: [] } as unknown as CliInventory), []);
});

test('cliFindings duruma gore risk, gerekce ve kategori uretir', () => {
  const inv = {
    tools: [
      tool({ id: 'a', status: 'unused', confidence: 'high' }),
      tool({ id: 'b', status: 'unused', confidence: 'low', idleDays: 12 }),
      tool({ id: 'c', status: 'recent' }),
      tool({ id: 'd', status: 'unknown', idleDays: Number.POSITIVE_INFINITY }),
      tool({ id: 'e', status: 'protected' }),
    ],
  } as unknown as CliInventory;
  const out = cliFindings(inv);
  assert.equal(out.length, 5);
  assert.equal(out[0]!.risk, 'low');
  assert.equal(out[1]!.risk, 'medium');
  assert.match(out[1]!.reason, /12 g.nd.r kullan/);
  assert.equal(out[2]!.risk, 'safe');
  assert.match(out[2]!.reason, /Yak/);
  assert.equal(out[3]!.idleDays, null);
  assert.match(out[3]!.reason, /kan.t/);
  assert.equal(out[4]!.category, 'protected');
  assert.equal(out[4]!.targets, 2);
  assert.equal(out[0]!.selectable, false);
});

test('birlestirme, kimlik cozumleme ve bos tarama', () => {
  const disk = diskFindings([cluster()]);
  const cli = cliFindings({ tools: [tool()] } as unknown as CliInventory);
  const all = mergeFindings(disk, cli);
  assert.deepEqual(all.map((f) => f.source), ['disk', 'cli']);
  assert.equal(findingClusterKey({ id: 'disk:demo' }), 'demo');
  assert.equal(findingClusterKey({ id: 'disk:' }), null);
  assert.equal(findingClusterKey({ id: 'cli:t1' }), null);
  assert.equal(buildFindings(null, null).length, 0);
  assert.equal(buildFindings({ clusters: [cluster()] } as never, null).length, 1);
});
