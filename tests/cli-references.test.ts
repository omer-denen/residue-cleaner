import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchProcesses, parseScheduledTaskRefs } from '../src/core/cli-references.ts';
import type { CliTool } from '../src/core/cli-inventory-types.ts';

function tool(over: Partial<CliTool> = {}): CliTool {
  return {
    id: 'demo',
    command: 'demo',
    source: 'standalone',
    packageName: 'demo',
    version: '1.0.0',
    installPath: 'C:\\Tools\\demo\\demo.exe',
    shims: ['C:\\bin\\demo.exe'],
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

test('matchProcesses ad, kurulum yolu, klasor ve shim ile eslesir', () => {
  const tools = [tool(), tool({ id: 'other', command: 'other', installPath: 'C:\\Other\\other.exe', shims: [] })];
  const byName = matchProcesses(tools, [{ name: 'demo.exe', commandLine: '' }]);
  assert.equal(byName.get('demo')?.[0]?.kind, 'process');

  const byPath = matchProcesses(tools, [{ name: 'x.exe', commandLine: 'C:\\Tools\\demo\\demo.exe --run' }]);
  assert.equal(byPath.get('demo')?.length, 1);

  const byDir = matchProcesses(tools, [{ name: 'x.exe', commandLine: '"C:\\Tools\\demo\\helper.exe"' }]);
  assert.equal(byDir.get('demo')?.length, 1);

  const byShim = matchProcesses(tools, [{ name: 'x.exe', commandLine: 'C:\\bin\\demo.exe' }]);
  assert.equal(byShim.get('demo')?.length, 1);
});

test('matchProcesses genel surecleri ve korunan araclari eslestirmez', () => {
  const out = matchProcesses(
    [tool({ status: 'protected' }), tool({ id: 'empty', shims: [], installPath: '' })],
    [{ name: 'node.exe', commandLine: 'node server.js' }],
  );
  assert.equal(out.size, 0);
});

test('matchProcesses ayni arac icin tek surec kaniti tutar', () => {
  const out = matchProcesses(
    [tool()],
    [
      { name: 'demo.exe', commandLine: 'one' },
      { name: 'demo.exe', commandLine: 'two' },
    ],
  );
  assert.equal(out.get('demo')?.length, 1);
  assert.match(out.get('demo')?.[0]?.detail ?? '', /demo\.exe/);
});

test('parseScheduledTaskRefs gorev adini ikinci CSV alanindan alir', () => {
  const csv = [
    '"HostName","TaskName","Next Run Time","Status"',
    '"PC","\\demo","2026-01-01","Ready"',
    '"PC","\\Other","2026-01-01","Ready"',
  ].join('\r\n');
  const out = parseScheduledTaskRefs([tool()], csv);
  assert.equal(out.get('demo')?.length, 1);
  assert.equal(out.get('demo')?.[0]?.path, '\\demo');
  assert.equal(out.get('demo')?.[0]?.kind, 'scheduled-task');
});

test('parseScheduledTaskRefs shim yolundan ve tek alanli satirdan eslesir', () => {
  const csv = '"C:\\bin\\demo.exe --daily"\r\n';
  const out = parseScheduledTaskRefs([tool()], csv);
  assert.equal(out.get('demo')?.[0]?.path, 'C:\\bin\\demo.exe --daily');
});

test('parseScheduledTaskRefs korunan araci atlar, bos satirlari yok sayar', () => {
  const out = parseScheduledTaskRefs([tool({ status: 'protected' })], '\r\n""\r\n');
  assert.equal(out.size, 0);
});
