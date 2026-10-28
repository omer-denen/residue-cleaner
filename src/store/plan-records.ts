import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { dataDir } from '../core/data-dir.ts';
import { longPath } from '../util/longpath.ts';
import { PlanRecords } from '../core/plan-records.ts';
import type { PlanRecord } from '../core/plan-records.ts';

export interface PlanStore {
  version: 1;
  records: PlanRecord[];
}

const EMPTY: PlanStore = { version: 1, records: [] };

const STATUSES = new Set(['pending', 'executed', 'cancelled', 'failed']);

function isValidRecord(x: unknown): x is PlanRecord {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const r = x as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.length === 0) return false;
  if (typeof r.name !== 'string') return false;
  if (typeof r.planId !== 'string' || r.planId.length === 0) return false;
  if (typeof r.createdAt !== 'number' || !Number.isFinite(r.createdAt)) return false;
  if (typeof r.status !== 'string' || !STATUSES.has(r.status)) return false;
  if (typeof r.source !== 'string' || !['dashboard', 'disk', 'api'].includes(r.source)) return false;
  if (!Array.isArray(r.clusterKeys) || !r.clusterKeys.every((k) => typeof k === 'string')) return false;
  if (!Array.isArray(r.clusterTitles) || !r.clusterTitles.every((k) => typeof k === 'string')) return false;
  if (typeof r.bytes !== 'number' || !Number.isFinite(r.bytes)) return false;
  if (typeof r.targetCount !== 'number' || !Number.isFinite(r.targetCount)) return false;
  if (r.executedAt !== undefined && (typeof r.executedAt !== 'number' || !Number.isFinite(r.executedAt))) return false;
  if (r.freedBytes !== undefined && (typeof r.freedBytes !== 'number' || !Number.isFinite(r.freedBytes))) return false;
  if (r.removed !== undefined && (typeof r.removed !== 'number' || !Number.isFinite(r.removed))) return false;
  if (r.error !== undefined && typeof r.error !== 'string') return false;
  return true;
}

export function planRecordsPath(): string {
  return join(dataDir(), 'plans.json');
}

export async function loadPlanRecords(): Promise<PlanRecord[]> {
  try {
    const raw = await readFile(longPath(planRecordsPath()), 'utf8');
    const j = JSON.parse(raw) as Partial<PlanStore>;
    if (!j || typeof j !== 'object' || Array.isArray(j)) return [];
    if (!Array.isArray(j.records)) return [];
    return j.records.filter(isValidRecord);
  } catch {
    return [];
  }
}

export async function savePlanRecords(records: PlanRecord[]): Promise<void> {
  const file = planRecordsPath();
  await mkdir(longPath(dirname(file)), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const trimmed = PlanRecords.trim(records);
  const store: PlanStore = { version: 1, records: trimmed };
  await writeFile(longPath(tmp), JSON.stringify(store, null, 2), 'utf8');
  await rename(longPath(tmp), longPath(file));
}

export async function upsertPlanRecord(record: PlanRecord): Promise<PlanRecord[]> {
  const records = await loadPlanRecords();
  const i = records.findIndex((r) => r.id === record.id);
  if (i >= 0) records[i] = record;
  else records.push(record);
  await savePlanRecords(records);
  return PlanRecords.list(await loadPlanRecords());
}