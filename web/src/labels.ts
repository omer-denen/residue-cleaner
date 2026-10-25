import type {
  DashboardCardTitleId,
  DashboardDetailId,
  DashboardDetailTextId,
  EnvFindingKind,
  ScanStatusKind,
  ScanStatusReason,
  ScanStatusRowId,
} from '../../src/core/contract.ts';
import type { MessageKey } from './i18n.ts';

/** Ortak etiket haritalari: kimlik -> ceviri anahtari. Karar yok. */

/**
 * Risk kartinin KONUSU (baslik).
 *
 * "Disk değişti" bir SONUCtur; öznesi "Önceki Tarama"dır. Konu ve sonuç
 * ayrı kimliklerdir; ikisini de motor secer.
 */
export const CARD_TITLE_LABEL: Record<DashboardCardTitleId, MessageKey> = {
  scan: 'cardtitle.scan',
  paths: 'cardtitle.paths',
  vars: 'cardtitle.vars',
  commands: 'cardtitle.commands',
  installs: 'cardtitle.installs',
  deps: 'cardtitle.deps',
  recover: 'cardtitle.recover',
  vault: 'cardtitle.vault',
  schedules: 'cardtitle.schedules',
};

/** "Altindaki liste"de gosterilen detayin basligi. */
export const DETAIL_TITLE_LABEL: Record<DashboardDetailId, MessageKey> = {
  scan: 'detail.scan',
  paths: 'detail.paths',
  vars: 'detail.vars',
  commands: 'detail.commands',
  installs: 'detail.installs',
  deps: 'detail.deps',
  recover: 'detail.recover',
  vault: 'detail.vault',
  schedules: 'detail.schedules',
  'ledger-protected': 'detail.ledger.protected',
  'ledger-reclaimable': 'detail.ledger.reclaimable',
  'ledger-vault': 'detail.ledger.vault',
  'ledger-cli': 'detail.ledger.cli',
};

/**
 * Tarama durumu etiketleri.
 *
 * Motor `ScanStatusKind` kararini verir; burada yalnizca metne cevrilir.
 * `stale` tek basina kullanilmaz: motor "expired" ve "dirty" ayrimini yapar.
 */
export const SCAN_STATUS_LABEL: Record<ScanStatusKind, MessageKey> = {
  never: 'scan.kind.never',
  current: 'scan.kind.current',
  expired: 'scan.kind.expired',
  dirty: 'scan.kind.dirty',
  'dirty-expired': 'scan.kind.dirty-expired',
  scanning: 'scan.kind.scanning',
};

/** Detay raporundaki neden metinleri. */
export const SCAN_REASON_LABEL: Record<ScanStatusReason, MessageKey> = {
  'never-scanned': 'scan.reason.never-scanned',
  fresh: 'scan.reason.fresh',
  expired: 'scan.reason.expired',
  dirty: 'scan.reason.dirty',
  scanning: 'scan.reason.scanning',
};

/** Detay raporundaki satir etiketleri. */
export const SCAN_ROW_LABEL: Record<ScanStatusRowId, MessageKey> = {
  progress: 'scan.row.progress',
  lastScan: 'scan.row.lastScan',
  age: 'scan.row.age',
  nextRecommended: 'scan.row.nextRecommended',
  ttl: 'scan.row.ttl',
  scope: 'scan.row.scope',
  diskDrive: 'scan.row.diskDrive',
  diskTotal: 'scan.row.diskTotal',
  diskFree: 'scan.row.diskFree',
  diskUsed: 'scan.row.diskUsed',
};

export const CATEGORY_LABEL: Record<string, MessageKey> = {
  protected: 'category.protected',
  duplicate: 'category.duplicate',
  'old-version': 'category.old-version',
  orphan: 'category.orphan',
  unused: 'category.unused',
  'ai-debris': 'category.ai-debris',
  'ghost-envs': 'category.ghost-envs',
  unknown: 'category.unknown',
};

export const VERDICT_LABEL: Record<string, MessageKey> = {
  recommend: 'verdict.recommend',
  ask: 'verdict.ask',
  'report-only': 'verdict.report-only',
  keep: 'verdict.keep',
};

export const RISK_LABEL: Record<string, MessageKey> = {
  safe: 'risk.safe',
  low: 'risk.low',
  medium: 'risk.medium',
  high: 'risk.high',
};

export const REGEN_LABEL: Record<string, MessageKey> = {
  regenerable: 'reason.regenerable',
  'user-data': 'reason.user-data',
  unknown: 'reason.unknown',
};

export const CONFIDENCE_LABEL: Record<string, MessageKey> = {
  high: 'confidence.high',
  medium: 'confidence.medium',
  low: 'confidence.low',
};

export const CLI_STATUS_LABEL: Record<string, MessageKey> = {
  unused: 'cli.status.unused',
  recent: 'cli.status.recent',
  unknown: 'cli.status.unknown',
  protected: 'cli.status.protected',
};

export const CLI_SOURCE_LABEL: Record<string, MessageKey> = {
  'npm-global': 'cli.source.npm',
  'uv-tool': 'cli.source.uv',
  'dotnet-tool': 'cli.source.dotnet',
  'pip-user': 'cli.source.pip',
  standalone: 'cli.source.standalone',
};

export const ENV_SCOPE_LABEL: Record<string, MessageKey> = {
  user: 'env.scope.user',
  machine: 'env.scope.machine',
  both: 'env.scope.both',
};

export const ENV_FINDING_LABEL: Record<string, MessageKey> = {
  'missing-path': 'env.kind.missing-path',
  'duplicate-path': 'env.kind.duplicate-path',
  'shadowed-command': 'env.kind.shadowed-command',
  'orphan-variable': 'env.kind.orphan-variable',
  'sensitive-variable': 'env.kind.sensitive-variable',
  'empty-variable': 'env.kind.empty-variable',
};

/**
 * Bulgu turu -> gerekce cumlesi.
 *
 * Motor `reason` alanini CLI icin Turkce tutar; arayuz bu kimlikten
 * TR/EN metni secer (AGENTS.md 9/18).
 */
export const ENV_REASON_LABEL: Record<EnvFindingKind, MessageKey> = {
  'missing-path': 'env.reason.missing-path',
  'duplicate-path': 'env.reason.duplicate-path',
  'shadowed-command': 'env.reason.shadowed-command',
  'orphan-variable': 'env.reason.orphan-variable',
  'sensitive-variable': 'env.reason.sensitive-variable',
  'empty-variable': 'env.reason.empty-variable',
};

/** Detay satirindaki sabit metinler: kimlik -> ceviri anahtari. */
export const DETAIL_TEXT_LABEL: Record<DashboardDetailTextId, MessageKey> = {
  ...ENV_REASON_LABEL,
  operation: 'detail.operation',
  'operation-vault': 'detail.operation.vault',
  'interrupted-items': 'detail.interrupted.items',
  'schedule-missed': 'detail.schedule.missed',
  'schedule-due': 'detail.schedule.due',
  'ledger-cli-empty': 'ledger.cli.empty',
};

export const GRAPH_NODE_LABEL: Record<string, MessageKey> = {
  tool: 'graph.node.tool',
  package: 'graph.node.package',
  shim: 'graph.node.shim',
  'path-entry': 'graph.node.path-entry',
  'env-var': 'graph.node.env-var',
  project: 'graph.node.project',
  'state-dir': 'graph.node.state-dir',
  shortcut: 'graph.node.shortcut',
  runtime: 'graph.node.runtime',
  process: 'graph.node.process',
  config: 'graph.node.config',
  unknown: 'graph.node.unknown',
};

export const GRAPH_EDGE_LABEL: Record<string, MessageKey> = {
  exec: 'graph.edge.exec',
  package: 'graph.edge.package',
  'project-ref': 'graph.edge.project-ref',
  env: 'graph.edge.env',
  runtime: 'graph.edge.runtime',
  shortcut: 'graph.edge.shortcut',
  link: 'graph.edge.link',
  config: 'graph.edge.config',
};

export const GRAPH_STRENGTH_LABEL: Record<string, MessageKey> = {
  hard: 'graph.strength.hard',
  soft: 'graph.strength.soft',
  weak: 'graph.strength.weak',
};

export const GRAPH_STATE_LABEL: Record<string, MessageKey> = {
  intact: 'graph.state.intact',
  broken: 'graph.state.broken',
  shadowed: 'graph.state.shadowed',
  drifted: 'graph.state.drifted',
  'missing-chain': 'graph.state.missing-chain',
  cyclic: 'graph.state.cyclic',
  unknown: 'graph.state.unknown',
};

export const GRAPH_ROLE_LABEL: Record<string, MessageKey> = {
  isolated: 'graph.role.isolated',
  leaf: 'graph.role.leaf',
  shared: 'graph.role.shared',
  hub: 'graph.role.hub',
};

export const GRAPH_LEVEL_LABEL: Record<string, MessageKey> = {
  low: 'graph.level.low',
  medium: 'graph.level.medium',
  high: 'graph.level.high',
  critical: 'graph.level.critical',
};

export const SCHEDULE_STATUS_LABEL: Record<string, MessageKey> = {
  pending: 'schedules.status.pending',
  running: 'schedules.status.running',
  done: 'schedules.status.done',
  missed: 'schedules.status.missed',
  failed: 'schedules.status.failed',
  cancelled: 'schedules.status.cancelled',
};

export const SCHEDULE_FREQ_LABEL: Record<string, MessageKey> = {
  once: 'schedules.freq.once',
  daily: 'schedules.freq.daily',
  weekly: 'schedules.freq.weekly',
};

export const SCHEDULE_WEEKDAY_LABEL: MessageKey[] = [
  'schedules.weekday.0',
  'schedules.weekday.1',
  'schedules.weekday.2',
  'schedules.weekday.3',
  'schedules.weekday.4',
  'schedules.weekday.5',
  'schedules.weekday.6',
];
