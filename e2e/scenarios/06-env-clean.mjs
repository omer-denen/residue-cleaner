/**
 * WEB-06 — PATH & Ortam: bulgular, plan oncesi/sonrasi, `TEMIZLE` duvari.
 *
 * UYGULANMAZ: kayit defterine yazan tek akis burasidir; E2E yalniz plan
 * ve onay kapisini dogrular (gercek PATH degistirilmez).
 */
import { click, rail } from '../harness.mjs';

export const title = 'WEB-06 PATH & Ortam + TEMIZLE duvari';

export async function run(h, { page, errors }) {
  await rail(page, 'env');
  await page.waitForSelector('.env-main', { timeout: 30000 });
  await page.waitForSelector('.env-selection-count', { timeout: 30000 });
  await page.waitForTimeout(600);

  const analysis = await h.api('/api/env');
  const findings = analysis.body?.findings?.length ?? 0;
  h.check('WEB-06 env analizi bulgu uretiyor', findings > 0, `${findings} bulgu`);

  const listText = await page.evaluate(
    () => document.querySelector('.env-main')?.innerText ?? '',
  );
  h.check(
    'WEB-06 bulgular ekranda',
    /PATH|değişken|değişkeni|gölge|yetim/i.test(listText),
    listText.slice(0, 120).replace(/\n/g, ' / '),
  );

  const create = page.locator('button.primary:has-text("Plan oluştur")').first();
  const canPlan = !(await create.isDisabled());
  h.check('WEB-06 temizlenebilir girdi var', canPlan);

  if (canPlan) {
    await click(page, 'button.primary:has-text("Plan oluştur")');
    await page.waitForSelector('.env-detail input[aria-label="Onay ifadesi"]', {
      timeout: 20000,
    });

    const plan = await h.api('/api/env/plan', {
      method: 'POST',
      body: JSON.stringify({ scope: 'user', removeMissing: true, removeDuplicates: true }),
    });
    const changes = plan.body?.plan?.changes?.length ?? 0;
    h.check('WEB-06 plan degisiklik uretiyor', changes > 0, `${changes} degisiklik`);

    const detail = await page.evaluate(
      () => document.querySelector('.env-detail')?.innerText ?? '',
    );
    h.check('WEB-06 plan oncesi/sonrasi gosteriliyor', /Önce|Sonra/i.test(detail));
    h.check('WEB-06 yedek notu var', /yede/i.test(detail), detail.slice(0, 160).replace(/\n/g, ' / '));

    const apply = page.locator('.env-detail button.danger-button').first();
    const phrase = page.locator('.env-detail input[aria-label="Onay ifadesi"]').first();
    h.check('WEB-06 ifade bosken uygulama kapali', await apply.isDisabled());

    await phrase.fill('SIL');
    await page.waitForTimeout(200);
    h.check('WEB-06 yanlis ifadeyle uygulama kapali', await apply.isDisabled());

    await phrase.fill('TEMIZLE');
    await page.waitForTimeout(200);
    h.check('WEB-06 TEMIZLE yazilinca uygulama acilir', !(await apply.isDisabled()));

    // UYGULANMIYOR: kayit defteri degistirilmez.
  }

  h.check('WEB-06 konsol hatasi yok', errors.length === 0, errors.slice(0, 2).join(' | '));
}
