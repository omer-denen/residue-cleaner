import { useEffect, useRef, useState } from 'react';
import type { ExecuteEvent, PlanResponse } from '../../../src/core/contract.ts';
import { ApprovalRules } from '../../../src/core/approval.ts';
import { api, ApiError } from '../api.ts';
import { openEvents } from '../sse.ts';
import { translate, translateUpper, type Lang, type MessageKey } from '../i18n.ts';
import { formatBytes } from '../format.ts';
import { RISK_LABEL } from '../labels.ts';
import { PlanValidity } from '../components/PlannedModule.tsx';

interface Props {
  plan: PlanResponse | null;
  lang: Lang;
  /** Plan suresi doldu: bos durumda kapatilabilir uyarida yumusak cikis. */
  expired?: boolean;
  onDismissExpired?: () => void;
  onBack: () => void;
  onVault: () => void;
  onReplace: (plan: PlanResponse) => void;
  onExecuted: () => void;
}

interface JobState {
  id: string;
  total: number;
  done: number;
  current: string;
}

/**
 * PLAN / ONAY — yalnizca GOSTERIR.
 *
 * Onay ifadesi ve yuksek risk kurali sunucudan (`ApprovalRules`) gelir;
 * arayuz kendi dogrulamasini yapmaz, sunucunun reddini gosterir.
 * Kalici silme yoktur: yalniz kasaya tasima.
 */
export function PlanScreen({
  plan,
  lang,
  expired,
  onDismissExpired,
  onBack,
  onVault,
  onReplace,
  onExecuted,
}: Props) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);

  // Etiket/basliklar: dil bilincli buyuk harf (TR: i -> İ).
  const tu = (key: MessageKey, vars?: Record<string, string | number>) =>
    translateUpper(lang, key, vars);

  const [phrase, setPhrase] = useState('');
  const [ack, setAck] = useState(false);
  const [job, setJob] = useState<JobState | null>(null);
  const [result, setResult] = useState<Extract<ExecuteEvent, { type: 'done' }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeStream = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => closeStream.current?.();
  }, []);

  if (!plan) {
    return (
      <div className="plan">
        <header className="page-head">
          <h1>{t('plan.title')}</h1>
        </header>
        {expired && (
          <div className="banner danger" role="alert">
            {t('plan.expired')}
            {onDismissExpired && (
              <button
                type="button"
                className="ghost"
                onClick={onDismissExpired}
              >
                {t('common.close')}
              </button>
            )}
          </div>
        )}
        <div className="state">{t('plan.empty')}</div>
        <button type="button" className="ghost" onClick={onBack}>
          {t('plan.back')}
        </button>
      </div>
    );
  }

  const execute = async (): Promise<void> => {
    setError(null);
    setResult(null);
    try {
      const { jobId } = await api.execute(
        plan.planId,
        phrase.trim().length > 0 ? phrase : undefined,
        ack,
      );
      setJob({ id: jobId, total: plan.plan.targets.length, done: 0, current: '' });
      closeStream.current?.();
      closeStream.current = openEvents<ExecuteEvent>(`/api/jobs/${jobId}/events`, (event) => {
        switch (event.type) {
          case 'start':
            setJob((j) => (j ? { ...j, total: event.total } : j));
            break;
          case 'target-start':
            setJob((j) => (j ? { ...j, current: event.label } : j));
            break;
          case 'target-done':
            setJob((j) => (j ? { ...j, done: event.index + 1 } : j));
            break;
          case 'done':
            closeStream.current?.();
            closeStream.current = null;
            setJob(null);
            setResult(event);
            onExecuted();
            break;
          case 'error':
            closeStream.current?.();
            closeStream.current = null;
            setJob(null);
            setError(event.message);
            break;
        }
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  const phraseOk = !plan.requiresPhrase || ApprovalRules.matches(plan.approvalKind, phrase);
  const ackOk = !plan.requiresHighAck || ack;
  const canExecute = !job && !result && phraseOk && ackOk;

  const removeCluster = async (key: string): Promise<void> => {
    const remaining = plan.plan.clusters.filter((c) => c.key !== key).map((c) => c.key);
    if (remaining.length === 0) {
      onBack();
      return;
    }
    try {
      setError(null);
      onReplace(await api.plan(remaining));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  return (
    <div className="plan">
      <header className="page-head">
        <div>
          <h1>{t('plan.title')}</h1>
          <p className="dim">{t('plan.subtitle')}</p>
        </div>
        <div className="page-actions plan-head-right">
          <span className="ledger-value">{formatBytes(plan.plan.totalBytes)}</span>
          <PlanValidity expiresAt={plan.expiresAt} lang={lang} labelKey="plan.validity" />
        </div>
      </header>

      {error && <div className="banner danger" role="alert">{error}</div>}

      <section className="panel">
        <h2>
          {tu('plan.clusters')} · {plan.plan.clusters.length} · {tu('plan.targets')}{' '}
          {plan.plan.targets.length}
        </h2>
        <table className="table">
          <thead>
            <tr>
              <th>{tu('table.cluster')}</th>
              <th>{tu('plan.targets')}</th>
              <th>{tu('disk.detail.risk')}</th>
              <th className="num">{t('table.size')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {plan.plan.clusters.map((cluster) => (
              <tr key={cluster.key}>
                <td>
                  <div className="mono">{cluster.key}</div>
                  <div className="dim">{cluster.title}</div>
                </td>
                <td className="num mono">{cluster.targets.length}</td>
                <td>
                  <span className={`risk-badge risk-${cluster.risk}`}>
                    {t(RISK_LABEL[cluster.risk] ?? 'risk.safe')}
                  </span>
                </td>
                <td className="num mono">{formatBytes(cluster.bytes)}</td>
                <td className="num">
                  <button
                    type="button"
                    className="ghost"
                    disabled={!!job}
                    onClick={() => void removeCluster(cluster.key)}
                  >
                    {t('plan.remove')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel approval">
        <h2>{tu('plan.approval')}</h2>
        {plan.requiresPhrase && (
          <label className="approval-row">
            <span>{t('plan.phraseHint', { phrase: plan.phrase })}</span>
            <input
              className="control mono"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder={plan.phrase}
              aria-label={t('plan.phrase')}
              autoComplete="off"
            />
          </label>
        )}
        {plan.requiresHighAck && (
          <label className="approval-row checkbox">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>{t('plan.highAck')}</span>
          </label>
        )}
        {!plan.requiresPhrase && !plan.requiresHighAck && (
          <p className="dim">{t('plan.noPhrase')}</p>
        )}

        {job ? (
          <div className="scan-live">
            <div className="scan-live-head">
              <strong>{t('plan.running')}</strong>
              <span className="dim mono">
                {job.done} / {job.total}
              </span>
            </div>
            <div className="progress">
              <span
                style={{ width: `${job.total > 0 ? (job.done / job.total) * 100 : 0}%` }}
              />
            </div>
            <span className="dim mono">{job.current}</span>
          </div>
        ) : result ? (
          <div className="banner success">
            <strong>{t('plan.done')}</strong> · {t('plan.freed')}:{' '}
            <span className="mono">{formatBytes(result.freed)}</span> · {t('plan.removed')}{' '}
            <span className="mono">{result.removed}</span> · {t('plan.skipped')}{' '}
            <span className="mono">{result.skipped}</span> · {t('plan.failed')}{' '}
            <span className="mono">{result.failed}</span>
          </div>
        ) : null}

        <div className="approval-actions">
          <button type="button" className="ghost" onClick={onBack} disabled={!!job}>
            {t('plan.back')}
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void execute()}
            disabled={!canExecute}
          >
            {t('plan.execute')}
          </button>
          {result && (
            <button type="button" className="ghost" onClick={onVault}>
              {t('plan.goVault')}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
