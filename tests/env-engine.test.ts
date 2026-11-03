import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  analyzeEnvironment,
  expandEnvValue,
  findCommandShadows,
  findOrphanVariables,
  isSensitiveName,
  maskValue,
  parseRegEnvironment,
  planPathCleanup,
  splitPathEntries,
  type EnvSnapshot,
} from '../src/core/env-engine.ts';

test('reg query ciktisi ayristirilir', () => {
  const out = parseRegEnvironment(
    [
      'HKEY_CURRENT_USER\\Environment',
      '    Path    REG_EXPAND_SZ    C:\\bin;%USERPROFILE%\\tools',
      '    OPENAI_API_KEY    REG_SZ    sk-super-secret',
      '    EMPTY    REG_SZ    ',
    ].join('\r\n'),
    'user',
  );
  assert.equal(out.length, 3);
  assert.equal(out[0]!.name, 'Path');
  assert.equal(out[0]!.type, 'REG_EXPAND_SZ');
  assert.equal(out[1]!.sensitive, true);
  assert.equal(out[1]!.display, '••••••');
});

test('hassas isim ve maskeleme', () => {
  assert.equal(isSensitiveName('GITHUB_TOKEN'), true);
  assert.equal(isSensitiveName('OPENAI_API_KEY'), true);
  assert.equal(isSensitiveName('PATH'), false);
  assert.equal(maskValue('PATH', 'C:\\bin'), 'C:\\bin');
  assert.equal(maskValue('API_KEY', 'abc'), '••••••');
});

test('degisken genisletme', () => {
  const vars = new Map([
    ['userprofile', 'C:\\Users\\Test'],
    ['bin', 'C:\\Tools'],
  ]);
  assert.equal(expandEnvValue('%USERPROFILE%\\x;%BIN%', vars), 'C:\\Users\\Test\\x;C:\\Tools');
  assert.equal(splitPathEntries(' a ; ;b; ').length, 2);
});

test('yetim *_HOME degiskeni bulunur', () => {
  const missing = 'C:\\residue-test-missing-home-xyz';
  const vars = [
    { name: 'CARGO_HOME', scope: 'user' as const, type: 'REG_SZ' as const, raw: missing, display: missing, sensitive: false },
    { name: 'JAVA_HOME', scope: 'user' as const, type: 'REG_SZ' as const, raw: process.cwd(), display: process.cwd(), sensitive: false },
  ];
  const orphans = findOrphanVariables(vars, (p) => p !== missing);
  assert.deepEqual(orphans.map((o) => o.name), ['CARGO_HOME']);
});

test('komut golgeleme: ilk PATH kazanir', () => {
  const dirs = ['C:\\a', 'C:\\b'];
  const shadows = findCommandShadows(dirs, (d) =>
    d === 'C:\\a' ? ['node.exe', 'npm.cmd'] : ['node.exe', 'other.exe'],
  );
  assert.equal(shadows.length, 1);
  assert.equal(shadows[0]!.command, 'node');
  assert.equal(shadows[0]!.winner, 'C:\\a');
  assert.deepEqual(shadows[0]!.shadowed, ['C:\\b']);
});

test('PATH analizi ve temizlik plani', () => {
  const existing = process.cwd();
  const missing = join(existing, 'residue-missing-dir-xyz');
  const snapshot: EnvSnapshot = {
    machine: [],
    user: [
      {
        name: 'Path',
        scope: 'user',
        type: 'REG_EXPAND_SZ',
        raw: `${existing};${missing};${existing}`,
        display: `${existing};${missing};${existing}`,
        sensitive: false,
      },
      {
        name: 'SOME_HOME',
        scope: 'user',
        type: 'REG_SZ',
        raw: missing,
        display: missing,
        sensitive: false,
      },
    ],
  };
  const analysis = analyzeEnvironment(snapshot);
  assert.equal(analysis.pathEntries.length, 3);
  assert.equal(analysis.pathEntries[1]!.exists, false);
  assert.equal(analysis.pathEntries[2]!.duplicateOf, 0);
  assert.ok(analysis.findings.some((f) => f.kind === 'missing-path'));
  assert.ok(analysis.findings.some((f) => f.kind === 'duplicate-path'));
  assert.ok(analysis.findings.some((f) => f.kind === 'orphan-variable'));

  const plan = planPathCleanup(analysis, { scope: 'user' });
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0]!.after, existing);
  assert.equal(plan.requiresAdmin, false);

  // Acik secim: yalnizca isaretlenen girdi cikar; tekrar korunur.
  const selected = planPathCleanup(analysis, { scope: 'user', removeEntries: ['user:1'] });
  assert.equal(selected.changes.length, 1);
  assert.equal(selected.changes[0]!.after, `${existing};${existing}`);
  assert.equal(selected.changes[0]!.reason, 'secilen PATH girdileri');

  // Bos secim degisiklik uretmez.
  const none = planPathCleanup(analysis, { scope: 'user', removeEntries: [] });
  assert.equal(none.empty, true);
});
