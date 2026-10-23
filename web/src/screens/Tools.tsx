import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CliExecuteResponse,
  CliInventoryStreamEvent,
  CliPlanResponse,
  CliSort,
  CliSourceFilter,
  CliStatusFilter,
  CliTool,
  CliViewResponse,
} from '../../../src/core/contract.ts';
import { ApprovalRules } from '../../../src/core/approval.ts';
import { api, ApiError } from '../api.ts';
import { openEvents } from '../sse.ts';
import { translate, translateUpper, type Lang, type MessageKey } from '../i18n.ts';
import { formatAge, formatBytes } from '../format.ts';
import { CLI_SOURCE_LABEL, CLI_STATUS_LABEL, CONFIDENCE_LABEL } from '../labels.ts';
import { RightPanelPortal, useRightPanel } from '../components/RightPanel.tsx';
import { DependenciesSection } from '../components/DependenciesSection.tsx';

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
}

/**
 * ARACLAR — kanal bazli envanter.
 *
 * Envanter SALT OKUNUR tarama ile gelir; filtre, siralama, sayim ve
 * secilebilir kimlikler `/api/cli/view` MOTORUNDAN gelir. Kaldirma iki
 * asamalidir: plan -> yazili `SIL` -> paket yoneticisinin kendi komutu.
 * Arayuz kendi filtresini/toplamini HESAPLAMAZ.
 */
export function Tools({ lang, onChanged }: Props) {
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

  const [job, setJob] = useState<{
    id: string;
    found: number;
    latest: string;
  } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const closeStream = useRef<(() => void) | null>(null);

  const [plan, setPlan] = useState<CliPlanResponse | null>(null);
  const [phrase, setPhrase] = useState('');
  const [executing, setExecuting] = useState(false);
  const [results, setResults] = useState<CliExecuteResponse | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

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
    setResults(null);
    setPlan(null);
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

  const selectable = new Set(view?.selectableIds ?? []);

  const toggle = (id: string): void => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectVisible = (): void => {
    if (!view) return;
    setSelected((previous) => {
      const next = new Set(previous);
      for (const id of view.selectableIds) next.add(id);
      return next;
    });
  };

  const createPlan = async (): Promise<void> => {
    if (selected.size === 0) return;
    setPlanError(null);
    setResults(null);
    try {
      const next = await api.cliPlan({
        commands: [...selected],
        backup: true,
        unusedDays,
      });
      setPlan(next);
      setPhrase('');
      panel?.activate('action');
    } catch (err) {
      setPlanError(err instanceof ApiError ? err.message : String(err));
    }
  };

  const execute = async (): Promise<void> => {
    if (!plan) return;
    setPlanError(null);
    setExecuting(true);
    try {
      const out = await api.cliExecute(plan.planId, phrase);
      setResults(out);
      setPlan(null);
      setPhrase('');
      setSelected(new Set());
      setDetailId(null);
      setView(null);
      setLoaded(false);
      await loadView();
      onChanged?.();
    } catch (err) {
      setPlanError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setExecuting(false);
    }
  };

  const canExecute =
    plan !== null &&
    !executing &&
    ApprovalRules.matches(plan.approvalKind, phrase);

  const detail: CliTool | null =
    detailId === null ? null : (view?.tools.find((tool) => tool.id === detailId) ?? null);

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
            disabled={job !== null}
          >
            {job ? t('tools.scanning') : view ? t('tools.rescan') : t('tools.scan')}
          </button>
        </div>

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
        {planError && <div className="banner danger" role="alert">{planError}</div>}

        {!loaded && !error && <div className="state">{t('common.loading')}</div>}

        {loaded && !view && !job && (
          <div className="state">
            <strong>{t('tools.noInventory')}</strong>
            <span className="dim">{t('tools.noInventoryHint')}</span>
          </div>
        )}

        {view && (
          <>
            <div className="selection-bar" aria-label={t('tools.total')}>
              <span className="sr-only" role="status" aria-live="polite">
                {`${selected.size} ${t('tools.selected')}`}
              </span>
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

            <div className="selection-bar">
              <span>
                <strong className="mono">{selected.size}</strong> {t('tools.selected')}
              </span>
              <span className="spacer" />
              <button type="button" className="ghost" onClick={selectVisible}>
                {t('tools.selectVisible')}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => setSelected(new Set())}
              >
                {t('tools.clear')}
              </button>
              <button
                type="button"
                className="primary"
                disabled={selected.size === 0 || executing}
                onClick={() => void createPlan()}
              >
                {t('tools.plan')}
              </button>
            </div>

            {view.tools.length === 0 && (
              <div className="state">{t('tools.empty')}</div>
            )}

            {view.tools.length > 0 && (
              <div className="cli-head">
                <span />
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
                    className={`cli-row${detailId === tool.id ? ' active' : ''}`}
                    onClick={() => {
                      setDetailId(tool.id);
                      setPlan(null);
                      panel?.activate('evidence');
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(tool.id)}
                      disabled={!selectable.has(tool.id)}
                      onChange={() => toggle(tool.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`${t('tools.selected')}: ${tool.command}`}
                    />
                    <button
                      type="button"
                      className="cli-name-wrap row-open"
                      aria-label={`${t('a11y.openDetail')}: ${tool.command}`}
                      aria-current={detailId === tool.id ? 'true' : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDetailId(tool.id);
                        setPlan(null);
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
        {plan && (
          <section className="plan-panel">
            <h2>{tu('tools.plan.title')}</h2>
            <p className="dim">{t('tools.plan.phraseHint', { phrase: plan.phrase })}</p>

            <dl className="meta-list">
              <dt>{t('tools.plan.items')}</dt>
              <dd className="mono">{plan.items.length}</dd>
              <dt>{t('tools.plan.total')}</dt>
              <dd className="mono">{formatBytes(plan.totalBytes)}</dd>
              <dt>{t('tools.plan.backup')}</dt>
              <dd className="mono">{formatBytes(plan.backupBytes)}</dd>
            </dl>

            <ul className="detail-list">
              {plan.items.map((item) => (
                <li key={item.id}>
                  <span className="mono">
                    {item.command} · {item.packageName}@{item.version}
                  </span>
                  <span className="dim">
                    {t(CLI_SOURCE_LABEL[item.source] ?? 'cli.source.standalone')} ·{' '}
                    {formatBytes(item.totalBytes)}
                  </span>
                  <span className="artifact-command">
                    <span className="dim">{t('tools.uninstall')}</span>
                    <code>{item.uninstallCommand}</code>
                  </span>
                  {item.manual && (
                    <span className="badge warn">{t('tools.manual')}</span>
                  )}
                  {item.backupSkipped.length > 0 && (
                    <span className="dim">
                      {t('tools.plan.backupSkipped')}: {item.backupSkipped.length}
                    </span>
                  )}
                </li>
              ))}
            </ul>

            {(plan.blocked ?? []).length > 0 && (
              <>
                <h4>{tu('tools.plan.blocked')}</h4>
                <ul className="detail-list">
                  {(plan.blocked ?? []).map((blocked) => (
                    <li key={blocked.id}>
                      <span className="mono">{blocked.command}</span>
                      <span className="dim">{blocked.reason}</span>
                      {blocked.dependents.length > 0 && (
                        <span className="dim">
                          {t('tools.plan.dependents')}: {blocked.dependents.join(', ')}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <label className="approval-row">
              <span>{t('tools.plan.phrase')}</span>
              <input
                className="control mono"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder={plan.phrase}
                aria-label={t('tools.plan.phrase')}
                autoComplete="off"
              />
            </label>

            <div className="approval-actions">
              <button
                type="button"
                className="ghost"
                disabled={executing}
                onClick={() => {
                  setPlan(null);
                  setPhrase('');
                }}
              >
                {t('common.back')}
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={!canExecute}
                onClick={() => void execute()}
              >
                {executing ? t('tools.plan.running') : t('tools.plan.execute')}
              </button>
            </div>
          </section>
        )}
      </RightPanelPortal>

      <RightPanelPortal module="evidence">
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

      <RightPanelPortal module="action">

        {results && (
          <section className="plan-panel">
            <h2>{tu('tools.plan.done')}</h2>
            <ul className="detail-list">
              {results.results.map((result, index) => (
                <li key={`${result.command}:${index}`}>
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
              ))}
            </ul>
          </section>
        )}
      </RightPanelPortal>
    </div>
  );
}
