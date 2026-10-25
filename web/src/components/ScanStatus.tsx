import { Fragment, useEffect, useRef } from 'react';
import type {
  ScanStatusResponse,
  ScanStatusViewResponse,
} from '../../../src/core/contract.ts';
import { translate, type Lang, type MessageKey } from '../i18n.ts';
import { formatScanRow } from '../format.ts';
import { SCAN_REASON_LABEL, SCAN_ROW_LABEL, SCAN_STATUS_LABEL } from '../labels.ts';

/**
 * TARAMA DURUMU — rozet + ayrinti raporu.
 *
 * Bu bilesen HICBIR karar vermez. Etiket, ton, neden sirasi, rapor satirlari
 * ve eylem motorun (`src/core/scan-status-view.ts`) belirledigi `view`
 * nesnesinden gelir. Burada yalnizca metne cevrilir ve basilmasi yapilir.
 */

interface ChipProps {
  view: ScanStatusViewResponse;
  lang: Lang;
  onOpen: () => void;
  className?: string;
}

/**
 * Rozet: durum etiketini gosterir ("Tarama güncel", "Disk değişti", ...).
 * Tiklanabilir; ayrinti raporunu acar.
 */
export function ScanStatusChip({ view, lang, onOpen, className }: ChipProps) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);
  const text = t(SCAN_STATUS_LABEL[view.kind]);
  // Ilerleme yalnizca tarama surerken basilir; yuzde MOTORDAN gelir.
  const progress = view.kind === 'scanning' ? view.progress : null;
  const pct = progress?.percent ?? null;

  return (
    <button
      type="button"
      className={`scan-chip scan-${view.kind}${progress ? ' has-progress' : ''}${
        className ? ` ${className}` : ''
      }`}
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`${t('a11y.scanStatus')}: ${text}${
        pct !== null ? ` · ${pct}%` : ''
      }`}
      title={
        progress?.current
          ? `${text} · ${pct ?? 0}% · ${progress.current}`
          : text
      }
    >
      <span className="scan-chip-label">{text}</span>
      {progress && (
        <span className="scan-chip-pct mono">
          {pct !== null ? `${pct}%` : t('disk.scan.preparing')}
        </span>
      )}
      {progress && (
        <span
          className={`scan-chip-bar${pct === null ? ' is-indeterminate' : ''}`}
          aria-hidden="true"
        >
          <span style={pct !== null ? { width: `${pct}%` } : undefined} />
        </span>
      )}
    </button>
  );
}

interface DialogProps {
  status: ScanStatusResponse;
  lang: Lang;
  onClose: () => void;
  onRescan: () => void;
}

/**
 * Ayrinti raporu: "bu rozet ne demek, nerede, ne zaman, ne yapmaliyim".
 *
 * Odak tuzagi vardir; Esc kapatir; kapaninca odak acan dugmeye doner.
 */
export function ScanStatusDialog({ status, lang, onClose, onRescan }: DialogProps) {
  const t = (key: MessageKey) => translate(lang, key);
  const view = status.view;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  // `onClose` her App render'inda yeni bir arrow olabilir; efektin yeniden
  // calisip odagi kapat dugmesine cekmemesi icin guncel referansi tut.
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => !el.hasAttribute('disabled'));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialogRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      openerRef.current?.focus?.();
    };
  }, []);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="scan-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-status-title"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="scan-dialog-head">
          <h2 id="scan-status-title">{t('scan.report.title')}</h2>
          <button type="button" className="ghost" ref={closeRef} onClick={onClose}>
            {t('common.close')}
          </button>
        </div>

        <section className="scan-dialog-section">
          <h3>{t('scan.report.reasons')}</h3>
          <ul className="scan-reasons">
            {view.reasons.map((reason) => (
              <li key={reason}>{t(SCAN_REASON_LABEL[reason])}</li>
            ))}
          </ul>
        </section>

        <section className="scan-dialog-section">
          <h3>{t('scan.report.details')}</h3>
          <dl className="meta-list">
            {view.rows.map((row) => (
              <Fragment key={row.id}>
                <dt>{t(SCAN_ROW_LABEL[row.id])}</dt>
                <dd className="mono">{formatScanRow(row, lang)}</dd>
              </Fragment>
            ))}
          </dl>
        </section>

        {view.action === 'scan' && (
          <div className="scan-dialog-actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                onClose();
                onRescan();
              }}
            >
              {t('scan.report.rescan')}
            </button>
            <span className="dim">{t('scan.report.rescanHint')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
