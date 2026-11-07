/**
 * Bagimlilik grafi motoru.
 *
 * Amac: "bunu silersem ne bozulur?" sorusunu tahminle degil, dugum ve
 * kenarlarla yanitlamak. Grafik SILME YAPMAZ; yalnizca plan oncesi
 * etki analizi ve what-if simulasyonu uretir.
 *
 * Yon kurali: `A -> B` = "A, B'ye ihtiyac duyar". Bir dugumu silmek
 * icin GELEN sert+aktif kenarlar incelenir; ayni gruba ait (or. aracin
 * kendi shim'i) kenarlar birlikte kaldirilabildigi icin engel sayilmaz.
 */

import type { CliInventory, CliTool } from './cli-inventory-types.ts';
import type { ProjectCandidateView } from './contract.ts';
import type { Cluster, OwnerSignal } from './types.ts';

export type GraphNodeKind =
  | 'tool'
  | 'package'
  | 'shim'
  | 'path-entry'
  | 'env-var'
  | 'project'
  | 'project-artifact'
  | 'disk-cluster'
  | 'owner'
  | 'state-dir'
  | 'shortcut'
  | 'runtime'
  | 'process'
  | 'config'
  | 'unknown';

export type EdgeKind =
  | 'exec'
  | 'package'
  | 'project-ref'
  | 'artifact'
  | 'ownership'
  | 'env'
  | 'runtime'
  | 'shortcut'
  | 'link'
  | 'config';

export type EdgeStrength = 'hard' | 'soft' | 'weak';

export type EdgeState =
  | 'intact'
  | 'broken'
  | 'shadowed'
  | 'drifted'
  | 'missing-chain'
  | 'cyclic'
  | 'unknown';

export type NodeRole = 'isolated' | 'leaf' | 'shared' | 'hub';
export type DependencyLevel = 'low' | 'medium' | 'high' | 'critical';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  path?: string;
  active?: boolean;
  protected?: boolean;
  /** Birlikte kaldirilabilen kurulum parcalari ayni grubu paylasir. */
  group?: string;
  meta?: Record<string, unknown>;
}

export interface GraphKindGroup {
  kind: GraphNodeKind;
  nodeIds: string[];
}

/** Agac gorunumu icin dugumleri TURUNE gore gruplar (motor kurali). */
const KIND_ORDER: GraphNodeKind[] = [
  'tool',
  'package',
  'shim',
  'path-entry',
  'env-var',
  'project',
  'project-artifact',
  'disk-cluster',
  'owner',
  'state-dir',
  'shortcut',
  'runtime',
  'process',
  'config',
  'unknown',
];

export function groupNodesByKind(nodes: Iterable<GraphNode>): GraphKindGroup[] {
  const groups = new Map<GraphNodeKind, string[]>();
  for (const node of nodes) {
    const list = groups.get(node.kind) ?? [];
    list.push(node.id);
    groups.set(node.kind, list);
  }
  return KIND_ORDER.filter((kind) => groups.has(kind)).map((kind) => ({
    kind,
    nodeIds: groups.get(kind)!,
  }));
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  strength: EdgeStrength;
  /** Kaynak su an etkin mi? (calisan surec, aktif shim, mevcut PATH) */
  active: boolean;
  state: EdgeState;
  evidence?: string;
}

export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface RootCause {
  /** Kok neden dugumu (genellikle eksik hedef). */
  root: string;
  label: string;
  kind: GraphNodeKind | 'missing';
  affected: GraphEdge[];
  /** Ayni kok nedene bagli hata sayisi. */
  count: number;
}

export interface BlockedRemoval {
  id: string;
  label: string;
  dependents: Array<{ id: string; label: string; edge: GraphEdge }>;
  reason: string;
}

export interface WhatIfResult {
  allowed: string[];
  blocked: BlockedRemoval[];
  /** Secim disinda kalan ve kopacak sert/aktif kenarlar. */
  brokenEdges: GraphEdge[];
  /** Secimden sonra hicbir aktif baglantisi kalmayan dugumler. */
  isolated: string[];
}

export interface WhatIfOptions {
  /** Ayni `group` icindeki kenarlar birlikte kaldirilir (varsayilan true). */
  exemptSameGroup?: boolean;
}

function edgeId(from: string, to: string, kind: EdgeKind, suffix = ''): string {
  return `${from}->${to}:${kind}${suffix ? `:${suffix}` : ''}`;
}

export class DependencyGraph {
  private readonly nodeMap = new Map<string, GraphNode>();
  private readonly edgeMap = new Map<string, GraphEdge>();

  static from(snapshot: GraphSnapshot): DependencyGraph {
    const g = new DependencyGraph();
    for (const n of snapshot.nodes) g.addNode(n);
    for (const e of snapshot.edges) g.addEdge(e);
    return g;
  }

  addNode(node: GraphNode): this {
    const existing = this.nodeMap.get(node.id);
    this.nodeMap.set(node.id, existing ? { ...existing, ...node } : node);
    return this;
  }

  addEdge(edge: Omit<GraphEdge, 'id' | 'state'> & { id?: string; state?: EdgeState }): this {
    const id = edge.id ?? edgeId(edge.from, edge.to, edge.kind, edge.evidence);
    const full: GraphEdge = {
      ...edge,
      id,
      state: edge.state ?? 'intact',
    };
    this.edgeMap.set(id, full);
    return this;
  }

  node(id: string): GraphNode | undefined {
    return this.nodeMap.get(id);
  }

  nodes(): GraphNode[] {
    return [...this.nodeMap.values()];
  }

  edges(): GraphEdge[] {
    return [...this.edgeMap.values()];
  }

  outgoing(id: string): GraphEdge[] {
    return this.edges().filter((e) => e.from === id);
  }

  incoming(id: string): GraphEdge[] {
    return this.edges().filter((e) => e.to === id);
  }

  /** Kenar durumlarini gercek dugum varligina gore yeniden hesaplar. */
  validate(): this {
    for (const e of this.edgeMap.values()) {
      const from = this.nodeMap.has(e.from);
      const to = this.nodeMap.has(e.to);
      if (!from && !to) e.state = 'missing-chain';
      else if (!to) e.state = 'broken';
      else if (!from) e.state = 'missing-chain';
      else if (e.state === 'broken' || e.state === 'missing-chain') {
        // Hedef geri geldiyse kenar saglamlasir; diger durumlar korunur.
        e.state = 'intact';
      }
    }
    for (const cycle of this.cycles()) {
      const set = new Set(cycle);
      for (const e of this.edgeMap.values()) {
        if (set.has(e.from) && set.has(e.to)) e.state = 'cyclic';
      }
    }
    return this;
  }

  roles(): Map<string, NodeRole> {
    const out = new Map<string, NodeRole>();
    for (const n of this.nodeMap.values()) {
      const inc = this.incoming(n.id).length;
      const outg = this.outgoing(n.id).length;
      if (inc + outg === 0) out.set(n.id, 'isolated');
      else if (inc >= 2) out.set(n.id, 'shared');
      else if (outg >= 4) out.set(n.id, 'hub');
      else out.set(n.id, 'leaf');
    }
    return out;
  }

  /**
   * Etkin bagimlilik seviyesi. Sert/aktif gelen kenarlar agirliklidir;
   * korunan dugumler her zaman "critical"dir (silinemez).
   */
  levels(): Map<string, DependencyLevel> {
    const out = new Map<string, DependencyLevel>();
    for (const n of this.nodeMap.values()) {
      const inc = this.incoming(n.id).filter(
        (e) =>
          e.state !== 'broken' &&
          e.state !== 'missing-chain' &&
          // Ayni kurulum grubundaki shim/paket kenarlari "bagimlilik"
          // degil kurulumun kendi parcalaridir; seviyeyi sisirmesin.
          this.nodeMap.get(e.from)?.group !== n.group,
      );
      const hardActive = inc.filter((e) => e.strength === 'hard' && e.active).length;
      const active = inc.filter((e) => e.active).length;
      let level: DependencyLevel;
      if (n.protected || hardActive >= 5) level = 'critical';
      else if (hardActive >= 3 || active >= 5) level = 'high';
      else if (inc.length >= 1) level = 'medium';
      else level = 'low';
      out.set(n.id, level);
    }
    return out;
  }

  /** Tarjan SCC: dongu olan dugum gruplari (tek eleman + self-loop dahil). */
  cycles(): string[][] {
    let index = 0;
    const idx = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const out: string[][] = [];

    const visit = (v: string): void => {
      idx.set(v, index);
      low.set(v, index);
      index++;
      stack.push(v);
      onStack.add(v);

      for (const e of this.outgoing(v)) {
        if (!this.nodeMap.has(e.to)) continue;
        if (!idx.has(e.to)) {
          visit(e.to);
          low.set(v, Math.min(low.get(v)!, low.get(e.to)!));
        } else if (onStack.has(e.to)) {
          low.set(v, Math.min(low.get(v)!, idx.get(e.to)!));
        }
      }

      if (low.get(v) === idx.get(v)) {
        const comp: string[] = [];
        for (;;) {
          const w = stack.pop();
          if (w === undefined) break;
          onStack.delete(w);
          comp.push(w);
          if (w === v) break;
        }
        const selfLoop = comp.length === 1 && this.outgoing(comp[0]!).some((e) => e.to === comp[0]);
        if (comp.length > 1 || selfLoop) out.push(comp);
      }
    };

    for (const id of this.nodeMap.keys()) {
      if (!idx.has(id)) visit(id);
    }
    return out;
  }

  /**
   * Kopukluklarin KOK NEDENLERI: 20 hata yerine kac eksik hedef varsa
   * o kadar satir. Ayni hedefe isaret eden tum kenarlar gruplanir.
   */
  rootCauses(): RootCause[] {
    const groups = new Map<string, GraphEdge[]>();
    for (const e of this.edgeMap.values()) {
      if (e.state !== 'broken' && e.state !== 'missing-chain') continue;
      const root = this.nodeMap.has(e.to) ? e.to : e.to;
      const list = groups.get(root) ?? [];
      list.push(e);
      groups.set(root, list);
    }
    const out: RootCause[] = [];
    for (const [root, affected] of groups) {
      const node = this.nodeMap.get(root);
      out.push({
        root,
        label: node?.label ?? root,
        kind: node?.kind ?? 'missing',
        affected,
        count: affected.length,
      });
    }
    return out.sort((a, b) => b.count - a.count);
  }

  /**
   * "Silersem ne olur?" simulasyonu. Secim BIRLIKTE degerlendirilir:
   * kendi grubundaki kenarlar engel sayilmaz; secim disindaki sert ve
   * aktif bir kenar kopuyorsa oge engellenir.
   */
  whatIf(removeIds: Iterable<string>, opts: WhatIfOptions = {}): WhatIfResult {
    const remove = new Set([...removeIds].filter((id) => this.nodeMap.has(id)));
    const exemptSameGroup = opts.exemptSameGroup !== false;
    const blocked: BlockedRemoval[] = [];
    const broken: GraphEdge[] = [];

    for (const id of remove) {
      const node = this.nodeMap.get(id)!;
      const dependents: BlockedRemoval['dependents'] = [];
      for (const e of this.incoming(id)) {
        if (!e.active || e.strength !== 'hard') continue;
        if (e.state === 'broken' || e.state === 'missing-chain') continue;
        if (remove.has(e.from)) continue;
        if (exemptSameGroup && node.group && this.nodeMap.get(e.from)?.group === node.group) continue;
        const from = this.nodeMap.get(e.from);
        dependents.push({ id: e.from, label: from?.label ?? e.from, edge: e });
      }
      if (dependents.length > 0) {
        blocked.push({
          id,
          label: node.label,
          dependents,
          reason: `${dependents.length} sert/aktif bagimlilik bu ogeye ihtiyac duyuyor`,
        });
      }
    }

    for (const e of this.edgeMap.values()) {
      if (!e.active || e.strength !== 'hard') continue;
      if (!remove.has(e.from) || remove.has(e.to)) continue;
      if (e.state === 'broken' || e.state === 'missing-chain') continue;
      broken.push(e);
    }

    const allowed = [...remove].filter((id) => !blocked.some((b) => b.id === id));
    // Secimden sonra hic baglantisi kalmayan dugumler (bilgi amacli).
    const allowedSet = new Set(allowed);
    const isolated: string[] = [];
    for (const n of this.nodeMap.values()) {
      if (allowedSet.has(n.id)) continue;
      const inc = this.incoming(n.id).filter(
        (e) => !allowedSet.has(e.from) && e.state !== 'broken' && e.state !== 'missing-chain',
      );
      const out = this.outgoing(n.id).filter(
        (e) => !allowedSet.has(e.to) && e.state !== 'broken' && e.state !== 'missing-chain',
      );
      if (inc.length === 0 && out.length === 0) isolated.push(n.id);
    }

    return { allowed, blocked, brokenEdges: broken, isolated };
  }

  /** Topolojik sira (bagimlilar once). Dongude kalanlar sona eklenir. */
  topoOrder(): string[] {
    const indeg = new Map<string, number>();
    for (const id of this.nodeMap.keys()) indeg.set(id, 0);
    for (const e of this.edgeMap.values()) {
      if (!this.nodeMap.has(e.from) || !this.nodeMap.has(e.to)) continue;
      indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    }
    const queue = [...indeg.entries()].filter(([, n]) => n === 0).map(([id]) => id);
    const out: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      out.push(id);
      for (const e of this.outgoing(id)) {
        if (!this.nodeMap.has(e.to)) continue;
        const n = (indeg.get(e.to) ?? 1) - 1;
        indeg.set(e.to, n);
        if (n === 0) queue.push(e.to);
      }
    }
    if (out.length < this.nodeMap.size) {
      for (const id of this.nodeMap.keys()) if (!out.includes(id)) out.push(id);
    }
    return out;
  }

  snapshot(): GraphSnapshot {
    return { nodes: this.nodes(), edges: this.edges() };
  }
}

// ---------------------------------------------------------------------------
// Envanterden grafik kurucu
// ---------------------------------------------------------------------------

function toolId(tool: CliTool): string {
  return `tool:${tool.source}:${tool.packageName.toLowerCase()}`;
}

function packageId(name: string): string {
  return `pkg:${name.toLowerCase()}`;
}

/**
 * CLI envanteri + PATH kanallarindan grafik uretir.
 *
 * Ayni kurulumun araci, paketi ve shim'i ayni `group` altindadir;
 * boylece "araci kaldir" islemi kendi shim'i yuzunden engellenmez.
 * Proje/config/surec referanslari farkli gruptadir ve engel olabilir.
 */
export function buildInventoryGraph(inv: CliInventory): DependencyGraph {
  const g = new DependencyGraph();

  for (const tool of inv.tools) {
    const tId = toolId(tool);
    const group = `install:${tool.source}:${tool.packageName.toLowerCase()}`;
    g.addNode({
      id: tId,
      kind: 'tool',
      label: tool.command,
      path: tool.installPath,
      active: tool.activeShim === true || tool.status === 'recent',
      protected: tool.status === 'protected',
      group,
      meta: {
        source: tool.source,
        version: tool.version,
        status: tool.status,
        idleDays: tool.idleDays,
      },
    });

    const pId = packageId(tool.packageName);
    g.addNode({
      id: pId,
      kind: 'package',
      label: tool.packageName,
      group,
      meta: { version: tool.version, source: tool.source },
    });
    g.addEdge({
      from: tId,
      to: pId,
      kind: 'package',
      strength: 'hard',
      active: true,
      evidence: `${tool.source} paketi`,
    });

    for (const shim of tool.shims) {
      const sId = `shim:${shim.toLowerCase()}`;
      g.addNode({
        id: sId,
        kind: 'shim',
        label: shim.split(/[\\/]/).pop() ?? shim,
        path: shim,
        active: tool.activeShim === true,
        group,
      });
      g.addEdge({
        from: sId,
        to: tId,
        kind: 'link',
        strength: 'hard',
        active: tool.activeShim === true,
        state: tool.activeShim === true ? 'intact' : 'shadowed',
        evidence: tool.activeShim === true ? 'aktif shim' : 'golgede kalan shim',
      });
    }

    for (const stateDir of tool.stateDirs) {
      const stId = `state:${stateDir.toLowerCase()}`;
      g.addNode({
        id: stId,
        kind: 'state-dir',
        label: stateDir.split(/[\\/]/).pop() ?? stateDir,
        path: stateDir,
      });
      g.addEdge({
        from: tId,
        to: stId,
        kind: 'config',
        strength: 'soft',
        active: true,
        evidence: 'arac durum klasoru kullaniyor',
      });
    }

    for (const ref of tool.references ?? []) {
      const refId = `ref:${ref.kind}:${ref.path.toLowerCase()}`;
      g.addNode({
        id: refId,
        kind:
          ref.kind === 'process'
            ? 'process'
            : ref.kind === 'shortcut'
              ? 'shortcut'
              : 'config',
        label: ref.path.split(/[\\/]/).pop() ?? ref.path,
        path: ref.path,
        active: ref.kind === 'process',
      });
      g.addEdge({
        from: refId,
        to: tId,
        kind: ref.kind === 'process' ? 'exec' : ref.kind === 'shortcut' ? 'shortcut' : 'config',
        strength: ref.kind === 'process' ? 'hard' : 'soft',
        active: ref.kind === 'process',
        evidence: ref.detail,
      });
    }
  }

  // PATH golgeleme: ayni komut birden fazla dizinde.
  for (const shadow of inv.pathShadows ?? []) {
    for (let i = 0; i < shadow.entries.length; i++) {
      const entry = shadow.entries[i]!;
      const pId = `path:${entry.path.toLowerCase()}`;
      g.addNode({
        id: pId,
        kind: 'path-entry',
        label: entry.path,
        path: entry.path,
        active: i === 0,
      });
      const tool = inv.tools.find((t) => t.command.toLowerCase() === shadow.command.toLowerCase());
      if (tool) {
        // Arac PATH girdisine ihtiyac duyar; ters yon (PATH -> arac) olsaydi
        // her aracin kaldirilmasi "PATH bagimliligi" diye engellenirdi.
        g.addEdge({
          from: toolId(tool),
          to: pId,
          kind: 'env',
          strength: 'hard',
          active: i === 0,
          state: i === 0 ? 'intact' : 'shadowed',
          evidence: i === 0 ? 'PATH sirasinda ilk' : 'PATH sirasinda golgede',
        });
      }
    }
  }

  g.validate();
  return g;
}

// ---------------------------------------------------------------------------
// Disk kumeleri + proje artifact'lari (SALT OKUNUR; onbellekten beslenir)
// ---------------------------------------------------------------------------

/**
 * Kume sahibi kanitini okunabilir ada cevirir. Kanit turu metne girer;
 * ayni sekilde ad UYDURULMAZ (kanit yoksa dugum de yok).
 */
function ownerRef(owner: OwnerSignal | undefined): { label: string; evidence: string } | null {
  if (!owner) return null;
  switch (owner.kind) {
    case 'packageJson':
      return { label: owner.name, evidence: 'package.json kimligi' };
    case 'manifest':
      return { label: owner.app, evidence: 'uygulama manifesti' };
    case 'logFile':
      return { label: owner.product, evidence: 'log urun kimligi' };
    case 'binaryProduct':
      return { label: owner.product, evidence: 'ikili urun kimligi' };
    case 'directoryName':
      return { label: owner.name, evidence: 'klasor adi' };
  }
}

function ownerNodeId(label: string): string {
  return `owner:${label.toLowerCase()}`;
}

/**
 * Disk taramasinin kumelerini grafige ekler.
 *
 * Kume bir dugumdur; sahibi (kanit varsa) ayri dugumdur ve
 * `ownership` kenari YUMUSAK'tir: sahip, kumenin silinmesini engellemez.
 * Rapor-only / korunan kumeler `protected` isaretlenir (seviye critical).
 */
export function appendDiskGraph(
  g: DependencyGraph,
  clusters: readonly Cluster[],
): DependencyGraph {
  for (const cluster of clusters) {
    const id = `disk:${cluster.key}`;
    const primary = cluster.parts[0]?.path;
    const targets = cluster.deleteTargets?.length ?? 0;
    g.addNode({
      id,
      kind: 'disk-cluster',
      label: cluster.title || cluster.key,
      ...(primary ? { path: primary } : {}),
      protected: cluster.verdict.kind === 'keep' || cluster.verdict.kind === 'report-only',
      group: id,
      meta: {
        archetype: cluster.archetype,
        bytes: cluster.totalBytes,
        reclaimableBytes: cluster.reclaimableBytes,
        risk: cluster.verdict.risk,
        decision: cluster.verdict.kind,
        regenerable: cluster.verdict.regenerability,
        parts: cluster.parts.length,
        targets,
      },
    });

    const owner = ownerRef(cluster.evidence.owner);
    if (owner) {
      const oId = ownerNodeId(owner.label);
      g.addNode({ id: oId, kind: 'owner', label: owner.label });
      g.addEdge({
        from: oId,
        to: id,
        kind: 'ownership',
        strength: 'soft',
        active: true,
        evidence: `sahip kaniti: ${owner.evidence}`,
      });
    }
  }
  return g;
}

function joinChild(root: string, name: string): string {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  return `${root.replace(/[\\/]+$/, '')}${sep}${name}`;
}

/**
 * Proje kesif onbellegindeki projeleri grafige ekler.
 *
 * Proje kokune giden `artifact` kenari SERT'tir (artifact'lar projenin
 * parcasi) ama ayni grupta oldugu icin what-if'te kendi projesi engel
 * sayilmaz. Proje koku `protected`: Residue proje kaynagini hedef gostermez.
 */
export function appendProjectGraph(
  g: DependencyGraph,
  projects: readonly ProjectCandidateView[],
): DependencyGraph {
  for (const project of projects) {
    const group = `project:${project.root.toLowerCase()}`;
    g.addNode({
      id: group,
      kind: 'project',
      label: project.name,
      path: project.root,
      protected: true,
      group,
      meta: {
        git: project.git,
        agentWorkspace: project.agentWorkspace,
        lockfile: project.lockfile,
        markers: project.markers,
        lastActivityAt: project.lastActivityAt,
      },
    });

    for (const artifact of project.artifacts) {
      const path = joinChild(project.root, artifact);
      const aId = `artifact:${path.toLowerCase()}`;
      g.addNode({
        id: aId,
        kind: 'project-artifact',
        label: artifact,
        path,
        group,
        meta: {
          project: project.root,
          lockfile: project.lockfile,
          regenerable: project.lockfile !== null,
          reportOnly: true,
        },
      });
      g.addEdge({
        from: group,
        to: aId,
        kind: 'artifact',
        strength: 'hard',
        active: true,
        evidence: project.lockfile
          ? `${project.lockfile} kilit dosyasi (yeniden uretilebilir)`
          : 'kilit dosyasi yok (yeniden uretilebilirlik bilinmiyor)',
      });
    }
  }
  return g;
}

// ---------------------------------------------------------------------------
// Dugum eslestirici (SAF; kullanici sorgusu -> dugumler. Siralama MOTORDA)
// ---------------------------------------------------------------------------

export interface NodeMatchQuery {
  text: string;
  /** Varsayilan 5. */
  limit?: number;
}

/** Dugumleri sorguya gore eslestirir (SAF; siralama MOTORDA). */
export function matchGraphNodes<
  T extends { id: string; label: string; kind: string; path?: string },
>(nodes: Iterable<T>, query: NodeMatchQuery): Array<Pick<T, 'id' | 'label' | 'kind'>> {
  const raw = query.text.trim();
  if (!raw) return [];
  const q = normalizeMatchText(raw);
  if (!q) return [];
  const limit = query.limit ?? 5;

  const scored: Array<Pick<T, 'id' | 'label' | 'kind'> & { score: number }> = [];
  for (const node of nodes) {
    const idN = normalizeMatchText(node.id);
    const labelN = normalizeMatchText(node.label);
    const pathN = node.path ? normalizeMatchText(node.path) : '';
    let score = 0;
    if (idN === q) score = 100;
    else {
      if (pathN && pathN === q) score = 90;
      else if (labelN === q) score = 80;
      else if (pathN && pathN.endsWith(q)) score = 70;
    }
    if (score === 0 && (idN.includes(q) || labelN.includes(q) || (pathN && pathN.includes(q)))) {
      score = 10;
    }
    if (score === 0) continue;
    scored.push({ id: node.id, label: node.label, kind: node.kind, score });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score || // once skor
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0), // esitlikte id alfabetik
  );
  return scored.slice(0, limit).map(({ id, label, kind }) => ({ id, label, kind }));
}

/**
 * Eslestirme normalizasyonu: kucuk harf, `\` ve `/` ayni sayilir,
 * bastaki Windows uzun yol oneki (`\\?\`) atilir, coklu bosluk sadelesir.
 */
function normalizeMatchText(text: string): string {
  let t = text.trim();
  if (t.startsWith('\\\\?\\')) t = t.slice(4);
  return t.toLowerCase().replace(/[\\/]+/g, '/').replace(/\s+/g, ' ');
}
