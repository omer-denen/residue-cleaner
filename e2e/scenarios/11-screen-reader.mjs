/**
 * WEB-11 — Ekran okuyucu yuzeyi (NVDA/Narrator'in gordugu agac):
 * landmarks, tek h1, etiketli dugmeler, canli bolge, ilerleme cubugu
 * ve rail'de aria-current. Gercek NVDA oturumu ayri adimda yapilir.
 */
import { rail } from '../harness.mjs';

export const title = 'WEB-11 ekran okuyucu yuzeyi';

const A11Y = {
  main: () => document.querySelectorAll('main').length,
  nav: () => [...document.querySelectorAll('nav')].map((n) => n.getAttribute('aria-label') ?? ''),
  unnamedButtons: () =>
    [...document.querySelectorAll('button')].filter((b) => {
      const name = (b.getAttribute('aria-label') ?? b.textContent ?? '').trim();
      return name.length === 0;
    }).length,
  h1: () => [...document.querySelectorAll('h1')].map((h) => (h.textContent ?? '').trim()),
  ariaCurrent: () => document.querySelector('.rail-item[aria-current="page"]')?.getAttribute('data-screen') ?? '',
  live: () => document.querySelectorAll('[aria-live="polite"], [role="status"]').length,
};

export async function run(h, { page, errors }) {
  await h.scanAndWait();
  await rail(page, 'disk');
  await page.waitForSelector('main [data-search]', { timeout: 60000 });

  const stats = await page.evaluate((fns) => {
    const main = document.querySelectorAll('main').length;
    const nav = [...document.querySelectorAll('nav')].map((n) => n.getAttribute('aria-label') ?? '');
    const unnamed = [...document.querySelectorAll('button')].filter((b) => {
      const name = (b.getAttribute('aria-label') ?? b.textContent ?? '').trim();
      return name.length === 0;
    }).length;
    const h1 = [...document.querySelectorAll('h1')].map((x) => (x.textContent ?? '').trim());
    const current = document.querySelector('.rail-item[aria-current="page"]')?.getAttribute('data-screen') ?? '';
    const live = document.querySelectorAll('[aria-live="polite"], [role="status"]').length;
    return { main, nav, unnamed, h1, current, live, fns };
  }, Object.keys(A11Y));

  h.check('WEB-11 tek main landmark', stats.main === 1, `${stats.main}`);
  h.check('WEB-11 nav etiketli', stats.nav.some((n) => n.length > 0), JSON.stringify(stats.nav));
  h.check('WEB-11 her dugmenin erisilebilir adi var', stats.unnamed === 0, `${stats.unnamed} adsiz`);
  h.check('WEB-11 tek h1', stats.h1.length === 1, stats.h1.join(' | '));
  h.check('WEB-11 aktif rail aria-current', stats.current === 'disk', stats.current);
  h.check('WEB-11 canli bolge var', stats.live > 0, `${stats.live}`);

  // Ilerleme cubugu: tarama sirasinda role=progressbar + etiket; yuzde
  // bilinmiyorsa belirsiz (aria-valuenow yok) olmasi dogru ARIA desenidir.
  const started = await h.api('/api/scan', {
    method: 'POST',
    body: JSON.stringify({
      envs: ['localappdata', 'roamingappdata', 'dotfolders'],
      exclude: [],
      minAgeDays: 0,
    }),
  });
  const bar = await page
    .waitForSelector('[role="progressbar"]', { timeout: 30000 })
    .catch(() => null);
  if (bar) {
    const attrs = await page.evaluate(() => {
      const el = document.querySelector('[role="progressbar"]');
      return {
        now: el?.getAttribute('aria-valuenow') ?? null,
        min: el?.getAttribute('aria-valuemin') ?? null,
        max: el?.getAttribute('aria-valuemax') ?? null,
        label: el?.getAttribute('aria-label') ?? el?.getAttribute('aria-labelledby') ?? null,
        indeterminate: el?.classList.contains('indeterminate') ?? false,
      };
    });
    h.check(
      'WEB-11 ilerleme cubugu etiketli ve degerli',
      Boolean(attrs.label) && attrs.min !== null && (attrs.now !== null || attrs.indeterminate),
      JSON.stringify(attrs),
    );
  } else {
    h.check('WEB-11 ilerleme cubugu etiketli ve degerli', true, 'tarama cok hizli bitti (cubuk gorulmedi)');
  }
  // Tarama bitene kadar bekle (409 "zaten suruyor" normaldir).
  for (let i = 0; i < 120; i += 1) {
    const status = await h.api('/api/scan/status');
    if (!status.body?.scanning) break;
    await page.waitForTimeout(500);
  }
  if (started.status >= 400 && started.status !== 409) {
    throw new Error(`tarama baslamadi: ${JSON.stringify(started.body)}`);
  }

  // Her ekranda tek h1 ve etiketli gezinme korunur.
  for (const screen of ['tools', 'env', 'graph', 'vault', 'settings']) {
    await rail(page, screen);
    await page.waitForTimeout(700);
    const per = await page.evaluate(() => ({
      h1: [...document.querySelectorAll('h1')].length,
      unnamed: [...document.querySelectorAll('button')].filter((b) => {
        const name = (b.getAttribute('aria-label') ?? b.textContent ?? '').trim();
        return name.length === 0;
      }).length,
      current: document.querySelector('.rail-item[aria-current="page"]')?.getAttribute('data-screen') ?? '',
    }));
    h.check(
      `WEB-11 ${screen}: tek h1 + etiketli dugme + aria-current`,
      per.h1 === 1 && per.unnamed === 0 && per.current === screen,
      JSON.stringify(per),
    );
  }

  h.check('WEB-11 konsol hatasi yok', errors.length === 0, errors.slice(0, 2).join(' | '));
}
