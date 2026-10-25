import { scanCliInventory } from '../core/cli-inventory.ts';
import { error as logError, info } from '../util/log.ts';
import { ServiceError, describeError } from './errors.ts';
import { ActivityGate } from './activity.ts';
import { newId } from './ids.ts';
import type { CliInventory, CliTool } from '../core/cli-inventory-types.ts';
import type { CliInventoryStreamEvent } from '../core/contract.ts';

/**
 * CLI envanteri servisi.
 *
 * Is listesi, tek-flight (ayni anda tek tarama) ve son envanter burada
 * tutulur. SSE istemcileri YOKTUR; olaylar `emit` ile disari verilir.
 */

export interface CliInventoryJob {
  id: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  unusedDays: number;
  tools: CliTool[];
  result?: CliInventory;
  error?: string;
  startedAt: number;
}

export type CliInventoryEmit = (jobId: string, event: CliInventoryStreamEvent) => void;

export class CliInventoryService {
  private readonly jobs = new Map<string, CliInventoryJob>();
  private readonly controllers = new Map<string, AbortController>();
  private active: CliInventoryJob | null = null;
  private lastInventory: CliInventory | null = null;
  private readonly emit: CliInventoryEmit;
  private readonly gate: ActivityGate;

  constructor(emit: CliInventoryEmit, gate: ActivityGate = new ActivityGate()) {
    this.emit = emit;
    this.gate = gate;
  }

  /**
   * Ayni anda tek envanter: calisan is varsa yeni tarama baslatmaz,
   * kimligini paylasir. Biten islerin akisi kapanmistir; temizlenir.
   * Disk taramasi suruyorsa 409 (tek agir is kurali).
   */
  start(unusedDays: number): { jobId: string; shared: boolean } {
    if (this.active) return { jobId: this.active.id, shared: true };
    this.gate.begin('inventory');

    for (const [id, old] of this.jobs) {
      if (old.status !== 'running') this.jobs.delete(id);
    }

    const job: CliInventoryJob = {
      id: newId(),
      status: 'running',
      unusedDays,
      tools: [],
      startedAt: Date.now(),
    };
    const controller = new AbortController();
    this.jobs.set(job.id, job);
    this.controllers.set(job.id, controller);
    this.active = job;

    info('cli envanteri istendi', { jobId: job.id, unusedDays });
    void this.runJob(job, controller);
    return { jobId: job.id, shared: false };
  }

  get(id: string): CliInventoryJob | undefined {
    return this.jobs.get(id);
  }

  getLast(): CliInventory | null {
    return this.lastInventory;
  }

  setLast(inv: CliInventory | null): void {
    this.lastInventory = inv;
  }

  /** Envanter yoksa tarar; plan/onarim uclari bunu kullanir. */
  async ensure(): Promise<CliInventory> {
    if (this.lastInventory) return this.lastInventory;
    const inv = await scanCliInventory({ unusedDays: 21 });
    this.lastInventory = inv;
    return inv;
  }

  cancel(id: string): void {
    const job = this.jobs.get(id);
    if (!job) throw new ServiceError(404, 'Envanter isi bulunamadi');
    if (job.status !== 'running') throw new ServiceError(409, 'Envanter zaten bitti');
    this.controllers.get(id)?.abort();
    info('cli envanteri iptal istendi', { jobId: job.id, bulunan: job.tools.length });
  }

  private async runJob(job: CliInventoryJob, controller: AbortController): Promise<void> {
    try {
      const inv = await scanCliInventory({
        unusedDays: job.unusedDays,
        signal: controller.signal,
        onTool: (tool) => {
          if (job.status !== 'running') return;
          job.tools.push(tool);
          this.emit(job.id, { type: 'tool', tool });
        },
      });

      if (controller.signal.aborted) {
        job.status = 'cancelled';
        info('cli envanteri iptal edildi', {
          jobId: job.id,
          bulunan: job.tools.length,
        });
        this.emit(job.id, { type: 'cancelled' });
        return;
      }

      job.status = 'done';
      job.result = inv;
      this.lastInventory = inv;
      info('cli envanteri tamamlandi', {
        jobId: job.id,
        araclar: inv.tools.length,
        atil: inv.tools.filter((t) => t.status === 'unused').length,
        bilinmiyor: inv.tools.filter((t) => t.status === 'unknown').length,
        korunan: inv.tools.filter((t) => t.status === 'protected').length,
        cokluKurulum: inv.duplicates.length,
      });
      this.emit(job.id, { type: 'done', inventory: inv });
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        job.status = 'cancelled';
        info('cli envanteri iptal edildi', { jobId: job.id, bulunan: job.tools.length });
        this.emit(job.id, { type: 'cancelled' });
      } else {
        job.status = 'error';
        job.error = describeError(err);
        logError('cli envanteri basarisiz', { jobId: job.id, err: job.error });
        this.emit(job.id, { type: 'error', message: job.error });
      }
    } finally {
      if (this.active === job) this.active = null;
      this.gate.end('inventory');
      this.controllers.delete(job.id);
    }
  }
}
