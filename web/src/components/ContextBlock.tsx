import type { MetaResponse } from '../../../src/core/contract.ts';
import { translate, translateUpper, type Lang, type MessageKey } from '../i18n.ts';

/**
 * BAGLAM BOLUMU — uygulama kapsami bilgisi (guvenlik sozu + cwd/home).
 *
 * Bu bolum OGE kaniti degildir; neyi NEREDEN taradigimizi anlatir.
 * Kanitalar modulunun footer'i olarak gorunur; bilesende karar/hesap
 * yoktur — meta sunucudan gelir, metinler i18n'den (kural 18).
 */
export function ContextBlock({
  meta,
  lang,
  titleKey = 'rightPanel.context',
}: {
  meta: MetaResponse | null;
  lang: Lang;
  /** Bolum basligi; varsayilan "Bağlam". */
  titleKey?: MessageKey;
}) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);
  const tu = (key: MessageKey) => translateUpper(lang, key);

  return (
    <section className="rp-context" aria-label={t(titleKey)}>
      <h2>{tu(titleKey)}</h2>
      <div className="rp-context-inner">
        <h3>{tu('safety.title')}</h3>
        <p className="dim">{t('safety.body')}</p>
        {meta && (
          <dl className="meta-list">
            <dt>{t('context.ui')}</dt>
            <dd className="mono">{meta.ui ? 'web' : 'api'}</dd>
            <dt>{t('context.cwd')}</dt>
            <dd className="mono" title={meta.cwd}>
              {meta.cwd ?? '—'}
            </dd>
            <dt>{t('context.home')}</dt>
            <dd className="mono" title={meta.home}>
              {meta.home ?? '—'}
            </dd>
          </dl>
        )}
      </div>
    </section>
  );
}
