import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readState, renderHandoff, stateFile, writeState, type ProjectState } from '../src/util/state.ts';

function state(over: Partial<ProjectState> = {}): ProjectState {
  return {
    version: 1,
    updatedAt: '2026-11-03T00:00:00.000Z',
    project: { name: 'p', purpose: 'x', stack: 'ts', entry: 'bin' },
    commands: [],
    tasks: [],
    bugs: [],
    perf: [],
    actionsPerformed: [],
    openQuestions: [],
    ...over,
  };
}

test('renderHandoff bos durumda yalniz basligi yazar', () => {
  const out = renderHandoff(state());
  assert.match(out, /# Oturum devri/);
  assert.match(out, /Guncelleme: 2026-11-03/);
  assert.doesNotMatch(out, /DALGALAR|YARIDA|HATALAR|PERFORMANS|SORULAR/);
});

test('renderHandoff dalga, yarim is, hata, plan ve sorulari yazar', () => {
  const out = renderHandoff(
    state({
      waves: [
        { id: 'W1', title: 'Dalga', status: 'done', note: 'bitti' },
        { id: 'W2', title: 'Aktif', status: 'active' },
        { id: 'W3', title: 'Plan', status: 'planned' },
      ],
      tasks: [
        { id: 'T1', title: 'Yarim', status: 'wip', note: 'not', next: 'devam', updatedAt: '' },
        { id: 'T2', title: 'Todo', status: 'todo', next: 'basla', updatedAt: '' },
      ],
      bugs: [
        { title: 'Kritik', symptom: 's', cause: 'c', fix: 'f', status: 'open', severity: 'critical' },
        { title: 'Dusuk', symptom: 's2', cause: 'c2', fix: 'f2', status: 'open', severity: 'low' },
      ],
      perf: [{ what: 'tarama', value: '1s' }],
      actionsPerformed: ['dosya yazildi'],
      openQuestions: ['soru?'],
    }),
  );
  assert.match(out, /## DALGALAR/);
  assert.match(out, /W1.*tamam.*bitti/);
  assert.match(out, /W2.*suruyor/);
  assert.match(out, /W3.*planli/);
  assert.match(out, /YARIDA KALAN ISE/);
  assert.match(out, /T1/);
  assert.match(out, /Siradaki adim/);
  assert.match(out, /KRITIK \/ YUKSEK/);
  assert.match(out, /ACIK HATALAR/);
  assert.match(out, /T2/);
  assert.match(out, /OLCULEN PERFORMANS/);
  assert.match(out, /BU OTURUMDA/);
  assert.match(out, /ACIK SORULAR/);
});

test('renderHandoff yalniz kritik olmayan hata varsa ACIK HATALAR yazar', () => {
  const out = renderHandoff(
    state({
      bugs: [
        { title: 'Orta', symptom: 's', cause: 'c', fix: 'f', status: 'partial', severity: 'medium' },
      ],
    }),
  );
  assert.doesNotMatch(out, /KRITIK/);
  assert.match(out, /ACIK HATALAR/);
});

test('readState/writeState gidis-donus ve eksik dosya', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'residue-state-'));
  assert.equal(await readState(dir), null);
  const s = state();
  await writeState(s, dir);
  const back = await readState(dir);
  assert.equal(back?.project.name, 'p');
  assert.equal(back?.version, 1);
  assert.notEqual(back?.updatedAt, '');
  writeFileSync(stateFile(dir), 'not json', 'utf8');
  assert.equal(await readState(dir), null);
});
