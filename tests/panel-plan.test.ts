import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PANEL_SCREENS,
  panelPlanFor,
  primaryModuleFor,
  type PanelScreen,
} from '../web/src/panel-plan.ts';

/**
 * SAG PANEL PLANI (P1–P5).
 *
 * Panel eskiden her ekranda ayni "Plan Durumu" widget'ini basiyordu; ekranin
 * kendi verisi (kanit) bos kaliyordu. Modul secimi artik tek bir saf
 * fonksiyonda (`web/src/panel-plan.ts`) toplanmistir. Bu testler o kararin
 * degismezlerini kilitler:
 *  - her ekranin bir BIRINCIL modulu vardir,
 *  - "Plan Durumu" hicbir ekranda TEK basina gosterilmez,
 *  - kayit/ayar ekranlari Baglam tasir,
 *  - disk plani yalnizca Disk ekraninda TAM listelenir,
 *  - 3 modul siniri ve tekrar yok.
 */

const RECORD_SCREENS: PanelScreen[] = ['plan', 'schedules', 'vault', 'settings'];

test('panel plani: her ekranin bir birincil modulu var', () => {
  assert.equal(PANEL_SCREENS.length, 10);
  assert.equal(new Set(PANEL_SCREENS).size, PANEL_SCREENS.length);

  for (const screen of PANEL_SCREENS) {
    const plan = panelPlanFor(screen);
    assert.ok(plan.modules.length > 0, `${screen}: modul yok`);
    assert.equal(
      primaryModuleFor(screen),
      plan.modules[0],
      `${screen}: birincil modul ilk sirada degil`,
    );
  }
});

test('panel plani: 3 modul siniri ve tekrar yok', () => {
  for (const screen of PANEL_SCREENS) {
    const { modules } = panelPlanFor(screen);
    assert.ok(modules.length <= 3, `${screen}: 3 modul siniri asildi`);
    assert.equal(
      new Set(modules).size,
      modules.length,
      `${screen}: ayni modul iki kez`,
    );
  }
});

test('panel plani: plan durumu hicbir ekranda tek basina degil', () => {
  for (const screen of PANEL_SCREENS) {
    const plan = panelPlanFor(screen);
    const onlyPlanned =
      plan.modules.length === 1 && plan.modules[0] === 'planned';
    assert.equal(onlyPlanned, false, `${screen}: yalniz plan modulu`);
    // Plan modulu asla birincil (acilistaki) sekme olmaz.
    assert.notEqual(plan.modules[0], 'planned', `${screen}: plan birincil`);
  }
});

test('panel plani: kayit/ayar ekranlari Baglam tasir, plan tasimaz', () => {
  for (const screen of RECORD_SCREENS) {
    const plan = panelPlanFor(screen);
    assert.deepEqual(plan.modules, ['context'], `${screen}: modul kumesi`);
    assert.equal(plan.planned, null, `${screen}: plan varyanti`);
    assert.equal(primaryModuleFor(screen), 'context');
  }
});

test('panel plani: yalniz Disk tam plan listesi tasir', () => {
  assert.equal(panelPlanFor('disk').planned, 'full');

  for (const screen of PANEL_SCREENS) {
    if (screen === 'disk') continue;
    assert.notEqual(
      panelPlanFor(screen).planned,
      'full',
      `${screen}: tam plan listesi`,
    );
  }
});

test('panel plani: plan varyanti ile modul listesi tutarli', () => {
  for (const screen of PANEL_SCREENS) {
    const plan = panelPlanFor(screen);
    const hasPlanned = plan.modules.includes('planned');
    assert.equal(
      plan.planned !== null,
      hasPlanned,
      `${screen}: varyant/modul uyusmuyor`,
    );
  }
});

test('panel plani: kanit ekranlari kanitle acilir', () => {
  for (const screen of ['dashboard', 'disk', 'projects', 'tools'] as const) {
    assert.equal(primaryModuleFor(screen), 'evidence', `${screen}: birincil`);
  }
});

test('panel plani: islem ekranlari kendi eylemiyle acilir', () => {
  for (const screen of ['env', 'graph'] as const) {
    assert.equal(primaryModuleFor(screen), 'action', `${screen}: birincil`);
    assert.ok(
      panelPlanFor(screen).modules.includes('context'),
      `${screen}: baglam yok`,
    );
  }
});

test('panel plani: Araclar kaldirma eylemi tasir, plan tasimaz', () => {
  const plan = panelPlanFor('tools');
  assert.deepEqual(plan.modules, ['evidence', 'action']);
  assert.equal(plan.planned, null);
  // Baglam sekmesi yok: baglam Kanitlar modulunun footer'inda kalir.
  assert.equal(plan.modules.includes('context'), false);
});

test('panel plani: ayni girdi ayni cikti (saf)', () => {
  for (const screen of PANEL_SCREENS) {
    assert.deepEqual(panelPlanFor(screen), panelPlanFor(screen));
  }
});
