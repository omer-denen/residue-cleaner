import assert from 'node:assert/strict';
import test from 'node:test';
import type { EnvAnalysis, PathEntry } from '../src/core/env-engine.ts';
import { EnvSelection } from '../src/core/env-view.ts';

function analysis(entries: PathEntry[]): EnvAnalysis {
  return {
    snapshot: { user: [], machine: [] },
    effectivePath: entries.map((e) => e.expanded),
    pathEntries: entries,
    orphanVariables: [],
    commandShadows: [],
    findings: [],
  };
}

const userMissing: PathEntry = {
  scope: 'user',
  index: 0,
  raw: 'C:\\yok',
  expanded: 'C:\\yok',
  exists: false,
};
const userDuplicate: PathEntry = {
  scope: 'user',
  index: 1,
  raw: 'C:\\bin',
  expanded: 'C:\\bin',
  exists: true,
  duplicateOf: 0,
};
const userOk: PathEntry = {
  scope: 'user',
  index: 2,
  raw: 'C:\\ok',
  expanded: 'C:\\ok',
  exists: true,
};
const machineMissing: PathEntry = {
  scope: 'machine',
  index: 0,
  raw: 'C:\\yok-makine',
  expanded: 'C:\\yok-makine',
  exists: false,
};

test('PATH girdi durumlari kanittan gelir', () => {
  const view = EnvSelection.entries(
    analysis([userMissing, userDuplicate, userOk, machineMissing]),
  );
  assert.deepEqual(
    view.map((entry) => [entry.id, entry.state, entry.removable]),
    [
      ['user:0', 'missing', true],
      ['user:1', 'duplicate', true],
      ['user:2', 'ok', false],
      ['machine:0', 'missing', true],
    ],
  );
});

test('kapsam secimi yalnizca o kapsamin adaylarini verir', () => {
  const a = analysis([userMissing, userDuplicate, userOk, machineMissing]);
  assert.deepEqual(EnvSelection.candidateIds(a, 'user'), ['user:0', 'user:1']);
  assert.deepEqual(EnvSelection.candidateIds(a, 'machine'), ['machine:0']);
  assert.deepEqual(EnvSelection.candidateIds(a, 'both'), ['user:0', 'user:1', 'machine:0']);
});

test('golgede kalan girdi kaldirilamaz', () => {
  const shadowed: PathEntry = {
    scope: 'user',
    index: 0,
    raw: 'C:\\bin',
    expanded: 'C:\\bin',
    exists: true,
    shadowedBy: 0,
  };
  const [view] = EnvSelection.entries(analysis([shadowed]));
  assert.equal(view?.state, 'shadowed');
  assert.equal(view?.removable, false);
});

test('gecersiz kimlikler secimden dusurulur', () => {
  const a = analysis([userMissing, userDuplicate]);
  assert.deepEqual(EnvSelection.retain(a, ['user:0', 'user:9', 'machine:0']), ['user:0']);
});
