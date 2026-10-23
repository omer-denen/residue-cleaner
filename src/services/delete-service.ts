import {
  buildPlan,
  closeRecycle,
  deleteTarget,
  type DeletePlan,
  type DeleteResult,
} from '../actions/delete.ts';
import { ApprovalRules } from '../core/approval.ts';
import { PlanPanel, planTargetId } from '../core/plan-panel.ts';
import { newId } from './ids.ts';
import { ServiceError, describeError } from './errors.ts';
import type { ScanResult } from '../core/types.ts';
import { OperationJournal } from '../core/operation-journal.ts';
import { AppError } from '../core/app-error.ts';
import { audit } from '../util/audit.ts';
import type {
  ExecuteEvent,
  ExecuteStartResponse,
  PlanResponse,
  PlanView,
} from '../core/contract.ts';

/**
 * Disk silme servisi: plan uretimi, 10 dakikalik TTL ve yurutme isleri.
 *
 * HTTP/SSE bilgisi YOKTUR; ilerleme `emit` ile disari verilir.
 */

export interface ExecuteJob {
  id: string;
  status: 'running' | 'done' | 'error';
  last: ExecuteEvent | null;
  startedAt: number;
}

interface StoredPlan {
  planId: string;
  plan: DeletePlan;
  createdAt: number;
  expiresAt: number;
  requiresPhrase: boolean;
  requiresHighAck: boolean;
}

export type DeleteEmit = (jobId: string, event: ExecuteEvent) => void;

const PLAN_TTL_MS = 10 * 60_000;

export class DeleteService {
  private readonly plans = new Map<string, StoredPlan>();
  private readonly jobs = new Map<string, ExecuteJob>();
  private readonly emit: DeleteEmit;

  constructor(emit: DeleteEmit) {
    this.emit = emit;
  }

  createPlan(scan: ScanResult | null, keys: string[], mode: 'recycle' | 'purge'): PlanResponse {
    if (!scan) throw new ServiceError(400, 'Once tarama yapilmali');
    if (keys.length === 0) throw new ServiceError(400, 'Kume secilmedi');

    const selected = scan.clusters.filter((c) => keys.includes(c.key));
    if (selected.length === 0) throw new ServiceError(400, 'Secilen kumeler bulunamadi');

    let plan: DeletePlan;
    try {
      plan = buildPlan(selected, mode);
    } catch (err) {
      // Guvenlik kapisi burada hata firlatir; plana hicbir zaman girmez.
      throw new ServiceError(400, describeError(err));
    }
    if (plan.targets.length === 0) {
      throw new ServiceError(400, 'Secilen kumeler icin silinecek yol yok');
    }

    const planId = newId();
    const expiresAt = Date.now() + PLAN_TTL_MS;
    const risks = plan.clusters.map((c) => c.risk);
    const requiresPhrase = ApprovalRules.requiresPhrase(risks);
    const requiresHighAck = ApprovalRules.requiresHighAck(risks);
    const stored: StoredPlan = {
      planId,
      plan,
      createdAt: Date.now(),
      expiresAt,
      requiresPhrase,
      requiresHighAck,
    };
    this.plans.set(planId, stored);
    return this.viewOf(stored);
  }

  /**
   * Plan kaydini sozlesme yanitina cevirir. Onay ifadesi MODA baglidir:
   * kasaya tasima "TASI", kalici silme "SIL"; ifade tek kaynaktan
   * (ApprovalRules) gelir. Panel motor hesabidir (kural 18).
   */
  private viewOf(stored: StoredPlan): PlanResponse {
    const approvalKind = stored.plan.mode === 'recycle' ? 'vaultMove' : 'delete';
    const view: PlanView = {
      mode: stored.plan.mode,
      clusters: stored.plan.clusters,
      targets: stored.plan.targets,
      totalBytes: stored.plan.totalBytes,
    };
    return {
      planId: stored.planId,
      plan: view,
      requiresPhrase: stored.requiresPhrase,
      approvalKind,
      phrase: ApprovalRules.phrase(approvalKind),
      requiresHighAck: stored.requiresHighAck,
      expiresAt: stored.expiresAt,
      panel: PlanPanel.from(view),
    };
  }

  /**
   * SAG PANEL icin SALT OKUNUR: en son gecerli plan.
   *
   * Arayuz plan listesini kendi tutmaz; tek kaynak buradaki TTL'li kayittir.
   * Suresi dolan planlar burada temizlenir (execute ile ayni kural).
   */
  currentPlan(): PlanResponse | null {
    const now = Date.now();
    let latest: StoredPlan | null = null;
    for (const [id, stored] of this.plans) {
      if (now > stored.expiresAt) {
        this.plans.delete(id);
        continue;
      }
      if (!latest || stored.createdAt >= latest.createdAt) latest = stored;
    }
    if (!latest) return null;
    return this.viewOf(latest);
  }

  /**
   * Sag panel "Planlananlar": plandan TEK kume veya TEK hedef cikarir.
   *
   * Istemci YOL GONDERMEZ; yalnizca plandaki kimlikleri kullanir:
   *  - `key` (kume anahtari) -> tum kume planin cikarilir.
   *  - `targetId` (planTargetId) -> yalnizca o hedef cikarilir; kumenin
   *    `bytes` degeri kalan hedeflerden yeniden hesaplanir, hedefi
   *    kalmayan kume duser.
   *
   * Cikarma sonrasi onay gereksinimleri KALAN risklerden yeniden
   * hesaplanir; plan kimligi ve suresi korunur. Plan tamamen bosaldiysa
   * kayit silinir ve `null` doner.
   */
  removeFromPlan(
    planId: string,
    selector: { key?: string; targetId?: string },
  ): PlanResponse | null {
    const stored = this.plans.get(planId);
    if (!stored) throw new ServiceError(404, 'Plan bulunamadi veya zaten kullanildi');
    if (Date.now() > stored.expiresAt) {
      this.plans.delete(stored.planId);
      throw new ServiceError(410, 'Plan suresi doldu; yeniden planlayin');
    }
    const key = typeof selector.key === 'string' ? selector.key.trim() : '';
    const targetId = typeof selector.targetId === 'string' ? selector.targetId.trim() : '';
    if (!key && !targetId) {
      throw new ServiceError(400, 'Cikarilacak oge belirtilmedi');
    }

    const plan = stored.plan;
    let clusters = plan.clusters;

    if (targetId) {
      let found = false;
      clusters = clusters
        .map((c) => {
          const kept = c.targets.filter((t) => {
            const hit = planTargetId(c.key, t.target.path) === targetId;
            if (hit) found = true;
            return !hit;
          });
          if (kept.length === c.targets.length) return c;
          const bytes = kept.reduce((a, t) => a + t.bytes, 0);
          return { ...c, targets: kept, bytes };
        })
        .filter((c) => c.targets.length > 0);
      if (!found) throw new ServiceError(404, 'Hedef planda bulunamadi');
    } else {
      const before = clusters.length;
      clusters = clusters.filter((c) => c.key !== key);
      if (clusters.length === before) {
        throw new ServiceError(404, 'Kume planda bulunamadi');
      }
    }

    // Plan bosaldi: tek kullanilabilir kayit yok; kullanimli sayilmaz.
    if (clusters.length === 0) {
      this.plans.delete(stored.planId);
      return null;
    }

    const targets = clusters.flatMap((c) => c.targets);
    const totalBytes = clusters.reduce((a, c) => a + c.bytes, 0);
    const risks = clusters.map((c) => c.risk);
    const next: StoredPlan = {
      ...stored,
      plan: { mode: plan.mode, clusters, targets, totalBytes },
      requiresPhrase: ApprovalRules.requiresPhrase(risks),
      requiresHighAck: ApprovalRules.requiresHighAck(risks),
    };
    this.plans.set(next.planId, next);
    return this.viewOf(next);
  }

  execute(planId: string, phrase: string | undefined, acknowledgeHigh: boolean): ExecuteStartResponse {
    const stored = this.plans.get(planId);
    if (!stored) throw new ServiceError(404, 'Plan bulunamadi veya zaten kullanildi');
    if (Date.now() > stored.expiresAt) {
      this.plans.delete(stored.planId);
      throw new ServiceError(410, 'Plan suresi doldu; yeniden planlayin');
    }
    const approvalKind = stored.plan.mode === 'recycle' ? 'vaultMove' : 'delete';
    if (stored.requiresPhrase && !ApprovalRules.matches(approvalKind, phrase)) {
      throw new ServiceError(
        400,
        `Onay metni hatali ("${ApprovalRules.phrase(approvalKind)}" bekleniyordu)`,
      );
    }
    if (stored.requiresHighAck && acknowledgeHigh !== true) {
      throw new ServiceError(400, 'Yuksek risk onayi eksik');
    }
    if (stored.requiresHighAck) {
      // Override denetimi: hangi plan, hangi yuksek riskli kumeler.
      void audit('delete.high-ack', {
        planId: stored.planId,
        clusters: stored.plan.clusters
          .filter((c) => c.risk === 'high')
          .map((c) => ({ key: c.key, title: c.title, targets: c.targets.length })),
      });
    }

    // Plan tek kullanimlik: ayni planla ikinci kez silme baslatilamaz.
    this.plans.delete(stored.planId);

    const job: ExecuteJob = {
      id: newId(),
      status: 'running',
      last: null,
      startedAt: Date.now(),
    };
    this.jobs.set(job.id, job);
    void this.runExecuteJob(job, stored);
    return { jobId: job.id };
  }

  getJob(id: string): ExecuteJob | undefined {
    return this.jobs.get(id);
  }

  private async runExecuteJob(job: ExecuteJob, stored: StoredPlan): Promise<void> {
    const plan = stored.plan;
    let journal: OperationJournal;
    try {
      // JOURNAL-FIRST: gunluk yazilamiyorsa HICBIR SEY silinmez.
      journal = await OperationJournal.create(job.id, {
        mode: plan.mode,
        planId: stored.planId,
      });
    } catch (err) {
      job.status = 'error';
      const ae = AppError.from(err);
      this.emit(job.id, {
        type: 'error',
        message: `Islem gunlugu yazilamadi; guvenlik icin silme yapilmadi: ${ae.message}`,
        code: ae.code,
        retryable: ae.retryable,
        dataSafe: true,
      });
      return;
    }

    let freed = 0;
    let removed = 0;
    let skipped = 0;
    let failed = 0;
    let consecutiveFailures = 0;
    let processed = 0;
    let circuitBroken = false;

    const emit = (ev: ExecuteEvent) => {
      job.last = ev;
      this.emit(job.id, ev);
    };

    emit({ type: 'start', total: plan.targets.length, bytes: plan.totalBytes, mode: plan.mode });

    try {
      for (let i = 0; i < plan.targets.length; i++) {
        const pt = plan.targets[i]!;
        const itemId = `t-${i}`;

        // Devre kesici: art arda 5 hata veya %20 hata orani asilirsa
        // kalan hedefler silinmez; kullanici raporu gorur.
        if (circuitBroken) {
          await journal.skipped(itemId, 'devre kesici: onceki hatalar');
          skipped++;
          emit({
            type: 'target-done',
            index: i,
            bytesFreed: 0,
            removed: 0,
            skipped: 1,
            failed: 0,
          });
          continue;
        }

        await journal.pending(itemId, pt.target.path, pt.bytes);
        emit({
          type: 'target-start',
          index: i,
          total: plan.targets.length,
          label: pt.target.label,
          path: pt.target.path,
          bytes: pt.bytes,
        });

        const t0 = Date.now();
        const heartbeat = setInterval(
          () => emit({ type: 'heartbeat', index: i, elapsedMs: Date.now() - t0 }),
          5_000,
        );

        let r: DeleteResult | null = null;
        let targetFailed = false;
        try {
          await journal.inProgress(itemId);
          r = await deleteTarget(pt.target, plan.mode);
        } catch (err) {
          targetFailed = true;
          failed++;
          await journal.failed(itemId, describeError(err));
          emit({ type: 'target-done', index: i, bytesFreed: 0, removed: 0, skipped: 0, failed: 1 });
        } finally {
          clearInterval(heartbeat);
        }

        if (r) {
          freed += r.bytesFreed;
          removed += r.removed;
          skipped += r.skipped.length;
          failed += r.failed.length;
          targetFailed = r.failed.length > 0 || (r.removed === 0 && r.skipped.length === 0);

          if (r.removed > 0) {
            await journal.done(itemId, r.bytesFreed);
          } else {
            await journal.skipped(itemId, r.skipped[0]?.reason ?? 'silinecek uygun oge yok');
          }
          for (const s of r.skipped) {
            await journal.skipped(itemId, s.reason);
          }
          for (const f of r.failed) {
            await journal.failed(itemId, f.reason);
          }
          emit({
            type: 'target-done',
            index: i,
            bytesFreed: r.bytesFreed,
            removed: r.removed,
            skipped: r.skipped.length,
            failed: r.failed.length,
          });
        }

        processed++;
        consecutiveFailures = targetFailed ? consecutiveFailures + 1 : 0;
        if (
          consecutiveFailures >= 5 ||
          (processed >= 10 && failed / processed > 0.2)
        ) {
          circuitBroken = true;
        }
      }

      await journal.close('closed');
      job.status = 'done';
      void audit('delete.done', {
        jobId: job.id,
        planId: stored.planId,
        mode: plan.mode,
        freed,
        removed,
        skipped,
        failed,
        journal: journal.file,
      });
      emit({
        type: 'done',
        freed,
        removed,
        skipped,
        failed,
        journalPath: journal.file,
        mode: plan.mode,
      });
    } catch (err) {
      // Journal yazimi veya beklenmeyen hata: islem "crashed" isaretlenir.
      try {
        await journal.close('crashed', describeError(err));
      } catch {
        /* journal zaten yazilamiyor */
      }
      job.status = 'error';
      const ae = AppError.from(err);
      void audit('delete.error', {
        jobId: job.id,
        planId: stored.planId,
        error: ae.message,
        code: ae.code,
      });
      emit({
        type: 'error',
        message: ae.message,
        code: ae.code,
        retryable: ae.retryable,
        dataSafe: ae.dataSafe,
      });
    } finally {
      closeRecycle();
    }
  }
}
