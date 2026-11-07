/**
 * B18 — bayat sablon korumasi.
 *
 * Eski `scripts/init-state.ts` 10 gorevlik 2025 sablonunu kosulsuz yaziyor,
 * `npm run init-state` calistiginda gercek `state.json` gecmisini siliyordu.
 * Bu testler korumayi ve yedek davranisini dogrular.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { StateScaffold } from '../src/core/state-scaffold.ts';
import {
  readState,
  stateFile,
  writeStateSafely,
  type ProjectState,
} from '../src/util/state.ts';

let root = '';

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'residue-init-state-'));
});

after(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

let seq = 0;
function freshDir(): string {
  seq += 1;
  return join(root, `case-${seq}`);
}

/** Gercek durum dosyasini taklit eden kucuk bir state. */
function sampleState(tasks: number, bugs = 2): ProjectState {
  return {
    version: 1,
    updatedAt: '2026-11-06T21:22:00.000Z',
    project: { name: 'Residue', purpose: 'p', stack: 's', entry: 'src/cli.ts' },
    waves: [{ id: 'D1', title: 'Web UX', status: 'done' }],
    commands: [{ cmd: 'x', desc: 'y' }],
    tasks: Array.from({ length: tasks }, (_, i) => ({
      id: `T${i + 1}`,
      title: `gorev ${i + 1}`,
      status: 'done' as const,
      updatedAt: '2026-11-06T21:22:00.000Z',
    })),
    bugs: Array.from({ length: bugs }, (_, i) => ({
      title: `hata ${i + 1}`,
      symptom: 's',
      cause: 'c',
      fix: 'f',
      status: 'fixed' as const,
      severity: 'low' as const,
    })),
    perf: [],
    actionsPerformed: [],
    openQuestions: [],
  };
}

function runNode(args: string[], cwd: string): Promise<{ code: number; out: string }> {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, args, { cwd, windowsHide: true });
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('zaman asimi (60s)'));
    }, 60000);
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code: code ?? -1, out });
    });
  });
}

async function listBackups(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((n) => n.startsWith('state.json.bak-')).sort();
}

// ---------------------------------------------------------------- motor

test('B18-1 decide: dosya yoksa iskelet yazilir', () => {
  const d = StateScaffold.decide(false, null);
  assert.equal(d.allowed, true);
  assert.equal(d.reason, 'missing');
  assert.equal(d.existing, null);
});

test('B18-2 decide: dolu dosya --force olmadan reddedilir, ozet tasir', () => {
  const d = StateScaffold.decide(true, sampleState(98, 65));
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'exists');
  assert.equal(d.existing?.tasks, 98);
  assert.equal(d.existing?.bugs, 65);
  assert.match(StateScaffold.describe(d), /--force/);
  assert.match(StateScaffold.describe(d), /98 gorev, 65 hata/);
});

test('B18-3 decide: okunamayan dosya da reddedilir (force yok)', () => {
  const d = StateScaffold.decide(true, null);
  assert.equal(d.allowed, false);
  assert.equal(d.existing, null);
  assert.match(StateScaffold.describe(d), /okunamayan/);
});

test('B18-4 decide: --force ile izin verilir ve yedek duyurulur', () => {
  const d = StateScaffold.decide(true, sampleState(12, 3), true);
  assert.equal(d.allowed, true);
  assert.equal(d.reason, 'forced');
  assert.match(StateScaffold.describe(d), /yedek/);
});

test('B18-5 backupSuffix dosya sisteminde guvenli', () => {
  const s = StateScaffold.backupSuffix(new Date('2026-11-07T20:15:03.123Z'));
  assert.equal(s, '2026-11-07T20-15-03-123Z');
  assert.doesNotMatch(s, /[:.]/);
});

// ------------------------------------------------------- dosya yazimi

test('B18-6 writeStateSafely: bos dizinde iskelet yazar', async () => {
  const dir = freshDir();
  const r = await writeStateSafely(StateScaffold.skeleton(), { cwd: dir });
  assert.equal(r.written, true);
  assert.equal(r.decision.reason, 'missing');
  const back = await readState(dir);
  assert.ok(back);
  assert.equal(back.tasks.length, 0);
  assert.equal(back.bugs.length, 0);
});

test('B18-7 writeStateSafely: dolu dosyayi DEGISTIRMEZ', async () => {
  const dir = freshDir();
  const original = sampleState(98, 65);
  await writeStateSafely(original, { cwd: dir });
  const before = await readFile(stateFile(dir), 'utf8');

  const r = await writeStateSafely(StateScaffold.skeleton(), { cwd: dir });
  const after = await readFile(stateFile(dir), 'utf8');

  assert.equal(r.written, false);
  assert.equal(r.decision.reason, 'exists');
  assert.equal(r.decision.existing?.tasks, 98);
  assert.equal(after, before, 'mevcut state.json bayt bayt korunmali');
  assert.deepEqual(await listBackups(dir), []);
});

test('B18-8 writeStateSafely: bozuk JSON sessizce ezilmez', async () => {
  const dir = freshDir();
  const broken = '{ "tasks": [ bu bir json degil';
  await mkdir(dir, { recursive: true });
  await writeFile(stateFile(dir), broken, 'utf8');

  const r = await writeStateSafely(StateScaffold.skeleton(), { cwd: dir });
  assert.equal(r.written, false);
  assert.equal(await readFile(stateFile(dir), 'utf8'), broken);
});

test('B18-9 writeStateSafely: --force once yedek alir, sonra yazar', async () => {
  const dir = freshDir();
  await writeStateSafely(sampleState(98, 65), { cwd: dir });
  const original = await readFile(stateFile(dir), 'utf8');

  const r = await writeStateSafely(StateScaffold.skeleton(), { cwd: dir, force: true });
  assert.equal(r.written, true);
  assert.equal(r.decision.reason, 'forced');
  assert.ok(r.backup, 'yedek yolu donmeli');

  const backups = await listBackups(dir);
  assert.equal(backups.length, 1);
  const backupName = backups[0];
  assert.ok(backupName);
  assert.equal(await readFile(join(dir, backupName), 'utf8'), original);

  const back = await readState(dir);
  assert.equal(back?.tasks.length, 0, 'yeni dosya iskelet olmali');
});

// ------------------------------------------------------------- uctan uca

test('B18-10 E2E: npm run init-state dolu dosyada durur (cikis 1)', async () => {
  const dir = freshDir();
  await writeStateSafely(sampleState(98, 65), { cwd: dir });
  const before = await readFile(stateFile(dir), 'utf8');

  const r = await runNode(
    ['--import', 'tsx', 'scripts/init-state.ts', '--dir', dir],
    resolve('.'),
  );

  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /YAZILMADI/);
  assert.match(r.out, /--force/);
  assert.equal(await readFile(stateFile(dir), 'utf8'), before);
  assert.deepEqual(await listBackups(dir), []);
});

test('B18-11 E2E: init-state --force yedek birakir ve yazar (cikis 0)', async () => {
  const dir = freshDir();
  await writeStateSafely(sampleState(98, 65), { cwd: dir });
  const original = await readFile(stateFile(dir), 'utf8');

  const r = await runNode(
    ['--import', 'tsx', 'scripts/init-state.ts', '--dir', dir, '--force'],
    resolve('.'),
  );

  assert.equal(r.code, 0, r.out);
  const backups = await listBackups(dir);
  assert.equal(backups.length, 1);
  const backupName = backups[0];
  assert.ok(backupName);
  assert.equal(await readFile(join(dir, backupName), 'utf8'), original);
});

test('B18-12 E2E: residue status --init dolu dosyayi ezmez', async () => {
  const dir = freshDir();
  await writeStateSafely(sampleState(98, 65), { cwd: dir });
  const before = await readFile(stateFile(dir), 'utf8');

  const entry = resolve('bin/residue.mjs');
  const r = await runNode([entry, 'status', '--init'], dir);

  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /YAZILMADI/);
  assert.equal(await readFile(stateFile(dir), 'utf8'), before);
  assert.deepEqual(await listBackups(dir), []);
});
