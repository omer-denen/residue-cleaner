import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  usageVerdict,
  findAtimeBursts,
  applyAtimeBurstFilter,
} from '../src/core/cli-inventory.ts';
import type { UsageInput } from '../src/core/cli-inventory.ts';
import type { CliTool } from '../src/core/cli-inventory-types.ts';

// T69/F3: kullanim karari. Atime TEK BASINA kullanim kaniti degildir
// (kural 21); bu dosyada karar zinciri salt nesnelerle sinanir, dosya
// G/CI yoktur. Fixture koku %TEMP% degil; burada da dosya kullanilmaz.

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-23T12:00:00Z');
const UNUSED_DAYS = 21;

function baseInput(over: Partial<UsageInput> = {}): UsageInput {
  return {
    now: NOW,
    unusedDays: UNUSED_DAYS,
    command: 'ornek',
    source: 'standalone',
    packageName: 'ornek',
    installedAt: NOW - 60 * DAY,
    lastAccessAt: 0,
    state: { dirs: [], lastMtime: 0, lastAtime: 0 },
    history: { files: ['h'], lines: [], lastWrite: 0, available: true },
    atimeReliable: true,
    ...over,
  };
}

function baseTool(over: Partial<CliTool> = {}): CliTool {
  return {
    id: 'standalone:ornek',
    command: 'ornek',
    source: 'standalone',
    packageName: 'ornek',
    version: '',
    installPath: '',
    shims: [],
    stalePaths: [],
    stateDirs: [],
    installedAt: 0,
    lastAccessAt: 0,
    lastStateAt: 0,
    historyMentions: 0,
    historyLastRatio: 0,
    totalBytes: 0,
    idleDays: 0,
    status: 'recent',
    confidence: 'medium',
    evidence: [],
    usageSignals: [],
    atimeSuspect: false,
    uninstall: null,
    ...over,
  };
}

test('1: atime yeni ama gecmis ve durum yok → unknown (low); recent DEGIL', () => {
  const v = usageVerdict(baseInput({ lastAccessAt: NOW - 3 * DAY }));
  assert.equal(v.status, 'unknown');
  assert.equal(v.confidence, 'low');
  assert.ok(
    v.evidence.some((e) => e.includes('yalniz shim atime')),
    `kanit gerekcesi eksik: ${JSON.stringify(v.evidence)}`,
  );
});

test('2: atime yeni + gecmiste geciyor → recent (medium); iki sinyal dogrulugu', () => {
  const v = usageVerdict(
    baseInput({
      lastAccessAt: NOW - 2 * DAY,
      history: { files: ['h'], lines: ['ornek --ayar', 'diger-komut'], lastWrite: NOW, available: true },
    }),
  );
  assert.equal(v.status, 'recent');
  assert.equal(v.confidence, 'medium');
});

test('3: atime ≈ kurulum (2 sn icinde) → recent DEGIL; kanitta "kurulum" gerekcesi', () => {
  const installedAt = NOW - 60 * DAY;
  const v = usageVerdict(
    baseInput({
      installedAt,
      lastAccessAt: installedAt + 1000,
      state: { dirs: [], lastMtime: 0, lastAtime: 0 },
      history: { files: [], lines: [], lastWrite: 0, available: true },
    }),
  );
  assert.notEqual(v.status, 'recent');
  assert.equal(v.status, 'unused');
  assert.ok(
    v.evidence.some((e) => e.includes('kurulum aniyla ayni')),
    `kurulum gerekcesi eksik: ${JSON.stringify(v.evidence)}`,
  );
});

test('4: yalniz gecmis kaniti (atime eski/yok) → unknown (medium); "zaman bilinmiyor"', () => {
  const v = usageVerdict(
    baseInput({
      lastAccessAt: 0,
      history: { files: ['h'], lines: ['ornek urun', 'baskasi'], lastWrite: NOW - 90 * DAY, available: true },
    }),
  );
  assert.equal(v.status, 'unknown');
  assert.equal(v.confidence, 'medium');
  assert.ok(
    v.evidence.some((e) => e.includes('zaman bilinmiyor')),
    `gerekce eksik: ${JSON.stringify(v.evidence)}`,
  );
});

test('5: durum klasoru yeni → recent (high) — regresyon korumasi', () => {
  const v = usageVerdict(
    baseInput({
      lastAccessAt: 0,
      state: { dirs: ['d'], lastMtime: NOW - 60_000, lastAtime: 0 },
    }),
  );
  assert.equal(v.status, 'recent');
  assert.equal(v.confidence, 'high');
});

test('6a: findAtimeBursts — 3 farkli id ayni 5 sn penceresinde → ucu de isaretli', () => {
  const t0 = 1_000_000_000;
  const burst = findAtimeBursts(
    [{ id: 'a', atime: t0 }, { id: 'b', atime: t0 + 2000 }, { id: 'c', atime: t0 + 4000 }],
    5000,
    3,
  );
  assert.deepEqual([...burst].sort(), ['a', 'b', 'c']);
});

test('6b: findAtimeBursts — yalniz 2 id → bos kume', () => {
  const t0 = 1_000_000_000;
  const burst = findAtimeBursts(
    [{ id: 'a', atime: t0 }, { id: 'b', atime: t0 + 2000 }],
    5000,
    3,
  );
  assert.equal(burst.size, 0);
});

test('6c: findAtimeBursts — pencere disindaki id isaretlenmez', () => {
  const t0 = 1_000_000_000;
  const burst = findAtimeBursts(
    [
      { id: 'a', atime: t0 },
      { id: 'b', atime: t0 + 2000 },
      { id: 'c', atime: t0 + 4000 },
      { id: 'disinda', atime: t0 + 30_000 },
    ],
    5000,
    3,
  );
  assert.ok(burst.has('a') && burst.has('b') && burst.has('c'));
  assert.equal(burst.has('disinda'), false);
});

test('7a: applyAtimeBurstFilter — burst icindeki yalniz-atime recent → unknown (low)', () => {
  const tool = baseTool({
    id: 'standalone:b1',
    lastAccessAt: NOW - 3 * DAY,
    status: 'recent',
    evidence: ['shim son erisim: x'],
  });
  applyAtimeBurstFilter([tool], new Set(['standalone:b1']), { now: NOW, unusedDays: UNUSED_DAYS });
  assert.equal(tool.status, 'unknown');
  assert.equal(tool.confidence, 'low');
  assert.ok(
    tool.evidence.some((e) => e.includes('burst')),
    `burst gerekcesi eksik: ${JSON.stringify(tool.evidence)}`,
  );
});

test('7b: applyAtimeBurstFilter — durum klasoru yeni ise recent KORUNUR', () => {
  const tool = baseTool({
    id: 'standalone:b2',
    lastAccessAt: NOW - 3 * DAY,
    lastStateAt: NOW - 60_000,
    status: 'recent',
    confidence: 'high',
    evidence: ['durum klasoru son yazim: x'],
  });
  applyAtimeBurstFilter([tool], new Set(['standalone:b2']), { now: NOW, unusedDays: UNUSED_DAYS });
  assert.equal(tool.status, 'recent');
  assert.equal(tool.confidence, 'high');
});

test('8: atime yok sayildiginda idleDays kurulum/durum zamanina dayanir', () => {
  const installedAt = NOW - 60 * DAY;
  // Durum yok: yas kurulumdan olculur.
  const noState = usageVerdict(
    baseInput({ installedAt, lastAccessAt: installedAt + 1000 }),
  );
  assert.ok(
    noState.idleDays >= 59 && noState.idleDays <= 60.01,
    `idleDays kurulumdan olculmeli: ${noState.idleDays}`,
  );
  // Durum yeni: yas durumdan olculur (60 gun degil).
  const withState = usageVerdict(
    baseInput({
      installedAt,
      lastAccessAt: installedAt + 1000,
      state: { dirs: ['d'], lastMtime: NOW - 2 * DAY, lastAtime: 0 },
    }),
  );
  assert.ok(
    withState.idleDays >= 1.9 && withState.idleDays < 3,
    `idleDays durumdan olculmeli: ${withState.idleDays}`,
  );
});

test('9: karar sirasi — gecmis + eski atime, durum guncel degil → unknown; historyRecent kaldirildi', () => {
  // Eski davranista lastRatio>=0.6 olan gecmis tek basina recent uretiyordu.
  // Yeni: gecmis zaman tasimaz → unknown (medium).
  const v = usageVerdict(
    baseInput({
      lastAccessAt: NOW - 90 * DAY,
      history: { files: ['h'], lines: ['ornek urun', 'baskasi'], lastWrite: NOW - 90 * DAY, available: true },
    }),
  );
  assert.equal(v.status, 'unknown');
  assert.equal(v.confidence, 'medium');
});

test('F5-1: yalniz durum klasoru sinyali → signals=[state], atimeSuspect=false', () => {
  const v = usageVerdict(
    baseInput({
      installedAt: 0,
      lastAccessAt: 0,
      state: { dirs: ['d'], lastMtime: NOW - 60_000, lastAtime: 0 },
    }),
  );
  assert.deepEqual(v.signals, ['state']);
  assert.equal(v.atimeSuspect, false);
});

test('F5-2: gecmiste geciyor (atime yok) → signals icinde history; status unknown, confidence medium', () => {
  const v = usageVerdict(
    baseInput({
      lastAccessAt: 0,
      history: { files: ['h'], lines: ['ornek urun', 'baskasi'], lastWrite: NOW - 90 * DAY, available: true },
    }),
  );
  assert.ok(v.signals.includes('history'), `history sinyali eksik: ${JSON.stringify(v.signals)}`);
  assert.equal(v.status, 'unknown');
  assert.equal(v.confidence, 'medium');
});

test('F5-3: atime ≈ installedAt (≤2 sn) → signals icinde atime YOK, atimeSuspect=true', () => {
  const installedAt = NOW - 60 * DAY;
  const v = usageVerdict(
    baseInput({
      installedAt,
      lastAccessAt: installedAt + 1000,
      state: { dirs: [], lastMtime: 0, lastAtime: 0 },
      history: { files: [], lines: [], lastWrite: 0, available: true },
    }),
  );
  assert.ok(!v.signals.includes('atime'), `atime sinyali olmamali: ${JSON.stringify(v.signals)}`);
  assert.equal(v.atimeSuspect, true);
});

test('F5-4: tum sinyaller → sıra [install,state,atime,history]', () => {
  const v = usageVerdict(
    baseInput({
      installedAt: NOW - 60 * DAY,
      lastAccessAt: NOW - 3 * DAY,
      state: { dirs: ['d'], lastMtime: NOW - 60_000, lastAtime: 0 },
      history: { files: ['h'], lines: ['ornek urun'], lastWrite: NOW, available: true },
    }),
  );
  assert.deepEqual(v.signals, ['install', 'state', 'atime', 'history']);
});
