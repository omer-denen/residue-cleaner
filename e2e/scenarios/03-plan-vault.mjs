/**
 * WEB-03 — Plan + `TASI`: orta riskli kume secilir, yanlis ifade reddedilir,
 * dogru ifade kumeyi kasaya tasir. Kalici silme YOKTUR.
 */
import { click, rail } from '../harness.mjs';

export const title = 'WEB-03 plan + TASI onayi';

export async function run(h, { page, errors }) {
  const disk = await h.scanAndWait();
  const clusters = disk?.clusters ?? [];
  h.check('WEB-03 tarama kume uretti', clusters.length > 0, `${clusters.length} kume`);

  const risky = clusters.find((c) => c.risk !== 'safe' && c.plannable);
  h.check(
    'WEB-03 yazili onay isteyen kume var',
    Boolean(risky),
    risky ? `${risky.key} · ${risky.risk}` : 'orta/yuksek riskli secilebilir kume yok',
  );
  if (!risky) return;

  await rail(page, 'disk');
  await page.waitForSelector('.cluster-row', { timeout: 30000 });

  const row = page.locator(
    `.cluster-row:has(input[aria-label*="${risky.key.split(':').pop()}"])`,
  ).first();
  const box = row.locator('input[type="checkbox"]');
  await box.waitFor({ state: 'attached', timeout: 15000 });
  h.check('WEB-03 kume secilebilir', !(await box.isDisabled()), risky.key);
  await box.click();

  // Secim sunucuya plan olarak yazilir; sozlesme { planId, name, plan.clusters }.
  const inPlan = (body) => body?.plan?.clusters?.length ?? 0;
  let planBody = {};
  const planDeadline = Date.now() + 15000;
  while (Date.now() < planDeadline) {
    planBody = (await h.api('/api/plan')).body ?? {};
    if (inPlan(planBody) > 0) break;
    await page.waitForTimeout(300);
  }
  h.check('WEB-03 plan olustu', Boolean(planBody.planId) && inPlan(planBody) > 0, `${inPlan(planBody)} kume`);

  await rail(page, 'plan');
  const phraseInput = page.locator('input[aria-label="Onay ifadesi"]').first();
  await phraseInput.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  const hasPhrase = await phraseInput.isVisible().catch(() => false);
  h.check('WEB-03 yazili onay alani var', hasPhrase, `risk ${planBody.plan?.clusters?.[0]?.risk ?? '?'}`);
  if (!hasPhrase) return;

  const move = page.locator('button.primary', { hasText: /Kasaya taşı|Move to vault/ }).first();

  await phraseInput.fill('YANLIS');
  await page.waitForTimeout(250);
  const before = (await h.api('/api/vault')).body?.entries?.length ?? 0;
  h.check('WEB-03 yanlis ifadeyle tasima kapali', await move.isDisabled(), 'dugme kapali bekleniyor');

  await phraseInput.fill('TASI');
  await page.waitForTimeout(300);
  h.check('WEB-03 dogru ifadeyle tasima acik', !(await move.isDisabled()));
  await click(page, 'button.primary:has-text("Kasaya taşı")');

  let records = 0;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    records = (await h.api('/api/vault')).body?.entries?.length ?? 0;
    if (records > before) break;
    await page.waitForTimeout(400);
  }
  h.check('WEB-03 TASI ile kume kasaya tasindi', records > before, `kasa ${before} -> ${records}`);

  const vault = (await h.api('/api/vault')).body?.entries ?? [];
  const first = vault[0];
  h.check(
    'WEB-03 kasa kaydi kaynak yolu ve boyut tasir',
    Boolean(first?.originalPath) && typeof first?.bytes === 'number',
    first ? `${first.originalPath} · ${first.bytes} B` : 'kayit yok',
  );

  h.check('WEB-03 konsol hatasi yok', errors.length === 0, errors.slice(0, 2).join(' | '));
}
