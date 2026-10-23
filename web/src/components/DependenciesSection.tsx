import { useEffect, useRef, useState } from 'react';
import type { DependenciesResponse, EdgeState } from '../../../src/core/contract.ts';
import { api } from '../api.ts';
import { translate, type Lang, type MessageKey } from '../i18n.ts';

/**
 * Kenar durumu -> sozluk anahtari. Grafik ekraninda ayni `graph.state.*`
 * anahtarlari kullanilir; yeni sozluk anahtari eklemek yerine mevcut
 * TR/EN metinleri paylasilir.
 */
const STATE_KEY: Record<EdgeState, MessageKey> = {
  intact: 'graph.state.intact',
  shadowed: 'graph.state.shadowed',
  broken: 'graph.state.broken',
  'missing-chain': 'graph.state.missing-chain',
  drifted: 'graph.state.drifted',
  cyclic: 'graph.state.cyclic',
  unknown: 'graph.state.unknown',
};

/**
 * KANIT ICINDE BAGIMLILIKLAR (W2-e2).
 *
 * Kullanici karari: bagimlilik ayri sekme DEGIL; secili ogenin
 * ayrintisidir ("bağımlılık ayrı bir vaka değil, seçili öğenin
 * ayrıntıları"). Kapali baslar; acilinca TEK istek atar, sonuc ayni
 * secimde tutulur, secim degisince sifirlanir ve bolme KAPALI kalir.
 *
 * Kural 18: eslestirme/siralama/tekillestirme MOTORDA
 * (`GET /api/dependencies`); bilesen gelen listeyi oldugu gibi gosterir.
 */
export function DependenciesSection({
  query,
  lang,
}: {
  /** Secili oge: kume birincil yolu (Disk) veya arac komutu (Araclar). */
  query: string | null;
  lang: Lang;
}) {
  const t = (key: MessageKey) => translate(lang, key);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [data, setData] = useState<DependenciesResponse | null>(null);
  /** Veri hangi sorgu icin geldi; ayni sorgu icin tekrar istek ATILMAZ. */
  const [fetchedFor, setFetchedFor] = useState<string | null>(null);
  /** Bekleyen istegi isaretler: secim degistince gec yanit yok sayilir. */
  const req = useRef(0);

  // Secim degisince sonuc SIFIRLANIR; bolum KAPALI kalir.
  useEffect(() => {
    req.current += 1;
    setOpen(false);
    setBusy(false);
    setFailed(false);
    setData(null);
    setFetchedFor(null);
  }, [query]);

  const load = async (q: string): Promise<void> => {
    const mine = req.current;
    setBusy(true);
    setFailed(false);
    try {
      const res = await api.dependencies(q);
      if (req.current !== mine) return;
      setData(res);
      setFetchedFor(q);
    } catch {
      if (req.current !== mine) return;
      setFailed(true);
      setFetchedFor(null);
    } finally {
      if (req.current === mine) setBusy(false);
    }
  };

  const toggle = (): void => {
    if (query === null) return;
    const next = !open;
    setOpen(next);
    if (next && fetchedFor !== query && !busy) {
      void load(query);
    }
  };

  const title = t('deps.title');

  const refRows = (refs: DependenciesResponse['dependents']) => (
    <ul className="detail-list rp-deps-rows">
      {refs.map((ref) => (
        <li key={`${ref.id}:${ref.state}`} title={ref.id}>
          <span className="rp-deps-label">{ref.label}</span>
          <span
            className={`badge rp-deps-state${
              ref.state === 'broken' ? ' danger' : ref.state === 'shadowed' ? ' warn' : ''
            }`}
          >
            {t(STATE_KEY[ref.state])}
          </span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="rp-deps">
      <h2>{title}</h2>
      <div className="rp-deps-toggle">
        <button
          type="button"
          className="ghost"
          disabled={query === null}
          aria-expanded={open}
          aria-controls="rp-deps-body"
          onClick={toggle}
        >
          {open ? t('deps.hide') : t('deps.show')}
        </button>
      </div>

      {query === null && <p className="dim rp-deps-note">{t('deps.selectFirst')}</p>}

      {open && (
        <div
          id="rp-deps-body"
          role="region"
          aria-label={title}
          className="rp-deps-body"
          aria-busy={busy || undefined}
        >
          {busy && <p className="dim">{t('deps.loading')}</p>}

          {!busy && failed && (
            <div className="rp-deps-error" role="alert">
              <span>{t('common.error')}</span>
              <button
                type="button"
                className="ghost"
                disabled={query === null}
                onClick={() => {
                  if (query !== null) void load(query);
                }}
              >
                {t('deps.retry')}
              </button>
            </div>
          )}

          {!busy && !failed && data && (
            <>
              {data.note === 'no-cache' ? (
                <p className="dim">{t('deps.noCache')}</p>
              ) : data.note === 'empty' || data.note === 'no-match' ? (
                <p className="dim">{t('deps.noMatch')}</p>
              ) : (
                <>
                  {data.matched.length > 0 && (
                    <section className="rp-deps-group">
                      <h4>{t('deps.matched')}</h4>
                      <ul className="detail-list rp-deps-rows">
                        {data.matched.map((node) => (
                          <li key={node.id} title={node.id}>
                            <span className="rp-deps-label">{node.label}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  <section className="rp-deps-group">
                    <h4>{t('deps.dependents')}</h4>
                    {data.dependents.length === 0 ? (
                      <p className="dim">{t('deps.none')}</p>
                    ) : (
                      refRows(data.dependents)
                    )}
                  </section>

                  <section className="rp-deps-group">
                    <h4>{t('deps.needs')}</h4>
                    {data.needs.length === 0 ? (
                      <p className="dim">{t('deps.none')}</p>
                    ) : (
                      refRows(data.needs)
                    )}
                  </section>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
