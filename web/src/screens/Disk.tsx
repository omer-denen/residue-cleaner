import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type {
  ClusterDetailView,
  ClusterKindFilter,
  DiskViewResponse,
  MetaResponse,
  PlanResponse,
  ScanStatusResponse,
  ScanStreamEvent,
} from '../../../src/core/contract.ts';
import { api, ApiError } from '../api.ts';
import { openEvents } from '../sse.ts';
import { translate, translateUpper, type Lang, type MessageKey } from '../i18n.ts';
import { formatBytes } from '../format.ts';
import { ScanStatusChip } from '../components/ScanStatus.tsx';
import { Icon } from '../components/icons.tsx';
import { RightPanelPortal, useRightPanel } from '../components/RightPanel.tsx';
import {
  CATEGORY_LABEL,
  CONFIDENCE_LABEL,
  REGEN_LABEL,
  RISK_LABEL,
  VERDICT_LABEL,
} from '../labels.ts';

const KINDS: Array<{ id: ClusterKindFilter; label: MessageKey }> = [
  { id: 'all', label: 'disk.kind.all' },
  { id: 'recommend', label: 'verdict.recommend' },
  { id: 'ask', label: 'verdict.ask' },
  { id: 'report-only', label: 'verdict.report-only' },
  { id: 'keep', label: 'verdict.keep' },
  { id: 'git', label: 'disk.kind.git' },
];

interface Props {
  meta: MetaResponse | null;
  status: ScanStatusResponse | null;
  lang: Lang;
  /** Artan sayac: "Yeniden tara" istegi geldiginde tarama baslar. */
  scanRequest: number;
  onStatus: () => void;
  onOpenScanStatus: () => void;
  /** Motorun guncel planindaki kume anahtarlari (panel.keys); satir rozeti icin. */
  plannedKeys: readonly string[];
  onPlan: (plan: PlanResponse) => void;
  /** Plan 404/410 dondugunde App plan durumunu temizler. */
  onPlanStale: () => void;
}

/**
 * DISK — liste, filtre ve secim yalnizca MOTORDAN gelir.
 *
 * Bu bilesen kendi filtresini, siralmasini veya secim ozetini HESAPLAMAZ;
 * her degisiklikte `/api/disk` cagirir. Silme yoktur: yalniz plan uretir.
 */
export function Disk({
  meta,
  status,
  lang,
  scanRequest,
  onStatus,
  onOpenScanStatus,
  plannedKeys,
  onPlan,
  onPlanStale,
}: Props) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);

  // Etiket/basliklar: dil bilincli buyuk harf (TR: i -> İ).
  const tu = (key: MessageKey, vars?: Record<string, string | number>) =>
    translateUpper(lang, key, vars);
  const panel = useRightPanel();

  const [text, setText] = useState('');
  const [debouncedText, setDebouncedText] = useState('');
  const [kind, setKind] = useState<ClusterKindFilter>('all');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState('size');
  const [big, setBig] = useState(false);
  const [risky, setRisky] = useState(false);
  const [zombie, setZombie] = useState(false);

  const [view, setView] = useState<DiskViewResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<ClusterDetailView | null>(null);

  /** Gelişmiş filtreler (profil/yas/kategori/siralama) varsayilan KAPALI. */
  const [filtersOpen, setFiltersOpen] = useState(false);
  /** "Plana ekle" istegi: secim korunur; sayfa degismez. */
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const [envs, setEnvs] = useState<string[]>([]);
  const [profile, setProfile] = useState('');
  const [minAgeDays, setMinAgeDays] = useState(0);
  const metaInit = useRef(false);

  const [scan, setScan] = useState<{
    id: string;
    done: number;
    total: number;
    bytes: number;
    found: number;
    paused: boolean;
  } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const closeStream = useRef<(() => void) | null>(null);
  const foundIds = useRef<Set<string>>(new Set());
  const defaultsApplied = useRef(false);

  useEffect(() => {
    if (!meta || metaInit.current) return;
    setEnvs(meta.defaults.envs);
    setProfile(meta.defaults.profile ?? '');
    setMinAgeDays(meta.defaults.minAgeDays);
    metaInit.current = true;
  }, [meta]);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedText(text), 250);
    return () => clearTimeout(id);
  }, [text]);

  const selectedList = [...selected].join('\u0000');

  const load = useCallback(async () => {
    try {
      setError(null);
      const next = await api.disk({
        text: debouncedText,
        kind,
        category,
        sort,
        big,
        risky,
        zombie,
        selected: selectedList.length > 0 ? selectedList.split('\u0000') : [],
      });
      setView(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, [debouncedText, kind, category, sort, big, risky, zombie, selectedList]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!view || defaultsApplied.current || view.scan.at === null) return;
    setSelected(new Set(view.defaultSelectedKeys));
    defaultsApplied.current = true;
  }, [view]);

  useEffect(() => {
    return () => closeStream.current?.();
  }, []);

  useEffect(() => {
    if (!detailKey) {
      setDetail(null);
      return;
    }
    let alive = true;
    setDetail(null);
    api
      .cluster(detailKey)
      .then((next) => {
        if (alive) setDetail(next);
      })
      .catch(() => {
        if (alive) setDetail(null);
      });
    return () => {
      alive = false;
    };
  }, [detailKey]);

  const startScan = async (): Promise<void> => {
    setScanError(null);
    try {
      const { scanId } = await api.startScan({
        envs,
        profile: profile || undefined,
        minAgeDays,
      });
      foundIds.current = new Set();
      setScan({ id: scanId, done: 0, total: 0, bytes: 0, found: 0, paused: false });
      closeStream.current?.();
      closeStream.current = openEvents<ScanStreamEvent>(`/api/scan/${scanId}/events`, (event) => {
        switch (event.type) {
          case 'progress':
            setScan((s) =>
              s ? { ...s, done: event.done, total: event.total, bytes: event.bytes } : s,
            );
            break;
          case 'item':
            if (!foundIds.current.has(event.id)) {
              foundIds.current.add(event.id);
              setScan((s) => (s ? { ...s, found: s.found + 1 } : s));
            }
            break;
          case 'paused':
            setScan((s) => (s ? { ...s, paused: true } : s));
            break;
          case 'resumed':
            setScan((s) => (s ? { ...s, paused: false } : s));
            break;
          case 'done':
            setScan(null);
            defaultsApplied.current = false;
            onStatus();
            void load();
            break;
          case 'cancelled':
            setScan(null);
            onStatus();
            break;
          case 'error':
            setScanError(event.message);
            setScan(null);
            break;
        }
      });
    } catch (err) {
      setScanError(err instanceof ApiError ? err.message : String(err));
    }
  };

  const scanAction = async (action: 'cancel' | 'pause' | 'resume'): Promise<void> => {
    if (!scan) return;
    try {
      await api.scanAction(scan.id, action);
    } catch (err) {
      setScanError(err instanceof ApiError ? err.message : String(err));
    }
  };

  /**
   * "Yeniden tara" istegi: App sayaci artirir, Disk taramayi baslatir.
   * Ayni istek iki kez calismaz; tarama surerken gelen istek yok sayilir.
   */
  const handledScanRequest = useRef(0);
  useEffect(() => {
    if (scanRequest <= 0 || scanRequest === handledScanRequest.current) return;
    if (!meta) return;
    handledScanRequest.current = scanRequest;
    if (scan) return;
    void startScan();
  }, [scanRequest, meta, scan]);

  const toggle = (key: string): void => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectDefaults = (): void => {
    if (!view) return;
    setSelected(new Set(view.defaultSelectedKeys));
  };

  const selectVisible = (): void => {
    if (!view) return;
    setSelected((previous) => {
      const next = new Set(previous);
      for (const key of view.plannableKeys) next.add(key);
      return next;
    });
  };

  const clearSelection = (): void => {
    setSelected(new Set());
  };

  const addToPlan = async (): Promise<void> => {
    if (selected.size === 0 || planBusy) return;
    setPlanBusy(true);
    setPlanError(null);
    try {
      // Motorun panel.keys alanindaki mevcut plan anahtarlari + secim birlesir.
      const merged = [...new Set([...plannedKeys, ...selected])];
      const next = await api.plan(merged);
      setSelected(new Set());
      // Sag panel "Planlananlar" sekmesine gecer; sayfa degismeZ.
      panel?.activate('planned');
      onPlan(next);
    } catch (err) {
      setPlanError(err instanceof ApiError ? err.message : String(err));
      if (err instanceof ApiError && (err.status === 404 || err.status === 410)) {
        onPlanStale();
      }
    } finally {
      setPlanBusy(false);
    }
  };

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: view?.clusters.length ?? 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 8,
  });

  /** "Planda" rozeti icin kume uyeligi (gosterim; filtre/siralama kurali DEGIL). */
  const plannedSet = useMemo(() => new Set<string>(plannedKeys), [plannedKeys]);

  const detailTargets = detail?.cluster.deleteTargets ?? [];

  return (
    <div className="disk">
      <section className="disk-main">
        <header className="page-head">
          <div>
            <h1>{t('disk.title')}</h1>
            <p className="dim">{t('disk.subtitle')}</p>
          </div>
          <div className="page-actions">
            {status && (
              <ScanStatusChip
                view={status.view}
                lang={lang}
                onOpen={onOpenScanStatus}
              />
            )}
            <button type="button" className="primary" onClick={() => void startScan()}>
              {status?.state === 'never' ? t('disk.scan') : t('disk.rescan')}
            </button>
          </div>
        </header>

        <a className="skip-inline" href="#cluster-list">
          {t('a11y.skipList')}
        </a>

        <div className="toolbar">
          <div className="toolbar-row">
            <input
              className="control search"
              type="search"
              placeholder={t('disk.search')}
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label={t('disk.search')}
              data-search
            />
            <div className="kind-tabs">
              {KINDS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`chip${kind === item.id ? ' active' : ''}`}
                  onClick={() => setKind(item.id)}
                >
                  {t(item.label)}
                  {view && <span className="chip-count">{view.counts[item.id]}</span>}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="chip"
              aria-expanded={filtersOpen}
              aria-controls="disk-filters-advanced"
              onClick={() => setFiltersOpen((v) => !v)}
            >
              {filtersOpen ? t('disk.filters.hide') : t('disk.filters')}
            </button>
          </div>

          <div className="toolbar-row env-row">
            <span className="dim env-row-label">{t('disk.scanOptions')}</span>
            <div className="env-chips">
              {(meta?.envs ?? []).map((env) => (
                <button
                  key={env.id}
                  type="button"
                  className={`chip${envs.includes(env.id) ? ' active' : ''}`}
                  onClick={() =>
                    setEnvs((prev) =>
                      prev.includes(env.id)
                        ? prev.filter((id) => id !== env.id)
                        : [...prev, env.id],
                    )
                  }
                >
                  {env.id}
                </button>
              ))}
            </div>
          </div>

          <div id="disk-filters-advanced" className="filters-advanced" hidden={!filtersOpen}>
            <select
              className="control"
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              aria-label={t('disk.filter.profile')}
            >
              <option value="">—</option>
              {(meta?.profiles ?? []).map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
            <label className="control-label">
              {t('disk.minAge')}
              <input
                className="control num"
                type="number"
                min={0}
                max={3650}
                value={minAgeDays}
                onChange={(e) => setMinAgeDays(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
            <select
              className="control"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label={t('disk.filter.category')}
            >
              <option value="all">{t('disk.filter.category')}: —</option>
              {(view?.categories ?? []).map((cat) => (
                <option key={cat.key} value={cat.key}>
                  {t(CATEGORY_LABEL[cat.key] ?? 'category.unknown')} ({cat.count})
                </option>
              ))}
            </select>
            <select
              className="control"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              aria-label={t('disk.filter.sort')}
            >
              <option value="size">{t('disk.sort.size')}</option>
              <option value="risk">{t('disk.sort.risk')}</option>
              <option value="recent">{t('disk.sort.recent')}</option>
              <option value="name">{t('disk.sort.name')}</option>
            </select>
            <button
              type="button"
              className={`chip${big ? ' active' : ''}`}
              onClick={() => setBig((v) => !v)}
            >
              {t('disk.triage.big')}
            </button>
            <button
              type="button"
              className={`chip${risky ? ' active' : ''}`}
              onClick={() => setRisky((v) => !v)}
            >
              {t('disk.triage.risky')}
            </button>
            <button
              type="button"
              className={`chip${zombie ? ' active' : ''}`}
              onClick={() => setZombie((v) => !v)}
            >
              {t('disk.triage.zombie')}
            </button>
          </div>
        </div>

        {scan && (
          <div className="scan-live">
            <div className="scan-live-head">
              <strong>{t('disk.scanning')}</strong>
              <span className="dim mono">
                {scan.done} / {scan.total || '—'} · {scan.found} {t('disk.found')} ·{' '}
                {formatBytes(scan.bytes)}
              </span>
            </div>
            <div
              className="progress"
              role="progressbar"
              aria-label={t('a11y.scanProgress')}
              aria-valuemin={0}
              aria-valuemax={scan.total || 0}
              aria-valuenow={scan.done}
            >
              <span
                style={{
                  width: `${scan.total > 0 ? Math.min(100, (scan.done / scan.total) * 100) : 0}%`,
                }}
              />
            </div>
            <div className="scan-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => void scanAction(scan.paused ? 'resume' : 'pause')}
              >
                {scan.paused ? t('disk.resume') : t('disk.pause')}
              </button>
              <button type="button" className="ghost" onClick={() => void scanAction('cancel')}>
                {t('disk.cancel')}
              </button>
            </div>
          </div>
        )}

        {scanError && <div className="banner danger" role="alert">{t('disk.scanFailed')}: {scanError}</div>}
        {error && <div className="banner danger" role="alert">{error}</div>}
        {planError && (
          <div className="banner danger" role="alert">
            {t('disk.plan.failed')}: {planError}
          </div>
        )}

        <div className="selection-bar">
          <span className="sr-only" role="status" aria-live="polite">
            {`${view?.selection.clusterCount ?? selected.size} ${t('disk.selected')} · ${formatBytes(
              view?.selection.bytes ?? 0,
            )}`}
          </span>
          <span>
            <strong className="mono">{view?.selection.clusterCount ?? selected.size}</strong>{' '}
            {t('disk.selected')}
          </span>
          <span>
            {t('disk.selection.bytes')}:{' '}
            <strong className="mono">{formatBytes(view?.selection.bytes ?? 0)}</strong>
          </span>
          <span>
            <strong className="mono">{view?.selection.targetCount ?? 0}</strong>{' '}
            {t('disk.selection.targets')}
          </span>
          <span className="spacer" />
          <button type="button" className="ghost" onClick={selectDefaults}>
            {t('disk.defaults')}
          </button>
          <button type="button" className="ghost" onClick={selectVisible}>
            {t('disk.selectVisible')}
          </button>
          <button type="button" className="ghost" onClick={clearSelection}>
            {t('disk.clear')}
          </button>
          <button
            type="button"
            className="primary"
            disabled={selected.size === 0 || planBusy}
            onClick={() => void addToPlan()}
          >
            {t('disk.plan.add')}
          </button>
        </div>

        <div className="cluster-head">
          <span />
          <span />
          <span>{tu('table.cluster')}</span>
          <span>{tu('disk.filter.kind')}</span>
          <span>{tu('disk.filter.category')}</span>
          <span className="num">{tu('disk.sort.size')}</span>
          <span className="num">{tu('disk.detail.idle')}</span>
          <span />
        </div>

        {!view && !error && <div className="state">{t('common.loading')}</div>}
        {view && view.clusters.length === 0 && (
          <div className="state">
            {view.scan.at === null ? t('disk.noScan') : t('disk.empty')}
          </div>
        )}

        {view && view.clusters.length > 0 && (
          <div
            className="cluster-scroll"
            ref={parentRef}
            id="cluster-list"
            tabIndex={-1}
            role="group"
            aria-label={t('a11y.clusterList')}
          >
            <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
              {virtualizer.getVirtualItems().map((item) => {
                const c = view.clusters[item.index];
                if (!c) return null;
                const inPlan = plannedSet.has(c.key);
                return (
                  <div
                    key={c.key}
                    className={`cluster-row${detailKey === c.key ? ' active' : ''}${inPlan ? ' in-plan' : ''}`}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${item.start}px)`,
                    }}
                    onClick={() => {
                      setDetailKey(c.key);
                      panel?.activate('evidence');
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(c.key)}
                      disabled={!c.plannable}
                      onChange={() => toggle(c.key)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`${t('disk.selected')}: ${c.title}`}
                    />
                    <span
                      className={`risk-dot risk-${c.risk}`}
                      role="img"
                      aria-label={t(RISK_LABEL[c.risk] ?? 'risk.safe')}
                      title={t(RISK_LABEL[c.risk] ?? 'risk.safe')}
                    />
                    <button
                      type="button"
                      className="cluster-title-wrap row-open"
                      aria-label={`${t('a11y.openDetail')}: ${c.title}`}
                      aria-current={detailKey === c.key ? 'true' : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDetailKey(c.key);
                        panel?.activate('evidence');
                      }}
                    >
                      <span className="cluster-title">{c.title}</span>
                      <span className="cluster-path mono">{c.primaryPath}</span>
                    </button>
                    <span className="badge">{t(VERDICT_LABEL[c.verdictKind] ?? 'verdict.keep')}</span>
                    <span className="badge">{t(CATEGORY_LABEL[c.category] ?? 'category.unknown')}</span>
                    <span className="mono num">{formatBytes(c.reclaimableBytes)}</span>
                    <span className="dim num">
                      {c.idleDays} {t('vault.days')}
                    </span>
                    <span className="badges-right">
                      {c.gitTracked && <span className="badge git">git</span>}
                      {c.targetCount > 0 && <span className="badge">{c.targetCount}</span>}
                      {inPlan && (
                        <span className="badge planda">
                          <Icon name="check" size={11} />
                          {t('disk.plan.inPlan')}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <RightPanelPortal>
        <aside className="disk-detail">
        <h2>{tu('disk.detail')}</h2>
        {!detail ? (
          <p className="dim">{t('disk.detail.empty')}</p>
        ) : (
          <>
            <h3>{detail.cluster.title}</h3>
            <div className="detail-badges">
              <span className={`risk-badge risk-${detail.risk}`}>
                {t(RISK_LABEL[detail.risk] ?? 'risk.safe')}
              </span>
              <span className="badge">{t(VERDICT_LABEL[detail.verdictKind] ?? 'verdict.keep')}</span>
              <span className="badge">{t(CATEGORY_LABEL[detail.category] ?? 'category.unknown')}</span>
              {detail.gitTracked && <span className="badge git">{t('disk.detail.git')}</span>}
            </div>
            <p className="dim">{detail.cluster.verdict.what}</p>
            <p>{detail.cluster.verdict.consequence}</p>

            <dl className="meta-list">
              <dt>{t('disk.detail.risk')}</dt>
              <dd>{t(RISK_LABEL[detail.risk] ?? 'risk.safe')}</dd>
              <dt>{t('disk.detail.confidence')}</dt>
              <dd>{t(CONFIDENCE_LABEL[detail.cluster.verdict.confidence] ?? 'confidence.low')}</dd>
              <dt>{t('disk.detail.regenerability')}</dt>
              <dd>
                {t(REGEN_LABEL[detail.cluster.verdict.regenerability] ?? 'reason.unknown')}
              </dd>
              <dt>{t('disk.detail.idle')}</dt>
              <dd>
                {detail.idleDays} {t('vault.days')}
              </dd>
            </dl>

            <h4>{tu('disk.detail.targets')}</h4>
            {detailTargets.length === 0 ? (
              <p className="dim">—</p>
            ) : (
              <ul className="detail-list">
                {detailTargets.map((target) => (
                  <li key={target.path}>
                    <span className="mono">{target.path}</span>
                    <span className="dim">
                      {target.kind} · {formatBytes(target.bytes)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <h4>{tu('disk.detail.parts')}</h4>
            <ul className="detail-list">
              {detail.cluster.parts.map((part) => (
                <li key={part.path}>
                  <span className="mono">{part.path}</span>
                  <span className="dim">
                    {formatBytes(part.bytes)} · {part.files}
                  </span>
                </li>
              ))}
            </ul>

            {(detail.cluster.evidence.markers ?? []).length > 0 && (
              <>
                <h4>{tu('disk.detail.markers')}</h4>
                <div className="detail-badges">
                  {(detail.cluster.evidence.markers ?? []).map((marker) => (
                    <span key={marker} className="badge">
                      {marker}
                    </span>
                  ))}
                </div>
              </>
            )}

            <h4>{tu('disk.detail.because')}</h4>
            <ul className="detail-list">
              {detail.cluster.verdict.because.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>

            {detail.cluster.verdict.preconditions.length > 0 && (
              <>
                <h4>{tu('disk.detail.preconditions')}</h4>
                <ul className="detail-list">
                  {detail.cluster.verdict.preconditions.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </aside>
      </RightPanelPortal>
    </div>
  );
}
