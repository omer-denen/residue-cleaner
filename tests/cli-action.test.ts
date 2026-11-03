import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CliAction } from '../src/core/cli-action.ts';
import type { CliTool, UninstallSpec } from '../src/core/cli-inventory-types.ts';

function tool(over: Partial<CliTool> = {}): CliTool {
  return {
    id: 'standalone:demo',
    command: 'demo',
    source: 'standalone',
    packageName: 'demo',
    version: '1.0.0',
    installPath: 'C:/bin/demo.exe',
    shims: ['C:/bin/demo.exe'],
    stalePaths: [],
    stateDirs: [],
    installedAt: 0,
    lastAccessAt: 0,
    lastStateAt: 0,
    historyMentions: 0,
    historyLastRatio: 1,
    totalBytes: 10,
    idleDays: 10,
    status: 'unused',
    confidence: 'high',
    evidence: [],
    usageSignals: [],
    atimeSuspect: false,
    uninstall: null,
    ...over,
  };
}

const npmUninstall: UninstallSpec = {
  kind: 'npm',
  program: 'npm.cmd',
  args: ['uninstall', '-g', 'demo'],
  display: 'npm uninstall -g demo',
};

test('paket yoneticisi kurulumu paket kaldirma yolunu kullanir', () => {
  assert.equal(
    CliAction.removal(tool({ source: 'npm-global', uninstall: npmUninstall })),
    'package',
  );
});

test('bagimsiz arac shim varsa karantina yolunu kullanir', () => {
  assert.equal(CliAction.removal(tool()), 'quarantine');
});

test('shim yoksa veya arac korunuyorsa kaldirma yolu yoktur', () => {
  assert.equal(CliAction.removal(tool({ shims: [] })), null);
  assert.equal(CliAction.removal(tool({ status: 'protected' })), null);
  assert.equal(CliAction.removal(null), null);
});

test('removable yalniz kaldirma yolu olan araclarda true doner', () => {
  assert.equal(CliAction.removable(tool()), true);
  assert.equal(CliAction.removable(tool({ source: 'npm-global' })), false);
});
