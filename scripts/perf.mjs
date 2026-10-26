#!/usr/bin/env node
/**
 * PERF / LOAD olcum betigi (W0-b-3).
 *
 *   npm run perf
 *
 * Olcer, scripts/perf-budget.json ile karsilastirir, tablo basar.
 * Butce asilirsa exit 1. Gercek kullanici dizinine dokunmaz:
 * tum env LOCALAPPDATA/APPDATA/USERPROFILE/TEMP/TMP sandbox'a cevrilir
 * ve cikista geri yazilir.
 */
import { performance } from 'node:perf_hooks';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir, cpus, platform, freemem, totalmem } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
// Windows path normalize
const projectRoot = process.cwd();

// ---------- env sandbox ----------
const SANDBOX_KEYS = ['LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'TEMP', 'TMP', 'HOME', 'npm_config_prefix'];
const origEnv = {};
for (const k of SANDBOX_KEYS) origEnv[k] = process.env[k];

const systemTmp = tmpdir();
const sandbox = await mkdtemp(join(systemTmp, 'residue-perf-env-'));
for (const k of SANDBOX_KEYS) process.env[k] = sandbox;

const cleanupEnv = async () => {
  for (const k of SANDBOX_KEYS) {
    if (origEnv[k] === undefined) delete process.env[k];
    else process.env[k] = origEnv[k];
  }
  await rm(sandbox, { recursive: true, force: true }).catch(() => {});
};

let failures = 0;
function fail(msg) { console.log(`FAIL  ${msg}`); failures += 1; }
function ok(msg) { console.log(`OK    ${msg}`); }

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[idx];
}

function p95Of(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return percentile(s, 0.95);
}

function fmtMs(n) { return `${n.toFixed(1)} ms`; }
function fmtMb(n) { return `${n.toFixed(1)} MB`; }

// ---------- imports (after env sandbox) ----------
const imp = (p) => import(pathToFileURL(p).href);
const { runScan } = await imp(join(projectRoot, 'src/commands/scan.ts'));
const { DiskView } = await imp(join(projectRoot, 'src/core/disk-view.ts'));
const { deleteTarget } = await imp(join(projectRoot, 'src/actions/delete.ts'));
const { createApiServer } = await imp(join(projectRoot, 'src/web/server.ts'));
const { Cluster } = {}; // type only, unused

// ---------- budget read ----------
const budgetPath = join(projectRoot, 'scripts/perf-budget.json');
let budget;
try {
  budget = JSON.parse(await readFile(budgetPath, 'utf8'));
} catch (e) {
  console.error(`Butce dosyasi okunamadi: ${budgetPath}`);
  console.error(e.message);
  await cleanupEnv();
  process.exit(1);
}

function checkBudget(key, actual, mode = 'max') {
  // mode: 'max' actual <= budget; 'min' actual >= budget
  const b = budget?.budgets?.[key];
  if (typeof b !== 'number' || !Number.isFinite(b) || b <= 0) {
    fail(`${key}: butce eksik/gecersiz (${b})`);
    return;
  }
  if (mode === 'max') {
    if (actual > b) fail(`${key}: ${actual.toFixed(2)} > butce ${b}`);
    else ok(`${key}: ${actual.toFixed(2)} <= ${b}`);
  } else {
    if (actual < b) fail(`${key}: ${actual.toFixed(2)} < butce ${b}`);
    else ok(`${key}: ${actual.toFixed(2)} >= ${b}`);
  }
}

const results = {};

try {
  // ============================================================
  // PERF-01 — tarama 10k dosya
  // ============================================================
  console.log('\n=== PERF-01 tarama (10k dosya) ===');
  const scanRoot = await mkdtemp(join(tmpdir(), 'residue-perf-scan-'));
  const FOLDERS = 200;
  const FILES = 50;
  for (let i = 0; i < FOLDERS; i++) {
    const dir = join(scanRoot, `d${i}`);
    await mkdir(dir, { recursive: true });
    for (let j = 0; j < FILES; j++) {
      await writeFile(join(dir, `f${j}.txt`), 'x'.repeat(1024));
    }
    if (i < 20) await writeFile(join(dir, 'CACHEDIR.TAG'), 'Signature: 8a477f597d28d172789f06886806bc55\n');
  }

  const scanTimes = [];
  const rssBeforeScan = process.memoryUsage().rss;
  for (let run = 0; run < 3; run++) {
    const t0 = performance.now();
    await runScan({
      envs: [],
      minAgeDays: 0,
      json: true,
      includeBytes: true,
      exclude: [],
      quiet: true,
      roots: [scanRoot],
    });
    scanTimes.push(performance.now() - t0);
  }
  const rssAfterScan = process.memoryUsage().rss;
  const scanP95 = p95Of(scanTimes); // max for n=3
  const scanRssMb = (rssAfterScan - rssBeforeScan) / (1024 * 1024);
  results.scan10kMs = scanP95;
  results.scan10kRssMb = scanRssMb;
  console.log(`kosular: ${scanTimes.map((t) => t.toFixed(1)).join(', ')} ms`);
  console.log(`p95 (max, n=3): ${scanP95.toFixed(1)} ms`);
  console.log(`RSS artisi: ${scanRssMb.toFixed(1)} MB`);
  checkBudget('scan10kMs', scanP95, 'max');
  checkBudget('scan10kRssMb', scanRssMb, 'max');

  await rm(scanRoot, { recursive: true, force: true });

  // ============================================================
  // PERF-02 — disk gorunumu 100 kume + JSON
  // ============================================================
  console.log('\n=== PERF-02 disk gorunumu (100 kume) ===');
  function makePart(i) {
    return { path: `/p/${i}`, bytes: 1000, files: 5, lastTouched: Date.now(), reclaimableBytes: 500, origin: 'custom' };
  }
  function makeTarget(i) {
    return { path: `/t/${i}`, kind: 'whole', label: 'x', bytes: 100 };
  }
  function makeCluster(i) {
    return {
      key: `k${i}`,
      title: `Cluster ${i}`,
      archetype: 'pkg-manager-cache',
      parts: [makePart(0), makePart(1), makePart(2)],
      deleteTargets: [makeTarget(0), makeTarget(1)],
      totalBytes: 3000,
      reclaimableBytes: 1000,
      lastTouched: Date.now(),
      evidence: {},
      verdict: {
        risk: 'safe',
        kind: 'recommend',
        title: 't',
        what: 'w',
        consequence: 'c',
        because: [],
        preconditions: [],
        regenerability: 'regenerable',
        confidence: 'high',
      },
    };
  }
  const clusters = Array.from({ length: 100 }, (_, i) => makeCluster(i));
  const dvTimes = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    const v = new DiskView(clusters, []).view();
    JSON.stringify(v);
    dvTimes.push(performance.now() - t0);
  }
  const dvSorted = [...dvTimes].sort((a, b) => a - b);
  const dvP95 = dvSorted[18]; // 19. olcum
  results.diskView100P95Ms = dvP95;
  console.log(`kosular: ${dvTimes.map((t) => t.toFixed(2)).join(', ')} ms`);
  console.log(`p95 (19/20): ${dvP95.toFixed(2)} ms`);
  checkBudget('diskView100P95Ms', dvP95, 'max');

  // ============================================================
  // PERF-03 — kasa tasima hizi
  // ============================================================
  console.log('\n=== PERF-03 kasa tasima (200 dosya) ===');
  const vaultRoot = await mkdtemp(join(tmpdir(), 'residue-perf-vault-'));
  const vdir = join(vaultRoot, 'target');
  await mkdir(vdir, { recursive: true });
  const FILE_COUNT = 200;
  for (let i = 0; i < FILE_COUNT; i++) {
    await writeFile(join(vdir, `f${i}.bin`), 'x'.repeat(4096));
  }
  const target = { path: vdir, kind: 'whole', label: 'perf', bytes: FILE_COUNT * 4096 };
  const t0v = performance.now();
  const vres = await deleteTarget(target, 'recycle');
  const vElapsed = performance.now() - t0v;
  const filesPerSec = FILE_COUNT / (vElapsed / 1000);
  results.vaultFilesPerSecMin = filesPerSec;
  console.log(`sure: ${vElapsed.toFixed(1)} ms, ${filesPerSec.toFixed(1)} dosya/sn`);
  console.log(`hata: ${vres.failed.length}, atlanan: ${vres.skipped.length}`);
  if (vres.failed.length !== 0) fail(`PERF-03: ${vres.failed.length} hata`);
  else ok('PERF-03: hata yok');
  checkBudget('vaultFilesPerSecMin', filesPerSec, 'min');

  await rm(vaultRoot, { recursive: true, force: true });

  // ============================================================
  // LOAD-01 — 100k dosya taramasi
  // ============================================================
  console.log('\n=== LOAD-01 tarama (100k dosya) ===');
  const loadRoot = await mkdtemp(join(tmpdir(), 'residue-perf-load-'));
  const LDIRS = 1000;
  const LFILES = 100;
  for (let i = 0; i < LDIRS; i++) {
    const dir = join(loadRoot, `d${i}`);
    await mkdir(dir, { recursive: true });
    for (let j = 0; j < LFILES; j++) {
      await writeFile(join(dir, `f${j}.txt`), '');
    }
  }
  const rssBeforeLoad = process.memoryUsage().rss;
  const t0l = performance.now();
  await runScan({
    envs: [],
    minAgeDays: 0,
    json: true,
    includeBytes: true,
    exclude: [],
    quiet: true,
    roots: [loadRoot],
  });
  const loadElapsed = performance.now() - t0l;
  const rssAfterLoad = process.memoryUsage().rss;
  const loadRssMb = (rssAfterLoad - rssBeforeLoad) / (1024 * 1024);
  results.load100kMs = loadElapsed;
  results.load100kRssMb = loadRssMb;
  console.log(`sure: ${loadElapsed.toFixed(1)} ms`);
  console.log(`RSS artisi: ${loadRssMb.toFixed(1)} MB`);
  checkBudget('load100kMs', loadElapsed, 'max');
  checkBudget('load100kRssMb', loadRssMb, 'max');

  await rm(loadRoot, { recursive: true, force: true });

  // ============================================================
  // LOAD-04 — 10 eszamanli istek
  // ============================================================
  console.log('\n=== LOAD-04 eszamanli istek (10) ===');
  const { server, token } = createApiServer({ persistScan: false });
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => ok());
  });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const reqTimes = [];
  let bad = 0;
  const jobs = Array.from({ length: 10 }, (_, i) => async () => {
    const path = i % 2 === 0 ? '/api/meta' : '/api/disk';
    const t0r = performance.now();
    const res = await fetch(`${base}${path}`, { headers: { 'x-residue-token': token } });
    const dt = performance.now() - t0r;
    reqTimes.push(dt);
    if (res.status !== 200) bad += 1;
    await res.arrayBuffer();
  });
  await Promise.all(jobs.map((j) => j()));
  const reqP95 = p95Of(reqTimes);
  results.load04P95Ms = reqP95;
  console.log(`istek sureleri: ${reqTimes.map((t) => t.toFixed(1)).join(', ')} ms`);
  console.log(`p95: ${reqP95.toFixed(1)} ms; hatali: ${bad}`);
  if (bad > 0) fail(`LOAD-04: ${bad} istek 200 disi`);
  else ok('LOAD-04: tumu 200');
  await new Promise((resolve) => server.close(resolve));

  console.log('\n=== OZET ===');
  console.log(JSON.stringify(results, null, 2));

} catch (e) {
  console.error('HATA:', e && e.stack ? e.stack : e);
  failures += 1;
} finally {
  await cleanupEnv();
}

console.log(failures === 0 ? '\nPERF TEMIZ' : `\nPERF BASARISIZ (${failures})`);
process.exitCode = failures === 0 ? 0 : 1;
