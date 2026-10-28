import { Fragment, useEffect, useState } from 'react';
import type {
  DashboardCardId,
  DashboardDetailId,
  DashboardDetailRow,
  DashboardLedgerId,
  BackgroundViewResponse,
  DashboardResponse,
} from '../../../src/core/contract.ts';
import { translate, translateUpper, type Lang, type MessageKey } from '../i18n.ts';
import { api } from '../api.ts';
import {
  formatAge,
  formatBytes,
  formatCount,
  formatRatio,
  formatScanRow,
  formatTimestamp,
} from '../format.ts';
import { RightPanelPortal, useRightPanel } from '../components/RightPanel.tsx';
import { PanelSummary } from '../components/PanelSummary.tsx';
import { ScanStamp } from '../components/ScanStamp.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { Icon } from '../components/icons.tsx';
import {
  CARD_TITLE_LABEL,
  CATEGORY_LABEL,
  CONFIDENCE_LABEL,
  DETAIL_TEXT_LABEL,
  DETAIL_TITLE_LABEL,
  REGEN_LABEL,
  SCAN_REASON_LABEL,
  SCAN_ROW_LABEL,
  SCAN_STATUS_LABEL,
  VERDICT_LABEL,
} from '../labels.ts';

const LEDGER_LABEL: Record<DashboardLedgerId, MessageKey> = {
  protected: 'ledger.protected',
  reclaimable: 'ledger.reclaimable',
  vault: 'ledger.vault',
  cli: 'ledger.cli',
};

const LEDGER_NOTE: Record<DashboardLedgerId, MessageKey> = {
  protected: 'ledger.protected.note',
  reclaimable: 'ledger.reclaimable.note',
  vault: 'ledger.vault.note',
  cli: 'ledger.cli.note',
};

const CARD_LABEL: Record<DashboardCardId, MessageKey> = {
  'scan-missing': 'card.scan-missing',
  'scan-stale': 'card.scan-stale',
  'scan-dirty': 'card.scan-dirty',
  'path-issues': 'card.path-issues',
  'orphan-vars': 'card.orphan-vars',
  'broken-installs': 'card.broken-installs',
  'broken-dependencies': 'card.broken-dependencies',
  'shadowed-commands': 'card.shadowed-commands',
  interrupted: 'card.interrupted',
  'vault-expired': 'card.vault-expired',
  'schedule-missed': 'card.schedule-missed',
  'schedule-due': 'card.schedule-due',
};

/** Kart hedefi kimligi -> gorunen etiket (buyuk harf dil bilincli). */
const CARD_TARGET: Record<string, MessageKey> = {
  disk: 'target.disk',
  tools: 'target.tools',
  graph: 'target.graph',
  env: 'target.env',
  recover: 'target.recover',
  vault: 'target.vault',
  schedules: 'target.schedules',
};

/**
 * Karar dagilimi: SIRA motorun `totals.verdicts` anahtarlaridir; sayilar
 * dogrudan motordan gelir. Cubuk yalniz GORSEL (aria-hidden); degerler
 * yalnizca lejant satirlarindan okunur.
 */
const VERDICT_ROWS: Array<{
  id: keyof DashboardResponse['totals']['verdicts'];
  label: MessageKey;
}> = [
  { id: 'recommend', label: 'verdict.recommend' },
  { id: 'ask', label: 'verdict.ask' },
  { id: 'report-only', label: 'verdict.report-only' },
  { id: 'keep', label: 'verdict.keep' },
];

/**
 * GENEL BAKIS — yalnizca GOSTERIR.
 *
 * Tum sayilar, kartlar ve "guvenli kazanim" listesi `/api/dashboard`
 * yanitindan gelir. Bu bilesende filtre/siralama/hesap YOKTUR.
 *
 * Faz 1 yerlesimi: sayfa basligi -> kahraman panel (geri kazanilabilir alan
 * + karar dagilimi) -> defterler -> dikkat kartlari -> guvenli kazanimlar.
 * Eski "Kararlar" paneli kahramana tasindi (UX-PLAN P8).
 */
export function Dashboard({
  data,
  lang,
  onOpenDisk,
  onPlanWin,
}: {
  data: DashboardResponse;
  lang: Lang;
  onOpenDisk: () => void;
  onPlanWin?: (clusterKey: string) => void;
}) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);

  // Etiket/basliklar: dil bilincli buyuk harf (TR: i -> İ).
  const tu = (key: MessageKey, vars?: Record<string, string | number>) =>
    translateUpper(lang, key, vars);

  /**
   * Secili DEFTER karti (Korunan / Geri kazanilabilir / Kasa / Araclarda).
   * Risk kartlari artik tiklanmaz; icerikleri alt listede acilir.
   */
  const [selectedId, setSelectedId] = useState<DashboardDetailId | null>(null);
  const [activity, setActivity] = useState<BackgroundViewResponse | null>(null);
  useEffect(() => {
    let alive = true;
    const load = (): void => {
      api
        .activity()
        .then((next) => {
          if (alive) setActivity(next);
        })
        .catch(() => {
          // Arka plan satiri salt bilgi: okunamazsa gosterilmez.
        });
    };
    load();
    // Sahne disinda suren is de gorunsun diye hafif tazeleme (5 sn).
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  const panel = useRightPanel();

  const detail = selectedId
    ? (data.details.find((d) => d.id === selectedId) ?? null)
    : null;

  /** Sabit metin kimliklerini TR/EN'e cevirir; kullanici verisi aynen kalir. */
  const rowLabel = (row: DashboardDetailRow): string => {
    const key = row.labelId ? DETAIL_TEXT_LABEL[row.labelId] : null;
    return key ? t(key) : row.label;
  };
  const rowValue = (row: DashboardDetailRow): string => {
    if (row.valueId) {
      const key = DETAIL_TEXT_LABEL[row.valueId];
      if (key) return t(key, { count: row.amount ?? 0 });
    }
    if (row.valueKind === 'bytes') return formatBytes(row.amount ?? 0);
    if (row.valueKind === 'count') return formatCount(row.amount ?? 0, lang);
    return row.value;
  };

  const verdictTotal = VERDICT_ROWS.reduce(
    (sum, row) => sum + (data.totals.verdicts[row.id] ?? 0),
    0,
  );

  return (
    <div className="dashboard">
      <header className="page-head">
        <div>
          <h1>{t('dash.title')}</h1>
          <p className="dim">{t('dash.subtitle')}</p>
          <p className="dim last-vault">
            {data.lastVaultAt !== null
              ? t('dash.lastVault', { when: formatTimestamp(data.lastVaultAt, lang) })
              : t('dash.lastVault.none')}
          </p>
          {activity && (
            <p className="dim">
              {t('dash.background.line', {
                busy: t(`background.busy.${activity.busy ?? 'none'}` as MessageKey),
              })}
            </p>
          )}
        </div>
        <div className="page-actions">
          <ScanStamp at={data.scan.at} ageMs={data.scan.ageMs} lang={lang} />
          <button type="button" className="ghost dash-cta" onClick={onOpenDisk}>
            <Icon name="disk" size={14} />
            <span>{t('dash.openDisk')}</span>
            <Icon name="arrowRight" size={13} />
          </button>
        </div>
      </header>

      {data.scan.state === 'never' ? (
        <EmptyState
          variant="wide"
          icon="disk"
          title={t('dash.noScan.title')}
          body={t('dash.noScan.body')}
          steps={[t('dash.step.scan'), t('dash.step.review'), t('dash.step.approve')]}
          action={
            <button type="button" className="primary" onClick={onOpenDisk}>
              {t('dash.openDisk')}
            </button>
          }
        />
      ) : (
        <section className="dash-hero" aria-labelledby="dash-hero-title">
          <div className="dash-hero-main">
            <h2 id="dash-hero-title" className="dash-hero-label">
              {t('ledger.reclaimable')}
            </h2>
            <strong className="dash-hero-value mono">
              {formatBytes(data.totals.deletableBytes)}
            </strong>
            {data.ratio?.used.known && data.ratio?.reclaimable.known && (
              <span className="dash-hero-share dim">
                {t('dash.hero.share', {
                  used: formatBytes(data.ratio.used.numerator ?? 0),
                  share: formatRatio(data.ratio.reclaimable.ratio ?? 0, lang),
                })}
              </span>
            )}
            <div className="dash-hero-meta">
              <span className="dim">
                {data.ratio?.scanned.known
                  ? t('dash.measure.scannedRatio', {
                      bytes: formatBytes(data.totals.scannedBytes),
                      used: formatBytes(data.ratio.scanned.denominator ?? 0),
                    })
                  : t('dash.measure.scanned', {
                      bytes: formatBytes(data.totals.scannedBytes),
                    })}
              </span>
              <span className={`dash-hero-scan scan-${data.scan.view.kind}`}>
                {t(SCAN_STATUS_LABEL[data.scan.view.kind])}
              </span>
            </div>
          </div>

          <div className="dash-verdicts">
            <div className="dash-verdicts-head">
              <h3>{tu('dash.verdicts.distribution')}</h3>
              {verdictTotal > 0 && (
                <span className="mono dim">{formatCount(verdictTotal, lang)}</span>
              )}
            </div>
            {verdictTotal === 0 ? (
              <p className="dim dash-verdicts-empty">{t('dash.verdicts.empty')}</p>
            ) : (
              <>
                <div className="verdict-bar" aria-hidden="true">
                  {VERDICT_ROWS.map((row) => {
                    const count = data.totals.verdicts[row.id] ?? 0;
                    if (count === 0) return null;
                    return (
                      <span
                        key={row.id}
                        className={`verdict-seg verdict-seg-${row.id}`}
                        style={{ flexGrow: count }}
                      />
                    );
                  })}
                </div>
                <ul className="verdict-legend">
                  {VERDICT_ROWS.map((row) => (
                    <li key={row.id}>
                      <span
                        className={`verdict-dot verdict-dot-${row.id}`}
                        aria-hidden="true"
                      />
                      <span className="verdict-legend-label">{t(row.label)}</span>
                      <strong className="mono">
                        {formatCount(data.totals.verdicts[row.id] ?? 0, lang)}
                      </strong>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>
      )}

      <section className="ledgers" aria-label={t('dash.ledgers')}>
        {data.ledgers.map((ledger) => (
          <button
            key={ledger.id}
            type="button"
            className={`ledger ledger-${ledger.id}${selectedId === ledger.detailId ? ' active' : ''}`}
            aria-pressed={selectedId === ledger.detailId}
            onClick={() => {
              setSelectedId((prev) =>
                prev === ledger.detailId ? null : ledger.detailId,
              );
              panel?.activate('evidence');
            }}
          >
            <span className="ledger-label">{t(LEDGER_LABEL[ledger.id])}</span>
            <strong className={`ledger-value${ledger.known ? '' : ' unknown'}`}>
              {ledger.known ? formatBytes(ledger.bytes) : t('ledger.unknown')}
            </strong>
            {ledger.id === 'vault' && ledger.count ? (
              <span className="ledger-count">
                {formatCount(ledger.count, lang)} {t('ledger.items')}
              </span>
            ) : null}
            <span className="ledger-note dim">
              {t(ledger.known ? LEDGER_NOTE[ledger.id] : 'ledger.cli.note.empty')}
            </span>
          </button>
        ))}
      </section>

      {data.cards.length > 0 && (
        <section className="dash-attention" aria-labelledby="dash-attention-title">
          <div className="section-head">
            <h2 id="dash-attention-title">{tu('dash.attention')}</h2>
            <span className="mono dim">{formatCount(data.cards.length, lang)}</span>
          </div>
          <div className="cards">
            {data.cards.map((card) => (
              <article key={card.id} className={`card card-${card.tone}`}>
                <span className="card-title">{t(CARD_TITLE_LABEL[card.titleId])}</span>
                {card.target && (
                  <span className="card-target">{tu(CARD_TARGET[card.target])}</span>
                )}
                <span className="card-summary">
                  {card.count !== null && (
                    <strong className="card-count">{card.count}</strong>
                  )}
                  <span className="card-state">{t(CARD_LABEL[card.stateId])}</span>
                </span>
                {card.meta?.at != null && (
                  <span className="card-meta">
                    <span>{formatTimestamp(card.meta.at, lang)}</span>
                    {card.meta.ageMs !== null && (
                      <span>{formatAge(card.meta.ageMs, lang)}</span>
                    )}
                  </span>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Kanitlar modulu: secim YOKKEN ekranin birincil verisi basilir (P2);
          boylece panel "bir sey secin" bosluguna dusmez. */}
      <RightPanelPortal when={detail === null}>
        <PanelSummary
          lang={lang}
          title="rightPanel.summary.dashboard.title"
          body="rightPanel.summary.dashboard.body"
          note="rightPanel.summary.note"
          action={{ label: 'dash.openDisk', onClick: onOpenDisk }}
          stats={[
            {
              label: 'rightPanel.stat.clusters',
              value: formatCount(data.totals.clusters, lang),
            },
            {
              label: 'rightPanel.stat.files',
              value: formatCount(data.totals.files, lang),
            },
            {
              label: 'rightPanel.stat.scanned',
              value: formatBytes(data.totals.scannedBytes),
            },
            {
              label: 'rightPanel.stat.reclaimable',
              value: formatBytes(data.totals.deletableBytes),
              tone: 'ok',
            },
            {
              label: VERDICT_LABEL['recommend'] ?? 'verdict.recommend',
              value: formatCount(data.totals.verdicts.recommend, lang),
            },
            {
              label: VERDICT_LABEL['ask'] ?? 'verdict.ask',
              value: formatCount(data.totals.verdicts.ask, lang),
            },
            {
              label: VERDICT_LABEL['report-only'] ?? 'verdict.report-only',
              value: formatCount(data.totals.verdicts['report-only'], lang),
            },
            {
              label: VERDICT_LABEL['keep'] ?? 'verdict.keep',
              value: formatCount(data.totals.verdicts.keep, lang),
            },
          ]}
        />
      </RightPanelPortal>

      <RightPanelPortal>
        {detail && (
          <section className="panel" aria-label={t(DETAIL_TITLE_LABEL[detail.id])}>
            <h2>{tu(DETAIL_TITLE_LABEL[detail.id])}</h2>
            <button
              type="button"
              className="ghost detail-back"
              onClick={() => setSelectedId(null)}
            >
              {t('detail.back')}
            </button>
            {detail.noteId ? (
              <p className="dim">{t(DETAIL_TEXT_LABEL[detail.noteId])}</p>
            ) : detail.kind === 'scan' ? (
              <>
                <ul className="scan-reasons">
                  {data.scan.view.reasons.map((reason) => (
                    <li key={reason}>{t(SCAN_REASON_LABEL[reason])}</li>
                  ))}
                </ul>
                <dl className="meta-list">
                  {data.scan.view.rows.map((row) => (
                    <Fragment key={row.id}>
                      <dt>{t(SCAN_ROW_LABEL[row.id])}</dt>
                      <dd className="mono">{formatScanRow(row, lang)}</dd>
                    </Fragment>
                  ))}
                </dl>
              </>
            ) : detail.rows.length === 0 ? (
              <p className="dim">{t('detail.empty')}</p>
            ) : (
              <table className="table">
                <tbody>
                  {detail.rows.map((row, i) => (
                    <tr key={`${row.label}-${i}`}>
                      <td className="mono">{rowLabel(row)}</td>
                      <td
                        className={
                          row.tone === 'danger'
                            ? 'danger-text'
                            : row.tone === 'warn'
                              ? 'warn-text'
                              : 'dim'
                        }
                      >
                        {rowValue(row)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </RightPanelPortal>

      <section className="panel dash-safewins" aria-labelledby="dash-safewins-title">
        <div className="section-head">
          <h2 id="dash-safewins-title">{tu('dash.safeWins')}</h2>
        </div>
        <p className="panel-note dim">{t('dash.safeWins.why')}</p>
        {data.safeWins.length === 0 ? (
          <div className="dash-inline-empty">
            <strong>{t('dash.safeWins.empty')}</strong>
            <span className="dim">{t('dash.safeWins.emptyHint')}</span>
            <button type="button" className="ghost" onClick={onOpenDisk}>
              <span>{t('dash.openDisk')}</span>
              <Icon name="arrowRight" size={13} />
            </button>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{tu('table.cluster')}</th>
                <th>{tu('table.category')}</th>
                <th className="num">{t('table.size')}</th>
                <th>{tu('table.why')}</th>
                {onPlanWin && <th>{t('dashboard.plan.col')}</th>}
              </tr>
            </thead>
            <tbody>
              {data.safeWins.map((win) => (
                <tr key={win.clusterKey}>
                  <td>
                    <div>{win.title}</div>
                    <div className="mono dim">{win.clusterKey}</div>
                  </td>
                  <td>
                    <span className="badge">
                      {t(CATEGORY_LABEL[win.category] ?? 'category.unknown')}
                    </span>
                  </td>
                  <td className="num mono">{formatBytes(win.bytes)}</td>
                  <td>
                    <span className="badge badge-ok">
                      {t(REGEN_LABEL[win.regenerability] ?? 'reason.unknown')}
                    </span>{' '}
                    <span className="badge">
                      {t(CONFIDENCE_LABEL[win.confidence] ?? 'confidence.low')}
                    </span>
                  </td>
                  {onPlanWin && (
                    <td>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => onPlanWin(win.clusterKey)}
                        aria-label={`${t('dashboard.plan.row')}: ${win.title}`}
                      >
                        {t('dashboard.plan.row')}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
