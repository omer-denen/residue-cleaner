import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import type {
  DashboardResponse,
  MetaResponse,
  PlanResponse,
  ScanStatusResponse,
} from '../../src/core/contract.ts';
import { api, ApiError } from './api.ts';
import { translate, translateUpper, type Lang, type MessageKey } from './i18n.ts';
import { formatBytes } from './format.ts';
import { ScanStatusChip, ScanStatusDialog } from './components/ScanStatus.tsx';
import { Icon, type IconName } from './components/icons.tsx';
import {
  RightPanel,
  RightPanelProvider,
  type RightPanelModule,
  type RightPanelModuleId,
} from './components/RightPanel.tsx';
import { PlannedModule } from './components/PlannedModule.tsx';
import { Dashboard } from './screens/Dashboard.tsx';
import { Disk } from './screens/Disk.tsx';
import { Env } from './screens/Env.tsx';
import { Graph } from './screens/Graph.tsx';
import { PlanScreen } from './screens/PlanScreen.tsx';
import { Projects } from './screens/Projects.tsx';
import { Schedules } from './screens/Schedules.tsx';
import { Settings } from './screens/Settings.tsx';
import { Tools } from './screens/Tools.tsx';
import { Vault } from './screens/Vault.tsx';

type Screen =
  | 'dashboard'
  | 'disk'
  | 'plan'
  | 'projects'
  | 'tools'
  | 'env'
  | 'graph'
  | 'schedules'
  | 'vault'
  | 'settings';

const NAV: Array<{ id: Screen; label: MessageKey; icon: IconName }> = [
  { id: 'dashboard', label: 'nav.dashboard', icon: 'dashboard' },
  { id: 'disk', label: 'nav.disk', icon: 'disk' },
  { id: 'plan', label: 'nav.plan', icon: 'plan' },
  { id: 'projects', label: 'nav.projects', icon: 'projects' },
  { id: 'tools', label: 'nav.tools', icon: 'tools' },
  { id: 'env', label: 'nav.env', icon: 'env' },
  { id: 'graph', label: 'nav.graph', icon: 'graph' },
  { id: 'schedules', label: 'nav.schedules', icon: 'schedules' },
  { id: 'vault', label: 'nav.vault', icon: 'vault' },
  { id: 'settings', label: 'nav.settings', icon: 'settings' },
];

/** Yazı alanında mı? Kısayollar orada devre dışı kalır. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true
  );
}

/** Ekran -> sag panel modulleri (VS Code "3-5 modul" siniri). */
function modulesFor(screen: Screen): RightPanelModuleId[] {
  switch (screen) {
    case 'dashboard':
    case 'disk':
    case 'projects':
      return ['evidence', 'planned', 'context'];
    case 'tools':
      return ['evidence', 'action', 'planned', 'context'];
    case 'env':
    case 'graph':
      return ['action', 'planned', 'context'];
    case 'plan':
      return ['context'];
    default:
      return ['planned', 'context'];
  }
}

const PANEL_MIN = 300;
const PANEL_MAX = 560;
const PANEL_DEFAULT = 380;

/** Panel genisligini 300-560 araligina kirp. */
function clampPanelWidth(w: number): number {
  return Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(w)));
}

export function App() {
  const [lang, setLang] = useState<Lang>(() =>
    localStorage.getItem('residue.lang') === 'en' ? 'en' : 'tr',
  );
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [status, setStatus] = useState<ScanStatusResponse | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  /** Sag panel "Planlananlar": sunucudaki guncel plan (TTL'li). */
  const [planned, setPlanned] = useState<PlanResponse | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [help, setHelp] = useState(false);
  /** Tarama durumu ayrinti raporu (rozetten acilir). */
  const [scanReport, setScanReport] = useState(false);
  /** "Yeniden tara" istegi: Disk ekrani bu sayac artinca taramayi baslatir. */
  const [scanRequest, setScanRequest] = useState(0);
  /** Genis ekranda menu: yalniz ikon (yer kazandirir). */
  const [railCollapsed, setRailCollapsed] = useState(
    () => localStorage.getItem('residue.rail') === 'collapsed',
  );
  /** Dar ekranda menu: acilir/kapanir panel. */
  const [railOpen, setRailOpen] = useState(false);
  /** Sag panel: varsayilan ACIK (Office task pane); katlanabilir. */
  const [rightCollapsed, setRightCollapsed] = useState(
    () => localStorage.getItem('residue.panel') === 'collapsed',
  );
  /** Sag panel genisligi: localStorage'dan; gecersizse 380; 300-560 kirpilir. */
  const [panelWidth, setPanelWidth] = useState(() => {
    const raw = Number(localStorage.getItem('residue.panelWidth'));
    if (!Number.isFinite(raw) || raw <= 0) return PANEL_DEFAULT;
    return clampPanelWidth(raw);
  });
  const [rightTab, setRightTab] = useState<RightPanelModuleId>('evidence');
  /** Dar ekran mi? (820px alti) */
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 820px)').matches,
  );

  const railRef = useRef<HTMLElement | null>(null);
  const helpRef = useRef<HTMLDivElement | null>(null);
  const helpCloseRef = useRef<HTMLButtonElement | null>(null);
  const helpOpenerRef = useRef<HTMLElement | null>(null);

  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);

  // Etiket/basliklar: dil bilincli buyuk harf (TR: i -> İ).
  const tu = (key: MessageKey, vars?: Record<string, string | number>) =>
    translateUpper(lang, key, vars);

  // Ekran degisince o ekranin BIRINCIL modulunu ac (Office baglam deseni).
  // Ayni ekranda kullanici baska sekmeye gecerse korunur.
  const previousScreenRef = useRef(screen);
  useEffect(() => {
    if (previousScreenRef.current === screen) return;
    previousScreenRef.current = screen;
    const ids = modulesFor(screen);
    const primary =
      ids[0] === 'planned' && !planned && ids.includes('context')
        ? 'context'
        : ids[0];
    if (primary) setRightTab(primary);
  }, [screen, planned]);

  const removePlanned = async (key: string): Promise<void> => {
    if (!planned || planBusy) return;
    setPlanBusy(true);
    setPlanError(null);
    try {
      const remaining = planned.plan.clusters
        .filter((cluster) => cluster.key !== key)
        .map((cluster) => cluster.key);
      if (remaining.length === 0) {
        setPlanned(null);
        setPlan(null);
        return;
      }
      // Plan ekranindaki "plandan cikar" ile AYNI motor: sunucu yeniden kurar.
      const next = await api.plan(remaining);
      setPlanned(next);
      setPlan(next);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410)) {
        setPlanned(null);
        setPlan(null);
      }
      setPlanError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setPlanBusy(false);
    }
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      // Tum istekler SALT OKUNUR; karar motorda verilir.
      const [nextDashboard, nextMeta, nextStatus, nextPlanned] = await Promise.all([
        api.dashboard(),
        api.meta(),
        api.scanStatus(),
        api.planned(),
      ]);
      setDashboard(nextDashboard);
      setMeta(nextMeta);
      setStatus(nextStatus);
      setPlanned(nextPlanned);
      // Plan ekranindaki sonuc gorunumunu ezmemek icin yalnizca varsa yaz.
      if (nextPlanned) setPlan(nextPlanned);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    localStorage.setItem('residue.lang', lang);
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    localStorage.setItem('residue.rail', railCollapsed ? 'collapsed' : 'expanded');
  }, [railCollapsed]);

  useEffect(() => {
    localStorage.setItem('residue.panel', rightCollapsed ? 'collapsed' : 'expanded');
  }, [rightCollapsed]);

  useEffect(() => {
    localStorage.setItem('residue.panelWidth', String(panelWidth));
  }, [panelWidth]);

  // Plan TTL: suresi dolan plan sag panelde kalmasin (sunucu da 410 verir).
  useEffect(() => {
    if (!planned) return;
    const remaining = planned.expiresAt - Date.now();
    if (remaining <= 0) {
      setPlanned(null);
      return;
    }
    const timer = window.setTimeout(() => setPlanned(null), remaining + 500);
    return () => window.clearTimeout(timer);
  }, [planned]);

  // Dar ekran takibi: menu otomatik gizlenir, hamburger ile acilir.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 820px)');
    const onChange = (e: MediaQueryListEvent): void => {
      setIsNarrow(e.matches);
      if (!e.matches) setRailOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Klavye: `/` arama, `?` kısayollar, `Esc` kapat / odaktan çık.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'Escape') {
        if (help) {
          setHelp(false);
          return;
        }
        if (isTypingTarget(e.target)) (e.target as HTMLElement).blur();
        return;
      }

      if (isTypingTarget(e.target)) return;

      if (e.key === '?') {
        e.preventDefault();
        setHelp(true);
        return;
      }

      if (e.key === '/') {
        const field = document.querySelector<HTMLInputElement>('main [data-search]');
        if (!field) return;
        e.preventDefault();
        field.focus();
        field.select();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [help]);

  // Kısayol penceresi: odak tuzağı + kapanınca odağı geri ver.
  useEffect(() => {
    if (!help) return;
    helpOpenerRef.current = document.activeElement as HTMLElement | null;
    helpCloseRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        const focusable = Array.from(
          helpRef.current?.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        ).filter((el) => !el.hasAttribute('disabled'));
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === helpRef.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setHelp(false);
      }
    };

    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      helpOpenerRef.current?.focus?.();
    };
  }, [help]);

  // Rail: roving tabindex + ok tuşları (klavye-only tur).
  const onRailKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const buttons = Array.from(
      railRef.current?.querySelectorAll<HTMLButtonElement>('.rail-item') ?? [],
    );
    if (buttons.length === 0) return;
    const index = buttons.findIndex((b) => b === document.activeElement);
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? buttons.length - 1
          : e.key === 'ArrowDown'
            ? (index + 1 + buttons.length) % buttons.length
            : (index - 1 + buttons.length) % buttons.length;
    e.preventDefault();
    buttons[next]?.focus();
  };

  // Sag panel ayiricisi: pointer surukleme (300-560) + klavye + cift tik sifirlama.
  const onResizerPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
  };

  const onResizerPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    setPanelWidth(clampPanelWidth(window.innerWidth - e.clientX));
  };

  const onResizerPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    document.body.classList.remove('resizing');
  };

  const onResizerKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        setPanelWidth((w) => clampPanelWidth(w + 16));
        break;
      case 'ArrowRight':
        e.preventDefault();
        setPanelWidth((w) => clampPanelWidth(w - 16));
        break;
      case 'Home':
        e.preventDefault();
        setPanelWidth(PANEL_MIN);
        break;
      case 'End':
        e.preventDefault();
        setPanelWidth(PANEL_MAX);
        break;
    }
  };

  // Hamburger etiketi BUTONUN YAPTIGI ISLEMI anlatir (durumu degil).
  const railToggleLabel = isNarrow
    ? railOpen
      ? t('nav.close')
      : t('nav.open')
    : railCollapsed
      ? t('nav.open')
      : t('nav.collapse');

  // Sag panel modulleri: karar YOK; yalnizca sunum + motordan gelen sayilar.
  const panelModules: RightPanelModule[] = [];
  if (['dashboard', 'disk', 'projects', 'tools'].includes(screen)) {
    panelModules.push({
      id: 'evidence',
      label: 'rightPanel.evidence',
      slot: true,
      empty: 'rightPanel.evidence.empty',
    });
  }
  if (['tools', 'env', 'graph'].includes(screen)) {
    panelModules.push({
      id: 'action',
      label: 'rightPanel.action',
      slot: true,
      empty: 'rightPanel.action.empty',
    });
  }
  if (screen !== 'plan') {
    panelModules.push({
      id: 'planned',
      label: 'rightPanel.planned',
      badge: planned?.plan.clusters.length ?? null,
      content: (
        <PlannedModule
          plan={planned}
          lang={lang}
          busy={planBusy}
          error={planError}
          onRemove={(key) => void removePlanned(key)}
          onOpenPlan={() => setScreen('plan')}
        />
      ),
    });
  }
  panelModules.push({
    id: 'context',
    label: 'rightPanel.context',
    content: (
      <>
        <section className="context-block">
          <h2>{tu('safety.title')}</h2>
          <p className="dim">{t('safety.body')}</p>
        </section>
        {meta && (
          <section className="context-block">
            <h2>{tu('context.meta')}</h2>
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
          </section>
        )}
      </>
    ),
  });

  return (
    <div
      className={[
        'app',
        railCollapsed ? 'rail-collapsed' : '',
        isNarrow && railOpen ? 'rail-drawer-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <a className="skip-link" href="#main">
        {t('a11y.skip')}
      </a>

      <header className="topbar">
        <button
          type="button"
          className="ghost rail-toggle"
          aria-label={railToggleLabel}
          aria-expanded={isNarrow ? railOpen : !railCollapsed}
          aria-controls="app-rail"
          onClick={() => (isNarrow ? setRailOpen((v) => !v) : setRailCollapsed((v) => !v))}
        >
          <Icon name={isNarrow && railOpen ? 'close' : 'menu'} size={14} />
          <span className="sr-only">{railToggleLabel}</span>
        </button>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            R
          </span>
          <div className="brand-text">
            <strong>Residue</strong>
            <span className="dim">{t('app.tagline')}</span>
          </div>
        </div>
        <div className="topbar-right">
          {status && (
            <ScanStatusChip
              view={status.view}
              lang={lang}
              onOpen={() => setScanReport(true)}
            />
          )}
          <button type="button" className="ghost" onClick={() => void load()}>
            {t('top.refresh')}
          </button>
          <button
            type="button"
            className="ghost rp-toggle"
            aria-label={
              rightCollapsed ? t('rightPanel.expand') : t('rightPanel.collapse')
            }
            aria-expanded={!rightCollapsed}
            aria-controls="app-right-panel"
            onClick={() => setRightCollapsed((value) => !value)}
          >
            <Icon name="panel" size={14} />
          </button>
          <button
            type="button"
            className="ghost key-help"
            aria-label={t('a11y.shortcuts')}
            aria-keyshortcuts="?"
            title={t('a11y.shortcuts')}
            onClick={() => setHelp(true)}
          >
            ?
          </button>
          <button
            type="button"
            className="ghost"
            aria-label={t('top.lang')}
            onClick={() => setLang(lang === 'tr' ? 'en' : 'tr')}
          >
            {lang === 'tr' ? 'EN' : 'TR'}
          </button>
        </div>
      </header>

      <RightPanelProvider active={rightTab} onActivate={setRightTab}>
        <div
          className={`shell${rightCollapsed ? ' shell-wide' : ''}`}
          style={{ '--right-w': `${panelWidth}px` } as CSSProperties}
        >
        <nav
          className="rail"
          id="app-rail"
          aria-label={t('nav.sections')}
          ref={railRef}
          onKeyDown={onRailKey}
        >
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`rail-item${screen === item.id ? ' active' : ''}`}
              aria-current={screen === item.id ? 'page' : undefined}
              tabIndex={screen === item.id ? 0 : -1}
              title={t(item.label)}
              onClick={() => {
                setScreen(item.id);
                if (isNarrow) setRailOpen(false);
              }}
            >
              <Icon name={item.icon} />
              <span className="rail-label">{t(item.label)}</span>
            </button>
          ))}
        </nav>

        <main
          className={`main${screen === 'disk' ? ' main-fill' : ''}`}
          id="main"
          tabIndex={-1}
          aria-label={t('a11y.main')}
          aria-busy={loading}
        >
          {loading && <div className="state">{t('common.loading')}</div>}

          {!loading && error && (
            <div className="state error" role="alert">
              <strong>{t('common.error')}</strong>
              <span className="mono">{error}</span>
              <button type="button" className="ghost" onClick={() => void load()}>
                {t('common.retry')}
              </button>
            </div>
          )}

          {!loading && !error && screen === 'dashboard' && dashboard && (
            <Dashboard data={dashboard} lang={lang} />
          )}

          {!loading && !error && screen === 'disk' && (
            <Disk
              meta={meta}
              status={status}
              lang={lang}
              scanRequest={scanRequest}
              onStatus={() => void load()}
              onOpenScanStatus={() => setScanReport(true)}
              plannedKeys={planned?.panel.keys ?? []}
              onPlan={(nextPlan) => {
                // Sayfa DEGISMEZ: plan sag panelde + Plan ekraninda guncellenir.
                setPlan(nextPlan);
                setPlanned(nextPlan);
                setPlanError(null);
              }}
              onPlanStale={() => {
                setPlan(null);
                setPlanned(null);
              }}
            />
          )}

          {!loading && !error && screen === 'plan' && (
            <PlanScreen
              plan={plan}
              lang={lang}
              onBack={() => setScreen('disk')}
              onVault={() => setScreen('vault')}
              onReplace={(next) => {
                setPlan(next);
                setPlanned(next);
              }}
              onExecuted={() => {
                setPlanned(null);
                void load();
              }}
            />
          )}

          {!loading && !error && screen === 'projects' && (
            <Projects lang={lang} />
          )}

          {!loading && !error && screen === 'tools' && (
            <Tools lang={lang} onChanged={() => void load()} />
          )}

          {!loading && !error && screen === 'env' && <Env lang={lang} />}

          {!loading && !error && screen === 'graph' && <Graph lang={lang} />}

          {!loading && !error && screen === 'schedules' && (
            <Schedules lang={lang} />
          )}

          {!loading && !error && screen === 'settings' && (
            <Settings lang={lang} version={meta?.version} />
          )}

          {!loading && !error && screen === 'vault' && (
            <Vault lang={lang} onChanged={() => void load()} />
          )}

          {!loading &&
            !error &&
            ![
              'dashboard',
              'disk',
              'plan',
              'projects',
              'tools',
              'env',
              'graph',
              'schedules',
              'settings',
              'vault',
            ].includes(screen) && <div className="state">{t('common.soon')}</div>}
        </main>

        {!rightCollapsed && (
          <div
            className="panel-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label={t('rightPanel.resize')}
            aria-valuemin={300}
            aria-valuemax={560}
            aria-valuenow={panelWidth}
            tabIndex={0}
            onPointerDown={onResizerPointerDown}
            onPointerMove={onResizerPointerMove}
            onPointerUp={onResizerPointerUp}
            onPointerCancel={onResizerPointerUp}
            onDoubleClick={() => setPanelWidth(PANEL_DEFAULT)}
            onKeyDown={onResizerKeyDown}
          />
        )}
        {!rightCollapsed && (
          <RightPanel
            lang={lang}
            modules={panelModules}
            active={rightTab}
            onActivate={setRightTab}
            onCollapse={() => setRightCollapsed(true)}
          />
        )}
      </div>
      </RightPanelProvider>

      <footer className="statusbar">
        {dashboard ? (
          <>
            <span>
              <strong className="mono">
                {dashboard.totals.clusters.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US')}
              </strong>{' '}
              {t('status.clusters')}
            </span>
            <span>
              <strong className="mono">
                {dashboard.totals.files.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US')}
              </strong>{' '}
              {t('status.files')}
            </span>
            <span>
              {t('ledger.reclaimable')}:{' '}
              <strong className="mono">
                {formatBytes(
                  dashboard.ledgers.find((l) => l.id === 'reclaimable')?.bytes ?? 0,
                )}
              </strong>
            </span>
          </>
        ) : (
          <span className="dim">{t('common.none')}</span>
        )}
        <span className="statusbar-spacer" />
        <span className="dim mono">v{meta?.version ?? '—'}</span>
      </footer>

      {scanReport && status && (
        <ScanStatusDialog
          status={status}
          lang={lang}
          onClose={() => setScanReport(false)}
          onRescan={() => {
            setScreen('disk');
            setScanRequest((n) => n + 1);
          }}
        />
      )}

      {help && (
        <div className="shortcuts-backdrop" onClick={() => setHelp(false)}>
          <div
            className="shortcuts"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcuts-title"
            ref={helpRef}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shortcuts-head">
              <h2 id="shortcuts-title">{t('a11y.shortcuts')}</h2>
              <button
                type="button"
                className="ghost"
                ref={helpCloseRef}
                onClick={() => setHelp(false)}
                aria-label={t('a11y.shortcuts.close')}
              >
                {t('common.close')}
              </button>
            </div>
            <dl className="shortcuts-list">
              <div>
                <dt>
                  <kbd>{t('a11y.shortcut.nav.keys')}</kbd>
                </dt>
                <dd>{t('a11y.shortcut.nav')}</dd>
              </div>
              <div>
                <dt>
                  <kbd>{t('a11y.shortcut.search.keys')}</kbd>
                </dt>
                <dd>{t('a11y.shortcut.search')}</dd>
              </div>
              <div>
                <dt>
                  <kbd>{t('a11y.shortcut.row.keys')}</kbd>
                </dt>
                <dd>{t('a11y.shortcut.row')}</dd>
              </div>
              <div>
                <dt>
                  <kbd>{t('a11y.shortcut.select.keys')}</kbd>
                </dt>
                <dd>{t('a11y.shortcut.select')}</dd>
              </div>
              <div>
                <dt>
                  <kbd>{t('a11y.shortcut.escape.keys')}</kbd>
                </dt>
                <dd>{t('a11y.shortcut.escape')}</dd>
              </div>
              <div>
                <dt>
                  <kbd>{t('a11y.shortcut.help.keys')}</kbd>
                </dt>
                <dd>{t('a11y.shortcut.help')}</dd>
              </div>
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
