/**
 * E2E harness — gercek sunucu + gercek tarayici (Edge/Chrome), izole veri dizini.
 *
 * Amac: WEB-02..08/10/11/13/14/16 senaryolarini otomatik kosmak. Tarayici
 * olarak KURULU Edge kullanilir (`playwright-core` + `channel: 'msedge'`),
 * indirme yok. Sunucu her kosuda gecici bir veri diziniyle baslar; boylece
 * kullanicinin kasa/gunluk/ayar dosyalarina dokunulmaz.
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs, { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT_BASE = 4610;

/** Dosya/dizin zamanlarini geriye alir (eski dosya kurallari icin). */
function backdate(dir, stamp, depth = 0) {
  const { readdirSync, statSync, utimesSync } = fs;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory() && depth < 6) backdate(p, stamp, depth + 1);
    utimesSync(p, stamp, stamp);
  }
}

export class Harness {
  constructor(opts = {}) {
    // Onemli: dizin Temp ALTINDA olmamali — `Temp` yolu her kumeyi "gecici
    // dosyalar" (safe) yapar ve orta/yuksek riskli onay yollarini sinayamayiz.
    const base = process.env.LOCALAPPDATA ?? tmpdir();
    this.dir = mkdtempSync(join(base, 'residue-e2e-'));
    this.local = join(this.dir, 'Local');
    this.roaming = join(this.dir, 'Roaming');
    this.userprofile = join(this.dir, 'User');
    this.port = opts.port ?? PORT_BASE + Math.floor(Math.random() * 60);
    this.base = `http://127.0.0.1:${this.port}`;
    this.server = null;
    this.browser = null;
    this.checks = [];
    this.failedUrls = [];
  }

  /** Tarama baslatir ve bitmesini bekler; /api/disk govdesini dondurur. */
  async scanAndWait(timeoutMs = 90000) {
    const started = await this.api('/api/scan', {
      method: 'POST',
      body: JSON.stringify({ envs: ['localappdata', 'roamingappdata', 'dotfolders'], exclude: [], minAgeDays: 0 }),
    });
    if (started.status >= 400) throw new Error(`tarama baslamadi: ${JSON.stringify(started.body)}`);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = (await this.api('/api/scan/status')).body;
      if (status && status.scanning === false && (status.clusters ?? 0) > 0) {
        return (await this.api('/api/disk')).body;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error('tarama zaman asimi');
  }

  /** Kumenin ilk silinebilir hedef yolunu (varsa) dondurur. */
  async clusterKey(pattern) {
    const disk = (await this.api('/api/disk')).body;
    const rows = disk?.clusters ?? [];
    const hit = rows.find((c) => new RegExp(pattern, 'i').test(`${c.key} ${c.title}`));
    return hit ?? null;
  }

  /** Tarama icin sahte "home" kurar (salt okunur veri, gercek ev dizini degil). */
  seedDisk() {
    const mk = (p) => mkdirSync(p, { recursive: true });
    const w = (p, body) => {
      mk(join(p, '..'));
      writeFileSync(p, body, 'utf8');
    };
    // Onbellek kanitlari (CACHEDIR.TAG + dosyalar)
    const cache = join(this.local, 'e2e-cache', 'pkg');
    mk(cache);
    w(join(this.local, 'e2e-cache', 'CACHEDIR.TAG'), 'Signature: 8a477f597d28d172789f06886806bc55\n');
    for (let i = 0; i < 40; i += 1) {
      w(join(cache, `blob-${i}.bin`), 'x'.repeat(256));
    }
    // NuGet benzeri paket deposu
    const nuget = join(this.userprofile, '.nuget', 'packages', 'demo.pkg', '1.2.3');
    mk(nuget);
    w(join(nuget, 'demo.pkg.nuspec'), '<package/>');
    w(join(nuget, 'demo.pkg.1.2.3.nupkg'), 'zip');
    // Iptal yolunu sinayabilmek icin taramayi birkaç saniye surdurecek hacim
    for (let d = 0; d < 24; d += 1) {
      const dir = join(this.local, 'e2e-vol', `chunk-${d}`, 'cache');
      mk(dir);
      w(join(dir, '..', 'CACHEDIR.TAG'), 'Signature: 8a477f597d28d172789f06886806bc55\n');
      for (let i = 0; i < 60; i += 1) w(join(dir, `f-${i}.bin`), 'y'.repeat(512));
    }
    // Eski surum klasoru + Update.exe (surumlu uygulama deposu)
    for (const v of ['app-1.0.0', 'app-2.0.0']) {
      const d = join(this.local, 'e2e-app', v);
      mk(join(d, 'resources', 'app'));
      w(join(d, 'Update.exe'), 'MZ');
      w(join(d, 'resources', 'app', 'package.json'), '{"name":"e2e-app"}');
      w(join(d, 'icudtl.dat'), 'x');
    }
    // npm onbellegi (_cacache sémasi) — orta riskli, yazili onay isteyen yol
    const npmCache = join(this.local, 'npm-cache', '_cacache');
    mk(join(npmCache, 'index-v5', 'aa', 'bb'));
    w(join(npmCache, 'index-v5', 'aa', 'bb', 'hash-1'), '{"key":"demo"}');
    w(join(npmCache, 'content-v2', 'sha512', 'aa', 'bb', 'blob'), 'z'.repeat(1024));
    // Vektor/embedding deposu — ORTA risk, yazili onay isteyen yol (WEB-03)
    const vector = join(this.local, 'vector-store');
    mk(join(vector, '7f3e9c1a-2b44-4d8e-9a11-3c5d6e7f8a90'));
    w(join(vector, 'index.faiss'), 'FAISS');
    w(join(vector, '7f3e9c1a-2b44-4d8e-9a11-3c5d6e7f8a90', 'meta.json'), '{"dim":768}');
    // Global paket kurulumu + yarim kalmis gizli artik — ORTA risk, plana
    // eklenebilir (WEB-03). Artik 1 gunden eski olmali (backdate saglar).
    const gnm = join(this.roaming, 'npm', 'node_modules');
    mk(join(gnm, 'demo-tool'));
    w(
      join(gnm, 'demo-tool', 'package.json'),
      '{"name":"demo-tool","version":"1.0.0","bin":{"demo-tool":"./cli.js"}}',
    );
    w(join(gnm, 'demo-tool', 'cli.js'), 'console.log("demo")\n');
    w(join(this.roaming, 'npm', 'demo-tool.cmd'), '@echo off\r\nnode "%~dp0node_modules\\demo-tool\\cli.js" %*\r\n');
    w(join(this.roaming, 'npm', 'demo-tool.ps1'), '#!/usr/bin/env pwsh\n');
    mk(join(gnm, '.demo-tool-a1b2c3d4'));
    w(join(gnm, '.demo-tool-a1b2c3d4', 'package.json'), '{"name":"demo-tool"}');
    // Aday B: kok node_modules (T37 kaniti kokte gorulur)
    const gnm2 = join(this.roaming, 'demo-global', 'node_modules');
    mk(join(gnm2, 'other-tool'));
    w(join(gnm2, 'other-tool', 'package.json'), '{"name":"other-tool","version":"2.0.0"}');
    mk(join(gnm2, '.other-tool-b1c2d3e4'));
    w(join(gnm2, '.other-tool-b1c2d3e4', 'package.json'), '{"name":"other-tool"}');
    // Ortam havuzu — ORTA risk, 90 gunden eski ortam hedeflenir (WEB-03)
    const pool = join(this.local, 'demo-envs', 'envs', 'demo-env');
    mk(join(pool, 'Lib', 'site-packages', 'demo_pkg'));
    w(join(pool, 'pyvenv.cfg'), 'home = C:\\Python\\3.12\n');
    w(join(pool, 'Lib', 'site-packages', 'demo_pkg', '__init__.py'), '');
    // Ajan calisma alani (kullanici degeri; silme hedefi OLMAMALI)
    const skill = join(this.userprofile, '.agents', 'skills', 'demo');
    mk(skill);
    w(join(skill, 'SKILL.md'), '# demo\n');
    // Gecmis zaman: "eski dosya" kurallari (Temp 3 gun) hedef uretebilsin.
    const stamp = new Date(Date.now() - 40 * 24 * 3600 * 1000);
    backdate(this.dir, stamp);
    // Ortam havuzu hedefi 90 gunden eski olmali (runtime-pool kurali).
    const older = new Date(Date.now() - 120 * 24 * 3600 * 1000);
    const envDir = join(this.local, 'demo-envs', 'envs', 'demo-env');
    if (existsSync(envDir)) backdate(envDir, older);
  }

  /**
   * Iptal yarisini kesinlestirmek icin ek hacim. Yalniz WEB-02 kullanir;
   * varsayilan fixture kucuk kalsin diye ayri tutuldu (diger senaryolar
   * saniyeler degil, yuz milisaniyeler icinde taransin).
   */
  seedBulk(dirs = 40, perDir = 150) {
    const mk = (p) => mkdirSync(p, { recursive: true });
    for (let d = 0; d < dirs; d += 1) {
      const base = join(this.local, 'e2e-bulk', `bulk-${d}`);
      const cache = join(base, 'cache');
      mk(cache);
      writeFileSync(
        join(base, 'CACHEDIR.TAG'),
        'Signature: 8a477f597d28d172789f06886806bc55\n',
        'utf8',
      );
      for (let i = 0; i < perDir; i += 1) {
        writeFileSync(join(cache, `b-${i}.bin`), 'b'.repeat(128), 'utf8');
      }
    }
    backdate(join(this.local, 'e2e-bulk'), new Date(Date.now() - 40 * 24 * 3600 * 1000));
  }

  async start() {
    this.seedDisk();
    const env = {
      ...process.env,
      LOCALAPPDATA: this.local,
      APPDATA: this.roaming,
      USERPROFILE: this.userprofile,
      RESIDUE_E2E: '1',
    };
    this.server = spawn(
      process.execPath,
      ['bin/residue.mjs', 'ui', '--web', '--no-browser', '--port', String(this.port)],
      { env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    this.serverLog = '';
    this.server.stdout.on('data', (d) => {
      this.serverLog += d.toString();
    });
    this.server.stderr.on('data', (d) => {
      this.serverLog += d.toString();
    });
    await this.waitForServer();
    return this;
  }

  async waitForServer(timeoutMs = 60000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        const res = await fetch(`${this.base}/`);
        if (res.ok) {
          const raw = res.headers.getSetCookie?.() ?? [];
          this.cookies = raw.map((c) => c.split(';')[0]).join('; ');
          return;
        }
      } catch {
        // sunucu henuz acilmadi
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`sunucu acilmadi (${this.port})\n${this.serverLog.slice(-2000)}`);
  }

  async open(opts = {}) {
    const channels = ['msedge', 'chrome'];
    const wanted = opts.channel ?? channels[0];
    this.browser = await chromium.launch({
      channel: wanted,
      headless: opts.headless ?? true,
      args: ['--no-first-run', '--disable-features=Translate,msEdgeIdentity'],
    });
    const context = await this.browser.newContext({
      viewport: { width: opts.width ?? 1440, height: opts.height ?? 900 },
      locale: opts.locale ?? 'tr-TR',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      // Kaynak yukleme hatalari ayrica `failedUrls` ile izlenir (favicon vb.).
      if (/Failed to load resource/i.test(text)) return;
      errors.push(text);
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('response', (r) => {
      if (r.status() < 400) return;
      const url = r.url();
      // Iptal yarisi: tarama, iptal isteginden once bittiyse 409 doner.
      // Bu beklenen bir catismadir (UI zaten "bitti" durumuna gecer), hata degil.
      if (r.status() === 409 && /\/api\/scan\/[^/]+\/cancel$/.test(url)) return;
      this.failedUrls.push(`${r.status()} ${url}`);
    });
    await page.goto(this.base, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('nav.rail', { state: 'visible', timeout: 30000 });
    // Ilk acilis profili: diyalog kapatilmadan hicbir tik gerceklesmez.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const onboarding = page.locator('.onboarding-dialog .primary');
      const seen = await onboarding
        .waitFor({ state: 'visible', timeout: attempt === 0 ? 8000 : 1500 })
        .then(() => true)
        .catch(() => false);
      if (!seen) break;
      await onboarding.click({ timeout: 3000 }).catch(async () => {
        await onboarding.evaluate((el) => el.click());
      });
      const gone = await page
        .waitForSelector('.onboarding-backdrop', { state: 'detached', timeout: 8000 })
        .then(() => true)
        .catch(() => false);
      if (gone) break;
    }
    return { page, context, errors };
  }

  async api(path, init = {}) {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', cookie: this.cookies, ...(init.headers ?? {}) },
    });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: res.status, body };
  }

  check(name, ok, detail) {
    this.checks.push({ name, ok: Boolean(ok), detail: detail ?? '' });
    const mark = ok ? 'PASS' : 'FAIL';
    console.log(`  ${mark}  ${name}${detail ? ` — ${detail}` : ''}`);
  }

  async stop() {
    try {
      await this.browser?.close();
    } catch {
      // kapanmis olabilir
    }
    if (this.server && !this.server.killed) {
      this.server.kill();
      await new Promise((r) => setTimeout(r, 300));
      if (existsSync(this.dir)) {
        // gecici dizin; temizlik en iyi caba
      }
    }
  }

  summary() {
    const failed = this.checks.filter((c) => !c.ok);
    return { total: this.checks.length, failed: failed.length, failedNames: failed.map((f) => f.name) };
  }
}

/** Ekranda gorunen metni bekler (i18n'den bagimsiz senaryolar icin). */
export async function waitText(page, selector, text, timeout = 15000) {
  await page.waitForFunction(
    ({ selector: sel, text: want }) => {
      const nodes = [...document.querySelectorAll(sel)];
      return nodes.some((n) => (n.textContent ?? '').includes(want));
    },
    { selector, text },
    { timeout },
  );
}

/** Tiklama: normal yol dener, kararsiz duzende evaluate ile devam eder. */
export async function click(page, selector, opts = {}) {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'attached', timeout: opts.timeout ?? 20000 });
  try {
    await loc.click({ timeout: opts.timeout ?? 8000 });
    return 'pointer';
  } catch {
    await loc.evaluate((el) => el.click());
    return 'evaluate';
  }
}

export async function rail(page, screen) {
  const how = await click(page, `button.rail-item[data-screen="${screen}"]`);
  await page.waitForSelector(`main[data-screen="${screen}"]`, { timeout: 30000 });
  return how;
}
