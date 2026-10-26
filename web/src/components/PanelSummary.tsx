import { Fragment } from 'react';
import { translate, translateUpper, type Lang, type MessageKey } from '../i18n.ts';

/**
 * PANEL OZETI — "Kanitlar" modulunun secim YOKKEN gosterdigi ekran verisi.
 *
 * Neden: secim yokken panel yalnizca "bir sey secin" diyordu; ekranin birincil
 * verisi (kume sayilari, proje kesfi, arac envanteri) panelde hic gorunmuyordu
 * (kullanici geri bildirimi: "statik / bildirim paneli"). Bu bilesen o veriyi
 * kompakt bir istatistik listesi olarak basar.
 *
 * Kural 18: sayilar ve etiket KIMLIKLERI motordan (`counts`, `summary`)
 * gelir; burada hesap YOKTUR, yalnizca bicimlendirilmis deger basilir.
 */

export type PanelStatTone = 'ok' | 'warn' | 'info' | 'vault';

export interface PanelStat {
  label: MessageKey;
  /** Ekranda basilacak bicimlendirilmis deger (sayi/bayt metni). */
  value: string;
  tone?: PanelStatTone;
}

export function PanelSummary({
  title,
  body,
  stats,
  note,
  action,
  lang,
}: {
  title: MessageKey;
  body: MessageKey;
  stats: PanelStat[];
  /** Kapanis notu (or. "secim yapinca kanit acilir"). */
  note?: MessageKey;
  action?: { label: MessageKey; onClick: () => void };
  lang: Lang;
}) {
  const t = (key: MessageKey): string => translate(lang, key);
  const tu = (key: MessageKey): string => translateUpper(lang, key);

  return (
    <section className="rp-summary" aria-label={t(title)}>
      <h2>{tu(title)}</h2>
      <p className="dim">{t(body)}</p>

      {stats.length > 0 && (
        <dl className="rp-summary-stats">
          {stats.map((stat) => (
            <Fragment key={stat.label}>
              <dt>{t(stat.label)}</dt>
              <dd className={`mono${stat.tone ? ` tone-${stat.tone}` : ''}`}>
                {stat.value}
              </dd>
            </Fragment>
          ))}
        </dl>
      )}

      {note && <p className="dim rp-summary-note">{t(note)}</p>}

      {action && (
        <div className="rp-summary-action">
          <button type="button" className="ghost empty-cta" onClick={action.onClick}>
            <span>{t(action.label)}</span>
          </button>
        </div>
      )}
    </section>
  );
}
