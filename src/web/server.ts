import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, dirname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { closeRecycle } from '../actions/delete.ts';
import {
  findVaultEntry,
  listVaultEntries,
  purgeVault,
  purgeVaultItems,
  restoreAllVault,
  restoreVaultEntry,
} from '../actions/vault.ts';
import { exists } from '../actions/restore.ts';
import { BUILTIN_PROFILES, ENVS } from '../core/discover.ts';
import { CATEGORY_ORDER } from '../core/categories.ts';
import { DiskView, toClusterDetail } from '../core/disk-view.ts';
import { CliView } from '../core/cli-view.ts';
import type { QueryCriteria } from '../core/cluster-query.ts';
import { ApprovalRules } from '../core/approval.ts';
import { buildFindings } from '../core/findings.ts';
import { FindingsQuery } from '../core/findings-query.ts';
import { checkForUpdate } from '../core/update-check.ts';
import { currentVersion } from '../util/version.ts';
import { primaryPath, scanItemId } from '../core/scan-items.ts';
import { longPath } from '../util/longpath.ts';
import { ScanService } from '../services/scan-service.ts';
import { DeleteService } from '../services/delete-service.ts';
import { CliInventoryService } from '../services/cli-inventory-service.ts';
import { CliRemovalService } from '../services/cli-removal-service.ts';
import { CliRepairService } from '../services/cli-repair-service.ts';
import { CliQuarantineService } from '../services/cli-quarantine-service.ts';
import { EnvService } from '../services/env-service.ts';
import { ProjectService } from '../services/project-service.ts';
import { GraphService } from '../services/graph-service.ts';
import { ScheduleService } from '../services/schedule-service.ts';
import { DashboardService } from '../services/dashboard-service.ts';
import { interruptedOperations } from '../core/operation-journal.ts';
import { info as logInfo } from '../util/log.ts';
import { ServiceError, describeError } from '../services/errors.ts';
import { AppError } from '../core/app-error.ts';
import { readJson, sendJson, sseComment, sseSend, sseSetup } from './http.ts';
import type { Env } from '../core/types.ts';
import type {
  CliInventoryCancelResponse,
  CliInventoryRequest,
  CliInventoryStartResponse,
  CliInventoryStreamEvent,
  CliExecuteRequest,
  CliPlanRequest,
  CliRepairExecuteRequest,
  CliRepairPlanRequest,
  CliQuarantineExecuteRequest,
  CliQuarantinePlanRequest,
  ExecuteRequest,
  FindingsResponse,
  LatestResponse,
  MetaResponse,
  PlanAddRequest,
  PlanRenameRequest,
  PlanRemoveRequest,
  PlanRequest,
  ProjectSort,
  ProjectTab,
  ScanRequest,
  ScanStartResponse,
  ScanStatusResponse,
  ScanStreamEvent,
  SettingsResponse,
  SettingsUpdateRequest,
  UpdateCheckView,
  VaultEntryView,
  VaultListResponse,
  VaultPurgeRequest,
  VaultPurgeResponse,
  VaultRestoreAllResponse,
  VaultRestoreRequest,
  VaultRestoreResponse,
} from '../core/contract.ts';

/**
 * Residue yerel HTTP/SSE API — YALNIZ transport adaptoru.
 *
 * Is mantigi `src/services/` altindadir:
 *   ScanService, DeleteService, CliInventoryService,
 *   CliRemovalService, CliRepairService, CliQuarantineService.
 *
 * NOT (21.10.2026): tarayici arayuzu (React/Vite) projeden sokuldu.
 * Bu sunucu BASSSIZ bir API'dir; tek basina arayuz sunmaz. Arayuzun
 * yeniden yapimi icin plan: `docs/WEB-REBUILD-PLAN.md`.
 *
 * Guvenlik modeli:
 *  - Sunucu YALNIZCA 127.0.0.1 uzerinde dinler; aga acilmaz.
 *  - Her baslatmada rastgele bir token uretilir; API cagrilari bu
 *    token olmadan reddedilir.
 *  - Istemci SILME icin yol gondermez; yalnizca kume anahtari secer.
 *    Yollar sunucudaki tarama sonucundan gelir.
 *  - Proje taramasi (root) icin istemci yalnizca TARANACAK klasoru
 *    secebilir: /api/fs/dirs salt okunur klasor listesi doner,
 *    proje taramasi report-only sonuclanir ve silme hedefi uretmez.
 *  - Silme iki asamalidir: once plan (kimlik), sonra onay. Plan
 *    10 dakika sonra duser. Orta/yuksek risk yazili onay ister
 *    (kasaya tasima: "TASI", kalici silme: "SIL").
 *  - "Origin" ve "Host" basliklari dogrulanir.
 */

export interface WebOptions {
  envs?: Env[];
  profile?: string;
  exclude?: string[];
  minAgeDays?: number;
  /** 0 = isletim sisteminin bos portu secmesi (onerilen) */
  port?: number;
  host?: string;
  /**
   * Tarama sonucunu 24 saatlik disk onbellegine yaz (varsayilan true).
   * Testler false verir; kismi tarama kullanicinin onbellegini ezmesin.
   */
  persistScan?: boolean;
  /** Statik arayuzu (dist/web) sun. `residue ui --web` true verir. */
  serveUi?: boolean;
  /** Baslatinca varsayilan tarayiciyi ac (yalniz serveUi ile). */
  openBrowser?: boolean;
}

interface WebContext {
  token: string;
  opts: WebOptions;
  scan: ScanService;
  remove: DeleteService;
  inventory: CliInventoryService;
  removal: CliRemovalService;
  repair: CliRepairService;
  quarantine: CliQuarantineService;
  env: EnvService;
  projects: ProjectService;
  graph: GraphService;
  schedules: ScheduleService;
  dashboard: DashboardService;
  /** jobId -> SSE istemcileri (HTTP adaptorune ait gecici durum). */
  streams: Map<string, Set<ServerResponse>>;
}

/**
 * BASSSIZ API sunucusunu kurar. Arayuz yoktur; yalnizca HTTP/SSE
 * uzerinden servis katmanina erisim saglar.
 */
export function createApiServer(opts: WebOptions = {}): { server: Server; token: string } {
  const token = randomBytes(24).toString('hex');
  const streams = new Map<string, Set<ServerResponse>>();

  // Servis olaylarini SSE istemcilerine yazan tek nokta. Terminal
  // olaydan sonra baglantilar kapatilir; servisler HTTP bilmez.
  const emit = (jobId: string, event: unknown, id?: number): void => {
    const clients = streams.get(jobId);
    if (!clients) return;
    for (const c of clients) sseSend(c, event, id);
    const type = (event as { type?: string }).type;
    if (type === 'done' || type === 'cancelled' || type === 'error') {
      for (const c of clients) c.end();
      streams.delete(jobId);
    }
  };

  const scan = new ScanService(emit, opts.persistScan !== false);
  const remove = new DeleteService(emit);
  const inventory = new CliInventoryService(emit);
  const removal = new CliRemovalService(inventory);
  const repair = new CliRepairService(inventory);
  const quarantine = new CliQuarantineService(inventory);
  const env = new EnvService();
  const projects = new ProjectService();
  const graph = new GraphService(inventory);
  const schedules = new ScheduleService(scan, remove);
  const dashboard = new DashboardService(scan, env, graph, schedules, inventory);

  const ctx: WebContext = {
    token,
    opts,
    scan,
    remove,
    inventory,
    removal,
    repair,
    quarantine,
    env,
    projects,
    graph,
    schedules,
    dashboard,
    streams,
  };

  const server = createServer((req, res) => {
    handleRequest(req, res, ctx).catch((err) => {
      try {
        const status =
          err instanceof ServiceError
            ? err.status
            : AppError.from(err).code === 'validation'
              ? 400
              : 500;
        // Sozlesme: error (geriye uyumlu) + AppError govdesi.
        const body = AppError.from(err).toBody();
        sendJson(res, status, { error: describeError(err), ...body });
      } catch {
        /* yanit zaten yazilmis olabilir */
      }
    });
  });

  return { server, token };
}

/** API sunucusunu baslatir ve kullanici Ctrl+C'ye basana kadar tutar. */
export async function runApi(opts: WebOptions = {}): Promise<void> {
  const host = opts.host ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error('Guvenlik: API yalnizca localhost uzerinde calistirilabilir');
  }

  const { server, token } = createApiServer(opts);

  // Acilista journal taramasi: yarim kalan islemler varsa YALNIZCA
  // raporlanir; otomatik tamamlama/rollback kullanici kararina birakilir.
  const interrupted = await interruptedOperations().catch(() => []);
  if (interrupted.length > 0) {
    logInfo('yarim kalan islem bulundu', {
      sayi: interrupted.length,
      ornek: interrupted[0]?.file,
      komut: 'residue recover',
    });
  }

  const port = opts.port ?? 0;
  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => ok());
  });

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  const openHost = host === '::1' ? '127.0.0.1' : host;
  const rootUrl = `http://${openHost}:${actualPort}/`;
  const url = `http://${openHost}:${actualPort}/api/meta?token=${token}`;
  const hasUi = opts.serveUi && (await stat(WEB_DIST_INDEX).catch(() => null)) !== null;

  console.log('');
  if (opts.serveUi) {
    console.log('  Residue arayuz hazir.');
    console.log('');
    console.log(`  Arayuz:       ${rootUrl}`);
    console.log(`  API:          ${url}`);
    if (!hasUi) {
      console.log('');
      console.log('  UYARI: dist/web yok. Once arayuzu derle:  npm run build:web');
    }
  } else {
    console.log('  Residue API hazir (arayuz yok; basit bir HTTP/SSE API).');
    console.log('');
    console.log(`  Adres:        ${url}`);
  }
  console.log('  Yalnizca bu bilgisayarda calisir (127.0.0.1).');
  console.log('  Her baslatmada yeni bir guvenlik token\'i uretilir.');
  console.log('');
  console.log('  Kapatmak icin Ctrl+C.');
  console.log('');

  if (hasUi && opts.openBrowser) openInBrowser(rootUrl);

  await new Promise<void>((ok) => {
    const stop = () => {
      // SSE baglantilari acik kalsa bile kapan; aksi halde Windows'ta
      // libuv kapanisinda assert gorebiliriz.
      server.closeAllConnections?.();
      server.close();
      closeRecycle();
      ok();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

// ---------------------------------------------------------------------------
// Yonlendirme
// ---------------------------------------------------------------------------

/** Derlenmis arayuz (vite build -> dist/web). Kaynak agacina yazilmaz. */
const WEB_DIST = fileURLToPath(new URL('../../dist/web/', import.meta.url));
const WEB_DIST_INDEX = join(WEB_DIST, 'index.html');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * Statik arayuzu sunar. Yalnizca GET/HEAD; dizin disina cikis engellenir.
 * `index.html` yanitinda HttpOnly token cerezi verilir (URL'de token yok).
 */
async function serveWebUi(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  token: string,
): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  const isAsset = extname(decoded) !== '';
  const target = isAsset ? decoded : '/index.html';
  const file = resolve(WEB_DIST, `.${target}`);
  const root = resolve(WEB_DIST) + sep;
  if (!file.toLowerCase().startsWith(root.toLowerCase())) return false;

  const data = await readFile(file).catch(() => null);
  if (!data) return false;

  res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader(
    'Cache-Control',
    target === '/index.html' ? 'no-store' : 'public, max-age=3600',
  );
  if (target === '/index.html') {
    res.setHeader('Set-Cookie', `residue_token=${token}; HttpOnly; SameSite=Strict; Path=/`);
  }
  res.statusCode = 200;
  res.end(req.method === 'HEAD' ? undefined : data);
  return true;
}

function openInBrowser(url: string): void {
  try {
    if (process.platform === 'win32') {
      execFile('cmd', ['/c', 'start', '', url], { windowsHide: true });
    } else if (process.platform === 'darwin') {
      execFile('open', [url]);
    } else {
      execFile('xdg-open', [url]);
    }
  } catch {
    /* tarayici acilamazsa kullanici URL'yi elle acabilir */
  }
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: WebContext,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  const pathname = url.pathname;

  // DNS rebinding korumasi: Host basligi loopback olmali.
  if (!isLoopbackHost(req.headers.host)) {
    sendJson(res, 403, { error: 'Yalnizca localhost uzerinden erisilebilir' });
    return;
  }

  // Arayuz: `ui --web` ise derlenmis kabuk sunulur. `api` modunda kok yol
  // API bilgisi doner; statik dosya sunulmaz.
  if (!pathname.startsWith('/api/')) {
    if (ctx.opts.serveUi && (await serveWebUi(req, res, pathname, ctx.token))) return;
    if (pathname === '/' || pathname === '/index.html') {
      sendJson(res, 200, {
        name: 'residue',
        version: currentVersion(),
        ui: ctx.opts.serveUi ? 'missing' : 'none',
        note: ctx.opts.serveUi
          ? 'dist/web bulunamadi. Arayuzu derleyin: npm run build:web'
          : 'Bu sunucu BASSSIZ bir HTTP/SSE API\'dir; arayuz icin: residue ui --web',
        hint: 'API cagrilari token ister. Ornek: /api/meta?token=<token>',
        endpoints: [
          'GET  /api/meta',
          'GET  /api/dashboard',
          'GET  /api/disk',
          'GET  /api/cluster',
          'GET  /api/latest',
          'GET  /api/scan/status',
          'GET  /api/findings',
          'GET  /api/settings',
          'GET  /api/vault',
          'GET  /api/cli/inventory',
          'GET  /api/env',
          'GET  /api/graph',
          'GET  /api/projects/discover',
          'GET  /api/schedules',
          'GET  /api/recover',
        ],
      });
      return;
    }
    sendJson(res, 404, { error: 'Bulunamadi' });
    return;
  }

  if (pathname === '/api/health') {
    sendJson(res, 200, { ok: true, name: 'residue' });
    return;
  }

  if (!authorized(req, url, ctx.token)) {
    sendJson(res, 401, { error: 'Gecersiz veya eksik token' });
    return;
  }

  if (!sameOrigin(req)) {
    sendJson(res, 403, { error: 'Origin reddedildi' });
    return;
  }

  const route = `${req.method ?? 'GET'} ${pathname}`;

  if (route === 'GET /api/meta') {
    sendJson(res, 200, metaResponse(ctx));
    return;
  }

  if (route === 'GET /api/dashboard') {
    sendJson(res, 200, await ctx.dashboard.view());
    return;
  }

  // Disk listesi: filtre/siralama/secim ozeti KARAR MOTORUNDAN.
  if (route === 'GET /api/disk') {
    await ctx.scan.ensureCacheLoaded();
    const clusters = ctx.scan.last()?.scan.clusters ?? [];
    const selected = url.searchParams
      .getAll('selected')
      .flatMap((v) => v.split(','))
      .map((v) => v.trim())
      .filter(Boolean);
    const view = new DiskView(clusters, selected).view(parseCriteria(url), ctx.scan.last()?.at ?? null);
    sendJson(res, 200, view);
    return;
  }

  if (route === 'GET /api/cluster') {
    await ctx.scan.ensureCacheLoaded();
    const clusters = ctx.scan.last()?.scan.clusters ?? [];
    const key = url.searchParams.get('key') ?? '';
    const cluster = new DiskView(clusters).byKey(key);
    if (!cluster) {
      sendJson(res, 404, { error: 'Kume bulunamadi' });
      return;
    }
    sendJson(res, 200, toClusterDetail(cluster));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/fs/dirs') {
    await handleListDirs(req, res);
    return;
  }

  if (route === 'GET /api/latest') {
    await ctx.scan.ensureCacheLoaded();
    const last = ctx.scan.last();
    const body: LatestResponse = { scan: last?.scan ?? null, at: last?.at ?? null };
    sendJson(res, 200, body);
    return;
  }

  if (route === 'GET /api/update') {
    // T41: varsayilan KAPALI. Kapaliyken HICBIR ag istegi yapilmaz.
    const settings = await ctx.scan.settings();
    const force = url.searchParams.get('force') === '1';
    const result = await checkForUpdate(settings.updateCheck, currentVersion(), force);
    const body: UpdateCheckView = {
      checked: result.checked,
      mode: result.mode,
      latest: result.latest,
      current: result.current,
      updateAvailable: result.updateAvailable,
      checkedAt: result.checkedAt,
      error: result.error,
    };
    sendJson(res, 200, body);
    return;
  }

  if (route === 'GET /api/scan/status') {
    const body: ScanStatusResponse = await ctx.scan.status();
    sendJson(res, 200, body);
    return;
  }

  if (route === 'GET /api/findings') {
    // Birlesik gorunum: disk kumeleri + CLI envanteri. SALT OKUNUR.
    const last = ctx.scan.last();
    const inv = ctx.inventory.getLast();
    const findings = buildFindings(last?.scan ?? null, inv);
    const totals = new FindingsQuery(findings).totals();
    const body: FindingsResponse = {
      findings,
      disk: totals.diskCount,
      cli: totals.cliCount,
      at: last?.at ?? null,
    };
    sendJson(res, 200, body);
    return;
  }

  if (route === 'GET /api/settings') {
    const body: SettingsResponse = await ctx.scan.settings();
    sendJson(res, 200, body);
    return;
  }

  if (route === 'PUT /api/settings' || route === 'POST /api/settings') {
    const body = await readJson<SettingsUpdateRequest>(req);
    // Gecerli tum alanlar servise aktarilir; onceden yalnizca
    // scanCacheHours geciliyor, kasa suresi/surum kontrolu sessizce
    // yok sayiliyordu.
    const out = await ctx.scan.updateSettings({
      ...(body.scanCacheHours !== undefined
        ? { scanCacheHours: Number(body.scanCacheHours) }
        : {}),
      ...(body.vaultRetentionDays !== undefined
        ? { vaultRetentionDays: Number(body.vaultRetentionDays) }
        : {}),
      ...(body.updateCheck !== undefined ? { updateCheck: body.updateCheck } : {}),
    });
    sendJson(res, 200, out);
    return;
  }

  // -------------------------------------------------------------------------
  // Ortam degiskenleri / PATH (yeni motor)
  // -------------------------------------------------------------------------
  if (route === 'GET /api/env') {
    sendJson(res, 200, await ctx.env.analyze());
    return;
  }

  if (route === 'POST /api/env/plan') {
    const body = await readJson<Record<string, unknown>>(req);
    const scope = body.scope === 'machine' || body.scope === 'both' ? body.scope : 'user';
    sendJson(
      res,
      200,
      await ctx.env.plan({
        scope,
        removeMissing: body.removeMissing !== false,
        removeDuplicates: body.removeDuplicates !== false,
      }),
    );
    return;
  }

  if (route === 'POST /api/env/apply') {
    const body = await readJson<Record<string, unknown>>(req);
    const planId = typeof body.planId === 'string' ? body.planId : '';
    const phrase = typeof body.phrase === 'string' ? body.phrase : '';
    const out = await ctx.env.apply(planId, phrase);
    sendJson(res, out.ok ? 200 : 409, out);
    return;
  }

  // -------------------------------------------------------------------------
  // Proje bagimliliklari (yeni motor)
  // -------------------------------------------------------------------------
  if (route === 'GET /api/projects/roots') {
    sendJson(res, 200, await ctx.projects.roots());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/projects') {
    const dir = url.searchParams.get('path');
    if (!dir) {
      sendJson(res, 400, { error: 'path parametresi gerekli' });
      return;
    }
    sendJson(res, 200, await ctx.projects.analyze(dir));
    return;
  }

  // SALT OKUNUR proje kesfi. Kokler istemciden gelir; hedef uretilmez.
  if (route === 'GET /api/projects/discover') {
    const roots = url.searchParams
      .getAll('roots')
      .flatMap((v) => v.split(/[;,]/))
      .map((v) => v.trim())
      .filter(Boolean);
    const maxDepth = Number(url.searchParams.get('maxDepth') ?? '3');
    const maxProjects = Number(url.searchParams.get('maxProjects') ?? '200');
    const tabRaw = url.searchParams.get('tab') ?? 'all';
    const tab: ProjectTab =
      tabRaw === 'artifacts' || tabRaw === 'git' || tabRaw === 'agent' ? tabRaw : 'all';
    const sort: ProjectSort = url.searchParams.get('sort') === 'name' ? 'name' : 'recent';
    const view = await ctx.projects.discover(
      roots,
      {
        maxDepth: Number.isFinite(maxDepth) ? maxDepth : 3,
        maxProjects: Number.isFinite(maxProjects) ? maxProjects : 200,
      },
      {
        text: url.searchParams.get('text') ?? '',
        tab,
        sort,
      },
      url.searchParams.get('refresh') === '1',
    );
    sendJson(res, 200, view);
    return;
  }

  if (route === 'POST /api/projects/plan') {
    const body = await readJson<Record<string, unknown>>(req);
    const dir = typeof body.path === 'string' ? body.path : '';
    if (!dir) {
      sendJson(res, 400, { error: 'path gerekli' });
      return;
    }
    const mode = body.mode === 'vault' || body.mode === 'cache-only' ? body.mode : 'recipe';
    sendJson(res, 200, await ctx.projects.plan(dir, mode));
    return;
  }

  if (route === 'POST /api/projects/restore') {
    const body = await readJson<Record<string, unknown>>(req);
    const planId = typeof body.planId === 'string' ? body.planId : '';
    const phrase = typeof body.phrase === 'string' ? body.phrase : '';
    sendJson(res, 200, await ctx.projects.restore(planId, phrase));
    return;
  }

  // -------------------------------------------------------------------------
  // Bagimlilik grafigi (yeni motor)
  // -------------------------------------------------------------------------
  if (route === 'GET /api/graph') {
    sendJson(res, 200, await ctx.graph.view());
    return;
  }

  if (route === 'GET /api/dependencies') {
    // Sorgu motorda eslesir; bos sorgu 400 DEGIL sade 'empty' durumdur.
    const q = url.searchParams.get('q') ?? '';
    sendJson(res, 200, await ctx.graph.relations(q));
    return;
  }

  if (route === 'POST /api/graph/what-if') {
    const body = await readJson<Record<string, unknown>>(req);
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    const nodeId = typeof body.nodeId === 'string' ? body.nodeId.trim() : '';
    if (!query && !nodeId) {
      sendJson(res, 400, { error: 'query veya nodeId gerekli' });
      return;
    }
    // Satir eylemi KESIN kimlikle calisir; serbest arama alt dizi eslestirir.
    sendJson(res, 200, nodeId ? await ctx.graph.whatIfNode(nodeId) : await ctx.graph.whatIf(query));
    return;
  }

  // -------------------------------------------------------------------------
  // Zamanlanmis planlar (yeni motor)
  // -------------------------------------------------------------------------
  if (route === 'GET /api/schedules') {
    sendJson(res, 200, { schedules: await ctx.schedules.list() });
    return;
  }

  if (route === 'GET /api/schedules/catchup') {
    sendJson(res, 200, { catchUp: await ctx.schedules.catchUp() });
    return;
  }

  if (route === 'GET /api/schedules/history') {
    sendJson(res, 200, { runs: await ctx.schedules.history() });
    return;
  }

  if (route === 'POST /api/schedules') {
    const body = await readJson<Record<string, unknown>>(req);
    const input = body as unknown as Parameters<typeof ctx.schedules.create>[0];
    const phrase = typeof body.phrase === 'string' ? body.phrase : '';
    // Otomatik plan kurali yazili PLANLA onayi ister (ikinci savunma hatti).
    sendJson(res, 201, await ctx.schedules.create(input, { require: true, phrase }));
    return;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/schedules/')) {
    const id = pathname.split('/')[3] ?? '';
    await ctx.schedules.remove(id);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname.startsWith('/api/schedules/') && pathname.endsWith('/preview')) {
    const id = pathname.split('/')[3] ?? '';
    sendJson(res, 200, await ctx.schedules.preview(id));
    return;
  }

  if (req.method === 'POST' && pathname.startsWith('/api/schedules/') && pathname.endsWith('/run')) {
    const id = pathname.split('/')[3] ?? '';
    sendJson(res, 200, await ctx.schedules.run(id));
    return;
  }

  if (route === 'GET /api/recover') {
    sendJson(res, 200, { interrupted: await interruptedOperations() });
    return;
  }

  if (route === 'POST /api/scan') {
    await handleStartScan(req, res, ctx);
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/api/scan/') && pathname.endsWith('/events')) {
    openScanStream(req, res, ctx, pathname);
    return;
  }

  if (req.method === 'POST' && pathname.startsWith('/api/scan/') && pathname.endsWith('/cancel')) {
    const id = pathname.split('/')[3] ?? '';
    ctx.scan.cancel(id);
    sendJson(res, 202, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname.startsWith('/api/scan/') && pathname.endsWith('/pause')) {
    const id = pathname.split('/')[3] ?? '';
    ctx.scan.pause(id);
    sendJson(res, 202, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname.startsWith('/api/scan/') && pathname.endsWith('/resume')) {
    const id = pathname.split('/')[3] ?? '';
    ctx.scan.resume(id);
    sendJson(res, 202, { ok: true });
    return;
  }

  // Sag panel "Planlananlar": SALT OKUNUR, en son gecerli plan.
  if (route === 'GET /api/plan') {
    sendJson(res, 200, ctx.remove.currentPlan());
    return;
  }

  if (route === 'POST /api/plan') {
    await handleCreatePlan(req, res, ctx);
    return;
  }

  // W2-c: plan adi degistirme. Istemci kimligi yollar; ad sunucuda,
  // plan kaydinda tutulur (tek kaynak). Hatalar ServiceError adaptoruyle
  // JSON olarak doner; plan kimligi/TTL degismez.
  if (req.method === 'PATCH' && pathname.startsWith('/api/plan/')) {
    const id = pathname.split('/')[3] ?? '';
    if (!id) {
      sendJson(res, 400, { error: 'planId gerekli' });
      return;
    }
    const body = await readJson<PlanRenameRequest>(req);
    sendJson(res, 200, ctx.remove.renamePlan(id, typeof body.name === 'string' ? body.name : ''));
    return;
  }

  // Sag panel "Planlananlar" plana EKLEME: checkbox isaretlenen ogeler
  // TEK plana eklenir — mevcut planda `addToPlan` (kimlik + TTL korunur);
  // `planId` yokken tek ogeli yeni plan (`createPlan`, bugunku POST
  // /api/plan davranisi). Istemci yol gondermez; yalnizca kume
  // anahtari yollar. Hatalar ServiceError adaptoruyle JSON olarak doner.
  if (route === 'POST /api/plan/add') {
    const body = await readJson<PlanAddRequest>(req);
    await ctx.scan.ensureCacheLoaded();
    const scan = ctx.scan.last()?.scan ?? null;

    let keys: string[] = [];
    if (Array.isArray(body.keys)) {
      keys = body.keys.filter((k): k is string => typeof k === 'string' && k.length > 0);
    } else if (typeof body.key === 'string' && body.key.length > 0) {
      keys = [body.key];
    }
    if (keys.length === 0) {
      sendJson(res, 400, { error: 'Eklenecek oge belirtilmedi' });
      return;
    }

    const planId = typeof body.planId === 'string' ? body.planId : '';
    if (planId) {
      sendJson(res, 200, ctx.remove.addToPlan(planId, keys, scan));
      return;
    }
    sendJson(res, 200, ctx.remove.createPlan(scan, keys, 'recycle'));
    return;
  }

  // Sag panel "Planlananlar" plandan cikarma: istemci YOL GONDERMEZ;
  // yalnizca kume anahtari (`key` / `keys`) veya hedef kimligi
  // (`targetId`) yollar. Sonuc PlanResponse | null (200); hatalar
  // mevcut ServiceError adaptoruyle JSON olarak doner.
  if (route === 'POST /api/plan/remove') {
    const body = await readJson<PlanRemoveRequest>(req);
    const planId = typeof body.planId === 'string' ? body.planId : '';
    if (!planId) {
      sendJson(res, 400, { error: 'planId gerekli' });
      return;
    }
    const key = typeof body.key === 'string' ? body.key : undefined;
    const targetId = typeof body.targetId === 'string' ? body.targetId : undefined;
    const keys = Array.isArray(body.keys)
      ? body.keys.filter((k): k is string => typeof k === 'string' && k.length > 0)
      : undefined;
    const out = ctx.remove.removeFromPlan(planId, { key, targetId, keys });
    sendJson(res, 200, out);
    return;
  }

  if (route === 'POST /api/execute') {
    const body = await readJson<ExecuteRequest>(req);
    const out = ctx.remove.execute(
      body.planId ?? '',
      body.phrase,
      body.acknowledgeHigh === true,
    );
    // T28/24s: silme basladi -> disk degisecek; son tarama artik guncel
    // sayilmaz. Plan gecersizse execute yukarida hata verir.
    await ctx.scan.markDirty();
    sendJson(res, 202, out);
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/api/jobs/') && pathname.endsWith('/events')) {
    openJobStream(req, res, ctx, pathname);
    return;
  }

  if (route === 'POST /api/cli/inventory') {
    await handleCliInventory(req, res, ctx);
    return;
  }

  // Envanter onbelleginden MOTOR filtreli arac listesi. Envanter yoksa
  // `null` doner; agir tarama tetiklemez.
  if (route === 'GET /api/cli/view') {
    const inv = ctx.inventory.getLast();
    if (!inv) {
      sendJson(res, 200, null);
      return;
    }
    const view = new CliView(inv).view({
      text: url.searchParams.get('text') ?? '',
      status: url.searchParams.get('status') ?? 'all',
      source: url.searchParams.get('source') ?? 'all',
      sort: url.searchParams.get('sort') ?? 'status',
    });
    sendJson(res, 200, view);
    return;
  }

  if (
    req.method === 'GET' &&
    pathname.startsWith('/api/cli/inventory/') &&
    pathname.endsWith('/events')
  ) {
    openCliInventoryStream(req, res, ctx, pathname);
    return;
  }

  if (
    req.method === 'POST' &&
    pathname.startsWith('/api/cli/inventory/') &&
    pathname.endsWith('/cancel')
  ) {
    const id = pathname.split('/')[4] ?? '';
    ctx.inventory.cancel(id);
    const out: CliInventoryCancelResponse = { ok: true };
    sendJson(res, 202, out);
    return;
  }

  if (route === 'POST /api/cli/repair/plan') {
    const body = await readJson<CliRepairPlanRequest>(req);
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((x): x is string => typeof x === 'string' && x.length > 0)
      : [];
    sendJson(res, 200, await ctx.repair.plan(ids));
    return;
  }

  if (route === 'POST /api/cli/repair/execute') {
    const body = await readJson<CliRepairExecuteRequest>(req);
    const planId = typeof body.planId === 'string' ? body.planId : '';
    sendJson(res, 200, await ctx.repair.execute(planId, body.phrase));
    return;
  }

  if (route === 'POST /api/cli/quarantine/plan') {
    const body = await readJson<CliQuarantinePlanRequest>(req);
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((x): x is string => typeof x === 'string' && x.length > 0)
      : [];
    sendJson(res, 200, await ctx.quarantine.plan(ids));
    return;
  }

  if (route === 'POST /api/cli/quarantine/execute') {
    const body = await readJson<CliQuarantineExecuteRequest>(req);
    const planId = typeof body.planId === 'string' ? body.planId : '';
    sendJson(res, 200, await ctx.quarantine.execute(planId, body.phrase));
    return;
  }

  if (route === 'POST /api/cli/plan') {
    const body = await readJson<CliPlanRequest>(req);
    const commands = Array.isArray(body.commands)
      ? body.commands.filter((c): c is string => typeof c === 'string' && c.length > 0)
      : [];
    sendJson(res, 200, await ctx.removal.plan(commands, body.backup !== false));
    return;
  }

  if (route === 'POST /api/cli/execute') {
    const body = await readJson<CliExecuteRequest>(req);
    const planId = typeof body.planId === 'string' ? body.planId : '';
    sendJson(res, 200, await ctx.removal.execute(planId, body.phrase));
    return;
  }

  if (route === 'GET /api/vault') {
    const settings = await ctx.scan.settings();
    const now = Date.now();
    const entries = (await listVaultEntries()).slice(0, 500);
    const views: VaultEntryView[] = [];
    for (const e of entries) {
      const ageMs = Math.max(0, now - e.at);
      views.push({
        id: e.id,
        batchId: e.batchId,
        originalPath: e.originalPath,
        storedPath: e.storedPath,
        bytes: e.bytes,
        files: e.files,
        at: e.at,
        ageMs,
        remainingDays: Math.max(
          0,
          settings.vaultRetentionDays - Math.floor(ageMs / 86_400_000),
        ),
        originalExists: await exists(e.originalPath),
      });
    }
    const body: VaultListResponse = {
      entries: views,
      totalBytes: views.reduce((a, e) => a + e.bytes, 0),
      retentionDays: settings.vaultRetentionDays,
      purgePhrase: ApprovalRules.phrase('vaultPurge'),
    };
    sendJson(res, 200, body);
    return;
  }

  if (route === 'POST /api/vault/restore') {
    const body = await readJson<VaultRestoreRequest>(req);
    const entry = await findVaultEntry(body.id ?? '');
    if (!entry) {
      sendJson(res, 404, { error: 'Kasa kaydi bulunamadi' });
      return;
    }
    const r = await restoreVaultEntry(entry, {
      ...(body.mode ? { mode: body.mode } : {}),
      ...(body.conflict ? { conflict: body.conflict } : {}),
    });
    const out: VaultRestoreResponse = {
      ok: r.restored,
      to: r.to,
      conflict: r.conflict,
      mode: r.mode,
      verified: r.verified,
      ...(r.reason ? { error: r.reason } : {}),
    };
    sendJson(res, r.restored ? 200 : 409, out);
    return;
  }

  if (route === 'POST /api/vault/restore-all') {
    const r = await restoreAllVault();
    const out: VaultRestoreAllResponse = {
      ok: r.failed === 0,
      restored: r.restored,
      conflict: r.conflict,
      failed: r.failed,
      unverified: r.unverified,
    };
    sendJson(res, 200, out);
    return;
  }

  if (route === 'POST /api/vault/purge') {
    const body = await readJson<VaultPurgeRequest>(req);
    // Kalici islem: yazili onay sunucuda da dogrulanir (istemciye guvenilmez).
    if (!ApprovalRules.matches('vaultPurge', body.phrase)) {
      sendJson(res, 400, {
        error: `Onay ifadesi hatali (${ApprovalRules.phrase('vaultPurge')})`,
      });
      return;
    }
    // Yeni davranis: `ids` verilirse YALNIZCA o ogeler kalici silinir.
    // `ids` yoksa eski "tum partiler" davranisi korunur; CLI yedekleri
    // artik purgeVault tarafindan korunur.
    if (Array.isArray(body.ids) && body.ids.length > 0) {
      const ids = body.ids.filter((x): x is string => typeof x === 'string' && x.length > 0);
      const r = await purgeVaultItems(ids);
      const out: VaultPurgeResponse = {
        ok: r.ok,
        batches: 0,
        bytes: r.bytes,
        failed: r.failed,
        items: r.items,
      };
      sendJson(res, 200, out);
      return;
    }
    const r = await purgeVault();
    const out: VaultPurgeResponse = {
      ok: r.failed === 0,
      batches: r.batches,
      bytes: r.bytes,
      failed: r.failed,
    };
    sendJson(res, 200, out);
    return;
  }

  sendJson(res, 404, { error: 'Bilinmeyen uc nokta' });
}

// ---------------------------------------------------------------------------
// Tarama adaptoru
// ---------------------------------------------------------------------------

async function handleListDirs(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://' + (req.headers.host ?? '127.0.0.1'));
  const raw = (url.searchParams.get('path') ?? '').trim();
  const requested = resolve(raw || process.env.USERPROFILE || 'C:\\');

  let st;
  try {
    st = await stat(longPath(requested));
  } catch {
    sendJson(res, 404, { error: 'Dizin bulunamadi' });
    return;
  }
  if (!st.isDirectory()) {
    sendJson(res, 400, { error: 'Klasor degil' });
    return;
  }

  let dirs: Array<{ name: string; path: string }> = [];
  try {
    const ents = await readdir(longPath(requested), { withFileTypes: true });
    dirs = ents
      .filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, path: join(requested, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    dirs = [];
  }

  // Surucu koku disinda ust klasor her zaman vardir.
  const up = dirname(requested);
  const parent = up === requested ? null : up;
  sendJson(res, 200, { path: requested, parent, dirs });
}

async function handleStartScan(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: WebContext,
): Promise<void> {
  const body = await readJson<ScanRequest>(req);
  const envs = sanitizeEnvs(body.envs) ?? ctx.opts.envs ?? [];
  const profile = sanitizeProfile(body.profile) ?? ctx.opts.profile;
  const exclude = Array.isArray(body.exclude)
    ? body.exclude.filter((e): e is string => typeof e === 'string' && isSafeName(e))
    : (ctx.opts.exclude ?? []);
  const minAgeDays =
    typeof body.minAgeDays === 'number' && Number.isFinite(body.minAgeDays)
      ? Math.max(0, Math.floor(body.minAgeDays))
      : (ctx.opts.minAgeDays ?? 0);
  // Proje taramasi: istemci yalnizca klasor secer; yol sunucuda
  // normalize edilir. Bos/gecersiz deger yok sayilir.
  const rawRoot = typeof body.root === 'string' ? body.root.trim() : '';
  const root = rawRoot.length > 0 ? resolve(rawRoot) : undefined;
  const roots = Array.isArray(body.roots)
    ? body.roots
        .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
        .map((r) => resolve(r))
    : undefined;

  try {
    const job = ctx.scan.start({ envs, profile, exclude, minAgeDays, root, roots });
    const out: ScanStartResponse = { scanId: job.id };
    sendJson(res, 202, out);
  } catch (err) {
    // Eski davranis: 409 govdesinde calisan taramanin kimligi de doner.
    if (err instanceof ServiceError && err.status === 409) {
      sendJson(res, 409, { error: err.message, scanId: ctx.scan.activeJobId() });
      return;
    }
    throw err;
  }
}

function openScanStream(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: WebContext,
  pathname: string,
): void {
  const id = pathname.split('/')[3] ?? '';
  const job = ctx.scan.get(id);
  if (!job) {
    sendJson(res, 404, { error: 'Tarama bulunamadi' });
    return;
  }

  sseSetup(res);

  // SSE yeniden baglanma: tarayici `Last-Event-ID` gonderir. Son 2000
  // olay tutuldugu icin istemci kacirdigi olaylari tekrar alir; tampon
  // disina dustuyse asagidaki anlik gorunum (snapshot) kullanilir.
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const headerId = req.headers['last-event-id'];
  const rawId = Array.isArray(headerId) ? headerId[0] : headerId;
  const lastId = Number(rawId ?? url.searchParams.get('lastEventId') ?? 0) || 0;
  const firstId = job.events[0]?.id ?? 0;
  const canReplay = lastId > 0 && (job.events.length === 0 || lastId >= firstId - 1);
  if (canReplay) {
    for (const e of job.events) {
      if (e.id > lastId) sseSend(res, e.event, e.id);
    }
    // Biten tarama: son olay (done/cancelled/error) de gonderildi.
    if (job.status !== 'running') {
      res.end();
      return;
    }
    // ONEMLI: calisan taramada replay'den sonra abone olunmali; aksi
    // halde yeniden baglanan istemci bundan sonraki olaylari ALMAZ.
    subscribe(ctx, id, req, res);
    return;
  }

  sseSend(res, { type: 'progress', ...job.progress });

  // Gec baglanan istemci, taranacak alanlari ve simdiye kadar
  // bulunan kumeleri de gorur.
  if (job.status === 'running') {
    if (job.targets.length > 0) {
      sseSend(res, { type: 'targets', paths: job.targets } satisfies ScanStreamEvent);
    }
    for (const cluster of job.found) {
      // Oge kimligi kararli oldugu icin gec baglanan istemci ayni ogeyi
      // iki kez gormez; canli akista gelen guncelleme satiri tazeler.
      sseSend(res, {
        type: 'item',
        id: scanItemId(cluster),
        key: cluster.key,
        path: primaryPath(cluster),
        cluster,
        done: job.progress.done,
        total: job.progress.total,
      } satisfies ScanStreamEvent);
    }
  }

  if (job.status === 'done' && job.result) {
    sseSend(res, { type: 'done', result: job.result });
    res.end();
    return;
  }
  if (job.status === 'cancelled') {
    sseSend(res, { type: 'cancelled' });
    res.end();
    return;
  }
  if (job.status === 'error') {
    sseSend(res, { type: 'error', message: job.error ?? 'Bilinmeyen hata' });
    res.end();
    return;
  }

  subscribe(ctx, id, req, res);
}

// ---------------------------------------------------------------------------
// Disk plan adaptoru
// ---------------------------------------------------------------------------

async function handleCreatePlan(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: WebContext,
): Promise<void> {
  const body = await readJson<PlanRequest>(req);
  await ctx.scan.ensureCacheLoaded();

  const scan = body.scanId ? ctx.scan.get(body.scanId)?.result : ctx.scan.last()?.scan;
  const keys = Array.isArray(body.keys)
    ? body.keys.filter((k): k is string => typeof k === 'string' && k.length > 0)
    : [];
  const mode = body.mode === 'purge' ? 'purge' : 'recycle';
  // W2-c: istege bagli plan adi; verilmezse bos string (ayni davranis).
  sendJson(
    res,
    200,
    ctx.remove.createPlan(
      scan ?? null,
      keys,
      mode,
      typeof body.name === 'string' ? body.name : undefined,
    ),
  );
}

function openJobStream(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: WebContext,
  pathname: string,
): void {
  const id = pathname.split('/')[3] ?? '';
  const job = ctx.remove.getJob(id);
  if (!job) {
    sendJson(res, 404, { error: 'Islem bulunamadi' });
    return;
  }

  sseSetup(res);
  if (job.last) sseSend(res, job.last);

  if (job.status !== 'running') {
    res.end();
    return;
  }

  subscribe(ctx, id, req, res);
}

// ---------------------------------------------------------------------------
// CLI envanteri adaptoru
// ---------------------------------------------------------------------------

async function handleCliInventory(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: WebContext,
): Promise<void> {
  const body = await readJson<CliInventoryRequest>(req);
  const unusedDays =
    typeof body.unusedDays === 'number' && Number.isFinite(body.unusedDays)
      ? Math.max(1, Math.floor(body.unusedDays))
      : 21;

  const { jobId, shared } = ctx.inventory.start(unusedDays);
  const out: CliInventoryStartResponse = shared ? { jobId, shared: true } : { jobId };
  sendJson(res, shared ? 200 : 202, out);
}

function openCliInventoryStream(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: WebContext,
  pathname: string,
): void {
  const id = pathname.split('/')[4] ?? '';
  const job = ctx.inventory.get(id);
  if (!job) {
    sendJson(res, 404, { error: 'Envanter isi bulunamadi' });
    return;
  }

  sseSetup(res);
  sseSend(res, {
    type: 'start',
    unusedDays: job.unusedDays,
    startedAt: job.startedAt,
  } satisfies CliInventoryStreamEvent);

  // Gec baglanan istemci kacirdigi araclari da gorur.
  for (const tool of job.tools) {
    sseSend(res, { type: 'tool', tool } satisfies CliInventoryStreamEvent);
  }

  if (job.status === 'done' && job.result) {
    sseSend(res, { type: 'done', inventory: job.result } satisfies CliInventoryStreamEvent);
    res.end();
    return;
  }
  if (job.status === 'cancelled') {
    sseSend(res, { type: 'cancelled' } satisfies CliInventoryStreamEvent);
    res.end();
    return;
  }
  if (job.status === 'error') {
    sseSend(res, {
      type: 'error',
      message: job.error ?? 'Bilinmeyen hata',
    } satisfies CliInventoryStreamEvent);
    res.end();
    return;
  }

  subscribe(ctx, id, req, res);
}

// ---------------------------------------------------------------------------
// SSE aboneligi
// ---------------------------------------------------------------------------

function subscribe(
  ctx: WebContext,
  jobId: string,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  let clients = ctx.streams.get(jobId);
  if (!clients) {
    clients = new Set();
    ctx.streams.set(jobId, clients);
  }
  clients.add(res);
  // Kalp atisi: uzun suren tarama/isleme sirasinda baglanti bos kalmasin.
  const ping = setInterval(() => sseComment(res), 15_000);
  const cleanup = () => {
    clearInterval(ping);
    clients!.delete(res);
    if (clients!.size === 0) ctx.streams.delete(jobId);
  };
  res.once('close', cleanup);
  req.on('close', cleanup);
}

// ---------------------------------------------------------------------------
// Yardimcilar
// ---------------------------------------------------------------------------

function metaResponse(ctx: WebContext): MetaResponse {
  return {
    envs: ENVS.map((e) => ({ id: e.id, label: e.label, description: e.description })),
    profiles: Object.values(BUILTIN_PROFILES).map((p) => ({
      name: p.name,
      description: p.description,
      envs: p.envs as string[],
    })),
    defaults: {
      envs: (ctx.opts.envs ?? []) as string[],
      profile: ctx.opts.profile ?? null,
      exclude: ctx.opts.exclude ?? [],
      minAgeDays: ctx.opts.minAgeDays ?? 0,
    },
    cwd: process.cwd(),
    home: homedir(),
    ui: !!ctx.opts.serveUi,
    version: currentVersion(),
  };
}

function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return true;
  return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host.trim());
}

/** Disk listesi sorgu parametreleri -> motor kriterleri. */
function parseCriteria(url: URL): QueryCriteria {
  const kindRaw = url.searchParams.get('kind') ?? 'all';
  const kind = (['all', 'recommend', 'ask', 'report-only', 'keep', 'git'] as const).includes(
    kindRaw as never,
  )
    ? (kindRaw as NonNullable<QueryCriteria['kind']>)
    : 'all';

  const categoryRaw = url.searchParams.get('category') ?? 'all';
  const category =
    categoryRaw === 'all' || (CATEGORY_ORDER as readonly string[]).includes(categoryRaw)
      ? (categoryRaw as NonNullable<QueryCriteria['category']>)
      : 'all';

  const sortRaw = url.searchParams.get('sort') ?? 'size';
  const sort = (['size', 'risk', 'recent', 'name'] as const).includes(sortRaw as never)
    ? (sortRaw as NonNullable<QueryCriteria['sort']>)
    : 'size';

  return {
    text: url.searchParams.get('text') ?? '',
    kind,
    category,
    sort,
    triage: {
      big: url.searchParams.get('big') === '1',
      risky: url.searchParams.get('risky') === '1',
      zombie: url.searchParams.get('zombie') === '1',
    },
  };
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    const host = (req.headers.host ?? '').toLowerCase();
    if (o.host.toLowerCase() !== host) return false;
    return o.hostname === '127.0.0.1' || o.hostname === 'localhost' || o.hostname === '::1';
  } catch {
    return false;
  }
}

function authorized(req: IncomingMessage, url: URL, token: string): boolean {
  const header = req.headers['x-residue-token'];
  const raw = Array.isArray(header) ? header[0] : header;
  const provided = raw ?? url.searchParams.get('token') ?? cookieValue(req, 'residue_token') ?? '';
  if (provided.length !== token.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(token));
  } catch {
    return false;
  }
}

/** `Cookie` basligindan tek bir degeri okur (arayuz icin HttpOnly token). */
function cookieValue(req: IncomingMessage, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

function sanitizeEnvs(envs: unknown): Env[] | null {
  if (!Array.isArray(envs)) return null;
  const allowed = new Set<string>(ENVS.map((e) => e.id));
  const out = envs.filter((e): e is Env => typeof e === 'string' && allowed.has(e));
  return out.length > 0 ? out : null;
}

function sanitizeProfile(profile: unknown): string | undefined {
  if (typeof profile !== 'string' || !profile) return undefined;
  return profile in BUILTIN_PROFILES ? profile : undefined;
}

function isSafeName(name: string): boolean {
  return /^[a-z0-9._@-]+$/i.test(name) && name.length <= 64;
}
