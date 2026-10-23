import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';

import { matchGraphNodes } from '../src/core/dependency-graph.ts';

// ---------------------------------------------------------------------------
// Saf eslestirici
// ---------------------------------------------------------------------------

test('matchGraphNodes: id tam eslesme uste; path eslesmesi etiketten onde', () => {
  const nodes = [
    // etiket tam esit (80)
    { id: 'ref:config:path1', label: 'C:\\Program Files\\bar\\bar.exe', kind: 'config' },
    // path tam esit (90) -> etiket tam esitten onde
    {
      id: 'tool:npm:bar',
      label: 'bar',
      kind: 'tool',
      path: 'C:\\Program Files\\bar\\bar.exe',
    },
    // hicbir alanda eslesme yok -> elenir
    { id: 'pkg:renklibarbun', label: 'renklibarbun', kind: 'package' },
  ];
  const r = matchGraphNodes(nodes, { text: 'C:\\Program Files\\bar\\bar.exe' });
  assert.deepEqual(r.map((n) => n.id), ['tool:npm:bar', 'ref:config:path1']);
});

test('matchGraphNodes: limit uygulanir; buyuk/kucuk harf ve \\// duyarsiz', () => {
  const nodes = [
    { id: 'pkg:baz', label: 'baz', kind: 'package' },
    { id: 'shim:baz', label: 'baz', kind: 'shim' },
    { id: 'tool:npm:baz', label: 'BAZ', kind: 'tool' },
    { id: 'tool:uv:baz', label: 'baz', kind: 'tool' },
  ];
  const r = matchGraphNodes(nodes, { text: 'Baz', limit: 2 });
  assert.equal(r.length, 2);
  // esit skorda id alfabetik
  assert.deepEqual(r.map((n) => n.id), ['pkg:baz', 'shim:baz']);

  const slash = matchGraphNodes(
    [
      { id: 'tool:npm:baz', label: 'baz', kind: 'tool', path: 'C:\\Tools\\Baz\\launcher.exe' },
      {
        id: 'tool:uv:baz',
        label: 'baz',
        kind: 'tool',
        path: 'C:\\Tools\\Faaliyet\\Baz\\other.exe',
      },
    ],
    { text: 'c:/tools/baz/LAUNCHER.EXE' },
  );
  assert.equal(slash[0]?.id, 'tool:npm:baz');
});

test('matchGraphNodes: bos sorgu bos doner', () => {
  const nodes = [{ id: 'pkg:baz', label: 'baz', kind: 'package' }];
  assert.deepEqual(matchGraphNodes(nodes, { text: '' }), []);
  assert.deepEqual(matchGraphNodes(nodes, { text: '   ' }), []);
});

test('matchGraphNodes: \\?\ uzun yol oneki normalize edilir', () => {
  const nodes = [
    {
      id: 'tool:npm:baz',
      label: 'baz',
      kind: 'tool',
      path: 'C:\\Tools\\Baz\\launcher.exe',
    },
  ];
  const r = matchGraphNodes(nodes, { text: '\\\\?\\C:\\Tools\\Baz\\launcher.exe' });
  assert.equal(r.length, 1);
  // Onek atilmazsa path tam eslesmesi 90 puanla yakalanirdi; onek
  // atildiginda 'C:/tools/baz/launcher.exe' ile tam esit olur.
  assert.equal(r[0]?.id, 'tool:npm:baz');
});

test('matchGraphNodes: esit puanda id alfabetik siralanir', () => {
  const nodes = [
    { id: 'shim:beta', label: 'ortak', kind: 'shim' },
    { id: 'tool:npm:alpha', label: 'ortak', kind: 'tool' },
    { id: 'pkg:delta', label: 'ortak', kind: 'package' },
    { id: 'shim:cicek', label: 'ortak', kind: 'shim' },
  ];
  const r = matchGraphNodes(nodes, { text: 'ortak' });
  // Hepsi etiketle tam esit (80): esitlikte id alfabetik.
  assert.deepEqual(r.map((n) => n.id), ['pkg:delta', 'shim:beta', 'shim:cicek', 'tool:npm:alpha']);
});

// ---------------------------------------------------------------------------
// Uc
// ---------------------------------------------------------------------------

let root = '';
let server: Server;
let base = '';
let token = '';

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'residue-deps-test-'));
  process.env.LOCALAPPDATA = root;
  const { createApiServer } = await import('../src/web/server.ts');
  const created = createApiServer({ persistScan: false, envs: [] });
  server = created.server;
  token = created.token;
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((ok) => server.close(() => ok()));
  await rm(root, { recursive: true, force: true });
});

test('GET /api/dependencies: bos sorgu 200 + note empty (400 degil)', async () => {
  const r = await fetch(`${base}/api/dependencies?q=`, {
    headers: { 'x-residue-token': token },
  });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { query?: string; note?: string };
  assert.equal(body.query, '');
  assert.equal(body.note, 'empty');
});

test('GET /api/dependencies: envanter yokken 200 + note no-cache (agir tarama YOK)', async () => {
  const r = await fetch(`${base}/api/dependencies?q=node`, {
    headers: { 'x-residue-token': token },
  });
  assert.equal(r.status, 200);
  assert.equal(r.statusText, 'OK');
  const body = (await r.json()) as { query?: string; note?: string; matched?: unknown[] };
  assert.equal(body.query, 'node');
  assert.equal(body.note, 'no-cache');
  assert.deepEqual(body.matched, []);
});
