import type {
  Cluster,
  Confidence,
  Regenerability,
  ScanResult,
  SkippedEntry,
  VerdictKind,
} from './types.ts';
import type { CategoryKey, CategoryStat } from './categories.ts';import type { CliInventory, CliSource, CliStatus, CliTool } from './cli-inventory-types.ts';
import type {
  DependencyLevel,
  EdgeState,
  GraphEdge,
  GraphKindGroup,
  GraphNode,
  GraphNodeKind,
  NodeRole,
  RootCause,
  WhatIfResult,
} from './dependency-graph.ts';
import type { EnvFinding, EnvFindingKind, EnvPlan } from './env-engine.ts';
import type {
  ScheduleFrequency,
  ScheduleRule,
  ScheduleRun,
  ScheduleSelector,
} from './plan-engine.ts';
import type { Ecosystem, ProjectCleanupMode } from './project-deps.ts';

export type { CategoryKey, CategoryStat } from './categories.ts';

/**
 * Web arayuzu ile sunucu arasindaki veri sozlesmesi.
 *
 * Bu dosyada Node'a ait HICBIR tip yoktur; tarayici tarafi da ayni
 * sozlesmeyi tip olarak kullanir. Boylece API sekli tek yerde kalir.
 *
 * Guvenlik notu: istemci YOL GONDERMEZ. Silinecek yollarin tamami
 * sunucudaki tarama sonucundan uretilir; istemci yalnizca kume
 * anahtarlarini ve onay bilgisini yollar.
 */

export type DeleteMode = 'recycle' | 'purge';
export type RiskLevel = 'safe' | 'low' | 'medium' | 'high';

export interface DeleteTargetView {
  path: string;
  kind: 'whole' | 'older';
  minAgeDays?: number;
  label: string;
  bytes: number;
}

export interface PlannedTargetView {
  target: DeleteTargetView;
  bytes: number;
}

export interface PlannedClusterView {
  /** Kume anahtari: plan ekraninda "plandan cikar" islemi icin. */
  key: string;
  title: string;
  reason: string;
  risk: RiskLevel;
  /** Kume hedeflerinin toplam bayti (motor hesaplar). */
  bytes: number;
  targets: PlannedTargetView[];
}

export interface PlanView {
  mode: DeleteMode;
  clusters: PlannedClusterView[];
  targets: PlannedTargetView[];
  totalBytes: number;
}

// ---------------------------------------------------------------------------
// Sag panel plan gorunumu (plan paneli)
// ---------------------------------------------------------------------------

/**
 * Panel satiri: planlanan TEK hedef. `id` kume anahtari + yol ozetinden
 * uretilen KARARLI kimliktir; istemci cikarma isteginde YOL DEGIL `id`
 * yollar (AGENTS.md: istemci yol gondermez).
 */
export interface PlanPanelItem {
  id: string;
  path: string;
  label: string;
  kind: 'whole' | 'older';
  minAgeDays?: number;
  bytes: number;
}

/** Panel grubu: planlanan kume ve altindaki hedefler. */
export interface PlanPanelGroup {
  key: string;
  title: string;
  reason: string;
  risk: RiskLevel;
  bytes: number;
  targetCount: number;
  items: PlanPanelItem[];
}

/**
 * Sag panel "Planlananlar" gorunumu. Gruplama, siralama ve sayimlar
 * MOTORDA hesaplanir (`core/plan-panel.ts`); arayuz yalnizca basar.
 */
export interface PlanPanelView {
  mode: DeleteMode;
  /** Kume gruplari: bayti buyukten kucuge; esitlikte anahtar alfabetik. */
  groups: PlanPanelGroup[];
  /** Planlanan kume anahtarlar (grup sirasiyla; liste rozeti). */
  keys: string[];
  totalBytes: number;
  clusterCount: number;
  targetCount: number;
}

// ---------------------------------------------------------------------------
// Tarama
// ---------------------------------------------------------------------------

export interface ScanRequest {
  envs?: string[];
  profile?: string;
  minAgeDays?: number;
  exclude?: string[];
  root?: string;
  /** Birden fazla proje koku (root ile birlesir). */
  roots?: string[];
}

export interface ScanStartResponse {
  scanId: string;
}

export interface ActiveScanResponse {
  error: string;
  scanId: string;
}

export type ScanStreamEvent =
  /** Kesif tamamlandi: solda gosterilecek tam alan listesi. */
  | { type: 'targets'; paths: string[] }
  /** Tek tek kokler: kullanici ne taranıyor ve ne bulundu gorur. */
  | { type: 'target-start'; path: string; done: number; total: number }
  | {
      type: 'target-done';
      path: string;
      done: number;
      total: number;
      cluster: Cluster | null;
    }
  /**
   * Oge duzeyi olay. `id` kararlidir (kume anahtari + yol ozeti): ayni
   * oge tekrar gelirse istemci satiri gunceller, cogaltmaz. `target-done`
   * geriye donuk uyumluluk icin korunur.
   */
  | {
      type: 'item';
      id: string;
      key: string;
      path: string;
      cluster: Cluster;
      done: number;
      total: number;
    }
  | { type: 'progress'; done: number; total: number; bytes: number }
  /** Erisilemeyen yollar: tarama durmaz, kanit olarak akar. */
  | { type: 'skipped'; skipped: SkippedEntry[] }
  /** Kullanici taramayi duraklatti / devam ettirdi. */
  | { type: 'paused' }
  | { type: 'resumed' }
  | { type: 'done'; result: ScanResult }
  | { type: 'cancelled' }
  | { type: 'error'; message: string };

export interface ScanCancelResponse {
  ok: boolean;
}

export interface LatestResponse {
  scan: ScanResult | null;
  at: number | null;
}

export type ScanFreshness = 'never' | 'current' | 'stale' | 'scanning';

/**
 * Tarama durumunun AYIRT EDILMIS hali.
 *
 * `ScanFreshness` ("stale") iki farkli sebebi tek kelimede birlestirir:
 * onbellek suresi doldu (`expired`) ve disk taramadan beri degisti (`dirty`).
 * Arayuzde "Eski" yazan bir rozet, ikisini ayirt edemedigi icin yaniltici
 * olur; bu tip ayrimi motor yapar.
 */
export type ScanStatusKind =
  | 'never'
  | 'current'
  | 'expired'
  | 'dirty'
  | 'dirty-expired'
  | 'scanning';

export type ScanStatusTone = 'info' | 'ok' | 'warn' | 'danger';

/** Detay raporunda gosterilen nedenler (sirali). */
export type ScanStatusReason = 'never-scanned' | 'fresh' | 'expired' | 'dirty' | 'scanning';

/**
 * Rapor satirinin deger turu. MOTOR turu secer; arayuz yalnizca bicimlendirir.
 */
export type ScanStatusUnit = 'timestamp' | 'duration' | 'bytes' | 'count' | 'ratio' | 'text';

export type ScanStatusRowId =
  | 'lastScan'
  | 'age'
  | 'nextRecommended'
  | 'ttl'
  | 'scope'
  | 'diskDrive'
  | 'diskTotal'
  | 'diskFree'
  | 'diskUsed';

export interface ScanStatusRow {
  id: ScanStatusRowId;
  /** Sayisal deger; `unit` nasil bicimlendirilecegini belirtir. */
  amount?: number;
  unit?: ScanStatusUnit;
  /** Motordan gelen metin (kimlik veya kisa aciklama). */
  text?: string;
  tone?: ScanStatusTone;
}

/** Ust cubuktaki rozet: durum degil, ZAMAN gosterilir (UX-040). */
export type ScanHeaderKind = 'none' | 'age' | 'scanning';

export interface ScanStatusHeader {
  kind: ScanHeaderKind;
  ageMs: number | null;
}

/**
 * MOTORUN belirledigi tarama durumu gorunumu.
 *
 * Etiket, ton, neden sirasi, rapor satirlari ve eylem burada karar verilir.
 * Arayuz yalnizca bu gorunumu basar.
 */
export interface ScanStatusViewResponse {
  kind: ScanStatusKind;
  tone: ScanStatusTone;
  /** Detay raporundaki nedenler (sirali). */
  reasons: ScanStatusReason[];
  /** Detay raporundaki satirlar (sirali). */
  rows: ScanStatusRow[];
  /** Ust cubuk rozeti icin zaman etiketi (motor secer). */
  header: ScanStatusHeader;
  /** Kullaniciya onerilen eylem: 'scan' = yeniden tara. */
  action: 'scan' | 'none';
  /** Rozet satirinda yasi goster. */
  showAge: boolean;
}

/** Ham tarama durumu gercekleri (karar verilmemis). */
export interface ScanStatusFacts {
  state: ScanFreshness;
  lastScanAt: number | null;
  ageMs: number | null;
  ttlMs: number;
  nextRecommendedAt: number | null;
  /** Silme/ayar sonrasi disk degisti mi? */
  dirty: boolean;
  scanning: boolean;
  /** Tarama duraklatildi mi? (scanning true iken anlamli) */
  paused?: boolean;
  clusters: number | null;
  /** Surucu dolulugu (salt okunur sistem olcumu). */
  disk: DiskUsageView | null;
}

export interface ScanStatusResponse extends ScanStatusFacts {
  /** Motorun belirledigi gorunum (arayuz bunu basar). */
  view: ScanStatusViewResponse;
}

export interface DiskUsageView {
  drive: string;
  totalBytes: number;
  freeBytes: number;
  /** Doluluk orani 0..1 */
  usedRatio: number;
}

/**
 * Birlesik bulgu (disk + CLI). SALT OKUNUR: planlar kaynak basina ayridir,
 * birlesik bir uygulama YOKTUR (iki ayri yazili onay).
 */
export interface FindingView {
  id: string;
  source: 'disk' | 'cli';
  title: string;
  path: string;
  category: string;
  bytes: number;
  idleDays: number | null;
  risk: RiskLevel;
  verdict: string;
  selectable: boolean;
  reason: string;
  evidence: string[];
  targets: number;
  ref?: string;
  /** Sahip durumu: aktif / yetim / paylasilan / bilinmiyor. */
  ownerStatus?: 'active' | 'orphaned' | 'shared' | 'unknown';
  /** Varsayilan secim yalnizca safe + kanitli ogeleri kapsar. */
  defaultSelected?: boolean;
}

export interface FindingsResponse {
  findings: FindingView[];
  disk: number;
  cli: number;
  at: number | null;
}

export interface SettingsResponse {
  scanCacheHours: number;
  minCacheHours: number;
  maxCacheHours: number;
  /** Bilgi amacli: kasa kayitlari icin onerilen saklama suresi. */
  vaultRetentionDays: number;
  /** Surum kontrolu (T41): off | daily | weekly. Varsayilan off. */
  updateCheck: 'off' | 'daily' | 'weekly';
}

export interface SettingsUpdateRequest {
  scanCacheHours?: number;
  vaultRetentionDays?: number;
  updateCheck?: 'off' | 'daily' | 'weekly';
}

/** Surum kontrolu sonucu (T41). Kapaliyken checked=false, ag istegi yapilmaz. */
export interface UpdateCheckView {
  checked: boolean;
  mode: 'off' | 'daily' | 'weekly';
  latest?: string;
  current?: string;
  updateAvailable: boolean;
  checkedAt?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Kasa (vault)
// ---------------------------------------------------------------------------

export interface VaultEntryView {
  id: string;
  batchId: string;
  originalPath: string;
  storedPath: string;
  bytes: number;
  files: number;
  at: number;
  ageMs: number;
  /** Onerilen saklama suresine gore kalan gun (bilgi amacli). */
  remainingDays: number;
  /** Orijinal yol su an dolu mu? (geri yuklemede cakisma) */
  originalExists: boolean;
}

export interface VaultListResponse {
  entries: VaultEntryView[];
  totalBytes: number;
  retentionDays: number;
  /** Kalici bosaltma icin beklenen yazili ifade (tek kaynak). */
  purgePhrase: string;
}

export interface VaultRestoreRequest {
  id: string;
  /** files (varsayilan) | repair | side-by-side */
  mode?: 'files' | 'repair' | 'side-by-side';
  /** rename (varsayilan) | overwrite | cancel */
  conflict?: 'rename' | 'overwrite' | 'cancel';
}

export interface VaultRestoreResponse {
  ok: boolean;
  to: string;
  conflict: boolean;
  mode?: string;
  verified?: boolean;
  error?: string;
}

/** Kasadaki tum kayitlari geri yukler (cakismalar `.restored-*` olur). */
export interface VaultRestoreAllResponse {
  ok: boolean;
  restored: number;
  conflict: number;
  failed: number;
  unverified?: number;
}

/** Kasayi bosaltma: kalici, yazili onay ister. */
export interface VaultPurgeRequest {
  /** Sunucunun bekledigi ifade: BOŞALT */
  phrase: string;
  /** Opsiyonel: yalnizca bu kasa oge kimlikleri. Bos/verilmezse tum partiler. */
  ids?: string[];
}

export interface VaultPurgeResponse {
  ok: boolean;
  batches: number;
  bytes: number;
  failed: number;
  items?: number;
}

// ---------------------------------------------------------------------------
// Plan ve silme
// ---------------------------------------------------------------------------

export interface PlanRequest {
  scanId?: string;
  keys: string[];
  mode: DeleteMode;
}

export interface PlanResponse {
  planId: string;
  plan: PlanView;
  /** Sag panel "Planlananlar" verisi; MOTOR kurar (`core/plan-panel.ts`). */
  panel: PlanPanelView;
  /** Orta/yuksek risk varsa yazili onay zorunlu (kasa: TASI, kalici: SIL) */
  requiresPhrase: boolean;
  /** Onay turu: kasa tasima `vaultMove`, kalici silme `delete`. */
  approvalKind: 'vaultMove' | 'delete';
  /** Sunucunun bekledigi yazili ifade (tek kaynak: ApprovalRules). */
  phrase: string;
  /** Yuksek risk varsa ayrica acik isaretleme zorunlu */
  requiresHighAck: boolean;
  expiresAt: number;
}

export interface ExecuteRequest {
  planId: string;
  phrase?: string;
  acknowledgeHigh?: boolean;
}

export interface ExecuteStartResponse {
  jobId: string;
}

export type ExecuteEvent =
  | { type: 'start'; total: number; bytes: number; mode: DeleteMode }
  | {
      type: 'target-start';
      index: number;
      total: number;
      label: string;
      path: string;
      bytes: number;
    }
  | { type: 'heartbeat'; index: number; elapsedMs: number }
  | {
      type: 'target-done';
      index: number;
      bytesFreed: number;
      removed: number;
      skipped: number;
      failed: number;
    }
  | {
      type: 'done';
      freed: number;
      removed: number;
      skipped: number;
      failed: number;
      journalPath: string;
      mode: DeleteMode;
    }
  | {
      type: 'error';
      message: string;
      /** AppError kodu; istemci "yeniden dene" kararini buna gore verir. */
      code?: string;
      retryable?: boolean;
      dataSafe?: boolean;
    };

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export interface MetaResponse {
  envs: Array<{ id: string; label: string; description: string }>;
  profiles: Array<{ name: string; description: string; envs: string[] }>;
  defaults: {
    envs: string[];
    profile: string | null;
    exclude: string[];
    minAgeDays: number;
  };
  /** Sunucunun calisma dizini; proje kesfi icin onerilen kok. */
  cwd?: string;
  /** Kullanici profili; proje kesfi icin onerilen kok. */
  home?: string;
  /** Statik arayuz sunuluyor mu? */
  ui?: boolean;
  /** Paket surumu (arayuz alt bilgisi). */
  version?: string;
}

export interface ApiErrorBody {
  error: string;
  scanId?: string;
}

// ---------------------------------------------------------------------------
// Yeni motor sozlesmeleri (tip-only; tarayici da kullanabilir)
// ---------------------------------------------------------------------------

export type {
  CommandShadow,
  EnvAnalysis,
  EnvApplyResult,
  EnvChange,
  EnvFinding,
  EnvFindingKind,
  EnvPlan,
  EnvScope,
  EnvSnapshot,
  EnvVariable,
  PathEntry,
  RegistryType,
} from './env-engine.ts';
export type {
  BlockedRemoval,
  DependencyLevel,
  EdgeKind,
  EdgeState,
  EdgeStrength,
  GraphEdge,
  GraphKindGroup,
  GraphNode,
  GraphNodeKind,
  NodeRole,
  RootCause,
  WhatIfResult,
} from './dependency-graph.ts';
export type {
  Ecosystem,
  ProjectArtifact,
  ProjectCleanupMode,
  ProjectPlan,
  ProjectRecipe,
} from './project-deps.ts';
export type {
  PlanPreview,
  ScheduleFrequency,
  ScheduleRule,
  ScheduleRun,
  ScheduleSelector,
} from './plan-engine.ts';

// ---------------------------------------------------------------------------
// Planlar / zamanlama (M4) — yalniz KASAYA tasir
// ---------------------------------------------------------------------------

export interface ScheduleView extends ScheduleRule {
  nextRunAt: number | null;
  due: boolean;
  missed: number;
  lastRun: ScheduleRun | null;
}

export interface ScheduleCreateRequest {
  name: string;
  frequency: ScheduleFrequency;
  hour?: number;
  minute?: number;
  weekday?: number;
  runAt?: number;
  selector?: ScheduleSelector;
  enabled?: boolean;
  compensateMissed?: boolean;
  /** API icin yazili onay (ApprovalRules.schedule = PLANLA). */
  phrase?: string;
}

export interface ScheduleListResponse {
  schedules: ScheduleView[];
}

export interface ScheduleCatchUpItem {
  rule: ScheduleView;
  missed: number;
  message: string;
}

export interface ScheduleCatchUpResponse {
  catchUp: ScheduleCatchUpItem[];
}

export interface ScheduleHistoryResponse {
  runs: ScheduleRun[];
}

// ---------------------------------------------------------------------------
// Ortam / PATH plani (yazili TEMIZLE onayi ister)
// ---------------------------------------------------------------------------

export interface EnvPlanResponse {
  planId: string;
  plan: EnvPlan;
  findings: EnvFinding[];
  expiresAt: number;
  /** Yazili onay ifadesi (ApprovalRules.envClean). */
  phrase: string;
  approvalKind: 'envClean';
}

// ---------------------------------------------------------------------------
// Bagimlilik grafigi gorunumu
// ---------------------------------------------------------------------------

export interface GraphDependentView {
  /** Karsi dugumun kimligi. */
  id: string;
  label: string;
  kind: GraphNodeKind;
  edge: GraphEdge;
}

export interface GraphNodeView extends GraphNode {
  role: NodeRole;
  level: DependencyLevel;
  /** Gelen kenarlar: bu dugume ihtiyac duyan dugumler (SALT OKUNUR). */
  dependents: GraphDependentView[];
  /** Giden kenarlar: bu dugumun ihtiyac duydugu dugumler (SALT OKUNUR). */
  needs: GraphDependentView[];
}

export interface GraphKindCount {
  kind: GraphNodeKind;
  count: number;
}

export interface GraphStateCount {
  state: EdgeState;
  count: number;
}

/** Ozet kartlari tiklandiginda acilacak ayrinti (MOTOR hesaplar). */
export interface GraphDetails {
  nodeKindCounts: GraphKindCount[];
  edgeStateCounts: GraphStateCount[];
  brokenEdges: GraphEdge[];
  shadowedEdges: GraphEdge[];
  criticalNodes: GraphNodeView[];
}

export interface GraphViewResponse {
  nodes: GraphNodeView[];
  edges: GraphEdge[];
  /** Agac gorunumu: dugumler turune gore gruplanmis (SIRALAMA MOTORDA). */
  groups: GraphKindGroup[];
  /** Ozet kartlari ayrintisi (kirik/golgeli/kritik + sayimlar). */
  details: GraphDetails;
  cycles: string[][];
  rootCauses: RootCause[];
  summary: {
    nodes: number;
    edges: number;
    broken: number;
    shadowed: number;
    cycles: number;
    critical: number;
  };
}

export interface GraphWhatIfRequest {
  /** Serbest metin: kimlik, etiket veya yol alt dizisi. */
  query?: string;
  /** Tek dugumun KESIN kimligi (satir eylemi). Varsa `query`den onceliklidir. */
  nodeId?: string;
}

export interface GraphWhatIfResponse {
  nodeIds: string[];
  result: WhatIfResult;
}

// ---------------------------------------------------------------------------
// CLI envanteri (SALT OKUNUR) + kaldirma plani
// ---------------------------------------------------------------------------

export interface CliInventoryRequest {
  unusedDays?: number;
}

export type CliInventoryResponse = CliInventory;
export type { CliSource, CliStatus, CliTool } from './cli-inventory-types.ts';

/** Arac listesi filtresi: durum + kaynak + arama + siralama MOTORDAN gelir. */
export type CliStatusFilter = 'all' | CliStatus;
export type CliSourceFilter = 'all' | CliSource;
export type CliSort = 'status' | 'size' | 'idle' | 'name';

export interface CliViewCounts {
  total: number;
  unused: number;
  unknown: number;
  protected: number;
  withStateDirs: number;
  broken: number;
}

export interface CliSourceStat {
  source: CliSource;
  count: number;
  bytes: number;
}

export interface CliViewSummary {
  total: number;
  visible: number;
  unused: number;
  recent: number;
  unknown: number;
  protected: number;
  broken: number;
  withStateDirs: number;
  removable: number;
  unusedBytes: number;
  totalBytes: number;
}

export interface CliViewFilter {
  text: string;
  status: CliStatusFilter;
  source: CliSourceFilter;
  sort: CliSort;
}

/**
 * Arac listesi: envanter + MOTORUN filtre/siralama/sayim sonucu.
 * `selectableIds` yalnizca gorunen ve kaldirilabilir araclari tasir.
 */
export interface CliViewResponse {
  scannedAt: number;
  unusedDays: number;
  tools: CliTool[];
  duplicates: CliInventory['duplicates'];
  shimIssues: CliInventory['shimIssues'];
  pathShadows: CliInventory['pathShadows'];
  pathChannels?: CliInventory['pathChannels'];
  nodeRuntimes?: CliInventory['nodeRuntimes'];
  notes: string[];
  roots: string[];
  counts: CliViewCounts;
  sources: CliSourceStat[];
  summary: CliViewSummary;
  selectableIds: string[];
  filter: CliViewFilter;
}

/**
 * Envanter artik is olarak baslar; sonuc SSE ile canli akar.
 * Ayni anda tek is calisir, ikinci istek mevcut isi paylasir.
 */
export interface CliInventoryStartResponse {
  jobId: string;
  shared?: boolean;
}

export type CliInventoryStreamEvent =
  | { type: 'start'; unusedDays: number; startedAt: number }
  | { type: 'tool'; tool: CliTool }
  | { type: 'done'; inventory: CliInventory }
  | { type: 'cancelled' }
  | { type: 'error'; message: string };

export interface CliInventoryCancelResponse {
  ok: boolean;
}

export interface CliPlanRequest {
  commands: string[];
  /** Durum klasorlerini kasaya kopyala */
  backup: boolean;
  unusedDays?: number;
}

export interface CliPlanItemView {
  id: string;
  command: string;
  source: string;
  packageName: string;
  version: string;
  installPath: string;
  shims: string[];
  stateDirs: string[];
  status: string;
  confidence: string;
  idleDays: number;
  /** Aracin toplam boyutu (plan satiri). */
  totalBytes: number;
  evidence: string[];
  uninstallCommand: string;
  reinstallCommand: string;
  /** Golgede kalan paket kaldirilinca shim'i onarmak icin komut */
  repairCommand?: string;
  manual: boolean;
  backupPaths: string[];
  backupBytes: number;
  backupSkipped: Array<{ path: string; reason: string }>;
}

export interface CliPlanResponse {
  planId: string;
  items: CliPlanItemView[];
  totalBytes: number;
  backupBytes: number;
  /** CLI kaldirma her zaman yazili onay ister */
  requiresPhrase: true;
  /** Yazili onay ifadesi (ApprovalRules.delete). */
  phrase: string;
  approvalKind: 'delete';
  expiresAt: number;
  /** Bagimlilik grafigi nedeniyle plana ALINMAYAN araclar. */
  blocked?: Array<{ id: string; command: string; reason: string; dependents: string[] }>;
}

export interface CliExecuteRequest {
  planId: string;
  phrase: string;
}

export interface CliExecuteResultView {
  command: string;
  ok: boolean;
  manual: boolean;
  output: string;
  error?: string;
  backupDir?: string;
  verified: boolean;
}

export interface CliExecuteResponse {
  results: CliExecuteResultView[];
}

// ---------------------------------------------------------------------------
// CLI onarim (bozuk / yarim kurulum)
// ---------------------------------------------------------------------------

export interface CliRepairPlanRequest {
  ids: string[];
}

export interface CliRepairItemView {
  id: string;
  command: string;
  packageName: string;
  version: string;
  repairCommand: string;
}

export interface CliRepairPlanResponse {
  planId: string;
  items: CliRepairItemView[];
  /** Onarim da yazili onay ister */
  requiresPhrase: true;
  expiresAt: number;
}

export interface CliRepairExecuteRequest {
  planId: string;
  phrase: string;
}

export interface CliRepairResultView {
  command: string;
  ok: boolean;
  output: string;
  error?: string;
  verified: boolean;
}

export interface CliRepairExecuteResponse {
  results: CliRepairResultView[];
}

// ---------------------------------------------------------------------------
// CLI karantina (paket yoneticisi olmayan bagimsiz araclar)
// ---------------------------------------------------------------------------

export interface CliQuarantinePlanRequest {
  ids: string[];
}

export interface CliQuarantineItemView {
  id: string;
  command: string;
  packageName: string;
  version: string;
  installPath: string;
  /** Kasaya TASINACAK shim dosyalari (komut PATH'ten duser). */
  shims: string[];
  /** Kasaya KOPYALANACAK durum klasorleri (veri yerinde kalir). */
  stateDirs: string[];
  status: string;
  idleDays: number;
  evidence: string[];
  totalBytes: number;
}

export interface CliQuarantinePlanResponse {
  planId: string;
  items: CliQuarantineItemView[];
  totalBytes: number;
  /** Karantina da yazili onay ister */
  requiresPhrase: true;
  /** Kullanicinin yazmasi gereken ifade */
  phrase: 'KARANTINA';
  expiresAt: number;
}

export interface CliQuarantineExecuteRequest {
  planId: string;
  phrase: string;
}

export interface CliQuarantineResultView {
  command: string;
  ok: boolean;
  verified: boolean;
  movedShims: number;
  copiedState: number;
  vaultDir: string;
  error?: string;
}

export interface CliQuarantineExecuteResponse {
  results: CliQuarantineResultView[];
}

// ---------------------------------------------------------------------------
// Baslangic ozeti (dashboard) — yalniz KIMLIK + sayi; metin arayuzde.
// ---------------------------------------------------------------------------

export type DashboardCardId =
  | 'scan-missing'
  | 'scan-stale'
  | 'scan-dirty'
  | 'path-issues'
  | 'orphan-vars'
  | 'broken-installs'
  | 'broken-dependencies'
  | 'shadowed-commands'
  | 'interrupted'
  | 'vault-expired'
  | 'schedule-missed'
  | 'schedule-due';

/** Kartin goturdugu ekran; arayuz yalnizca bunu kullanir. */
export type DashboardTarget =
  | 'disk'
  | 'projects'
  | 'tools'
  | 'env'
  | 'graph'
  | 'vault'
  | 'schedules'
  | 'recover';

export type DashboardTone = 'info' | 'warn' | 'danger';

/**
 * Risk kartinin KONUSU (kart ne hakkinda?).
 *
 * "Disk değişti" bir SONUCtur; öznesi "Önceki Tarama"dır. Konu ve sonuç
 * ayrı kimliklerdir; ikisi de motordan gelir.
 */
export type DashboardCardTitleId =
  | 'scan'
  | 'paths'
  | 'vars'
  | 'commands'
  | 'installs'
  | 'deps'
  | 'recover'
  | 'vault'
  | 'schedules';

/**
 * Risk kartinin detayi — "altindaki liste"de gosterilen satirlar.
 *
 * Kart bir INDEXtir; detayi ayni sayfada asagidaki listede gorunur.
 * Satirlar kullanici verisini ve sabit metin KIMLIKLERINI tasir; metin
 * TR/EN olarak arayuzde uretilir.
 */
/**
 * Defter kartlarinin (Korunan / Geri kazanilabilir / Kasa / Araclarda)
 * detay kimlikleri. Bu kartlar tiklanir; icerikleri alt listede acilir.
 */
export type DashboardLedgerDetailId =
  | 'ledger-protected'
  | 'ledger-reclaimable'
  | 'ledger-vault'
  | 'ledger-cli';

export type DashboardDetailId =
  | 'scan'
  | 'paths'
  | 'vars'
  | 'commands'
  | 'installs'
  | 'deps'
  | 'recover'
  | 'vault'
  | 'schedules'
  | DashboardLedgerDetailId;

/**
 * Detay satirinda sabit metin yerine kullanilan ceviri kimligi.
 *
 * Kullanici verisi (yol, komut, degisken) `label`/`value` alaninda kalir;
 * YALNIZCA sabit cumleler kimlik tasir. Metin TR/EN olarak `web/src/i18n.ts`
 * icinde uretilir (AGENTS.md 9/18).
 */
export type DashboardDetailTextId =
  | EnvFindingKind
  | 'operation'
  | 'operation-vault'
  | 'interrupted-items'
  | 'schedule-missed'
  | 'schedule-due'
  | 'ledger-cli-empty';

export interface DashboardDetailRow {
  /** Sol etiket (ornegin yol, degisken, komut adi). */
  label: string;
  /** Sag deger (ornegin gerekce, yol, tarih). */
  value: string;
  /** Sabit etiket: doluysa `label` yerine cevrilir. */
  labelId?: DashboardDetailTextId;
  /** Sabit deger: doluysa `value` yerine cevrilir. */
  valueId?: DashboardDetailTextId;
  /** `valueId`/`valueKind` icin sayisal deger. */
  amount?: number;
  /** Sabit metin yoksa sayinin bicimi. */
  valueKind?: 'bytes' | 'count';
  tone?: 'default' | 'warn' | 'danger';
}

export type DashboardDetailKind = 'rows' | 'scan';

export interface DashboardDetailView {
  id: DashboardDetailId;
  /** 'scan' -> satirlar `scan.view`'dan gelir; 'rows' -> `rows` kullanilir. */
  kind: DashboardDetailKind;
  rows: DashboardDetailRow[];
  /** Satir yoksa gosterilecek aciklama (or. envanter taranmadi). */
  noteId?: DashboardDetailTextId;
  /** Detayin tam listesi olan ekran (yoksa null). */
  target: DashboardTarget | null;
}

export interface DashboardCardMeta {
  at: number | null;
  ageMs: number | null;
}

export interface DashboardCardView {
  id: DashboardCardId;
  tone: DashboardTone;
  /** Konu (baslik). */
  titleId: DashboardCardTitleId;
  /** Sonuc (alt baslik). */
  stateId: DashboardCardId;
  /** Bu kartin detayi hangi listede? */
  detailId: DashboardDetailId;
  /** null = bu kart sayi tasimaz ("-" gosterilir). */
  count: number | null;
  /** Hedef ekran; konu zaten o ekrani anlatıyorsa null. */
  target: DashboardTarget | null;
  /** Tarama karti: tarama zamani + gecen sure (UX-038). */
  meta?: DashboardCardMeta;
}

export type DashboardLedgerId = 'protected' | 'reclaimable' | 'vault' | 'cli';

export interface DashboardLedgerView {
  id: DashboardLedgerId;
  bytes: number;
  /** false -> deger bilinmiyor (or. CLI envanteri hic taranmadi). */
  known: boolean;
  /** Bu defterin icerigi hangi detay listesinde? */
  detailId: DashboardLedgerDetailId;
}

/** Varsayilan secim kuralini gecen kume; "neden" kimlikle gelir. */
export interface DashboardSafeWinView {
  clusterKey: string;
  /** Okunabilir kume adi (motor doldurur; ham anahtar degil). */
  title: string;
  category: CategoryKey;
  bytes: number;
  regenerability: Regenerability;
  confidence: Confidence;
}

export interface DashboardScanView {
  state: ScanFreshness;
  at: number | null;
  ageMs: number | null;
  scanning: boolean;
  clusters: number;
  files: number;
  /** Motorun belirledigi ayristirilmis tarama durumu. */
  view: ScanStatusViewResponse;
}

export interface DashboardTotalsView {
  clusters: number;
  files: number;
  verdicts: Record<VerdictKind, number>;
}

export interface DashboardResponse {
  generatedAt: number;
  scan: DashboardScanView;
  ledgers: DashboardLedgerView[];
  cards: DashboardCardView[];
  safeWins: DashboardSafeWinView[];
  totals: DashboardTotalsView;
  /** Kart detaylari: secilen kartin satirlari asagidaki listede. */
  details: DashboardDetailView[];
}

// ---------------------------------------------------------------------------
// Proje kesfi (SALT OKUNUR; silme hedefi uretmez)
// ---------------------------------------------------------------------------

export interface ProjectCandidateView {
  root: string;
  name: string;
  markers: string[];
  git: boolean;
  agentWorkspace: boolean;
  artifacts: string[];
  lockfile: string | null;
  lastActivityAt: number | null;
}

export interface ProjectDiscoverResponse {
  roots: string[];
  projects: ProjectCandidateView[];
  truncated: boolean;
  skipped: number;
}

export type ProjectTab = 'all' | 'artifacts' | 'git' | 'agent';
export type ProjectSort = 'recent' | 'name';

export interface ProjectListSummaryView {
  /** Kesifte bulunan toplam proje (filtreden bagimsiz). */
  total: number;
  /** Filtreden gecen proje. */
  visible: number;
  withArtifacts: number;
  git: number;
  agentWorkspace: number;
  lockfile: number;
}

/**
 * Proje listesi: kesif + MOTORUN filtre/siralama/sayim sonucu.
 * Arayuz kendi listesini uretmez; yalnizca bu yaniti gosterir.
 */
export interface ProjectListResponse extends ProjectDiscoverResponse {
  generatedAt: number;
  counts: Record<ProjectTab, number>;
  summary: ProjectListSummaryView;
  text: string;
  tab: ProjectTab;
  sort: ProjectSort;
}

export interface ProjectRootsResponse {
  roots: string[];
  maxDepth: number;
  maxProjects: number;
}

/** Proje ici yeniden uretilebilir klasorun SALT OKUNUR gorunumu. */
export interface ProjectArtifactView {
  artifactPath: string;
  artifactName: string;
  ecosystem: Ecosystem;
  packageManager: string;
  manifest: string | null;
  lockfile: string | null;
  lockfileHash: string | null;
  monorepo: boolean;
  patches: boolean;
  localDeps: boolean;
  lockfileTracked: boolean;
  artifactTracked: boolean;
  runtimeInstalled: boolean;
  runtime: { name: string; version: string | null; installed: boolean };
  recentlyActive: boolean;
  idleDays: number;
  bytes: number;
  realisticBytes: number;
  regenerable: boolean;
  risks: string[];
  installCommand: string;
  verifyCommand: string | null;
}

export interface ProjectPlannedArtifactView {
  artifactPath: string;
  bytes: number;
  realisticBytes: number;
  regenerable: boolean;
}

export interface ProjectBlockedArtifactView {
  artifactPath: string;
  reason: string;
}

export interface ProjectPlanView {
  mode: ProjectCleanupMode;
  planned: ProjectPlannedArtifactView[];
  blocked: ProjectBlockedArtifactView[];
  warnings: string[];
  totalBytes: number;
  realisticBytes: number;
}

export interface ProjectSummaryView {
  artifacts: number;
  regenerable: number;
  tracked: number;
  risks: number;
  totalBytes: number;
  realisticBytes: number;
}

/** Proje detayi: yalnizca ARTIFACT'lar raporlanir; kaynak asla hedef degil. */
export interface ProjectAnalysisResponse {
  root: string;
  name: string;
  markers: string[];
  git: boolean;
  agentWorkspace: boolean;
  artifacts: ProjectArtifactView[];
  plan: ProjectPlanView;
  summary: ProjectSummaryView;
}

export interface ProjectPlanResponse extends ProjectAnalysisResponse {
  planId: string;
  /** Yazili onay ifadesi; deger ApprovalRules'tan gelir (projectRestore). */
  phrase: string;
  approvalKind: 'projectRestore';
  expiresAt: number;
}

export interface ProjectRestoreResultView {
  ok: boolean;
  projectRoot: string;
  command: string;
  output: string;
  error?: string;
}

export interface ProjectRestoreResponse {
  ok: boolean;
  results: ProjectRestoreResultView[];
  restored: number;
  failed: number;
}

// ---------------------------------------------------------------------------
// Disk gorunumu (M1) — liste + secim ozeti KARAR MOTORUNDAN gelir.
// ---------------------------------------------------------------------------

export type ClusterKindFilter = 'all' | VerdictKind | 'git';

export interface DiskClusterView {
  key: string;
  title: string;
  category: CategoryKey;
  risk: RiskLevel;
  verdictKind: VerdictKind;
  totalBytes: number;
  reclaimableBytes: number;
  lastTouched: number;
  idleDays: number;
  gitTracked: boolean;
  selectable: boolean;
  plannable: boolean;
  defaultSelected: boolean;
  targetCount: number;
  primaryPath: string;
  /** Siniflandiricidan gelen "bu ne" metni (veri; ceviri degil). */
  what: string;
  /** "Silersem ne olur" metni (veri). */
  consequence: string;
  regenerability: Regenerability;
  confidence: Confidence;
}

export interface DiskSelectionView {
  clusterCount: number;
  bytes: number;
  targetCount: number;
}

export interface DiskViewResponse {
  scan: { at: number | null; clusters: number };
  clusters: DiskClusterView[];
  counts: Record<ClusterKindFilter, number>;
  categories: CategoryStat[];
  totals: {
    clusters: number;
    files: number;
    totalBytes: number;
    reclaimableBytes: number;
  };
  /** Filtrelenmis kumelerden secilebilir/planlanabilir anahtarlar. */
  selectableKeys: string[];
  plannableKeys: string[];
  /** Varsayilan secim kuralini (T34) gecen TUM anahtarlar. */
  defaultSelectedKeys: string[];
  selection: DiskSelectionView;
}

export interface ClusterDetailView {
  cluster: Cluster;
  category: CategoryKey;
  risk: RiskLevel;
  verdictKind: VerdictKind;
  idleDays: number;
  gitTracked: boolean;
  selectable: boolean;
  plannable: boolean;
  defaultSelected: boolean;
}
