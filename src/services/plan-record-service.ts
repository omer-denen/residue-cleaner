import { randomBytes } from 'node:crypto';
import { PlanRecords } from '../core/plan-records.ts';
import type { PlanRecord, PlanRecordOutcome, PlanRecordSource, PlanRecordStatus } from '../core/plan-records.ts';
import type { PlanResponse } from '../core/contract.ts';
import { loadPlanRecords, savePlanRecords, upsertPlanRecord } from '../store/plan-records.ts';
import { ServiceError } from './errors.ts';
import type { DeleteService } from './delete-service.ts';
import type { ScanService } from './scan-service.ts';

function newId(): string {
  const ts = Date.now();
  const cnt = (planRecordCounter = planRecordCounter + 1);
  return `pl_${ts}_${cnt}`;
}
let planRecordCounter = 0;

export class PlanRecordService {
  private readonly deleteService: DeleteService;
  private readonly scanService: ScanService;

  constructor(deleteService: DeleteService, scanService: ScanService) {
    this.deleteService = deleteService;
    this.scanService = scanService;
  }

  async create(input: {
    clusterKeys: string[];
    source?: PlanRecordSource;
    name?: string;
  }): Promise<{ record: PlanRecord; plan: PlanResponse }> {
    const scan = this.scanService.last()?.scan ?? null;
    const plan = this.deleteService.createPlan(scan, input.clusterKeys, 'recycle', input.name);
    const titles = plan.plan.clusters.map((c) => c.title);

    const planKeys = new Set(plan.plan.clusters.map((c) => c.key));
    const orderedKeys = input.clusterKeys.filter((k) => planKeys.has(k));

    const record: PlanRecord = {
      id: newId(),
      name: plan.name,
      planId: plan.planId,
      createdAt: Date.now(),
      status: 'pending',
      source: input.source ?? 'api',
      clusterKeys: orderedKeys.length > 0 ? orderedKeys : input.clusterKeys,
      clusterTitles: titles,
      bytes: plan.plan.totalBytes,
      targetCount: plan.plan.targets.length,
    };

    await upsertPlanRecord(record);
    return { record, plan };
  }

  async list(): Promise<{ records: PlanRecord[]; counts: Record<PlanRecordStatus, number> }> {
    const records = await loadPlanRecords();
    const sorted = PlanRecords.list(records);
    return { records: sorted, counts: PlanRecords.counts(sorted) };
  }

  async mark(
    planId: string,
    to: PlanRecordStatus,
    outcome?: PlanRecordOutcome,
  ): Promise<PlanRecord[]> {
    const records = await loadPlanRecords();
    const target = records.find((r) => r.planId === planId);
    if (!target) return PlanRecords.list(records);
    const next = PlanRecords.apply(records, target.id, to, Date.now(), outcome);
    if (next === records) return PlanRecords.list(records);
    await savePlanRecords(next);
    return PlanRecords.list(await loadPlanRecords());
  }

  async markExecuted(planId: string, outcome: PlanRecordOutcome): Promise<PlanRecord[]> {
    return this.mark(planId, 'executed', outcome);
  }

  /**
   * Canli planin kapsami degistiginde (ekle/cikar/yeniden kur/ad) bekleyen
   * kaydi tazeler. Kayit yoksa veya kapsam ayniysa hicbir sey yazilmaz.
   */
  async sync(plan: PlanResponse): Promise<void> {
    const records = await loadPlanRecords();
    const next = PlanRecords.sync(records, {
      planId: plan.planId,
      name: plan.name,
      clusterKeys: plan.plan.clusters.map((c) => c.key),
      clusterTitles: plan.plan.clusters.map((c) => c.title),
      bytes: plan.plan.totalBytes,
      targetCount: plan.plan.targets.length,
    });
    if (next !== records) await savePlanRecords(next);
  }

  /** Plan atildiginda (discard) ona bagli bekleyen kaydi iptal eder. */
  async cancelByPlan(planId: string): Promise<void> {
    const records = await loadPlanRecords();
    const next = PlanRecords.cancelPlan(records, planId, Date.now());
    if (next !== records) await savePlanRecords(next);
  }

  /**
   * Kullanici kaydi iptal eder. Ayni plan hala canliysa once o atilir;
   * onaylanmis (armed) plan 10 dk kurali geregi atilamaz (409).
   */
  async cancel(recordId: string): Promise<{
    records: PlanRecord[];
    counts: Record<PlanRecordStatus, number>;
  }> {
    const records = await loadPlanRecords();
    const target = records.find((r) => r.id === recordId);
    if (!target) throw new ServiceError(404, 'Plan kaydi bulunamadi');
    if (target.status !== 'pending') {
      throw new ServiceError(409, 'Plan zaten sonuclanmis');
    }

    try {
      this.deleteService.discardPlan(target.planId);
    } catch (err) {
      // Plan zaten atilmis/suresi dolmus olabilir; kaydi yine iptal et.
      if (!(err instanceof ServiceError) || (err.status !== 404 && err.status !== 410)) {
        throw err;
      }
    }

    const next = PlanRecords.apply(records, target.id, 'cancelled', Date.now());
    await savePlanRecords(next);
    const sorted = PlanRecords.list(next);
    return { records: sorted, counts: PlanRecords.counts(sorted) };
  }
}