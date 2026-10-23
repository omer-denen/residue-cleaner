import {
  buildInventoryGraph,
  groupNodesByKind,
  matchGraphNodes,
  type DependencyGraph,
  type EdgeState,
} from '../core/dependency-graph.ts';
import type { CliInventoryService } from './cli-inventory-service.ts';
import type {
  DependenciesResponse,
  DependencyRefView,
  GraphViewResponse,
  GraphWhatIfResponse,
} from '../core/contract.ts';

/**
 * Bagimlilik grafigi servisi. Envanteri (gerekirse) tazeler ve
 * dugum/kenar gorunumu ile what-if sonucu uretir. Silme YAPMAZ.
 */

/** Kenar durumu agirligi (broken en once gorunur; unknown en son). */
const REF_STATE_WEIGHT: Record<EdgeState, number> = {
  broken: 6,
  'missing-chain': 5,
  shadowed: 4,
  drifted: 3,
  cyclic: 2,
  intact: 1,
  unknown: 0,
};

/** Bagimlilik referanslari: once kok nedenler (kirik/golgede), sonra etiket. */
function sortRefs(refs: DependencyRefView[]): DependencyRefView[] {
  return refs.sort(
    (a, b) =>
      REF_STATE_WEIGHT[b.state] - REF_STATE_WEIGHT[a.state] ||
      a.label.localeCompare(b.label),
  );
}

export class GraphService {
  private readonly inventory: CliInventoryService;

  constructor(inventory: CliInventoryService) {
    this.inventory = inventory;
  }

  private async graph(force = true): Promise<DependencyGraph> {
    const inv = force
      ? (this.inventory.getLast() ?? (await this.inventory.ensure()))
      : this.inventory.getLast();
    if (!inv) throw new Error('envanter onbellegi yok');
    const g = buildInventoryGraph(inv);
    g.validate();
    return g;
  }

  /** Onbellekte envanter yoksa `null` doner; AGIR tarama tetiklemez. */
  async viewCached(): Promise<GraphViewResponse | null> {
    const inv = this.inventory.getLast();
    if (!inv) return null;
    const g = await this.graph(false);
    return this.toView(g);
  }

  private toView(g: DependencyGraph): GraphViewResponse {
    const roles = g.roles();
    const levels = g.levels();
    const cycles = g.cycles();
    const ref = (id: string, edge: GraphViewResponse['edges'][number]) => {
      const node = g.node(id);
      return {
        id,
        label: node?.label ?? id,
        kind: node?.kind ?? ('unknown' as const),
        edge,
      };
    };
    const nodes = g.nodes().map((n) => ({
      ...n,
      role: roles.get(n.id) ?? 'isolated',
      level: levels.get(n.id) ?? 'low',
      dependents: g.incoming(n.id).map((e) => ref(e.from, e)),
      needs: g.outgoing(n.id).map((e) => ref(e.to, e)),
    }));
    const edges = g.edges();
    const groups = groupNodesByKind(g.nodes());
    const brokenEdges = edges.filter(
      (e) => e.state === 'broken' || e.state === 'missing-chain',
    );
    const shadowedEdges = edges.filter((e) => e.state === 'shadowed');
    const criticalNodes = nodes.filter((n) => n.level === 'critical');

    const stateOrder = [
      'broken',
      'missing-chain',
      'shadowed',
      'drifted',
      'cyclic',
      'intact',
      'unknown',
    ] as const;
    const stateCounts = new Map<string, number>();
    for (const e of edges) stateCounts.set(e.state, (stateCounts.get(e.state) ?? 0) + 1);

    return {
      nodes,
      edges,
      groups,
      details: {
        nodeKindCounts: groups.map((group) => ({
          kind: group.kind,
          count: group.nodeIds.length,
        })),
        edgeStateCounts: stateOrder
          .filter((state) => stateCounts.has(state))
          .map((state) => ({ state, count: stateCounts.get(state) ?? 0 })),
        brokenEdges,
        shadowedEdges,
        criticalNodes,
      },
      cycles,
      rootCauses: g.rootCauses(),
      summary: {
        nodes: nodes.length,
        edges: edges.length,
        broken: brokenEdges.length,
        shadowed: shadowedEdges.length,
        cycles: cycles.length,
        critical: criticalNodes.length,
      },
    };
  }

  async view(): Promise<GraphViewResponse> {
    return this.toView(await this.graph());
  }

  /**
   * Secili oge(n)in bagimliliklari: sorguya eslesen dugumleri bulur,
   * gelen/giden kenarlari birlestirir. YALNIZ onbellek kullanir;
   * agir tarama tetiklemez (arayuzdeki "Bagimliliklari goster" diyezi).
   */
  async relations(query: string): Promise<DependenciesResponse> {
    const q = query.trim().slice(0, 200);
    if (!q) {
      return { query: '', matched: [], dependents: [], needs: [], note: 'empty' };
    }
    const view = await this.viewCached();
    if (!view) {
      return { query: q, matched: [], dependents: [], needs: [], note: 'no-cache' };
    }
    const matched = matchGraphNodes(view.nodes, { text: q });
    if (matched.length === 0) {
      return { query: q, matched: [], dependents: [], needs: [], note: 'no-match' };
    }

    // Dugum kimlikleri icinde mi diye bakmak icin indeks.
    const byId = new Map(view.nodes.map((n) => [n.id, n]));
    const matchIds = new Set(matched.map((m) => m.id));
    const collect = (key: 'dependents' | 'needs'): DependencyRefView[] => {
      // id ile tekillestir (ilk gorulen kazanir); eslesen dugumlerin
      // KENDI kimlikleri dislida (kendi kendine bagimlilik raporlanmaz).
      const seen = new Map<string, DependencyRefView>();
      for (const m of matched) {
        const node = byId.get(m.id);
        if (!node) continue;
        for (const ref of node[key]) {
          if (matchIds.has(ref.id)) continue;
          if (!seen.has(ref.id)) {
            seen.set(ref.id, {
              id: ref.id,
              label: ref.label,
              kind: ref.kind,
              state: ref.edge.state,
            });
          }
        }
      }
      return sortRefs([...seen.values()]);
    };
    return {
      query: q,
      matched,
      dependents: collect('dependents'),
      needs: collect('needs'),
      note: null,
    };
  }

  async whatIf(query: string): Promise<GraphWhatIfResponse> {
    const g = await this.graph();
    const q = query.toLowerCase();
    const nodeIds = g
      .nodes()
      .filter(
        (n) =>
          n.id.toLowerCase().includes(q) ||
          n.label.toLowerCase() === q ||
          n.label.toLowerCase().includes(q) ||
          n.path?.toLowerCase().includes(q),
      )
      .map((n) => n.id);
    return { nodeIds, result: g.whatIf(nodeIds) };
  }

  /**
   * Tek dugumun KESIN kimligiyle simulasyon (arayuzdeki satir eylemi).
   * Serbest arama alt dizi eslestirdigi icin satir eylemi kimlik kullanir;
   * bilinmeyen kimlik bos sonuc doner (sessizce yok sayilir).
   */
  async whatIfNode(nodeId: string): Promise<GraphWhatIfResponse> {
    const g = await this.graph();
    const node = g.node(nodeId);
    const nodeIds = node ? [node.id] : [];
    return { nodeIds, result: g.whatIf(nodeIds) };
  }
}
