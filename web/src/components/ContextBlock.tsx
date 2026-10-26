import type { MetaResponse, ScanStatusResponse } from '../../../src/core/contract.ts';
import { translate, translateUpper, type Lang, type MessageKey } from '../i18n.ts';
import { formatAge, formatCount, formatDuration, formatTimestamp } from '../format.ts';
import { SCAN_STATUS_LABEL } from '../labels.ts';

/**
 * BAGLAM MODULU — uygulama kapsami + tarama durumu.
 *
 * Bu bolum OGE kaniti degildir; neyi NEREDEN taradigimizi ve son taramanin
 * ne zaman/durumda oldugunu anlatir. `context` modulu olarak bagimsiz sekmede
 * (Plan, kayit/ayar ekranlari, Genel Bakis, Disk) ya da `context` sekmesi
 * olmayan ekranlarda Kanitlar modulunun footer'i olarak gorunur.
 *
 * Bilesende karar/hesap YOKTUR — tarama durumu motordan (`view`), metinler
 * i18n'den gelir (kural 18).
 */
export function ContextBlock({
  meta,
  status,
  lang,
  titleKey = 'rightPanel.context',
  headingLevel = 'h2',
}: {
  meta: MetaResponse | null;
  /** Tarama durumu (motor gorunumu); yoksa tarama bolumu basilmaz. */
  status?: ScanStatusResponse | null;
  lang: Lang;
  /** Bolum basligi; varsayilan "Bağlam". */
  titleKey?: MessageKey;
  /** Footer'da ust baslik kullanilmaz (ekran okuyucu icin h3 gerekmez). */
  headingLevel?: 'h2' | 'h3';
}) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);
  const tu = (key: MessageKey) => translateUpper(lang, key);
  const Heading = headingLevel;
  // Footer yerlesiminde ust baslik h3'tur; bolum basliklari bir kademe iner
  // (h3 altinda h3 baslik hiyerarsisini bozar).
  const Section = headingLevel === 'h3' ? 'h4' : 'h3';

  return (
    <section className="rp-context" aria-label={t(titleKey)}>
      <Heading>{tu(titleKey)}</Heading>

      {status && (
        <div className="rp-context-inner">
          <Section>{tu('context.scan')}</Section>
          <dl className="meta-list">
            <dt>{t('context.scanState')}</dt>
            <dd className={`mono scan-state-${status.view.kind}`}>
              {t(SCAN_STATUS_LABEL[status.view.kind])}
            </dd>
            <dt>{t('context.lastScan')}</dt>
            <dd className="mono">
              {status.lastScanAt === null
                ? t('context.never')
                : formatTimestamp(status.lastScanAt, lang)}
            </dd>
            <dt>{t('context.scanAge')}</dt>
            <dd className="mono">{formatAge(status.ageMs, lang)}</dd>
            <dt>{t('context.ttl')}</dt>
            <dd className="mono">{formatDuration(status.ttlMs, lang)}</dd>
            <dt>{t('context.clusters')}</dt>
            <dd className="mono">
              {status.clusters === null ? '—' : formatCount(status.clusters, lang)}
            </dd>
          </dl>
        </div>
      )}

      <div className="rp-context-inner">
        <Section>{tu('safety.title')}</Section>
        <p className="dim">{t('safety.body')}</p>
        {meta && (
          <>
            <Section>{tu('context.meta')}</Section>
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
              {meta.version && (
                <>
                  <dt>{t('context.version')}</dt>
                  <dd className="mono">v{meta.version}</dd>
                </>
              )}
            </dl>
          </>
        )}
      </div>
    </section>
  );
}
