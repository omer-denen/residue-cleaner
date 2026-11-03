import { useCallback, useEffect, useState } from 'react';
import type {
  CategoryKey,
  PlanPreview,
  ScheduleCatchUpItem,
  ScheduleCreateRequest,
  ScheduleFrequency,
  ScheduleRun,
  ScheduleView,
} from '../../../src/core/contract.ts';
import { ApprovalRules } from '../../../src/core/approval.ts';
import { api, ApiError } from '../api.ts';
import { translate, translateUpper, type Lang, type MessageKey } from '../i18n.ts';
import { formatBytes } from '../format.ts';
import {
  CATEGORY_LABEL,
  RISK_LABEL,
  SCHEDULE_FREQ_LABEL,
  SCHEDULE_STATUS_LABEL,
  SCHEDULE_WEEKDAY_LABEL,
} from '../labels.ts';

interface Props {
  lang: Lang;
}

function formatDateTime(ms: number | null | undefined, lang: Lang): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US');
}

function selectorSummary(rule: ScheduleView, t: (key: MessageKey, vars?: Record<string, string | number>) => string): string {
  const sel = rule.selector;
  const parts: string[] = [];
  parts.push(
    sel.categories && sel.categories.length > 0
      ? sel.categories.map((c) => t(CATEGORY_LABEL[c] ?? 'category.unknown')).join(', ')
      : t('schedules.selector.allCategories'),
  );
  parts.push(`${t('schedules.maxRisk')}: ${t(RISK_LABEL[sel.maxRisk ?? 'safe'] ?? 'risk.safe')}`);
  parts.push(`${t('schedules.selector.limit')}: ${sel.maxItems ?? 10}`);
  if (sel.minIdleDays !== undefined) {
    parts.push(`${t('schedules.minIdle')}: ${sel.minIdleDays}`);
  }
  return parts.join(' · ');
}

/**
 * PLANLAR — kurallar secici saklar; calisma yalniz kasaya tasir.
 *
 * Kural olusturma yazili `PLANLA` onayi ister (sunucu da dogrular).
 * Onizleme ve calisma MOTORDAN gelir; arayuz kendi secimini yapmaz.
 * Kacirilan calismalar otomatik calistirilmaz.
 */
export function Schedules({ lang }: Props) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);

  // Etiket/basliklar: dil bilincli buyuk harf (TR: i -> İ).
  const tu = (key: MessageKey, vars?: Record<string, string | number>) =>
    translateUpper(lang, key, vars);

  const [rules, setRules] = useState<ScheduleView[]>([]);
  const [catchUp, setCatchUp] = useState<ScheduleCatchUpItem[]>([]);
  const [history, setHistory] = useState<ScheduleRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(() => translate(lang, 'schedules.defaultName'));
  const [frequency, setFrequency] = useState<ScheduleFrequency>('daily');
  const [hour, setHour] = useState(3);
  const [minute, setMinute] = useState(0);
  const [weekday, setWeekday] = useState(1);
  const [runMinutes, setRunMinutes] = useState(60);
  const [maxRisk, setMaxRisk] = useState<'safe' | 'low'>('safe');
  const [minIdleDays, setMinIdleDays] = useState(0);
  const [maxItems, setMaxItems] = useState(10);
  const [categories, setCategories] = useState<Set<CategoryKey>>(new Set());
  const [compensateMissed, setCompensateMissed] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [phrase, setPhrase] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toggleId, setToggleId] = useState<string | null>(null);
  const [togglePhrase, setTogglePhrase] = useState('');
  const [toggling, setToggling] = useState(false);

  const [preview, setPreview] = useState<{ ruleId: string; data: PlanPreview } | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [confirmRun, setConfirmRun] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<ScheduleRun | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, catchup, runs] = await Promise.all([
        api.schedules(),
        api.scheduleCatchUp(),
        api.scheduleHistory(),
      ]);
      setRules(list.schedules);
      setCatchUp(catchup.catchUp);
      setHistory(runs.runs);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const phraseOk = ApprovalRules.matches('schedule', phrase);

  const toggleCategory = (category: CategoryKey): void => {
    setCategories((previous) => {
      const next = new Set(previous);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const formBody = (): ScheduleCreateRequest => ({
    name,
    frequency,
    hour,
    minute,
    ...(frequency === 'weekly' ? { weekday } : {}),
    ...(frequency === 'once'
      ? { runAt: Date.now() + Math.max(1, runMinutes) * 60_000 }
      : {}),
    selector: {
      ...(categories.size > 0 ? { categories: [...categories] } : {}),
      maxRisk,
      ...(minIdleDays > 0 ? { minIdleDays } : {}),
      maxItems,
    },
    enabled,
    compensateMissed,
    phrase,
  });

  const resetForm = (): void => {
    setEditingId(null);
    setName(translate(lang, 'schedules.defaultName'));
    setFrequency('daily');
    setHour(3);
    setMinute(0);
    setWeekday(1);
    setRunMinutes(60);
    setMaxRisk('safe');
    setMinIdleDays(0);
    setMaxItems(10);
    setCategories(new Set());
    setCompensateMissed(true);
    setEnabled(true);
    setPhrase('');
  };

  const startEdit = (rule: ScheduleView): void => {
    setEditingId(rule.id);
    setName(rule.name);
    setFrequency(rule.frequency);
    setHour(rule.hour);
    setMinute(rule.minute);
    setWeekday(rule.weekday ?? 1);
    setRunMinutes(
      Math.max(1, Math.ceil(((rule.runAt ?? Date.now() + 60 * 60_000) - Date.now()) / 60_000)),
    );
    setMaxRisk(rule.selector.maxRisk === 'low' ? 'low' : 'safe');
    setMinIdleDays(rule.selector.minIdleDays ?? 0);
    setMaxItems(rule.selector.maxItems ?? 10);
    setCategories(new Set(rule.selector.categories ?? []));
    setCompensateMissed(rule.compensateMissed);
    setEnabled(rule.enabled);
    setPhrase('');
    setToggleId(null);
    requestAnimationFrame(() => {
      document.querySelector('.schedule-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const submit = async (): Promise<void> => {
    setCreating(true);
    setError(null);
    try {
      if (editingId) await api.updateSchedule(editingId, formBody());
      else await api.createSchedule(formBody());
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const toggle = async (rule: ScheduleView, next: boolean): Promise<void> => {
    setToggling(true);
    setError(null);
    try {
      await api.updateSchedule(rule.id, {
        enabled: next,
        ...(next ? { phrase: togglePhrase } : {}),
      });
      setToggleId(null);
      setTogglePhrase('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setToggling(false);
    }
  };

  const previewRule = async (id: string): Promise<void> => {
    setPreviewing(id);
    setError(null);
    try {
      setPreview({ ruleId: id, data: await api.previewSchedule(id) });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setPreviewing(null);
    }
  };

  const runRule = async (id: string): Promise<void> => {
    setRunningId(id);
    setError(null);
    try {
      const run = await api.runSchedule(id);
      setRunResult(run);
      setConfirmRun(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setRunningId(null);
    }
  };

  const deleteRule = async (id: string): Promise<void> => {
    setError(null);
    try {
      await api.removeSchedule(id);
      setConfirmDelete(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('schedules.deleteError'));
    }
  };

  return (
    <div className="schedules">
      <header className="page-head">
        <div>
          <h1>{t('schedules.title')}</h1>
          <p className="dim">{t('schedules.subtitle')}</p>
        </div>
        <button type="button" className="ghost" onClick={() => void load()}>
          {t('top.refresh')}
        </button>
      </header>

      {error && <div className="banner danger" role="alert">{error}</div>}
      {loading && <div className="state">{t('common.loading')}</div>}

      {!loading && (
        <>
          <section className="panel">
            <h2>{editingId ? tu('schedules.editTitle') : tu('schedules.new')}</h2>
            <p className="dim">
              {editingId ? t('schedules.editNote') : t('schedules.approvalNote')}
            </p>

            <div className="schedule-form">
              <label className="control-label">
                {t('schedules.name')}
                <input
                  className="control"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="control-label">
                {t('schedules.frequency')}
                <select
                  className="control"
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value as ScheduleFrequency)}
                >
                  <option value="once">{t('schedules.freq.once')}</option>
                  <option value="daily">{t('schedules.freq.daily')}</option>
                  <option value="weekly">{t('schedules.freq.weekly')}</option>
                </select>
              </label>

              {frequency === 'weekly' && (
                <label className="control-label">
                  {t('schedules.weekday')}
                  <select
                    className="control"
                    value={weekday}
                    onChange={(e) => setWeekday(Number(e.target.value))}
                  >
                    {SCHEDULE_WEEKDAY_LABEL.map((label, index) => (
                      <option key={label} value={index}>
                        {t(label)}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {frequency === 'once' ? (
                <label className="control-label">
                  {t('schedules.runIn')}
                  <input
                    className="control num"
                    type="number"
                    min={1}
                    value={runMinutes}
                    onChange={(e) => setRunMinutes(Math.max(1, Number(e.target.value) || 60))}
                  />
                </label>
              ) : (
                <>
                  <label className="control-label">
                    {t('schedules.hour')}
                    <input
                      className="control num"
                      type="number"
                      min={0}
                      max={23}
                      value={hour}
                      onChange={(e) =>
                        setHour(Math.min(23, Math.max(0, Number(e.target.value) || 0)))
                      }
                    />
                  </label>
                  <label className="control-label">
                    {t('schedules.minute')}
                    <input
                      className="control num"
                      type="number"
                      min={0}
                      max={59}
                      value={minute}
                      onChange={(e) =>
                        setMinute(Math.min(59, Math.max(0, Number(e.target.value) || 0)))
                      }
                    />
                  </label>
                </>
              )}

              <label className="control-label">
                {t('schedules.maxRisk')}
                <select
                  className="control"
                  value={maxRisk}
                  onChange={(e) => setMaxRisk(e.target.value === 'low' ? 'low' : 'safe')}
                >
                  <option value="safe">{t('risk.safe')}</option>
                  <option value="low">{t('risk.low')}</option>
                </select>
              </label>
              <label className="control-label">
                {t('schedules.minIdle')}
                <input
                  className="control num"
                  type="number"
                  min={0}
                  value={minIdleDays}
                  onChange={(e) => setMinIdleDays(Math.max(0, Number(e.target.value) || 0))}
                />
              </label>
              <label className="control-label">
                {t('schedules.maxItems')}
                <input
                  className="control num"
                  type="number"
                  min={1}
                  max={100}
                  value={maxItems}
                  onChange={(e) =>
                    setMaxItems(Math.min(100, Math.max(1, Number(e.target.value) || 10)))
                  }
                />
              </label>
            </div>

            <div className="schedule-categories">
              <span className="dim">{t('schedules.categories')}:</span>
              {Object.keys(CATEGORY_LABEL).map((key) => {
                const category = key as CategoryKey;
                return (
                  <button
                    key={category}
                    type="button"
                    className={`chip${categories.has(category) ? ' active' : ''}`}
                    onClick={() => toggleCategory(category)}
                  >
                    {t(CATEGORY_LABEL[category] ?? 'category.unknown')}
                  </button>
                );
              })}
            </div>

            <div className="schedule-checks">
              <label className="control-label">
                <input
                  type="checkbox"
                  checked={compensateMissed}
                  onChange={(e) => setCompensateMissed(e.target.checked)}
                />
                {t('schedules.compensate')}
              </label>
              <label className="control-label">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                {t('schedules.enabled')}
              </label>
            </div>

            <div className="schedule-approval">
              <label className="approval-row">
                <span>
                  {t(editingId ? 'schedules.editPhraseHint' : 'schedules.phraseHint', {
                    phrase: ApprovalRules.phrase('schedule'),
                  })}
                </span>
                <input
                  className="control mono"
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  placeholder={ApprovalRules.phrase('schedule')}
                  aria-label={t('schedules.phrase')}
                  autoComplete="off"
                />
              </label>
              {editingId && (
                <button type="button" className="ghost" onClick={resetForm} disabled={creating}>
                  {t('schedules.cancelEdit')}
                </button>
              )}
              <button
                type="button"
                className="primary"
                disabled={creating || !phraseOk || name.trim().length < 2}
                onClick={() => void submit()}
              >
                {creating
                  ? t('schedules.saving')
                  : editingId
                    ? t('schedules.save')
                    : t('schedules.create')}
              </button>
            </div>
          </section>

          {catchUp.length > 0 && (
            <section className="panel">
              <h2>{tu('schedules.catchUp')}</h2>
              <p className="dim">{t('schedules.catchUpHint')}</p>
              <ul className="detail-list">
                {catchUp.map((item) => (
                  <li key={item.rule.id}>
                    <span className="mono">{item.rule.name}</span>
                    <span className="dim">{item.message}</span>
                    {confirmRun === item.rule.id ? (
                      <span className="approval-actions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setConfirmRun(null)}
                        >
                          {t('schedules.cancel')}
                        </button>
                        <button
                          type="button"
                          className="primary"
                          disabled={runningId !== null}
                          onClick={() => void runRule(item.rule.id)}
                        >
                          {runningId === item.rule.id
                            ? t('schedules.running')
                            : t('schedules.run')}
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => setConfirmRun(item.rule.id)}
                      >
                        {t('schedules.run')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="panel">
            <h2>{tu('schedules.list')}</h2>
            {rules.length === 0 ? (
              <p className="dim">{t('schedules.empty')}</p>
            ) : (
              <div className="schedule-list">
                {rules.map((rule) => (
                  <article key={rule.id} className="schedule-card">
                    <div className="schedule-head">
                      <strong>{rule.name}</strong>
                      <span className="badge">{t(SCHEDULE_FREQ_LABEL[rule.frequency] ?? 'schedules.freq.daily')}</span>
                      <span className="badge">{t('schedules.mode')}: {t('schedules.mode.vault')}</span>
                      {!rule.enabled && <span className="badge">{t('schedules.disabled')}</span>}
                      {rule.due && <span className="badge warn">{t('schedules.due')}</span>}
                      {rule.missed > 0 && (
                        <span className="badge warn">
                          {rule.missed} {t('schedules.missed')}
                        </span>
                      )}
                    </div>

                    <div className="schedule-meta">
                      <span>
                        {t('schedules.next')}:{' '}
                        <strong className="mono">
                          {formatDateTime(rule.nextRunAt, lang)}
                        </strong>
                      </span>
                      <span className="dim">
                        {selectorSummary(rule, t)}
                      </span>
                    </div>

                    <div className="schedule-meta">
                      <span>
                        {t('schedules.last')}:{' '}
                        {rule.lastRun ? (
                          <>
                            <span className="badge">
                              {t(SCHEDULE_STATUS_LABEL[rule.lastRun.status] ?? 'schedules.status.pending')}
                            </span>{' '}
                            <span className="mono">
                              {formatBytes(rule.lastRun.bytes)} ·{' '}
                              {formatDateTime(
                                rule.lastRun.startedAt ?? rule.lastRun.plannedAt,
                                lang,
                              )}
                            </span>
                          </>
                        ) : (
                          <span className="dim">{t('schedules.never')}</span>
                        )}
                      </span>
                    </div>

                    <div className="schedule-actions">
                      <button
                        type="button"
                        className="ghost"
                        disabled={creating}
                        onClick={() => startEdit(rule)}
                      >
                        {t('schedules.edit')}
                      </button>

                      <button
                        type="button"
                        className="ghost"
                        disabled={previewing !== null}
                        onClick={() => void previewRule(rule.id)}
                      >
                        {previewing === rule.id
                          ? t('common.loading')
                          : t('schedules.preview')}
                      </button>

                      {confirmRun === rule.id ? (
                        <>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => setConfirmRun(null)}
                          >
                            {t('schedules.cancel')}
                          </button>
                          <button
                            type="button"
                            className="primary"
                            disabled={runningId !== null}
                            onClick={() => void runRule(rule.id)}
                          >
                            {runningId === rule.id
                              ? t('schedules.running')
                              : t('schedules.confirmRun')}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setConfirmRun(rule.id)}
                        >
                          {t('schedules.run')}
                        </button>
                      )}

                      {confirmDelete === rule.id ? (
                        <>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => setConfirmDelete(null)}
                          >
                            {t('schedules.cancel')}
                          </button>
                          <button
                            type="button"
                            className="danger-button"
                            onClick={() => void deleteRule(rule.id)}
                          >
                            {t('schedules.confirmDelete')}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setConfirmDelete(rule.id)}
                        >
                          {t('schedules.delete')}
                        </button>
                      )}
                    </div>

                    <div className="schedule-toggle-row">
                      {toggleId === rule.id ? (
                        <div className="schedule-toggle">
                          {!rule.enabled && (
                            <input
                              className="control mono"
                              value={togglePhrase}
                              onChange={(e) => setTogglePhrase(e.target.value)}
                              placeholder={ApprovalRules.phrase('schedule')}
                              aria-label={t('schedules.phrase')}
                              autoComplete="off"
                            />
                          )}
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => {
                              setToggleId(null);
                              setTogglePhrase('');
                            }}
                          >
                            {t('schedules.cancel')}
                          </button>
                          <button
                            type="button"
                            className="primary"
                            disabled={
                              toggling ||
                              (!rule.enabled && !ApprovalRules.matches('schedule', togglePhrase))
                            }
                            onClick={() => void toggle(rule, !rule.enabled)}
                          >
                            {toggling
                              ? t('schedules.saving')
                              : rule.enabled
                                ? t('schedules.pauseConfirm')
                                : t('schedules.enableConfirm')}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => {
                            setToggleId(rule.id);
                            setTogglePhrase('');
                          }}
                        >
                          {rule.enabled ? t('schedules.pause') : t('schedules.enable')}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {preview && (
            <section className="panel">
              <h2>{tu('schedules.previewTitle')}</h2>
              <p className="dim">
                {preview.data.items.length} {t('schedules.previewItems')} ·{' '}
                {t('schedules.previewTotal')}:{' '}
                <strong className="mono">{formatBytes(preview.data.totalBytes)}</strong> ·{' '}
                {preview.data.mode === 'vault' ? t('plan.mode.vault') : preview.data.mode}
              </p>
              <ul className="detail-list">
                {preview.data.items.map((item) => (
                  <li key={item.key}>
                    <span className="mono">{item.title}</span>
                    <span className="dim">
                      {formatBytes(item.bytes)} · {t(CATEGORY_LABEL[item.category] ?? 'category.unknown')} ·{' '}
                      {t(RISK_LABEL[item.risk] ?? 'risk.safe')}
                    </span>
                  </li>
                ))}
              </ul>
              {preview.data.skipped.length > 0 && (
                <p className="dim">
                  {t('schedules.previewSkipped')}: {preview.data.skipped.length}
                </p>
              )}
            </section>
          )}

          {runResult && (
            <section className="panel">
              <h2>
                {runResult.status === 'done'
                  ? tu('schedules.runDone')
                  : tu('schedules.runFailed')}
              </h2>
              <p className="dim">
                <span className="badge">
                  {t(SCHEDULE_STATUS_LABEL[runResult.status] ?? 'schedules.status.failed')}
                </span>{' '}
                {runResult.itemCount} {t('schedules.previewItems')} ·{' '}
                <span className="mono">{formatBytes(runResult.bytes)}</span>
                {runResult.error ? ` · ${runResult.error}` : ''}
              </p>
            </section>
          )}

          <section className="panel">
            <h2>{tu('schedules.history')}</h2>
            {history.length === 0 ? (
              <p className="dim">{t('schedules.historyEmpty')}</p>
            ) : (
              <ul className="detail-list">
                {history.slice(0, 30).map((run) => (
                  <li key={run.id}>
                    <span className="mono">
                      {formatDateTime(run.startedAt ?? run.plannedAt, lang)}
                    </span>
                    <span className="dim">
                      {t(SCHEDULE_STATUS_LABEL[run.status] ?? 'schedules.status.pending')} ·{' '}
                      {run.itemCount} {t('schedules.previewItems')} ·{' '}
                      {formatBytes(run.bytes)}
                      {run.error ? ` · ${run.error}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
