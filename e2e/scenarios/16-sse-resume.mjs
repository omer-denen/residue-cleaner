/**
 * WEB-16 — SSE dayanikliligi: olay akisi bir kez kopar, istemci yeniden
 * baglanir ve tarama sonucu yine de ekrana gelir (Last-Event-ID / otomatik
 * yeniden deneme). Sunucu tamponu kacirilan olaylari tekrar verir.
 */
import { click, rail } from '../harness.mjs';

export const title = 'WEB-16 SSE yeniden baglanma';

export async function run(h, { page, errors }) {
  const attempts = [];
  let aborted = 0;

  await page.route('**/api/scan/*/events', async (route) => {
    const req = route.request();
    attempts.push({
      url: req.url(),
      lastEventId: req.headers()['last-event-id'] ?? null,
    });
    if (aborted === 0) {
      aborted += 1;
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await rail(page, 'disk');
  await page.waitForSelector('main [data-search]', { timeout: 60000 });

  // Taramayi arayuzden baslat (gercek yol).
  await click(page, 'main button.primary:has-text("Yeniden tara")');
  await page.waitForTimeout(1200);

  h.check('WEB-16 ilk akis istegi yapildi', attempts.length >= 1, `${attempts.length} istek`);
  h.check('WEB-16 ilk akis zorla koparildi', aborted === 1);

  // Tarayici kendiliginden yeniden baglanir (birkac saniye).
  for (let i = 0; i < 60 && attempts.length < 2; i += 1) await page.waitForTimeout(500);
  h.check('WEB-16 istemci yeniden baglandi', attempts.length >= 2, `${attempts.length} istek`);

  // Tarama bitene kadar bekle; ekran "taraniyor" durumundan cikmali.
  for (let i = 0; i < 120; i += 1) {
    const status = await h.api('/api/scan/status');
    if (!status.body?.scanning) break;
    await page.waitForTimeout(500);
  }
  await page.waitForFunction(
    () => !document.querySelector('.scan-chip.scan-scanning'),
    undefined,
    { timeout: 90000 },
  );

  const disk = await h.api('/api/disk');
  const clusters = disk.body?.clusters?.length ?? 0;
  h.check('WEB-16 tarama sonucu tamamlandi', clusters > 0, `${clusters} kume`);

  const scans = await h.api('/api/scans');
  const rows = scans.body?.rows ?? [];
  h.check(
    'WEB-16 gecmise tamamlanmis kayit yazildi',
    rows.some((r) => r.outcome === 'done' && r.complete !== false),
    `${rows.length} kayit`,
  );

  const listText = await page.evaluate(() => document.querySelector('main')?.innerText ?? '');
  h.check('WEB-16 sonuc listesi ekranda', /kume|küme|cluster/i.test(listText), listText.slice(0, 100).replace(/\n/g, ' / '));

  h.check('WEB-16 konsol hatasi yok', errors.length === 0, errors.slice(0, 2).join(' | '));
}
