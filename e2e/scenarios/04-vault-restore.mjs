/**
 * WEB-04 — Kasa: geri yukleme, cakisma rozeti ve kasa listesi.
 *
 * Akis: tara → kumeyi plana ekle → TASI ile kasaya tasi → kasadan geri
 * yukle → dosya geri geldi mi. Ikinci turda hedef yol onceden doldurulur;
 * cakisma rozeti gorunmeli ve geri yukleme `.restored-*` adiyla yazmali.
 */
import { click, rail } from '../harness.mjs';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const title = 'WEB-04 kasa geri yukleme + cakisma';

/** Kume secip TASI ile kasaya tasir; kasa kaydini dondurur. */
async function moveToVault(h, page, cluster) {
  await rail(page, 'disk');
  await page.waitForSelector('.cluster-row', { timeout: 30000 });
  const name = cluster.key.split(':').pop();
  await page.locator(`.cluster-row:has(input[aria-label*="${name}"]) input[type="checkbox"]`).first().click();

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const body = (await h.api('/api/plan')).body ?? {};
    if ((body.plan?.clusters?.length ?? 0) > 0) break;
    await page.waitForTimeout(300);
  }
  await rail(page, 'plan');
  const phrase = page.locator('input[aria-label="Onay ifadesi"]').first();
  const needsPhrase = await phrase
    .waitFor({ state: 'visible', timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  if (needsPhrase) {
    await phrase.fill('TASI');
    await page.waitForTimeout(300);
  }
  await click(page, 'button.primary:has-text("Kasaya taşı")');

  const vaultDeadline = Date.now() + 60000;
  while (Date.now() < vaultDeadline) {
    const entries = (await h.api('/api/vault')).body?.entries ?? [];
    const hit = entries.find((e) => e.originalPath.toLowerCase().includes(name.toLowerCase()));
    if (hit) return hit;
    await page.waitForTimeout(400);
  }
  return null;
}

export async function run(h, { page, errors }) {
  const disk = await h.scanAndWait();
  const cache = (disk?.clusters ?? []).find((c) => /e2e-cache/.test(c.key));
  h.check('WEB-04 kasa icin kume bulundu', Boolean(cache), cache?.key ?? 'yok');
  if (!cache) return;

  const moved = await moveToVault(h, page, cache);
  h.check('WEB-04 kume kasaya tasindi', Boolean(moved), moved ? `${moved.originalPath}` : 'kayit yok');
  if (!moved) return;

  const sourceGone = !existsSync(moved.originalPath);
  h.check('WEB-04 kaynak yol kasadayken bos', sourceGone, moved.originalPath);

  await rail(page, 'vault');
  await page.waitForSelector('.vault table.table tbody tr', { timeout: 20000 });
  const rows = await page.locator('.vault table.table tbody tr').count();
  h.check('WEB-04 kasa listesi kaydi gosteriyor', rows > 0, `${rows} satir`);
  const badge = await page.locator('.vault .badge.warn').count();
  h.check('WEB-04 cakisma yokken rozet yok', badge === 0, `${badge} rozet`);

  await click(page, '.vault table.table tbody tr button.ghost');
  const restoreDeadline = Date.now() + 30000;
  let back = false;
  while (Date.now() < restoreDeadline) {
    back = existsSync(moved.originalPath);
    if (back) break;
    await page.waitForTimeout(300);
  }
  h.check('WEB-04 geri yukleme dosyayi geri getirdi', back, moved.originalPath);
  let dropped = false;
  const dropDeadline = Date.now() + 15000;
  while (Date.now() < dropDeadline) {
    const left = (await h.api('/api/vault')).body?.entries ?? [];
    if (!left.some((e) => e.id === moved.id)) {
      dropped = true;
      break;
    }
    await page.waitForTimeout(300);
  }
  h.check('WEB-04 geri yuklenen kayit kasadan dustu', dropped, dropped ? 'kayit cikti' : 'kayit kaldi');

  // Ikinci tur: ayni yolu geri getirip cakisma davranisini sinа.
  const again = await moveToVault(h, page, cache);
  h.check('WEB-04 ikinci tasima yapildi', Boolean(again), again?.id ?? 'yok');
  if (!again) return;

  // Ayni kume baska bir kopya olarak tasindiysa hedef hala bos; doldur.
  if (!existsSync(again.originalPath)) {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(join(again.originalPath, '..'), { recursive: true });
    writeFileSync(again.originalPath, 'occupied', 'utf8');
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await rail(page, 'vault');
  await page.waitForSelector('.vault table.table tbody tr', { timeout: 20000 });
  const conflict = await page.locator('.vault .badge.warn').count();
  h.check('WEB-04 cakisma rozeti gorunur', conflict > 0, `${conflict} rozet`);

  await click(page, '.vault table.table tbody tr button.ghost');
  const restoredName = join(again.originalPath, '..');
  const found = [];
  const dirDeadline = Date.now() + 30000;
  while (Date.now() < dirDeadline) {
    const names = readdirSync(restoredName).filter((n) => n.startsWith(`${'e2e-cache'}.restored-`) || /\.restored-/.test(n));
    found.push(...names);
    if (found.length > 0) break;
    await page.waitForTimeout(300);
  }
  h.check('WEB-04 cakismada .restored-* adi kullanildi', found.length > 0, found.slice(0, 2).join(' | ') || 'yok');

  h.check('WEB-04 konsol hatasi yok', errors.length === 0, errors.slice(0, 2).join(' | '));
}
