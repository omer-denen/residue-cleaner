import type {
  CliExecuteResponse,
  CliInventoryStartResponse,
  CliPlanResponse,
  CliSort,
  CliSourceFilter,
  CliStatusFilter,
  CliViewResponse,
  ClusterDetailView,
  DashboardResponse,
  DiskViewResponse,
  EnvAnalysis,
  EnvApplyResult,
  EnvPlanResponse,
  ExecuteStartResponse,
  GraphViewResponse,
  GraphWhatIfResponse,
  MetaResponse,
  PlanPreview,
  PlanResponse,
  ProjectAnalysisResponse,
  ProjectListResponse,
  ProjectRootsResponse,
  ProjectSort,
  ProjectTab,
  ScanStartResponse,
  ScanStatusResponse,
  ScheduleCatchUpResponse,
  ScheduleCreateRequest,
  ScheduleHistoryResponse,
  ScheduleListResponse,
  ScheduleRun,
  ScheduleView,
  SettingsResponse,
  SettingsUpdateRequest,
  UpdateCheckView,
  VaultListResponse,
  VaultPurgeResponse,
  VaultRestoreResponse,
} from '../../src/core/contract.ts';

/**
 * TEK API ISTEMCISI.
 *
 * Arayuz yalnizca ISTEK gonderir. Hesap, filtre, siralama, secim ozeti ve
 * onay kurallari sunucudadir; burada yalnizca HTTP tasima ve hata
 * normalizasyonu var.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
    throw new ApiError(message, res.status, body);
  }
  return body as T;
}

function post<T>(path: string, payload: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(payload) });
}

export interface DiskQuery {
  text: string;
  kind: string;
  category: string;
  sort: string;
  big: boolean;
  risky: boolean;
  zombie: boolean;
  selected: string[];
}

export interface ProjectDiscoverQuery {
  roots: string[];
  text: string;
  tab: ProjectTab;
  sort: ProjectSort;
  /** Kesif onbellegini atla (kullanici "Tara" dedi). */
  refresh?: boolean;
}

export const api = {
  meta: (): Promise<MetaResponse> => request<MetaResponse>('/api/meta'),
  dashboard: (): Promise<DashboardResponse> => request<DashboardResponse>('/api/dashboard'),
  scanStatus: (): Promise<ScanStatusResponse> =>
    request<ScanStatusResponse>('/api/scan/status'),

  disk: (q: DiskQuery): Promise<DiskViewResponse> => {
    const p = new URLSearchParams();
    if (q.text) p.set('text', q.text);
    p.set('kind', q.kind);
    p.set('category', q.category);
    p.set('sort', q.sort);
    if (q.big) p.set('big', '1');
    if (q.risky) p.set('risky', '1');
    if (q.zombie) p.set('zombie', '1');
    for (const key of q.selected) p.append('selected', key);
    return request<DiskViewResponse>(`/api/disk?${p.toString()}`);
  },

  cluster: (key: string): Promise<ClusterDetailView> =>
    request<ClusterDetailView>(`/api/cluster?key=${encodeURIComponent(key)}`),

  /** Onerilen kesif kokleri (salt okunur). */
  projectRoots: (): Promise<ProjectRootsResponse> =>
    request<ProjectRootsResponse>('/api/projects/roots'),

  /** Proje kesfi: filtre/siralama/sayim MOTORDAN gelir. */
  discoverProjects: (q: ProjectDiscoverQuery): Promise<ProjectListResponse> => {
    const p = new URLSearchParams();
    for (const root of q.roots) p.append('roots', root);
    if (q.text) p.set('text', q.text);
    p.set('tab', q.tab);
    p.set('sort', q.sort);
    if (q.refresh) p.set('refresh', '1');
    return request<ProjectListResponse>(`/api/projects/discover?${p.toString()}`);
  },

  /** Tek proje analizi (SALT OKUNUR; artifact + tarif + hash). */
  projectAnalysis: (path: string): Promise<ProjectAnalysisResponse> =>
    request<ProjectAnalysisResponse>(`/api/projects?path=${encodeURIComponent(path)}`),

  /** Envanter onbelleginden MOTOR filtreli arac listesi (yoksa null). */
  cliView: (q: {
    text: string;
    status: CliStatusFilter;
    source: CliSourceFilter;
    sort: CliSort;
  }): Promise<CliViewResponse | null> => {
    const p = new URLSearchParams();
    if (q.text) p.set('text', q.text);
    p.set('status', q.status);
    p.set('source', q.source);
    p.set('sort', q.sort);
    return request<CliViewResponse | null>(`/api/cli/view?${p.toString()}`);
  },

  startCliInventory: (unusedDays: number): Promise<CliInventoryStartResponse> =>
    post<CliInventoryStartResponse>('/api/cli/inventory', { unusedDays }),

  cliCancel: (jobId: string): Promise<{ ok: boolean }> =>
    post<{ ok: boolean }>(`/api/cli/inventory/${jobId}/cancel`, {}),

  cliPlan: (body: {
    commands: string[];
    backup: boolean;
    unusedDays?: number;
  }): Promise<CliPlanResponse> => post<CliPlanResponse>('/api/cli/plan', body),

  cliExecute: (planId: string, phrase: string): Promise<CliExecuteResponse> =>
    post<CliExecuteResponse>('/api/cli/execute', { planId, phrase }),

  envAnalyze: (): Promise<EnvAnalysis> => request<EnvAnalysis>('/api/env'),

  envPlan: (body: {
    scope: 'user' | 'machine' | 'both';
    removeMissing: boolean;
    removeDuplicates: boolean;
  }): Promise<EnvPlanResponse> => post<EnvPlanResponse>('/api/env/plan', body),

  envApply: (planId: string, phrase: string): Promise<EnvApplyResult> =>
    post<EnvApplyResult>('/api/env/apply', { planId, phrase }),

  graph: (): Promise<GraphViewResponse> => request<GraphViewResponse>('/api/graph'),

  graphWhatIf: (query: string): Promise<GraphWhatIfResponse> =>
    post<GraphWhatIfResponse>('/api/graph/what-if', { query }),

  graphWhatIfNode: (nodeId: string): Promise<GraphWhatIfResponse> =>
    post<GraphWhatIfResponse>('/api/graph/what-if', { nodeId }),

  schedules: (): Promise<ScheduleListResponse> =>
    request<ScheduleListResponse>('/api/schedules'),

  createSchedule: (body: ScheduleCreateRequest): Promise<ScheduleView> =>
    post<ScheduleView>('/api/schedules', body),

  removeSchedule: (id: string): Promise<{ ok: boolean }> =>
    request<{ ok: boolean }>(`/api/schedules/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  previewSchedule: (id: string): Promise<PlanPreview> =>
    post<PlanPreview>(`/api/schedules/${encodeURIComponent(id)}/preview`, {}),

  runSchedule: (id: string): Promise<ScheduleRun> =>
    post<ScheduleRun>(`/api/schedules/${encodeURIComponent(id)}/run`, {}),

  scheduleCatchUp: (): Promise<ScheduleCatchUpResponse> =>
    request<ScheduleCatchUpResponse>('/api/schedules/catchup'),

  scheduleHistory: (): Promise<ScheduleHistoryResponse> =>
    request<ScheduleHistoryResponse>('/api/schedules/history'),

  settings: (): Promise<SettingsResponse> => request<SettingsResponse>('/api/settings'),

  saveSettings: (body: SettingsUpdateRequest): Promise<SettingsResponse> =>
    request<SettingsResponse>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  updateCheck: (force = false): Promise<UpdateCheckView> =>
    request<UpdateCheckView>(`/api/update${force ? '?force=1' : ''}`),

  startScan: (body: {
    envs?: string[];
    profile?: string;
    minAgeDays?: number;
    roots?: string[];
  }): Promise<ScanStartResponse> => post<ScanStartResponse>('/api/scan', body),

  scanAction: (scanId: string, action: 'cancel' | 'pause' | 'resume'): Promise<{ ok: boolean }> =>
    post<{ ok: boolean }>(`/api/scan/${scanId}/${action}`, {}),

  /** Yalnizca kasaya tasima modu; kalici silme arayuzde YOK. */
  plan: (keys: string[]): Promise<PlanResponse> =>
    post<PlanResponse>('/api/plan', { keys, mode: 'recycle' }),

  /** Sag panel "Planlananlar": sunucudaki en son gecerli plan (yoksa null). */
  planned: (): Promise<PlanResponse | null> => request<PlanResponse | null>('/api/plan'),

  /**
   * Disk satiri/_secim plana EKLEME. `planId` verilmisse mevcut plana
   * ekler (kimlik/TTL korunur, idempotent); verilmemisse tek ogeli yeni
   * plan kurulur. Istemci YOL gondermez; yalnizca kume anahtari yollar.
   */
  addToPlan: (planId: string | null, keys: string[]): Promise<PlanResponse> =>
    post<PlanResponse>('/api/plan/add', { ...(planId ? { planId } : {}), keys }),

  /**
   * Plandan COKLU cikarma: `keys` sunucudaki mevcut plan anahtarlari
   * (`planned.panel.keys`) olmali; BOS `keys` gonderilmez (400 doner).
   * Sonuc planda oge kalmadiysa null'dur.
   */
  clearPlan: (planId: string, keys: string[]): Promise<PlanResponse | null> =>
    post<PlanResponse | null>('/api/plan/remove', { planId, keys }),

  /**
   * Sag panel "Planlananlar" plandan cikarma. Istemci YOL GONDERMEZ;
   * yalnizca plan kimligi + kume anahtari (`key`) veya hedef kimligi
   * (`targetId`) yollar. Plan kimligi ve TTL sunucuda KORUNUR.
   */
  removeFromPlan: (
    planId: string,
    selector: { key?: string; targetId?: string },
  ): Promise<PlanResponse | null> =>
    post<PlanResponse | null>('/api/plan/remove', { planId, ...selector }),

  execute: (
    planId: string,
    phrase: string | undefined,
    acknowledgeHigh: boolean,
  ): Promise<ExecuteStartResponse> =>
    post<ExecuteStartResponse>('/api/execute', { planId, phrase, acknowledgeHigh }),

  vault: (): Promise<VaultListResponse> => request<VaultListResponse>('/api/vault'),

  restore: (id: string): Promise<VaultRestoreResponse> =>
    post<VaultRestoreResponse>('/api/vault/restore', {
      id,
      mode: 'files',
      conflict: 'rename',
    }),

  purge: (ids: string[], phrase: string): Promise<VaultPurgeResponse> =>
    post<VaultPurgeResponse>('/api/vault/purge', { ids, phrase }),
};
