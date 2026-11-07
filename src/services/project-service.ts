import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import { ApprovalRules } from '../core/approval.ts';
import type {
  ProjectAnalysisResponse,
  ProjectDiscoverResponse,
  ProjectListResponse,
  ProjectPlanResponse,
  ProjectRestoreResponse,
  ProjectRootsResponse,
  ProjectSort,
  ProjectTab,
} from '../core/contract.ts';
import {
  analyzeProject,
  planProjectCleanup,
  restoreProjects,
  type ProjectArtifact,
  type ProjectCleanupMode,
  type ProjectPlan,
  type ProjectRecipe,
} from '../core/project-deps.ts';
import {
  describeProject,
  discoverProjects,
  suggestProjectRoots,
  type ProjectDiscoveryOptions,
} from '../core/project-discovery.ts';
import { ProjectAnalysis, ProjectList, type ProjectListQuery } from '../core/project-view.ts';
import { longPath } from '../util/longpath.ts';
import { ServiceError } from './errors.ts';

/**
 * Proje bagimlilik servisi.
 *
 * Kesif ve analiz SALT OKUNUR; hicbir hedef uretmez. `restore` yalnizca
 * sunucuda saklanan planin tariflerini calistirir; istemci komut/yol
 * gonderemez. Arayuz proje detayinda yalnizca artifact + tarif gosterir.
 *
 * Filtre, siralama ve sayimlar `ProjectList`/`ProjectAnalysis` motor
 * siniflarindan gelir; HTTP adaptoru hesap yapmaz.
 */

const PLAN_TTL_MS = 15 * 60_000;
const DISCOVERY_TTL_MS = 60_000;
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_PROJECTS = 200;

export const PROJECT_RESTORE_PHRASE = ApprovalRules.phrase('projectRestore');

interface StoredProjectPlan {
  plan: ProjectPlan;
  recipes: ProjectRecipe[];
  expiresAt: number;
}

interface DiscoveryCache {
  key: string;
  at: number;
  data: ProjectDiscoverResponse;
}

interface RawAnalysis {
  root: string;
  name: string;
  markers: string[];
  git: boolean;
  agentWorkspace: boolean;
  artifacts: ProjectArtifact[];
  plan: ProjectPlan;
}

/**
 * Kokleri dogrular: mutlak yol, var olan dizin, en fazla 5, tekrarsiz.
 * Gecersiz girdi sessizce elenir; hic gecerli kok yoksa 400.
 */
async function cleanRoots(roots: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const raw of roots.slice(0, 5)) {
    if (typeof raw !== 'string' || raw.trim().length === 0) continue;
    const abs = resolve(raw.trim());
    if (!isAbsolute(abs)) continue;
    if (out.some((p) => p.toLowerCase() === abs.toLowerCase())) {
      continue;
    }
    const s = await stat(longPath(abs)).catch(() => null);
    if (s?.isDirectory()) out.push(abs);
  }
  return out;
}

export class ProjectService {
  private readonly plans = new Map<string, StoredProjectPlan>();
  private discovery: DiscoveryCache | null = null;

  /**
   * Son kesif onbellegi (SALT OKUNUR). Grafik gibi tuketiciler icin:
   * agir tarama TETIKLEMEZ; onbellek yoksa `null` doner.
   */
  cached(): ProjectDiscoverResponse | null {
    return this.discovery?.data ?? null;
  }

  /**
   * Onerilen kesif kokleri. Yalnizca var olan dizinler; istemci
   * gonderebilir ama sunucu yine dogrular.
   */
  async roots(): Promise<ProjectRootsResponse> {
    return {
      roots: await suggestProjectRoots(),
      maxDepth: DEFAULT_MAX_DEPTH,
      maxProjects: DEFAULT_MAX_PROJECTS,
    };
  }

  /**
   * Kokler altinda proje depolarini bulur. SALT OKUNUR; hicbir hedef
   * uretmez. Ayni kok + ayar icin 60 sn onbellek kullanilir; `refresh`
   * ile atlanir. Filtre/siralama/sayim motor sinifindan gelir.
   */
  async discover(
    roots: string[],
    opts: ProjectDiscoveryOptions = {},
    query: ProjectListQuery = {},
    refresh = false,
  ): Promise<ProjectListResponse> {
    const clean = await cleanRoots(roots);
    if (clean.length === 0) {
      throw new ServiceError(400, 'Gecerli bir kok dizin gerekli');
    }
    const maxDepth = Math.max(0, opts.maxDepth ?? DEFAULT_MAX_DEPTH);
    const maxProjects = Math.max(1, opts.maxProjects ?? DEFAULT_MAX_PROJECTS);
    const key = `${clean.join('|')}::${maxDepth}::${maxProjects}`;
    const now = Date.now();

    let data =
      !refresh &&
      this.discovery &&
      this.discovery.key === key &&
      now - this.discovery.at < DISCOVERY_TTL_MS
        ? this.discovery.data
        : null;

    if (!data) {
      data = await discoverProjects(clean, {
        maxDepth,
        maxProjects,
        ...(opts.exclude ? { exclude: opts.exclude } : {}),
      });
      this.discovery = { key, at: now, data };
    }

    const list = new ProjectList(data.projects).view(query);
    return {
      ...data,
      ...list,
      generatedAt: this.discovery?.at ?? now,
    };
  }

  /** Tek proje kokunun artifact + tarif gorunumu. SALT OKUNUR. */
  async analyze(dir: string): Promise<ProjectAnalysisResponse> {
    return ProjectAnalysis.view(await this.rawAnalysis(dir));
  }

  /**
   * Tarif plani uretir ve 15 dk saklar. `recipe` modunda yalnizca
   * yeniden uretilebilir artifact'lar plana girer; kaynak asla hedef olmaz.
   */
  async plan(dir: string, mode: ProjectCleanupMode): Promise<ProjectPlanResponse> {
    const raw = await this.rawAnalysis(dir);
    const plan = planProjectCleanup(raw.artifacts, mode);
    const planId = randomBytes(8).toString('hex');
    const expiresAt = Date.now() + PLAN_TTL_MS;
    this.plans.set(planId, {
      plan,
      recipes: plan.projects.map((p) => p.recipe),
      expiresAt,
    });
    return {
      ...ProjectAnalysis.view({ ...raw, plan }),
      planId,
      phrase: PROJECT_RESTORE_PHRASE,
      approvalKind: 'projectRestore',
      expiresAt,
    };
  }

  /** Tarifleri calistirir (yalniz kurulum; silme yok). Yazili `KUR` onayi ister. */
  async restore(planId: string, phrase: string): Promise<ProjectRestoreResponse> {
    if (!ApprovalRules.matches('projectRestore', phrase)) {
      throw new ServiceError(400, `Onay ifadesi hatali (${PROJECT_RESTORE_PHRASE})`);
    }
    const stored = this.plans.get(planId);
    if (!stored) throw new ServiceError(404, 'Proje plani bulunamadi veya kullanildi');
    if (Date.now() > stored.expiresAt) {
      this.plans.delete(planId);
      throw new ServiceError(410, 'Proje planinin suresi doldu');
    }
    // Plan tek kullanimlik.
    this.plans.delete(planId);
    const results = await restoreProjects(stored.recipes);
    const restored = results.filter((r) => r.ok).length;
    return {
      ok: restored === results.length,
      results,
      restored,
      failed: results.length - restored,
    };
  }

  private async rawAnalysis(dir: string): Promise<RawAnalysis> {
    const start = resolve(dir);
    const s = await stat(longPath(start)).catch(() => null);
    if (!s?.isDirectory()) {
      throw new ServiceError(404, 'Proje dizini bulunamadi');
    }
    const artifacts = await analyzeProject(start);
    const root = artifacts[0]?.projectRoot ?? start;
    const described = await describeProject(root);
    return {
      root,
      name: described?.name ?? basename(root),
      markers: described?.markers ?? [],
      git: described?.git ?? false,
      agentWorkspace: described?.agentWorkspace ?? false,
      artifacts,
      plan: planProjectCleanup(artifacts, 'recipe'),
    };
  }
}
