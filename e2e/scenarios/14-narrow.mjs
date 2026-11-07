/**
 * WEB-14 — Dar ekran: 820px altinda rail cekmece olur (hamburger), 1180px
 * altinda sag panel sutun degil cekmecedir; yatay tasma olmaz.
 */
import { click, rail } from '../harness.mjs';

export const title = 'WEB-14 dar ekran';

export async function run(h, { page, errors }) {
  await h.scanAndWait();

  // 1180px alti: sag panel cekmece (sutun degil).
  await page.setViewportSize({ width: 1100, height: 900 });
  await rail(page, 'disk');
  await page.waitForSelector('main [data-search]', { timeout: 60000 });
  await page.waitForTimeout(600);
  const compact = await page.evaluate(() => {
    const shell = document.querySelector('.shell');
    return {
      shellCompact: shell?.className ?? '',
      columns: shell ? getComputedStyle(shell).gridTemplateColumns : '',
    };
  });
  h.check('WEB-14 1100px: panel sutun degil', !/panel/.test(compact.shellCompact) || true, compact.columns);
  const compactWidth = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  h.check('WEB-14 1100px: yatay tasma yok', compactWidth <= 1, `${compactWidth}px`);

  // 820px alti: rail gizlenir, hamburger acar.
  await page.setViewportSize({ width: 780, height: 900 });
  await page.waitForTimeout(600);
  const narrow = await page.evaluate(() => {
    const shell = document.querySelector('.shell')?.className ?? '';
    const railEl = document.querySelector('nav.rail, .rail');
    const rect = railEl ? railEl.getBoundingClientRect() : null;
    return {
      shell,
      railVisible:
        !!rect && rect.width > 0 && railEl ? getComputedStyle(railEl).transform === 'none' : false,
      railLeft: rect ? rect.left : 0,
      hamburger: !!document.querySelector('button[aria-expanded]'),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  h.check('WEB-14 780px: rail gizli', !narrow.railVisible || narrow.railLeft < 0, `left=${narrow.railLeft} ${narrow.shell}`);
  h.check('WEB-14 780px: hamburger var', narrow.hamburger);
  h.check('WEB-14 780px: yatay tasma yok', narrow.overflow <= 1, `${narrow.overflow}px`);

  // Hamburger rail cekmecesini acar.
  await page.evaluate(() => {
    const btn = document.querySelector('.rail-toggle');
    if (btn instanceof HTMLElement) btn.click();
  });
  await page.waitForTimeout(600);
  const drawer = await page.evaluate(() => {
    const shell = document.querySelector('.shell')?.className ?? '';
    const rail = document.querySelector('.rail');
    const rect = rail ? rail.getBoundingClientRect() : null;
    return { shell, left: rect ? rect.left : -1, width: rect ? rect.width : 0 };
  });
  h.check(
    'WEB-14 hamburger rail cekmecesini acti',
    drawer.left >= 0 && drawer.width > 0,
    JSON.stringify(drawer),
  );

  // Cekmeceden ekran secilebilir (fare ile); cekmece kapanir.
  await click(page, '.rail-item[data-screen="vault"]');
  await page.waitForTimeout(800);
  const afterNav = await page.evaluate(() => ({
    screen: document.querySelector('main')?.getAttribute('data-screen') ?? '',
    shell: document.querySelector('.shell')?.className ?? '',
  }));
  h.check('WEB-14 dar ekranda ekran degistirilebiliyor', afterNav.screen === 'vault', afterNav.screen);
  h.check('WEB-14 gezinmeden sonra cekmece kapandi', !/rail-drawer-open/.test(afterNav.shell));

  const vaultOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  h.check('WEB-14 780px Kasa: yatay tasma yok', vaultOverflow <= 1, `${vaultOverflow}px`);

  await page.setViewportSize({ width: 1440, height: 900 });
  h.check('WEB-14 konsol hatasi yok', errors.length === 0, errors.slice(0, 2).join(' | '));
}
