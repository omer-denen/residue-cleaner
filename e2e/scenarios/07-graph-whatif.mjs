/**
 * WEB-07 — Graf: dugum/kenar, kok neden, what-if gerekcesi.
 *
 * Not: "engellenen" ornek icin farkli gruba ait SERT bir bagimlilik gerekir
 * (or. calisan surec). Sandbox'ta boyle bir kanit uretilemez; bu yol birim
 * testlerinde (tests/graph-*.test.ts) dogrulanir. Burada what-if'in
 * gerekceli allowed/kopuk kenar ciktisi ve eslesmeyen sorgu denenir.
 */
import { click, rail } from '../harness.mjs';

export const title = 'WEB-07 graf + what-if';

export async function run(h, { page, errors }) {
  await rail(page, 'graph');
  await page.waitForSelector('.graph-tree-view, .graph-node-row', { timeout: 150000 });

  const graph = await h.api('/api/graph');
  const summary = graph.body?.summary;
  h.check('WEB-07 graf dugum uretiyor', (summary?.nodes ?? 0) > 0, `${summary?.nodes} dugum`);
  h.check('WEB-07 graf kenar uretiyor', (summary?.edges ?? 0) > 0, `${summary?.edges} kenar`);

  const text = await page.evaluate(() => document.querySelector('.graph')?.innerText ?? '');
  h.check('WEB-07 dugumler ekranda', /demo-tool/.test(text));
  h.check('WEB-07 ozet kartlari var', /Düğüm|Kenar/.test(text));

  const input = page.locator('#graph-whatif input').first();
  await input.waitFor({ state: 'visible', timeout: 20000 });

  await input.fill('demo-tool');
  await page.evaluate(() => {
    const btn = document.querySelector('#graph-whatif button.primary');
    if (btn instanceof HTMLElement) btn.click();
  });
  await page.waitForSelector('#graph-whatif .meta-list', { timeout: 20000 });

  const panel = await page.evaluate(
    () => document.querySelector('#graph-whatif')?.innerText ?? '',
  );
  h.check(
    'WEB-07 what-if izin listesi var',
    /KALDIRILABİLİR DÜĞÜMLER/.test(panel),
    panel.slice(0, 140).replace(/\n/g, ' / '),
  );
  h.check(
    'WEB-07 what-if kenar/sonuc gerekceli',
    /Engellenen|KOPACAK|YALITILACAK/.test(panel),
    panel.slice(0, 200).replace(/\n/g, ' / '),
  );

  const sim = await h.api('/api/graph/what-if', {
    method: 'POST',
    body: JSON.stringify({ query: 'demo-tool' }),
  });
  h.check(
    'WEB-07 API eslesme donduruyor',
    (sim.body?.nodeIds ?? []).length > 0,
    `allowed=${sim.body?.result?.allowed?.length} blocked=${sim.body?.result?.blocked?.length}`,
  );

  await input.fill('zzz-olmayan-dugum');
  await page.evaluate(() => {
    const btn = document.querySelector('#graph-whatif button.primary');
    if (btn instanceof HTMLElement) btn.click();
  });
  await page.waitForTimeout(800);
  const noMatch = await page.evaluate(
    () => document.querySelector('#graph-whatif')?.innerText ?? '',
  );
  h.check('WEB-07 eslesmeyen sorgu bilgilendiriyor', /eşleş|bulunamadı|yok/i.test(noMatch), noMatch.slice(-120).replace(/\n/g, ' / '));

  h.check('WEB-07 konsol hatasi yok', errors.length === 0, errors.slice(0, 2).join(' | '));
}
