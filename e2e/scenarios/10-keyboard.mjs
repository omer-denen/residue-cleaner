/**
 * WEB-10 — Klavye-only tur: atlama baglantisi, rail ok tuslari (roving
 * tabindex + Enter), `/` arama, `?` kisayol penceresi (odak tuzagi + Esc),
 * satir eylemlerinin gercek dugme olmasi. FARE KULLANILMAZ.
 */
import { rail } from '../harness.mjs';

export const title = 'WEB-10 klavye-only tur';

export async function run(h, { page, errors }) {
  await h.scanAndWait();

  // 1) Atlama baglantisi: belge basindan ilk Tab.
  await page.goto(h.base, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.skip-link', { timeout: 30000 });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.press('Tab');
  const firstFocus = await page.evaluate(() => {
    const el = document.activeElement;
    return {
      cls: el instanceof HTMLElement ? el.className : '',
      text: (el?.textContent ?? '').trim().slice(0, 40),
    };
  });
  h.check(
    'WEB-10 ilk Tab atlama baglantisina gider',
    /skip-link/.test(firstFocus.cls),
    `${firstFocus.cls} / ${firstFocus.text}`,
  );

  // 2) `?` kisayol penceresi acilir, odak tuzagi calisir, Esc kapatir.
  await page.keyboard.press('?');
  await page.waitForSelector('.shortcuts', { timeout: 10000 });
  h.check('WEB-10 ? kisayol penceresini acti', true);

  const inDialog = await page.evaluate(() => {
    const dialog = document.querySelector('.shortcuts');
    return !!dialog && dialog.contains(document.activeElement);
  });
  h.check('WEB-10 odak pencerede', inDialog);

  for (let i = 0; i < 6; i += 1) await page.keyboard.press('Tab');
  const stillInside = await page.evaluate(() => {
    const dialog = document.querySelector('.shortcuts');
    return !!dialog && dialog.contains(document.activeElement);
  });
  h.check('WEB-10 odak tuzagi pencere icinde kaliyor', stillInside);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const closed = await page.evaluate(() => !document.querySelector('.shortcuts'));
  h.check('WEB-10 Esc pencereyi kapatti', closed);

  // 3) Disk ekrani yuklenince `/` arama alanina odaklanir.
  await rail(page, 'disk');
  await page.waitForSelector('main [data-search]', { timeout: 60000 });
  await page.waitForFunction(
    () => !document.querySelector('.scan-chip.scan-scanning'),
    undefined,
    { timeout: 90000 },
  );
  await page.keyboard.press('/');
  await page.waitForTimeout(300);
  const searchFocused = await page.evaluate(() => {
    const el = document.activeElement;
    return {
      tag: el?.tagName ?? '',
      search: el instanceof HTMLElement && el.hasAttribute('data-search'),
    };
  });
  h.check('WEB-10 / arama alanina odaklandi', searchFocused.search, searchFocused.tag);

  // 4) Rail roving tabindex: ok tusu odagi tasir, Enter ekrani acar.
  const before = await page.evaluate(
    () => document.querySelector('main')?.getAttribute('data-screen') ?? '',
  );
  await page.evaluate(() => {
    const active = document.querySelector('.rail-item.active');
    if (active instanceof HTMLElement) active.focus();
  });
  await page.keyboard.press('ArrowDown');
  const focusedRail = await page.evaluate(() => {
    const el = document.activeElement;
    return el instanceof HTMLElement ? (el.getAttribute('data-screen') ?? '') : '';
  });
  h.check('WEB-10 ok tusu rail odagini tasidi', focusedRail !== '' && focusedRail !== before, focusedRail);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const moved = await page.evaluate(
    () => document.querySelector('main')?.getAttribute('data-screen') ?? '',
  );
  h.check('WEB-10 Enter ekran degistirdi', moved !== before, `${before} -> ${moved}`);

  // 5) Satir eylemleri gercek dugme (klavye ile erisilebilir).
  await rail(page, 'disk');
  await page.waitForTimeout(1200);
  const rowButtons = await page.evaluate(
    () =>
      [...document.querySelectorAll('main button')].filter((b) => b.getAttribute('aria-label')).length,
  );
  h.check('WEB-10 satir eylemleri dugme', rowButtons > 0, `${rowButtons} etiketli dugme`);

  h.check('WEB-10 konsol hatasi yok', errors.length === 0, errors.slice(0, 2).join(' | '));
}
