import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile, utimes } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

let sandbox = '';

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
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

before(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'residue-e2e-'));

  // Dizin yapisi
  await mkdir(join(sandbox, 'la'), { recursive: true });
  await mkdir(join(sandbox, 'roaming', 'npm', 'node_modules', 'ornek-arac'), { recursive: true });
  await mkdir(join(sandbox, 'home'), { recursive: true });
  await mkdir(join(sandbox, 'temp', 'app-cache', 'GPUCache'), { recursive: true });
  await mkdir(join(sandbox, 'proj', 'cache', 'GPUCache'), { recursive: true });

  // Projede cache fixture
  await writeFile(
    join(sandbox, 'proj', 'cache', 'CACHEDIR.TAG'),
    'Signature: 8a477f597d28d172789f06886806bc55',
  );
  await writeFile(join(sandbox, 'proj', 'cache', 'GPUCache', 'data_0'), Buffer.alloc(2048));

  // TEMP fixture (10 gun once)
  await writeFile(
    join(sandbox, 'temp', 'app-cache', 'CACHEDIR.TAG'),
    'Signature: 8a477f597d28d172789f06886806bc55',
  );
  await writeFile(join(sandbox, 'temp', 'app-cache', 'GPUCache', 'data_0'), Buffer.alloc(4096));
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  await utimes(join(sandbox, 'temp', 'app-cache', 'GPUCache', 'data_0'), tenDaysAgo, tenDaysAgo);
  await utimes(join(sandbox, 'temp', 'app-cache', 'GPUCache'), tenDaysAgo, tenDaysAgo);

  // npm global fixture
  await writeFile(
    join(sandbox, 'roaming', 'npm', 'node_modules', 'ornek-arac', 'package.json'),
    '{"name":"ornek-arac","version":"1.2.3","bin":{"ornek-arac":"cli.js"}}',
  );
  await writeFile(join(sandbox, 'roaming', 'npm', 'node_modules', 'ornek-arac', 'cli.js'), "console.log('x');\n");
  await writeFile(join(sandbox, 'roaming', 'npm', 'ornek-arac.cmd'), '@echo off\r\n');
});

after(async () => {
  if (sandbox) await rm(sandbox, { recursive: true, force: true });
});

test('CLI-01 scan --json --quiet --root <proj>', async () => {
  const projPath = join(sandbox, 'proj');
  const r = await runCli(['scan', '--json', '--quiet', '--root', projPath]);
  assert.equal(r.code, 0, `exit code ${r.code}: ${r.stderr}`);
  const stdout = r.stdout.trim();
  assert.ok(stdout.startsWith('{'), 'stdout tam JSON ({ ile baslamali)');
  const parsed = JSON.parse(stdout) as {
    startedAt: number;
    finishedAt: number;
    stats: unknown;
    clusters: Array<{
      key: string;
      archetype: string;
      verdict: unknown;
      deleteTargets: unknown[];
    }>;
  };
  assert.ok(Array.isArray(parsed.clusters));
  for (const c of parsed.clusters) {
    assert.ok(typeof c.key === 'string');
    assert.ok(typeof c.archetype === 'string');
    assert.ok(c.verdict !== null && typeof c.verdict === 'object');
    assert.ok(Array.isArray(c.deleteTargets));
  }
  const totalTargets = parsed.clusters.reduce((n, c) => n + (c.deleteTargets?.length ?? 0), 0);
  assert.equal(totalTargets, 0, 'proje koku report-only: 0 silme hedefi');
  assert.ok(parsed.stats !== null && typeof parsed.stats === 'object');
  assert.ok(parsed.finishedAt >= parsed.startedAt);

  // Fixture dosyalari hala diskte
  assert.ok(existsSync(join(sandbox, 'proj', 'cache', 'CACHEDIR.TAG')));
  assert.ok(existsSync(join(sandbox, 'proj', 'cache', 'GPUCache', 'data_0')));
});

test('CLI-02 clean --dry-run --env temp', async () => {
  const r = await runCli(['clean', '--dry-run', '--env', 'temp']);
  assert.equal(r.code, 0, `exit code ${r.code}: ${r.stderr}`);
  const out = r.stdout + r.stderr;
  assert.match(out, /DRY-RUN/);
  assert.match(out, /hicbir sey silinmedi/);

  assert.ok(existsSync(join(sandbox, 'temp', 'app-cache', 'GPUCache', 'data_0')), '0 silme: dosya kalmali');
  assert.ok(!(await pathExists(join(sandbox, 'la', 'residue', 'vault'))), 'vault olusmamali');
});

test('CLI-03 inventory --json', async () => {
  const r = await runCli(['inventory', '--json']);
  assert.equal(r.code, 0, `exit code ${r.code}: ${r.stderr}`);
  const stdout = r.stdout.trim();
  const parsed = JSON.parse(stdout) as { tools: Array<Record<string, unknown>> };
  assert.ok(Array.isArray(parsed.tools));

  const tool = parsed.tools.find((t) => t.packageName === 'ornek-arac');
  assert.ok(tool, 'ornek-arac envanterde olmali');
  assert.equal(tool.source, 'npm-global');
  assert.ok(Array.isArray(tool.evidence) && (tool.evidence as unknown[]).length > 0);
  assert.ok(['high', 'medium', 'low'].includes(String(tool.confidence)));
  assert.equal(typeof tool.status, 'string');
  assert.ok(Array.isArray(tool.usageSignals));

  assert.ok(!(await pathExists(join(sandbox, 'la', 'residue', 'vault'))), 'salt okunur: vault yok');

  // Fixture package.json degismemis
  const { readFile } = await import('node:fs/promises');
  const content = await readFile(join(sandbox, 'roaming', 'npm', 'node_modules', 'ornek-arac', 'package.json'), 'utf8');
  assert.equal(content, '{"name":"ornek-arac","version":"1.2.3","bin":{"ornek-arac":"cli.js"}}');
});

test('CLI-04 repair --dry-run', async () => {
  const r = await runCli(['repair', '--dry-run']);
  assert.equal(r.code, 0, `exit code ${r.code}: ${r.stderr}`);
  assert.ok(!(await pathExists(join(sandbox, 'la', 'residue', 'vault'))), 'vault yok');

  const out = r.stdout + r.stderr;
  assert.ok(!/ONAR\s*:/.test(out), 'ONAR onay istemi olmamali');
  assert.ok(!/onar(ı|i)ld(ı|i)/i.test(out), 'onarildi/onarıldı gecmemeli');
});

test('CLI-05 quarantine kapisi', async () => {
  // alt durum 1: arguman yok
  const r1 = await runCli(['quarantine']);
  assert.equal(r1.code, 1);
  const out1 = r1.stdout + r1.stderr;
  assert.match(out1, /Kullanim: residue quarantine/);

  // alt durum 2: npm-global arac (standalone degil)
  const r2 = await runCli(['quarantine', 'ornek-arac', '--dry-run']);
  assert.equal(r2.code, 1);
  const out2 = r2.stdout + r2.stderr;
  assert.match(out2, /Bagimsiz \(standalone\) arac bulunamadi/);

  assert.ok(!(await pathExists(join(sandbox, 'la', 'residue', 'vault'))), 'vault yok');
  assert.ok(existsSync(join(sandbox, 'roaming', 'npm', 'node_modules', 'ornek-arac', 'package.json')));
  assert.ok(existsSync(join(sandbox, 'roaming', 'npm', 'ornek-arac.cmd')));
});

test('CLI-06 status + log --summary', async () => {
  const rs = await runCli(['status']);
  assert.equal(rs.code, 0, `status exit ${rs.code}: ${rs.stderr}`);
  assert.match(rs.stdout, /\d+ tamamlandi/);

  const rl = await runCli(['log', '--summary']);
  assert.equal(rl.code, 0, `log exit ${rl.code}: ${rl.stderr}`);
  assert.ok(rl.stdout.includes('Son 1 saat ozeti'));
  assert.match(rl.stdout, /siniflandirma|uyari|hata/);
});