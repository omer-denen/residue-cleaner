import { DashboardSummary, type DashboardFacts } from '../core/dashboard-summary.ts';
import { DashboardDetails, type DashboardDetailItem } from '../core/dashboard-details.ts';
import { diskFindings } from '../core/findings.ts';
import { interruptedOperations } from '../core/operation-journal.ts';
import { expiredVaultEntries, listVaultEntries } from '../actions/vault.ts';
import type { DashboardResponse } from '../core/contract.ts';
import type { ScanService } from './scan-service.ts';
import type { EnvService } from './env-service.ts';
import type { GraphService } from './graph-service.ts';
import type { ScheduleService } from './schedule-service.ts';
import type { CliInventoryService } from './cli-inventory-service.ts';

/**
 * Baslangic ozeti servisi.
 *
 * Karar VERMEZ: gercekleri toplar, `DashboardSummary`'ye verir.
 * ONEMLI: agir tarama tetiklemez. Tarama onbellegi, envanter onbellegi
 * ve ucuz disk okumalari kullanilir; envanter yoksa graf kartlari gizlenir.
 */

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export class DashboardService {
  private readonly scan: ScanService;
  private readonly env: EnvService;
  private readonly graph: GraphService;
  private readonly schedules: ScheduleService;
  private readonly inventory: CliInventoryService;

  constructor(
    scan: ScanService,
    env: EnvService,
    graph: GraphService,
    schedules: ScheduleService,
    inventory: CliInventoryService,
  ) {
    this.scan = scan;
    this.env = env;
    this.graph = graph;
    this.schedules = schedules;
    this.inventory = inventory;
  }

  async view(): Promise<DashboardResponse> {
    const status = await this.scan.status();
    const clusters = this.scan.last()?.scan.clusters ?? [];
    const findings = diskFindings(clusters);

    let diskBytes = 0;
    for (const f of findings) diskBytes += f.bytes;

    const inv = this.inventory.getLast();
    let cliBytes = 0;
    let cliCount = 0;
    let brokenInstalls = 0;
    if (inv) {
      for (const t of inv.tools) {
        cliBytes += t.totalBytes;
        cliCount++;
        if (t.health === 'broken') brokenInstalls++;
      }
    }

    const [env, graph, vault, schedules, interrupted, settings] = await Promise.all([
      safe(() => this.env.analyze()),
      safe(() => this.graph.viewCached()),
      safe(() => listVaultEntries()),
      safe(() => this.schedules.list()),
      safe(() => interruptedOperations()),
      safe(() => this.scan.settings()),
    ]);

    const retentionDays = settings?.vaultRetentionDays ?? 30;
    const expired = vault ? await safe(() => expiredVaultEntries(retentionDays)) : null;

    // --- Kart detaylari: secilen kartin satirlari ----------------------
    const brokenTools: DashboardDetailItem[] | null = inv
      ? inv.tools
          .filter((t) => t.health === 'broken')
          .map((t) => ({
            id: t.id,
            label: t.command,
            value: t.installPath,
            tone: 'danger' as const,
          }))
      : null;

    const brokenEdges: DashboardDetailItem[] | null = graph
      ? graph.edges
          .filter((e) => e.state === 'broken' || e.state === 'missing-chain')
          .map((e) => ({
            id: e.id,
            label: `${e.from} → ${e.to}`,
            value: e.evidence ?? e.kind,
            tone: 'danger' as const,
          }))
      : null;

    const interruptedItems: DashboardDetailItem[] = (interrupted ?? []).map((op) => ({
      id: op.operationId,
      label: '',
      labelId: op.mode === 'vault' ? 'operation-vault' : 'operation',
      value: '',
      valueId: 'interrupted-items',
      amount: op.items.length,
      tone: 'warn' as const,
    }));

    const expiredItems: DashboardDetailItem[] = (expired ?? []).map((e) => ({
      id: e.id,
      label: e.originalPath ?? e.id,
      value: '',
      valueKind: 'bytes',
      amount: e.bytes,
      tone: 'warn' as const,
    }));

    const scheduleItems: DashboardDetailItem[] = (schedules ?? [])
      .filter((s) => s.missed > 0 || s.due)
      .map((s) => ({
        id: s.id,
        label: s.name,
        value: '',
        valueId: s.missed > 0 ? ('schedule-missed' as const) : ('schedule-due' as const),
        amount: s.missed,
        tone: s.missed > 0 ? ('warn' as const) : ('default' as const),
      }));

    // Defter kartlari: Kasa ve Araclarda icerikleri.
    const expiredIds = new Set((expired ?? []).map((e) => e.id));
    const vaultItems: DashboardDetailItem[] = (vault ?? []).map((e) => ({
      id: e.id,
      label: e.originalPath ?? e.id,
      value: '',
      valueKind: 'bytes',
      amount: e.bytes,
      tone: expiredIds.has(e.id) ? ('warn' as const) : ('default' as const),
    }));

    const cliItems: DashboardDetailItem[] | null = inv
      ? inv.tools.map((t) => ({
          id: t.id,
          label: `${t.command} · ${t.source}`,
          value: '',
          valueKind: 'bytes',
          amount: t.totalBytes,
          tone: t.status === 'unused' ? ('warn' as const) : ('default' as const),
        }))
      : null;

    const details = new DashboardDetails({
      clusters,
      envFindings: env?.findings ?? null,
      commandShadows: env?.commandShadows ?? null,
      brokenTools,
      brokenEdges,
      interrupted: interruptedItems,
      expiredVault: expiredItems,
      vaultItems,
      cliItems,
      schedules: scheduleItems,
    }).views();

    const pathIssues =
      env?.findings.filter(
        (f) => f.kind === 'missing-path' || f.kind === 'duplicate-path',
      ).length ?? 0;
    const orphanVars = env?.findings.filter((f) => f.kind === 'orphan-variable').length ?? 0;

    const facts: DashboardFacts = {
      now: Date.now(),
      scan: {
        state: status.state,
        at: status.lastScanAt,
        ageMs: status.ageMs,
        scanning: status.scanning,
        clusters,
        view: status.view,
      },
      inventory: {
        diskBytes,
        diskCount: findings.length,
        cliBytes,
        cliCount,
        brokenInstalls,
        cliKnown: inv !== null,
      },
      env: env
        ? {
            pathIssues,
            orphanVars,
            shadowedCommands: env.commandShadows.length,
          }
        : null,
      graph: graph
        ? {
            broken: graph.summary.broken,
            critical: graph.summary.critical,
            shadowed: graph.summary.shadowed,
          }
        : null,
      recover: { interrupted: interrupted?.length ?? 0 },
      vault: {
        entries: vault?.length ?? 0,
        bytes: (vault ?? []).reduce((sum, e) => sum + e.bytes, 0),
        expired: expired?.length ?? 0,
        lastAt:
          (vault ?? []).reduce((max, e) => {
            const at = typeof e.at === 'number' && Number.isFinite(e.at) ? e.at : null;
            if (at === null) return max;
            return max === null || at > max ? at : max;
          }, null as number | null),
      },
      schedules: {
        rules: schedules?.length ?? 0,
        due: (schedules ?? []).filter((s) => s.due).length,
        missed: (schedules ?? []).reduce((sum, s) => sum + s.missed, 0),
      },
      disk: status.disk
        ? { totalBytes: status.disk.totalBytes, freeBytes: status.disk.freeBytes }
        : null,
      details,
    };

    return new DashboardSummary(facts).view();
  }
}
