import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { dataDir } from './data-dir.ts';
import { ApprovalRules } from './approval.ts';
import { longPath } from '../util/longpath.ts';
import { error as logError, info, warn } from '../util/log.ts';

/**
 * Ortam degiskeni motoru (Windows kayit defteri).
 *
 * Tasarim:
 *  - OKUMA her zaman guvenli; degerler hassas isimlerde MASKELENIR.
 *  - YAZMA yalnizca acik plan + yazili onay + once yedek ile.
 *  - `setx` KULLANILMAZ (1024 karakter siniri). Deger dogrudan
 *    HKCU/HKLM'ye yazilir; REG_EXPAND_SZ korunur.
 *  - Yazdiktan sonra WM_SETTINGCHANGE yayinlanir; yeni surecler gorur.
 *  - Machine (HKLM) degisikligi yonetici hakki ister; yoksa yalnizca
 *    oneri olarak kalir (plan.requiresAdmin).
 *
 * Bu modul karar uretmez; "hangi degisken bozuk/eksik/yetim" kanitini
 * ve uygulanabilir bir diff'i uretir.
 */

export type EnvScope = 'user' | 'machine';
export type RegistryType = 'REG_SZ' | 'REG_EXPAND_SZ' | 'REG_DWORD' | 'REG_MULTI_SZ' | 'REG_BINARY' | 'REG_NONE';

export const USER_KEY = 'HKCU\\Environment';
export const MACHINE_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment';
export const ENV_CLEAN_PHRASE = ApprovalRules.phrase('envClean');

export interface EnvVariable {
  name: string;
  scope: EnvScope;
  type: RegistryType;
  /** Ham deger (hassas ise API'de gosterilmez). */
  raw: string;
  /** Gosterilebilir deger; hassas ise maskelenir. */
  display: string;
  sensitive: boolean;
}

export interface EnvSnapshot {
  user: EnvVariable[];
  machine: EnvVariable[];
  note?: string;
}

export interface PathEntry {
  scope: EnvScope;
  index: number;
  raw: string;
  expanded: string;
  exists: boolean;
  /** Ayni kaynak icinde daha once gorulen ayni dizin. */
  duplicateOf?: number;
  /** Etkin PATH'te daha once gelen ayni dizin. */
  shadowedBy?: number;
}

export type EnvFindingKind =
  | 'missing-path'
  | 'duplicate-path'
  | 'shadowed-command'
  | 'orphan-variable'
  | 'sensitive-variable'
  | 'empty-variable';

export interface EnvFinding {
  id: string;
  kind: EnvFindingKind;
  scope: EnvScope;
  variable: string;
  value: string;
  reason: string;
  severity: 'info' | 'warning';
}

export interface CommandShadow {
  command: string;
  winner: string;
  shadowed: string[];
}

export interface EnvAnalysis {
  snapshot: EnvSnapshot;
  /** Etkin PATH: machine once, user sonra (Windows sirasi). */
  effectivePath: string[];
  pathEntries: PathEntry[];
  orphanVariables: EnvVariable[];
  commandShadows: CommandShadow[];
  findings: EnvFinding[];
}

export interface EnvChange {
  scope: EnvScope;
  name: string;
  type: RegistryType;
  before: string | null;
  after: string | null;
  reason: string;
}

export interface EnvPlan {
  changes: EnvChange[];
  requiresAdmin: boolean;
  warnings: string[];
  /** Degisiklik yoksa apply no-op. */
  empty: boolean;
}

export interface EnvApplyResult {
  ok: boolean;
  applied: number;
  failed: number;
  backupFile: string | null;
  requiresAdmin: boolean;
  errors: Array<{ name: string; scope: EnvScope; reason: string }>;
}

// ---------------------------------------------------------------------------
// Saf yardimcilar (test edilebilir)
// ---------------------------------------------------------------------------

const SENSITIVE_NAME =
  /(token|secret|password|passwd|credential|api[_-]?key|access[_-]?key|private[_-]?key|(^|_)pat($|_)|client[_-]?secret)/i;

export function isSensitiveName(name: string): boolean {
  return SENSITIVE_NAME.test(name);
}

/** Hassas deger ASLA gosterilmez; yalnizca varligi bildirilir. */
export function maskValue(name: string, value: string): string {
  if (!isSensitiveName(name)) return value;
  if (value.length === 0) return '';
  return '••••••';
}

/** `%VAR%` bicimini verilen haritayla (harf duyarsiz) genisletir. */
export function expandEnvValue(
  value: string,
  vars: Map<string, string> | NodeJS.ProcessEnv = process.env,
  depth = 0,
): string {
  if (depth > 8) return value;
  const lower = new Map<string, string>();
  if (vars instanceof Map) {
    for (const [k, v] of vars) lower.set(k.toLowerCase(), v);
  } else {
    for (const [k, v] of Object.entries(vars)) if (typeof v === 'string') lower.set(k.toLowerCase(), v);
  }
  let out = value;
  let changed = false;
  out = out.replace(/%([^%]+)%/g, (whole, name: string) => {
    const v = lower.get(name.toLowerCase());
    if (v === undefined) return whole;
    changed = true;
    return v;
  });
  if (changed) return expandEnvValue(out, vars, depth + 1);
  return out;
}

/** `reg query` ciktisindan degiskenleri ayristirir. */
export function parseRegEnvironment(stdout: string, scope: EnvScope): EnvVariable[] {
  const out: EnvVariable[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim() || /^HKEY_/i.test(line.trim())) continue;
    const m = /^\s+(.+?)\s{4}(REG_[A-Z_]+)\s{4}(.*)$/.exec(line);
    if (!m) continue;
    const name = m[1]!.trim();
    const type = m[2] as RegistryType;
    const raw = m[3] ?? '';
    out.push({
      name,
      scope,
      type,
      raw,
      display: maskValue(name, raw),
      sensitive: isSensitiveName(name),
    });
  }
  return out;
}

/** PATH degerini HAM girdilere ayirir (bos parcalar atilir). */
export function splitPathEntries(raw: string): string[] {
  return raw
    .split(';')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function normDir(p: string): string {
  let s = p.trim().replace(/\//g, '\\');
  while (s.length > 3 && s.endsWith('\\')) s = s.slice(0, -1);
  return s.toLowerCase();
}

/** `\\?\` uzun yol onekini de deneyerek varlik kontrolu. */
function envPathExists(p: string): boolean {
  if (existsSync(p)) return true;
  if (p.startsWith('\\\\?\\')) return existsSync(p.slice(4));
  return false;
}

const SKIP_ORPHAN_NAMES = new Set([
  'path',
  'pathext',
  'temp',
  'tmp',
  'systemroot',
  'windir',
  'comspec',
  'userprofile',
  'userdomain',
  'username',
  'homedrive',
  'homepath',
  'appdata',
  'localappdata',
  'programdata',
  'programfiles',
  'programfiles(x86)',
  'programw6432',
  'commonprogramfiles',
  'commonprogramfiles(x86)',
  'onedrive',
  'psmodulepath',
  'driverdata',
  'os',
  'processor_architecture',
  'number_of_processors',
  'public',
  'allusersprofile',
]);

/**
 * `*_HOME` / `*_ROOT` / `*_PATH` degiskenlerinden hedefi var olmayanlari
 * bulur. "Erisilemedi" ile "yok" ayrilir: yalnizca kesin yoksa bildirilir.
 */
export function findOrphanVariables(
  vars: EnvVariable[],
  exists: (p: string) => boolean = existsSync,
  expand: (v: string) => string = (v) => v,
): EnvVariable[] {
  const out: EnvVariable[] = [];
  for (const v of vars) {
    const name = v.name.toUpperCase();
    if (SKIP_ORPHAN_NAMES.has(name.toLowerCase())) continue;
    if (!/_(HOME|ROOT|PATH)$/.test(name)) continue;
    if (v.sensitive) continue;
    const expanded = expand(v.raw);
    if (expanded.includes('%')) continue; // cozulemeyen degisken: "bilinmiyor"
    const targets = name.endsWith('_PATH') ? splitPathEntries(expanded) : [expanded];
    if (targets.length === 0) continue;
    if (targets.every((t) => t.length > 0 && !exists(t))) out.push(v);
  }
  return out;
}

/** Etkin PATH'te ayni komutu saglayan birden fazla dizin (ilk kazanir). */
export function findCommandShadows(
  dirs: string[],
  readDir: (dir: string) => string[] = (dir) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  },
  exts: string[] = ['.exe', '.cmd', '.bat', '.com', '.ps1'],
): CommandShadow[] {
  const winner = new Map<string, string>();
  const losers = new Map<string, Set<string>>();
  for (const dir of dirs) {
    for (const file of readDir(dir)) {
      const lower = file.toLowerCase();
      const ext = exts.find((e) => lower.endsWith(e));
      if (!ext) continue;
      const cmd = lower.slice(0, -ext.length);
      if (!winner.has(cmd)) {
        winner.set(cmd, dir);
      } else {
        const w = winner.get(cmd)!;
        if (normDir(w) === normDir(dir)) continue;
        const set = losers.get(cmd) ?? new Set<string>();
        set.add(dir);
        losers.set(cmd, set);
      }
    }
  }
  return [...losers.entries()].map(([command, set]) => ({
    command,
    winner: winner.get(command)!,
    shadowed: [...set],
  }));
}

export function analyzeEnvironment(snapshot: EnvSnapshot): EnvAnalysis {
  const all = [...snapshot.machine, ...snapshot.user];
  const varMap = new Map<string, string>();
  // Kayit defterinde tanimli olmayan ama surecte bulunan degiskenler
  // (SystemRoot, USERPROFILE gibi) genisletmede kullanilir. Kayit
  // defteri degerleri bunlari EZER.
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') varMap.set(k.toLowerCase(), v);
  }
  for (const v of all) varMap.set(v.name.toLowerCase(), v.raw);

  const pathOf = (scope: EnvScope) =>
    (scope === 'user' ? snapshot.user : snapshot.machine).find((v) => v.name.toLowerCase() === 'path');

  const pathEntries: PathEntry[] = [];
  const seenByScope = new Map<EnvScope, Map<string, number>>();
  const effectiveSeen = new Map<string, number>();

  for (const scope of ['machine', 'user'] as const) {
    const v = pathOf(scope);
    if (!v) continue;
    const seen = new Map<string, number>();
    seenByScope.set(scope, seen);
    const raws = splitPathEntries(v.raw);
    raws.forEach((raw, index) => {
      const expanded = expandEnvValue(raw, varMap);
      const key = normDir(expanded);
      const localSeen = seen.get(key);
      const globalSeen = effectiveSeen.get(key);
      const entry: PathEntry = {
        scope,
        index,
        raw,
        expanded,
        exists: expanded.includes('%') ? true : envPathExists(expanded),
      };
      if (localSeen !== undefined) entry.duplicateOf = localSeen;
      if (globalSeen !== undefined) entry.shadowedBy = globalSeen;
      if (localSeen === undefined) seen.set(key, index);
      if (globalSeen === undefined) effectiveSeen.set(key, pathEntries.length);
      pathEntries.push(entry);
    });
  }

  const effectivePath = pathEntries.map((e) => e.expanded);
  const findings: EnvFinding[] = [];
  for (const e of pathEntries) {
    if (!e.exists) {
      findings.push({
        id: `missing:${e.scope}:${e.index}:${e.raw.toLowerCase()}`,
        kind: 'missing-path',
        scope: e.scope,
        variable: 'Path',
        value: e.raw,
        reason: 'PATH girdisi diskte yok; komut bulunamaz.',
        severity: 'warning',
      });
    }
    if (e.duplicateOf !== undefined) {
      findings.push({
        id: `dup:${e.scope}:${e.index}:${e.raw.toLowerCase()}`,
        kind: 'duplicate-path',
        scope: e.scope,
        variable: 'Path',
        value: e.raw,
        reason: `Ayni dizin ${e.scope} PATH icinde tekrar ediyor.`,
        severity: 'info',
      });
    }
  }

  const commandShadows = findCommandShadows(effectivePath);
  for (const s of commandShadows) {
    findings.push({
      id: `shadow:${s.command}:${s.winner.toLowerCase()}`,
      kind: 'shadowed-command',
      scope: 'user',
      variable: 'Path',
      value: `${s.command}: ${s.winner} -> ${s.shadowed.join(', ')}`,
      reason: 'Ayni komut birden fazla PATH dizininde; ilki calisir.',
      severity: 'warning',
    });
  }

  const expand = (v: string) => expandEnvValue(v, varMap);
  const orphanUser = findOrphanVariables(snapshot.user, envPathExists, expand);
  const orphanMachine = findOrphanVariables(snapshot.machine, envPathExists, expand);
  const orphanVariables = [...orphanMachine, ...orphanUser];
  for (const v of orphanVariables) {
    findings.push({
      id: `orphan:${v.scope}:${v.name.toLowerCase()}`,
      kind: 'orphan-variable',
      scope: v.scope,
      variable: v.name,
      value: v.display,
      reason: 'Degiskenin gosterdigi yol yok; kaldirilan aracdan kalmis olabilir.',
      severity: 'info',
    });
  }

  for (const v of all) {
    if (v.sensitive) {
      findings.push({
        id: `secret:${v.scope}:${v.name.toLowerCase()}`,
        kind: 'sensitive-variable',
        scope: v.scope,
        variable: v.name,
        value: '••••••',
        reason: 'Hassas deger; gosterilmez ve loglanmaz.',
        severity: 'info',
      });
    }
    if (v.raw.length === 0) {
      findings.push({
        id: `empty:${v.scope}:${v.name.toLowerCase()}`,
        kind: 'empty-variable',
        scope: v.scope,
        variable: v.name,
        value: '',
        reason: 'Bos degisken; yetim kayit olabilir.',
        severity: 'info',
      });
    }
  }

  return { snapshot, effectivePath, pathEntries, orphanVariables, commandShadows, findings };
}

/**
 * API/UI icin guvenli gorunum: hassas degiskenlerin HAM degeri cikarilir.
 * Plan uretimi icin ham snapshot gerekir; bu fonksiyon yalnizca disari
 * verilen kopyayi temizler.
 */
export function redactEnvironmentAnalysis(analysis: EnvAnalysis): EnvAnalysis {
  const clean = (v: EnvVariable): EnvVariable => ({
    ...v,
    raw: v.sensitive ? '' : v.raw,
    display: maskValue(v.name, v.raw),
  });
  return {
    ...analysis,
    snapshot: {
      ...analysis.snapshot,
      user: analysis.snapshot.user.map(clean),
      machine: analysis.snapshot.machine.map(clean),
    },
  };
}

export interface PathCleanupOptions {
  scope?: EnvScope | 'both';
  removeMissing?: boolean;
  removeDuplicates?: boolean;
  /**
   * Acik secim: yalnizca bu PATH girdileri kaldirilir (kimlik bicimi
   * `<scope>:<index>`). Verildiginde removeMissing/removeDuplicates yok sayilir.
   */
  removeEntries?: string[];
}

/** PATH temizligi icin DIFF uretir; hicbir sey yazmaz. */
export function planPathCleanup(analysis: EnvAnalysis, opts: PathCleanupOptions = {}): EnvPlan {
  const scope = opts.scope ?? 'user';
  const scopes: EnvScope[] = scope === 'both' ? ['user', 'machine'] : [scope];
  const changes: EnvChange[] = [];
  const warnings: string[] = [];

  const explicit = opts.removeEntries !== undefined;
  const removeSet = new Set(opts.removeEntries ?? []);

  for (const s of scopes) {
    const v = (s === 'user' ? analysis.snapshot.user : analysis.snapshot.machine).find(
      (x) => x.name.toLowerCase() === 'path',
    );
    if (!v) continue;
    const entries = analysis.pathEntries.filter((e) => e.scope === s);
    const keep = entries.filter((e) => {
      if (explicit) return !removeSet.has(`${e.scope}:${e.index}`);
      if (opts.removeMissing !== false && !e.exists) return false;
      if (opts.removeDuplicates !== false && e.duplicateOf !== undefined) return false;
      return true;
    });
    const after = keep.map((e) => e.raw).join(';');
    if (after === v.raw) continue;
    changes.push({
      scope: s,
      name: 'Path',
      type: v.type === 'REG_EXPAND_SZ' ? 'REG_EXPAND_SZ' : 'REG_SZ',
      before: v.raw,
      after,
      reason: explicit
        ? 'secilen PATH girdileri'
        : [
            opts.removeMissing !== false ? 'olmayan dizinler' : '',
            opts.removeDuplicates !== false ? 'tekrarlar' : '',
          ]
            .filter(Boolean)
            .join(' + '),
    });
  }

  if (scope !== 'user') {
    warnings.push('Machine (HKLM) PATH degisikligi yonetici hakki ister; yoksa yalnizca oneri kalir.');
  }
  return {
    changes,
    requiresAdmin: changes.some((c) => c.scope === 'machine'),
    warnings,
    empty: changes.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Windows kayit defteri I/O
// ---------------------------------------------------------------------------

const run = promisify(execFile);

async function reg(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run('reg', args, {
      timeout: 15_000,
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, stdout, stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? String(err) };
  }
}

async function queryKey(key: string, scope: EnvScope): Promise<EnvVariable[]> {
  const r = await reg(['query', key]);
  if (!r.ok) return [];
  return parseRegEnvironment(r.stdout, scope);
}

/** HKCU + HKLM ortam degiskenlerini okur. Hassas degerler maskelenir. */
export async function readEnvironmentSnapshot(): Promise<EnvSnapshot> {
  if (process.platform !== 'win32') {
    return { user: [], machine: [], note: 'Ortam degiskenleri yalnizca Windows kayit defterinde okunur' };
  }
  const [user, machine] = await Promise.all([queryKey(USER_KEY, 'user'), queryKey(MACHINE_KEY, 'machine')]);
  return {
    user,
    machine,
    note:
      user.length === 0 && machine.length === 0
        ? 'Kayit defteri okunamadi; ortam degiskenleri bilinmiyor'
        : undefined,
  };
}

/** Kayit defteri deger tipi: mevcut tip korunur, yoksa %VAR% iceren PATH expand olur. */
export async function currentValue(
  scope: EnvScope,
  name: string,
): Promise<{ exists: boolean; raw: string; type: RegistryType }> {
  const key = scope === 'user' ? USER_KEY : MACHINE_KEY;
  const vars = await queryKey(key, scope);
  const v = vars.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return v ? { exists: true, raw: v.raw, type: v.type } : { exists: false, raw: '', type: 'REG_SZ' };
}

export interface EnvBackup {
  version: 1;
  at: number;
  reason: string;
  entries: Array<{ scope: EnvScope; name: string; type: RegistryType; before: string | null }>;
}

export async function backupEnvironment(
  changes: EnvChange[],
  reason = 'env plan',
): Promise<string> {
  const dir = join(dataDir(), 'env-backups');
  await mkdir(longPath(dir), { recursive: true });
  const file = join(dir, `env-${Date.now()}.json`);
  const body: EnvBackup = {
    version: 1,
    at: Date.now(),
    reason,
    entries: changes.map((c) => ({
      scope: c.scope,
      name: c.name,
      type: c.type,
      before: c.before,
    })),
  };
  await writeFile(longPath(file), JSON.stringify(body, null, 2), 'utf8');
  return file;
}

async function isElevated(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  const script =
    "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)";
  const r = await run(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeout: 10_000, windowsHide: true, encoding: 'utf8' },
  ).catch(() => null);
  if (!r) return false;
  return String((r as { stdout?: string }).stdout ?? '').trim().toLowerCase() === 'true';
}

async function broadcastEnvironmentChange(): Promise<void> {
  if (process.platform !== 'win32') return;
  const script = [
    "Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition '[DllImport(\"user32.dll\", SetLastError=true, CharSet=CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);'",
    '$r=[UIntPtr]::Zero',
    "[Win32.NativeMethods]::SendMessageTimeout([IntPtr]0xffff,0x001A,[UIntPtr]::Zero,'Environment',2,5000,[ref]$r) | Out-Null",
  ].join('; ');
  await run(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeout: 10_000, windowsHide: true, encoding: 'utf8' },
  ).catch(() => undefined);
}

async function writeValue(
  scope: EnvScope,
  name: string,
  value: string,
  type: RegistryType,
): Promise<void> {
  const key = scope === 'user' ? USER_KEY : MACHINE_KEY;
  const r = await reg(['add', key, '/v', name, '/t', type, '/d', value, '/f']);
  if (!r.ok) throw new Error(r.stderr.trim() || `reg add basarisiz (${name})`);
}

async function deleteValue(scope: EnvScope, name: string): Promise<void> {
  const key = scope === 'user' ? USER_KEY : MACHINE_KEY;
  const r = await reg(['delete', key, '/v', name, '/f']);
  if (!r.ok && !/bulunamadi|not find|cannot find/i.test(r.stderr)) {
    throw new Error(r.stderr.trim() || `reg delete basarisiz (${name})`);
  }
}

/**
 * Plani uygular. Sira:
 *   onay -> yetki -> YEDEK -> yaz -> (hata varsa geri al) -> broadcast.
 * Machine degisikligi yonetici yoksa HIC yazilmaz.
 */
export async function applyEnvPlan(
  plan: EnvPlan,
  opts: { phrase: string; reason?: string } = { phrase: '' },
): Promise<EnvApplyResult> {
  const result: EnvApplyResult = {
    ok: false,
    applied: 0,
    failed: 0,
    backupFile: null,
    requiresAdmin: plan.requiresAdmin,
    errors: [],
  };
  if (!ApprovalRules.matches('envClean', opts.phrase)) {
    result.errors.push({
      name: '*',
      scope: 'user',
      reason: `Onay ifadesi hatali (${ENV_CLEAN_PHRASE})`,
    });
    result.failed++;
    return result;
  }
  if (plan.empty) {
    result.ok = true;
    return result;
  }
  if (plan.requiresAdmin && process.platform === 'win32' && !(await isElevated())) {
    result.errors.push({
      name: 'Path',
      scope: 'machine',
      reason: 'Machine (HKLM) degisikligi icin yonetici hakki gerekli; yalnizca oneri.',
    });
    result.failed++;
    return result;
  }

  result.backupFile = await backupEnvironment(plan.changes, opts.reason ?? 'env cleanup');
  info('ortam degisikligi yedeklendi', { backup: result.backupFile });

  const done: EnvChange[] = [];
  for (const c of plan.changes) {
    try {
      if (c.after === null) {
        await deleteValue(c.scope, c.name);
        const check = await currentValue(c.scope, c.name);
        if (check.exists) throw new Error('dogrulama: degisken hala kayitli');
      } else {
        const type: RegistryType =
          c.type === 'REG_EXPAND_SZ' || c.after.includes('%') ? 'REG_EXPAND_SZ' : 'REG_SZ';
        await writeValue(c.scope, c.name, c.after, type);
        const check = await currentValue(c.scope, c.name);
        if (!check.exists || check.raw !== c.after) {
          throw new Error('dogrulama: yazilan deger geri okunamadi');
        }
      }
      done.push(c);
      result.applied++;
    } catch (err) {
      result.failed++;
      result.errors.push({ name: c.name, scope: c.scope, reason: (err as Error).message });
      logError('ortam degiskeni yazilamadi', { name: c.name, scope: c.scope, err: (err as Error).message });
      // Geri al: bu planla yazilanlari onceki degerine dondur.
      for (const d of done.reverse()) {
        try {
          if (d.before === null) await deleteValue(d.scope, d.name);
          else await writeValue(d.scope, d.name, d.before, d.type);
        } catch {
          warn('ortam geri alma basarisiz', { name: d.name, scope: d.scope });
        }
      }
      break;
    }
  }

  if (result.applied > 0) await broadcastEnvironmentChange();
  result.ok = result.failed === 0;
  return result;
}

/** Yedekten geri yukler (plan/onay gerektirmez; yedek zaten acik eylem). */
export async function restoreEnvironmentBackup(file: string): Promise<EnvApplyResult> {
  const result: EnvApplyResult = {
    ok: false,
    applied: 0,
    failed: 0,
    backupFile: file,
    requiresAdmin: false,
    errors: [],
  };
  let backup: EnvBackup;
  try {
    backup = JSON.parse(await readFile(longPath(file), 'utf8')) as EnvBackup;
  } catch (err) {
    result.errors.push({ name: '*', scope: 'user', reason: (err as Error).message });
    result.failed++;
    return result;
  }
  for (const e of backup.entries ?? []) {
    try {
      if (e.before === null) await deleteValue(e.scope, e.name);
      else await writeValue(e.scope, e.name, e.before, e.type);
      result.applied++;
    } catch (err) {
      result.failed++;
      result.errors.push({ name: e.name, scope: e.scope, reason: (err as Error).message });
    }
  }
  if (result.applied > 0) await broadcastEnvironmentChange();
  result.ok = result.failed === 0;
  return result;
}

/** CLI/API icin tek cagri: oku -> analiz -> plan. */
export async function buildEnvCleanupPlan(opts: PathCleanupOptions = {}): Promise<{
  analysis: EnvAnalysis;
  plan: EnvPlan;
}> {
  const snapshot = await readEnvironmentSnapshot();
  const analysis = analyzeEnvironment(snapshot);
  const plan = planPathCleanup(analysis, opts);
  return { analysis, plan };
}
