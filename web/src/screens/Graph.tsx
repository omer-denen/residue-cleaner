import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type {
  CliInventoryStreamEvent,
  GraphEdge,
  GraphNodeKind,
  GraphNodeView,
  GraphViewResponse,
  GraphWhatIfResponse,
} from '../../../src/core/contract.ts';
import { api, ApiError } from '../api.ts';
import { translate, translateUpper, type Lang, type MessageKey } from '../i18n.ts';
import {
  GRAPH_EDGE_LABEL,
  GRAPH_LEVEL_LABEL,
  GRAPH_NODE_LABEL,
  GRAPH_ROLE_LABEL,
  GRAPH_STATE_LABEL,
  GRAPH_STRENGTH_LABEL,
} from '../labels.ts';
import { openEvents } from '../sse.ts';
import { RightPanelPortal, useRightPanel } from '../components/RightPanel.tsx';

interface Props {
  lang: Lang;
  /** Disk taramasi suruyor: envanter baslatilmaz (tek agir is kurali). */
  diskScanning?: boolean;
}

type ScreenProfile = 'protect' | 'experiment';
type WorkspaceTab = 'nodes' | 'edges';
type SummaryKey = 'nodes' | 'edges' | 'broken' | 'shadowed' | 'cycles' | 'critical';
type CardTone = 'info' | 'ok' | 'warn' | 'danger' | 'vault';

interface ExpandedRow {
  nodeId: string;
  loading: boolean;
  result: GraphWhatIfResponse | null;
  error: string | null;
}

const GROUP_LABEL: Record<GraphNodeKind, MessageKey> = {
  tool: 'graph.group.tool',
  package: 'graph.group.package',
  shim: 'graph.group.shim',
  'path-entry': 'graph.group.pathEntry',
  'env-var': 'graph.group.envVar',
  project: 'graph.group.project',
  'state-dir': 'graph.group.stateDir',
  shortcut: 'graph.group.shortcut',
  runtime: 'graph.group.runtime',
  process: 'graph.group.process',
  config: 'graph.group.config',
  unknown: 'graph.group.unknown',
};

const SUMMARY_CARDS: Array<{ key: SummaryKey; tone: CardTone }> = [
  { key: 'nodes', tone: 'info' },
  { key: 'edges', tone: 'ok' },
  { key: 'broken', tone: 'danger' },
  { key: 'shadowed', tone: 'warn' },
  { key: 'cycles', tone: 'vault' },
  { key: 'critical', tone: 'danger' },
];

const ROW_SECTIONS: Record<ScreenProfile, Array<'relations' | 'impact'>> = {
  protect: ['relations', 'impact'],
  experiment: ['impact', 'relations'],
};

/**
 * GRAF — envanterden turetilen bagimlilik agi.
 *
 * Dugum/kenar, gruplar, ozet ayrintisi, kok nedenler ve what-if sonucu
 * MOTORDAN gelir; arayuz yalnizca gosterir. Grafik islem YAPMAZ.
 */
export function Graph({ lang, diskScanning = false }: Props) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);

  // Etiket/basliklar: dil bilincli buyuk harf (TR: i -> İ).
  const tu = (key: MessageKey, vars?: Record<string, string | number>) =>
    translateUpper(lang, key, vars);
  const panel = useRightPanel();

  const [view, setView] = useState<GraphViewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'check' | 'inventory' | 'graph'>('check');
  /** Disk taramasi suruyor: envanter baslatilmaz (tek agir is kurali). */
  const [blockedScan, setBlockedScan] = useState(false);
  const [toolCount, setToolCount] = useState(0);

  const [profile, setProfile] = useState<ScreenProfile>(() =>
    localStorage.getItem('residue.graphProfile') === 'experiment' ? 'experiment' : 'protect',
  );
  const [openGroups, setOpenGroups] = useState<Set<GraphNodeKind>>(new Set());
  const [expanded, setExpanded] = useState<ExpandedRow | null>(null);
  const [tab, setTab] = useState<WorkspaceTab>('nodes');
  const [detailCard, setDetailCard] = useState<SummaryKey | null>(null);

  const [query, setQuery] = useState('');
  const [running, setRunning] = useState(false);
  const [whatIf, setWhatIf] = useState<GraphWhatIfResponse | null>(null);
  const [whatIfError, setWhatIfError] = useState<string | null>(null);

  const closeStream = useRef<(() => void) | null>(null);

  useEffect(() => {
    localStorage.setItem('residue.graphProfile', profile);
  }, [profile]);

  useEffect(
    () => () => {
      closeStream.current?.();
      closeStream.current = null;
    },
    [],
  );

  const inventory = (): Promise<void> =>
    new Promise((resolve, reject) => {
      void (async () => {
        try {
          const { jobId } = await api.startCliInventory(21);
          closeStream.current?.();
          closeStream.current = openEvents<CliInventoryStreamEvent>(
            `/api/cli/inventory/${jobId}/events`,
            (event) => {
              if (event.type === 'tool') {
                setToolCount((n) => n + 1);
                return;
              }
              if (event.type === 'done' || event.type === 'cancelled') {
                closeStream.current?.();
                closeStream.current = null;
                resolve();
                return;
              }
              if (event.type === 'error') {
                closeStream.current?.();
                closeStream.current = null;
                reject(new Error(event.message));
              }
            },
            (fatal) => {
              if (!fatal) return; // EventSource kendisi yeniden baglanir
              closeStream.current?.();
              closeStream.current = null;
              reject(new Error(t('graph.progress.streamError')));
            },
          );
        } catch (err) {
          // 409: baska bir envanter calisiyor; graph() tek-flight bekler.
          if (err instanceof ApiError && err.status === 409) resolve();
          else reject(err);
        }
      })();
    });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setView(null);
    setExpanded(null);
    setDetailCard(null);
    setWhatIf(null);
    setWhatIfError(null);
    setBlockedScan(false);
    try {
      setPhase('check');
      const cached = await api.cliView({
        text: '',
        status: 'all',
        source: 'all',
        sort: 'status',
      });
      if (!cached) {
        // Tek agir is kurali: disk taramasi surerken envanter baslatma.
        if (diskScanning) {
          setBlockedScan(true);
          return;
        }
        setPhase('inventory');
        setToolCount(0);
        await inventory();
      }
      setPhase('graph');
      const next = await api.graph();
      setView(next);
      setOpenGroups(new Set(next.groups.map((group) => group.kind)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [diskScanning]);

  useEffect(() => {
    void load();
  }, [load]);

  const labels = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of view?.nodes ?? []) map.set(node.id, node.label);
    return map;
  }, [view]);

  const nodeById = useMemo(() => {
    const map = new Map<string, GraphNodeView>();
    for (const node of view?.nodes ?? []) map.set(node.id, node);
    return map;
  }, [view]);

  const labelOf = (id: string): string => labels.get(id) ?? id;

  const edgeMeta = (edge: GraphEdge): string =>
    [
      t(GRAPH_EDGE_LABEL[edge.kind] ?? 'graph.edge.link'),
      t(GRAPH_STRENGTH_LABEL[edge.strength] ?? 'graph.strength.weak'),
      t(GRAPH_STATE_LABEL[edge.state] ?? 'graph.state.unknown'),
    ].join(' · ');

  const loadImpact = async (nodeId: string): Promise<void> => {
    try {
      const result = await api.graphWhatIfNode(nodeId);
      setExpanded((prev) =>
        prev && prev.nodeId === nodeId ? { ...prev, loading: false, result } : prev,
      );
    } catch (err) {
      setExpanded((prev) =>
        prev && prev.nodeId === nodeId
          ? {
              ...prev,
              loading: false,
              error: err instanceof ApiError ? err.message : String(err),
            }
          : prev,
      );
    }
  };

  const openNode = (node: GraphNodeView): void => {
    setTab('nodes');
    setOpenGroups((prev) => new Set(prev).add(node.kind));
    setExpanded({ nodeId: node.id, loading: true, result: null, error: null });
    void loadImpact(node.id);
    window.setTimeout(() => {
      document
        .getElementById(`graph-node-${node.id}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  const toggleRow = (node: GraphNodeView): void => {
    if (expanded?.nodeId === node.id) setExpanded(null);
    else openNode(node);
  };

  const toggleGroup = (kind: GraphNodeKind): void => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const allOpen = Boolean(
    view && view.groups.length > 0 && view.groups.every((group) => openGroups.has(group.kind)),
  );

  const toggleAllGroups = (): void => {
    setOpenGroups(allOpen ? new Set() : new Set((view?.groups ?? []).map((group) => group.kind)));
  };

  const revealGroup = (kind: GraphNodeKind): void => {
    setTab('nodes');
    setOpenGroups((prev) => new Set(prev).add(kind));
    window.setTimeout(() => {
      document
        .getElementById(`graph-group-${kind}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  };

  const toggleCard = (key: SummaryKey): void => {
    if (detailCard === key) {
      setDetailCard(null);
      return;
    }
    setDetailCard(key);
    if (key === 'nodes') setTab('nodes');
    if (key === 'edges' || key === 'broken' || key === 'shadowed') setTab('edges');
    if (window.matchMedia('(max-width: 1240px)').matches) {
      window.setTimeout(() => {
        document
          .getElementById('graph-card-detail')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 40);
    }
  };

  const simulate = async (): Promise<void> => {
    const q = query.trim();
    if (!q) return;
    setRunning(true);
    setWhatIfError(null);
    setWhatIf(null);
    panel?.activate('action');
    try {
      setWhatIf(await api.graphWhatIf(q));
    } catch (err) {
      setWhatIfError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const renderCardDetail = (): ReactElement | null => {
    if (!view || !detailCard) return null;
    if (detailCard === 'nodes') {
      return (
        <div className="graph-chips">
          {view.details.nodeKindCounts.map((item) => (
            <button
              key={item.kind}
              type="button"
              className="chip"
              onClick={() => revealGroup(item.kind)}
            >
              {t(GROUP_LABEL[item.kind] ?? 'graph.group.unknown')}
              <span className="chip-count">{item.count}</span>
            </button>
          ))}
        </div>
      );
    }
    if (detailCard === 'edges') {
      return (
        <div className="graph-chips">
          {view.details.edgeStateCounts.map((item) => (
            <button
              key={item.state}
              type="button"
              className="chip"
              onClick={() => setTab('edges')}
            >
              {t(GRAPH_STATE_LABEL[item.state] ?? 'graph.state.unknown')}
              <span className="chip-count">{item.count}</span>
            </button>
          ))}
        </div>
      );
    }
    if (detailCard === 'broken' || detailCard === 'shadowed') {
      const edges =
        detailCard === 'broken' ? view.details.brokenEdges : view.details.shadowedEdges;
      return edges.length === 0 ? (
        <p className="dim">{t('graph.card.empty')}</p>
      ) : (
        <EdgeList
          edges={edges}
          labelOf={labelOf}
          edgeMeta={edgeMeta}
          nodeById={nodeById}
          onReveal={openNode}
          revealLabel={t('graph.reveal')}
        />
      );
    }
    if (detailCard === 'critical') {
      return view.details.criticalNodes.length === 0 ? (
        <p className="dim">{t('graph.card.empty')}</p>
      ) : (
        <ul className="detail-list graph-edge-list">
          {view.details.criticalNodes.map((node) => (
            <li key={node.id}>
              <span className="mono">{node.label}</span>
              <span className="dim">
                {t(GRAPH_NODE_LABEL[node.kind] ?? 'graph.node.unknown')} ·{' '}
                {t(GRAPH_ROLE_LABEL[node.role] ?? 'graph.role.isolated')}
              </span>
              <button
                type="button"
                className="ghost graph-sim"
                onClick={() => openNode(node)}
              >
                {t('graph.tree.open')}
              </button>
            </li>
          ))}
        </ul>
      );
    }
    if (view.cycles.length === 0) return <p className="dim">{t('graph.card.empty')}</p>;
    return (
      <ul className="detail-list">
        {view.cycles.map((cycle) => (
          <li key={cycle.join('>')} className="mono">
            {cycle.map(labelOf).join(' → ')}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="graph">
      <section className="graph-main">
        <header className="page-head">
          <div>
            <h1>{t('graph.title')}</h1>
            <p className="dim">{t('graph.subtitle')}</p>
          </div>
          <div className="page-actions">
            <div className="profile-switch" role="group" aria-label={t('graph.profile.label')}>
              <button
                type="button"
                className={profile === 'protect' ? 'active' : ''}
                aria-pressed={profile === 'protect'}
                onClick={() => setProfile('protect')}
              >
                {t('graph.profile.protect')}
              </button>
              <button
                type="button"
                className={profile === 'experiment' ? 'active' : ''}
                aria-pressed={profile === 'experiment'}
                onClick={() => setProfile('experiment')}
              >
                {t('graph.profile.experiment')}
              </button>
            </div>
            <button
              type="button"
              className="ghost"
              onClick={() =>
                document
                  .getElementById('graph-whatif')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            >
              {t('graph.whatIf.title')}
            </button>
            <button type="button" className="ghost" onClick={() => void load()}>
              {t('graph.refresh')}
            </button>
          </div>
        </header>

        <p className="graph-profile-note dim">
          {t(
            profile === 'protect'
              ? 'graph.profile.protectNote'
              : 'graph.profile.experimentNote',
          )}
        </p>

        {loading && (
          <div className="graph-progress" role="status" aria-live="polite">
            <div className="graph-progress-head">
              <strong>
                {phase === 'inventory'
                  ? t('graph.progress.inventory')
                  : phase === 'graph'
                    ? t('graph.progress.graph')
                    : t('graph.progress.check')}
              </strong>
              <span className="dim mono">
                {phase === 'inventory'
                  ? t('graph.progress.tools', { count: toolCount })
                  : t('graph.progress.step', { step: phase === 'graph' ? 2 : 1 })}
              </span>
            </div>
            <div
              className="progress indeterminate"
              role="progressbar"
              aria-label={t('graph.progress.label')}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span />
            </div>
            <p className="dim">{t('graph.progress.hint')}</p>
          </div>
        )}

        {!loading && blockedScan && (
          <div className="banner" role="status">
            {t('graph.progress.blockedScan')}
          </div>
        )}

        {error && (
          <div className="banner danger" role="alert">
            {error}
          </div>
        )}

        {view && (
          <>
            <section className="graph-summary" aria-label={t('graph.summary.nodes')}>
              {SUMMARY_CARDS.map((card) => {
                const value = view.summary[card.key];
                const tone: CardTone =
                  card.key === 'broken' || card.key === 'critical' || card.key === 'shadowed'
                    ? value > 0
                      ? card.tone
                      : 'ok'
                    : card.tone;
                const open = detailCard === card.key;
                return (
                  <button
                    type="button"
                    key={card.key}
                    className={`graph-stat graph-stat-${tone}${open ? ' active' : ''}`}
                    aria-expanded={open}
                    aria-controls="graph-card-detail"
                    onClick={() => toggleCard(card.key)}
                  >
                    <strong className="mono">{value}</strong>
                    <span className="dim">
                      {t(`graph.summary.${card.key}` as MessageKey)}
                    </span>
                    <span className="graph-stat-toggle" aria-hidden="true">
                      {open ? '−' : '+'}
                    </span>
                  </button>
                );
              })}
            </section>
            <p className="dim graph-summary-note">{t('graph.summary.note')}</p>

            {detailCard && (
              <section className="panel graph-card-detail" id="graph-card-detail">
                <div className="panel-head-row">
                  <h2>{tu(`graph.summary.${detailCard}` as MessageKey)}</h2>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setDetailCard(null)}
                  >
                    {t('graph.tree.close')}
                  </button>
                </div>
                <p className="dim graph-note">
                  {t(`graph.summary.${detailCard}.what` as MessageKey)}
                </p>
                {renderCardDetail()}
              </section>
            )}

            <dl className="graph-legend">
              <div>
                <dt>{t('graph.legend.nodes')}</dt>
                <dd className="dim">{t('graph.legend.nodesNote')}</dd>
              </div>
              <div>
                <dt>{t('graph.legend.edges')}</dt>
                <dd className="dim">{t('graph.legend.edgesNote')}</dd>
              </div>
            </dl>

            <section className="panel">
              <h2>{tu('graph.rootCauses')}</h2>
              <p className="dim graph-note">{t('graph.rootCauses.note')}</p>
              {view.rootCauses.length === 0 ? (
                <p className="dim">{t('graph.noRootCauses')}</p>
              ) : (
                <ul className="detail-list">
                  {view.rootCauses.map((root) => {
                    const node = nodeById.get(root.root);
                    return (
                      <li key={root.root} className="graph-root-row">
                        <span className="graph-root-main">
                          <span className="mono">{root.label}</span>
                          <span className="dim">
                            {t(GRAPH_NODE_LABEL[root.kind] ?? 'graph.node.unknown')} ·{' '}
                            {root.count} {t('graph.summary.edges')}
                          </span>
                        </span>
                        {node && (
                          <button
                            type="button"
                            className="ghost graph-sim"
                            onClick={() => openNode(node)}
                          >
                            {t('graph.reveal')}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="panel graph-workspace">
              <div className="panel-head-row">
                <div className="graph-tabs" role="tablist" aria-label={t('graph.workspace')}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'nodes'}
                    className={tab === 'nodes' ? 'active' : ''}
                    onClick={() => setTab('nodes')}
                  >
                    {tu('graph.nodes')}
                    <span className="count mono">{view.summary.nodes}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'edges'}
                    className={tab === 'edges' ? 'active' : ''}
                    onClick={() => setTab('edges')}
                  >
                    {tu('graph.edges')}
                    <span className="count mono">{view.summary.edges}</span>
                  </button>
                </div>
                {tab === 'nodes' && (
                  <button type="button" className="ghost" onClick={toggleAllGroups}>
                    {allOpen ? t('graph.tree.collapseAll') : t('graph.tree.expandAll')}
                  </button>
                )}
              </div>

              {tab === 'nodes' ? (
                <>
                  <p className="dim graph-note">{t('graph.nodes.note')}</p>
                  <div className="graph-scroll graph-scroll-fixed" role="tabpanel">
                    <div className="graph-tree-view" role="tree" aria-label={t('graph.nodes')}>
                      {view.groups.map((group) => {
                        const groupOpen = openGroups.has(group.kind);
                        return (
                          <section
                            className="graph-group"
                            key={group.kind}
                            id={`graph-group-${group.kind}`}
                          >
                            <button
                              type="button"
                              className="graph-group-head"
                              aria-expanded={groupOpen}
                              onClick={() => toggleGroup(group.kind)}
                            >
                              <span
                                className={`chevron${groupOpen ? ' open' : ''}`}
                                aria-hidden="true"
                              >
                                ▸
                              </span>
                              <span>{t(GROUP_LABEL[group.kind] ?? 'graph.group.unknown')}</span>
                              <span className="count mono">{group.nodeIds.length}</span>
                            </button>
                            {groupOpen && (
                              <div className="graph-group-body" role="group">
                                {group.nodeIds.map((id) => {
                                  const node = nodeById.get(id);
                                  if (!node) return null;
                                  const open = expanded?.nodeId === node.id;
                                  return (
                                    <div
                                      className={`graph-node-wrap${open ? ' active' : ''}`}
                                      key={node.id}
                                      id={`graph-node-${node.id}`}
                                    >
                                      <button
                                        type="button"
                                        className="graph-node-row"
                                        aria-expanded={open}
                                        aria-controls={`graph-inline-${node.id}`}
                                        onClick={() => toggleRow(node)}
                                      >
                                        <span
                                          className={`chevron${open ? ' open' : ''}`}
                                          aria-hidden="true"
                                        >
                                          ▸
                                        </span>
                                        <span className="mono graph-label" title={node.id}>
                                          {node.label}
                                        </span>
                                        <span className="badge">
                                          {t(
                                            GRAPH_ROLE_LABEL[node.role] ??
                                              'graph.role.isolated',
                                          )}
                                        </span>
                                        <span className={`badge graph-level-${node.level}`}>
                                          {t(
                                            GRAPH_LEVEL_LABEL[node.level] ??
                                              'graph.level.low',
                                          )}
                                        </span>
                                        <span
                                          className="dim mono graph-path"
                                          title={node.path ?? ''}
                                        >
                                          {node.path ?? '—'}
                                        </span>
                                        <span className="badges-right">
                                          {node.active && (
                                            <span className="badge git">
                                              {t('graph.node.active')}
                                            </span>
                                          )}
                                          {node.protected && (
                                            <span className="badge">
                                              {t('graph.node.protected')}
                                            </span>
                                          )}
                                          <span className="dim graph-open-hint">
                                            {open
                                              ? t('graph.tree.close')
                                              : t('graph.tree.open')}
                                          </span>
                                        </span>
                                      </button>

                                      {open && expanded && (
                                        <div
                                          className="graph-inline"
                                          id={`graph-inline-${node.id}`}
                                          role="region"
                                          aria-label={t('graph.tree.title', {
                                            name: node.label,
                                          })}
                                        >
                                          {ROW_SECTIONS[profile].map((section) =>
                                            section === 'relations' ? (
                                              <section
                                                key="relations"
                                                className="graph-inline-section"
                                              >
                                                <h5>{tu('graph.tree.relations')}</h5>
                                                <RelationsTree
                                                  node={node}
                                                  t={t}
                                                  tu={tu}
                                                  edgeMeta={edgeMeta}
                                                  labelOf={labelOf}
                                                />
                                              </section>
                                            ) : (
                                              <section
                                                key="impact"
                                                className="graph-inline-section"
                                              >
                                                <h5>{tu('graph.tree.impact')}</h5>
                                                <p className="dim graph-tree-note">
                                                  {t('graph.tree.whatIfNote')}
                                                </p>
                                                {expanded.loading && (
                                                  <p className="dim">
                                                    {t('graph.whatIf.running')}
                                                  </p>
                                                )}
                                                {expanded.error && (
                                                  <div
                                                    className="banner danger"
                                                    role="alert"
                                                  >
                                                    {expanded.error}
                                                  </div>
                                                )}
                                                {expanded.result &&
                                                  expanded.result.nodeIds.length ===
                                                    0 && (
                                                    <p className="dim">
                                                      {t('graph.whatIf.noMatch')}
                                                    </p>
                                                  )}
                                                {expanded.result &&
                                                  expanded.result.nodeIds.length > 0 && (
                                                    <WhatIfTree
                                                      node={node}
                                                      result={expanded.result}
                                                      t={t}
                                                      tu={tu}
                                                      edgeMeta={edgeMeta}
                                                      labelOf={labelOf}
                                                    />
                                                  )}
                                              </section>
                                            ),
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </section>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <p className="dim graph-note">
                    {t(
                      profile === 'protect'
                        ? 'graph.edges.noteProtect'
                        : 'graph.edges.noteExperiment',
                    )}
                  </p>
                  <div className="graph-scroll graph-scroll-fixed" role="tabpanel">
                    <div className="graph-edge-head">
                      <span>{tu('graph.edge.from')}</span>
                      <span>{tu('graph.edge.to')}</span>
                      <span>{tu('graph.edge.kind')}</span>
                      <span>{tu('graph.edge.strength')}</span>
                      <span>{tu('graph.edge.state')}</span>
                    </div>
                    {view.edges.map((edge) => (
                      <div className="graph-edge-row" key={edge.id}>
                        <span className="mono graph-label" title={edge.from}>
                          {labelOf(edge.from)}
                        </span>
                        <span className="mono graph-label" title={edge.to}>
                          {labelOf(edge.to)}
                        </span>
                        <span className="badge">
                          {t(GRAPH_EDGE_LABEL[edge.kind] ?? 'graph.edge.link')}
                        </span>
                        <span className="badge">
                          {t(
                            GRAPH_STRENGTH_LABEL[edge.strength] ??
                              'graph.strength.weak',
                          )}
                        </span>
                        <span
                          className={`badge ${
                            edge.state === 'broken' || edge.state === 'missing-chain'
                              ? 'warn'
                              : ''
                          }`}
                        >
                          {t(GRAPH_STATE_LABEL[edge.state] ?? 'graph.state.unknown')}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          </>
        )}
      </section>

      <RightPanelPortal module="action">
        <aside className="graph-detail" id="graph-whatif">
        <h2>{tu('graph.whatIf.title')}</h2>
        <p className="dim">{t('graph.whatIf.hint')}</p>

        <div className="graph-whatif-form">
          <input
            className="control"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('graph.whatIf.placeholder')}
            aria-label={t('graph.whatIf.placeholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void simulate();
            }}
          />
          <button
            type="button"
            className="primary"
            disabled={running || query.trim().length === 0}
            onClick={() => void simulate()}
          >
            {running ? t('graph.whatIf.running') : t('graph.whatIf.run')}
          </button>
        </div>

        {whatIfError && (
          <div className="banner danger" role="alert">
            {whatIfError}
          </div>
        )}

        {whatIf && (
          <>
            {whatIf.nodeIds.length === 0 ? (
              <p className="dim">{t('graph.whatIf.noMatch')}</p>
            ) : (
              <>
                <dl className="meta-list">
                  <dt>{t('graph.whatIf.allowed')}</dt>
                  <dd className="mono">{whatIf.result.allowed.length}</dd>
                  <dt>{t('graph.whatIf.blocked')}</dt>
                  <dd className="mono">{whatIf.result.blocked.length}</dd>
                </dl>

                {whatIf.result.allowed.length > 0 && (
                  <>
                    <h4>
                      {tu('graph.whatIf.allowedList', {
                        count: whatIf.result.allowed.length,
                      })}
                    </h4>
                    <div className="graph-tree graph-result-tree">
                      <ul>
                        {whatIf.result.allowed.map((id) => {
                          const node = nodeById.get(id);
                          return (
                            <li key={id}>
                              <span className="mono">{labelOf(id)}</span>
                              {node && (
                                <>
                                  <span className="badge">
                                    {t(
                                      GRAPH_NODE_LABEL[node.kind] ??
                                        'graph.node.unknown',
                                    )}
                                  </span>
                                  <span className={`badge graph-level-${node.level}`}>
                                    {t(
                                      GRAPH_LEVEL_LABEL[node.level] ??
                                        'graph.level.low',
                                    )}
                                  </span>
                                  <button
                                    type="button"
                                    className="ghost graph-sim"
                                    onClick={() => openNode(node)}
                                  >
                                    {t('graph.tree.open')}
                                  </button>
                                </>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </>
                )}

                {whatIf.result.blocked.length > 0 && (
                  <>
                    <h4>{tu('graph.whatIf.blocked')}</h4>
                    <ul className="detail-list">
                      {whatIf.result.blocked.map((blocked) => (
                        <li key={blocked.id}>
                          <span className="mono">{blocked.label}</span>
                          <span className="dim">{blocked.reason}</span>
                          {blocked.dependents.length > 0 && (
                            <span className="dim">
                              {t('graph.whatIf.dependents')}:{' '}
                              {blocked.dependents.map((d) => d.label).join(', ')}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {whatIf.result.brokenEdges.length > 0 && (
                  <>
                    <h4>{tu('graph.whatIf.brokenEdges')}</h4>
                    <ul className="detail-list">
                      {whatIf.result.brokenEdges.map((edge) => (
                        <li key={edge.id} className="mono">
                          {labelOf(edge.from)} → {labelOf(edge.to)} ·{' '}
                          {t(GRAPH_STATE_LABEL[edge.state] ?? 'graph.state.unknown')}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {whatIf.result.isolated.length > 0 && (
                  <>
                    <h4>{tu('graph.whatIf.isolated')}</h4>
                    <ul className="detail-list">
                      {whatIf.result.isolated.map((id) => (
                        <li key={id} className="mono">
                          {labelOf(id)}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </>
        )}
      </aside>
      </RightPanelPortal>
    </div>
  );
}

interface TreeProps {
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  tu: (key: MessageKey, vars?: Record<string, string | number>) => string;
  edgeMeta: (edge: GraphEdge) => string;
  labelOf: (id: string) => string;
}

/** Iliski agaci: dugumun gelen ve giden kenarlari. */
function RelationsTree({ node, ...rest }: TreeProps & { node: GraphNodeView }) {
  const { t, edgeMeta } = rest;
  if (node.dependents.length === 0 && node.needs.length === 0) {
    return <p className="dim">{t('graph.tree.empty')}</p>;
  }
  return (
    <div className="graph-tree">
      <p className="graph-tree-root mono">{node.label}</p>
      {node.dependents.length > 0 && (
        <section>
          <h6>{t('graph.tree.dependents', { count: node.dependents.length })}</h6>
          <ul>
            {node.dependents.map((item) => (
              <li key={item.edge.id}>
                <span className="mono">{item.label}</span>
                <span className="dim"> → </span>
                <span className="mono">{node.label}</span>
                <span className="dim"> · {edgeMeta(item.edge)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {node.needs.length > 0 && (
        <section>
          <h6>{t('graph.tree.needs', { count: node.needs.length })}</h6>
          <ul>
            {node.needs.map((item) => (
              <li key={item.edge.id}>
                <span className="mono">{node.label}</span>
                <span className="dim"> → </span>
                <span className="mono">{item.label}</span>
                <span className="dim"> · {edgeMeta(item.edge)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** What-if etkisi: MOTORDAN gelen sonuc. */
function WhatIfTree({
  node,
  result,
  ...rest
}: TreeProps & { node: GraphNodeView; result: GraphWhatIfResponse }) {
  const { t, edgeMeta, labelOf } = rest;
  const blocked = result.result.blocked;
  const broken = result.result.brokenEdges;
  const isolated = result.result.isolated;
  const partial = blocked.length === 0 && broken.length > 0;
  return (
    <div className="graph-tree">
      <p className="graph-tree-root">
        <span className="mono">{node.label}</span>{' '}
        <span className={`badge ${blocked.length > 0 || partial ? 'warn' : 'git'}`}>
          {blocked.length > 0
            ? t('graph.tree.blocked')
            : partial
              ? t('graph.tree.partial')
              : t('graph.tree.allowed')}
        </span>
      </p>
      <p className="dim">
        {blocked.length > 0
          ? t('graph.tree.blockedNote', { count: blocked.length })
          : partial
            ? t('graph.tree.partialNote', { count: broken.length })
            : t('graph.tree.allowedNote')}
      </p>
      {blocked.length > 0 && (
        <section>
          <h6>{t('graph.whatIf.blocked')}</h6>
          <ul>
            {blocked.map((item) => (
              <li key={item.id}>
                <span className="mono">{item.label}</span>
                {item.dependents.length > 0 && (
                  <ul className="graph-tree-children">
                    {item.dependents.map((dep) => (
                      <li key={dep.id}>
                        <span className="mono">{dep.label}</span>
                        <span className="dim">
                          {' '}
                          → {item.label} · {edgeMeta(dep.edge)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {broken.length > 0 && (
        <section>
          <h6>{t('graph.tree.broken', { count: broken.length })}</h6>
          <ul>
            {broken.map((edge) => (
              <li key={edge.id}>
                <span className="mono">
                  {labelOf(edge.from)} → {labelOf(edge.to)}
                </span>
                <span className="dim"> · {edgeMeta(edge)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {isolated.length > 0 && (
        <section>
          <h6>{t('graph.tree.isolated', { count: isolated.length })}</h6>
          <ul>
            {isolated.map((id) => (
              <li key={id} className="mono">
                {labelOf(id)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

interface EdgeListProps {
  edges: GraphEdge[];
  labelOf: (id: string) => string;
  edgeMeta: (edge: GraphEdge) => string;
  nodeById: Map<string, GraphNodeView>;
  onReveal: (node: GraphNodeView) => void;
  revealLabel: string;
}

/** Ozet kartindan acilan kenar listesi (yalniz inceleme). */
function EdgeList({ edges, labelOf, edgeMeta, nodeById, onReveal, revealLabel }: EdgeListProps) {
  return (
    <ul className="detail-list graph-edge-list">
      {edges.map((edge) => {
        const from = nodeById.get(edge.from);
        return (
          <li key={edge.id}>
            <span className="mono">
              {labelOf(edge.from)} → {labelOf(edge.to)}
            </span>
            <span className="dim">{edgeMeta(edge)}</span>
            {from && (
              <button
                type="button"
                className="ghost graph-sim"
                onClick={() => onReveal(from)}
              >
                {revealLabel}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
