import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import type {
  DashboardResponse,
  MetaResponse,
  PlanRecordView,
  PlanResponse,
  ScanStatusResponse,
  ScanVerifyResponse,
  UserProfile,
} from '../../src/core/contract.ts';
import { PlanBadge } from '../../src/core/plan-badge.ts';
import { PanelPrefs } from '../../src/core/panel-prefs.ts';
import { api, ApiError } from './api.ts';
import { translate, translateUpper, type Lang, type MessageKey } from './i18n.ts';
import { formatBytes } from './format.ts';
import { profileViewFor } from './profiles.ts';
import { Onboarding } from './screens/Onboarding.tsx';
import { shouldOnboard, ONBOARDING_KEY, ONBOARDING_DONE } from './onboarding.ts';
import { isTypingTarget } from './keyboard.ts';
import { ScanStatusChip, ScanStatusDialog } from './components/ScanStatus.tsx';
import { Icon, type IconName } from './components/icons.tsx';
import {
  RightPanel,
  RightPanelProvider,
  type RightPanelModule,
  type RightPanelModuleId,
} from './components/RightPanel.tsx';
import { CommandPalette, type PaletteItem } from './components/CommandPalette.tsx';
import { PlannedModule, PlanValidity } from './components/PlannedModule.tsx';
import { ContextBlock } from './components/ContextBlock.tsx';
import {
  panelPlanFor,
  primaryModuleFor,
  type PanelScreen,
} from './panel-plan.ts';
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

// Ekran kimlikleri tek kaynaktan gelir (`web/src/panel-plan.ts`); sag panel
// modul secimi de ayni dosyadadir.
type Screen = PanelScreen;

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

/**
 * Rail bilgi mimarisi: 10 esit oge yerine uc is grubu + altta Ayarlar.
 * Gruplama YALNIZ sunumdur; ekran kimlikleri, kisayollar ve davranis aynidir.
 */
const NAV_GROUPS: Array<{ id: string; label: MessageKey; items: Screen[] }> = [
  { id: 'work', label: 'nav.group.work', items: ['dashboard', 'disk', 'plan'] },
  { id: 'system', label: 'nav.group.system', items: ['projects', 'tools', 'env', 'graph'] },
  { id: 'records', label: 'nav.group.records', items: ['schedules', 'vault'] },
];

/** Yazı alanında mı? Kısayollar orada devre dışı kalır. */

const PANEL_MIN = 300;
const PANEL_MAX = 560;
const PANEL_DEFAULT = 380;
const PANEL_HIDDEN_KEY = 'residue.panel.hidden';

/** Panel genisligini 300-560 araligina kirp. */
function clampPanelWidth(w: number): number {
  return Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(w)));
}

export function App() {
  const [lang, setLang] = useState<Lang>(() =>
    localStorage.getItem('residue.lang') === 'en' ? 'en' : 'tr',
  );
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [profile, setProfile] = useState<UserProfile>('hybrid');
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const navigatedRef = useRef(false);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [status, setStatus] = useState<ScanStatusResponse | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  /** Sag panel "Planlananlar": sunucudaki guncel plan (TTL'li). */
  const [planned, setPlanned] = useState<PlanResponse | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planRecords, setPlanRecords] = useState<PlanRecordView[]>([]);
  /**
   * Plan suresi doldu (ya da plan 410): sessiz kaybolma YOK; sag panel ve
   * Plan ekraninda uyarisi kapatilabilir olarak durur; yeni plan kurulunca
   * temizlenir.
   */
  const [planExpired, setPlanExpired] = useState(false);
  /** Açılış doğrulama bandı (daily mod): kaybolan/değişen hedefler. */
  const [scanVerify, setScanVerify] = useState<ScanVerifyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** Yenile dugmesi: ilk yuklemeden sonra da gorunur geri bildirim. */
  const [refreshing, setRefreshing] = useState(false);
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
  const [hiddenPanel, setHiddenPanel] = useState<string[]>(() => PanelPrefs.parse(localStorage.getItem(PANEL_HIDDEN_KEY)));
  /** Dar ekran mi? (820px alti) */
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 820px)').matches,
  );
  /**
   * Sag panelin sutun olarak sigmadigi genislik (1180px alti). Bu aralikta
   * panel SUTUN degil, uzerine acilan cekmece olur; aksi halde detay/kanit
   * portalleri gorunmez olur ve satir tiklamalari "olu" kalir.
   */
  const [isCompact, setIsCompact] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1180px)').matches,
  );
  const [panelDrawerOpen, setPanelDrawerOpen] = useState(false);
  /** Komut paleti (Ctrl/Cmd+K): ekran + eylem aramasi. */
  const [paletteOpen, setPaletteOpen] = useState(false);

  const railRef = useRef<HTMLElement | null>(null);
  const helpRef = useRef<HTMLDivElement | null>(null);
  const helpCloseRef = useRef<HTMLButtonElement | null>(null);
  const helpOpenerRef = useRef<HTMLElement | null>(null);

  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);

  // Etiket/basliklar: dil bilincli buyuk harf (TR: i -> İ).
  const tu = (key: MessageKey, vars?: Record<string, string | number>) =>
    translateUpper(lang, key, vars);

  // Ekran degisince o ekranin BIRINCIL modulunu ac (Office baglam deseni);
  // sira `panel-plan.ts` kararidir. Ayni ekranda kullanici baska sekmeye
  // gecerse korunur (ekran ici secim o sekmeyi kendi acar).
  const previousScreenRef = useRef(screen);
  useEffect(() => {
    if (previousScreenRef.current === screen) return;
    previousScreenRef.current = screen;
    setRightTab(primaryModuleFor(screen));
  }, [screen]);

  useEffect(() => {
    if (screen === 'plan') void refreshPlanRecords();
  }, [screen]);

  /** Plan gecersiz oldugunda (404/410) ortak temizlik + uyarı bayragi. */
  const stalePlan = (): void => {
    setPlanned(null);
    setPlan(null);
    setPlanExpired(true);
  };

  const refreshPlanRecords = async (): Promise<void> => {
    try {
      const res = await api.plans();
      setPlanRecords(res.records);
    } catch {
      /* yut */
    }
  };

  const planWin = async (clusterKey: string): Promise<void> => {
    if (planBusy) return;
    setPlanBusy(true);
    setPlanError(null);
    try {
      const out = await api.createPlanRecord([clusterKey], 'dashboard');
      setPlan(out.plan);
      setPlanned(out.plan);
      setScreen('plan');
      await refreshPlanRecords();
    } catch (err) {
      setPlanError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setPlanBusy(false);
    }
  };

  /**
   * Plani BOSALT ("Seçimi temizle"): mevcut plan anahtarlarinin TAMAMI tek
   * istekte cikarilir; sonuc planda oge kalmadiginda null'dur (plan bos
   * durum). Bu bir KAYDETME degildir; secim temizlenir.
   */
  const clearPlanned = async (): Promise<void> => {
    if (!planned || planBusy) return;
    setPlanBusy(true);
    setPlanError(null);
    try {
      const next = await api.clearPlan(
        planned.planId,
        [...planned.panel.keys].filter((key) => key.length > 0),
      );
      setPlanExpired(false);
      setPlanned(next);
      setPlan(next);
      await refreshPlanRecords();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410)) {
        stalePlan();
      }
      setPlanError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setPlanBusy(false);
    }
  };

  /**
   * "Planı uygula": taslaksa ONCE sunucuda arming eder (`POST /api/plan/apply`)
   * — 10 dk sure o anda baslar — sonra Plan ekranina gecirir. Zaten armed
   * plan varsa yalnizca ekrani degistirir (yeniden kurulum yok).
   */
  const armPlan = async (): Promise<void> => {
    if (!planned || planBusy) return;
    if (planned.armed) {
      setScreen('plan');
      return;
    }
    setPlanBusy(true);
    setPlanError(null);
    try {
      const next = await api.applyPlan(planned.planId);
      setPlanExpired(false);
      setPlan(next);
      setPlanned(next);
      await refreshPlanRecords();
      setScreen('plan');
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410)) {
        stalePlan();
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
      const [nextDashboard, nextMeta, nextStatus, nextPlanned, nextRecords] = await Promise.all([
        api.dashboard(),
        api.meta(),
        api.scanStatus(),
        api.planned(),
        api.plans(),
      ]);
      setDashboard(nextDashboard);
      setMeta(nextMeta);
      setStatus(nextStatus);
      setPlanned(nextPlanned);
      setPlanRecords(nextRecords.records);
      // Plan ekranindaki sonuc gorunumunu ezmemek icin yalnizca varsa yaz.
      if (nextPlanned) setPlan(nextPlanned);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  /** Topbar "Yenile": ayni yuklemeyi SESSIZCE tekrarlar; dugme kilitlenir. */
  const refresh = useCallback(async (): Promise<void> => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load, refreshing]);

  const launchRanRef = useRef(false);

  useEffect(() => {
    if (launchRanRef.current) return;
    launchRanRef.current = true;
    void (async () => {
      // Acilis politikasi: yalniz ILK yuklemede calisir (döngü yok).
      await load();
      await refreshPlanRecords();
      // 1. Ayarlar
      let mode: 'always' | 'daily' | 'manual' = 'always';
      try {
        const s = await api.settings();
        mode = s.scanOnLaunch;
        setProfile(s.uiProfile);
        if (!navigatedRef.current) {
          setScreen(profileViewFor(s.uiProfile).initialScreen);
        }
      } catch {
        /* varsayilan always */
      }
      // Onboarding ayar okumasindan BAGIMSIZ: ayarlar okunamasa da ilk
      // acilis sorusu gosterilir (varsayilan hybrid isaretli).
      if (shouldOnboard(localStorage.getItem(ONBOARDING_KEY))) {
        setOnboardingOpen(true);
      }
      // 2. Plan atma: armed === false -> at; armed === true -> dokunma.
      let currentPlanned: PlanResponse | null = null;
      try {
        currentPlanned = await api.planned();
      } catch {
        currentPlanned = null;
      }
      if (currentPlanned && currentPlanned.armed === false) {
        try {
          await api.discardPlan(currentPlanned.planId);
          setPlanned(null);
          setPlan((prev) =>
            prev?.planId === currentPlanned!.planId ? null : prev,
          );
        } catch {
          // 409/404/410 sessizce yut
        }
      } else if (currentPlanned) {
        setPlanned(currentPlanned);
        setPlan(currentPlanned);
      }
      // 3. Tarama durumu
      let currentStatus: ScanStatusResponse | null = null;
      try {
        currentStatus = await api.scanStatus();
        setStatus(currentStatus);
      } catch {
        currentStatus = status;
      }
      if (currentStatus?.scanning) return;

      // 4. Tarama. Ilerleme ve bitis YOKLAMASI artik tek yerden yurur
      // (asagidaki `status.scanning` efekti); burada yalnizca baslatilir.
      if (mode === 'always') {
        try {
          await api.startScan({});
        } catch {
          // 409 sessizce yut
        }
        try {
          setStatus(await api.scanStatus());
        } catch {
          /* durum bir sonraki yoklamada gelir */
        }
      } else if (mode === 'daily') {
        try {
          const res = await api.verifyScan();
          if (res.missing.length > 0 || res.changed.length > 0) {
            setScanVerify(res);
          }
        } catch {
          // sessizce yut
        }
        await load();
        await refreshPlanRecords();
      }
      // manual: hicbir istek yok
    })();
  }, [load]);

  /**
   * TARAMA SURERKEN canli durum: ust cubuk yuzdesi, Disk ilerlemesi ve
   * ekran sayilari taze kalsin. Tarama bitince TEK kez `load()` calisir
   * (sayilar/liste yenilenir). Yoklama araligi 1.2 s; SSE'si olan Disk
   * ekrani arada daha ince taneli gunceller.
   */
  const wasScanningRef = useRef(false);
  useEffect(() => {
    if (status?.scanning !== true) {
      if (wasScanningRef.current) {
        wasScanningRef.current = false;
        void load();
      }
      return;
    }
    wasScanningRef.current = true;
    let alive = true;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const next = await api.scanStatus();
          if (alive) setStatus(next);
        } catch {
          /* gecici hata: sonraki yoklama dener */
        }
      })();
    }, 1200);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [status?.scanning, load]);

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

  // Plan TTL: suresi dolan plan sessiz kaybolmaz — uyarı gorunur kalir
  // (sag panel + Plan ekranı role=alert); diskte hicbir sey degismez.
  // Sayaç yalnizca Date.now() farki; sure doldugunda tek seferlik temizlik.
  useEffect(() => {
    // Taslak (armed=false / expiresAt=0) secimin suresi YOKTUR; sayac yok.
    if (!planned || !planned.armed || planned.expiresAt <= 0) return;
    const remaining = planned.expiresAt - Date.now();
    if (remaining <= 0) {
      stalePlan();
      return;
    }
    const timer = window.setTimeout(() => stalePlan(), remaining + 500);
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

  // Panel cekmecesi: 1180px altinda panel sutun olarak gizlenir; detay
  // secimi cekmeceyi otomatik acar. Genis ekrana donunce cekmece kapanir.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1180px)');
    const onChange = (e: MediaQueryListEvent): void => {
      setIsCompact(e.matches);
      if (!e.matches) setPanelDrawerOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Klavye: `/` arama, `?` kısayollar, `Esc` kapat / odaktan çık.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl/Cmd+K: komut paleti (yazarken de calisir; tarayici aramasini ez).
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((value) => !value);
        return;
      }
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'Escape') {
        if (paletteOpen) {
          setPaletteOpen(false);
          return;
        }
        if (help) {
          setHelp(false);
          return;
        }
        if (panelDrawerOpen) {
          setPanelDrawerOpen(false);
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
  }, [help, panelDrawerOpen, paletteOpen]);

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

  /**
   * Rail ogesi: roving tabindex korunur (yalniz aktif ekran 0; oklar gezer).
   * Kasa sayaci motordan gelir; sifirsa rozet cizilmez.
   */
  const railItem = (id: Screen) => {
    const item = NAV.find((entry) => entry.id === id);
    if (!item) return null;
    const vaultCount =
      id === 'vault'
        ? (dashboard?.ledgers.find((ledger) => ledger.id === 'vault')?.count ?? 0)
        : 0;
    const planBadge = id === 'plan' ? PlanBadge.view(planRecords) : null;
    const label =
      id === 'vault' && vaultCount > 0
        ? `${t(item.label)} (${vaultCount})`
        : planBadge && planBadge.show
          ? `${t(item.label)} (${planBadge.total})`
          : t(item.label);
    const ariaLabel =
      planBadge && planBadge.show
        ? t('nav.plan.badge', { total: planBadge.total, pending: planBadge.pending })
        : label;
    return (
      <button
        key={id}
        type="button"
        className={`rail-item${screen === id ? ' active' : ''}`}
        aria-current={screen === id ? 'page' : undefined}
        tabIndex={screen === id ? 0 : -1}
        title={label}
        aria-label={ariaLabel}
        onClick={() => {
          navigatedRef.current = true;
          setScreen(id);
          if (isNarrow) setRailOpen(false);
        }}
      >
        <Icon name={item.icon} />
        <span className="rail-label">{t(item.label)}</span>
        {vaultCount > 0 && (
          <span className="rail-badge" aria-hidden="true">
            {vaultCount}
          </span>
        )}
        {planBadge && planBadge.show && (
          <span className="rail-badge" aria-hidden="true">{planBadge.total}</span>
        )}
      </button>
    );
  };

  // Sag panel modulleri: sira ve varyant `panel-plan.ts` kararidir; burada
  // yalnizca modul tanimlari (etiket, slot, rozet) kurulur.
  const panelPlan = panelPlanFor(screen);
  const panelVisibility = PanelPrefs.resolve(panelPlan.modules, hiddenPanel);
  const panelActive = panelVisibility.visible.includes(rightTab) ? rightTab : panelVisibility.visible[0];
  const hasContextTab = panelPlan.modules.includes('context');
  const panelModules: RightPanelModule[] = panelVisibility.visible.map((id) => {
    if (id === 'evidence') {
      return {
        id: 'evidence',
        label: 'rightPanel.evidence',
        slot: true,
        empty: 'rightPanel.evidence.empty',
        emptyKind: 'evidence',
        emptyAction: {
          label: 'rightPanel.empty.cta',
          onClick: () => setScreen('disk'),
        },
        // Baglam kendi sekmesiyse footer TEKRAR basilmaz (P5).
        footer: hasContextTab ? undefined : (
          <ContextBlock meta={meta} status={status} lang={lang} headingLevel="h3" />
        ),
      };
    }
    if (id === 'action') {
      return {
        id: 'action',
        label: 'rightPanel.action',
        slot: true,
        empty: 'rightPanel.action.empty',
        emptyKind: 'action',
      };
    }
    if (id === 'planned') {
      return {
        id: 'planned',
        label: 'rightPanel.planned',
        // Motorun panel sayimi (`plan.panel.clusterCount`); rozet kararidir.
        badge: planned?.panel.clusterCount ?? null,
        content: (
          <PlannedModule
            plan={planned}
            lang={lang}
            busy={planBusy}
            error={planError}
            expired={planExpired}
            onDismissExpired={() => setPlanExpired(false)}
            onClearAll={() => void clearPlanned()}
            onApply={() => void armPlan()}
            onOpenTools={() => setScreen('tools')}
            onOpenDisk={() => setScreen('disk')}
            variant={panelPlan.planned ?? 'full'}
          />
        ),
      };
    }
    return {
      id: 'context',
      label: 'rightPanel.context',
      content: <ContextBlock meta={meta} status={status} lang={lang} />,
    };
  });

  const PANEL_MODULE_LABEL: Record<string, MessageKey> = {
    evidence: 'rightPanel.evidence',
    action: 'rightPanel.action',
    planned: 'rightPanel.planned',
    context: 'rightPanel.context',
  };

  const onToggleModule = (id: string): void => {
    const next = PanelPrefs.toggle(hiddenPanel, id, panelPlan.modules);
    setHiddenPanel(next);
    try { localStorage.setItem(PANEL_HIDDEN_KEY, JSON.stringify(next)); } catch { /* yoksay */ }
  };

  /** Persona yalniz sunum: rail grup ici sirasi (W2-2). */
  const navOrder = profileViewFor(profile).navOrder;

  /** Panel gorunur mu? Genis ekranda sutun, dar ekranda cekmece. */
  const showPanel = !rightCollapsed || (isCompact && panelDrawerOpen);

  /**
   * Ekran icinden `panel.activate(...)`: genis ekranda sekme acilir;
   * 1180px altinda panel SUTUN DEGIL cekmecedir, bu yuzden otomatik acilir.
   * Aksi halde "Detay" tiklamasi gorunmez bir paneli hedefliyordu.
   */
  const activatePanel = (id: RightPanelModuleId): void => {
    setRightTab(id);
    if (isCompact) setPanelDrawerOpen(true);
  };

  const closePanel = (): void => {
    if (isCompact) setPanelDrawerOpen(false);
    else setRightCollapsed(true);
  };

  /**
   * Palet adaylari: 10 ekran + 5 eylem. Etiketler i18n'den; eslestirme
   * `CommandView` motorunda (kural 18). Dil degisince yeniden uretilir.
   */
  const paletteItems = useMemo<PaletteItem[]>(
    () => [
      ...NAV.map((entry) => ({
        id: `nav:${entry.id}`,
        label: t(entry.label),
        hint: t('palette.group.nav'),
        keywords: [entry.id, 'sayfa', 'screen'],
      })),
      {
        id: 'action:scan',
        label: t('palette.action.scan'),
        hint: t('palette.group.action'),
        keywords: ['scan', 'tarama', 'disk'],
      },
      {
        id: 'action:refresh',
        label: t('palette.action.refresh'),
        hint: t('palette.group.action'),
        keywords: ['refresh', 'yenile'],
      },
      {
        id: 'action:panel',
        label: t('palette.action.panel'),
        hint: t('palette.group.action'),
        keywords: ['panel', 'detay', 'drawer'],
      },
      {
        id: 'action:lang',
        label: t('palette.action.lang'),
        hint: t('palette.group.action'),
        keywords: ['language', 'dil', 'english', 'turkce'],
      },
      {
        id: 'action:help',
        label: t('palette.action.help'),
        hint: t('palette.group.action'),
        keywords: ['help', 'yardim', 'shortcut', 'kisayol'],
      },
    ],
    // t yalniz `lang`e baglidir; ekran degisimi listeyi degistirmez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang],
  );

  const runPalette = (id: string): void => {
    if (id.startsWith('nav:')) {
      setScreen(id.slice(4) as Screen);
      return;
    }
    if (id === 'action:scan') {
      setScreen('disk');
      setScanRequest((value) => value + 1);
      return;
    }
    if (id === 'action:refresh') {
      void refresh();
      return;
    }
    if (id === 'action:panel') {
      if (isCompact) {
        if (panelDrawerOpen) closePanel();
        else activatePanel(rightTab);
      } else {
        setRightCollapsed((value) => !value);
      }
      return;
    }
    if (id === 'action:lang') {
      setLang(lang === 'tr' ? 'en' : 'tr');
      return;
    }
    if (id === 'action:help') setHelp(true);
  };

  return (
    <div
      className={[
        'app',
        railCollapsed ? 'rail-collapsed' : '',
        rightCollapsed ? 'panel-collapsed' : '',
        isNarrow && railOpen ? 'rail-drawer-open' : '',
        isCompact && panelDrawerOpen ? 'panel-drawer-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-density={profileViewFor(profile).density}
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
          {planned?.armed && planned.expiresAt > 0 && (
            <button
              type="button"
              className="pending-plan"
              aria-label={
                t('top.pendingPlan') +
                ' · ' +
                t('rightPanel.planned.validityUntil', {
                  time: new Date(planned.expiresAt).toLocaleTimeString(
                    lang === 'tr' ? 'tr-TR' : 'en-US',
                    { hour: '2-digit', minute: '2-digit' },
                  ),
                })
              }
              title={t('top.pendingPlanHint')}
              onClick={() => setScreen('plan')}
            >
              <span className="pending-plan-title">{t('top.pendingPlan')}</span>
              <PlanValidity expiresAt={planned.expiresAt} lang={lang} compact />
            </button>
          )}
          <button
            type="button"
            className="ghost palette-trigger"
            aria-label={t('top.paletteHint')}
            aria-keyshortcuts="Control+K"
            title={t('top.paletteHint')}
            onClick={() => setPaletteOpen(true)}
          >
            <Icon name="search" size={13} />
            <span className="palette-trigger-label">{t('top.palette')}</span>
            <kbd>Ctrl K</kbd>
          </button>
          <button
            type="button"
            className="ghost refresh-btn"
            disabled={refreshing}
            aria-busy={refreshing}
            onClick={() => void refresh()}
          >
            <Icon name="refresh" size={13} className={refreshing ? 'spin' : undefined} />
            <span>{t('top.refresh')}</span>
          </button>
          <button
            type="button"
            className="ghost rp-toggle"
            aria-label={
              (isCompact ? panelDrawerOpen : !rightCollapsed)
                ? t('rightPanel.collapse')
                : t('rightPanel.expand')
            }
            aria-expanded={isCompact ? panelDrawerOpen : !rightCollapsed}
            aria-controls="app-right-panel"
            onClick={() =>
              isCompact
                ? setPanelDrawerOpen((value) => !value)
                : setRightCollapsed((value) => !value)
            }
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

      <RightPanelProvider active={panelActive} onActivate={activatePanel}>
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
          {NAV_GROUPS.map((group) => (
            <div
              key={group.id}
              className="rail-group"
              role="group"
              aria-label={t(group.label)}
            >
              <div className="rail-group-label" aria-hidden="true">
                {tu(group.label)}
              </div>
              {[...group.items]
                .sort((x, y) => navOrder.indexOf(x) - navOrder.indexOf(y))
                .map((id) => railItem(id))}
            </div>
          ))}

          <div className="rail-spacer" />
          {railItem('settings')}

          <div className="rail-foot" title={t('rail.localHint')}>
            <Icon name="lock" size={14} />
            <div className="rail-foot-text">
              <strong>{t('rail.local')}</strong>
              <span>{t('rail.localHint')}</span>
            </div>
          </div>
        </nav>

        <main
          className={`main${screen === 'disk' ? ' main-fill' : ''}`}
          id="main"
          tabIndex={-1}
          aria-label={t('a11y.main')}
          aria-busy={loading || refreshing}
        >
          {loading && (
            <div className="page-skeleton" role="status" aria-label={t('common.loading')}>
              <span className="sk sk-kicker" />
              <span className="sk sk-heading" />
              <span className="sk sk-sub" />
              <div className="sk-cards" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className="sk sk-card" />
                ))}
              </div>
              <div className="skeleton-list" aria-hidden="true">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="skeleton-row">
                    <span className="sk sk-dot" />
                    <span className="sk sk-title" />
                    <span className="sk sk-meta" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Plan 404/410 ya da TTL: uyarı HER ekranda görünür (sessiz
              kaybolma yok). Plan Durumu sekmesi açıkken panelin kendi
              uyarısı gösterilir; çiftlemeyi önlemek için burada gizlenir. */}
          {planExpired &&
            screen !== 'plan' &&
            !(rightTab === 'planned' && panelPlan.planned !== null) && (
            <div className="banner danger" role="alert">
              <span>{t('rightPanel.planned.expired')}</span>
              <button
                type="button"
                className="ghost"
                onClick={() => setPlanExpired(false)}
              >
                {t('common.close')}
              </button>
            </div>
          )}

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
            <Dashboard
              data={dashboard}
              lang={lang}
              onOpenDisk={() => setScreen('disk')}
              onPlanWin={planWin}
              onNavigate={(target) => setScreen(target)}
            />
          )}

          {!loading && !error && screen === 'disk' && (
            <Disk
              meta={meta}
              status={status}
              lang={lang}
              scanRequest={scanRequest}
              onStatus={() => void load()}
              onOpenScanStatus={() => setScanReport(true)}
              planned={planned}
              planBusy={planBusy}
              plannedKeys={planned?.panel.keys ?? []}
              verifyNote={scanVerify}
              onDismissVerify={() => setScanVerify(null)}
              onPlan={(nextPlan) => {
                // Sayfa DEGISMEZ: plan sag panelde + Plan ekraninda
                // guncellenir; yeni plan kurulunca suresi-doldu uyarisi
                // temizlenir.
                setPlan(nextPlan);
                setPlanned(nextPlan);
                setPlanError(null);
                if (nextPlan) setPlanExpired(false);
              }}
              onPlanStale={() => {
                stalePlan();
              }}
              onApplyPlan={() => void armPlan()}
            />
          )}

          {!loading && !error && screen === 'plan' && (
            <PlanScreen
              plan={plan}
              lang={lang}
              records={planRecords}
              expired={planExpired}
              onDismissExpired={() => setPlanExpired(false)}
              onBack={() => setScreen('disk')}
              onVault={() => setScreen('vault')}
              onReplace={(next) => {
                setPlan(next);
                setPlanned(next);
                setPlanError(null);
                if (next) setPlanExpired(false);
                void refreshPlanRecords();
              }}
              onRecordsChange={setPlanRecords}
              onExecuted={() => {
                setPlan(null);
                setPlanned(null);
                setPlanExpired(false);
                void refresh();
                void refreshPlanRecords();
              }}
            />
          )}

          {!loading && !error && screen === 'projects' && (
            <Projects lang={lang} />
          )}

          {!loading && !error && screen === 'tools' && (
            <Tools
              lang={lang}
              onChanged={() => void load()}
              diskScanning={status?.scanning === true}
            />
          )}

          {!loading && !error && screen === 'env' && <Env lang={lang} />}

          {!loading && !error && screen === 'graph' && (
            <Graph lang={lang} diskScanning={status?.scanning === true} />
          )}

          {!loading && !error && screen === 'schedules' && (
            <Schedules lang={lang} />
          )}

          {!loading && !error && screen === 'settings' && (
            <Settings lang={lang} version={meta?.version} onProfileChange={setProfile} />
          )}

          {!loading && !error && screen === 'vault' && (
            <Vault lang={lang} onChanged={() => void load()} />
          )}
        </main>

        {showPanel && !isCompact && (
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
        {showPanel && (
          <RightPanel
            lang={lang}
            modules={panelModules}
            active={panelActive}
            onActivate={activatePanel}
            onCollapse={closePanel}
            hiddenModules={panelVisibility.hidden}
            catalog={panelPlan.modules.map((id) => ({ id, label: PANEL_MODULE_LABEL[id] }))}
            onToggleModule={onToggleModule}
          />
        )}
      </div>
      {isCompact && panelDrawerOpen && (
        <button
          type="button"
          className="panel-backdrop"
          aria-label={t('rightPanel.closeDrawer')}
          tabIndex={-1}
          onClick={() => setPanelDrawerOpen(false)}
        />
      )}
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

      <Onboarding
        lang={lang}
        open={onboardingOpen}
        onChoose={async (id) => {
          try {
            const next = await api.saveSettings({ uiProfile: id });
            setProfile(next.uiProfile);
            if (!navigatedRef.current) {
              setScreen(profileViewFor(next.uiProfile).initialScreen);
            }
          } catch {
            setProfile(id);
            if (!navigatedRef.current) {
              setScreen(profileViewFor(id).initialScreen);
            }
          }
          localStorage.setItem(ONBOARDING_KEY, ONBOARDING_DONE);
          setOnboardingOpen(false);
        }}
      />

      {paletteOpen && (
        <CommandPalette
          lang={lang}
          items={paletteItems}
          onRun={runPalette}
          onClose={() => setPaletteOpen(false)}
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
                  <kbd>{t('a11y.shortcut.palette.keys')}</kbd>
                </dt>
                <dd>{t('a11y.shortcut.palette')}</dd>
              </div>
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
                  <kbd>{t('a11y.shortcut.pause.keys')}</kbd>
                </dt>
                <dd>{t('a11y.shortcut.pause')}</dd>
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
