import { useCallback, useEffect, useState } from 'react';
import type {
  EnvAnalysis,
  EnvApplyResult,
  EnvPlanResponse,
} from '../../../src/core/contract.ts';
import { ApprovalRules } from '../../../src/core/approval.ts';
import { EnvSelection } from '../../../src/core/env-view.ts';
import { api, ApiError } from '../api.ts';
import { translate, translateUpper, type Lang, type MessageKey } from '../i18n.ts';
import { ENV_FINDING_LABEL, ENV_REASON_LABEL, ENV_SCOPE_LABEL } from '../labels.ts';
import { RightPanelPortal, useRightPanel } from '../components/RightPanel.tsx';

interface Props {
  lang: Lang;
}

/**
 * PATH & ORTAM — analiz SALT OKUNUR; yazma yalniz plan + yedek +
 * yazili `TEMIZLE` ile. Plan `EnvService`te saklanir; istemci yalnizca
 * plan kimligi ve ifade gonderir. Arayuz kendi filtresini/toplamini
 * hesaplamaz; bulgular ve plan motorun ciktisidir.
 */
export function Env({ lang }: Props) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);

  // Etiket/basliklar: dil bilincli buyuk harf (TR: i -> İ).
  const tu = (key: MessageKey, vars?: Record<string, string | number>) =>
    translateUpper(lang, key, vars);

  /** Enum sizintisi yok: kapsam kimligi gorunen etikete cevrilir. */
  const scopeLabel = (scope: 'user' | 'machine'): string =>
    t(scope === 'machine' ? 'env.scope.machine' : 'env.scope.user');
  const panel = useRightPanel();

  const [analysis, setAnalysis] = useState<EnvAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scope, setScope] = useState<'user' | 'machine' | 'both'>('user');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [plan, setPlan] = useState<EnvPlanResponse | null>(null);
  const [planning, setPlanning] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<EnvApplyResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAnalysis(await api.envAnalyze());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAnalysis();
  }, [loadAnalysis]);

  const entries = analysis ? EnvSelection.entries(analysis) : [];
  const candidateIds = analysis ? EnvSelection.candidateIds(analysis, scope) : [];

  // Kapsam veya analiz degisince secim, kaldirilabilir girdilerden yeniden kurulur.
  useEffect(() => {
    setSelected(new Set(analysis ? EnvSelection.candidateIds(analysis, scope) : []));
  }, [analysis, scope]);

  const toggleEntry = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createPlan = async (): Promise<void> => {
    setPlanning(true);
    setActionError(null);
    setResult(null);
    try {
      const next = await api.envPlan({ scope, removeEntries: [...selected] });
      setPlan(next);
      setPhrase('');
      panel?.activate('action');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setPlanning(false);
    }
  };

  const apply = async (): Promise<void> => {
    if (!plan) return;
    setApplying(true);
    setActionError(null);
    try {
      const out = await api.envApply(plan.planId, phrase);
      setResult(out);
      // Kismi uygulamada da analiz TAZELENIR: eski "once" degerleri kalmasin.
      setPlan(null);
      setPhrase('');
      await loadAnalysis();
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as EnvApplyResult | null;
        if (body && typeof body === 'object' && 'ok' in body) setResult(body);
        setActionError(err.message);
      } else {
        setActionError(String(err));
      }
    } finally {
      setApplying(false);
    }
  };

  const canApply =
    plan !== null &&
    !applying &&
    ApprovalRules.matches(plan.approvalKind, phrase);

  return (
    <div className="env">
      <section className="env-main">
        <header className="page-head">
          <div>
            <h1>{t('env.title')}</h1>
            <p className="dim">{t('env.subtitle')}</p>
          </div>
          <button type="button" className="ghost" onClick={() => void loadAnalysis()}>
            {t('env.refresh')}
          </button>
        </header>

        {loading && <div className="state">{t('common.loading')}</div>}
        {error && <div className="banner danger" role="alert">{error}</div>}

        {analysis && (
          <>
            <div className="scan-controls">
              <label className="control-label">
                {t('env.scope')}
                <select
                  className="control"
                  value={scope}
                  onChange={(e) =>
                    setScope(
                      e.target.value === 'machine'
                        ? 'machine'
                        : e.target.value === 'both'
                          ? 'both'
                          : 'user',
                    )
                  }
                >
                  <option value="user">{t('env.scope.user')}</option>
                  <option value="machine">{t('env.scope.machine')}</option>
                  <option value="both">{t('env.scope.both')}</option>
                </select>
              </label>
              <span className="dim env-selection-count">
                {t('env.selection.count', { n: selected.size })}
              </span>
              <button
                type="button"
                className="ghost"
                disabled={candidateIds.length === 0}
                onClick={() => setSelected(new Set(candidateIds))}
              >
                {t('env.selection.all')}
              </button>
              <button
                type="button"
                className="ghost"
                disabled={selected.size === 0}
                onClick={() => setSelected(new Set())}
              >
                {t('env.selection.none')}
              </button>
              <button
                type="button"
                className="primary"
                disabled={planning || selected.size === 0}
                onClick={() => void createPlan()}
              >
                {planning ? t('common.loading') : t('env.planNew')}
              </button>
            </div>
            <p className="dim env-selection-hint">{t('env.selection.hint')}</p>

            <section className="panel">
              <h2>{tu('env.findings')}</h2>
              {analysis.findings.length === 0 ? (
                <p className="dim">{t('env.noFindings')}</p>
              ) : (
                <ul className="detail-list">
                  {analysis.findings.map((finding) => (
                    <li key={finding.id}>
                      <span>
                        <span
                          className={`badge ${finding.severity === 'warning' ? 'warn' : ''}`}
                        >
                          {t(ENV_FINDING_LABEL[finding.kind] ?? 'env.kind.empty-variable')}
                        </span>{' '}
                        <span className="mono">{finding.variable}</span>{' '}
                        <span className="dim">
                          · {t(ENV_SCOPE_LABEL[finding.scope] ?? 'env.scope.user')}
                        </span>
                      </span>
                      <span className="dim mono">{finding.value}</span>
                      <span className="dim">
                        {ENV_REASON_LABEL[finding.kind]
                          ? t(ENV_REASON_LABEL[finding.kind])
                          : finding.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel">
              <h2>{tu('env.pathEntries')}</h2>
              <div className="path-scroll">
                {entries.map((entry) => (
                  <div className="path-row" key={entry.id}>
                    <input
                      type="checkbox"
                      className="path-check"
                      checked={selected.has(entry.id)}
                      disabled={!entry.removable}
                      onChange={() => toggleEntry(entry.id)}
                      aria-label={t('env.selection.row', { path: entry.expanded })}
                    />
                    <span className="badge">
                      {t(ENV_SCOPE_LABEL[entry.scope] ?? 'env.scope.user')}
                    </span>
                    <span className="num dim mono">{entry.index}</span>
                    <span className="mono path-value" title={entry.expanded}>
                      {entry.expanded}
                    </span>
                    <span
                      className={`badge ${
                        entry.state === 'missing' || entry.state === 'duplicate' ? 'warn' : ''
                      }`}
                    >
                      {t(`env.entry.${entry.state}` as MessageKey)}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel">
              <h2>{tu('env.orphans')}</h2>
              {analysis.orphanVariables.length === 0 ? (
                <p className="dim">—</p>
              ) : (
                <ul className="detail-list">
                  {analysis.orphanVariables.map((variable) => (
                    <li key={`${variable.scope}:${variable.name}`}>
                      <span className="mono">{variable.name}</span>
                      <span className="dim">
                        {t(ENV_SCOPE_LABEL[variable.scope] ?? 'env.scope.user')} ·{' '}
                        {variable.display}
                        {variable.sensitive ? ` · ${t('env.sensitive')}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel">
              <h2>{tu('env.shadows')}</h2>
              {analysis.commandShadows.length === 0 ? (
                <p className="dim">—</p>
              ) : (
                <ul className="detail-list">
                  {analysis.commandShadows.map((shadow) => (
                    <li key={shadow.command}>
                      <span className="mono">{shadow.command}</span>
                      <span className="dim mono">{shadow.winner}</span>
                      <span className="dim">
                        {shadow.shadowed.join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </section>

      <RightPanelPortal module="action">
        <aside className="env-detail">
        <h2>{tu('env.plan.title')}</h2>
        {actionError && <div className="banner danger" role="alert">{actionError}</div>}

        {!plan && !result && <p className="dim">{t('env.plan.empty')}</p>}

        {plan && (
          <>
            {plan.plan.empty ? (
              <p className="dim">{t('env.plan.noChanges')}</p>
            ) : (
              <>
                <dl className="meta-list">
                  <dt>{t('env.plan.changes')}</dt>
                  <dd className="mono">{plan.plan.changes.length}</dd>
                </dl>

                <ul className="detail-list">
                  {plan.plan.changes.map((change, index) => (
                    <li key={`${change.scope}:${change.name}:${index}`}>
                      <span className="mono">
                        {scopeLabel(change.scope)} · {change.name}
                      </span>
                      <span className="dim">{change.reason}</span>
                      <span className="dim mono">
                        {t('env.plan.before')}: {change.before ?? '—'}
                      </span>
                      <span className="dim mono">
                        {t('env.plan.after')}: {change.after ?? '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {plan.plan.warnings.length > 0 && (
              <>
                <h4>{tu('env.plan.warnings')}</h4>
                <ul className="detail-list">
                  {plan.plan.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </>
            )}

            {plan.plan.requiresAdmin && (
              <div className="banner danger" role="alert">{t('env.plan.admin')}</div>
            )}
            <p className="dim">{t('env.plan.backupNote')}</p>

            <label className="approval-row">
              <span>{t('env.plan.phraseHint', { phrase: plan.phrase })}</span>
              <input
                className="control mono"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder={plan.phrase}
                aria-label={t('env.plan.phrase')}
                autoComplete="off"
              />
            </label>

            <div className="approval-actions">
              <button
                type="button"
                className="ghost"
                disabled={applying}
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
                disabled={!canApply || plan.plan.empty}
                onClick={() => void apply()}
              >
                {applying ? t('env.plan.applying') : t('env.plan.apply')}
              </button>
            </div>
          </>
        )}

        {result && (
          <section className="panel">
            <h2>{tu('env.plan.done')}</h2>
            <dl className="meta-list">
              <dt>{t('env.plan.applied')}</dt>
              <dd className="mono">{result.applied}</dd>
              <dt>{t('env.plan.failed')}</dt>
              <dd className="mono">{result.failed}</dd>
              <dt>{t('env.plan.backup')}</dt>
              <dd className="mono" title={result.backupFile ?? ''}>
                {result.backupFile ?? '—'}
              </dd>
            </dl>
            {result.errors.length > 0 && (
              <ul className="detail-list">
                {result.errors.map((err) => (
                  <li key={`${err.scope}:${err.name}`}>
                    <span className="mono">{err.name}</span>
                    <span className="dim">
                      {scopeLabel(err.scope)} · {err.reason}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </aside>
      </RightPanelPortal>
    </div>
  );
}
