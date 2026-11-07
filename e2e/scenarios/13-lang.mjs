/**
 * WEB-13 — TR/EN: dil dugmesi `<html lang>`'i cevirir, ekran metinleri ve
 * tablo basliklari dile uyar; secim localStorage'da kalir (yenilemede korunur).
 */
import { click, rail } from '../harness.mjs';

export const title = 'WEB-13 TR/EN dil gecisi';

const BUTTON = 'button[aria-label="Dil"], button[aria-label="Language"]';

export async function run(h, { page, errors }) {
  await h.scanAndWait();
  await rail(page, 'disk');
  await page.waitForSelector('main [data-search]', { timeout: 60000 });

  const start = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    h1: document.querySelector('h1')?.textContent ?? '',
    body: document.querySelector('main')?.innerText ?? '',
  }));
  h.check('WEB-13 baslangic dili TR', start.lang === 'tr', start.lang);
  h.check('WEB-13 TR baslik', /Disk/i.test(start.h1), start.h1);
  h.check('WEB-13 TR arayuz metni', /Yeniden tara|Ara|Taranıyor|Tarama/.test(start.body));

  await click(page, BUTTON);
  await page.waitForTimeout(600);

  const en = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    h1: document.querySelector('h1')?.textContent ?? '',
    body: document.querySelector('main')?.innerText ?? '',
  }));
  h.check('WEB-13 dil EN oldu', en.lang === 'en', en.lang);
  h.check('WEB-13 EN baslik', /Disk/.test(en.h1), en.h1);
  h.check(
    'WEB-13 EN arayuz metni',
    /Scan|Search|Targets|Clusters|Folders/i.test(en.body),
    en.body.slice(0, 120).replace(/\n/g, ' / '),
  );

  // Yenilemede dil korunur (localStorage).
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.main', { timeout: 30000 });
  const afterReload = await page.evaluate(() => document.documentElement.lang);
  h.check('WEB-13 dil yenilemede korunuyor', afterReload === 'en', afterReload);

  // Diger ekranlarda da EN metinler.
  await rail(page, 'vault');
  await page.waitForTimeout(900);
  const vaultText = await page.evaluate(() => document.querySelector('main')?.innerText ?? '');
  h.check('WEB-13 Kasa ekrani EN', /Vault|Restore|Entries|records/i.test(vaultText), vaultText.slice(0, 120).replace(/\n/g, ' / '));

  await rail(page, 'settings');
  await page.waitForTimeout(700);
  const settingsText = await page.evaluate(() => document.querySelector('main')?.innerText ?? '');
  h.check('WEB-13 Ayarlar ekrani EN', /Settings|Scan cache|Update|Save/i.test(settingsText), settingsText.slice(0, 120).replace(/\n/g, ' / '));

  // TR'ye geri don.
  await click(page, BUTTON);
  await page.waitForTimeout(500);
  const back = await page.evaluate(() => document.documentElement.lang);
  h.check('WEB-13 TR geri donus', back === 'tr', back);

  h.check('WEB-13 konsol hatasi yok', errors.length === 0, errors.slice(0, 2).join(' | '));
}
