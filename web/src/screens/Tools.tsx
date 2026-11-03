import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CliExecuteResultView,
  CliInventoryStreamEvent,
  CliQuarantineExecuteResponse,
  CliQuarantinePlanResponse,
  CliRepairExecuteResponse,
  CliRepairPlanResponse,
  CliSort,
  CliSourceFilter,
  CliStatusFilter,
  CliTool,
  CliViewResponse,
} from '../../../src/core/contract.ts';
import { ApprovalRules } from '../../../src/core/approval.ts';
import { CliBulk } from '../../../src/core/cli-bulk.ts';
import { api, ApiError } from '../api.ts';
import { openEvents } from '../sse.ts';
import { translate, translateUpper, type Lang, type MessageKey } from '../i18n.ts';
import { formatAge, formatBytes, formatCount } from '../format.ts';
import { CLI_SOURCE_LABEL, CLI_STATUS_LABEL, CONFIDENCE_LABEL } from '../labels.ts';
import { RightPanelPortal, useRightPanel } from '../components/RightPanel.tsx';
import { PanelSummary } from '../components/PanelSummary.tsx';
import { DependenciesSection } from '../components/DependenciesSection.tsx';
import { EmptyState } from '../components/EmptyState.tsx';

const STATUS_TABS: Array<{ id: CliStatusFilter; label: MessageKey }> = [
  { id: 'all', label: 'disk.kind.all' },
  { id: 'unused', label: 'cli.status.unused' },
  { id: 'recent', label: 'cli.status.recent' },
  { id: 'unknown', label: 'cli.status.unknown' },
  { id: 'protected', label: 'cli.status.protected' },
];

interface Props {
  lang: Lang;
  /** Envanter degisti (tarama/execute): dashboard defterlerini tazele. */
  onChanged?: () => void;
  /** Disk taramasi suruyor: envanter BASLATILAMAZ (tek agir is kurali). */
  diskScanning?: boolean;
}

/**
 * ARACLAR — kanal bazli envanter.
 *
 * Envanter SALT OKUNUR tarama ile gelir; filtre, siralama, sayim ve
 * secilebilir kimlikler `/api/cli/view` MOTORUNDAN gelir. Kaldirma iki
 * asamalidir: plan -> yazili `SIL` -> paket yoneticisinin kendi komutu.
 * Arayuz kendi filtresini/toplamini HESAPLAMAZ.
 */
export function Tools({ lang, onChanged, diskScanning = false }: Props) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);

  // Etiket/basliklar: dil bilincli buyuk harf (TR: i -> İ).
  const tu = (key: MessageKey, vars?: Record<string, string | number>) =>
    translateUpper(lang, key, vars);
  const panel = useRightPanel();

  const [view, setView] = useState<CliViewResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState('');
  const [debouncedText, setDebouncedText] = useState('');
  const [status, setStatus] = useState<CliStatusFilter>('all');
  const [source, setSource] = useState<CliSourceFilter>('all');
  const [sort, setSort] = useState<CliSort>('status');
  const [unusedDays, setUnusedDays] = useState(21);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  type BulkPlan =
    | { kind: 'repair'; data: CliRepairPlanResponse }
    | { kind: 'quarantine'; data: CliQuarantinePlanResponse };
  type BulkResult =
    | { kind: 'repair'; data: CliRepairExecuteResponse }
    | { kind: 'quarantine'; data: CliQuarantineExecuteResponse };
  const [bulk, setBulk] = useState<BulkPlan | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [bulkPhrase, setBulkPhrase] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const [job, setJob] = useState<{
    id: string;
    found: number;
    latest: string;
  } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const closeStream = useRef<(() => void) | null>(null);

  const [phrase, setPhrase] = useState('');
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<CliExecuteResultView | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [backup, setBackup] = useState(true);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedText(text), 250);
    return () => clearTimeout(id);
  }, [text]);

  useEffect(() => {
    return () => closeStream.current?.();
  }, []);

  const loadView = useCallback(async () => {
    try {
      setError(null);
      const next = await api.cliView({ text: debouncedText, status, source, sort });
      setView(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoaded(true);
    }
  }, [debouncedText, status, source, sort]);

  useEffect(() => {
    void loadView();
  }, [loadView]);

  const startScan = async (): Promise<void> => {
    setScanError(null);
    setResult(null);
    setRemoveError(null);
    setPhrase('');
    try {
      const { jobId } = await api.startCliInventory(unusedDays);
      setJob({ id: jobId, found: 0, latest: '' });
      closeStream.current?.();
      closeStream.current = openEvents<CliInventoryStreamEvent>(
        `/api/cli/inventory/${jobId}/events`,
        (event) => {
          switch (event.type) {
            case 'start':
              setJob((j) => (j ? { ...j, found: 0 } : j));
              break;
            case 'tool':
              setJob((j) =>
                j
                  ? { ...j, found: j.found + 1, latest: event.tool.command }
                  : j,
              );
              break;
            case 'done':
              closeStream.current?.();
              closeStream.current = null;
              setJob(null);
              void loadView();
              onChanged?.();
              break;
            case 'cancelled':
              closeStream.current?.();
              closeStream.current = null;
              setJob(null);
              break;
            case 'error':
              closeStream.current?.();
              closeStream.current = null;
              setJob(null);
              setScanError(event.message);
              break;
          }
        },
      );
    } catch (err) {
      setScanError(err instanceof ApiError ? err.message : String(err));
    }
  };

  const cancelScan = async (): Promise<void> => {
    if (!job) return;
    try {
      await api.cliCancel(job.id);
    } catch (err) {
      setScanError(err instanceof ApiError ? err.message : String(err));
    }
  };

  const canSelect = (tool: CliTool): boolean =>
    CliBulk.isSelectable(tool, view?.selectableIds ?? []);

  const visibleSelectable = (view?.tools ?? []).filter(canSelect);
  const selectedTools = (view?.tools ?? []).filter((tool) => selected.has(tool.id));
  const repairIds = CliBulk.repairIds(selectedTools);
  const quarantineIds = CliBulk.quarantineIds(selectedTools);

  // Secim yalniz gorunen ve uygun araclarda kalir (filtre/ yeniden tarama).
  useEffect(() => {
    setSelected((prev) => {
      const valid = new Set((view?.tools ?? []).filter(canSelect).map((t) => t.id));
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [view]);

  const toggleSelected = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = (): void => {
    setSelected((prev) => {
      const all = visibleSelectable.length > 0 && visibleSelectable.every((t) => prev.has(t.id));
      return all ? new Set() : new Set(visibleSelectable.map((t) => t.id));
    });
  };

  const openBulk = async (kind: 'repair' | 'quarantine'): Promise<void> => {
    const ids = kind === 'repair' ? repairIds : quarantineIds;
    if (ids.length === 0) return;
    setBulkError(null);
    setBulkResult(null);
    setBulkPhrase('');
    setDetailId(null);
    setPhrase('');
    try {
      if (kind === 'repair') {
        setBulk({ kind, data: await api.cliRepairPlan({ ids }) });
      } else {
        setBulk({ kind, data: await api.cliQuarantinePlan({ ids }) });
      }
      panel?.activate('action');
    } catch (err) {
      setBulkError(err instanceof ApiError ? err.message : String(err));
    }
  };

  const executeBulk = async (): Promise<void> => {
    if (!bulk) return;
    setBulkError(null);
    setBulkBusy(true);
    try {
      if (bulk.kind === 'repair') {
        const data = await api.cliRepairExecute({ planId: bulk.data.planId, phrase: bulkPhrase });
        setBulkResult({ kind: 'repair', data });
      } else {
        const data = await api.cliQuarantineExecute({
          planId: bulk.data.planId,
          phrase: bulkPhrase,
        });
        setBulkResult({ kind: 'quarantine', data });
      }
      setBulk(null);
      setBulkPhrase('');
      setSelected(new Set());
      setView(null);
      setLoaded(false);
      await loadView();
      onChanged?.();
    } catch (err) {
      setBulkError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBulkBusy(false);
    }
  };

  const clearBulk = (): void => {
    setBulk(null);
    setBulkResult(null);
    setBulkPhrase('');
    setBulkError(null);
  };

  const detail: CliTool | null =
    detailId === null ? null : (view?.tools.find((tool) => tool.id === detailId) ?? null);

  const removeSingle = async (): Promise<void> => {
    if (!detail) return;
    setRemoveError(null);
    setResult(null);
    setExecuting(true);
    try {
      const out = await api.cliRemove({
        id: detail.id,
        phrase,
        backup,
      });
      setResult(out);
      setPhrase('');
      setDetailId(null);
      setView(null);
      setLoaded(false);
      await loadView();
      onChanged?.();
    } catch (err) {
      setRemoveError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setExecuting(false);
    }
  };

  const canExecute =
    detail !== null &&
    detail.uninstall !== null &&
    !executing &&
    ApprovalRules.matches('delete', phrase);


  const duplicateOf = (id: string) =>
    (view?.duplicates ?? []).filter(
      (d) => d.keepId === id || d.removeIds.includes(id),
    );

  const countFor = (id: CliStatusFilter): number => {
    if (!view) return 0;
    switch (id) {
      case 'all':
        return view.counts.total;
      case 'recent':
        return view.summary.recent;
      case 'unused':
        return view.counts.unused;
      case 'unknown':
        return view.counts.unknown;
      case 'protected':
        return view.counts.protected;
    }
  };

  return (
    <div className="tools">
      <section className="tools-main">
        <header className="page-head">
          <div>
            <h1>{t('tools.title')}</h1>
            <p className="dim">{t('tools.subtitle')}</p>
          </div>
          {view && (
            <span className="scan-chip scan-current">
              {t('tools.scan.latest')} · {formatAge(Math.max(0, Date.now() - view.scannedAt), lang)}
            </span>
          )}
        </header>

        <a className="skip-inline" href="#cli-list">
          {t('a11y.skipList')}
        </a>

        <div className="scan-controls">
          <label className="control-label">
            {t('tools.unusedDays')}
            <input
              className="control num"
              type="number"
              min={1}
              max={3650}
              value={unusedDays}
              onChange={(e) => setUnusedDays(Math.max(1, Number(e.target.value) || 21))}
            />
          </label>
          <button
            type="button"
            className="primary"
            onClick={() => void startScan()}
            disabled={job !== null || diskScanning}
            title={diskScanning ? t('tools.scan.blocked') : undefined}
          >
            {job ? t('tools.scanning') : view ? t('tools.rescan') : t('tools.scan')}
          </button>
        </div>

        {diskScanning && !job && (
          <p className="dim tools-blocked-note" role="status">
            {t('tools.scan.blocked')}
          </p>
        )}

        {job && (
          <div className="scan-live">
            <div className="scan-live-head">
              <strong>{t('tools.scan.live')}</strong>
              <span className="dim mono">
                {job.found} {t('tools.found')}
                {job.latest ? ` · ${job.latest}` : ''}
              </span>
            </div>
            <div className="scan-actions">
              <button type="button" className="ghost" onClick={() => void cancelScan()}>
                {t('tools.cancel')}
              </button>
            </div>
          </div>
        )}

        {scanError && (
          <div className="banner danger" role="alert">
            {t('tools.scanFailed')}: {scanError}
          </div>
        )}
        {error && <div className="banner danger" role="alert">{error}</div>}
        {removeError && <div className="banner danger" role="alert">{removeError}</div>}

        {!loaded && !error && <div className="state">{t('common.loading')}</div>}

        {loaded && !view && !job && (
          <EmptyState
            variant="wide"
            icon="tools"
            title={t('tools.noInventory')}
            body={t('tools.noInventoryHint')}
            action={
              <button
                type="button"
                className="primary"
                disabled={diskScanning}
                title={diskScanning ? t('tools.scan.blocked') : undefined}
                onClick={() => void startScan()}
              >
                {t('tools.scan')}
              </button>
            }
          />
        )}

        {view && (
          <>
            <div className="selection-bar" aria-label={t('tools.total')}>
              <span>
                <strong className="mono">{view.summary.total}</strong> {t('tools.total')}
              </span>
              <span>
                {t('tools.unused')}:{' '}
                <strong className="mono">{view.summary.unused}</strong>
              </span>
              <span>
                {t('tools.broken')}:{' '}
                <strong className="mono">{view.summary.broken}</strong>
              </span>
              <span>
                {t('tools.stateDirs')}:{' '}
                <strong className="mono">{view.summary.withStateDirs}</strong>
              </span>
              <span>
                {t('tools.unusedBytes')}:{' '}
                <strong className="mono">{formatBytes(view.summary.unusedBytes)}</strong>
              </span>
            </div>

            <div className="filters">
              <input
                className="control search"
                type="search"
                placeholder={t('tools.search')}
                value={text}
                onChange={(e) => setText(e.target.value)}
                aria-label={t('tools.search')}
                data-search
              />
              <div className="kind-tabs">
                {STATUS_TABS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`chip${status === item.id ? ' active' : ''}`}
                    onClick={() => setStatus(item.id)}
                  >
                    {t(item.label)}
                    <span className="chip-count">{countFor(item.id)}</span>
                  </button>
                ))}
              </div>
              <select
                className="control"
                value={source}
                onChange={(e) => setSource(e.target.value as CliSourceFilter)}
                aria-label={t('tools.filter.source')}
              >
                <option value="all">{t('tools.filter.source')}: —</option>
                {view.sources.map((stat) => (
                  <option key={stat.source} value={stat.source}>
                    {t(CLI_SOURCE_LABEL[stat.source] ?? 'cli.source.standalone')} (
                    {stat.count})
                  </option>
                ))}
              </select>
              <select
                className="control"
                value={sort}
                onChange={(e) => setSort(e.target.value as CliSort)}
                aria-label={t('tools.filter.sort')}
              >
                <option value="status">{t('tools.sort.status')}</option>
                <option value="size">{t('tools.sort.size')}</option>
                <option value="idle">{t('tools.sort.idle')}</option>
                <option value="name">{t('tools.sort.name')}</option>
              </select>
            </div>

            {view.tools.length === 0 && (
              <EmptyState variant="fill" icon="tools" title={t('tools.empty')} />
            )}

            {view.tools.length > 0 && selected.size > 0 && (
              <div className="selection-bar selection-bar-actions">
                <span>
                  <strong className="mono">{selected.size}</strong> {t('tools.selected')}
                </span>
                <span className="selection-actions">
                  <button
                    type="button"
                    className="ghost"
                    disabled={repairIds.length === 0}
                    title={repairIds.length === 0 ? t('tools.bulk.noneRepair') : undefined}
                    onClick={() => void openBulk('repair')}
                  >
                    {t('tools.bulk.repair')}
                    {repairIds.length > 0 ? ` (${repairIds.length})` : ''}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={quarantineIds.length === 0}
                    title={
                      quarantineIds.length === 0 ? t('tools.bulk.noneQuarantine') : undefined
                    }
                    onClick={() => void openBulk('quarantine')}
                  >
                    {t('tools.bulk.quarantine')}
                    {quarantineIds.length > 0 ? ` (${quarantineIds.length})` : ''}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={selected.size === 0}
                    onClick={() => setSelected(new Set())}
                  >
                    {t('tools.selection.clear')}
                  </button>
                </span>
              </div>
            )}

            {view.tools.length > 0 && (
              <div className="cli-head">
                <label className="cli-check">
                  <input
                    type="checkbox"
                    checked={
                      visibleSelectable.length > 0 &&
                      visibleSelectable.every((tool) => selected.has(tool.id))
                    }
                    disabled={visibleSelectable.length === 0}
                    onChange={toggleAll}
                    aria-label={t('tools.select.all')}
                  />
                </label>
                <span>{tu('tools.command')}</span>
                <span>{tu('tools.source')}</span>
                <span>{tu('tools.status')}</span>
                <span className="num">{tu('tools.idle')}</span>
                <span className="num">{tu('tools.size')}</span>
                <span />
              </div>
            )}

            {view.tools.length > 0 && (
              <div
                className="cli-scroll"
                id="cli-list"
                tabIndex={-1}
                role="group"
                aria-label={t('a11y.toolList')}
              >
                {view.tools.map((tool) => (
                  <div
                    key={tool.id}
                    className={`cli-row${detailId === tool.id ? ' active' : ''}${
                      selected.has(tool.id) ? ' selected' : ''
                    }`}
                    onClick={() => {
                      setBulk(null);
                      setBulkResult(null);
                      setDetailId(tool.id);
                      panel?.activate('evidence');
                    }}
                  >
                    <label
                      className="cli-check"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(tool.id)}
                        disabled={!canSelect(tool)}
                        onChange={() => toggleSelected(tool.id)}
                        aria-label={`${t('tools.select.row')}: ${tool.command}`}
                      />
                    </label>
                    <button
                      type="button"
                      className="cli-name-wrap row-open"
                      aria-label={`${t('a11y.openDetail')}: ${tool.command}`}
                      aria-current={detailId === tool.id ? 'true' : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        setBulk(null);
                        setBulkResult(null);
                        setDetailId(tool.id);
                        panel?.activate('evidence');
                      }}
                    >
                      <span className="cli-command mono">{tool.command}</span>
                      <span className="cli-package dim mono">
                        {tool.packageName}@{tool.version}
                      </span>
                    </button>
                    <span className="badge">
                      {t(CLI_SOURCE_LABEL[tool.source] ?? 'cli.source.standalone')}
                    </span>
                    <span
                      className={`badge cli-status-${tool.status}`}
                      title={tool.evidence[0] ?? ''}
                    >
                      {t(CLI_STATUS_LABEL[tool.status] ?? 'cli.status.unknown')}
                    </span>
                    <span className="num dim">
                      {tool.idleDays >= 0
                        ? `${Math.floor(tool.idleDays)} ${t('vault.days')}`
                        : '—'}
                    </span>
                    <span className="num mono">{formatBytes(tool.totalBytes)}</span>
                    <span className="badges-right">
                      {(tool.usageSignals ?? []).map((sig) => (
                        <span
                          key={sig}
                          className="badge signal-badge"
                          aria-label={t(`tools.signal.${sig}` as MessageKey)}
                        >
                          {t(`tools.signal.${sig}` as MessageKey)}
                        </span>
                      ))}
                      {tool.atimeSuspect && (
                        <span
                          className="badge warn signal-badge"
                          aria-label={t('tools.signal.atimeSuspect')}
                        >
                          {t('tools.signal.atimeSuspect')}
                        </span>
                      )}
                      {tool.health === 'broken' && (
                        <span className="badge warn">{t('tools.brokenBadge')}</span>
                      )}
                      {tool.activeShim === false && (
                        <span className="badge">{t('tools.shadowed')}</span>
                      )}
                      {tool.uninstall === null && (
                        <span className="badge">{t('cli.status.protected')}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <RightPanelPortal module="action">
        {removeError && (
          <div className="banner danger" role="alert">
            {removeError}
          </div>
        )}

        {result && (
          <section className="plan-panel">
            <h2>{tu('tools.plan.done')}</h2>
            <ul className="detail-list">
              <li>
                <span className="mono">
                  {result.ok ? '✓' : '✗'} {result.command}
                </span>
                <span className="dim">
                  {result.verified ? t('plan.done') : t('tools.plan.failed')}
                  {result.manual ? ` · ${t('tools.manual')}` : ''}
                </span>
                {result.backupDir && (
                  <span className="dim mono">
                    {t('tools.backup')}: {result.backupDir}
                  </span>
                )}
                {result.error && <span className="dim">{result.error}</span>}
              </li>
            </ul>
            <div className="approval-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setResult(null)}
              >
                {t('common.back')}
              </button>
            </div>
          </section>
        )}

        {bulkError && (
          <div className="banner danger" role="alert">
            {bulkError}
          </div>
        )}

        {bulkResult && (
          <section className="plan-panel">
            <h2>{tu('tools.bulk.doneTitle')}</h2>
            <ul className="detail-list">
              {bulkResult.kind === 'repair'
                ? bulkResult.data.results.map((row) => (
                    <li key={row.command}>
                      <span className="mono">
                        {row.ok ? '✓' : '✗'} {row.command}
                      </span>
                      <span className="dim">
                        {row.verified ? t('plan.done') : t('tools.plan.failed')}
                        {row.error ? ` · ${row.error}` : ''}
                      </span>
                    </li>
                  ))
                : bulkResult.data.results.map((row) => (
                    <li key={row.command}>
                      <span className="mono">
                        {row.ok ? '✓' : '✗'} {row.command}
                      </span>
                      <span className="dim mono">
                        {row.movedShims} shim · {row.copiedState} · {row.vaultDir}
                      </span>
                      {row.error && <span className="dim">{row.error}</span>}
                    </li>
                  ))}
            </ul>
            <div className="approval-actions">
              <button type="button" className="ghost" onClick={clearBulk}>
                {t('common.back')}
              </button>
            </div>
          </section>
        )}

        {!bulkResult && bulk && (
          <section className="plan-panel">
            <h2>
              {tu(
                bulk.kind === 'repair'
                  ? 'tools.bulk.repairTitle'
                  : 'tools.bulk.quarantineTitle',
              )}
            </h2>
            <p className="dim">
              {t(
                bulk.kind === 'repair'
                  ? 'tools.bulk.repairHint'
                  : 'tools.bulk.quarantineHint',
                { phrase: ApprovalRules.phrase(bulk.kind) },
              )}
            </p>

            <ul className="detail-list">
              {bulk.data.items.map((item) => (
                <li key={item.id}>
                  <span className="mono">{item.command}</span>
                  <span className="dim mono">
                    {item.packageName}@{item.version}
                  </span>
                  {'repairCommand' in item ? (
                    <span className="dim mono">{item.repairCommand}</span>
                  ) : (
                    <span className="dim mono">
                      {item.shims.length} shim · {formatBytes(item.totalBytes)}
                    </span>
                  )}
                </li>
              ))}
            </ul>

            <label className="approval-row">
              <span>{t('tools.bulk.phrase')}</span>
              <input
                className="control mono"
                value={bulkPhrase}
                onChange={(e) => setBulkPhrase(e.target.value)}
                placeholder={ApprovalRules.phrase(bulk.kind)}
                aria-label={t('tools.bulk.phrase')}
                autoComplete="off"
                disabled={bulkBusy}
              />
            </label>

            <div className="approval-actions">
              <button
                type="button"
                className="ghost"
                disabled={bulkBusy}
                onClick={clearBulk}
              >
                {t('common.back')}
              </button>
              <button
                type="button"
                className="primary"
                disabled={bulkBusy || !ApprovalRules.matches(bulk.kind, bulkPhrase)}
                onClick={() => void executeBulk()}
              >
                {bulkBusy
                  ? t('tools.bulk.running')
                  : t(
                      bulk.kind === 'repair'
                        ? 'tools.bulk.executeRepair'
                        : 'tools.bulk.executeQuarantine',
                    )}
              </button>
            </div>
          </section>
        )}

        {!result && !bulk && detail && (
          <section className="plan-panel">
            <h2>{tu('tools.plan.title')}</h2>
            <p className="dim">{t('tools.plan.phraseHint', { phrase: ApprovalRules.phrase('delete') })}</p>

            <dl className="meta-list">
              <dt>{t('tools.command')}</dt>
              <dd className="mono">{detail.command}</dd>
              {detail.uninstall && (
                <>
                  <dt>{t('tools.uninstall')}</dt>
                  <dd className="mono">
                    <code>{detail.uninstall.display}</code>
                  </dd>
                </>
              )}
            </dl>

            <label className="approval-row">
              <input
                type="checkbox"
                checked={backup}
                onChange={(e) => setBackup(e.target.checked)}
              />
              <span>{t('tools.backup')}</span>
            </label>

            <label className="approval-row">
              <span>{t('tools.plan.phrase')}</span>
              <input
                className="control mono"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder={ApprovalRules.phrase('delete')}
                aria-label={t('tools.plan.phrase')}
                autoComplete="off"
                disabled={executing || detail.uninstall === null}
              />
            </label>

            <div className="approval-actions">
              <button
                type="button"
                className="ghost"
                disabled={executing}
                onClick={() => {
                  setDetailId(null);
                  setPhrase('');
                  setResult(null);
                }}
              >
                {t('common.back')}
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={!canExecute}
                onClick={() => void removeSingle()}
              >
                {executing ? t('tools.plan.running') : t('tools.plan.execute')}
              </button>
            </div>

            {detail.uninstall === null && (
              <p className="dim">{t('cli.status.protected')}</p>
            )}
          </section>
        )}

        {!result && !detail && !bulk && !bulkResult && (
          <EmptyState
            icon="tools"
            tone="warn"
            title={t('rightPanel.action.emptyTitle')}
            body={t('rightPanel.action.emptyBody')}
          />
        )}
      </RightPanelPortal>

      {/* Kanitlar modulu: arac secilmeden once envanter ozeti (P2). */}
      <RightPanelPortal when={detail === null && view !== null}>
        <PanelSummary
          lang={lang}
          title="rightPanel.summary.tools.title"
          body="rightPanel.summary.tools.body"
          note="rightPanel.summary.note"
          stats={
            view
              ? [
                  {
                    label: 'rightPanel.stat.totalTools',
                    value: formatCount(view.summary.total, lang),
                  },
                  {
                    label: 'rightPanel.stat.visible',
                    value: formatCount(view.summary.visible, lang),
                  },
                  {
                    label: 'cli.status.unused',
                    value: formatCount(view.summary.unused, lang),
                    tone: 'warn',
                  },
                  {
                    label: 'rightPanel.stat.removable',
                    value: formatCount(view.summary.removable, lang),
                    tone: 'ok',
                  },
                  {
                    label: 'rightPanel.stat.unusedBytes',
                    value: formatBytes(view.summary.unusedBytes),
                  },
                  {
                    label: 'rightPanel.stat.total',
                    value: formatBytes(view.summary.totalBytes),
                  },
                  {
                    label: 'cli.status.protected',
                    value: formatCount(view.summary.protected, lang),
                  },
                ]
              : []
          }
        />
      </RightPanelPortal>

      <RightPanelPortal module="evidence" when={detail !== null}>
          <aside className="tools-detail">
            <h2>{tu('tools.detail')}</h2>
            {!detail ? (
              <p className="dim">{t('tools.detail.empty')}</p>
            ) : (
              <>
                <h3 className="mono">{detail.command}</h3>
                <p className="dim mono">
                  {detail.packageName}@{detail.version}
                </p>
                <div className="detail-badges">
                  <span className={`badge cli-status-${detail.status}`}>
                    {t(CLI_STATUS_LABEL[detail.status] ?? 'cli.status.unknown')}
                  </span>
                  <span className="badge">
                    {t(CLI_SOURCE_LABEL[detail.source] ?? 'cli.source.standalone')}
                  </span>
                  <span className="badge">
                    {t(CONFIDENCE_LABEL[detail.confidence] ?? 'confidence.low')}
                  </span>
                  {(detail.usageSignals ?? []).map((sig) => (
                    <span
                      key={sig}
                      className="badge signal-badge"
                      aria-label={t(`tools.signal.${sig}` as MessageKey)}
                    >
                      {t(`tools.signal.${sig}` as MessageKey)}
                    </span>
                  ))}
                  {detail.atimeSuspect && (
                    <span
                      className="badge warn signal-badge"
                      aria-label={t('tools.signal.atimeSuspect')}
                    >
                      {t('tools.signal.atimeSuspect')}
                    </span>
                  )}
                  {detail.health === 'broken' && (
                    <span className="badge warn">{t('tools.brokenBadge')}</span>
                  )}
                  {detail.activeShim === false && (
                    <span className="badge">{t('tools.shadowed')}</span>
                  )}
                </div>

                <dl className="meta-list">
                  <dt>{t('tools.installPath')}</dt>
                  <dd className="mono" title={detail.installPath}>
                    {detail.installPath}
                  </dd>
                  <dt>{t('tools.size')}</dt>
                  <dd className="mono">{formatBytes(detail.totalBytes)}</dd>
                  <dt>{t('tools.idle')}</dt>
                  <dd className="mono">
                    {detail.idleDays >= 0
                      ? `${Math.floor(detail.idleDays)} ${t('vault.days')}`
                      : '—'}
                  </dd>
                  <dt>{t('tools.status')}</dt>
                  <dd>
                    {t(CLI_STATUS_LABEL[detail.status] ?? 'cli.status.unknown')}
                  </dd>
                </dl>

                {detail.uninstall && (
                  <div className="artifact-command">
                    <span className="dim">{t('tools.uninstall')}</span>
                    <code>{detail.uninstall.display}</code>
                  </div>
                )}
                {detail.repair && (
                  <div className="artifact-command">
                    <span className="dim">{t('tools.reinstall')}</span>
                    <code>{detail.repair.display}</code>
                  </div>
                )}

                {detail.shims.length > 0 && (
                  <>
                    <h4>{tu('tools.shims')}</h4>
                    <ul className="detail-list">
                      {detail.shims.map((shim) => (
                        <li key={shim} className="mono">
                          {shim}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {detail.stateDirs.length > 0 && (
                  <>
                    <h4>{tu('tools.stateDirList')}</h4>
                    <ul className="detail-list">
                      {detail.stateDirs.map((dir) => (
                        <li key={dir} className="mono">
                          {dir}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {detail.evidence.length > 0 && (
                  <>
                    <h4>{tu('tools.evidence')}</h4>
                    <ul className="detail-list">
                      {detail.evidence.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </>
                )}

                {(detail.references ?? []).length > 0 && (
                  <>
                    <h4>{tu('tools.references')}</h4>
                    <ul className="detail-list">
                      {(detail.references ?? []).map((ref) => (
                        <li key={`${ref.kind}:${ref.path}`}>
                          <span className="mono">{ref.path}</span>
                          <span className="dim">
                            {ref.kind} · {ref.detail}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {duplicateOf(detail.id).length > 0 && (
                  <>
                    <h4>{tu('tools.duplicates')}</h4>
                    <ul className="detail-list">
                      {duplicateOf(detail.id).map((dup) => (
                        <li key={dup.command}>
                          <span className="mono">{dup.command}</span>
                          <span className="dim">{dup.reason}</span>
                          <span className="dim mono">
                            {t('tools.keep')}: {dup.keepId} · {t('tools.remove')}:{' '}
                            {dup.removeIds.join(', ')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}

            {/* W2-e2: arac kaniti -> bagimliliklar -> (panel footer'da) baglam. */}
            <DependenciesSection query={detail?.command ?? null} lang={lang} />
          </aside>
      </RightPanelPortal>

    </div>
  );
}
