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
  ScanVerifyResponse,
} from '../../../src/core/contract.ts';
import { api, ApiError } from '../api.ts';
import { openEvents } from '../sse.ts';
import { translate, translateUpper, type Lang, type MessageKey } from '../i18n.ts';
import { formatBytes } from '../format.ts';
import { ScanStatusChip } from '../components/ScanStatus.tsx';
import { DependenciesSection } from '../components/DependenciesSection.tsx';
import { Icon } from '../components/icons.tsx';
import { RightPanelPortal, useRightPanel } from '../components/RightPanel.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
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

/** Karar rozeti tonu (yalniz sunum; metin i18n'den, karar motordan). */
const VERDICT_TONE: Record<string, string> = {
  recommend: ' ok',
  ask: ' warn',
  'report-only': ' info',
  keep: '',
};

interface Props {
  meta: MetaResponse | null;
  status: ScanStatusResponse | null;
  lang: Lang;
  /** Artan sayac: "Yeniden tara" istegi geldiginde tarama baslar. */
  scanRequest: number;
  onStatus: () => void;
  onOpenScanStatus: () => void;
  /** Guncel plan (PlanResponse|null): checkbox uyeligi + ekleme hedefi. */
  planned: PlanResponse | null;
  /** App'in plan ops gosterici durumu (panel cikarma vb.). */
  planBusy: boolean;
  /** Motorun guncel planindaki kume anahtarlari (panel.keys); `selected` parametresi. */
  plannedKeys: readonly string[];
  onPlan: (plan: PlanResponse | null) => void;
  /** Plan 404/410 dondugunde App plan durumunu temizler + uyarı gostermek. */
  onPlanStale: () => void;
  /** "Planı uygula": taslagi arming eder (sure baslar) ve Plan ekranina gecer. */
  onApplyPlan: () => void;
  /** Açılış doğrulama bandı (daily mod): kaybolan/değişen hedefler. */
  verifyNote?: ScanVerifyResponse | null;
  onDismissVerify?: () => void;
}

/**
 * DISK — liste, filtre yalnizca MOTORDAN gelir.
 *
 * Checkbox = PLAN ÜYELİĞİ (tek yön): isaretlemek `POST /api/plan/add`
 * ile ekler; geri almak plandan cikarmadir (sag panel ya da satir
 * eylemi). Bu bilesen kendi secimini HESAPLamaz; uyelik `planned.panel.keys`,
 * sayaclar ve plan kapsami motorun `view.selection` alanidir. Silme yok:
 * plan hareketlerinin yalnizca plan yapisini degistirir.
 */
export function Disk({
  meta,
  status,
  lang,
  scanRequest,
  onStatus,
  onOpenScanStatus,
  planned,
  planBusy,
  plannedKeys,
  onPlan,
  onPlanStale,
  onApplyPlan,
  verifyNote,
  onDismissVerify,
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
  const [error, setError] = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<ClusterDetailView | null>(null);

  /** Gelişmiş filtreler (profil/yas/kategori/siralama) varsayilan KAPALI. */
  const [filtersOpen, setFiltersOpen] = useState(false);
  /** Bu bilesenin kendi plan ops yuku (ekleme/cikarma/bosaltma). */
  const [busyL, setBusyL] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const [envs, setEnvs] = useState<string[]>([]);
  const [profile, setProfile] = useState('');
  const [minAgeDays, setMinAgeDays] = useState(0);
  const [advancedDelete, setAdvancedDelete] = useState<boolean>(false);
  const metaInit = useRef(false);

  const [scan, setScan] = useState<{
    id: string;
    done: number;
    total: number;
    bytes: number;
    found: number;
    paused: boolean;
    current: string | null;
  } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const closeStream = useRef<(() => void) | null>(null);
  const foundIds = useRef<Set<string>>(new Set());

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

  // Motor `/api/disk`'in `selected` parametreleri = PLAN anahtarlari;
  // `view.selection` motorun hesabidir (kural 18).
  const plannedList = plannedKeys.join('\u0000');

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
        selected: plannedList.length > 0 ? plannedList.split('\u0000') : [],
      });
      setView(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, [debouncedText, kind, category, sort, big, risky, zombie, plannedList]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => closeStream.current?.();
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .settings()
      .then((s) => {
        if (alive) setAdvancedDelete(s.advancedDelete);
      })
      .catch(() => {
        /* varsayilan kapali */
      });
    return () => {
      alive = false;
    };
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
      setScan({
        id: scanId,
        done: 0,
        total: 0,
        bytes: 0,
        found: 0,
        paused: false,
        current: null,
      });
      closeStream.current?.();
      closeStream.current = openEvents<ScanStreamEvent>(`/api/scan/${scanId}/events`, (event) => {
        switch (event.type) {
          case 'target-start':
            setScan((s) => (s ? { ...s, current: event.path } : s));
            break;
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
    if (!scanId) return;
    try {
      await api.scanAction(scanId, action);
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

  const busy = planBusy || busyL;

  /** "Planda" rozeti icin kume uyeligi (gosterim; filtre/siralama kurali DEGIL). */
  const plannedSet = useMemo(() => new Set<string>(plannedKeys), [plannedKeys]);

  /** Plan hatasi: 404/410 durumunda uyarı + App temizligi tek kaynaktan. */
  const handlePlanError = (err: unknown): void => {
    setPlanError(err instanceof ApiError ? err.message : String(err));
    if (err instanceof ApiError && (err.status === 404 || err.status === 410)) {
      onPlanStale();
      setPlanError(null);
    }
  };

  /**
   * Checkbox = plana EKLEME (tek yön): `onChange` yalnizca ekler;
   * isareti geri almak icin satir eylemi/sag panel kullanilir.
   */
  const addOneToPlan = async (key: string): Promise<void> => {
    if (busy || plannedSet.has(key)) return;
    const cluster = view?.clusters.find((c) => c.key === key);
    const advancedCluster =
      advancedDelete && (cluster?.verdictKind === 'keep' || cluster?.verdictKind === 'report-only');
    const useAdvanced = advancedDelete && (advancedCluster || planned?.advanced === true);

    setBusyL(true);
    setPlanError(null);
    try {
      let next: PlanResponse;
      if (useAdvanced) {
        if (planned?.planId && planned.advanced) {
          next = await api.addToPlan(planned.planId, [key]);
        } else if (planned?.planId && !planned.advanced) {
          // Normal plandan gelismise gecis: mevcut anahtarlar + yeni.
          const keys = [...plannedKeys.filter((k) => k !== key), key];
          next = await api.plan(keys, true);
        } else {
          next = await api.plan([key], true);
        }
      } else {
        next = await api.addToPlan(planned?.planId ?? null, [key]);
      }
      panel?.activate('planned');
      onPlan(next);
    } catch (err) {
      handlePlanError(err);
    } finally {
      setBusyL(false);
    }
  };

  /** Planli satir eylemi: yalniz o ogeyi plandan cikarir; planId/TTL korunur. */
  const removeOneFromPlan = async (key: string): Promise<void> => {
    if (!planned || busy) return;
    setBusyL(true);
    setPlanError(null);
    try {
      const next = await api.removeFromPlan(planned.planId, { key });
      onPlan(next);
    } catch (err) {
      handlePlanError(err);
    } finally {
      setBusyL(false);
    }
  };

  /** "Varsayılanı/Görünenleri plana ekle": motor anahtarlari + plan disindakiler. */
  const addKeysToPlan = async (keys: readonly string[]): Promise<void> => {
    const fresh = keys.filter((key, index) => !plannedSet.has(key) && keys.indexOf(key) === index);
    if (fresh.length === 0 || busy) return;
    setBusyL(true);
    setPlanError(null);
    try {
      const next = await api.addToPlan(planned?.planId ?? null, fresh);
      panel?.activate('planned');
      onPlan(next);
    } catch (err) {
      handlePlanError(err);
    } finally {
      setBusyL(false);
    }
  };

  /** "Planı boşalt": motorun panel anahtarlari Tümü tek istekte cikarilir. */
  const clearPlanAll = async (): Promise<void> => {
    if (!planned || busy || plannedKeys.length === 0) return;
    setBusyL(true);
    setPlanError(null);
    try {
      const next = await api.clearPlan(planned.planId, [...plannedKeys]);
      onPlan(next);
    } catch (err) {
      handlePlanError(err);
    } finally {
      setBusyL(false);
    }
  };

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: view?.clusters.length ?? 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 8,
  });

  const detailTargets = detail?.cluster.deleteTargets ?? [];

  // Motor secimi: plan bos iken 0; dolu iken plan kapsami.
  const selectionCount = view?.selection.clusterCount ?? 0;

  /**
   * TARAMA DURUMU (tek kaynak):
   *  - yerel SSE varsa (bu ekrandan baslatildi) ince taneli ilerleme,
   *  - yoksa App'in yokladigi motor durumu (`status.view.progress`).
   * Tarama surerken ESKI liste gosterilmez ve secim kapalidir.
   */
  const engineProgress = status?.view.progress ?? null;
  const scanning = scan !== null || status?.scanning === true;
  const live = scan ?? engineProgress;
  const scanId = scan?.id ?? engineProgress?.scanId ?? null;
  const percent = scan
    ? scan.total > 0
      ? Math.min(100, Math.round((scan.done / scan.total) * 100))
      : null
    : (engineProgress?.percent ?? null);

  /** Liste filtrelerini sifirla (tarama secenekleri KORUNUR). */
  const clearListFilters = (): void => {
    setText('');
    setKind('all');
    setCategory('all');
    setBig(false);
    setRisky(false);
    setZombie(false);
  };

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
            <button
              type="button"
              className="primary"
              disabled={scanning}
              onClick={() => void startScan()}
            >
              {scanning
                ? t('disk.scanning')
                : status?.state === 'never'
                  ? t('disk.scan')
                  : t('disk.rescan')}
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

        {scanning && (
          <section className="scan-stage" aria-labelledby="scan-stage-title">
            <div className="scan-stage-head">
              <div>
                <h2 id="scan-stage-title">{t('disk.scan.running')}</h2>
                <p className="dim">{t('disk.scan.staleNote')}</p>
              </div>
              <strong className="mono scan-stage-pct">
                {percent !== null ? `${percent}%` : t('disk.scan.preparing')}
              </strong>
            </div>

            <div
              className={`progress${percent === null ? ' indeterminate' : ''}`}
              role="progressbar"
              aria-label={t('a11y.scanProgress')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent ?? undefined}
            >
              <span style={percent !== null ? { width: `${percent}%` } : undefined} />
            </div>

            <div className="scan-stage-stats mono">
              <span>
                {live?.done ?? 0} / {live?.total || '—'} {t('disk.scan.targets')}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {live?.found ?? 0} {t('disk.found')}
              </span>
              <span aria-hidden="true">·</span>
              <span>{formatBytes(live?.bytes ?? 0)}</span>
            </div>

            {live?.current && (
              <p className="scan-stage-current mono" title={live.current}>
                <span className="dim">{t('disk.scan.current')}:</span> {live.current}
              </p>
            )}

            <div className="scan-actions">
              <button
                type="button"
                className="ghost"
                disabled={!scanId}
                onClick={() => void scanAction(live?.paused ? 'resume' : 'pause')}
              >
                {live?.paused ? t('disk.resume') : t('disk.pause')}
              </button>
              <button
                type="button"
                className="ghost"
                disabled={!scanId}
                onClick={() => void scanAction('cancel')}
              >
                {t('disk.cancel')}
              </button>
            </div>
          </section>
        )}

        {scanError && <div className="banner danger" role="alert">{t('disk.scanFailed')}: {scanError}</div>}
        {error && <div className="banner danger" role="alert">{error}</div>}
        {planError && (
          <div className="banner danger" role="alert">
            {t('disk.plan.failed')}: {planError}
          </div>
        )}
        {verifyNote && (verifyNote.missing.length > 0 || verifyNote.changed.length > 0) && (
          <div className="banner" role="status">
            <span>
              {t('disk.verify.missing', {
                count: verifyNote.missing.length,
                bytes: formatBytes(verifyNote.missingBytes),
              })}
              {verifyNote.changed.length > 0 &&
                ` ${t('disk.verify.changed', { count: verifyNote.changed.length })}`}
            </span>
            <button
              type="button"
              className="ghost"
              aria-label={t('common.close')}
              onClick={() => onDismissVerify?.()}
            >
              {t('common.close')}
            </button>
          </div>
        )}

        {/* Secim duyurusu HER ZAMAN yayinda: cubuk gizliyken de ekran
            okuyucu plan degisimini duyar. */}
        <span className="sr-only" role="status" aria-live="polite">
          {`${selectionCount} ${t('disk.selection.planned')} · ${formatBytes(
            view?.selection.bytes ?? 0,
          )}`}
        </span>

        {!scanning && (selectionCount > 0 || plannedKeys.length > 0) ? (
          <div className="selection-bar">
            <div className="selection-stats">
              <span>
                <strong className="mono">{selectionCount}</strong> {t('disk.selection.planned')}
              </span>
              <span>
                {t('disk.selection.bytes')}:{' '}
                <strong className="mono">{formatBytes(view?.selection.bytes ?? 0)}</strong>
              </span>
              <span>
                <strong className="mono">{view?.selection.targetCount ?? 0}</strong>{' '}
                {t('disk.selection.targets')}
              </span>
            </div>
            <div className="selection-actions">
              <button
                type="button"
                className="ghost"
                disabled={busy || !view}
                onClick={() => void addKeysToPlan(view!.defaultSelectedKeys)}
              >
                {t('disk.defaults')}
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busy || !view}
                onClick={() => void addKeysToPlan(view!.plannableKeys)}
              >
                {t('disk.selectVisible')}
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busy || plannedKeys.length === 0}
                onClick={() => void clearPlanAll()}
              >
                {t('disk.selection.clear')}
              </button>
              <button
                type="button"
                className="primary"
                disabled={!view || selectionCount === 0}
                title={selectionCount === 0 ? t('rightPanel.planned.applyHint') : undefined}
                onClick={onApplyPlan}
              >
                {t('rightPanel.planned.apply')}
              </button>
            </div>
          </div>
        ) : (
          <div className="selection-hint">
            <span className="dim">
              {t('disk.selection.none')} {t('disk.selection.noneHint')}
            </span>
            <span className="spacer" />
            <button
              type="button"
              className="ghost"
              disabled={busy || !view || view.defaultSelectedKeys.length === 0}
              onClick={() => void addKeysToPlan(view!.defaultSelectedKeys)}
            >
              {t('disk.defaults')}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy || !view || view.plannableKeys.length === 0}
              onClick={() => void addKeysToPlan(view!.plannableKeys)}
            >
              {t('disk.selectVisible')}
            </button>
          </div>
        )}

        {!scanning && (
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
        )}

        {!scanning && !view && !error && (
          <>
            <span className="sr-only" role="status">
              {t('common.loading')}
            </span>
            <div className="skeleton-list" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div className="skeleton-row" key={i}>
                  <span className="sk sk-dot" />
                  <span className="sk sk-title" />
                  <span className="sk sk-badge" />
                  <span className="sk sk-badge2" />
                  <span className="sk sk-size" />
                  <span className="sk sk-age" />
                </div>
              ))}
            </div>
          </>
        )}

        {!scanning && view && view.clusters.length === 0 && (
          <EmptyState
            variant="fill"
            icon={view.scan.at === null ? 'disk' : 'search'}
            title={view.scan.at === null ? t('disk.noScan.title') : t('disk.empty.title')}
            body={view.scan.at === null ? t('disk.noScan.body') : t('disk.empty.body')}
            action={
              view.scan.at === null ? (
                <button type="button" className="primary" onClick={() => void startScan()}>
                  {t('disk.scan')}
                </button>
              ) : (
                <button type="button" className="ghost" onClick={clearListFilters}>
                  {t('disk.empty.clear')}
                </button>
              )
            }
          />
        )}

        {!scanning && view && view.clusters.length > 0 && (
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
                      checked={inPlan}
                      disabled={
                        inPlan ||
                        busy ||
                        !(
                          c.plannable ||
                          (advancedDelete &&
                            (c.verdictKind === 'keep' || c.verdictKind === 'report-only'))
                        )
                      }
                      onChange={() => void addOneToPlan(c.key)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={
                        inPlan
                          ? `${t('disk.plan.inPlan')}: ${c.title}`
                          : `${t('disk.selected')}: ${c.title}`
                      }
                      title={inPlan ? t('disk.planned.hint') : undefined}
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
                    <span className={`badge${VERDICT_TONE[c.verdictKind] ?? ''}`}>
                      {t(VERDICT_LABEL[c.verdictKind] ?? 'verdict.keep')}
                    </span>
                    <span className="badge">{t(CATEGORY_LABEL[c.category] ?? 'category.unknown')}</span>
                    <span className="mono num cluster-size">
                      {formatBytes(c.reclaimableBytes)}
                    </span>
                    <span className="dim num">
                      {c.idleDays} {t('vault.days')}
                    </span>
                    <span className="badges-right">
                      {c.gitTracked && <span className="badge git">git</span>}
                      {advancedDelete &&
                        (c.verdictKind === 'keep' || c.verdictKind === 'report-only') && (
                          <span className="badge advanced">{t('disk.advanced.badge')}</span>
                        )}
                      {c.targetCount > 0 && <span className="badge">{c.targetCount}</span>}
                      {inPlan && (
                        <>
                          <span
                            className="badge planda"
                            title={planned?.name ? planned.name : undefined}
                          >
                            <Icon name="check" size={11} />
                            {t('disk.planned.badge')}
                          </span>
                          <button
                            type="button"
                            className="ghost rp-item-remove"
                            aria-label={`${t('disk.planned.remove')}: ${c.title}`}
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              void removeOneFromPlan(c.key);
                            }}
                          >
                            <Icon name="close" size={12} />
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Secim yoksa panel KENDI bos durumunu gosterir (Faz 0/UI-003):
          oge yokken baska bir "bir sey secin" cumlesi basmayiz. */}
      <RightPanelPortal>
        {detail && (
          <aside className="disk-detail">
            <h2>{tu('disk.detail')}</h2>
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

            {/* W2-e2: oge kaniti -> bagimliliklar -> (panel footer'da) baglam. */}
            <DependenciesSection
              query={detail.cluster.parts[0]?.path ?? null}
              lang={lang}
            />
          </aside>
        )}
      </RightPanelPortal>
    </div>
  );
}
