import { existsSync } from 'node:fs';
import { open, readdir, readFile, stat, utimes } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { longPath } from '../util/longpath.ts';
import { walk } from './walker.ts';
import { readExeInfo } from './exe-info.ts';
import { readPathSources } from './path-sources.ts';
import { scanNodeRuntimes } from './node-runtimes.ts';
import { annotateReferences } from './cli-references.ts';
import { daysSince } from '../util/format.ts';

/**
 * Kurulu CLI envanteri ve "atillik" kaniti.
 *
 * Bu modul HICBIR uygulama adi icermez. Yalnizca paket yoneticisi
 * yerlesimlerini (node_modules + package.json, uv-receipt.toml,
 * .store, Scripts) ve komutun kendi durum klasorlerini okur.
 *
 * Kullanim kaniti katmanlari:
 *  1. Kabuk gecmisi (PowerShell/bash/zsh/fish): komut en az bir kez
 *     calistirilmis mi? Tarih yoktur; son satira yakinligi "goreli
 *     guncellik" olarak raporlanir, kesin tarih DEGIL.
 *  2. Aracin kendi durum klasoru (or. ~/.arac, %APPDATA%\arac):
 *     son yazim zamani gercek kullanim kanitidir.
 *  3. Shim dosyalarinin son erisim zamani (atime): Windows'ta
 *     "Updates Enabled" ise anlamlidir; antivirus/indexer dokunabilir.
 *     Guven duzeyi bu yuzden acikca 'high/medium/low' olarak verilir.
 *
 * Silme karari bu modulde VERILMEZ; yalnizca kanit ve oneri uretilir.
 */

import type {
  CliDuplicates,
  CliInventory,
  CliInventoryOptions,
  CliSource,
  CliStatus,
  CliTool,
  PathShadow,
  ShimIssue,
  UninstallSpec,
  UsageSignal,
} from './cli-inventory-types.ts';

export type {
  CliDuplicates,
  CliInventory,
  CliInventoryOptions,
  CliSource,
  CliStatus,
  CliTool,
  PathShadow,
  ShimIssue,
  UninstallSpec,
  UsageSignal,
} from './cli-inventory-types.ts';

const DAY = 86_400_000;
const MAX_HISTORY_BYTES = 4 * 1024 * 1024;
const MAX_STATE_ENTRIES = 300;

/** Tabandaki calisma zamanlari: bunlar "arac" degil, platformdur. */
const BASE_COMMANDS = new Set([
  'npm', 'npx', 'node', 'corepack',
  'pip', 'pip3', 'python', 'python3', 'python3.11', 'py',
  'uv', 'uvx', 'uvw',
  'dotnet',
  'git', 'git.exe',
  'powershell', 'pwsh', 'cmd', 'bash', 'wsl',
]);

const BASE_PACKAGES = new Set(['npm', 'corepack', 'pip', 'setuptools', 'wheel', 'uv']);

export interface HistoryData {
  files: string[];
  lines: string[];
  lastWrite: number;
  available: boolean;
}

export interface StateEvidence {
  dirs: string[];
  lastMtime: number;
  lastAtime: number;
}

/**
 * Canli akis kancalari. `emit` her arac bulundugunda cagrilir;
 * `signal` iptal edildiginde tarama en kisa surede durur.
 */
interface ScanHooks {
  emit: (tool: CliTool) => void;
  signal?: AbortSignal;
}

/** Makinedeki tum kurulu CLI'lari kanitlariyla listeler. */
export async function scanCliInventory(opts: CliInventoryOptions = {}): Promise<CliInventory> {
  const now = opts.now ?? Date.now();
  const unusedDays = Math.max(1, opts.unusedDays ?? 21);
  const notes: string[] = [];
  const roots: string[] = [];
  const shimIssues: ShimIssue[] = [];
  const hooks: ScanHooks = { emit: opts.onTool ?? (() => {}), signal: opts.signal };

  throwIfAborted(hooks.signal);

  const atime = await detectAtimeReliability();
  if (!atime.reliable) notes.push(`Son erisim zamani guvenilir degil: ${atime.detail}`);

  const history = await loadShellHistory();
  if (!history.available) notes.push('Kabuk gecmisi bulunamadi; yalnizca atime ve durum klasorleri kullanildi.');

  const found: CliTool[] = [];

  const npm = await scanNpmGlobal(now, unusedDays, history, atime.reliable, roots, notes, hooks);
  found.push(...npm.tools);
  shimIssues.push(...npm.issues);
  throwIfAborted(hooks.signal);
  found.push(...(await scanUvTools(now, unusedDays, history, atime.reliable, roots, notes, hooks)));
  throwIfAborted(hooks.signal);
  found.push(...(await scanDotnetTools(now, unusedDays, history, atime.reliable, roots, notes, hooks)));
  throwIfAborted(hooks.signal);
  found.push(...(await scanPythonUser(now, unusedDays, history, atime.reliable, roots, notes, hooks)));

  throwIfAborted(hooks.signal);
  const coveredShims = new Set(found.flatMap((t) => t.shims.map(normPath)));
  const standalone = await scanStandaloneShims(now, unusedDays, history, atime.reliable, coveredShims, roots, hooks);
  found.push(...standalone);

  // Ayni komut ayni shim ile iki kez gelirse tekilleştir.
  const byId = new Map<string, CliTool>();
  for (const t of found) {
    const key = t.id.toLowerCase();
    if (!byId.has(key)) byId.set(key, t);
  }

  const uniqueTools = [...byId.values()];
  // T69/F3 (E9): toplu atime — ayni ~5 sn penceresinde en az 3 aracin
  // shim atime'i guncellendiyse bu indeksleyici/yedekleme dokunmasidir,
  // kullanim degildir. uniqueTools olustuktan SONRA, saglik etiketinden
  // once yerinde uygulanir; daha once emit edilmis nesne ayni nesnedir.
  applyAtimeBurstFilter(
    uniqueTools,
    findAtimeBursts(uniqueTools.map((t) => ({ id: t.id, atime: t.lastAccessAt }))),
    { now, unusedDays },
  );
  // Tum kaynaklarda (npm, uv, dotnet, pip, standalone) yarim kurulum
  // tespiti: stub bin + calistirma hatasi. Onarim komutu kaynaga gore
  // uretilir; standalone icin yalnizca raporlanir.
  await annotateHealth(uniqueTools);
  const duplicates = findDuplicates(uniqueTools);

  // T17: kurulum izi (npm _logs), oksuz shim taramasi ve PATH golgeleme.
  // Hepsi SALT OKUNUR kanit uretir; hicbiri silme hedefi olmaz.
  await applyInstallTraces(uniqueTools);
  // T33: kaldirma oncesi referans kontrolu (surec / yapilandirma / kisayol /
  // zamanlanmis gorev). SALT OKUNUR; guveni dusurur, silme hedefi uretmez.
  await annotateReferences(uniqueTools);
  const npmPrefix = process.env.APPDATA ? join(process.env.APPDATA, 'npm') : '';
  if (npmPrefix) shimIssues.push(...(await scanNpmShimOrphans(npmPrefix)));
  const pathShadows = await scanPathShadowing(uniqueTools);
  // T35: PATH'in User (HKCU) ve Machine (HKLM) kaynaklari. SALT OKUNUR;
  // kayit defterine yazilmaz, PATH degistirilmez.
  const pathChannels = await readPathSources();
  // T36: Node surum yoneticisi kopyalari. SALT OKUNUR; "review" isareti
  // silme hedefi DEGILDIR, yalnizca inceleme kanitidir.
  const nodeRuntimes = await scanNodeRuntimes();

  const tools = uniqueTools.sort((a, b) => {
    const rank = statusRank(a.status) - statusRank(b.status);
    return rank !== 0 ? rank : b.totalBytes - a.totalBytes;
  });

  return {
    scannedAt: now,
    unusedDays,
    tools,
    duplicates,
    roots: [...new Set(roots)],
    notes,
    shimIssues,
    pathShadows,
    pathChannels,
    nodeRuntimes,
  };
}

function statusRank(s: CliStatus): number {
  return s === 'unused' ? 0 : s === 'unknown' ? 1 : s === 'recent' ? 2 : 3;
}

/**
 * Ayni komutun birden fazla kaynaktan kurulmasini bulur.
 *
 * Ornek: ayni arac hem npm global hem .local/bin'de duruyorsa,
 * PATH'te hangisinin once geldigine gore biri golgede kalir.
 * Tutulacak taraf en guclu kullanim kanitina gore secilir.
 */
function findDuplicates(tools: CliTool[]): CliDuplicates[] {
  const groups = new Map<string, CliTool[]>();
  for (const t of tools) {
    if (t.status === 'protected') continue;
    const key = t.command.toLowerCase();
    const arr = groups.get(key);
    if (arr) arr.push(t);
    else groups.set(key, [t]);
  }

  const out: CliDuplicates[] = [];
  for (const [command, arr] of groups) {
    if (arr.length < 2) continue;
    const sorted = [...arr].sort((a, b) => {
      // 0) Aktif shim: gercekten cagrilan kurulum her zaman once gelir.
      const act = Number(b.activeShim === true) - Number(a.activeShim === true);
      if (act !== 0) return act;
      // 1) en son durum/erisim kaniti, 2) gecmis, 3) surum, 4) kaynak
      const state = b.lastStateAt - a.lastStateAt;
      if (state !== 0) return state;
      const access = b.lastAccessAt - a.lastAccessAt;
      if (access !== 0) return access;
      const hist = b.historyMentions - a.historyMentions;
      if (hist !== 0) return hist;
      const ver = compareVersionStrings(b.version, a.version);
      if (ver !== 0) return ver;
      return sourcePriority(b.source) - sourcePriority(a.source);
    });
    const keep = sorted[0]!;
    const remove = sorted.slice(1);
    const active = arr.find((t) => t.activeShim === true);
    out.push({
      command,
      keepId: keep.id,
      removeIds: remove.map((t) => t.id),
      ...(active ? { activeId: active.id } : {}),
      reason:
        `Ayni komut ${arr.length} kurulumda. Aktif: ${describeTool(keep)}. ` +
        `Golgede: ${remove.map(describeTool).join(', ')}.`,
    });
  }
  return out.sort((a, b) => a.command.localeCompare(b.command)).slice(0, 50);
}

/** Kullaniciya gosterilecek kisa kurulum etiketi: paket@surum [kaynak]. */
function describeTool(t: CliTool): string {
  const v = t.version ? `@${t.version}` : '';
  return `${t.packageName}${v} [${t.source}]`;
}

function sourcePriority(s: CliSource): number {
  switch (s) {
    case 'npm-global':
      return 5;
    case 'uv-tool':
      return 4;
    case 'dotnet-tool':
      return 3;
    case 'pip-user':
      return 2;
    case 'standalone':
      return 1;
  }
}

// ---------------------------------------------------------------------------
// npm global
// ---------------------------------------------------------------------------

async function npmGlobalPrefix(env: NodeJS.ProcessEnv): Promise<string> {
  const configured = env.NPM_CONFIG_PREFIX ?? env.npm_config_prefix;
  if (configured) return configured;
  const fallback = env.APPDATA ? join(env.APPDATA, 'npm') : '';
  // `npm prefix -g` kullanici tanimli prefix'i (or. D:\npm) yakalar.
  // Basarisiz olursa APPDATA varsayimina donulur; envanter bloklanmaz.
  try {
    const run = promisify(execFile);
    const { stdout } = await run('npm.cmd', ['prefix', '-g'], {
      timeout: 5000,
      windowsHide: true,
      encoding: 'utf8',
    });
    const value = stdout.trim().split(/\r?\n/).pop()?.trim() ?? '';
    if (value && !value.includes('%')) return value;
  } catch {
    /* npm PATH'te yok: APPDATA */
  }
  return fallback;
}

async function scanNpmGlobal(
  now: number,
  unusedDays: number,
  history: HistoryData,
  atimeReliable: boolean,
  roots: string[],
  notes: string[],
  hooks: ScanHooks,
): Promise<{ tools: CliTool[]; issues: ShimIssue[] }> {
  const env = process.env;
  const prefix = await npmGlobalPrefix(env);
  if (!prefix) return { tools: [], issues: [] };
  const modules = join(prefix, 'node_modules');
  if (!(await isDirectory(modules))) return { tools: [], issues: [] };
  roots.push(prefix);

  const npmCli = join(prefix, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const npmProgram = existsSync(longPath(npmCli)) ? process.execPath : findOnPath('npm.cmd');
  const out: CliTool[] = [];
  const issues: ShimIssue[] = [];

  for (const pkgDir of await listPackageDirs(modules)) {
    throwIfAborted(hooks.signal);
    const manifest = join(pkgDir, 'package.json');
    // Manifestin atime'i OKUMADAN once alinir (observer etkisi).
    const pre = await preStat(manifest);
    const pkg = await readJson(manifest);
    if (!pkg) continue;
    const name = typeof pkg.name === 'string' ? pkg.name : '';
    if (!name) continue;
    const version = typeof pkg.version === 'string' ? pkg.version : '';
    const commands = binCommands(pkg.bin, name);

    for (const cmd of commands) {
      if (!validCommand(cmd)) continue;
      const shims = await shimPaths(prefix, cmd);
      if (shims.length === 0) {
        // T17: paket kurulu ve bin tanimli ama PATH'e shim birakilmamis.
        // Silme hedefi DEGIL; yalnizca tutarsizlik kaniti.
        issues.push({
          kind: 'missing-shim',
          path: join(prefix, `${cmd}.cmd`),
          command: cmd,
          packageName: name,
          detail: 'paket kurulu ve bin tanimli, ancak PATH shimi bulunamadi',
        });
        continue;
      }

      const installedAt = pre.mtime;
      // Yalnizca SHIM'lerin atime'i kullanilir. Manifesti biz okuyoruz;
      // onun atime'i kaniti kirletir (observer etkisi).
      const lastAccessAt = await maxAtime(shims);
      const state = await findStateDirs(cmd, unscoped(name));
      const usage = usageVerdict({
        now,
        unusedDays,
        command: cmd,
        source: 'npm-global',
        packageName: name,
        installedAt,
        lastAccessAt,
        state,
        history,
        atimeReliable,
      });

      const uninstall: UninstallSpec | null =
        npmProgram === null
          ? null
          : npmProgram === process.execPath
            ? {
                kind: 'npm',
                program: process.execPath,
                args: [npmCli, 'uninstall', '-g', name],
                display: `npm uninstall -g ${name}`,
              }
            : {
                kind: 'npm',
                program: npmProgram,
                args: ['uninstall', '-g', name],
                display: `npm uninstall -g ${name}`,
              };

      const tool: CliTool = {
        // Paket adi kimlige girer: ayni komutu iki paket saglayabilir
        // (or. yeni CLI + eski CLI). Ikisi de listede kalmali ki
        // cakisma analiz edilebilsin.
        id: `npm-global:${name}:${cmd}`,
        command: cmd,
        source: 'npm-global',
        packageName: name,
        version,
        installPath: pkgDir,
        shims,
        stalePaths: [],
        stateDirs: state.dirs,
        installedAt,
        lastAccessAt,
        lastStateAt: state.lastMtime,
        historyMentions: usage.mentions,
        historyLastRatio: usage.lastRatio,
        totalBytes: await sizeOf(pkgDir),
        idleDays: usage.idleDays,
        status: usage.status,
        confidence: usage.confidence,
        evidence: usage.evidence,
        usageSignals: usage.signals,
        atimeSuspect: usage.atimeSuspect,
        uninstall,
      };
      out.push(tool);
      hooks.emit(tool);
    }
  }

  await annotateNpmShims(out, prefix);
  if (out.length === 0) notes.push(`npm global prefix bulundu ama komut eslesmedi: ${prefix}`);
  return { tools: out, issues };
}

/**
 * Ayni komutu birden fazla paket sagliyorsa hangisinin gercekten
 * cagrildigini shim dosyasindan okur. Ornek: guncelleme sonrasi
 * eski paket kaldirilmadan kalmis olabilir; shim yeni paketi gosterir.
 *
 * Shim okumak atime'i gunceller; bu yuzden once kaydedilir, sonra
 * geri yazilir. Aksi halde envanter kendi kanitini bozar (observer etkisi).
 */
async function annotateNpmShims(tools: CliTool[], prefix: string): Promise<void> {
  const cache = new Map<string, string | null>();
  for (const tool of tools) {
    const shim = tool.shims.find((p) => p.toLowerCase().endsWith('.cmd')) ?? tool.shims[0];
    if (!shim) continue;
    let target = cache.get(shim);
    if (target === undefined) {
      target = await readShimTarget(shim, prefix);
      cache.set(shim, target);
    }
    if (!target) continue;
    tool.shimTarget = target;
    const install = normPath(tool.installPath);
    const pointed = normPath(target);
    tool.activeShim = pointed === install || pointed.startsWith(install + '\\');
    tool.evidence.push(
      tool.activeShim
        ? 'aktif shim bu kurulumu gosteriyor'
        : 'shim baska kurulumu gosteriyor (golgede kalan eski kurulum)',
    );
  }
}

/**
 * Observer hijyeni: okuma sonrasi Windows atime'i gunceller ve sonraki
 * tarama dosyayi "az once kullanildi" sanir (E1/E2). Okuma oncesi
 * atime/mtime alinir, `fn()` bittikten sonra (hata firlatsa bile)
 * ikisi geri yazilir. Zaman damgalari okunamiyorsa veya geri
 * yazilamiyorsa (dosya yok, erisim reddi) sessizce gecilir; yalnizca
 * `fn()` hatalari cagirana yansitilir.
 */
export async function withPreservedFileTimes<T>(
  path: string,
  fn: () => Promise<T>,
): Promise<T> {
  const fp = longPath(path);
  let times: { atimeMs: number; mtimeMs: number } | null = null;
  try {
    const st = await stat(fp);
    times = { atimeMs: st.atimeMs, mtimeMs: st.mtimeMs };
  } catch {
    /* okuma oncesi zamanlar alinamadi; geri yazilacak bir sey yok */
  }
  try {
    return await fn();
  } finally {
    if (times) {
      // NOT: sayi milisaniye argumani Windows'ta EINVAL verebilir
      // (orijinal readShimTarget davranisi); bu yuzden Date ile geri
      // yazilir — tum surumlerde desteklenir.
      await utimes(fp, new Date(times.atimeMs), new Date(times.mtimeMs)).catch(() => {
        /* geri yazilamadi; atime kaniti etkilenmis olabilir */
      });
    }
  }
}

/** `readExeInfo`'nun observer etkisiz hali: atime kanitini bozmaz (E1). */
export async function readExeInfoPreservingTimes(path: string) {
  return withPreservedFileTimes(path, () => readExeInfo(path));
}

/**
 * `.cmd` / `.ps1` shim'inin hedef yolunu cikarir. npm shim'i
 * `%dp0%\node_modules\<paket>\<dosya>` bicimindedir; paket scoped
 * olabilir (`@scope\paket`).
 */
async function readShimTarget(shim: string, prefix: string): Promise<string | null> {
  return withPreservedFileTimes(shim, async () => {
    try {
      const txt = await readFile(longPath(shim), 'utf8');
      const m = /node_modules[\\/]((?:@[^\\/\s"']+[\\/])?[^\\/\s"']+)[\\/]([^\s"']+)/i.exec(txt);
      if (!m?.[1] || !m[2]) return null;
      const rel = `node_modules\\${m[1]}\\${m[2]}`.replace(/[\\/]+/g, '\\');
      return join(prefix, rel);
    } catch {
      return null;
    }
  });
}

/**
 * Yarim / bozuk kurulum tespiti — TUM kaynaklar icin.
 *
 * npm 12 gibi politikalarin kurulum betiklerini engellemesi, uv/dotnet/
 * pip kurulumlarinin yarim kalmasi veya standalone bir ikilinin
 * bozulmasi ayni belirtiyi verir: bin dosyasi stub kalir.
 *
 * T38: stub kaniti artik CALISTIRMA ile degil, PE basligi ve kaynak
 * dizini statik okunarak elde edilir. Bilinmeyen bir .exe'yi "denemek"
 * icin calistirmak yan etki (kurulum betigi, ag erisimi) ve guvenlik
 * riski tasir; bu yuzden surec ACILMAZ. Gecerli PE basligi olan kucuk
 * dosyalar "bozuk" sayilmaz (yanlis pozitiften kacinilir).
 *
 * Onarim kaynaga gore uretilir; standalone yalnizca raporlanir
 * (paket yoneticisi yok).
 */
export async function annotateHealth(tools: CliTool[]): Promise<void> {
  for (const tool of tools) {
    // Platform araclari (npm, npx, pip, uv...) yanlislikla "bozuk"
    // isaretlenmemeli; onarim komutu da tehlikeli olur.
    if (tool.status === 'protected') continue;
    const candidates = await healthCandidates(tool);
    for (const binPath of candidates) {
      const st = await stat(longPath(binPath)).catch(() => null);
      if (!st?.isFile() || st.size === 0 || st.size >= 4096) continue;

      // Observer etkisi: stub okumasi atime'i kirletmemeli (E2).
      const info = await readExeInfoPreservingTimes(binPath);
      if (info.valid) continue;

      const scriptEvidence = await installScriptEvidence(tool);
      tool.health = 'broken';
      tool.healthEvidence = [
        `bin dosyasi ${st.size} B (stub)`,
        ...(scriptEvidence ? [scriptEvidence] : []),
        `gecerli PE basligi yok: ${info.detail ?? 'bilinmiyor'}`,
      ];
      const spec = repairSpecFor(tool, Boolean(scriptEvidence));
      if (spec) tool.repair = spec;
      break;
    }
  }
}

/** Araci calistiran .exe adaylari; kaynak fark etmeksizin. */
async function healthCandidates(tool: CliTool): Promise<string[]> {
  const out: string[] = [];

  if (tool.source === 'npm-global') {
    const pkg = await readJson(join(tool.installPath, 'package.json'));
    const rel = pkg ? packageBinRel(pkg, tool.command) : null;
    // Yalnizca dogrudan calistirilabilir .exe adayi; .js/.cmd/.ps1
    // kucuk olabilir ve probe edilmemeli.
    if (rel && /\.exe$/i.test(rel)) out.push(join(tool.installPath, rel));
  }

  // uv / dotnet / pip / standalone: shim'in kendisi calistirilabilir
  // dosyadir (npm'de .cmd/.ps1 oldugu icin buraya girmez).
  for (const s of tool.shims) {
    if (/\.exe$/i.test(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

/** npm paketinde tanimli kurulum betikleri (kanit metni). */
async function installScriptEvidence(tool: CliTool): Promise<string> {
  if (tool.source !== 'npm-global') return '';
  const pkg = await readJson(join(tool.installPath, 'package.json'));
  const scripts = pkg?.scripts as Record<string, unknown> | undefined;
  if (!scripts) return '';
  const names = ['preinstall', 'install', 'postinstall'].filter((n) => scripts[n]);
  return names.length > 0
    ? `kurulum betigi tanimli (${names.join(', ')}); betikler engellenmis olabilir`
    : '';
}

/** package.json `bin` alanindan bu komutun dosya yolunu cikarir. */
function packageBinRel(pkg: Record<string, unknown>, cmd: string): string | null {
  const bin = pkg.bin;
  if (typeof bin === 'string') return bin;
  if (bin && typeof bin === 'object') {
    const v = (bin as Record<string, unknown>)[cmd];
    return typeof v === 'string' ? v : null;
  }
  return null;
}

/** Kaynaga gore onarim komutu; standalone icin null (elle onarim). */
function repairSpecFor(tool: CliTool, hasInstallScript: boolean): UninstallSpec | null {
  if (!tool.uninstall) return null;
  const name = tool.packageName;
  const version = tool.version;
  const program = tool.uninstall.program;
  const npmCli = tool.uninstall.args[0]?.endsWith('.js') ? tool.uninstall.args[0] : null;

  switch (tool.source) {
    case 'npm-global': {
      const pkg = version ? `${name}@${version}` : name;
      const flag = hasInstallScript ? `--allow-scripts=${name}` : '--force';
      return {
        kind: 'npm',
        program,
        args: npmCli
          ? [npmCli, 'install', '-g', pkg, flag]
          : ['install', '-g', pkg, flag],
        display: `npm install -g ${pkg} ${flag}`,
      };
    }
    case 'uv-tool': {
      const pkg = version ? `${name}==${version}` : name;
      return {
        kind: 'uv',
        program,
        args: ['tool', 'install', '--force', pkg],
        display: `uv tool install --force ${pkg}`,
      };
    }
    case 'dotnet-tool':
      return {
        kind: 'dotnet',
        program,
        args: [
          'tool',
          'install',
          '--global',
          name,
          ...(version ? ['--version', version] : []),
          '--force',
        ],
        display: `dotnet tool install --global ${name}${version ? ` --version ${version}` : ''} --force`,
      };
    case 'pip-user': {
      const pkg = version ? `${name}==${version}` : name;
      return {
        kind: 'pip',
        program,
        args: ['-m', 'pip', 'install', '--force-reinstall', pkg],
        display: `python -m pip install --force-reinstall ${pkg}`,
      };
    }
    case 'standalone':
      return null;
  }
}

async function listPackageDirs(modules: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(longPath(modules), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    if (e.name.startsWith('@')) {
      try {
        const scoped = await readdir(longPath(join(modules, e.name)), { withFileTypes: true });
        for (const s of scoped) {
          if (s.isDirectory()) out.push(join(modules, e.name, s.name));
        }
      } catch {
        /* okunamadi */
      }
    } else {
      out.push(join(modules, e.name));
    }
  }
  return out.sort();
}

function binCommands(bin: unknown, packageName: string): string[] {
  if (typeof bin === 'string') return [unscoped(packageName)];
  if (bin && typeof bin === 'object') {
    return Object.keys(bin as Record<string, unknown>).filter(validCommand);
  }
  return [];
}

async function shimPaths(prefix: string, cmd: string): Promise<string[]> {
  const candidates = [join(prefix, `${cmd}.cmd`), join(prefix, `${cmd}.ps1`), join(prefix, cmd), join(prefix, `${cmd}.exe`)];
  const out: string[] = [];
  for (const p of candidates) {
    try {
      const st = await stat(longPath(p));
      if (st.isFile()) out.push(p);
    } catch {
      /* yok */
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// uv araclari
// ---------------------------------------------------------------------------

async function scanUvTools(
  now: number,
  unusedDays: number,
  history: HistoryData,
  atimeReliable: boolean,
  roots: string[],
  notes: string[],
  hooks: ScanHooks,
): Promise<CliTool[]> {
  const candidates = [
    process.env.APPDATA ? join(process.env.APPDATA, 'uv', 'tools') : '',
    process.env.USERPROFILE ? join(process.env.USERPROFILE, '.local', 'share', 'uv', 'tools') : '',
  ].filter(Boolean);

  const out: CliTool[] = [];
  const uv = findOnPath('uv.exe') ?? findOnPath('uv');

  for (const root of candidates) {
    if (!(await isDirectory(root))) continue;
    roots.push(root);
    let entries;
    try {
      entries = await readdir(longPath(root), { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries) {
      throwIfAborted(hooks.signal);
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const toolDir = join(root, e.name);
      const receiptPath = join(toolDir, 'uv-receipt.toml');
      const pre = await preStat(receiptPath);
      if (pre.mtime === 0) continue;
      let receipt = '';
      try {
        receipt = await readFile(longPath(receiptPath), 'utf8');
      } catch {
        continue;
      }

      const pkgName =
        /requirements\s*=\s*\[\s*\{\s*name\s*=\s*"([^"]+)"/m.exec(receipt)?.[1] ?? e.name;
      const entriesMatch = [...receipt.matchAll(/name\s*=\s*"([^"]+)"\s*,\s*install-path\s*=\s*"([^"]+)"/g)];
      const shims = entriesMatch
        .map((m) => (m[2] ?? '').replace(/\//g, '\\'))
        .filter((p) => p.length > 0 && existsSync(longPath(p)));
      const command = entriesMatch[0]?.[1] ?? pkgName;
      if (!validCommand(command)) continue;

      const installedAt = pre.mtime;
      // Yalnizca SHIM'lerin atime'i kullanilir. Manifesti biz okuyoruz;
      // onun atime'i kaniti kirletir (observer etkisi).
      const lastAccessAt = await maxAtime(shims);
      const state = await findStateDirs(command, pkgName);
      const usage = usageVerdict({
        now,
        unusedDays,
        command,
        source: 'uv-tool',
        packageName: pkgName,
        installedAt,
        lastAccessAt,
        state,
        history,
        atimeReliable,
      });

      const tool: CliTool = {
        id: `uv-tool:${pkgName}:${command}`,
        command,
        source: 'uv-tool',
        packageName: pkgName,
        version: await distVersion(toolDir, pkgName),
        installPath: toolDir,
        shims,
        stalePaths: [],
        stateDirs: state.dirs,
        installedAt,
        lastAccessAt,
        lastStateAt: state.lastMtime,
        historyMentions: usage.mentions,
        historyLastRatio: usage.lastRatio,
        totalBytes: await sizeOf(toolDir),
        idleDays: usage.idleDays,
        status: usage.status,
        confidence: usage.confidence,
        evidence: usage.evidence,
        usageSignals: usage.signals,
        atimeSuspect: usage.atimeSuspect,
        uninstall: uv
          ? {
              kind: 'uv',
              program: uv,
              args: ['tool', 'uninstall', pkgName],
              display: `uv tool uninstall ${pkgName}`,
            }
          : null,
      };
      out.push(tool);
      hooks.emit(tool);
    }
  }

  if (out.length === 0) notes.push('uv arac deposu bulunamadi veya bos.');
  return out;
}

// ---------------------------------------------------------------------------
// .NET global araclar
// ---------------------------------------------------------------------------

async function scanDotnetTools(
  now: number,
  unusedDays: number,
  history: HistoryData,
  atimeReliable: boolean,
  roots: string[],
  notes: string[],
  hooks: ScanHooks,
): Promise<CliTool[]> {
  const home = process.env.USERPROFILE;
  if (!home) return [];
  const root = join(home, '.dotnet', 'tools');
  const store = join(root, '.store');
  if (!(await isDirectory(store))) return [];
  roots.push(root);

  const dotnet = findOnPath('dotnet.exe') ?? findOnPath('dotnet');
  const out: CliTool[] = [];

  let entries;
  try {
    entries = await readdir(longPath(store), { withFileTypes: true });
  } catch {
    return [];
  }

  for (const e of entries) {
    throwIfAborted(hooks.signal);
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const pkgName = e.name;
    const versions = await subdirs(join(store, pkgName));
    versions.sort(compareVersionStrings);
    const version = versions[versions.length - 1] ?? '';
    const installPath = join(store, pkgName, version);
    // .store icinde kalan eski surumler: ayni aracin onceki kurulumlari.
    const stalePaths = version
      ? versions.slice(0, -1).map((v) => join(store, pkgName, v))
      : [];

    const shims = [join(root, `${pkgName}.exe`), join(root, pkgName)].filter((p) => existsSync(longPath(p)));
    if (shims.length === 0) continue;

    const installedAt = (await mtime(join(installPath, `${pkgName}.deps.json`))) || (await mtime(shims[0]!));
    const lastAccessAt = await maxAtime(shims);
    const state = await findStateDirs(pkgName, pkgName);
    const usage = usageVerdict({
      now,
      unusedDays,
      command: pkgName,
      source: 'dotnet-tool',
      packageName: pkgName,
      installedAt,
      lastAccessAt,
      state,
      history,
      atimeReliable,
    });

    const tool: CliTool = {
      id: `dotnet-tool:${pkgName}`,
      command: pkgName,
      source: 'dotnet-tool',
      packageName: pkgName,
      version,
      installPath,
      shims,
      stalePaths,
      stateDirs: state.dirs,
      installedAt,
      lastAccessAt,
      lastStateAt: state.lastMtime,
      historyMentions: usage.mentions,
      historyLastRatio: usage.lastRatio,
      totalBytes: await sizeOf(installPath),
      idleDays: usage.idleDays,
      status: usage.status,
      confidence: usage.confidence,
      evidence: usage.evidence,
      usageSignals: usage.signals,
      atimeSuspect: usage.atimeSuspect,
      uninstall: dotnet
        ? {
            kind: 'dotnet',
            program: dotnet,
            args: ['tool', 'uninstall', '--global', pkgName],
            display: `dotnet tool uninstall --global ${pkgName}`,
          }
        : null,
    };
    out.push(tool);
    hooks.emit(tool);
  }

  if (out.length === 0) notes.push('.NET arac deposu bulundu ama arac yok.');
  return out;
}

// ---------------------------------------------------------------------------
// pip --user / Python Scripts
// ---------------------------------------------------------------------------

async function scanPythonUser(
  now: number,
  unusedDays: number,
  history: HistoryData,
  atimeReliable: boolean,
  roots: string[],
  notes: string[],
  hooks: ScanHooks,
): Promise<CliTool[]> {
  const env = process.env;
  const candidates: string[] = [];
  if (env.APPDATA) {
    candidates.push(join(env.APPDATA, 'Python', 'Scripts'));
    try {
      const dirs = await readdir(longPath(join(env.APPDATA, 'Python')), { withFileTypes: true });
      for (const d of dirs) {
        if (d.isDirectory() && /^Python\d/i.test(d.name)) candidates.push(join(env.APPDATA, 'Python', d.name, 'Scripts'));
      }
    } catch {
      /* yok */
    }
  }
  if (env.LOCALAPPDATA) {
    try {
      const dirs = await readdir(longPath(join(env.LOCALAPPDATA, 'Programs', 'Python')), { withFileTypes: true });
      for (const d of dirs) {
        if (d.isDirectory() && /^Python\d/i.test(d.name)) candidates.push(join(env.LOCALAPPDATA, 'Programs', 'Python', d.name, 'Scripts'));
      }
    } catch {
      /* yok */
    }
  }

  const out: CliTool[] = [];
  for (const scripts of candidates) {
    if (!(await isDirectory(scripts))) continue;
    roots.push(scripts);
    const pyRoot = dirname(scripts);
    const site = join(pyRoot, 'Lib', 'site-packages');
    const scriptsMap = await readEntryPoints(site);
    const python = [join(pyRoot, 'python.exe'), join(pyRoot, 'python3.exe')].find((p) => existsSync(longPath(p)));

    let entries;
    try {
      entries = await readdir(longPath(scripts), { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries) {
      throwIfAborted(hooks.signal);
      if (!e.isFile()) continue;
      const ext = e.name.lastIndexOf('.') >= 0 ? e.name.slice(e.name.lastIndexOf('.')).toLowerCase() : '';
      if (ext !== '.exe' && ext !== '.cmd') continue;
      const cmd = e.name.slice(0, e.name.length - ext.length);
      if (!validCommand(cmd) || BASE_COMMANDS.has(cmd.toLowerCase())) continue;
      if (/^(python|pip|wheel|setuptools|uv|idle)/i.test(cmd)) continue;

      const shim = join(scripts, e.name);
      const dist = scriptsMap.get(cmd.toLowerCase());
      const installPath = dist ? join(site, dist.distInfo) : shim;
      const installedAt = await mtime(installPath);
      const lastAccessAt = await maxAtime([shim, installPath]);
      const state = await findStateDirs(cmd, dist?.packageName ?? cmd);
      const usage = usageVerdict({
        now,
        unusedDays,
        command: cmd,
        source: 'pip-user',
        packageName: dist?.packageName ?? cmd,
        installedAt,
        lastAccessAt,
        state,
        history,
        atimeReliable,
      });

      const tool: CliTool = {
        id: `pip-user:${dist?.packageName ?? cmd}:${cmd}`,
        command: cmd,
        source: 'pip-user',
        packageName: dist?.packageName ?? cmd,
        version: dist?.version ?? '',
        installPath,
        shims: [shim],
        stalePaths: [],
        stateDirs: state.dirs,
        installedAt,
        lastAccessAt,
        lastStateAt: state.lastMtime,
        historyMentions: usage.mentions,
        historyLastRatio: usage.lastRatio,
        totalBytes: await sizeOf(installPath),
        idleDays: usage.idleDays,
        status: usage.status,
        confidence: usage.confidence,
        evidence: usage.evidence,
        usageSignals: usage.signals,
        atimeSuspect: usage.atimeSuspect,
        uninstall:
          python && dist
            ? {
                kind: 'pip',
                program: python,
                args: ['-m', 'pip', 'uninstall', '-y', dist.packageName],
                display: `python -m pip uninstall -y ${dist.packageName}`,
              }
            : null,
      };
      out.push(tool);
      hooks.emit(tool);
    }
  }

  return out;
}

async function readEntryPoints(site: string): Promise<Map<string, { packageName: string; version: string; distInfo: string }>> {
  const map = new Map<string, { packageName: string; version: string; distInfo: string }>();
  let entries;
  try {
    entries = await readdir(longPath(site), { withFileTypes: true });
  } catch {
    return map;
  }
  for (const e of entries) {
    if (!e.isDirectory() || !e.name.endsWith('.dist-info')) continue;
    const distInfo = e.name;
    const base = distInfo.slice(0, -'.dist-info'.length);
    const dash = base.lastIndexOf('-');
    const packageName = dash > 0 ? base.slice(0, dash) : base;
    const version = dash > 0 ? base.slice(dash + 1) : '';
    let txt = '';
    try {
      txt = await readFile(longPath(join(site, distInfo, 'entry_points.txt')), 'utf8');
    } catch {
      continue;
    }
    const section = /\[console_scripts\]([\s\S]*?)(?:\n\[|$)/.exec(txt)?.[1] ?? '';
    for (const line of section.split(/\r?\n/)) {
      const m = /^([^=#]+?)\s*=\s*/.exec(line.trim());
      if (m?.[1]) map.set(m[1].trim().toLowerCase(), { packageName, version, distInfo });
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Bagimsiz shim'ler (.local\bin, .cargo\bin, go\bin, .bun\bin)
// ---------------------------------------------------------------------------

async function scanStandaloneShims(
  now: number,
  unusedDays: number,
  history: HistoryData,
  atimeReliable: boolean,
  covered: Set<string>,
  roots: string[],
  hooks: ScanHooks,
): Promise<CliTool[]> {
  const home = process.env.USERPROFILE;
  if (!home) return [];
  const local = process.env.LOCALAPPDATA;
  const programData = process.env.ProgramData;
  const dirs = [
    join(home, '.local', 'bin'),
    join(home, '.cargo', 'bin'),
    join(home, 'go', 'bin'),
    join(home, '.bun', 'bin'),
    // Paket yoneticisi shim'leri: winget / scoop / chocolatey / volta.
    ...(local ? [join(local, 'Microsoft', 'WinGet', 'Links')] : []),
    join(home, 'scoop', 'shims'),
    ...(programData ? [join(programData, 'chocolatey', 'bin')] : []),
    join(home, '.volta', 'bin'),
  ];

  const out: CliTool[] = [];
  for (const dir of dirs) {
    if (!(await isDirectory(dir))) continue;
    roots.push(dir);
    let entries;
    try {
      entries = await readdir(longPath(dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      throwIfAborted(hooks.signal);
      if (!e.isFile()) continue;
      const p = join(dir, e.name);
      if (covered.has(normPath(p))) continue;
      const cmd = stripExe(e.name);
      if (!validCommand(cmd) || BASE_COMMANDS.has(cmd.toLowerCase())) continue;
      if (/^(python|pip|uv|uvx|uvw|node|npm|npx|corepack|dotnet)/i.test(cmd)) continue;

      const installedAt = await mtime(p);
      const lastAccessAt = await atimeOf(p);
      const state = await findStateDirs(cmd, cmd);
      const usage = usageVerdict({
        now,
        unusedDays,
        command: cmd,
        source: 'standalone',
        packageName: cmd,
        installedAt,
        lastAccessAt,
        state,
        history,
        atimeReliable,
      });

      // T38: surum, ikiliyi CALISTIRMADAN VersionInfo'dan okunur.
      // Observer etkisi: bu okuma atime'i kirletmemeli (E1).
      const exe = await readExeInfoPreservingTimes(p);

      const tool: CliTool = {
        id: `standalone:${cmd}`,
        command: cmd,
        source: 'standalone',
        packageName: cmd,
        version: exe.version ?? '',
        installPath: p,
        shims: [p],
        stalePaths: [],
        stateDirs: state.dirs,
        installedAt,
        lastAccessAt,
        lastStateAt: state.lastMtime,
        historyMentions: usage.mentions,
        historyLastRatio: usage.lastRatio,
        totalBytes: (await sizeOfFile(p)) ?? 0,
        idleDays: usage.idleDays,
        status: usage.status,
        confidence: usage.confidence,
        evidence: usage.evidence,
        usageSignals: usage.signals,
        atimeSuspect: usage.atimeSuspect,
        uninstall: null,
      };
      out.push(tool);
      hooks.emit(tool);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Kullanim kaniti
// ---------------------------------------------------------------------------

export interface UsageInput {
  now: number;
  unusedDays: number;
  command: string;
  source: CliSource;
  packageName: string;
  installedAt: number;
  lastAccessAt: number;
  state: StateEvidence;
  history: HistoryData;
  atimeReliable: boolean;
}

export interface UsageVerdict {
  mentions: number;
  lastRatio: number;
  idleDays: number;
  status: CliStatus;
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  signals: UsageSignal[];
  atimeSuspect: boolean;
}

/**
 * Kullanim karari (T69/F3, kural 21). Zaman damgasi TEK BASINA karar
 * uretmez:
 *  - E6: shim atime'i kurulum anina esitse (<2 sn) okuma kulanticisidir,
 *    kullanici degil; atime kanit olarak kullanilmaz.
 *  - K17: atime'i dogrulayan bir sinyal (kabuk gecmisi veya durum
 *    klasoru) yoksa `recent` uretilmez.
 *  - K20: gecmiste geciyorsa "en az bir kez kullanildi"dir; satir sirasi
 *    zaman olmadigindan "son kullanildi" denemez → `unknown`.
 */
export function usageVerdict(input: UsageInput): UsageVerdict {
  const { now, unusedDays, command } = input;
  // T69/F4 (K19): gecmis ayristirici paket calistiricilarini tanir ve
  // command'dan baska packageName (son parca) ile de eslesir.
  const usage = findHistoryMentions(input.history, command, input.packageName);
  const lastStateAt = input.state.lastMtime;
  const unusedMs = unusedDays * DAY;

  // E6: kurulum-atime ayrimi — shim okumasi kurulum anindaysa atime
  // kullanilamaz (kullaniciya bagli degil, kurulumun sonucudur).
  const installAtime =
    input.installedAt > 0 &&
    input.lastAccessAt > 0 &&
    Math.abs(input.lastAccessAt - input.installedAt) <= 2000;
  const atimeUsable = input.atimeReliable && input.lastAccessAt > 0 && !installAtime;

  // Yas/yararlilik yalnizca guvenilir sinyallerden olculur:
  // kullanilabilen atime, durum yazma zamani ve kurulum zamani.
  const reference = Math.max(
    atimeUsable ? input.lastAccessAt : 0,
    lastStateAt,
    input.installedAt,
  );
  const idleDays = reference > 0 ? daysSince(reference, now) : Number.POSITIVE_INFINITY;

  const stateRecent = lastStateAt > 0 && now - lastStateAt < unusedMs;
  const accessRecent = atimeUsable && now - input.lastAccessAt < unusedMs;
  const protectedCmd = BASE_COMMANDS.has(command.toLowerCase()) || BASE_PACKAGES.has(input.packageName.toLowerCase());

  let status: CliStatus;
  let confidence: 'high' | 'medium' | 'low';
  let onlyAtime = false;

  if (protectedCmd) {
    status = 'protected';
    confidence = 'high';
  } else if (stateRecent) {
    status = 'recent';
    confidence = 'high';
  } else if (accessRecent && usage.mentions > 0) {
    // Atime + gecmis birbirini dogrular (K17): iki bagimsiz sinyal.
    status = 'recent';
    confidence = 'medium';
  } else if (usage.mentions > 0) {
    // K20: gecmis var = en az bir kez kullanilmistir; "son kullanilma"
    // zamanı satir sirasindan cikamaz.
    status = 'unknown';
    confidence = 'medium';
  } else if (accessRecent) {
    // K17: atime tek basina dogrulayiciya sahip degil.
    status = 'unknown';
    confidence = 'low';
    onlyAtime = true;
  } else if (idleDays >= unusedDays) {
    status = 'unused';
    confidence = atimeUsable
      ? lastStateAt > 0
        ? 'high'
        : 'medium'
      : lastStateAt > 0
        ? 'medium'
        : 'low';
  } else {
    status = 'unknown';
    confidence = 'low';
  }

  const evidence: string[] = [];
  if (input.installedAt > 0) evidence.push(`kurulum: ${fmtDate(input.installedAt)}`);
  if (input.lastAccessAt > 0) evidence.push(`shim son erisim: ${fmtDate(input.lastAccessAt)}`);
  if (lastStateAt > 0) evidence.push(`durum klasoru son yazim: ${fmtDate(lastStateAt)}`);
  if (usage.mentions > 0) {
    evidence.push(`kabuk gecmisinde ${usage.mentions} kez (son bahis sira %${Math.round(usage.lastRatio * 100)})`);
  } else if (input.history.available) {
    evidence.push('kabuk gecmisinde hic gecmiyor');
  }
  if (installAtime) {
    evidence.push('shim atime kurulum aniyla ayni; kullanim kaniti olarak sayilmadi');
  }
  if (!input.atimeReliable) {
    evidence.push('atime guvenilmez; karar durum klasoru/gecmise dayali');
  }
  if (status === 'unknown' && usage.mentions > 0) {
    evidence.push('gecmiste kullanilmis ama zaman bilinmiyor (satir sirasi zaman degildir)');
  }
  if (onlyAtime) {
    evidence.push('yalniz shim atime guncel; dogrulayici sinyal yok');
  }
  if (idleDays !== Number.POSITIVE_INFINITY && idleDays < 3650) evidence.push(`son sinyalden ${Math.floor(idleDays)} gun gecti`);

  // sabit sira: install, state, atime, history
  const ordered: UsageSignal[] = [];
  if (input.installedAt > 0) ordered.push('install');
  if (lastStateAt > 0) ordered.push('state');
  if (input.lastAccessAt > 0 && atimeUsable) ordered.push('atime');
  if (usage.mentions > 0) ordered.push('history');
  return {
    mentions: usage.mentions,
    lastRatio: usage.lastRatio,
    idleDays,
    status,
    confidence,
    evidence,
    signals: ordered,
    atimeSuspect: installAtime,
  };
}

/**
 * E9: toplu atime patlamasi. Ayni ~5 sn penceresinde en az 3 farkli
 * aracin shim atime'i guncellendiyse ( antivirus/indeksleyici/yedekleme
 * toplu okur ) bu kullanim kaniti DEGILDIR; pencere icindeki tum
 * id'ler isaretlenir.
 */
export function findAtimeBursts(
  items: Array<{ id: string; atime: number }>,
  windowMs = 5000,
  min = 3,
): Set<string> {
  const bursts = new Set<string>();
  const sorted = items.filter((it) => it.atime > 0).sort((a, b) => a.atime - b.atime);
  const windowCounts = new Map<string, number>();
  let distinct = 0;
  let j = 0;
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i]!;
    const before = windowCounts.get(entry.id) ?? 0;
    windowCounts.set(entry.id, before + 1);
    if (before === 0) distinct++;
    // Pencereyi soldan daralt.
    while (entry.atime - sorted[j]!.atime > windowMs) {
      const left = sorted[j]!;
      const leftCount = windowCounts.get(left.id) ?? 0;
      windowCounts.set(left.id, leftCount - 1);
      if (leftCount === 1) distinct--;
      j++;
    }
    if (distinct >= min) {
      for (let k = j; k <= i; k++) bursts.add(sorted[k]!.id);
    }
  }
  return bursts;
}

/**
 * E9: burst icerisindeki YALNIZCA-atime `recent` kararlarini `unknown`
 * (low) ihrac ederek duzeltir. Durum klasoru guncel olan etikler
 * ETKILENMEZ (kullanim kanitidir). Araclar YERINDE guncellenir:
 * daha once emit edilmis nesne, ayni nesnedir.
 */
export function applyAtimeBurstFilter(
  tools: CliTool[],
  burst: Set<string>,
  opts: { now: number; unusedDays: number },
): void {
  if (burst.size === 0) return;
  const unusedMs = Math.max(1, opts.unusedDays) * DAY;
  for (const tool of tools) {
    if (!burst.has(tool.id)) continue;
    const stateFresh = tool.lastStateAt > 0 && opts.now - tool.lastStateAt < unusedMs;
    if (tool.status !== 'recent' || stateFresh) continue;
    tool.status = 'unknown';
    tool.confidence = 'low';
    tool.evidence.push('atime toplu guncelleme (burst); kanit sayilmadi');
  }
}

async function loadShellHistory(): Promise<HistoryData> {
  const env = process.env;
  const files: string[] = [];
  const psDir = env.APPDATA ? join(env.APPDATA, 'Microsoft', 'Windows', 'PowerShell', 'PSReadLine') : '';
  if (psDir) {
    try {
      const ents = await readdir(longPath(psDir), { withFileTypes: true });
      for (const e of ents) {
        if (e.isFile() && /history\.txt$/i.test(e.name)) files.push(join(psDir, e.name));
      }
    } catch {
      /* yok */
    }
  }
  const home = env.USERPROFILE;
  if (home) {
    for (const f of ['.bash_history', '.zsh_history', join('.local', 'share', 'fish', 'fish_history')]) {
      const p = join(home, f);
      if (existsSync(longPath(p))) files.push(p);
    }
  }

  const lines: string[] = [];
  let lastWrite = 0;
  for (const f of files) {
    try {
      const st = await stat(longPath(f));
      if (st.size > MAX_HISTORY_BYTES) continue;
      lastWrite = Math.max(lastWrite, st.mtimeMs);
      const txt = await readFile(longPath(f), 'utf8');
      for (const raw of txt.split(/\r?\n/)) {
        const line = raw.replace(/^- cmd:\s*/, '').trim();
        if (line) lines.push(line);
      }
    } catch {
      /* okunamadi */
    }
  }
  return { files, lines, lastWrite, available: files.length > 0 };
}

// ---------------------------------------------------------------------------
// Kabuk gecmisini ayristirma (T69/F4, K19)
//
// Gecmis satiri yalniz "en az bir kez kullanildi" kanitidir; satir sirasi
// zaman tasimaz (kural 21 — karar tarafi bunu `recent` icin kullanmaz).
// Eslesen komutlar: yalin komut, sudo onceki, .exe/.cmd/.bat/.ps1 sonu,
// ./ ve .\ onekli, tirnakli, yol onekli cagrilar. AYRICA paket
// calistiricilari uzerinden yapilan cagrilar (npx @scope/pkg, pnpm dsh web,
// dotnet tool run x, yarn dlx x, bunx x, uvx x, pipx run x).
// Kurulum satirlari (npm install|add|remove...) KULLANIM DEGILDIR.
// ---------------------------------------------------------------------------

/** Tek belirtecli calistiricilar: <runner> <paket|bayraklar> ... */
const RUNNER_SIMPLE = new Set(['npx', 'pnpx', 'bunx', 'uvx']);

/**
 * Degerli bayraklar: kendisinden SONRAKI belirtec de atlanir (`-p x`).
 * Yalniz bilinenler listede; bilinmeyen bayrak yalniz kendisini gecirir
 * (degersiz kabul edilir — `-y ornek` seklinde guvenlidir).
 */
const VALUE_FLAGS = new Set([
  '-p', '--package', '-C', '--dir', '-c', '--call',
  '--prefix', '--registry', '--python', '--cache', '--userconfig',
  '--workspace', '--filter', '--from', '--with',
]);

/** pipx alt komutlari (`run` HARIC — bunlar paket konumu saglamaz). */
const PIPX_OTHER_VERBS = new Set([
  'install', 'inject', 'upgrade', 'upgrade-all', 'uninstall', 'uninstall-all',
  'reinstall', 'reinstall-all', 'list', 'unlist', 'ensurepath',
  'environment', 'home', 'version', 'update',
]);

/** pnpm/yarn/bun: bu fiiller yerel betik/ikili calistirma DEGILDIR. */
const PM_VERBS = new Set([
  'install', 'i', 'add', 'remove', 'rm', 'uninstall', 'update', 'upgrade',
  'link', 'unlink', 'init', 'create', 'audit', 'outdated', 'list', 'ls',
  'why', 'config', 'store', 'cache', 'publish', 'pack', 'self', 'env',
  'setup', 'bin', 'prune', 'import', 'info', 'start', 'test', 'dev', 'up',
  'dlx', 'exec', 'run',
]);

/** dotnet: SDK alt komutlari (yalniz `tool run` / `<ad>` paket konumdur). */
const DOTNET_VERBS = new Set([
  'test', 'build', 'run', 'watch', 'add', 'remove', 'list', 'new', 'restore',
  'publish', 'pack', 'sln', 'format', 'tool', 'ef', 'nuget', 'workload',
  'help', 'msbuild', 'clean', 'vstest', 'search', 'get', 'set', 'clear',
  'delete', 'edit', 'fsi', 'sql', 'dev-certs', 'user-secrets',
]);

const INSTALL_VERBS: Record<string, string[]> = {
  npm: ['install', 'i', 'add', 'uninstall', 'remove', 'rm'],
  pnpm: ['add', 'install', 'remove'],
  yarn: ['add', 'install', 'remove'],
  bun: ['add', 'install', 'remove'],
};

/** Windows betik uzantilari: `ornek.cmd` == `ornek`. */
const SCRIPT_EXTS = ['.exe', '.cmd', '.bat', '.ps1'];

/**
 * Belirteci karsilastirma bicimine indirger: tirnak ve yol/baglam on eki
 * atilir (`'x'`, `"x"`, `./x`, `.\x`, `C:\x\x.exe`, `@scope/ad`),
 * Windows betik uzantilari ve surum eki (`pkg@2`) duser, kucuk harfe
 * iner.
 */
function normToken(raw: string): string {
  let t = raw.trim();
  if (
    t.length >= 2 &&
    ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"')))
  ) {
    t = t.slice(1, -1);
  }
  const slash = Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\'));
  if (slash >= 0) t = t.slice(slash + 1);
  t = t.toLowerCase();
  for (const ext of SCRIPT_EXTS) {
    if (t.endsWith(ext) && t.length > ext.length) {
      t = t.slice(0, -ext.length);
      break;
    }
  }
  // Surum eki: pkg@1.2.3 / @scope/ad@2 (baglam on eki korunmaz; ada bakilir)
  const at = t.indexOf('@', t.startsWith('@') ? 1 : 0);
  if (at > 0) t = t.slice(0, at);
  return t;
}

/** Paket adinin son parcasi: `@scope/ad` -> `ad`. */
function packageBaseName(t: string): string {
  const lower = t.toLowerCase();
  const slash = lower.lastIndexOf('/');
  return slash >= 0 ? lower.slice(slash + 1) : lower;
}

type NameMatcher = (tokenNorm: string) => boolean;

/** Komut VE paket adi (son parca) eslesme kumesini kurar. */
function buildNameMatcher(command: string, packageName: string | undefined): NameMatcher {
  const cmd = command.toLowerCase();
  const pkgBase = packageName ? packageBaseName(packageName) : '';
  return (t) => {
    if (!t) return false;
    if (t === cmd) return true;
    if (pkgBase && t === pkgBase) return true;
    return false;
  };
}

/** Calistiricidan sonraki paket/parametre belirtecleri: bayraklar atlanir. */
function* candidateTokens(tokens: readonly string[], start: number): Generator<string> {
  for (let i = start; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.startsWith('-')) {
      // `--pkg=x` kendi icinde degerlidir; dugun bayrak sadece atlanir.
      if (VALUE_FLAGS.has(tok)) i++;
      continue;
    }
    yield normToken(tok);
  }
}

function withoutSudo(tokens: readonly string[]): readonly string[] {
  if (tokens.length > 1 && normToken(tokens[0]!) === 'sudo') return tokens.slice(1);
  return tokens;
}

/** Kesim bir kurulum satiri mi? (npm i / pipx install / uv tool install ...) */
function isInstallSegment(tokens: readonly string[]): boolean {
  const parts = withoutSudo(tokens);
  if (parts.length === 0) return false;
  const head = normToken(parts[0]!);
  const v1 = parts[1] ? normToken(parts[1]!) : '';
  const verbs = INSTALL_VERBS[head];
  if (verbs) return verbs.includes(v1);
  if (head === 'pipx') return v1 === 'install';
  if (head === 'uv' || head === 'dotnet') {
    const v2 = parts[2] ? normToken(parts[2]!) : '';
    return v1 === 'tool' && v2 === 'install';
  }
  return false;
}

/** Bir satir kesimi komutu/paketi cagiriyor mu? */
function segmentMentions(
  tokens: readonly string[],
  isName: NameMatcher,
): boolean {
  const parts = withoutSudo(tokens);
  if (parts.length === 0) return false;
  const head = normToken(parts[0]!);
  if (!head) return false;

  // Kapsam konumu: calistirici alt komutlarindan sonrasi paket yeridir;
  // calistirma degil olan yonetici fiilleri eslesme saglamaz.
  const startAfterRunner = (from: number): boolean => {
    // Paket/alt komut, bayraklar atlandiktan sonraki ILK belirtecdir;
    // sonraki belirtecler argumandir ve eslesme saglamaz
    // (`npx bir-arac ornek` -> 'ornek' argumandir, kullanim degildir).
    for (const c of candidateTokens(parts, from)) return isName(c);
    return false;
  };

  if (RUNNER_SIMPLE.has(head)) return startAfterRunner(1);

  if (head === 'pipx') {
    const v1 = parts[1] ? normToken(parts[1]!) : '';
    const start = v1 === 'run' ? 2 : PIPX_OTHER_VERBS.has(v1) ? parts.length : 1;
    return startAfterRunner(start);
  }
  if (head === 'npm') {
    // npm exec <paket>, npm run <ad>; diger npm alt komutlari eslesmez.
    const v1 = parts[1] ? normToken(parts[1]!) : '';
    const start = v1 === 'exec' || v1 === 'run' ? 2 : parts.length;
    return startAfterRunner(start);
  }
  if (head === 'pnpm' || head === 'yarn' || head === 'bun') {
    const v1 = parts[1] ? normToken(parts[1]!) : '';
    const start =
      v1 === 'run' || (head === 'bun' && v1 === 'x') || v1 === 'dlx' || v1 === 'exec'
        ? 2
        : PM_VERBS.has(v1)
          ? parts.length
          : 1;
    return startAfterRunner(start);
  }
  if (head === 'dotnet') {
    const v1 = parts[1] ? normToken(parts[1]!) : '';
    const v2 = parts[2] ? normToken(parts[2]!) : '';
    const start =
      v1 === 'tool' && v2 === 'run' ? 3 : DOTNET_VERBS.has(v1) ? parts.length : 1;
    return startAfterRunner(start);
  }

  // Dogrudan cagri: komut yalniz ilk belirtec konumundadir.
  return isName(head);
}

/**
 * Kabuk gecmisinde komutun/paketin gecme adedi. Satir basi veya `;|&`
 * sonrasi kesimlerde arar; `sudo`, betik uzantilari, yol oneki ve
 * tirnaklar disarida birakilir; paket calistiricilari ve paket
 * yoneticisi calistirmalarini gorur; kurulum iceren satir tamamen
 * atlanir (muhafazakar).
 */
export function findHistoryMentions(
  history: HistoryData,
  command: string,
  packageName?: string,
): { mentions: number; lastRatio: number } {
  if (history.lines.length === 0) return { mentions: 0, lastRatio: 0 };
  const isName = buildNameMatcher(command, packageName);
  let mentions = 0;
  let last = -1;
  for (let i = 0; i < history.lines.length; i++) {
    const line = history.lines[i]!;
    // Kesimler: `;` `|` `&&` ayraclari her komut konumu tasiyabilir.
    const segs = line.split(/[;&|]+/);
    let matched = false;
    for (const seg of segs) {
      const tokens = seg.trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 0) continue;
      if (isInstallSegment(tokens)) {
        // Muhafazakar davranis: kurulum satirinin TAMAMI atlanir —
        // ayni satirda baska komut olsa bile kullanim sayilmaz.
        matched = false;
        break;
      }
      if (segmentMentions(tokens, isName)) {
        matched = true;
        break;
      }
    }
    if (matched) {
      mentions++;
      last = i;
    }
  }
  return { mentions, lastRatio: last >= 0 ? (last + 1) / history.lines.length : 0 };
}

/**
 * Durum kaniti: aracin kendi config/state klasorleri. `env` yalnizca
 * test enjeksiyonu icindir; mevcut cagilar varsayilan process.env
 * kullanir. Not: `%LOCALAPPDATA%\Programs\<ad>` bir KURULUM dizinidir;
 * guncelleme mtime'i kullanim sanildigindan aday listesine ALINMAZ (E4).
 */
export async function findStateDirs(
  command: string,
  packageBase: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StateEvidence> {
  const home = env.USERPROFILE;
  const appData = env.APPDATA;
  const local = env.LOCALAPPDATA;
  if (!home) return { dirs: [], lastMtime: 0, lastAtime: 0 };

  const names = [...new Set([command, packageBase, packageBase.split('/').pop() ?? packageBase])]
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && validCommand(s) && !s.includes('\\') && !s.includes('/'));

  const candidates: string[] = [];
  for (const n of names) {
    candidates.push(join(home, `.${n}`));
    candidates.push(join(home, '.config', n));
    if (appData) candidates.push(join(appData, n));
    if (local) candidates.push(join(local, n));
  }

  const dirs: string[] = [];
  let lastMtime = 0;
  let lastAtime = 0;
  const seen = new Set<string>();
  for (const dir of candidates) {
    const key = normPath(dir);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!(await isDirectory(dir))) continue;
    dirs.push(dir);
    const s = await boundedStats(dir);
    lastMtime = Math.max(lastMtime, s.lastMtime);
    lastAtime = Math.max(lastAtime, s.lastAtime);
  }
  return { dirs, lastMtime, lastAtime };
}

/** Durum kaniti OLMAYAN dosyalar: log/arka plan yazimi kullanim degildir (Kural 21, E3). */
const STATE_NOISE_FILE_RE = /\.(log|jsonl|tmp|pid)$/i;

/** Icine girilmeyen ve kendi mtime'i sayilmayan klasorler: servis loglari/onbellek. */
const STATE_NOISE_DIR_RE = /^(logs?|caches?|tmp|temp)$/i;

/** Icine girilmeyen klasorler: bagimlilik/derleme agaclari (kendi mtime'i yine de sayilir). */
const STATE_SKIP_TREE_RE = /^(node_modules|\.git|dist)$/i;

export async function boundedStats(root: string): Promise<{ lastMtime: number; lastAtime: number }> {
  let lastMtime = 0;
  let lastAtime = 0;
  let seen = 0;
  const stack = [root];
  while (stack.length > 0 && seen < MAX_STATE_ENTRIES) {
    const dir = stack.pop()!;
    let ents;
    try {
      ents = await readdir(longPath(dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      if (seen++ >= MAX_STATE_ENTRIES) break;
      const isDir = e.isDirectory();
      // Log/onbellek gurultusu: ne sayilir ne de gezilir.
      if (isDir ? STATE_NOISE_DIR_RE.test(e.name) : STATE_NOISE_FILE_RE.test(e.name)) continue;
      const p = join(dir, e.name);
      try {
        const st = await stat(longPath(p));
        lastMtime = Math.max(lastMtime, st.mtimeMs);
        lastAtime = Math.max(lastAtime, st.atimeMs);
      } catch {
        /* yok */
      }
      // Bagimlilik/derleme agaclarinin icerigine girilmez.
      if (isDir && !STATE_SKIP_TREE_RE.test(e.name)) stack.push(p);
    }
  }
  return { lastMtime, lastAtime };
}

async function detectAtimeReliability(): Promise<{ reliable: boolean; detail: string }> {
  try {
    const exec = promisify(execFile);
    const { stdout } = await exec('fsutil.exe', ['behavior', 'query', 'disablelastaccess'], {
      timeout: 10_000,
      windowsHide: true,
    });
    // 0 = User Managed, Updates Enabled
    // 1 = User Managed, Updates Disabled
    // 2 = System Managed, Updates Enabled
    // 3 = System Managed, Updates Disabled
    const m = /DisableLastAccess\s*=\s*([0-3])/i.exec(stdout);
    const v = m?.[1] ? Number(m[1]) : -1;
    const reliable = v === 0 || v === 2 || v === -1;
    return {
      reliable,
      detail: `fsutil DisableLastAccess=${m?.[1] ?? 'bilinmiyor'} (${reliable ? 'etkin' : 'kapali'})`,
    };
  } catch {
    return { reliable: false, detail: 'fsutil okunamadi' };
  }
}

// ---------------------------------------------------------------------------
// Kucuk yardimcilar
// ---------------------------------------------------------------------------

async function isDirectory(p: string): Promise<boolean> {
  try {
    const st = await stat(longPath(p));
    return st.isDirectory();
  } catch {
    return false;
  }
}

/**
 * OKUMADAN ONCE alinan stat. Kritik: bir dosyayi readFile ile acmak
 * Windows'ta son erisim zamanini GUNCELLER. Envanter kendi kanitini
 * bozmasin diye manifestin atime'i okumadan once kaydedilir.
 */
interface PreStat {
  mtime: number;
  atime: number;
}

async function preStat(p: string): Promise<PreStat> {
  try {
    const st = await stat(longPath(p));
    return { mtime: st.mtimeMs, atime: st.atimeMs };
  } catch {
    return { mtime: 0, atime: 0 };
  }
}

async function readJson(p: string): Promise<Record<string, unknown> | null> {
  try {
    const st = await stat(longPath(p));
    if (!st.isFile() || st.size > 256 * 1024) return null;
    return JSON.parse(await readFile(longPath(p), 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function mtime(p: string): Promise<number> {
  try {
    return (await stat(longPath(p))).mtimeMs;
  } catch {
    return 0;
  }
}

async function atimeOf(p: string): Promise<number> {
  try {
    return (await stat(longPath(p))).atimeMs;
  } catch {
    return 0;
  }
}

async function maxAtime(paths: string[]): Promise<number> {
  let max = 0;
  for (const p of paths) max = Math.max(max, await atimeOf(p));
  return max;
}

async function sizeOf(p: string): Promise<number> {
  try {
    const st = await stat(longPath(p));
    if (st.isFile()) return st.size;
  } catch {
    return 0;
  }
  try {
    const w = await walk({ root: p, largeThreshold: Infinity, maxLarge: 0 });
    return w.bytes;
  } catch {
    return 0;
  }
}

async function sizeOfFile(p: string): Promise<number> {
  try {
    return (await stat(longPath(p))).size;
  } catch {
    return 0;
  }
}

async function subdirs(p: string): Promise<string[]> {
  try {
    const ents = await readdir(longPath(p), { withFileTypes: true });
    return ents.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function distVersion(toolDir: string, pkgName: string): Promise<string> {
  const sp = join(toolDir, 'Lib', 'site-packages');
  const norm = pkgName.toLowerCase().replace(/[-_.]+/g, '_');
  try {
    const ents = await readdir(longPath(sp), { withFileTypes: true });
    for (const e of ents) {
      if (!e.isDirectory() || !e.name.endsWith('.dist-info')) continue;
      const base = e.name.slice(0, -'.dist-info'.length);
      const m = /^(.+)-(\d[^-]*)$/.exec(base);
      if (!m?.[1] || !m[2]) continue;
      if (m[1].toLowerCase().replace(/[-_.]+/g, '_') === norm) return m[2];
    }
  } catch {
    /* yok */
  }
  return '';
}

function findOnPath(exe: string): string | null {
  const path = process.env.PATH ?? '';
  for (const dir of path.split(';')) {
    if (!dir) continue;
    const p = join(dir, exe);
    if (existsSync(longPath(p))) return p;
  }
  return null;
}

function compareVersionStrings(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((s) => Number(s) || 0);
  const pb = b.split(/[.-]/).map((s) => Number(s) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function unscoped(name: string): string {
  const i = name.lastIndexOf('/');
  return i >= 0 ? name.slice(i + 1) : name;
}

function stripExe(name: string): string {
  return name.replace(/\.(exe|cmd|ps1|bat)$/i, '');
}

function validCommand(cmd: string): boolean {
  return /^[a-z0-9][a-z0-9._@-]*$/i.test(cmd) && cmd.length <= 80;
}

function normPath(p: string): string {
  return p.replace(/\//g, '\\').toLowerCase();
}

/**
 * Iptal sinyali geldiyse AbortError firlatir. Donguler bunu her
 * aracdan once cagirir; boylece iptal, suren bir boyut olcumunun
 * bitmesini beklemek zorunda kalmadan en kisa surede etkili olur.
 */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const err = new Error('Envanter taramasi iptal edildi');
  err.name = 'AbortError';
  throw err;
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// T17: shim tutarliligi + PATH golgeleme + kurulum izi
// ---------------------------------------------------------------------------

const MAX_LOG_HEAD = 96 * 1024;

/**
 * npm prefix'indeki shim'leri node_modules ile karsilastirir:
 *  - orphan-shim : shim var ama gosterdigi hedef yok
 *  - empty-scope : @scope klasoru bos (paket kalmamis)
 *
 * SALT OKUNUR; hicbir dosya silinmez veya tasinmaz.
 */
export async function scanNpmShimOrphans(prefix: string): Promise<ShimIssue[]> {
  const issues: ShimIssue[] = [];
  let entries;
  try {
    entries = await readdir(longPath(prefix), { withFileTypes: true });
  } catch {
    return issues;
  }

  for (const e of entries) {
    if (!e.isFile()) continue;
    const lower = e.name.toLowerCase();
    const shimLike = lower.endsWith('.cmd') || lower.endsWith('.ps1') || !e.name.includes('.');
    if (!shimLike) continue;
    const p = join(prefix, e.name);
    const target = await readShimTarget(p, prefix);
    if (!target) continue;
    if (!existsSync(longPath(target))) {
      issues.push({
        kind: 'orphan-shim',
        path: p,
        command: stripExe(e.name),
        detail: `shim var ama hedefi yok: ${target}`,
      });
    }
  }

  const modules = join(prefix, 'node_modules');
  try {
    const scopes = (await readdir(longPath(modules), { withFileTypes: true })).filter(
      (d) => d.isDirectory() && d.name.startsWith('@'),
    );
    for (const s of scopes) {
      const dir = join(modules, s.name);
      let kids;
      try {
        kids = await readdir(longPath(dir), { withFileTypes: true });
      } catch {
        continue;
      }
      if (!kids.some((k) => k.isDirectory())) {
        issues.push({ kind: 'empty-scope', path: dir, detail: 'scope klasoru bos (paket kalmamis)' });
      }
    }
  } catch {
    /* node_modules okunamadi */
  }

  return issues.slice(0, 100);
}

/**
 * PATH'te ayni komutun birden fazla girdisini bulur (golgeleme).
 *
 * entries PATH sirasina gore dizilir: ilki gercekten calisan, kalanlar
 * olu agirliktir. Yalnizca kanit uretir; karar vermez.
 */
export async function scanPathShadowing(
  tools: CliTool[],
  pathValue: string = process.env.PATH ?? '',
): Promise<PathShadow[]> {
  const dirs = pathValue.split(';').map((d) => d.trim()).filter(Boolean);
  if (dirs.length === 0) return [];

  const wanted = new Map<string, string>();
  for (const t of tools) {
    if (!wanted.has(t.command.toLowerCase())) wanted.set(t.command.toLowerCase(), t.command);
  }

  const hits = new Map<string, Array<{ dir: string; file: string }>>();
  const seenFiles = new Set<string>();
  for (const dir of dirs) {
    let entries;
    try {
      entries = await readdir(longPath(dir), { withFileTypes: true });
    } catch {
      continue;
    }
    const seenHere = new Set<string>();
    for (const e of entries) {
      if (!e.isFile()) continue;
      const base = stripExe(e.name).toLowerCase();
      if (!wanted.has(base) || seenHere.has(base)) continue;
      seenHere.add(base);
      const file = join(dir, e.name);
      // PATH'te ayni dizin birden fazla kez olabilir; ayni dosyayi
      // iki kez "golgeleme" saymak yanlis pozitif uretir.
      const key = normPath(file);
      if (seenFiles.has(key)) continue;
      seenFiles.add(key);
      const arr = hits.get(base) ?? [];
      arr.push({ dir, file });
      hits.set(base, arr);
    }
  }

  const labelFor = (file: string): string => {
    const n = normPath(file);
    const byShim = tools.find((tool) => tool.shims.some((s) => normPath(s) === n));
    if (byShim) return `${byShim.packageName} [${byShim.source}]`;
    const parent = normPath(dirname(n));
    const byDir = tools.find((tool) => normPath(tool.installPath) === parent);
    return byDir ? `${byDir.packageName} [${byDir.source}]` : 'PATH';
  };

  const out: PathShadow[] = [];
  for (const [lower, arr] of hits) {
    if (arr.length < 2) continue;
    out.push({
      command: wanted.get(lower) ?? lower,
      entries: arr.map((a) => ({ path: a.file, label: labelFor(a.file) })),
      detail: `PATH sirasinda ${arr.length} girdi: ilki calisir, kalanlar golgede`,
    });
  }
  return out.sort((a, b) => a.command.localeCompare(b.command)).slice(0, 50);
}

/**
 * npm kurulum gunluklerinden (`_logs`) kurulum izi cikarir.
 *
 * "Ajan kurmus olabilir" kaniti uygulama adindan DEGIL, kurulum
 * cwd'sinin yapisal izlerinden gelir: skills/, sessions/, SKILL.md,
 * .skill-lock.json. Kanit satiri olarak yazilir; silme hedefi olmaz.
 */
export async function applyInstallTraces(tools: CliTool[], logsDir?: string): Promise<void> {
  const dir =
    logsDir ??
    (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'npm-cache', '_logs') : '');
  if (!dir || !(await isDirectory(dir))) return;

  const wanted = new Map<string, CliTool>();
  for (const t of tools) {
    if (t.source === 'npm-global') wanted.set(t.packageName.toLowerCase(), t);
  }
  if (wanted.size === 0) return;

  let names: string[];
  try {
    names = await readdir(longPath(dir));
  } catch {
    return;
  }

  const logs = names
    .filter((n) => n.toLowerCase().endsWith('.log'))
    .sort()
    .reverse()
    .slice(0, 400);
  const seen = new Set<string>();

  for (const name of logs) {
    if (seen.size >= wanted.size) break;
    const text = await readHead(join(dir, name), MAX_LOG_HEAD);
    if (!text.includes('verbose argv')) continue;

    const argv = parseNpmArgv(text);
    if (!argv || !isGlobalInstall(argv)) continue;

    const pkgs = argv.slice(1).filter((a) => !a.startsWith('-'));
    if (pkgs.length === 0) continue;
    const cwdMatch = /verbose cwd (.+)/.exec(text);
    const cwd = cwdMatch?.[1]?.trim();
    const at = logTime(name);

    for (const pkg of pkgs) {
      const tool = wanted.get(pkg.toLowerCase());
      if (!tool || seen.has(tool.id)) continue;
      seen.add(tool.id);
      const hint = await agentHintFor(cwd);
      tool.installTrace = {
        at,
        command: `npm install -g ${pkg}`,
        ...(cwd ? { cwd } : {}),
        ...(hint ? { agentHint: hint } : {}),
        logFile: name,
      };
      tool.evidence.push(
        `npm kurulum gunlugu: ${at > 0 ? fmtDate(at) : name}${cwd ? ` (cwd: ${cwd})` : ''}`,
      );
      if (hint) tool.evidence.push(hint);
    }
  }
}

function parseNpmArgv(text: string): string[] | null {
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf('verbose argv');
    if (i < 0) continue;
    const rest = line.slice(i + 'verbose argv'.length).trim();
    if (rest.startsWith('[')) {
      try {
        const arr: unknown = JSON.parse(rest);
        if (Array.isArray(arr)) return arr.map(String);
      } catch {
        /* JSON degil; tirnakli bicimi dene */
      }
    }
    const quoted = [...rest.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? '');
    if (quoted.length > 0) return quoted;
  }
  return null;
}

function isGlobalInstall(argv: string[]): boolean {
  const cmd = (argv[0] ?? '').toLowerCase();
  if (cmd !== 'install' && cmd !== 'i' && cmd !== 'add') return false;
  return argv.some((a) => a === '-g' || a === '--global');
}

function logTime(name: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})_(\d{2})_(\d{2})_(\d{3})Z/.exec(name);
  if (!m) return 0;
  return Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
    Number(m[7]),
  );
}

async function agentHintFor(cwd: string | undefined): Promise<string | undefined> {
  if (!cwd || !(await isDirectory(cwd))) return undefined;
  const marks: string[] = [];
  for (const name of ['skills', 'sessions', '.skill-lock.json', 'SKILL.md']) {
    try {
      await stat(longPath(join(cwd, name)));
      marks.push(name);
    } catch {
      /* yok */
    }
  }
  return marks.length > 0
    ? `kurulum dizininde yapisal ajan izi: ${marks.join(', ')}`
    : undefined;
}

async function readHead(file: string, bytes: number): Promise<string> {
  try {
    const fh = await open(longPath(file), 'r');
    try {
      const buf = Buffer.alloc(bytes);
      const { bytesRead } = await fh.read(buf, 0, bytes, 0);
      return buf.subarray(0, bytesRead).toString('utf8');
    } finally {
      await fh.close();
    }
  } catch {
    return '';
  }
}
