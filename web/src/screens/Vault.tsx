import { useCallback, useEffect, useState } from 'react';
import type { VaultListResponse } from '../../../src/core/contract.ts';
import { ApprovalRules } from '../../../src/core/approval.ts';
import { api, ApiError } from '../api.ts';
import { translate, translateUpper, type Lang, type MessageKey } from '../i18n.ts';
import { formatAge, formatBytes } from '../format.ts';
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
    </div>
  );
}
