/**
 * NORMALIZASYON SOZLESMESI (parity testleri)
 *
 * Esit sayilan:
 *  - kume anahtari dizisi (sira dahil)
 *  - her kume icin totalBytes, reclaimableBytes
 *  - her kume icin deleteTargets YOL KUMESI (sira bagimsiz)
 *  - verdict.kind (CLI) / verdictKind (API)
 *
 * Kapsam disi (zamana duyarli / adaptore ozgu):
 *  - status, idleDays, confidence, evidence, lastAccessAt
 *  - tarama damgasi (scan.at), istatistikler, sayac gorunumleri
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile, utimes } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { ApprovalRules } from '../src/core/approval.ts';

let sandbox = '';
let server: any;
let base = '';
let token = '';

const originalEnv: Record<string, string | undefined> = {};

/**
 * Sandbox'a tasinan ortam degiskenleri. `npm_config_prefix` da dahildir:
 * testler `npm test` ile calistiginda npm bu degiskeni gercek global prefix'e
 * isaret edecek sekilde enjekte eder; CLI cocuk sureci `npm_*` degiskenlerini
 * temizledigi icin adaptorler arasinda fark olusurdu (PARITY-03).
 */
const SANDBOX_KEYS = [
  'LOCALAPPDATA',
  'APPDATA',
  'USERPROFILE',
  'HOME',
  'TEMP',
  'TMP',
  'PATH',
  'npm_config_prefix',
  'NPM_CONFIG_PREFIX',
];

function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-9;]*m/g, '');
}

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const env: Record<string, string | undefined> = { ...process.env };
    for (const k of Object.keys(env)) {
      const up = k.toUpperCase();
      if (
        up.startsWith('RESIDUE_') ||
        up.startsWith('CLICLEANER_') ||
        up.startsWith('NPM_') ||
        up.startsWith('npm_'.toUpperCase())
      ) {
        delete env[k];
      }
    }
    env.LOCALAPPDATA = join(sandbox, 'la');
    env.APPDATA = join(sandbox, 'roaming');
    env.USERPROFILE = join(sandbox, 'home');
    env.HOME = join(sandbox, 'home');
    env.TEMP = join(sandbox, 'temp');
    env.TMP = join(sandbox, 'temp');
    env.PATH = dirname(process.execPath);

    const child = spawn(process.execPath, ['bin/residue.mjs', ...args], {
      cwd: process.cwd(),
      env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('CLI zaman asimi (60s)'));
    }, 60000);
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

async function waitForScanDone(base: string, token: string): Promise<void> {
  for (let i = 0; i < 1200; i++) {
    const st = await (await fetch(`${base}/api/scan/status`, {
      headers: { 'x-residue-token': token },
    })).json() as { scanning: boolean };
    if (!st.scanning) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('tarama zaman asimi');
}

function normalizePath(p: string): string {
  let s = p.trim();
  if (s.startsWith('\\\\?\\')) s = s.slice(4);
  while (s.length > 1 && s.endsWith('\\')) s = s.slice(0, -1);
  return s;
}

before(async () => {
  for (const k of SANDBOX_KEYS) {
    originalEnv[k] = process.env[k];
    delete process.env[k];
  }

  sandbox = await mkdtemp(join(tmpdir(), 'residue-parity-'));

  process.env.LOCALAPPDATA = join(sandbox, 'la');
  process.env.APPDATA = join(sandbox, 'roaming');
  process.env.USERPROFILE = join(sandbox, 'home');
  process.env.HOME = join(sandbox, 'home');
  process.env.TEMP = join(sandbox, 'temp');
  process.env.TMP = join(sandbox, 'temp');
  process.env.PATH = dirname(process.execPath);

  await mkdir(join(sandbox, 'la'), { recursive: true });
  await mkdir(join(sandbox, 'roaming', 'npm', 'node_modules', 'ornek-arac'), { recursive: true });
  await mkdir(join(sandbox, 'home'), { recursive: true });
  await mkdir(join(sandbox, 'temp', 'app-cache', 'GPUCache'), { recursive: true });
  await mkdir(join(sandbox, 'proj', 'cache', 'GPUCache'), { recursive: true });

  await writeFile(
    join(sandbox, 'proj', 'cache', 'CACHEDIR.TAG'),
    'Signature: 8a477f597d28d172789f06886806bc55',
  );
  await writeFile(join(sandbox, 'proj', 'cache', 'GPUCache', 'data_0'), Buffer.alloc(2048));

  await writeFile(
    join(sandbox, 'temp', 'app-cache', 'CACHEDIR.TAG'),
    'Signature: 8a477f597d28d172789f06886806bc55',
  );
  await writeFile(join(sandbox, 'temp', 'app-cache', 'GPUCache', 'data_0'), Buffer.alloc(4096));
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  await utimes(join(sandbox, 'temp', 'app-cache', 'GPUCache', 'data_0'), tenDaysAgo, tenDaysAgo);
  await utimes(join(sandbox, 'temp', 'app-cache', 'GPUCache'), tenDaysAgo, tenDaysAgo);

  await writeFile(
    join(sandbox, 'roaming', 'npm', 'node_modules', 'ornek-arac', 'package.json'),
    '{"name":"ornek-arac","version":"1.2.3","bin":{"ornek-arac":"cli.js"}}',
  );
  await writeFile(join(sandbox, 'roaming', 'npm', 'node_modules', 'ornek-arac', 'cli.js'), "console.log('x');\n");
  await writeFile(join(sandbox, 'roaming', 'npm', 'ornek-arac.cmd'), '@echo off\r\n');

  const { createApiServer } = await import('../src/web/server.ts');
  const created = createApiServer({ persistScan: false, envs: [] });
  server = created.server;
  token = created.token;
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  const addr = server.address();
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>((ok) => server.close(() => ok()));
  }
  if (sandbox) await rm(sandbox, { recursive: true, force: true });

  for (const k of SANDBOX_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

test('PARITY-01 — env kapsamli sistem taramasi (temp)', async () => {
  // CLI
  const cli = await runCli(['scan', '--json', '--quiet', '--env', 'temp']);
  assert.equal(cli.code, 0, `CLI exit ${cli.code}: ${cli.stderr}`);
  const cliParsed = JSON.parse(cli.stdout.trim()) as {
    clusters: Array<{
      key: string;
      totalBytes: number;
      reclaimableBytes: number;
      verdict: { kind: string };
      deleteTargets: Array<{ path: string }>;
    }>;
  };

  // API
  const scanRes = await fetch(`${base}/api/scan`, {
    method: 'POST',
    headers: { 'x-residue-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ envs: ['temp'] }),
  });
  assert.ok(scanRes.status === 202 || scanRes.status === 200, `scan status ${scanRes.status}`);
  await waitForScanDone(base, token);

  const disk = await (await fetch(`${base}/api/disk`, {
    headers: { 'x-residue-token': token },
  })).json() as {
    clusters: Array<{
      key: string;
      totalBytes: number;
      reclaimableBytes: number;
      verdictKind: string;
      targetCount: number;
    }>;
  };

  // deleteTargets yol kumesi API tarafindan /api/latest uzerinden alinir
  // (tam Cluster, hedef yollarini icerir).
  const latest = await (await fetch(`${base}/api/latest`, {
    headers: { 'x-residue-token': token },
  })).json() as {
    scan: { clusters: Array<{ key: string; deleteTargets: Array<{ path: string }> }> } | null;
  };
  const apiDeleteTargetsByKey = new Map<string, string[]>();
  for (const c of latest.scan?.clusters ?? []) {
    apiDeleteTargetsByKey.set(
      c.key,
      (c.deleteTargets ?? []).map((t) => normalizePath(t.path)),
    );
  }

  const cliKeys = cliParsed.clusters.map((c) => c.key);
  const apiKeys = disk.clusters.map((c) => c.key);
  assert.deepEqual(cliKeys, apiKeys, 'kume anahtari dizisi esit olmali');

  for (let i = 0; i < cliParsed.clusters.length; i++) {
    const c = cliParsed.clusters[i]!;
    const d = disk.clusters[i]!;
    assert.equal(c.totalBytes, d.totalBytes, 'totalBytes');
    assert.equal(c.reclaimableBytes, d.reclaimableBytes, 'reclaimableBytes');
    assert.equal(c.verdict.kind, d.verdictKind, 'verdict kind');
    const cliPaths = (c.deleteTargets ?? []).map((t) => normalizePath(t.path)).sort();
    const apiPaths = (apiDeleteTargetsByKey.get(c.key) ?? []).slice().sort();
    assert.deepEqual(cliPaths, apiPaths, `${c.key} deleteTargets yol kumesi`);
  }

  // Her iki tarafta en az bir deleteTarget (bos esitlik kanit sayilmaz)
  const cliTotalTargets = cliParsed.clusters.reduce(
    (n, c) => n + (c.deleteTargets?.length ?? 0),
    0,
  );
  assert.ok(cliTotalTargets >= 1, 'CLI: en az bir deleteTarget olmali');
  const apiTotalTargets = disk.clusters.reduce((n, c) => n + (c.targetCount ?? 0), 0);
  assert.ok(apiTotalTargets >= 1, 'API: en az bir deleteTarget olmali');
});

test('PARITY-01b — kok taramasi /api/disk\'i degistirmez (T27/T10)', async () => {
  // baseline: env taramasindan kalan sonuc
  const baseline = await (await fetch(`${base}/api/disk`, {
    headers: { 'x-residue-token': token },
  })).json();

  // CLI root taramasi: proje koku report-only -> 0 hedef
  const cli = await runCli(['scan', '--json', '--quiet', '--root', join(sandbox, 'proj')]);
  assert.equal(cli.code, 0, `CLI exit ${cli.code}: ${cli.stderr}`);
  const cliParsed = JSON.parse(cli.stdout.trim()) as {
    clusters: Array<{ deleteTargets: Array<{ path: string }> }>;
  };
  const cliTotalTargets = cliParsed.clusters.reduce(
    (n, c) => n + (c.deleteTargets?.length ?? 0),
    0,
  );
  assert.equal(cliTotalTargets, 0, 'CLI: proje koku report-only -> 0 hedef');

  // API root taramasi: /api/disk degismemeli
  const scanRes = await fetch(`${base}/api/scan`, {
    method: 'POST',
    headers: { 'x-residue-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ roots: [join(sandbox, 'proj')] }),
  });
  assert.ok(scanRes.status === 202 || scanRes.status === 200, `scan status ${scanRes.status}`);
  await waitForScanDone(base, token);

  const after = await (await fetch(`${base}/api/disk`, {
    headers: { 'x-residue-token': token },
  })).json();
  assert.deepEqual(after, baseline, 'kok taramasi /api/disk\'i degistirmez');
});

test('PARITY-02 — plan', async () => {
  // CLI
  const cli = await runCli(['clean', '--dry-run', '--env', 'temp']);
  assert.equal(cli.code, 0, `CLI exit ${cli.code}: ${cli.stderr}`);
  const out = stripAnsi(cli.stdout + cli.stderr);
  const cliPaths = new Set<string>();
  for (const m of out.matchAll(/^\s*->\s+(.+)$/gm)) {
    const p = m[1]!.trim();
    if (/^[A-Za-z]:\\/.test(p)) cliPaths.add(normalizePath(p));
  }
  assert.ok(cliPaths.size > 0, 'CLI dry-run hedef yol cikarmali');

  // API
  const scanRes = await fetch(`${base}/api/scan`, {
    method: 'POST',
    headers: { 'x-residue-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ envs: ['temp'] }),
  });
  assert.ok(scanRes.status === 202 || scanRes.status === 200);
  await waitForScanDone(base, token);

  const disk = await (await fetch(`${base}/api/disk`, {
    headers: { 'x-residue-token': token },
  })).json() as {
    clusters: Array<{ key: string; verdictKind: string }>;
  };
  const keys = disk.clusters
    .filter((c) => c.verdictKind === 'recommend')
    .map((c) => c.key);

  const planRes = await fetch(`${base}/api/plan`, {
    method: 'POST',
    headers: { 'x-residue-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ keys, mode: 'recycle' }),
  });
  assert.equal(planRes.status, 200, `plan status ${planRes.status}`);
  const plan = await planRes.json() as {
    phrase: string;
    plan: { targets: Array<{ target: { path: string } }> };
  };

  const apiPaths = new Set<string>(
    plan.plan.targets.map((t) => normalizePath(t.target.path)),
  );

  assert.deepEqual([...cliPaths].sort(), [...apiPaths].sort(), 'hedef yol kumesi esit olmali');
  assert.equal(plan.phrase, ApprovalRules.phrase('vaultMove'), 'plan ifadesi TASI olmali');

  // Silme yok
  assert.ok(existsSync(join(sandbox, 'temp', 'app-cache', 'GPUCache', 'data_0')), 'fixture kalmali');
  const { access: a } = await import('node:fs/promises');
  let vaultExists = true;
  try { await a(join(sandbox, 'la', 'residue', 'vault')); } catch { vaultExists = false; }
  assert.equal(vaultExists, false, 'vault olusmamali');
});

test('PARITY-03 — envanter', async () => {
  // CLI
  const cli = await runCli(['inventory', '--json']);
  assert.equal(cli.code, 0, `CLI exit ${cli.code}: ${cli.stderr}`);
  const cliParsed = JSON.parse(cli.stdout.trim()) as {
    tools: Array<{ id: string; source: string; totalBytes: number }>;
  };

  // API
  const invRes = await fetch(`${base}/api/cli/inventory`, {
    method: 'POST',
    headers: { 'x-residue-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.ok(invRes.status === 202 || invRes.status === 200);
  const invStart = await invRes.json() as { jobId: string };
  const streamRes = await fetch(`${base}/api/cli/inventory/${invStart.jobId}/events`, {
    headers: { 'x-residue-token': token },
  });
  await streamRes.text();
  const apiView = await (await fetch(`${base}/api/cli/view`, {
    headers: { 'x-residue-token': token },
  })).json() as {
    tools: Array<{ id: string; source: string; totalBytes: number }>;
  };

  const cliIds = new Set(cliParsed.tools.map((t) => t.id));
  const apiIds = new Set(apiView.tools.map((t) => t.id));
  assert.deepEqual([...cliIds].sort(), [...apiIds].sort(), 'arac id kumesi esit olmali');

  for (const id of cliIds) {
    const c = cliParsed.tools.find((t) => t.id === id)!;
    const a = apiView.tools.find((t) => t.id === id)!;
    assert.equal(c.source, a.source, `${id} source`);
    assert.equal(c.totalBytes, a.totalBytes, `${id} totalBytes`);
  }

  const cliTool = cliParsed.tools.find((t) => t.id.includes('ornek-arac') || (t as any).packageName === 'ornek-arac');
  // fallback: match by packageName if id differs
  const apiTool = apiView.tools.find((t) => t.id === cliTool?.id)
    ?? apiView.tools.find((t) => (t as any).packageName === 'ornek-arac');
  assert.ok(apiTool, 'API tarafinda ornek-arac bulunmali');
  assert.equal(apiTool!.source, 'npm-global', 'ornek-arac source npm-global');

  // Salt okunur: vault yok
  const { access: a } = await import('node:fs/promises');
  let vaultExists = true;
  try { await a(join(sandbox, 'la', 'residue', 'vault')); } catch { vaultExists = false; }
  assert.equal(vaultExists, false, 'vault olusmamali');
});