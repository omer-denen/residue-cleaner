import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { longPath } from '../util/longpath.ts';
import type { CliReference, CliTool } from './cli-inventory-types.ts';

/**
 * Kaldirma oncesi referans kontrolu (T33).
 *
 * Bir CLI araci "atil" gorunebilir ama baska bir yerden hala
 * kullaniliyor olabilir:
 *   - calisan bir surec (ornek: arka plan ajan oturumu),
 *   - proje/IDE yapilandirmasi (MCP, gorev, package.json scripts),
 *   - masaustu kisayolu,
 *   - zamanlanmis gorev.
 *
 * Bu modul SALT OKUNUR'dur: hicbir dosyaya yazmaz, surec oldurmez,
 * gorev degistirmez. Bulunan referanslar kaldirma GUVENINI dusurur ve
 * plan ekraninda "once bunu kapat/kaldir" notu olarak gorunur.
 *
 * Tarama sinirlidir: dosya boyutu, aday sayisi ve dizin sayisi ustel
 * sinirlarla kapatilir; dosya basina surec ACILMAZ (tek PowerShell /
 * tek schtasks cagrisi).
 */

const MAX_FILE = 256 * 1024;
const MAX_CANDIDATES = 120;
const MAX_DIRS = 40;
const MAX_REFS = 8;

export interface ProcessInfo {
  name: string;
  commandLine: string;
}

export interface ReferenceScanOptions {
  roots?: string[];
  processes?: ProcessInfo[];
  /** Test icin: schtasks CSV ciktisi. Verilmezse komut bir kez calisir. */
  scheduledCsv?: string;
  env?: NodeJS.ProcessEnv;
}

function norm(p: string): string {
  return p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

function tokenRe(command: string): RegExp {
  const esc = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z0-9_.-])${esc}(?![a-z0-9_.-])`, 'i');
}

/** Bir aracin adi/kurulum yolu metinde geciyor mu? */
function textMentions(tool: CliTool, text: string): boolean {
  if (tokenRe(tool.command).test(text)) return true;
  const install = norm(tool.installPath);
  return install.length > 3 && text.toLowerCase().includes(install);
}

/**
 * Calisan sureclerle araclari eslestirir. Saf fonksiyon: test edilebilir.
 *
 * Yalnizca surec ADI (`foo.exe`) veya komut satirindaki kurulum/shim
 * yolu eslesir; `node.exe` gibi genel surecler tek basina kanit sayilmaz.
 */
export function matchProcesses(
  tools: CliTool[],
  processes: ProcessInfo[],
): Map<string, CliReference[]> {
  const out = new Map<string, CliReference[]>();
  for (const t of tools) {
    if (t.status === 'protected') continue;
    const cmd = t.command.toLowerCase();
    const install = norm(t.installPath);
    // Kurulum yolu bir dosya ise (standalone .exe) klasoru; npm globalde
    // installPath zaten paket klasorudur. Surec, bu klasorun altindan
    // calisiyorsa referanstir.
    const isFile = /\.[a-z0-9]+$/i.test(t.installPath);
    const installDir = isFile ? norm(dirname(t.installPath)) : install;
    const shims = t.shims.map(norm).filter((s) => s.length > 3);

    for (const p of processes) {
      const name = (p.name ?? '').toLowerCase();
      const line = (p.commandLine ?? '').toLowerCase();
      const byName = name === `${cmd}.exe` || name === cmd;
      const byPath = install.length > 3 && line.includes(install);
      const byDir = installDir.length > 3 && line.includes(installDir + '\\');
      const byShim = shims.some((s) => line.includes(s));
      if (!byName && !byPath && !byDir && !byShim) continue;
      const detail = `calisan surec: ${p.name}${p.commandLine ? ` - ${p.commandLine.slice(0, 140)}` : ''}`;
      const list = out.get(t.id) ?? [];
      list.push({ kind: 'process', path: p.name, detail });
      out.set(t.id, list);
      break; // ayni arac icin tek surec kaniti yeterli
    }
  }
  return out;
}

/**
 * Yapilandirma dosyalarini tarar: .mcp.json / *mcp*.json / tasks.json /
 * package.json (scripts). Sinirli aday listesi; dosya basina surec yok.
 */
export async function scanConfigReferences(
  tools: CliTool[],
  roots: string[],
): Promise<Map<string, CliReference[]>> {
  const out = new Map<string, CliReference[]>();
  const files: Array<{ path: string; shortcut: boolean }> = [];
  const seen = new Set<string>();

  const addFile = (p: string, shortcut = false) => {
    const key = norm(p);
    if (seen.has(key) || files.length >= MAX_CANDIDATES) return;
    seen.add(key);
    files.push({ path: p, shortcut });
  };

  for (const root of roots) {
    let ents;
    try {
      ents = await readdir(longPath(root), { withFileTypes: true });
    } catch {
      continue;
    }
    let dirs = 0;
    for (const e of ents) {
      const full = join(root, e.name);
      if (e.isFile()) {
        if (/^(\.mcp\.json|.*mcp.*\.json|tasks\.json|package\.json)$/i.test(e.name)) addFile(full);
        else if (/\.lnk$/i.test(e.name)) addFile(full, true);
        continue;
      }
      if (!e.isDirectory() || dirs >= MAX_DIRS) continue;
      dirs++;
      let kids;
      try {
        kids = await readdir(longPath(full), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const k of kids) {
        if (k.isFile() && /^(\.mcp\.json|.*mcp.*\.json|tasks\.json|package\.json)$/i.test(k.name)) {
          addFile(join(full, k.name));
          continue;
        }
        // Editor gorev dosyasi ikinci seviyede olabilir: herhangi bir alt
        // dizindeki tasks.json "gorev referansi" sayilir; klasor adindan
        // bagimsiz aranir (editor adi kanit degildir). Bu, onceki
        //(urun belirli) kontrol ile ayni derinligi kapsar ve genisletir.
        if (k.isDirectory()) {
          const tasks = join(full, k.name, 'tasks.json');
          try {
            if ((await stat(longPath(tasks))).isFile()) addFile(tasks);
          } catch {
            /* yok */
          }
        }
      }
    }
  }

  for (const f of files) {
    let buf: Buffer;
    try {
      const st = await stat(longPath(f.path));
      if (!st.isFile() || st.size > MAX_FILE) continue;
      buf = await readFile(longPath(f.path));
    } catch {
      continue;
    }
    // .lnk ikilisi hem ANSI hem UTF-16 metin tasiyabilir.
    const text = f.shortcut
      ? `${buf.toString('latin1')}\n${buf.toString('utf16le')}`
      : buf.toString('utf8');

    for (const t of tools) {
      if (t.status === 'protected') continue;
      if (!textMentions(t, text)) continue;
      const list = out.get(t.id) ?? [];
      list.push({
        kind: f.shortcut ? 'shortcut' : 'config',
        path: f.path,
        detail: f.shortcut
          ? `kisayol araci calistiriyor: ${t.command}`
          : `yapilandirma referansi: ${f.path.split('\\').slice(-2).join('\\')}`,
      });
      out.set(t.id, list);
    }
  }
  return out;
}

/** schtasks /query /fo csv ciktisindan gorev referanslari (saf fonksiyon). */
export function parseScheduledTaskRefs(
  tools: CliTool[],
  csv: string,
): Map<string, CliReference[]> {
  const out = new Map<string, CliReference[]>();
  for (const line of csv.split(/\r?\n/)) {
    if (!line.trim()) continue;
    // schtasks CSV: "HostName","TaskName",... — gorev adi IKINCI alan.
    const name =
      /^"[^"]*","([^"]*)"/.exec(line)?.[1] ??
      /^"([^"]*)"/.exec(line)?.[1] ??
      'gorev';
    for (const t of tools) {
      if (t.status === 'protected') continue;
      if (!textMentions(t, line)) continue;
      const list = out.get(t.id) ?? [];
      list.push({
        kind: 'scheduled-task',
        path: name,
        detail: `zamanlanmis gorev araci cagiriyor: ${t.command}`,
      });
      out.set(t.id, list);
    }
  }
  return out;
}

async function scanProcesses(): Promise<ProcessInfo[]> {
  const run = promisify(execFile);
  try {
    const { stdout } = await run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object Name,CommandLine | ConvertTo-Json -Compress',
      ],
      { timeout: 12_000, windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout.trim() || '[]') as unknown;
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((x) => ({
        name: typeof x.Name === 'string' ? x.Name : '',
        commandLine: typeof x.CommandLine === 'string' ? x.CommandLine : '',
      }))
      .filter((p) => p.name);
  } catch {
    return [];
  }
}

async function scanScheduledTasks(): Promise<string> {
  const run = promisify(execFile);
  try {
    const { stdout } = await run('schtasks', ['/query', '/fo', 'csv', '/v'], {
      timeout: 12_000,
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return '';
  }
}

function merge(into: Map<string, CliReference[]>, from: Map<string, CliReference[]>): void {
  for (const [id, refs] of from) {
    const cur = into.get(id) ?? [];
    cur.push(...refs);
    into.set(id, cur);
  }
}

const KIND_LABEL = {
  process: 'surec',
  config: 'yapilandirma',
  shortcut: 'kisayol',
  'scheduled-task': 'gorev',
} as const;

/**
 * Referanslari araclara isler: kanit satiri ekler, guveni dusurur.
 * Silme hedefi URETMEZ; yalnizca plan/onay ekranina uyari tasir.
 */
export async function annotateReferences(
  tools: CliTool[],
  opts: ReferenceScanOptions = {},
): Promise<void> {
  const active = tools.filter((t) => t.status !== 'protected');
  if (active.length === 0) return;

  const refs = new Map<string, CliReference[]>();
  merge(refs, matchProcesses(active, opts.processes ?? (await scanProcesses())));

  const env = opts.env ?? process.env;
  const roots =
    opts.roots ??
    [
      env.USERPROFILE ?? env.HOME ?? '',
      env.APPDATA ?? '',
      join(env.USERPROFILE ?? env.HOME ?? '', 'Desktop'),
      join(env.PUBLIC ?? 'C:\\Users\\Public', 'Desktop'),
      join(env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    ].filter(Boolean);

  merge(refs, await scanConfigReferences(active, roots));
  merge(
    refs,
    parseScheduledTaskRefs(
      active,
      opts.scheduledCsv ?? (process.platform === 'win32' ? await scanScheduledTasks() : ''),
    ),
  );

  for (const t of active) {
    const found = refs.get(t.id);
    if (!found || found.length === 0) continue;

    // Tekrarlari at; ayni dosya/surec iki kez yazilmasin.
    const unique: CliReference[] = [];
    const seen = new Set<string>();
    for (const r of found) {
      const k = `${r.kind}:${norm(r.path)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      unique.push(r);
    }

    t.references = unique.slice(0, MAX_REFS);
    for (const r of t.references.slice(0, 3)) {
      t.evidence.push(`referans (${KIND_LABEL[r.kind]}): ${r.path}`);
    }

    if (unique.some((r) => r.kind === 'process')) {
      // Arac su an calisiyor: "atil" etiketi yaniltici olur.
      if (t.status === 'unused') t.status = 'unknown';
      t.confidence = 'low';
      t.evidence.push('kaldirmadan once calisan sureci kapat');
    } else if (t.confidence === 'high') {
      t.confidence = 'medium';
      t.evidence.push('kaldirmadan once referanslari kaldir');
    } else {
      t.evidence.push('kaldirmadan once referanslari kaldir');
    }
  }
}
