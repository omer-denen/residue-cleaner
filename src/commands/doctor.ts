import { stat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { longPath } from '../util/longpath.ts';
import { formatBytes } from '../util/format.ts';
import { detectGpu } from '../core/analyze.ts';
import { walk } from '../core/walker.ts';

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
  cyan: '\x1b[36m', gray: '\x1b[90m',
};

interface Check {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
}

/** Ortam kontrolu: Residue'in bu makinede dogru calisip calismadigini dogrular. */
export async function runDoctor(): Promise<void> {
  const checks: Check[] = [];
  const env = process.env;

  // --- Node surumu (uzun yol + TS desteği icin >=22.6) ---
  const major = Number(process.versions.node.split('.')[0]);
  checks.push({
    name: 'Node surumu',
    status: major >= 22 ? 'ok' : 'fail',
    detail: `${process.versions.node} ${major >= 22 ? '' : '(22.6+ gerekli)'}`,
  });

  // --- Kritik ortam degiskenleri ---
  const required: Array<[string, string | undefined]> = [
    ['USERPROFILE', env.USERPROFILE],
    ['LOCALAPPDATA', env.LOCALAPPDATA],
    ['APPDATA', env.APPDATA],
  ];
  for (const [k, v] of required) {
    checks.push({
      name: k,
      status: v ? 'ok' : 'fail',
      detail: v ?? 'TANIMLI DEGIL — tarama calismaz',
    });
  }

  // --- Uzun yol (MAX_PATH) ---
  // Gercek bir test: gomulu bir yol olusturup erisimi dene
  const longTest = await testLongPath();
  checks.push({
    name: 'Uzun yol (MAX_PATH)',
    status: longTest.ok ? 'ok' : 'warn',
    detail: longTest.detail,
  });

  // --- Geri donusum kutusu erisimi ---
  const recycle = await testRecycleAccess();
  checks.push({
    name: 'Geri donusum kutusu',
    status: recycle.status,
    detail: recycle.detail,
  });

  // --- GPU ---
  // E10c: detectGpu artik UCLU durum dondurer. null (erisim engellendi)
  // "yok" DEGILDIR: "bilinmiyor" olarak gosterilir, "yok" denmez.
  const gpu = await detectGpu();
  checks.push({
    name: 'GPU hizlandirma',
    status: gpu === null ? 'warn' : gpu.hasNvidia ? 'ok' : 'warn',
    detail:
      gpu === null
        ? 'NVIDIA durumu bilinmiyor (erisim engellendi; kanit toplanamadi)'
        : gpu.hasNvidia
          ? 'NVIDIA CUDA surucusu bulundu'
          : gpu.note,
  });

  // --- Disk boslugu ---
  const disk = await testDiskSpace();
  checks.push({
    name: 'Disk boslugu',
    status: disk.status,
    detail: disk.detail,
  });

  // --- Guncelleyici artiklari ---
  const updaters = await findUpdaterLeftovers();
  checks.push({
    name: 'Guncelleyici artiklari',
    status: updaters.length === 0 ? 'ok' : 'warn',
    detail:
      updaters.length === 0
        ? 'Bulunamadi'
        : `${updaters.length} adet, toplam ${formatBytes(updaters.reduce((a, b) => a + b.bytes, 0))}`,
  });

  // --- Rapora yaz ---
  console.log(`\n${C.bold}Residue — ortam kontrolu${C.reset}\n`);
  for (const c of checks) {
    const mark = c.status === 'ok' ? `${C.green}${C.bold}v${C.reset}` : c.status === 'warn' ? `${C.yellow}${C.bold}!${C.reset}` : `${C.red}${C.bold}x${C.reset}`;
    console.log(`  ${mark} ${c.name.padEnd(22)} ${C.gray}${c.detail}${C.reset}`);
  }

  const upd = await findUpdaterLeftovers();
  if (upd.length > 0) {
    console.log(`\n${C.bold}Bulunan guncelleyici artiklari:${C.reset}`);
    for (const u of upd) {
      console.log(`  ${C.cyan}->${C.reset} ${u.path.replace(env.LOCALAPPDATA ?? '', '%LOCALAPPDATA%')}  ${C.gray}${formatBytes(u.bytes)}${C.reset}`);
    }
  }

  const fails = checks.filter((c) => c.status === 'fail').length;
  console.log('');
  if (fails > 0) {
    console.log(`${C.red}${fails} kontrol basarisiz.${C.reset}\n`);
  } else {
    console.log(`${C.green}Tum kontroller gecti.${C.reset}\n`);
  }
}

async function testLongPath(): Promise<{ ok: boolean; detail: string }> {
  const base = process.env.LOCALAPPDATA ?? process.env.TEMP ?? '.';
  // ~300 karakterlik yol uret
  const deep = Array.from({ length: 12 }, (_, i) => `seviye${i}`.padEnd(24, 'x')).join('\\');
  const p = `${base}\\residue-test\\${deep}\\probe.txt`;
  try {
    const { mkdir, writeFile, rm } = await import('node:fs/promises');
    await mkdir(longPath(p.slice(0, p.lastIndexOf('\\'))), { recursive: true });
    await writeFile(longPath(p), 'x', 'utf8');
    await rm(longPath(`${base}\\residue-test`), { recursive: true, force: true });
    return { ok: true, detail: `${p.length} karakterlik yol erisilebilir` };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return {
      ok: false,
      detail: `${e.code ?? 'hata'}: cok uzun yollar atlanabilir`,
    };
  }
}

async function testRecycleAccess(): Promise<{ status: 'ok' | 'warn' | 'fail'; detail: string }> {
  // Geri donusum kutusunun KONUMU degil, API'si test edilir.
  // Daha once hatali bir cagri (GetSpecialFolderOption) kullanildi;
  // dogru yontem DeleteDirectory/DeleteFile uzerinden bir dosya
  // gonderip cagrinin calisip calismadigini olcmek.
  const tmp = join(process.env.TEMP ?? '.', `residue-recycle-probe-${Date.now()}.tmp`);
  try {
    const { writeFile, rm } = await import('node:fs/promises');
    const { longPath } = await import('../util/longpath.ts');
    await writeFile(longPath(tmp), 'probe', 'utf8');

    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    const ps = `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName Microsoft.VisualBasic
$p = '${tmp.replace(/'/g, "''")}'
try {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
    $p, 'OnlyErrorDialogs', 'SendToRecycleBin')
  Write-Output 'OK'
} catch {
  Write-Output ('ERR:' + $_.Exception.GetType().Name)
}
`;
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      timeout: 30_000,
    });

    if (stdout.includes('OK')) {
      return { status: 'ok', detail: 'Geri donusum kutusuna gonderiliyor (geri alinabilir)' };
    }
    await rm(longPath(tmp), { force: true }).catch(() => {});
    return { status: 'warn', detail: `Geri donusum kutusu kullanilamiyor: ${stdout.trim().slice(0, 50)} — --purge kullanin` };
  } catch (err) {
    return { status: 'warn', detail: `PowerShell erisimi yok: ${String(err).slice(0, 50)}` };
  }
}

async function testDiskSpace(): Promise<{ status: 'ok' | 'warn' | 'fail'; detail: string }> {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    const { stdout } = await exec(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', "Get-PSDrive C | Select-Object -ExpandProperty Free"],
      { timeout: 20_000 },
    );
    const free = Number(stdout.trim());
    const gb = free / 1024 ** 3;
    if (gb < 10) return { status: 'fail', detail: `C: sadece ${gb.toFixed(1)} GB bos` };
    if (gb < 30) return { status: 'warn', detail: `C: ${gb.toFixed(1)} GB bos` };
    return { status: 'ok', detail: `C: ${gb.toFixed(1)} GB bos` };
  } catch {
    return { status: 'warn', detail: 'Okunamadi' };
  }
}

async function findUpdaterLeftovers(): Promise<Array<{ path: string; bytes: number }>> {
  const local = process.env.LOCALAPPDATA ?? '';
  const out: Array<{ path: string; bytes: number }> = [];
  if (!local) return out;
  try {
    const ents = await readdir(longPath(local), { withFileTypes: true });
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      if (!/-updater$|^updater$/i.test(e.name)) continue;
      const p = `${local}\\${e.name}`;
      // Dizin olcegi (stat.size) yalnizca dizin kaydi icindir (0).
      // Gercek icerik icin yuruyucu gerekir.
      const w = await walk({ root: p, largeThreshold: Infinity, maxLarge: 0 });
      out.push({ path: p, bytes: w.bytes });
    }
  } catch {
    /* yoksay */
  }
  return out;
}

void readFile;