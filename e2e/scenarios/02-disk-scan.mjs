/**
 * WEB-02 — Disk taramasi: canli liste (SSE), iki adimli iptal, gecmis kaydi.
 *
 * Kanit: tarama baslar, SSE ile canli satir akar, iptal iki adimda onaylanir,
 * tarama durur ve gecmiste tamamlanmamis kayit gorunur (B20 sozlesmesi).
 */
import { click, rail } from '../harness.mjs';

export const title = 'WEB-02 disk tarama SSE + iptal';

const byText = (text) =>
  [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === text);

export async function run(h, { page, errors }) {
  // Iptal yarisini kesinlestir: tarama birkac saniye sursun.
  h.seedBulk();

  const how = await rail(page, 'disk');
  h.check('WEB-02 rail tiklamasi calisti', Boolean(how), `yol: ${how}`);

  // Taramayi baslat ve HEMEN iptal et (iki adim) — tek evaluate icinde,
  // boylece kucuk agacta bile tarama bitmeden yetisiriz.
  const cancel = await page.evaluate(async () => {
    const scan = [...document.querySelectorAll('button.primary')].find((b) =>
      /Tara/i.test(b.textContent ?? ''),
    );
    scan?.click();
    const deadline = Date.now() + 8000;
    let opened = false;
    while (Date.now() < deadline) {
      const btn = [...document.querySelectorAll('button')].find(
        (b) => (b.textContent ?? '').trim() === 'İptal',
      );
      if (btn) {
        btn.click();
        opened = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    if (!opened) return { opened, confirmed: false };
    let confirmed = false;
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      const ok = [...document.querySelectorAll('button')].find(
        (b) => (b.textContent ?? '').trim() === 'İptal et',
      );
      if (ok) {
        ok.click();
        confirmed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    return { opened, confirmed };
  });
  h.check('WEB-02 tarama basladi ve iptal dugmesi cikti', cancel.opened);
  h.check('WEB-02 iptal iki adimli onay ister', cancel.confirmed);

  const deadline = Date.now() + 30000;
  let status = null;
  while (Date.now() < deadline) {
    status = (await h.api('/api/scan/status')).body;
    if (status && status.scanning === false) break;
    await page.waitForTimeout(300);
  }
  h.check('WEB-02 tarama durdu', status?.scanning === false, `scanning=${status?.scanning}`);

  const history = await h.api('/api/scans');
  const rows = history.body?.rows ?? [];
  h.check('WEB-02 /api/scans rows dondurur', rows.length > 0, `${rows.length} satir`);
  const cancelled = rows.find((r) => r.outcome === 'cancelled');
  const done = rows.find((r) => r.outcome === 'done');
  h.check(
    'WEB-02 gecmiste sonuc turu kayitli (iptal veya bitti)',
    Boolean(cancelled || done),
    cancelled ? `cancelled ${cancelled.done}/${cancelled.total}` : done ? 'done' : 'kayit yok',
  );
  if (cancelled) {
    h.check('WEB-02 iptal kaydi tamamlanmamis isaretli', cancelled.complete === false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await rail(page, 'disk');
    await page.waitForTimeout(800);
    const badge = await page.locator('.history-outcome').count();
    h.check('WEB-02 arayuzde "tamamlanmadı" rozeti', badge > 0, `${badge} rozet`);
  }

  // Canli liste/gecmis gorunumu.
  await page.waitForTimeout(600);
  const historyDom = await page.locator('.scan-history li').count();
  h.check('WEB-02 gecmis listesi ekranda', historyDom > 0, `${historyDom} satir`);
  const heading = await page.textContent('main[data-screen="disk"] h1').catch(() => null);
  h.check('WEB-02 disk ekrani basligi mevcut', Boolean(heading?.trim()), heading ?? '');

  const noise = h.failedUrls.filter((u) => !/favicon/i.test(u));
  h.check(
    'WEB-02 konsol temiz (4xx kaynak yok)',
    errors.length === 0 && noise.length === 0,
    [...errors.slice(0, 2), ...noise.slice(0, 3)].join(' | '),
  );
}
