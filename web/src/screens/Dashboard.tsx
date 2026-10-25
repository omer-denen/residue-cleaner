import { Fragment, useState } from 'react';
import type {
  DashboardCardId,
  DashboardDetailId,
  DashboardDetailRow,
  DashboardLedgerId,
  DashboardResponse,
} from '../../../src/core/contract.ts';
import { translate, translateUpper, type Lang, type MessageKey } from '../i18n.ts';
import {
  formatAge,
  formatBytes,
  formatCount,
  formatScanRow,
  formatTimestamp,
} from '../format.ts';
import { RightPanelPortal, useRightPanel } from '../components/RightPanel.tsx';
import {
  CARD_TITLE_LABEL,
  CATEGORY_LABEL,
  CONFIDENCE_LABEL,
  DETAIL_TEXT_LABEL,
  DETAIL_TITLE_LABEL,
  REGEN_LABEL,
  SCAN_REASON_LABEL,
  SCAN_ROW_LABEL,
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
 * GENEL BAKIS — yalnizca GOSTERIR.
 *
 * Tum sayilar, kartlar ve "guvenli kazanim" listesi `/api/dashboard`
 * yanitindan gelir. Bu bilesende filtre/siralama/hesap YOKTUR.
 */
export function Dashboard({
  data,
  lang,
}: {
  data: DashboardResponse;
  lang: Lang;
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
  const panel = useRightPanel();

  const verdicts: MessageKey[] = [
    'verdict.recommend',
    'verdict.ask',
    'verdict.report-only',
    'verdict.keep',
  ];

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
        </div>
      </header>

      <section className="panel" aria-labelledby="dash-measure-title">
        <h2 id="dash-measure-title">{tu('dash.measure.title')}</h2>
        <div className="measure-primary">
          <strong className="mono">{formatBytes(data.totals.deletableBytes)}</strong>{' '}
          <span className="dim">{t('dash.measure.deletable')}</span>
        </div>
        <div className="measure-secondary dim">
          {t('dash.measure.scanned', { bytes: formatBytes(data.totals.scannedBytes) })}
        </div>
      </section>

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
              <span className="ledger-count">{formatCount(ledger.count, lang)} {t('ledger.items')}</span>
            ) : null}
            <span className="ledger-note dim">
              {t(ledger.known ? LEDGER_NOTE[ledger.id] : 'ledger.cli.note.empty')}
            </span>
          </button>
        ))}
      </section>

      {data.scan.state === 'never' && (
        <div className="banner">
          <strong>{t('dash.noScan')}</strong> {t('dash.noScanHint')} <code>residue scan</code>
        </div>
      )}

      {data.cards.length > 0 && (
        <section className="cards" aria-label={t('dash.cards')}>
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
        </section>
      )}

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

      <section className="panel">
          <h2>{tu('dash.safeWins')}</h2>
          <p className="panel-note dim">{t('dash.safeWins.why')}</p>
          {data.safeWins.length === 0 ? (
            <p className="dim">{t('dash.safeWins.empty')}</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{tu('table.cluster')}</th>
                  <th>{tu('table.category')}</th>
                  <th className="num">{t('table.size')}</th>
                  <th>{tu('table.why')}</th>
                </tr>
              </thead>
              <tbody>
                {data.safeWins.map((win) => (
                  <tr key={win.clusterKey}>
                    <td>
                      <div>{win.title}</div>
                      <div className="mono dim">{win.clusterKey}</div>
                    </td>
                    <td>{t(CATEGORY_LABEL[win.category] ?? 'category.unknown')}</td>
                    <td className="num mono">{formatBytes(win.bytes)}</td>
                    <td className="dim">
                      {t(REGEN_LABEL[win.regenerability] ?? 'reason.unknown')} ·{' '}
                      {t(CONFIDENCE_LABEL[win.confidence] ?? 'confidence.low')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

      <section className="panel verdicts">
        <h2>{tu('dash.verdicts')}</h2>
        <div className="verdict-grid">
          {verdicts.map((key) => {
            const id = key.replace('verdict.', '') as keyof typeof data.totals.verdicts;
            return (
              <div key={key} className="verdict">
                <strong className="mono">{data.totals.verdicts[id] ?? 0}</strong>
                <span className="dim">{t(key)}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
