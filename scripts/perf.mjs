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
const { SCAN_EVENT_BUFFER } = await imp(join(projectRoot, 'src/services/scan-service.ts'));
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
  // LOAD-02 — disk gorunumu 5000 kume + JSON
  // ============================================================
  console.log('\n=== LOAD-02 disk gorunumu (5000 kume) ===');
  const clusters5k = Array.from({ length: 5000 }, (_, i) => makeCluster(i));
  const dv5Times = [];
  let load5000PayloadBytes = 0;
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    const v = new DiskView(clusters5k, []).view();
    const payload = JSON.stringify(v);
    dv5Times.push(performance.now() - t0);
    if (i === 0) load5000PayloadBytes = Buffer.byteLength(payload, 'utf8');
  }
  const dv5Sorted = [...dv5Times].sort((a, b) => a - b);
  const dv5P95b = percentile(dv5Sorted, 0.95);
  results.load5000DiskViewP95Ms = dv5P95b;
  const load5000PayloadMb = load5000PayloadBytes / (1024 * 1024);
  results.load5000PayloadMb = load5000PayloadMb;
  console.log(`kosular: ${dv5Times.map((t) => t.toFixed(2)).join(', ')} ms`);
  console.log(`p95 (10 kosu, 10. deger): ${dv5P95b.toFixed(2)} ms`);
  console.log(`payload: ${load5000PayloadMb.toFixed(2)} MB`);
  checkBudget('load5000DiskViewP95Ms', dv5P95b, 'max');
  checkBudget('load5000PayloadMb', load5000PayloadMb, 'max');


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
  // LOAD-03 — SSE tamponu ve Last-Event-ID replay
  // ============================================================
  console.log('\n=== LOAD-03 SSE replay (400 kume) ===');
  const sseRoot = await mkdtemp(join(tmpdir(), 'residue-perf-sse-'));
  const SSE_FOLDERS = 400;
  for (let i = 0; i < SSE_FOLDERS; i++) {
    const dir = join(sseRoot, `c${i}`);
    await mkdir(join(dir, 'Cache'), { recursive: true });
    await writeFile(join(dir, 'CACHEDIR.TAG'), 'Signature: 8a477f597d28d172789f06886806bc55\n');
    for (let j = 0; j < 3; j++) await writeFile(join(dir, 'Cache', `f${j}.bin`), 'x'.repeat(1024));
  }

  const { server: sseServer, token: sseToken } = createApiServer({ persistScan: false, envs: [] });
  await new Promise((ok, fail) => { sseServer.once('error', fail); sseServer.listen(0, '127.0.0.1', () => ok()); });
  const ssePort = sseServer.address().port;
  const sseBase = `http://127.0.0.1:${ssePort}`;

  async function readSSEEvents(url, lastId) {
    const headers = { 'x-residue-token': sseToken };
    if (lastId !== undefined && lastId !== null) headers['last-event-id'] = String(lastId);
    const res = await fetch(url, { headers });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const out = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let id;
        const dataLines = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('id:')) id = Number(line.slice(3).trim());
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length) {
          try { out.push({ id, data: JSON.parse(dataLines.join('\n')) }); } catch {}
        }
      }
    }
    return out;
  }

  const startRes = await fetch(`${sseBase}/api/scan`, {
    method: 'POST',
    headers: { 'x-residue-token': sseToken, 'content-type': 'application/json' },
    body: JSON.stringify({ roots: [sseRoot] }),
  });
  const startJson = await startRes.json();
  const scanId = startJson.scanId;

  const eventsUrl = `${sseBase}/api/scan/${scanId}/events`;
  const allEvents = await readSSEEvents(eventsUrl);
  const ids = allEvents.map((e) => e.id);
  const N = ids.length ? ids[ids.length - 1] : 0;
  results.sseEventCount = allEvents.length;
  console.log(`toplam olay: ${allEvents.length}, son id: ${N}`);

  let monotonic = true;
  for (let i = 1; i < ids.length; i++) if (ids[i] <= ids[i - 1]) monotonic = false;
  if (allEvents.length < 2000) fail(`LOAD-03: toplam olay ${allEvents.length} < 2000`);
  else ok('LOAD-03: toplam olay >= 2000');
  if (!monotonic) fail('LOAD-03: kimlikler artan degil');
  else ok('LOAD-03: kimlikler 1..N artan');

  const replayTimes = [];
  let replayBad = 0;
  for (let r = 0; r < 5; r++) {
    const t0 = performance.now();
    const evs = await readSSEEvents(eventsUrl, N - 1000);
    const dt = performance.now() - t0;
    replayTimes.push(dt);
    if (evs.length !== 1000) { replayBad++; fail(`LOAD-03 replay ${r}: ${evs.length} olay (1000 beklenen)`); continue; }
    let okIds = true;
    for (let i = 0; i < evs.length; i++) {
      if (evs[i].id !== (N - 999 + i)) okIds = false;
    }
    if (!okIds) { replayBad++; fail(`LOAD-03 replay ${r}: kimlikler yanlis`); }
  }
  const replayP95 = p95Of(replayTimes);
  results.load1kReplayP95Ms = replayP95;
  console.log(`replay sureleri: ${replayTimes.map((t) => t.toFixed(1)).join(', ')} ms`);
  console.log(`replay p95: ${replayP95.toFixed(1)} ms`);
  if (replayBad === 0) ok('LOAD-03: replay 5/5 tam 1000 olay');
  checkBudget('load1kReplayP95Ms', replayP95, 'max');

  // Tampon tavani: replay edilebilen ilk kimlik N - (SCAN_EVENT_BUFFER - 1).
  // Tam tampon kadar geri istenirse SCAN_EVENT_BUFFER olay donmeli.
  const capEvents = await readSSEEvents(eventsUrl, N - SCAN_EVENT_BUFFER);
  const capFirst = N - SCAN_EVENT_BUFFER + 1;
  if (capEvents.length !== SCAN_EVENT_BUFFER) {
    fail(`LOAD-03 tavan: ${capEvents.length} olay (${SCAN_EVENT_BUFFER} beklenen)`);
  } else if (capEvents[0].id !== capFirst || capEvents[capEvents.length - 1].id !== N) {
    fail(`LOAD-03 tavan: kimlik araligi ${capEvents[0].id}..${capEvents[capEvents.length - 1].id} (${capFirst}..${N} beklenen)`);
  } else {
    ok(`LOAD-03: tavan ${SCAN_EVENT_BUFFER} olay (${capFirst}..${N})`);
  }

  // Tamponun bir olay disina dusen istek replay etmez, anlik gorunum doner.
  const staleEvents = await readSSEEvents(eventsUrl, N - SCAN_EVENT_BUFFER - 1);
  if (staleEvents.length === 0) fail('LOAD-03 tampon disi: yanit bos');
  else if (staleEvents[0].data?.type !== 'progress') {
    fail(`LOAD-03 tampon disi: ilk olay ${staleEvents[0].data?.type} (progress beklenen)`);
  } else {
    ok('LOAD-03: tampon disi istek anlik gorunum aldi');
  }

  sseServer.closeAllConnections?.();
  await new Promise((resolve) => sseServer.close(resolve));
  await rm(sseRoot, { recursive: true, force: true });

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
