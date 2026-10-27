/**
 * NORMALIZASYON SOZLESMESI (parity-t79)
 *
 * PARITY-04 (graph):
 *  Esit sayilan:
 *   - dugum kimlik kumesi (sira bagimsiz)
 *   - her dugum icin kind + label + path (varsa) + role + level
 *   - kenar kumesi (from, to, kind, strength, state) beslisi (sira bagimsiz)
 *   - cycles: her dongu uyeleri siralanip, dongu listesi siralanarak esit
 *   - rootCauses: label + count cokluk kumesi (sira bagimsiz)
 *   - summary.nodes, summary.edges, summary.cycles, summary.broken
 *  Kapsam disi (adaptore ozgu / zamana duyarli):
 *   - node.meta, node.active, node.group, node.dependents/needs
 *   - edge.evidence, edge.id, edge.active
 *   - groups, details (adaptör/kanıt katmanı)
 *
 * PARITY-04b (what-if):
 *  Esit sayilan:
 *   - nodeIds kumesi, allowed.length, blocked label+reason cokluk kumesi
 *
 * PARITY-05 (project):
 *  Esit sayilan:
 *   - artifact yol kumesi (normalize edilmis), en az 1 artifact
 *   - her artifact icin ecosystem, packageManager, manifest, lockfile,
 *     lockfileHash, regenerable, bytes, realisticBytes, installCommand,
 *     verifyCommand
 *   - plan.totalBytes, plan.realisticBytes, plan.blocked.length
 *  Negatif kontrol: bos dizin -> iki tarafta da 0 artifact, plan toplami 0.
 *  Guvenlik: vault olusmaz, fixture dosyalari yerinde kalir (report-only).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

let sandbox = '';
let server: any;
let base = '';
let token = '';

const originalEnv: Record<string, string | undefined> = {};

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

  sandbox = await mkdtemp(join(tmpdir(), 'residue-parity79-'));

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
  await mkdir(join(sandbox, 'temp'), { recursive: true });

  await writeFile(
    join(sandbox, 'roaming', 'npm', 'node_modules', 'ornek-arac', 'package.json'),
    '{"name":"ornek-arac","version":"1.2.3","bin":{"ornek-arac":"cli.js"}}',
  );
  await writeFile(join(sandbox, 'roaming', 'npm', 'node_modules', 'ornek-arac', 'cli.js'), "console.log('x');\n");
  await writeFile(join(sandbox, 'roaming', 'npm', 'ornek-arac.cmd'), '@echo off\r\n');

  // proje fixture
  const projDir = join(sandbox, 'proj-npm');
  await mkdir(join(projDir, 'node_modules', 'ornek-bagimlilik'), { recursive: true });
  await writeFile(join(projDir, 'package.json'), '{"name":"fixture-proje","version":"1.0.0"}');
  await writeFile(
    join(projDir, 'package-lock.json'),
    JSON.stringify({
      name: 'fixture-proje',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { name: 'fixture-proje', version: '1.0.0' },
        'node_modules/ornek-bagimlilik': { version: '1.0.0' },
      },
    }),
  );
  await writeFile(
    join(projDir, 'node_modules', 'ornek-bagimlilik', 'package.json'),
    '{"name":"ornek-bagimlilik","version":"1.0.0","main":"index.js"}',
  );
  await writeFile(join(projDir, 'node_modules', 'ornek-bagimlilik', 'index.js'), 'module.exports={};\n');

  const bosDir = join(sandbox, 'bos-proje');
  await mkdir(bosDir, { recursive: true });
  await writeFile(join(bosDir, 'README.md'), '# bos\n');

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

test('PARITY-04 — graph --json ↔ GET /api/graph', async () => {
  // CLI
  const cli = await runCli(['graph', '--json']);
  assert.equal(cli.code, 0, `CLI exit ${cli.code}: ${cli.stderr}`);
  const cliParsed = JSON.parse(cli.stdout.trim()) as {
    nodes: Array<{ id: string; kind: string; label: string; path?: string; role: string; level: string }>;
    edges: Array<{ from: string; to: string; kind: string; strength: string; state: string }>;
    cycles: string[][];
    rootCauses: Array<{ label: string; count: number }>;
    summary: { nodes: number; edges: number; broken: number; cycles: number };
  };

  // API
  const apiRes = await fetch(`${base}/api/graph`, {
    headers: { 'x-residue-token': token },
  });
  assert.equal(apiRes.status, 200, `api status ${apiRes.status}`);
  const apiParsed = await apiRes.json() as {
    nodes: Array<{ id: string; kind: string; label: string; path?: string; role: string; level: string }>;
    edges: Array<{ from: string; to: string; kind: string; strength: string; state: string }>;
    cycles: string[][];
    rootCauses: Array<{ label: string; count: number }>;
    summary: { nodes: number; edges: number; broken: number; cycles: number };
  };

  // bos esitlik kaniti degil: en az 2 dugum ve 1 kenar
  assert.ok(cliParsed.nodes.length >= 2, 'CLI: en az 2 dugum olmali');
  assert.ok(cliParsed.edges.length >= 1, 'CLI: en az 1 kenar olmali');
  assert.ok(apiParsed.nodes.length >= 2, 'API: en az 2 dugum olmali');
  assert.ok(apiParsed.edges.length >= 1, 'API: en az 1 kenar olmali');

  // 1. dugum kimlik kumesi esit
  const cliIds = new Set(cliParsed.nodes.map((n) => n.id));
  const apiIds = new Set(apiParsed.nodes.map((n) => n.id));
  assert.deepEqual([...cliIds].sort(), [...apiIds].sort(), 'dugum kimlik kumesi esit olmali');

  // 2. her dugum icin kind + label + path + role + level esit
  for (const id of cliIds) {
    const c = cliParsed.nodes.find((n) => n.id === id)!;
    const a = apiParsed.nodes.find((n) => n.id === id)!;
    assert.equal(c.kind, a.kind, `${id} kind`);
    assert.equal(c.label, a.label, `${id} label`);
    const cp = c.path ? normalizePath(c.path) : undefined;
    const ap = a.path ? normalizePath(a.path) : undefined;
    assert.equal(cp, ap, `${id} path`);
    assert.equal(c.role, a.role, `${id} role`);
    assert.equal(c.level, a.level, `${id} level`);
  }

  // 3. kenar kumesi (from,to,kind,strength,state) esit
  const edgeKey = (e: { from: string; to: string; kind: string; strength: string; state: string }) =>
    `${e.from}|${e.to}|${e.kind}|${e.strength}|${e.state}`;
  const cliEdges = new Set(cliParsed.edges.map(edgeKey));
  const apiEdges = new Set(apiParsed.edges.map(edgeKey));
  assert.deepEqual([...cliEdges].sort(), [...apiEdges].sort(), 'kenar kumesi esit olmali');

  // 4. cycles kanonik esit
  const canonCycles = (cycles: string[][]) =>
    cycles.map((c) => [...c].sort().join('|')).sort();
  assert.deepEqual(canonCycles(cliParsed.cycles), canonCycles(apiParsed.cycles), 'cycles esit olmali');

  // 5. rootCauses label+count cokluk kumesi esit
  const rcKey = (r: { label: string; count: number }) => `${r.label}::${r.count}`;
  const cliRc = cliParsed.rootCauses.map(rcKey).sort();
  const apiRc = apiParsed.rootCauses.map(rcKey).sort();
  assert.deepEqual(cliRc, apiRc, 'rootCauses esit olmali');

  // 6. summary
  assert.equal(cliParsed.summary.nodes, apiParsed.summary.nodes, 'summary.nodes');
  assert.equal(cliParsed.summary.edges, apiParsed.summary.edges, 'summary.edges');
  assert.equal(cliParsed.summary.cycles, apiParsed.summary.cycles, 'summary.cycles');
  assert.equal(cliParsed.summary.broken, apiParsed.summary.broken, 'summary.broken');
});

test('PARITY-04b — graph what-if esitligi', async () => {
  // CLI
  const cli = await runCli(['graph', '--json', '--what-if', 'ornek-arac']);
  assert.equal(cli.code, 0, `CLI exit ${cli.code}: ${cli.stderr}`);
  const cliParsed = JSON.parse(cli.stdout.trim()) as {
    whatIf: { nodeIds: string[]; result: { allowed: string[]; blocked: Array<{ label: string; reason: string }> } };
  };

  // API
  const apiRes = await fetch(`${base}/api/graph/what-if`, {
    method: 'POST',
    headers: { 'x-residue-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'ornek-arac' }),
  });
  assert.equal(apiRes.status, 200, `api status ${apiRes.status}`);
  const apiParsed = await apiRes.json() as {
    nodeIds: string[];
    result: { allowed: string[]; blocked: Array<{ label: string; reason: string }> };
  };

  assert.ok(cliParsed.whatIf.nodeIds.length >= 1, 'CLI: en az bir dugum eslesmeli');
  assert.ok(apiParsed.nodeIds.length >= 1, 'API: en az bir dugum eslesmeli');

  const cliIds = new Set(cliParsed.whatIf.nodeIds);
  const apiIds = new Set(apiParsed.nodeIds);
  assert.deepEqual([...cliIds].sort(), [...apiIds].sort(), 'what-if nodeIds esit olmali');

  assert.equal(
    cliParsed.whatIf.result.allowed.length,
    apiParsed.result.allowed.length,
    'allowed.length esit olmali',
  );

  const blockedKey = (b: { label: string; reason: string }) => `${b.label}:${b.reason}`;
  const cliBlocked = cliParsed.whatIf.result.blocked.map(blockedKey).sort();
  const apiBlocked = apiParsed.result.blocked.map(blockedKey).sort();
  assert.deepEqual(cliBlocked, apiBlocked, 'engelli label+reason coklugu esit olmali');
});

test('PARITY-05 — project <dir> --json ↔ GET /api/projects?path=<dir>', async () => {
  const projDir = join(sandbox, 'proj-npm');

  // CLI
  const cli = await runCli(['project', projDir, '--json']);
  assert.equal(cli.code, 0, `CLI exit ${cli.code}: ${cli.stderr}`);
  const cliParsed = JSON.parse(cli.stdout.trim()) as {
    root: string;
    artifacts: Array<{
      artifactPath: string;
      ecosystem: string;
      packageManager: string;
      manifest: string | null;
      lockfile: string | null;
      lockfileHash: string | null;
      regenerable: boolean;
      bytes: number;
      realisticBytes: number;
      recipe: { installCommand: string | null; verifyCommand: string | null };
    }>;
    plan: { totalBytes: number; realisticBytes: number; blocked: Array<unknown> };
  };

  // API
  const apiRes = await fetch(`${base}/api/projects?path=${encodeURIComponent(projDir)}`, {
    headers: { 'x-residue-token': token },
  });
  assert.equal(apiRes.status, 200, `api status ${apiRes.status}`);
  const apiParsed = await apiRes.json() as {
    root: string;
    artifacts: Array<{
      artifactPath: string;
      ecosystem: string;
      packageManager: string;
      manifest: string | null;
      lockfile: string | null;
      lockfileHash: string | null;
      regenerable: boolean;
      bytes: number;
      realisticBytes: number;
      installCommand: string | null;
      verifyCommand: string | null;
    }>;
    plan: { totalBytes: number; realisticBytes: number; blocked: Array<unknown> };
  };

  // en az 1 artifact
  assert.ok(cliParsed.artifacts.length >= 1, 'CLI: en az 1 artifact olmali');
  assert.ok(apiParsed.artifacts.length >= 1, 'API: en az 1 artifact olmali');

  // artifact yol kumesi esit
  const cliPaths = new Set(cliParsed.artifacts.map((a) => normalizePath(a.artifactPath)));
  const apiPaths = new Set(apiParsed.artifacts.map((a) => normalizePath(a.artifactPath)));
  assert.deepEqual([...cliPaths].sort(), [...apiPaths].sort(), 'artifact yol kumesi esit olmali');

  // her artifact icin alanlar esit
  for (const cp of cliPaths) {
    const c = cliParsed.artifacts.find((a) => normalizePath(a.artifactPath) === cp)!;
    const a = apiParsed.artifacts.find((x) => normalizePath(x.artifactPath) === cp)!;
    assert.equal(c.ecosystem, a.ecosystem, `${cp} ecosystem`);
    assert.equal(c.packageManager, a.packageManager, `${cp} packageManager`);
    const cm = c.manifest ? normalizePath(c.manifest) : null;
    const am = a.manifest ? normalizePath(a.manifest) : null;
    assert.equal(cm, am, `${cp} manifest`);
    const cl = c.lockfile ? normalizePath(c.lockfile) : null;
    const al = a.lockfile ? normalizePath(a.lockfile) : null;
    assert.equal(cl, al, `${cp} lockfile`);
    assert.equal(c.lockfileHash, a.lockfileHash, `${cp} lockfileHash`);
    assert.equal(c.regenerable, a.regenerable, `${cp} regenerable`);
    assert.equal(c.bytes, a.bytes, `${cp} bytes`);
    assert.equal(c.realisticBytes, a.realisticBytes, `${cp} realisticBytes`);
    assert.equal(c.recipe.installCommand, a.installCommand, `${cp} installCommand`);
    assert.equal(c.recipe.verifyCommand, a.verifyCommand, `${cp} verifyCommand`);
  }

  // plan
  assert.equal(cliParsed.plan.totalBytes, apiParsed.plan.totalBytes, 'plan.totalBytes');
  assert.equal(cliParsed.plan.realisticBytes, apiParsed.plan.realisticBytes, 'plan.realisticBytes');
  assert.equal(cliParsed.plan.blocked.length, apiParsed.plan.blocked.length, 'plan.blocked.length');

  // negatif kontrol: bos dizin
  const bosDir = join(sandbox, 'bos-proje');
  const cliBos = await runCli(['project', bosDir, '--json']);
  assert.equal(cliBos.code, 0, `CLI bos exit ${cliBos.code}: ${cliBos.stderr}`);
  const cliBosParsed = JSON.parse(cliBos.stdout.trim()) as {
    artifacts: Array<unknown>;
    plan: { totalBytes: number };
  };
  assert.equal(cliBosParsed.artifacts.length, 0, 'CLI: bos dizin artifact yok');
  assert.equal(cliBosParsed.plan.totalBytes, 0, 'CLI: bos dizin plan toplami 0');

  const apiBosRes = await fetch(`${base}/api/projects?path=${encodeURIComponent(bosDir)}`, {
    headers: { 'x-residue-token': token },
  });
  assert.equal(apiBosRes.status, 200, `api bos status ${apiBosRes.status}`);
  const apiBosParsed = await apiBosRes.json() as {
    artifacts: Array<unknown>;
    plan: { totalBytes: number };
  };
  assert.equal(apiBosParsed.artifacts.length, 0, 'API: bos dizin artifact yok');
  assert.equal(apiBosParsed.plan.totalBytes, 0, 'API: bos dizin plan toplami 0');

  // guvenlik: vault olusmamis, fixture dosyalari yerinde
  const { access: a } = await import('node:fs/promises');
  let vaultExists = true;
  try { await a(join(sandbox, 'la', 'residue', 'vault')); } catch { vaultExists = false; }
  assert.equal(vaultExists, false, 'vault olusmamali');
  assert.ok(existsSync(join(projDir, 'package.json')), 'fixture package.json yerinde kalmali');
});