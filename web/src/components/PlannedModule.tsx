import { useEffect, useState } from 'react';
import type {
  PlanPanelGroup,
  PlanResponse,
} from '../../../src/core/contract.ts';
import { formatBytes } from '../format.ts';
import { translate, translateUpper, type Lang, type MessageKey } from '../i18n.ts';
import { RISK_LABEL } from '../labels.ts';
import { Icon } from './icons.tsx';

/**
 * SAG PANEL "PLANLANANLAR" — yalnizca GOSTERIR.
 *
 * Gruplama, siralama ve sayimlar motorda kurulur (`plan.panel`); burada
 * hesap YOKTUR (kural 18). Cikarma istekleri `POST /api/plan/remove` ucuyle
 * AYNI plan kimligi ve TTL korunarak yapilir; istemci YOL GONDERMEZ.
 * Onay/kelime dogrulama burada YOKTUR; Plan ekraninda kalir.
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

/** Tek kume grubu: katlanabilir sade (varsayilan acik) + kume cikarma. */
function PlannedGroup({
  group,
  lang,
  busy,
  onRemoveKey,
  onRemoveTarget,
}: {
  group: PlanPanelGroup;
  lang: Lang;
  busy: boolean;
  onRemoveKey: (key: string) => void;
  onRemoveTarget: (targetId: string) => void;
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
        <button
          type="button"
          className="ghost rp-item-remove"
          aria-label={`${t('rightPanel.planned.removeGroup')}: ${group.title}`}
          disabled={busy}
          onClick={() => onRemoveKey(group.key)}
        >
          <Icon name="close" size={12} />
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
              <button
                type="button"
                className="ghost rp-item-remove"
                aria-label={`${t('rightPanel.planned.removeTarget')}: ${item.path}`}
                disabled={busy}
                onClick={() => onRemoveTarget(item.id)}
              >
                <Icon name="close" size={12} />
              </button>
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
  onRemoveKey,
  onRemoveTarget,
  onOpenPlan,
}: {
  plan: PlanResponse | null;
  lang: Lang;
  busy: boolean;
  error: string | null;
  onRemoveKey: (key: string) => void;
  onRemoveTarget: (targetId: string) => void;
  onOpenPlan: () => void;
}) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);
  const tu = (key: MessageKey) => translateUpper(lang, key);

  // TTL kalan suresi: her saniye guncellenir (aria-live KAPALI — sayac
  // surekli degistigi icin ekran okuyucuyu yormasin).
  const now = useNow(plan?.expiresAt ?? 0);
  const ttl = plan ? formatTtl(plan.expiresAt, now) : '00:00';

  return (
    <section className="rp-planned" aria-label={tu('rightPanel.planned')}>
      {error && (
        <div className="banner danger" role="alert">
          {error}
        </div>
      )}

      {!plan ? (
        <div className="rp-planned-empty">
          <Icon name="plan" size={22} />
          <strong>{t('rightPanel.planned.emptyTitle')}</strong>
          <p className="dim">{t('rightPanel.planned.emptyBody')}</p>
        </div>
      ) : (
        <>
          <header className="rp-planned-summary">
            <span className="rp-planned-label">{tu('rightPanel.planned')}</span>
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
              <span aria-hidden="true">·</span>
              <span>
                {t('rightPanel.planned.ttl')}{' '}
                <span className="rp-ttl" aria-live="off">
                  {ttl}
                </span>
              </span>
            </div>
          </header>

          <div className="rp-planned-groups">
            {plan.panel.groups.map((group) => (
              <PlannedGroup
                key={group.key}
                group={group}
                lang={lang}
                busy={busy}
                onRemoveKey={onRemoveKey}
                onRemoveTarget={onRemoveTarget}
              />
            ))}
          </div>

          <footer className="rp-planned-foot">
            <button
              type="button"
              className="primary rp-planned-open"
              disabled={busy}
              onClick={onOpenPlan}
            >
              {t('rightPanel.planned.open')}
            </button>
            <span
              className="dim mono rp-plan-id"
              title={plan.planId}
              aria-label={t('rightPanel.planned.planId')}
            >
              {plan.planId.slice(0, 8)}
            </span>
            <p className="dim rp-hint">{t('rightPanel.planned.hint')}</p>
          </footer>
        </>
      )}
    </section>
  );
}
