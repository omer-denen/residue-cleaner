import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { ScanHistory } from '../src/core/scan-history.ts';
import type { ScanHistoryEntry } from '../src/core/contract.ts';

/**
 * B20 — iptal/hata edilen tarama gecmiste "tamamlanmadi" olarak gorunur.
 *
 * Kural: siniflandirma MOTORDA (`ScanHistory.rows`), arayuz yalniz
 * `complete` alanina gore etiket secer (AGENTS.md kural 18).
 */

function entry(id: string, at: number, extra: Partial<ScanHistoryEntry> = {}): ScanHistoryEntry {
  return {
    id,
    at,
    clusters: 2,
    files: 10,
    bytes: 1000,
    deletableBytes: 400,
    targets: 3,
    ...extra,
  };
}

test('B20-1: summarize done kaydinda outcome yazar, progress eklemez', () => {
  const e = ScanHistory.summarize(
    { finishedAt: 5, clusters: 1, files: 2, bytes: 3, deletableBytes: 4, targets: 1 },
    'sc-1',
  );
  assert.equal(e.outcome, 'done');
  assert.equal(e.progress, undefined);
});

test('B20-2: summarize cancelled kaydinda ilerlemeyi saklar', () => {
  const e = ScanHistory.summarize(
    { finishedAt: 9, clusters: 3, files: 5, bytes: 60, deletableBytes: 10, targets: 2 },
    'sc-2',
    'cancelled',
    { done: 12, total: 40 },
  );
  assert.equal(e.outcome, 'cancelled');
  assert.deepEqual(e.progress, { done: 12, total: 40 });
});

test('B20-3: progress verilmeyen iptal 0/0 olur (uydurma yok)', () => {
  const e = ScanHistory.summarize(
    { finishedAt: 9, clusters: 0, files: 0, bytes: 0, deletableBytes: 0, targets: 0 },
    'sc-3',
    'error',
  );
  assert.deepEqual(e.progress, { done: 0, total: 0 });
});

test('B20-4: outcome alani olmayan eski kayit done sayilir', () => {
  const legacy = entry('old', 1);
  assert.equal(ScanHistory.outcome(legacy), 'done');
  assert.equal(ScanHistory.isComplete(legacy), true);
});

test('B20-5: iptal ve hata tamamlanmis sayilmaz', () => {
  assert.equal(ScanHistory.isComplete(entry('c', 1, { outcome: 'cancelled' })), false);
  assert.equal(ScanHistory.isComplete(entry('e', 1, { outcome: 'error' })), false);
});

test('B20-6: rows tamamlanan satirda 0/0, iptal satirinda ilerleme verir', () => {
  const rows = ScanHistory.rows([
    entry('done', 2),
    entry('cancel', 1, { outcome: 'cancelled', progress: { done: 7, total: 20 } }),
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    id: 'done',
    at: 2,
    outcome: 'done',
    complete: true,
    clusters: 2,
    bytes: 1000,
    done: 0,
    total: 0,
  });
  assert.equal(rows[1]!.complete, false);
  assert.equal(rows[1]!.outcome, 'cancelled');
  assert.equal(rows[1]!.done, 7);
  assert.equal(rows[1]!.total, 20);
});

test('B20-7: rows negatif/bozuk sayilari sifirlar', () => {
  const bad = entry('bad', 1, {
    outcome: 'cancelled',
    clusters: -3,
    bytes: -1,
    progress: { done: -5, total: -2 },
  });
  const [row] = ScanHistory.rows([bad]);
  assert.equal(row!.clusters, 0);
  assert.equal(row!.bytes, 0);
  assert.equal(row!.done, 0);
  assert.equal(row!.total, 0);
});

test('B20-8: summary tamamlanmayan kayit sayisini verir', () => {
  const s = ScanHistory.summary([
    entry('a', 10),
    entry('b', 20, { outcome: 'cancelled' }),
    entry('c', 30, { outcome: 'error' }),
  ]);
  assert.deepEqual(s, { count: 3, lastAt: 30, firstAt: 10, incomplete: 2 });
});

test('B20-9: summary bos listede incomplete 0', () => {
  assert.deepEqual(ScanHistory.summary([]), {
    count: 0,
    lastAt: 0,
    firstAt: 0,
    incomplete: 0,
  });
});

test('B20-10: store iptal kaydini outcome+progress ile geri okur', async () => {
  const root = await mkdtemp(join(tmpdir(), 'residue-b20-store-'));
  const prev = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = root;
  try {
    await mkdir(join(root, 'residue', 'scans'), { recursive: true });
    const { appendScanHistory, loadScanHistory, scanHistoryPath } = await import(
      '../src/store/scan-history.ts'
    );
    await appendScanHistory(entry('keep', 1));
    await appendScanHistory(
      entry('cancel', 2, { outcome: 'cancelled', progress: { done: 4, total: 9 } }),
    );
    const loaded = await loadScanHistory();
    const cancel = loaded.find((e) => e.id === 'cancel');
    assert.equal(cancel?.outcome, 'cancelled');
    assert.deepEqual(cancel?.progress, { done: 4, total: 9 });
    // Eski kayitta alan yoktur; motor `done` sayar (uydurma yazim yok).
    assert.equal(loaded.find((e) => e.id === 'keep')?.outcome, undefined);
    assert.equal(ScanHistory.isComplete(loaded.find((e) => e.id === 'keep')!), true);
    assert.ok(scanHistoryPath().startsWith(root));
  } finally {
    if (prev === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = prev;
    await rm(root, { recursive: true, force: true });
  }
});

test('B20-11: store bilinmeyen outcome degerini uydurmaz', async () => {
  const root = await mkdtemp(join(tmpdir(), 'residue-b20-store2-'));
  const prev = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = root;
  try {
    await mkdir(join(root, 'residue', 'scans'), { recursive: true });
    const file = join(root, 'residue', 'scans', 'index.json');
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        entries: [{ id: 'x', at: 1, clusters: 0, files: 0, bytes: 0, deletableBytes: 0, targets: 0, outcome: 'yarim' }],
      }),
      'utf8',
    );
    const { loadScanHistory } = await import('../src/store/scan-history.ts');
    const [e] = await loadScanHistory();
    assert.equal(e?.outcome, undefined);
    assert.equal(ScanHistory.isComplete(e!), true);
  } finally {
    if (prev === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = prev;
    await rm(root, { recursive: true, force: true });
  }
});

test('B20-12: /api/scans rows alanini tamamlanma karariyla dondurur', async () => {
  const root = await mkdtemp(join(tmpdir(), 'residue-b20-api-'));
  const prev = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = root;
  let server: Server | null = null;
  try {
    await mkdir(join(root, 'residue', 'scans'), { recursive: true });
    const { appendScanHistory } = await import('../src/store/scan-history.ts');
    await appendScanHistory(entry('ok', 100));
    await appendScanHistory(
      entry('stop', 200, { outcome: 'cancelled', progress: { done: 3, total: 8 } }),
    );

    const { createApiServer } = await import('../src/web/server.ts');
    const created = createApiServer({ persistScan: false, envs: [] });
    server = created.server;
    await new Promise<void>((ok) => server!.listen(0, '127.0.0.1', () => ok()));
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const base = `http://127.0.0.1:${(addr as { port: number }).port}`;

    const r = await fetch(`${base}/api/scans`, {
      headers: { 'x-residue-token': created.token },
    });
    assert.equal(r.status, 200);
    const body = (await r.json()) as {
      rows: Array<{ id: string; complete: boolean; outcome: string }>;
      summary: { incomplete: number };
    };
    assert.equal(body.rows.length, 2);
    // En yeni ustte.
    assert.equal(body.rows[0]!.id, 'stop');
    assert.equal(body.rows[0]!.complete, false);
    assert.equal(body.rows[0]!.outcome, 'cancelled');
    assert.equal(body.rows[1]!.complete, true);
    assert.equal(body.summary.incomplete, 1);
  } finally {
    if (server) {
      server.closeAllConnections?.();
      await new Promise<void>((ok) => server!.close(() => ok()));
    }
    if (prev === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = prev;
    await rm(root, { recursive: true, force: true });
  }
});

test('B20-13: iptal edilen tarama gecmise tamamlanmadi olarak yazilir', async () => {
  const root = await mkdtemp(join(tmpdir(), 'residue-b20-svc-'));
  const prev = {
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    APPDATA: process.env.APPDATA,
    USERPROFILE: process.env.USERPROFILE,
  };
  try {
    // Hermetik tarama: home + AppData kokleri gecici dizine yonlendirilir;
    // gercek kullanici klasorleri okunmaz.
    const home = join(root, 'home');
    const local = join(root, 'local');
    const roaming = join(root, 'roaming');
    await mkdir(join(home, '.deneme'), { recursive: true });
    await mkdir(local, { recursive: true });
    await mkdir(roaming, { recursive: true });
    await writeFile(join(home, '.deneme', 'not.txt'), 'x', 'utf8');
    process.env.USERPROFILE = home;
    process.env.LOCALAPPDATA = local;
    process.env.APPDATA = roaming;

    const { ScanService } = await import('../src/services/scan-service.ts');
    const service = new ScanService(() => {}, true);
    const job = service.start({
      envs: ['dotfolders', 'localappdata', 'roamingappdata'],
      exclude: [],
      minAgeDays: 0,
    });
    // Tarama baslamadan once iptal: yarim kalan is gecmise yazilmali.
    service.cancel(job.id);

    const deadline = Date.now() + 30_000;
    let status = job.status;
    while (status === 'running' && Date.now() < deadline) {
      await new Promise((ok) => setTimeout(ok, 20));
      status = service.get(job.id)?.status ?? status;
    }
    assert.equal(status, 'cancelled');

    const file = join(local, 'residue', 'scans', 'index.json');
    const parsed = JSON.parse(await readFile(file, 'utf8')) as {
      entries: ScanHistoryEntry[];
    };
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.entries[0]!.outcome, 'cancelled');
    assert.ok(parsed.entries[0]!.progress);
    // Son tarama onbellegi YOK: iptal edilen tarama "son tarama" degildir.
    assert.equal(service.last(), null);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await rm(root, { recursive: true, force: true });
  }
});
