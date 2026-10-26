import { useCallback, useEffect, useState } from 'react';
import type { VaultListResponse, AuditResponse } from '../../../src/core/contract.ts';
import { ApprovalRules } from '../../../src/core/approval.ts';
import { api, ApiError } from '../api.ts';
import { translate, translateUpper, type Lang, type MessageKey } from '../i18n.ts';
import { formatAge, formatBytes, formatTimestamp } from '../format.ts';
import { EmptyState } from '../components/EmptyState.tsx';

interface Props {
  lang: Lang;
  onChanged: () => void;
}

/**
 * KASA — geri yukleme ve kalici silme.
 *
 * Kalici silme ifadesi sunucudan (`purgePhrase`) gelir; arayuz kendi
 * ifadesini uretmez. Geri yukleme istemci YOL gondermez: yalnizca kayit
 * kimligi gonderilir.
 */
export function Vault({ lang, onChanged }: Props) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);

  // Etiket/basliklar: dil bilincli buyuk harf (TR: i -> İ).
  const tu = (key: MessageKey, vars?: Record<string, string | number>) =>
    translateUpper(lang, key, vars);

  const [data, setData] = useState<VaultListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [phrase, setPhrase] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [purgeBusy, setPurgeBusy] = useState(false);
  const busy = purgeBusy || busyId !== null;
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const [tab, setTab] = useState<'vault' | 'audit'>('vault');
  const [auditData, setAuditData] = useState<AuditResponse | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);

  const loadAudit = useCallback(async (): Promise<void> => {
    setAuditLoading(true);
    setAuditError(null);
    try {
      setAuditData(await api.audit({ limit: 200 }));
    } catch (err) {
      setAuditError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'audit') void loadAudit();
  }, [tab, loadAudit]);

  const load = useCallback(async (): Promise<void> => {
    try {
      setError(null);
      setData(await api.vault());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string): void => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const restore = async (id: string): Promise<void> => {
    if (purgeBusy || (busyId !== null && busyId !== id)) {
      setNotice(t('vault.busyOther'));
      return;
    }
    setBusyId(id);
    setError(null);
    setNotice(null);
    setRowError((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
    try {
      const result = await api.restore(id);
      if (result.ok) {
        setNotice(
          `${t('vault.restored')}: ${result.to}${result.conflict ? ` (${t('vault.conflict')})` : ''}`,
        );
      } else {
        const msg = result.error ?? t('vault.restoreFailed');
        setRowError((previous) => ({ ...previous, [id]: msg }));
        setError(msg);
      }
      await load();
      onChanged();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      setRowError((previous) => ({ ...previous, [id]: msg }));
      setError(msg);
    } finally {
      setBusyId(null);
    }
  };

  const phraseOk = !data || ApprovalRules.matches('vaultPurge', phrase);
  const canPurge = !busy && selected.size > 0 && phraseOk;

  const purge = async (): Promise<void> => {
    if (!data || selected.size === 0) return;
    setPurgeBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.purge([...selected], phrase);
      setNotice(
        `${t('vault.purged')}: ${formatBytes(result.bytes)} · ${result.items ?? selected.size}`,
      );
      setSelected(new Set());
      setPhrase('');
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setPurgeBusy(false);
    }
  };

  return (
    <div className="vault">
      <header className="page-head">
        <div>
          <h1>{t('vault.title')}</h1>
          <p className="dim">{t('vault.subtitle')}</p>
        </div>
        {data && (
          <div className="vault-totals">
            <span>
              {t('vault.total')}: <strong className="mono">{formatBytes(data.totalBytes)}</strong>
            </span>
            <span className="dim">
              {t('vault.retention')}: {data.retentionDays} {t('vault.days')}
            </span>
          </div>
        )}
      </header>

      <div className="kind-tabs" style={{ marginBottom: 12 }}>
        <button type="button" className={`chip${tab === 'vault' ? ' active' : ''}`} onClick={() => setTab('vault')}>
          {t('vault.tab.vault')}
        </button>
        <button type="button" className={`chip${tab === 'audit' ? ' active' : ''}`} onClick={() => setTab('audit')}>
          {t('vault.tab.audit')}
        </button>
      </div>

      {tab === 'vault' && (
        <>
      {error && <div className="banner danger" role="alert">{error}</div>}
      {notice && <div className="banner success">{notice}</div>}

      {!data && !error && <div className="state">{t('common.loading')}</div>}
      {data && data.entries.length === 0 && (
        <EmptyState
          variant="wide"
          icon="vault"
          title={t('vault.emptyTitle')}
          body={t('vault.emptyBody')}
        />
      )}

      {data && data.entries.length > 0 && (
        <>
          <section className="panel">
            <table className="table">
              <thead>
                <tr>
                  <th />
                  <th>{tu('vault.original')}</th>
                  <th className="num">{t('vault.size')}</th>
                  <th className="num">{t('vault.age')}</th>
                  <th className="num">{t('vault.remaining')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(entry.id)}
                        onChange={() => toggle(entry.id)}
                        aria-label={entry.originalPath}
                      />
                    </td>
                    <td>
                      <div className="mono">{entry.originalPath}</div>
                      {entry.originalExists && (
                        <span className="badge warn">{t('vault.conflict')}</span>
                      )}
                      {rowError[entry.id] && (
                        <div className="danger-text">{rowError[entry.id]}</div>
                      )}
                    </td>
                    <td className="num mono">{formatBytes(entry.bytes)}</td>
                    <td className="num dim">{formatAge(entry.ageMs, lang)}</td>
                    <td className="num dim">
                      {entry.remainingDays} {t('vault.days')}
                    </td>
                    <td className="num">
                      <button
                        type="button"
                        className="ghost"
                        disabled={busyId === entry.id}
                        onClick={() => void restore(entry.id)}
                      >
                        {busyId === entry.id ? t('vault.restoring') : t('vault.restore')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="panel approval">
            <h2>{tu('vault.purge')}</h2>
            <label className="approval-row">
              <span>
                {data.purgePhrase
                  ? t('vault.purgeHint', { phrase: data.purgePhrase })
                  : t('vault.emptySelected')}
              </span>
              <input
                className="control mono"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder={data.purgePhrase}
                aria-label={t('vault.phrase')}
                autoComplete="off"
              />
            </label>
            <div className="approval-actions">
              <span className="dim">
                {selected.size} {t('vault.selected')}
              </span>
              <button
                type="button"
                className="ghost"
                onClick={() => setSelected(new Set())}
                disabled={busy || selected.size === 0}
              >
                {t('disk.clear')}
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() => void purge()}
                disabled={!canPurge}
              >
                {t('vault.purge')}
              </button>
            </div>
          </section>
        </>
      )}
        </>
      )}

      {tab === 'audit' && (
        <section className="panel">
          <h2>{t('audit.title')}</h2>
          <p className="dim">{t('audit.hint')}</p>
          {auditLoading && <div className="state">{t('common.loading')}</div>}
          {auditError && <div className="banner danger" role="alert">{auditError}</div>}
          {auditData && auditData.auditFileExists === false && (
            <EmptyState variant="wide" icon="vault" title={t('audit.empty')} body="" />
          )}
          {auditData && auditData.events.length > 0 && (
            <>
              <div className="dim" style={{ marginBottom: 8 }}>
                {t('audit.counts.total')}: {auditData.counts.total} · {t('audit.counts.delete')}: {auditData.counts.delete} · {t('audit.counts.restore')}: {auditData.counts.restore} · {t('audit.counts.purge')}: {auditData.counts.purge} · {t('audit.counts.failed')}: {auditData.counts.failed}
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('audit.col.date')}</th>
                    <th>{t('audit.col.type')}</th>
                    <th>{t('audit.col.result')}</th>
                    <th>{t('audit.col.path')}</th>
                    <th className="num">{t('audit.col.size')}</th>
                  </tr>
                </thead>
                <tbody>
                  {auditData.events.map((e, i) => (
                    <tr key={i}>
                      <td className="dim">{formatTimestamp(e.at, lang)}</td>
                      <td>{t(`audit.kind.${e.kind}` as any)}</td>
                      <td>
                        <span className={`badge ${e.ok ? 'ok' : 'danger'}`}>{e.ok ? t('audit.ok') : t('audit.failed')}</span>
                        {!e.ok && e.code && <span className="dim"> {e.code}</span>}
                        {!e.ok && e.reason && <div className="danger-text">{e.reason}</div>}
                      </td>
                      <td>
                        <div className="mono">{e.path ?? ''}</div>
                        {e.paths && e.paths.length > 0 && (
                          <div className="dim">{t('audit.paths')}: {e.paths.slice(0,3).join(', ')}{e.paths.length > 3 ? ` +${e.paths.length - 3}` : ''}</div>
                        )}
                      </td>
                      <td className="num mono">{e.bytes !== undefined ? formatBytes(e.bytes) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}
    </div>
  );
}
