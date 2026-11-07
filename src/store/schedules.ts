import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { dataDir } from '../core/data-dir.ts';
import { longPath } from '../util/longpath.ts';
import type { ScheduleRule, ScheduleRun } from '../core/plan-engine.ts';

/**
 * Zamanlama deposu.
 *
 * Kalici dosya: `%LOCALAPPDATA%\residue\schedules.json`
 * Kilit dosyasi: `%LOCALAPPDATA%\residue\plan-run.lock`
 *
 * Windows Görev Zamanlayıcı KULLANILMAZ; planlar yalnizca sunucu
 * acikken calisir. Kilit, iki sunucu/iki calismanin ayni anda ayni
 * kumeleri kasaya tasimasini engeller.
 */

export interface ScheduleStore {
  version: 1;
  rules: ScheduleRule[];
  runs: ScheduleRun[];
}

const EMPTY: ScheduleStore = { version: 1, rules: [], runs: [] };
const MAX_RUNS = 200;
const STALE_LOCK_MS = 30 * 60_000;

export function schedulesPath(): string {
  return join(dataDir(), 'schedules.json');
}

export function runLockPath(): string {
  return join(dataDir(), 'plan-run.lock');
}

export async function loadScheduleStore(): Promise<ScheduleStore> {
  try {
    const j = JSON.parse(await readFile(longPath(schedulesPath()), 'utf8')) as Partial<ScheduleStore>;
    return {
      version: 1,
      rules: Array.isArray(j.rules) ? j.rules.filter(isRule).map(normalizeRule) : [],
      runs: Array.isArray(j.runs) ? j.runs.filter(isRun) : [],
    };
  } catch {
    return { ...EMPTY, rules: [], runs: [] };
  }
}

export async function saveScheduleStore(store: ScheduleStore): Promise<void> {
  const file = schedulesPath();
  await mkdir(longPath(dirname(file)), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(longPath(tmp), JSON.stringify(store, null, 2), 'utf8');
  await rename(longPath(tmp), longPath(file));
}

export async function upsertRule(rule: ScheduleRule): Promise<ScheduleStore> {
  const store = await loadScheduleStore();
  const i = store.rules.findIndex((r) => r.id === rule.id);
  if (i >= 0) store.rules[i] = rule;
  else store.rules.push(rule);
  await saveScheduleStore(store);
  return store;
}

export async function removeRule(id: string): Promise<ScheduleStore> {
  const store = await loadScheduleStore();
  store.rules = store.rules.filter((r) => r.id !== id);
  await saveScheduleStore(store);
  return store;
}

export async function addRun(run: ScheduleRun): Promise<ScheduleStore> {
  const store = await loadScheduleStore();
  store.runs.push(run);
  if (store.runs.length > MAX_RUNS) store.runs.splice(0, store.runs.length - MAX_RUNS);
  await saveScheduleStore(store);
  return store;
}

export async function updateRun(run: ScheduleRun): Promise<ScheduleStore> {
  const store = await loadScheduleStore();
  const i = store.runs.findIndex((r) => r.id === run.id);
  if (i >= 0) store.runs[i] = run;
  else store.runs.push(run);
  await saveScheduleStore(store);
  return store;
}

/**
 * Calisma kilidi. `wx` ile atomik olusturulur; eski (30 dk) kilit
 * crash kabul edilip kirilir. Kilidi alan `owner` ile serbest birakir.
 */
export async function acquireRunLock(owner: string): Promise<boolean> {
  await mkdir(longPath(dataDir()), { recursive: true });
  const file = runLockPath();
  try {
    const st = await stat(longPath(file));
    if (Date.now() - st.mtimeMs > STALE_LOCK_MS) {
      await rm(longPath(file), { force: true });
    }
  } catch {
    /* kilit yok */
  }
  try {
    await writeFile(longPath(file), JSON.stringify({ owner, at: Date.now() }), {
      encoding: 'utf8',
      flag: 'wx',
    });
    return true;
  } catch {
    return false;
  }
}

export async function releaseRunLock(owner: string): Promise<void> {
  try {
    const j = JSON.parse(await readFile(longPath(runLockPath()), 'utf8')) as { owner?: string };
    if (j.owner !== owner) return;
    await rm(longPath(runLockPath()), { force: true });
  } catch {
    /* kilit yok/bozuk */
  }
}

function isRule(x: unknown): x is ScheduleRule {
  const r = x as Partial<ScheduleRule>;
  return (
    typeof r?.id === 'string' &&
    typeof r.name === 'string' &&
    (r.frequency === 'once' || r.frequency === 'daily' || r.frequency === 'weekly') &&
    typeof r.hour === 'number' &&
    typeof r.minute === 'number' &&
    typeof r.createdAt === 'number' &&
    typeof r.enabled === 'boolean' &&
    (r.mode === undefined || r.mode === 'vault' || r.mode === 'env')
  );
}

/**
 * Eski kayitlar `mode` alani tasimaz → `vault` sayilir. `env` kuralinin
 * secenekleri bozuksa varsayilanlara cekilir; onay kaydi (`envApprovedAt`)
 * YALNIZ gecerli sayi ise korunur (uydurulmaz).
 */
function normalizeRule(rule: ScheduleRule): ScheduleRule {
  const mode = rule.mode === 'env' ? 'env' : 'vault';
  if (mode === 'vault') {
    const { env: _env, envApprovedAt: _at, ...rest } = rule;
    return { ...rest, mode: 'vault' };
  }
  const scope = rule.env?.scope;
  const { envApprovedAt, ...rest } = rule;
  return {
    ...rest,
    mode: 'env',
    env: {
      scope: scope === 'machine' || scope === 'both' ? scope : 'user',
      removeMissing: rule.env?.removeMissing !== false,
      removeDuplicates: rule.env?.removeDuplicates !== false,
    },
    ...(typeof envApprovedAt === 'number' && Number.isFinite(envApprovedAt)
      ? { envApprovedAt }
      : {}),
  };
}

function isRun(x: unknown): x is ScheduleRun {
  const r = x as Partial<ScheduleRun>;
  return (
    typeof r?.id === 'string' &&
    typeof r.ruleId === 'string' &&
    typeof r.plannedAt === 'number' &&
    typeof r.status === 'string'
  );
}
