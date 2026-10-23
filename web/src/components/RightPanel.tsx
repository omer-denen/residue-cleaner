import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { translate, translateUpper, type Lang, type MessageKey } from '../i18n.ts';

/**
 * SAG PANEL — ekranlardan bagimsiz "baglam yuzeyi".
 *
 * Tasarim kaynagi (arastirma):
 *  - Office task pane: sabit sag yuzey, katlanabilir, ~320px.
 *  - VS Code sidebar: modul sekmeleri (3-5 rahat sinir).
 *  - Figma properties: secim icerigi belirler.
 *  - Azure DevOps: listeden cikmadan detay/eylem.
 *
 * Kural 18: panel KARAR VERMEZ. Modul icerigi ekranin motorundan gelir;
 * burada yalnizca sekme, katlama ve portal hedefi vardir.
 */

export type RightPanelModuleId =
  | 'evidence'
  | 'action'
  | 'planned'
  | 'context'
  // Gelecek moduller: yeni kimlik eklemek icin shell'i degistirmek gerekmez.
  | (string & {});

export interface RightPanelModule {
  id: RightPanelModuleId;
  label: MessageKey;
  /** Rozet: motordan gelen sayi (or. plan kume sayisi). */
  badge?: number | null;
  /** true ise ekran kendi icerigini portalle bu modula tasir. */
  slot?: boolean;
  /** Slot bos oldugunda gosterilecek metin. */
  empty?: MessageKey;
  /** slot=false ise dogrudan basilan icerik. */
  content?: ReactNode;
  /** Slot altinda basilan ek bolum (or. Baglam); slot bos olsa da gorunur. */
  footer?: ReactNode;
}

interface RightPanelContextValue {
  active: RightPanelModuleId;
  activate: (id: RightPanelModuleId) => void;
  slots: Partial<Record<RightPanelModuleId, HTMLElement | null>>;
  registerSlot: (id: RightPanelModuleId, el: HTMLElement | null) => void;
}

const RightPanelContext = createContext<RightPanelContextValue | null>(null);

export function RightPanelProvider({
  active,
  onActivate,
  children,
}: {
  active: RightPanelModuleId;
  onActivate: (id: RightPanelModuleId) => void;
  children: ReactNode;
}) {
  const [slots, setSlots] = useState<
    Partial<Record<RightPanelModuleId, HTMLElement | null>>
  >({});

  const registerSlot = useCallback(
    (id: RightPanelModuleId, el: HTMLElement | null) => {
      setSlots((previous) =>
        previous[id] === el ? previous : { ...previous, [id]: el },
      );
    },
    [],
  );

  return (
    <RightPanelContext.Provider
      value={{ active, activate: onActivate, slots, registerSlot }}
    >
      {children}
    </RightPanelContext.Provider>
  );
}

/** Ekran kendi kanit/eylem icerigini sag paneldeki modul slotuna tasir. */
export function RightPanelPortal({
  module = 'evidence',
  children,
}: {
  module?: RightPanelModuleId;
  children: ReactNode;
}) {
  const ctx = useContext(RightPanelContext);
  const slot = ctx?.slots[module] ?? null;
  return slot ? createPortal(children, slot) : null;
}

/**
 * Ekranlarin secim aninda sekmeyi degistirmesi icin.
 * (Figma deseni: secim -> kanit.) Provider disinda null doner.
 */
export function useRightPanel(): RightPanelContextValue | null {
  return useContext(RightPanelContext);
}

function SlotHost({
  module,
  lang,
  registerSlot,
}: {
  module: RightPanelModule;
  lang: Lang;
  registerSlot: (id: RightPanelModuleId, el: HTMLElement | null) => void;
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    registerSlot(module.id, el);
    return () => registerSlot(module.id, null);
  }, [el, module.id, registerSlot]);

  useEffect(() => {
    if (!el) return;
    const update = (): void => setEmpty(el.childElementCount === 0);
    update();
    const observer = new MutationObserver(update);
    observer.observe(el, { childList: true });
    return () => observer.disconnect();
  }, [el]);

  return (
    <>
      {empty && module.empty && (
        <p className="dim rp-empty">{translate(lang, module.empty)}</p>
      )}
      <div ref={setEl} className="rp-slot" />
    </>
  );
}

export function RightPanel({
  lang,
  modules,
  active,
  onActivate,
  onCollapse,
}: {
  lang: Lang;
  modules: RightPanelModule[];
  active: RightPanelModuleId;
  onActivate: (id: RightPanelModuleId) => void;
  onCollapse: () => void;
}) {
  const t = (key: MessageKey): string => translate(lang, key);
  const tu = (key: MessageKey): string => translateUpper(lang, key);
  const ctx = useContext(RightPanelContext);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const current = modules.find((module) => module.id === active) ?? modules[0];

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [current?.id]);

  if (!current) return null;

  const onTabKey = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    if (tabs.length === 0) return;
    const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
    let next = index < 0 ? 0 : index;
    if (event.key === 'ArrowLeft') next = (next - 1 + tabs.length) % tabs.length;
    if (event.key === 'ArrowRight') next = (next + 1) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    tabs[next]?.focus();
    onActivate(modules[next]!.id);
  };

  return (
    <aside className="right-panel" id="app-right-panel" aria-label={t('rightPanel.label')}>
      <div className="right-panel-head">
        <div
          className="rp-tabs"
          role="tablist"
          aria-label={t('rightPanel.tabs')}
          onKeyDown={onTabKey}
        >
          {modules.map((module) => (
            <button
              key={module.id}
              type="button"
              role="tab"
              className="rp-tab"
              aria-selected={module.id === current.id}
              tabIndex={module.id === current.id ? 0 : -1}
              onClick={() => onActivate(module.id)}
            >
              <span>{tu(module.label)}</span>
              {module.badge != null && (
                <span className="rp-badge mono">{module.badge}</span>
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="ghost rp-collapse"
          aria-label={t('rightPanel.collapse')}
          onClick={onCollapse}
        >
          ×
        </button>
      </div>

      <div
        className="rp-body"
        role="tabpanel"
        aria-label={tu(current.label)}
        ref={bodyRef}
      >
        {current.slot ? (
          <SlotHost
            module={current}
            lang={lang}
            registerSlot={
              ctx?.registerSlot ??
              (() => {
                /* provider yoksa slot yok */
              })
            }
          />
        ) : (
          current.content
        )}
        {current.footer && <div className="rp-footer">{current.footer}</div>}
      </div>
    </aside>
  );
}
