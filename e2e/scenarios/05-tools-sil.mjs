/**
 * WEB-05 — Araclar: envanter (SSE), kanit paneli ve `SIL` duvari.
 *
 * Kaldirma CALISTIRILMAZ (gercek makinede npm uninstall calismasin):
 * yalniz plan/onay kapisi ve kanit gorunurlugu dogrulanir.
 */
import { click, rail } from '../harness.mjs';

export const title = 'WEB-05 araclar + SIL duvari';

export async function run(h, { page, errors }) {
  await rail(page, 'tools');
  // Envanter kendiliginden baslamaz: kullanici "Envanteri tara" der.
  const start = page.locator('button.primary:has-text("Envanteri tara")').first();
  await start.waitFor({ state: 'visible', timeout: 30000 });
  await click(page, 'button.primary:has-text("Envanteri tara")');
  await page.waitForSelector('.cli-row', { timeout: 120000 });

  const rows = await page.locator('.cli-row').count();
  h.check('WEB-05 envanter arac listeledi', rows > 0, `${rows} arac`);

  const named = page.locator('.cli-row:has-text("demo-tool")').first();
  h.check('WEB-05 sahte arac envanterde', (await named.count()) > 0);
  if ((await named.count()) === 0) return;

  await named.locator('button.cli-name-wrap').click();
  await page.waitForSelector('.tools-detail', { timeout: 15000 });

  const detail = await page.evaluate(() => document.querySelector('.tools-detail')?.innerText ?? '');
  h.check('WEB-05 kanit paneli komutu gosteriyor', detail.includes('demo-tool'));
  h.check('WEB-05 kanit satirlari var', /kurulum|shim|erişim|erisim/i.test(detail));
  h.check('WEB-05 kaldirma komutu yazili', /npm uninstall -g demo-tool/.test(detail), detail.split('\n').slice(0, 12).join(' / '));

  await click(page, '.tools-detail .danger-button');
  const phrase = page.locator('input[aria-label="Onay ifadesi"]').first();
  await phrase.waitFor({ state: 'visible', timeout: 15000 });
  h.check('WEB-05 SIL duvari acildi', true);

  const submit = page.locator('.plan-panel .danger-button').first();
  h.check('WEB-05 ifade bosken kaldirma kapali', await submit.isDisabled());

  await phrase.fill('YANLIS');
  await page.waitForTimeout(200);
  h.check('WEB-05 yanlis ifadeyle kaldirma kapali', await submit.isDisabled());

  await phrase.fill('SIL');
  await page.waitForTimeout(200);
  h.check('WEB-05 SIL yazilinca kaldirma acilir', !(await submit.isDisabled()));

  // Calistirmiyoruz: kullanici onayi olmadan gercek kaldirma yapilmaz.
  h.check('WEB-05 konsol hatasi yok', errors.length === 0, errors.slice(0, 2).join(' | '));
}
