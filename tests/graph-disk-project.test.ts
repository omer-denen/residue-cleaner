import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DependencyGraph,
  appendDiskGraph,
  appendProjectGraph,
  groupNodesByKind,
} from '../src/core/dependency-graph.ts';
import type { Cluster } from '../src/core/types.ts';
import type { ProjectCandidateView } from '../src/core/contract.ts';

function cluster(over: Partial<Cluster> = {}): Cluster {
  return {
    key: 'local:ornek-cache',
    title: 'ornek-cache',
    archetype: 'pkg-manager-cache',
    parts: [
      {
        path: 'C:\\Users\\ornek\\AppData\\Local\\ornek-cache',
        bytes: 1024,
        files: 3,
        lastTouched: 1,
        reclaimableBytes: 1024,
        origin: 'localappdata',
      },
    ],
    totalBytes: 1024,
    reclaimableBytes: 1024,
    lastTouched: 1,
    evidence: { owner: { kind: 'packageJson', name: 'ornek-paket' } },
    deleteTargets: [
      {
        path: 'C:\\Users\\ornek\\AppData\\Local\\ornek-cache',
        kind: 'whole',
        label: 'onbellek',
        bytes: 1024,
      },
    ],
    verdict: {
      risk: 'safe',
      kind: 'recommend',
      title: 'Paket onbellegi',
      what: 'Indirilen paketler',
      consequence: 'Yeniden indirilir',
      because: ['CACHEDIR.TAG'],
      preconditions: [],
      regenerability: 'regenerable',
      confidence: 'high',
    },
    ...over,
  };
}

function project(over: Partial<ProjectCandidateView> = {}): ProjectCandidateView {
  return {
    root: 'C:\\projeler\\ornek',
    name: 'ornek',
    markers: ['git', 'node'],
    git: true,
    agentWorkspace: false,
    artifacts: ['node_modules'],
    lockfile: 'package-lock.json',
    lastActivityAt: 2,
    ...over,
  };
}

test('B13-1 disk kumesi dugum olur (kimlik, etiket, yol, meta)', () => {
  const g = appendDiskGraph(new DependencyGraph(), [cluster()]);
  const node = g.node('disk:local:ornek-cache')!;
  assert.equal(node.kind, 'disk-cluster');
  assert.equal(node.label, 'ornek-cache');
  assert.equal(node.path, 'C:\\Users\\ornek\\AppData\\Local\\ornek-cache');
  assert.equal(node.group, 'disk:local:ornek-cache');
  assert.equal(node.protected, false);
  assert.equal(node.meta?.bytes, 1024);
  assert.equal(node.meta?.targets, 1);
  assert.equal(node.meta?.decision, 'recommend');
  assert.equal(node.meta?.regenerable, 'regenerable');
});

test('B13-2 hedefi olmayan kume protected (silinemez dugum)', () => {
  const g = appendDiskGraph(new DependencyGraph(), [
    cluster({
      deleteTargets: undefined,
      verdict: { ...cluster().verdict, kind: 'report-only', regenerability: 'unknown' },
    }),
  ]);
  assert.equal(g.node('disk:local:ornek-cache')!.protected, true);
});

test('B13-3 sahip kaniti ayri dugum + YUMUSAK aidiyet kenari', () => {
  const g = appendDiskGraph(new DependencyGraph(), [cluster()]);
  const owner = g.node('owner:ornek-paket')!;
  assert.equal(owner.kind, 'owner');
  assert.equal(owner.label, 'ornek-paket');
  const edges = g.incoming('disk:local:ornek-cache');
  assert.equal(edges.length, 1);
  assert.equal(edges[0]!.kind, 'ownership');
  assert.equal(edges[0]!.strength, 'soft');
  assert.match(edges[0]!.evidence ?? '', /sahip kaniti: package\.json/);
});

test('B13-4 sahip kenari silmeyi ENGELLEMEZ', () => {
  const g = appendDiskGraph(new DependencyGraph(), [cluster()]);
  g.validate();
  const r = g.whatIf(['disk:local:ornek-cache']);
  assert.deepEqual(r.allowed, ['disk:local:ornek-cache']);
  assert.equal(r.blocked.length, 0);
});

test('B13-5 kanit yoksa sahip dugumu UYDURULMAZ', () => {
  const g = appendDiskGraph(new DependencyGraph(), [cluster({ evidence: {} })]);
  assert.equal(g.node('disk:local:ornek-cache')!.kind, 'disk-cluster');
  assert.equal(g.nodes().filter((n) => n.kind === 'owner').length, 0);
  assert.equal(g.edges().length, 0);
});

test('B13-6 ayni sahip iki kumede tek dugum olur', () => {
  const g = appendDiskGraph(new DependencyGraph(), [
    cluster(),
    cluster({ key: 'local:ornek-ep', title: 'ornek-ep' }),
  ]);
  const owners = g.nodes().filter((n) => n.kind === 'owner');
  assert.equal(owners.length, 1);
  assert.equal(g.incoming('owner:ornek-paket').length, 0);
  assert.equal(g.outgoing('owner:ornek-paket').length, 2);
});

test('B13-7 proje koku + artifact dugumleri ve SERT artifact kenari', () => {
  const g = appendProjectGraph(new DependencyGraph(), [project()]);
  const root = g.node('project:c:\\projeler\\ornek')!;
  assert.equal(root.kind, 'project');
  assert.equal(root.label, 'ornek');
  assert.equal(root.protected, true);
  const artifact = g.node('artifact:c:\\projeler\\ornek\\node_modules')!;
  assert.equal(artifact.kind, 'project-artifact');
  assert.equal(artifact.label, 'node_modules');
  assert.equal(artifact.path, 'C:\\projeler\\ornek\\node_modules');
  assert.equal(artifact.group, root.group);
  const edges = g.outgoing(root.id);
  assert.equal(edges.length, 1);
  assert.equal(edges[0]!.kind, 'artifact');
  assert.equal(edges[0]!.strength, 'hard');
  assert.match(edges[0]!.evidence ?? '', /package-lock\.json/);
});

test('B13-8 artifact silme ayni grup korumasi ile engellenmez', () => {
  const g = appendProjectGraph(new DependencyGraph(), [project()]);
  g.validate();
  const r = g.whatIf(['artifact:c:\\projeler\\ornek\\node_modules']);
  assert.deepEqual(r.allowed, ['artifact:c:\\projeler\\ornek\\node_modules']);
  assert.equal(r.blocked.length, 0);
});

test('B13-9 sert kenara ragmen artifact seviyesi critical olmaz', () => {
  const g = appendProjectGraph(new DependencyGraph(), [project()]);
  const levels = g.levels();
  assert.equal(levels.get('artifact:c:\\projeler\\ornek\\node_modules'), 'low');
  assert.equal(levels.get('project:c:\\projeler\\ornek'), 'critical');
});

test('B13-10 kilitsiz proje artifact kaniti "bilinmiyor" der', () => {
  const g = appendProjectGraph(new DependencyGraph(), [
    project({ lockfile: null, artifacts: ['node_modules', '.venv'] }),
  ]);
  const edges = g.edges();
  assert.equal(edges.length, 2);
  for (const e of edges) assert.match(e.evidence ?? '', /kilit dosyasi yok/);
  assert.equal(g.node('artifact:c:\\projeler\\ornek\\.venv')!.meta?.regenerable, false);
});

test('B13-11 bos kaynak grafigi degistirmez', () => {
  const g = new DependencyGraph();
  g.addNode({ id: 't1', kind: 'tool', label: 'tool1' });
  appendDiskGraph(g, []);
  appendProjectGraph(g, []);
  assert.equal(g.nodes().length, 1);
  assert.equal(g.edges().length, 0);
});

test('B13-12 agac gruplari yeni turleri sirayla gosterir', () => {
  const g = new DependencyGraph();
  appendDiskGraph(g, [cluster()]);
  appendProjectGraph(g, [project()]);
  const kinds = groupNodesByKind(g.nodes()).map((x) => x.kind);
  assert.deepEqual(kinds, ['project', 'project-artifact', 'disk-cluster', 'owner']);
});
