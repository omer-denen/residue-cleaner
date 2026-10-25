import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons.tsx';

/**
 * BOS DURUM — tek desen, uc boyut.
 *
 * "Kayit yok" cumlesi yerine **ne oldugunu ve sonraki adimi** anlatir
 * (eylem odakli bos durum). Metinler i18n'den gelir; burada karar YOKTUR
 * (AGENTS.md kural 18).
 *
 *  - `panel` (varsayilan): sag panel / kart icinde kucuk baslik (h3).
 *  - `wide`: sayfa govdesinde genis blok (h2, 720px okuma genisligi).
 *  - `fill`: liste alanini dolduran ortalanmis blok (or. Disk listesi).
 */
export function EmptyState({
  icon,
  title,
  body,
  steps,
  action,
  variant = 'panel',
  tone = 'info',
}: {
  icon: IconName;
  title: string;
  body?: string;
  /** Sirali "boyle yapilir" adimlari (en fazla 3 onerilir). */
  steps?: string[];
  /** Tek eylem dugmesi ya da dugme grubu. */
  action?: ReactNode;
  variant?: 'panel' | 'wide' | 'fill';
  tone?: 'info' | 'ok' | 'warn';
}) {
  const Heading = variant === 'panel' ? 'h3' : 'h2';
  return (
    <div className={`empty-state${variant !== 'panel' ? ` ${variant}` : ''} tone-${tone}`}>
      <span className="empty-icon" aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <Heading>{title}</Heading>
      {body && <p>{body}</p>}
      {steps && steps.length > 0 && (
        <ol className="empty-steps">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}
