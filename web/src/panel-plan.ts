/**
 * SAG PANEL PLANI — "hangi ekranda hangi modul" karari TEK yerde.
 *
 * Neden ayri modul: panel bir "bildirim paneli" gibi davraniyordu; her ekranda
 * ayni "Plan Durumu" widget'i basilirken ekranin kendi verisi (kanit) bos
 * kaliyordu (kullanici geri bildirimi, 25.10.2026). Modul secimi artik
 * ekranin kimliginden turer ve tek bir saf fonksiyonda toplanir; `App.tsx`
 * yalnizca bu plani uygular, `RightPanel` yalnizca cizer.
 *
 * Kurallar:
 *  - Ilk modul BIRINCIL moduldur (ekrana girerken acilir).
 *  - 3 modul siniri (VS Code 3-5 arastirmasi; not: `docs/UX-PLAN-2026-10-21.md` P1).
 *  - "Plan Durumu" (disk plani) ekranin konusu DEGILSE yalnizca KOMPAKT
 *    gosterilir; kayit/ayar ekranlarinda hic gosterilmez (yerine Baglam).
 *  - Kayit/ayar ekranlari (Zamanlanmis, Kasa, Ayarlar) Baglam modulu tasir:
 *    bu ekranlarda disk plani degil, uygulama kapsami/tarama durumu baglamdir.
 *
 * Bu dosya SAF TS'tir: React, DOM ve node builtin importu YOKTUR; birim testi
 * `tests/panel-plan.test.ts` icindedir.
 */

/** Arayuz ekranlari (rail ile ayni kimlikler). */
export type PanelScreen =
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

/** Sag panel modul kimlikleri. */
export type PanelModuleId = 'evidence' | 'action' | 'planned' | 'context';

/**
 * "Plan Durumu" modulunun varyanti:
 *  - `full`: eylem + ozet + kume listesi (planin konusu olan ekranlar)
 *  - `compact`: eylem + ozet; liste ve satir cikarma asil ekranda
 */
export type PlannedVariant = 'full' | 'compact';

export interface PanelPlan {
  /** Sekme sirasi; ilk oge birincildir. */
  modules: PanelModuleId[];
  /** "Plan Durumu" modulu varsa varyanti; yoksa null. */
  planned: PlannedVariant | null;
}

/**
 * Ekran -> modul plani. Sira bilinclidir:
 *  - Kanit ekranlari (Disk, Araclar) kanitle acilir.
 *  - Islem ekranlari (PATH, Graf) kendi eylem paneliyle acilir.
 *  - Kayit/ayar ekranlari baglamla acilir.
 */
const PLANS: Record<PanelScreen, PanelPlan> = {
  // Genel Bakis: defter ayrintisi kanit; plan kompakt (sayi + uygula).
  dashboard: { modules: ['evidence', 'planned', 'context'], planned: 'compact' },
  // Disk: planin ASIL ekrani; tam liste burada.
  disk: { modules: ['evidence', 'planned', 'context'], planned: 'full' },
  // Projeler: SALT OKUNUR kesif; plan yalnizca hatirlatma.
  projects: { modules: ['evidence', 'planned', 'context'], planned: 'compact' },
  // Araclar: kendi kaldirma islemi `action`; disk plani kompakt hatirlatma YOK
  // (kaldirma artik arac basina tek islem).
  tools: { modules: ['evidence', 'action'], planned: null },
  // PATH & Ortam: birincil is etkilesim -> TEMIZLE plani (action).
  env: { modules: ['action', 'planned', 'context'], planned: 'compact' },
  // Graf: birincil is etkilesim -> what-if engeli (action).
  graph: { modules: ['action', 'planned', 'context'], planned: 'compact' },
  // Plan ekrani planin KENDISIDIR; panelde yalnizca baglam.
  plan: { modules: ['context'], planned: null },
  // Kayit/ayar ekranlari: disk plani bu ekranlarin konusu degil.
  schedules: { modules: ['context'], planned: null },
  vault: { modules: ['context'], planned: null },
  settings: { modules: ['context'], planned: null },
};

/** Test ve dogrulama icin ekran listesi (kaynak: `PLANS`). */
export const PANEL_SCREENS: readonly PanelScreen[] = Object.keys(
  PLANS,
) as PanelScreen[];

/** Ekranin panel plani (saf; ayni girdi -> ayni cikti). */
export function panelPlanFor(screen: PanelScreen): PanelPlan {
  return PLANS[screen];
}

/** Ekranin birincil modulu (ekrana girerken acilan sekme). */
export function primaryModuleFor(screen: PanelScreen): PanelModuleId {
  return PLANS[screen].modules[0] ?? 'evidence';
}
