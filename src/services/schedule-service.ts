import { randomBytes } from 'node:crypto';
import { ApprovalRules } from '../core/approval.ts';
import {
  dueNow,
  missedRuns,
  nextRunAt,
  previewRule,
  selectClusters,
  type PlanPreview,
  type ScheduleRule,
  type ScheduleRun,
  type ScheduleSelector,
} from '../core/plan-engine.ts';
import type {
  ScheduleCreateRequest,
  ScheduleUpdateRequest,
  ScheduleView,
} from '../core/contract.ts';
import {
  acquireRunLock,
  addRun,
  loadScheduleStore,
  releaseRunLock,
  removeRule,
  updateRun,
  upsertRule,
  type ScheduleStore,
} from '../store/schedules.ts';
import { ServiceError } from './errors.ts';
import type { ScanService } from './scan-service.ts';
import type { DeleteService, ExecuteJob } from './delete-service.ts';

/**
 * Zamanlama servisi.
 *
 * Sinirlar (kesisen ilkeler):
 *  - Planli islem YALNIZCA kasaya tasir; `purge` yok.
 *  - Ortam degiskeni otomatik duzenlenmez.
 *  - Sunucu kapaliyken calismaz; kacirilan calisma "oneri" olarak doner.
 *  - Ayni anda tek plan calisir (dosya kilidi).
 */

export type {
  ScheduleCreateRequest,
  ScheduleUpdateRequest,
  ScheduleView,
} from '../core/contract.ts';
export type ScheduleInput = ScheduleCreateRequest;

const MAX_JOBS_WAIT_MS = 30 * 60_000;

function newId(): string {
  return randomBytes(8).toString('hex');
}

export class ScheduleService {
  private readonly scan: ScanService;
  private readonly deleteService: DeleteService;

  constructor(scan: ScanService, remove: DeleteService) {
    this.scan = scan;
    this.deleteService = remove;
  }

  async list(): Promise<ScheduleView[]> {
    const store = await loadScheduleStore();
    const now = Date.now();
    return store.rules
      .map((r) => this.view(r, store, now))
      .sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity));
  }

  async create(
    input: ScheduleCreateRequest,
    approval?: { phrase?: string; require?: boolean },
  ): Promise<ScheduleView> {
    if (approval?.require && !ApprovalRules.matches('schedule', approval.phrase)) {
      throw new ServiceError(
        400,
        `Onay ifadesi hatali (${ApprovalRules.phrase('schedule')} bekleniyordu)`,
      );
    }
    const now = Date.now();
    const rule = this.build(input, now);
    await upsertRule(rule);
    return this.view(rule, await loadScheduleStore(), now);
  }

  /**
   * Kurali gunceller. Kapsam/zaman degisikligi otomasyonu yeniden kurdugu icin
   * yazili PLANLA onayi ister. Yalnizca devre disi birakmak onay istemez.
   */
  async update(
    id: string,
    input: ScheduleUpdateRequest,
    approval?: { phrase?: string },
  ): Promise<ScheduleView> {
    const store = await loadScheduleStore();
    const base = store.rules.find((r) => r.id === id);
    if (!base) throw new ServiceError(404, 'Plan bulunamadi');

    const enabling = input.enabled === true && !base.enabled;
    const touchesRule = Object.keys(input).some(
      (key) => key !== 'phrase' && key !== 'enabled' && input[key as keyof ScheduleUpdateRequest] !== undefined,
    );
    if ((enabling || touchesRule) && !ApprovalRules.matches('schedule', approval?.phrase)) {
      throw new ServiceError(
        400,
        `Onay ifadesi hatali (${ApprovalRules.phrase('schedule')} bekleniyordu)`,
      );
    }

    const merged: ScheduleCreateRequest = {
      name: input.name ?? base.name,
      frequency: input.frequency ?? base.frequency,
      hour: input.hour ?? base.hour,
      minute: input.minute ?? base.minute,
      ...(input.weekday !== undefined || base.weekday !== undefined
        ? { weekday: input.weekday ?? base.weekday }
        : {}),
      ...(input.runAt !== undefined || base.runAt !== undefined
        ? { runAt: input.runAt ?? base.runAt }
        : {}),
      selector: input.selector ?? base.selector,
      enabled: input.enabled ?? base.enabled,
      compensateMissed: input.compensateMissed ?? base.compensateMissed,
    };

    const now = Date.now();
    const rule = this.build(merged, now, base);
    await upsertRule(rule);
    return this.view(rule, await loadScheduleStore(), now);
  }

  /** Dogrulanmis girdiden kural uretir; create ve update ayni kurallari kullanir. */
  private build(input: ScheduleCreateRequest, now: number, base?: ScheduleRule): ScheduleRule {
    const name = String(input.name ?? '').trim();
    if (name.length < 2 || name.length > 80) {
      throw new ServiceError(400, 'Plan adi 2-80 karakter olmali');
    }
    const frequency = input.frequency;
    if (!['once', 'daily', 'weekly'].includes(frequency)) {
      throw new ServiceError(400, 'Gecersiz siklik (once|daily|weekly)');
    }
    const hour = Number.isInteger(input.hour) ? Number(input.hour) : 3;
    const minute = Number.isInteger(input.minute) ? Number(input.minute) : 0;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      throw new ServiceError(400, 'Saat 0-23, dakika 0-59 olmali');
    }
    const selector: ScheduleSelector = {
      ...(Array.isArray(input.selector?.keys)
        ? { keys: input.selector.keys.filter((k): k is string => typeof k === 'string') }
        : {}),
      ...(Array.isArray(input.selector?.categories)
        ? { categories: input.selector.categories }
        : {}),
      ...(input.selector?.maxRisk ? { maxRisk: input.selector.maxRisk } : { maxRisk: 'safe' }),
      ...(typeof input.selector?.minIdleDays === 'number'
        ? { minIdleDays: Math.max(0, Math.floor(input.selector.minIdleDays)) }
        : {}),
      ...(typeof input.selector?.maxItems === 'number'
        ? { maxItems: Math.min(100, Math.max(1, Math.floor(input.selector.maxItems))) }
        : { maxItems: 10 }),
    };
    // Planli islem yazili onay isteyen riskleri otomatik silemez.
    if (selector.maxRisk === 'medium' || selector.maxRisk === 'high') {
      throw new ServiceError(
        400,
        'Planli islem en fazla "low" risk kapsayabilir; orta/yuksek risk elle onay ister',
      );
    }

    return {
      id: base?.id ?? newId(),
      name,
      frequency,
      hour,
      minute,
      ...(frequency === 'weekly' ? { weekday: Math.min(6, Math.max(0, input.weekday ?? 1)) } : {}),
      ...(frequency === 'once'
        ? {
            runAt:
              typeof input.runAt === 'number' && input.runAt > now
                ? input.runAt
                : now + 60 * 60_000,
          }
        : {}),
      selector,
      mode: 'vault',
      enabled: input.enabled !== false,
      createdAt: base?.createdAt ?? now,
      compensateMissed: input.compensateMissed !== false,
    };
  }

  async remove(id: string): Promise<void> {
    const store = await loadScheduleStore();
    if (!store.rules.some((r) => r.id === id)) {
      throw new ServiceError(404, 'Plan bulunamadi');
    }
    await removeRule(id);
  }

  /** Kacirilan calismalar: otomatik CALISTIRILMAZ, oneri olarak doner. */
  async catchUp(): Promise<
    Array<{ rule: ScheduleView; missed: number; message: string }>
  > {
    const views = await this.list();
    return views
      .filter((v) => v.enabled && v.compensateMissed && (v.missed > 0 || v.due))
      .map((v) => ({
        rule: v,
        missed: v.missed,
        message:
          v.missed > 0
            ? `${v.missed} planli calisma kacirildi (sunucu kapaliydi); simdi calistirilsin mi?`
            : 'Planli calisma zamani geldi; simdi calistirilsin mi?',
      }));
  }

  async preview(id: string): Promise<PlanPreview> {
    await this.scan.ensureCacheLoaded();
    const store = await loadScheduleStore();
    const rule = store.rules.find((r) => r.id === id);
    if (!rule) throw new ServiceError(404, 'Plan bulunamadi');
    const last = this.scan.last();
    if (!last) throw new ServiceError(400, 'Once tarama yapilmali');
    return previewRule(rule, last.scan.clusters);
  }

  /**
   * Plani hemen calistirir. Yalnizca "recycle" (kasa) modu kullanilir.
   * Donen `run`, tamamlanana kadar beklenir.
   */
  async run(id: string, opts: { maxWaitMs?: number } = {}): Promise<ScheduleRun> {
    const store = await loadScheduleStore();
    const rule = store.rules.find((r) => r.id === id);
    if (!rule) throw new ServiceError(404, 'Plan bulunamadi');
    if (!rule.enabled) throw new ServiceError(409, 'Plan devre disi');

    const owner = `${process.pid}:${newId()}`;
    if (!(await acquireRunLock(owner))) {
      throw new ServiceError(409, 'Baska bir planli calisma suruyor (kilit)');
    }

    const run: ScheduleRun = {
      id: newId(),
      ruleId: rule.id,
      plannedAt: nextRunAt(rule, Date.now()) ?? Date.now(),
      status: 'running',
      itemCount: 0,
      bytes: 0,
    };

    try {
      await addRun(run);
      await this.scan.ensureCacheLoaded();
      const last = this.scan.last();
      if (!last) {
        run.status = 'failed';
        run.error = 'Son tarama yok; planli islem tarama olmadan calismaz';
        run.finishedAt = Date.now();
        await updateRun(run);
        return run;
      }

      const selected = selectClusters(rule, last.scan.clusters);
      if (selected.length === 0) {
        run.status = 'done';
        run.itemCount = 0;
        run.bytes = 0;
        run.startedAt = run.startedAt ?? Date.now();
        run.finishedAt = Date.now();
        rule.lastRunAt = Date.now();
        await upsertRule(rule);
        await updateRun(run);
        return run;
      }

      const keys = selected.map((c) => c.key);
      const plan = this.deleteService.createPlan(last.scan, keys, 'recycle');
      if (plan.requiresPhrase || plan.requiresHighAck) {
        // Secici yalnizca safe/low secmeli; buraya dusmesi bir hatadir.
        run.status = 'failed';
        run.error = 'Planli islem yazili onay gerektiren risk iceriyor; elle calistirin';
        run.finishedAt = Date.now();
        await updateRun(run);
        return run;
      }

      run.startedAt = Date.now();
      await updateRun(run);
      const started = this.deleteService.execute(plan.planId, undefined, false);
      await this.scan.markDirty();
      const job = await this.waitForJob(started.jobId, opts.maxWaitMs ?? MAX_JOBS_WAIT_MS);
      run.finishedAt = Date.now();
      run.itemCount = plan.plan.clusters.length;
      run.bytes = plan.plan.totalBytes;
      if (job.status === 'done' && job.last?.type === 'done') {
        run.status = 'done';
        run.journalPath = job.last.journalPath;
      } else {
        run.status = 'failed';
        run.error = job.last?.type === 'error' ? job.last.message : `islem durumu: ${job.status}`;
      }
      rule.lastRunAt = Date.now();
      await upsertRule(rule);
      await updateRun(run);
      return run;
    } catch (err) {
      run.status = 'failed';
      run.error = err instanceof Error ? err.message : String(err);
      run.finishedAt = Date.now();
      await updateRun(run).catch(() => undefined);
      throw err;
    } finally {
      await releaseRunLock(owner);
    }
  }

  async history(): Promise<ScheduleRun[]> {
    const store = await loadScheduleStore();
    return [...store.runs].sort((a, b) => (b.startedAt ?? b.plannedAt) - (a.startedAt ?? a.plannedAt));
  }

  private async waitForJob(jobId: string, timeoutMs: number): Promise<ExecuteJob> {
    const start = Date.now();
    for (;;) {
      const job = this.deleteService.getJob(jobId);
      if (!job) throw new Error('Islem bulunamadi');
      if (job.status !== 'running') return job;
      if (Date.now() - start > timeoutMs) {
        return {
          ...job,
          status: 'error',
          last: { type: 'error', message: 'planli calisma zaman asimi' },
        };
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }

  private view(rule: ScheduleRule, store: ScheduleStore, now: number): ScheduleView {
    const lastRun =
      [...store.runs]
        .filter((r) => r.ruleId === rule.id)
        .sort((a, b) => (b.startedAt ?? b.plannedAt) - (a.startedAt ?? a.plannedAt))[0] ?? null;
    return {
      ...rule,
      nextRunAt: nextRunAt(rule, now),
      due: dueNow(rule, now),
      missed: missedRuns(rule, now),
      lastRun,
    };
  }
}
