import { useCallback, useEffect, useState } from 'react';
import type {
  SettingsResponse,
  UpdateCheckView,
} from '../../../src/core/contract.ts';
import { api, ApiError } from '../api.ts';
import { translate, translateUpper, type Lang, type MessageKey } from '../i18n.ts';
import { formatAge } from '../format.ts';

interface Props {
  lang: Lang;
  version?: string;
}

/**
 * AYARLAR — kalici ayarlar + opt-in guncelleme kontrolu.
 *
 * Guncelleme kontrolu KAPALIYKEN hicbir ag istegi yapilmaz. Arayuz
 * yalnizca sunucunun ayar/sonuc gorunumunu gosterir.
 */
export function Settings({ lang, version }: Props) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);

  // Etiket/basliklar: dil bilincli buyuk harf (TR: i -> İ).
  const tu = (key: MessageKey, vars?: Record<string, string | number>) =>
    translateUpper(lang, key, vars);

  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [scanCacheHours, setScanCacheHours] = useState(24);
  const [vaultRetentionDays, setVaultRetentionDays] = useState(30);
  const [updateCheck, setUpdateCheck] = useState<'off' | 'daily' | 'weekly'>('off');
  const [scanOnLaunch, setScanOnLaunch] = useState<'always' | 'daily' | 'manual'>('always');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<UpdateCheckView | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const apply = useCallback((next: SettingsResponse) => {
    setSettings(next);
    setScanCacheHours(next.scanCacheHours);
    setVaultRetentionDays(next.vaultRetentionDays);
    setUpdateCheck(next.updateCheck);
    setScanOnLaunch(next.scanOnLaunch);
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .settings()
      .then((next) => {
        if (alive) apply(next);
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiError ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [apply]);

  const save = async (): Promise<void> => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      apply(await api.saveSettings({ scanCacheHours, vaultRetentionDays, updateCheck, scanOnLaunch }));
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const check = async (): Promise<void> => {
    setChecking(true);
    setUpdateError(null);
    try {
      setUpdate(await api.updateCheck(true));
    } catch (err) {
      setUpdateError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="settings">
      <header className="page-head">
        <div>
          <h1>{t('settings.title')}</h1>
          <p className="dim">{t('settings.subtitle')}</p>
        </div>
        <span className="mono dim">
          {t('settings.currentVersion')}: v{version ?? '—'}
        </span>
      </header>

      {loading && <div className="state">{t('common.loading')}</div>}
      {error && <div className="banner danger" role="alert">{error}</div>}

      {settings && (
        <>
          <section className="panel">
            <h2>{tu('settings.scanCache')}</h2>
            <div className="settings-row">
              <input
                className="control num"
                type="number"
                min={settings.minCacheHours}
                max={settings.maxCacheHours}
                value={scanCacheHours}
                onChange={(e) =>
                  setScanCacheHours(
                    Math.min(
                      settings.maxCacheHours,
                      Math.max(settings.minCacheHours, Number(e.target.value) || settings.minCacheHours),
                    ),
                  )
                }
                aria-label={t('settings.scanCache')}
              />
              <span className="dim">
                {settings.minCacheHours}–{settings.maxCacheHours} · {t('settings.scanCacheHint')}
              </span>
            </div>
          </section>

          <section className="panel">
            <h2>{tu('settings.vaultRetention')}</h2>
            <div className="settings-row">
              <input
                className="control num"
                type="number"
                min={1}
                max={3650}
                value={vaultRetentionDays}
                onChange={(e) =>
                  setVaultRetentionDays(Math.max(1, Number(e.target.value) || 30))
                }
                aria-label={t('settings.vaultRetention')}
              />
              <span className="dim">{t('settings.vaultRetentionHint')}</span>
            </div>
          </section>

          <section className="panel">
            <h2>{tu('settings.updateCheck')}</h2>
            <div className="settings-row">
              <select
                className="control"
                value={updateCheck}
                onChange={(e) =>
                  setUpdateCheck(
                    e.target.value === 'daily'
                      ? 'daily'
                      : e.target.value === 'weekly'
                        ? 'weekly'
                        : 'off',
                  )
                }
                aria-label={t('settings.updateCheck')}
              >
                <option value="off">{t('settings.update.off')}</option>
                <option value="daily">{t('settings.update.daily')}</option>
                <option value="weekly">{t('settings.update.weekly')}</option>
              </select>
              <span className="dim">{t('settings.updateHint')}</span>
            </div>
          </section>

          <section className="panel">
            <h2>{tu('settings.scanOnLaunch')}</h2>
            <div className="settings-row">
              <select
                className="control"
                value={scanOnLaunch}
                onChange={(e) =>
                  setScanOnLaunch(
                    e.target.value === 'daily'
                      ? 'daily'
                      : e.target.value === 'manual'
                        ? 'manual'
                        : 'always',
                  )
                }
                aria-label={t('settings.scanOnLaunch')}
              >
                <option value="always">{t('settings.scanLaunch.always')}</option>
                <option value="daily">{t('settings.scanLaunch.daily')}</option>
                <option value="manual">{t('settings.scanLaunch.manual')}</option>
              </select>
              <span className="dim">{t('settings.scanOnLaunchHint')}</span>
            </div>
          </section>

          <div className="settings-actions">
            <button
              type="button"
              className="primary"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? t('settings.saving') : t('settings.save')}
            </button>
            {saved && <span className="badge git">{t('settings.saved')}</span>}
          </div>

          <section className="panel">
            <h2>{tu('settings.update.run')}</h2>
            <div className="settings-row">
              <button
                type="button"
                className="ghost"
                disabled={checking}
                onClick={() => void check()}
              >
                {checking ? t('settings.update.running') : t('settings.update.run')}
              </button>
              <span className="dim">{t('settings.updateHint')}</span>
            </div>

            {updateError && <div className="banner danger" role="alert">{updateError}</div>}

            {update && (
              <div className="settings-update">
                {update.mode === 'off' || !update.checked ? (
                  <p className="dim">{t('settings.update.offline')}</p>
                ) : update.error ? (
                  <p className="banner danger" role="alert">
                    {t('settings.update.error')}: {update.error}
                  </p>
                ) : (
                  <>
                    <dl className="meta-list">
                      <dt>{t('settings.update.current')}</dt>
                      <dd className="mono">{update.current ?? '—'}</dd>
                      <dt>{t('settings.update.latest')}</dt>
                      <dd className="mono">{update.latest ?? '—'}</dd>
                      <dt>{t('settings.update.checkedAt')}</dt>
                      <dd className="mono">
                        {formatAge(
                          update.checkedAt ? Math.max(0, Date.now() - update.checkedAt) : null,
                          lang,
                        )}
                      </dd>
                    </dl>
                    {update.updateAvailable && (
                      <p className="banner success">
                        {t('settings.update.available')}: {update.latest}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
