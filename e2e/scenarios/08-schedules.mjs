/**
 * WEB-08 — Planlar: `PLANLA` duvari, kural olusturma, onizleme, iki adimli silme.
 *
 * Kural CALISTIRILMAZ (planli islem kasaya tasir; E2E'de gercek tasima yok).
 */
import { click, rail } from '../harness.mjs';

export const title = 'WEB-08 planlar + PLANLA duvari';

export async function run(h, { page, errors }) {
  // Onizleme tarama onbelleginden beslenir (yoksa motor onizleme uretmez).
  await h.scanAndWait();

  await rail(page, 'schedules');
  await page.waitForSelector('.schedules .schedule-form', { timeout: 30000 });

  await page
    .locator('.schedules .schedule-form label.control-label')
    .first()
    .locator('input')
    .fill('E2E plan kurali');

  const phrase = page.locator('.schedules input[aria-label="Onay ifadesi"]').first();
  const create = page.locator('.schedules button.primary').first();

  h.check('WEB-08 ifade bosken kural olusturma kapali', await create.isDisabled());

  await phrase.fill('YANLIS');
  await page.waitForTimeout(200);
  h.check('WEB-08 yanlis ifadeyle kural olusturma kapali', await create.isDisabled());

  await phrase.fill('PLANLA');
  await page.waitForTimeout(200);
  h.check('WEB-08 PLANLA yazilinca kural olusturma acilir', !(await create.isDisabled()));

  await click(page, '.schedules button.primary');
  await page.waitForTimeout(1500);

  const list = await h.api('/api/schedules');
  const rules = list.body?.schedules ?? [];
  h.check('WEB-08 kural sunucuda kayitli', rules.length === 1, `${rules.length} kural`);
  h.check('WEB-08 kural modu vault', rules[0]?.mode === 'vault', String(rules[0]?.mode));

  const cardText = await page.evaluate(() => document.querySelector('.schedules')?.innerText ?? '');
  h.check('WEB-08 kart kural adini gosteriyor', /E2E plan kurali/.test(cardText));
  h.check('WEB-08 kart modu yaziyor', /PATH temizliği|Kasaya taşı/i.test(cardText));

  await click(page, '.schedules button:has-text("Önizle")');
  await page.waitForSelector('.schedules h2:has-text("ÖNİZLEME")', { timeout: 15000 });
  const previewText = await page.evaluate(() => document.querySelector('.schedules')?.innerText ?? '');
  h.check(
    'WEB-08 onizleme motordan geliyor',
    /ÖNİZLEME/.test(previewText) && /Toplam/.test(previewText),
    previewText.slice(0, 160).replace(/\n/g, ' / '),
  );

  // Iki adimli silme: once "Sil", sonra "Kural silinsin mi?".
  await click(page, '.schedules button:has-text("Sil")');
  await page.waitForSelector('.schedules button:has-text("Kural silinsin mi?")', { timeout: 10000 });
  h.check('WEB-08 silme iki adimli', true);

  await click(page, '.schedules button:has-text("Kural silinsin mi?")');
  await page.waitForTimeout(1500);

  const after = await h.api('/api/schedules');
  h.check('WEB-08 kural silindi', (after.body?.schedules ?? []).length === 0, `${(after.body?.schedules ?? []).length} kural`);

  h.check('WEB-08 konsol hatasi yok', errors.length === 0, errors.slice(0, 2).join(' | '));
}
