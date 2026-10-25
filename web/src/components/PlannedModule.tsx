import { useEffect, useRef, useState } from 'react';
import type {
  PlanPanelGroup,
  PlanResponse,
} from '../../../src/core/contract.ts';
import { formatBytes } from '../format.ts';
import { translate, translateUpper, type Lang, type MessageKey } from '../i18n.ts';
import { RISK_LABEL } from '../labels.ts';
import { EmptyState } from './EmptyState.tsx';
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
 * taslagi ONCE sunucuda `POST /api/plan/apply` ile arming eder (10 dk sure
 * o anda baslar), sonra Plan ekranina gecirir; `execute` cagrilmaz.
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
  compact = false,
}: {
  expiresAt: number;
  lang: Lang;
  labelKey?: MessageKey;
  compact?: boolean;
}) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);
  const now = useNow(expiresAt);
  // Taslak secim: sure YOK; geri sayim yerine tek satir aciklama.
  if (expiresAt <= 0) {
    return (
      <span
        className={`rp-validity rp-validity-draft${compact ? ' rp-validity-compact' : ''}`}
      >
        {t('rightPanel.planned.validityDraft')}
      </span>
    );
  }
  const left = formatTtl(expiresAt, now);
  const until = new Date(expiresAt).toLocaleTimeString(
    lang === 'tr' ? 'tr-TR' : 'en-US',
    { hour: '2-digit', minute: '2-digit' },
  );
  if (compact) {
    return (
      <span className="rp-validity rp-validity-compact" title={t('rightPanel.planned.validityHint')}>
        <span className="rp-ttl" aria-live="off" aria-hidden="true">
          {t('rightPanel.planned.validityLeft', { time: left })}
        </span>
      </span>
    );
  }
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

export function PlannedModule({
  plan,
  lang,
  busy,
  error,
  expired,
  onDismissExpired,
  onClearAll,
  onApply,
  onOpenTools,
  onOpenDisk,
}: {
  plan: PlanResponse | null;
  lang: Lang;
  busy: boolean;
  error: string | null;
  /** Plan suresi doldu (ya da 410): sessiz kaybolma YOK; uyarida kapanabilir. */
  expired: boolean;
  onDismissExpired: () => void;
  /** "Tümünü boşalt": secimi/plani temizler (saving degildir). */
  onClearAll: () => void;
  /** "Planı uygula": taslaksa sureyi baslatir (armed), sonra Plan ekrani. */
  onApply: () => void;
  onOpenTools: () => void;
  onOpenDisk: () => void;
}) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);
  const tu = (key: MessageKey) => translateUpper(lang, key);

  const hasPlan = plan !== null && plan.panel.keys.length > 0;

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
        <EmptyState
          icon="plan"
          tone="ok"
          title={t('rightPanel.planned.emptyTitle')}
          body={t('rightPanel.planned.emptyBody')}
          action={
            <button
              type="button"
              className="ghost empty-cta"
              onClick={onOpenDisk}
            >
              <span>{t('rightPanel.empty.cta')}</span>
              <Icon name="arrowRight" size={13} />
            </button>
          }
        />
      ) : (
        <>
          {/* Üst blok: aksiyon + özet/geçerlilik (sticky). */}
          <div className="rp-plan-head">
            <div className="rp-plan-actions">
              <button
                type="button"
                className="primary"
                disabled={!hasPlan || busy}
                title={hasPlan ? undefined : t('rightPanel.planned.applyHint')}
                onClick={onApply}
              >
                {t('rightPanel.planned.apply')}
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
    </section>
  );
}
