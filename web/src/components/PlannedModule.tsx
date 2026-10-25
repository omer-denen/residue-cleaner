import { useEffect, useRef, useState } from 'react';
import type {
  PlanPanelGroup,
  PlanResponse,
} from '../../../src/core/contract.ts';
import { formatBytes } from '../format.ts';
import { translate, translateUpper, type Lang, type MessageKey } from '../i18n.ts';
import { RISK_LABEL } from '../labels.ts';
import { Icon } from './icons.tsx';

/**
 * SAG PANEL "PLAN DURUMU" — yalnizca GOSTERIR + plan uzerine islemler.
 *
 * Gruplama, siralama, sayaclar ve ad motorda kurulur (`plan.panel`,
 * PlanResponse.name); burada hesap YOKTUR (kural 18). Islemler tek ucluler:
 *  - ekleme: `POST /api/plan/add` (kimlik + TTL korunur)
 *  - cikarma: `POST /api/plan/remove` (istemci YOL gondermez)
 *  - (W2-d) ad degistirme kaldirildi: plan 10 dk yasar; adi saklamak
 *    anlamsiz. `PATCH /api/plan/:id` sunucuda ileride icin kalir.
 * Onay/kelime dogrulama burada YOKTUR; Plan ekraninda kalir. "Planı uygula"
 * yalnizca Plan ekranina yonlendirir; `POST /api/execute` cagrilmaz.
 */

/** TTL sayaci: yalnizca GOSTERIM (gecerlilik karari sunucudadir). */
function formatTtl(expiresAt: number, now: number): string {
  const total = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** Saniyede bir akan saat (yalnizca plan kimligi degistiginde kurulus). */
function useNow(expiresAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (expiresAt <= 0) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  return now;
}

/**
 * Geçerlilik satiri: `Geçerlilik: kalan 09:58 · 14:54'e kadar`.
 * Sure yalnizca Date.now() farkindan akar (sunucudan istek YOK); mutlak
 * saat expiresAt'ten biçimlendirilir (kural 18: hesap motordan, burada
 * yalnizca bicimlendirme var). Sayac aria-live KAPALI — her saniye ekran
 * okuyucuyu mesgul etmesin.
 */
export function PlanValidity({
  expiresAt,
  lang,
  labelKey = 'rightPanel.planned.validity',
}: {
  expiresAt: number;
  lang: Lang;
  labelKey?: MessageKey;
}) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);
  const now = useNow(expiresAt);
  const left = formatTtl(expiresAt, now);
  const until = new Date(expiresAt).toLocaleTimeString(
    lang === 'tr' ? 'tr-TR' : 'en-US',
    { hour: '2-digit', minute: '2-digit' },
  );
  return (
    <span className="rp-validity" title={t('rightPanel.planned.validityHint')}>
      {t(labelKey)}:{' '}
      <span className="rp-ttl" aria-live="off">
        {t('rightPanel.planned.validityLeft', { time: left })}
      </span>
      <span aria-hidden="true"> · </span>
      {t('rightPanel.planned.validityUntil', { time: until })}
    </span>
  );
}

/** Tek kume grubu: katlanabilir sade (varsayilan acik). Cikarma satirda (Disk) yapilir. */
function PlannedGroup({
  group,
  lang,
  busy,
}: {
  group: PlanPanelGroup;
  lang: Lang;
  busy: boolean;
}) {
  const t = (key: MessageKey) => translate(lang, key);
  const [open, setOpen] = useState(true);

  return (
    <article className="rp-group">
      <div className="rp-group-head">
        <button
          type="button"
          className="ghost rp-group-toggle"
          aria-expanded={open}
          disabled={busy}
          onClick={() => setOpen((value) => !value)}
        >
          <span
            className={`risk-dot risk-${group.risk}`}
            role="img"
            aria-label={t(RISK_LABEL[group.risk] ?? 'risk.safe')}
          />
          <span className="rp-group-title" title={group.reason}>
            {group.title}
          </span>
          <span className="dim mono rp-group-meta">
            {group.targetCount} {t('rightPanel.planned.targets')} ·{' '}
            {formatBytes(group.bytes)}
          </span>
          <span className="rp-chevron" aria-hidden="true">
            <Icon name="chevronDown" size={12} />
          </span>
        </button>
      </div>

      {open && (
        <ul className="rp-target-list">
          {group.items.map((item) => (
            <li key={item.id} className="rp-target-row">
              <Icon name="file" size={12} />
              <span className="mono rp-target-path" title={item.path}>
                {item.path}
              </span>
              <span className="dim rp-target-label">{item.label}</span>
              <span className="mono dim rp-target-bytes">
                {formatBytes(item.bytes)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/**
 * "Yeni plan" onay diyalogu: role=dialog + aria-modal, odak tuzagi,
 * Esc = Vazgeç, kapaninca odak tetikleyiciye doner.
 */
function NewPlanDialog({
  plan,
  lang,
  onClose,
  onConfirm,
}: {
  plan: PlanResponse;
  lang: Lang;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  // Acilista odak Vazgeç'e; kapaninca App/ust bilesen tetikleyiciye geri birakir.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const buttons = [cancelRef.current, confirmRef.current].filter(
      (el): el is HTMLButtonElement => el !== null,
    );
    if (buttons.length === 0) return;
    const first = buttons[0]!;
    const last = buttons[buttons.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialogRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="scan-dialog rp-plan-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rp-newplan-title"
        ref={dialogRef}
        onKeyDown={onKey}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="scan-dialog-head">
          <h2 id="rp-newplan-title">{t('rightPanel.planned.confirmTitle')}</h2>
        </div>
        <p className="rp-plan-dialog-body">
          {t('rightPanel.planned.confirmBody', {
            count: plan.panel.clusterCount,
            bytes: formatBytes(plan.panel.totalBytes),
          })}
        </p>
        <div className="scan-dialog-actions">
          <button
            type="button"
            className="ghost"
            ref={cancelRef}
            onClick={onClose}
          >
            {t('rightPanel.planned.cancel')}
          </button>
          <button
            type="button"
            className="primary"
            ref={confirmRef}
            onClick={onConfirm}
          >
            {t('rightPanel.planned.confirmAction')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PlannedModule({
  plan,
  lang,
  busy,
  error,
  expired,
  onDismissExpired,
  onClearAll,
  onOpenPlan,
  onOpenTools,
}: {
  plan: PlanResponse | null;
  lang: Lang;
  busy: boolean;
  error: string | null;
  /** Plan suresi doldu (ya da 410): sessiz kaybolma YOK; uyarida kapanabilir. */
  expired: boolean;
  onDismissExpired: () => void;
  /** "Tümünü boşalt" ve onayli "Yeni plan" ayni isi yapar. */
  onClearAll: () => void;
  onOpenPlan: () => void;
  onOpenTools: () => void;
}) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);
  const tu = (key: MessageKey) => translateUpper(lang, key);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const newPlanRef = useRef<HTMLButtonElement | null>(null);

  // Plan kimligi degistince onay diyalogunu kapat.
  useEffect(() => {
    setConfirmOpen(false);
  }, [plan?.planId]);

  const hasPlan = plan !== null && plan.panel.keys.length > 0;

  const askNewPlan = (): void => {
    if (!hasPlan || busy) return;
    // Planda öge varken Once onay; (plan zaten bos ise dugme pasif).
    setConfirmOpen(true);
  };

  return (
    <section className="rp-planned" aria-label={tu('rightPanel.planned')}>
      {error && (
        <div className="banner danger" role="alert">
          {error}
        </div>
      )}

      {expired && (
        <div className="banner danger rp-plan-expired" role="alert">
          <span>{t('rightPanel.planned.expired')}</span>
          <button
            type="button"
            className="ghost rp-item-remove"
            aria-label={t('common.close')}
            onClick={onDismissExpired}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

      {!plan ? (
        <p className="rp-planned-empty-note dim">
          {t('rightPanel.planned.empty')}
        </p>
      ) : (
        <>
          {/* Üst blok: aksiyon + özet/geçerlilik (sticky). */}
          <div className="rp-plan-head">
            <div className="rp-plan-actions">
              <button
                type="button"
                className="primary"
                disabled={!hasPlan}
                title={hasPlan ? undefined : t('rightPanel.planned.applyHint')}
                onClick={onOpenPlan}
              >
                {t('rightPanel.planned.apply')}
              </button>
              <button
                type="button"
                className="ghost"
                disabled={!hasPlan || busy}
                ref={newPlanRef}
                onClick={askNewPlan}
              >
                {t('rightPanel.planned.new')}
              </button>
              <button
                type="button"
                className="ghost"
                disabled={!hasPlan || busy}
                onClick={onClearAll}
              >
                {t('rightPanel.planned.clearAll')}
              </button>
            </div>

            <div className="rp-planned-summary">
              <strong className="mono rp-planned-total">
                {formatBytes(plan.panel.totalBytes)}
              </strong>
              <div className="dim rp-planned-counts mono">
                <span>
                  {plan.panel.clusterCount} {t('rightPanel.planned.clusters')}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {plan.panel.targetCount} {t('rightPanel.planned.targets')}
                </span>
              </div>
              <PlanValidity expiresAt={plan.expiresAt} lang={lang} />
            </div>
          </div>

          <div className="rp-planned-groups">
            {plan.panel.groups.map((group) => (
              <PlannedGroup
                key={group.key}
                group={group}
                lang={lang}
                busy={busy}
              />
            ))}
          </div>
        </>
      )}

      {/* Araclar: disk planindan AYRI bolum; plan bos olsa da gorunur
          (orkestrator duzeltmesi: "Araclar plani yok" durumu da gorunmeli). */}
      <section
        className="rp-planned-tools"
        aria-label={tu('rightPanel.planned.tools')}
      >
        <h3>{tu('rightPanel.planned.tools')}</h3>
        <p className="dim">
          {plan ? t('rightPanel.planned.toolsHint') : t('rightPanel.planned.toolsNone')}
        </p>
        <div className="rp-plan-actions">
          <button type="button" className="ghost" onClick={onOpenTools}>
            {t('rightPanel.planned.toolsOpen')}
          </button>
        </div>
      </section>

      {confirmOpen && plan && (
        <NewPlanDialog
          plan={plan}
          lang={lang}
          onClose={() => {
            setConfirmOpen(false);
            newPlanRef.current?.focus();
          }}
          onConfirm={() => {
            setConfirmOpen(false);
            newPlanRef.current?.focus();
            onClearAll();
          }}
        />
      )}
    </section>
  );
}
