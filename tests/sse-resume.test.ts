import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { SCAN_EVENT_BUFFER } from '../src/services/scan-service.ts';

const ENV_KEYS = ['LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'TEMP', 'TMP', 'HOME', 'npm_config_prefix'];

let sandbox = '';
const origEnv: Record<string, string | undefined> = {};
let server: Server;
let base = '';
let token = '';
let scanRoot = '';
let scanId = '';
let events: { id: number; data: any }[] = [];

async function readSSE(url: string, headers: Record<string, string> = {}): Promise<{ id: number; data: any }[]> {
  const res = await fetch(url, { headers });
  const reader = (res.body as any).getReader();
  const dec = new TextDecoder();
  let buf = '';
  const out: { id: number; data: any }[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let id = 0;
      const dataLines: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('id:')) id = Number(line.slice(3).trim());
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length) {
        try {
          out.push({ id, data: JSON.parse(dataLines.join('\n')) });
        } catch {
          /* ignore */
        }
      }
    }
  }
  return out;
}

before(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'residue-sse-test-env-'));
  for (const k of ENV_KEYS) {
    origEnv[k] = process.env[k];
    process.env[k] = sandbox;
  }
  scanRoot = await mkdtemp(join(tmpdir(), 'residue-sse-fixture-'));
  const FOLDERS = 350;
  for (let i = 0; i < FOLDERS; i++) {
    const dir = join(scanRoot, `c${i}`);
    await mkdir(join(dir, 'Cache'), { recursive: true });
    await writeFile(join(dir, 'CACHEDIR.TAG'), 'Signature: 8a477f597d28d172789f06886806bc55\n');
    for (let j = 0; j < 3; j++) await writeFile(join(dir, 'Cache', `f${j}.bin`), 'x'.repeat(1024));
  }

  const { createApiServer } = await import('../src/web/server.ts');
  const created = createApiServer({ persistScan: false, envs: [] });
  server = created.server;
  token = created.token;
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  base = `http://127.0.0.1:${(addr as any).port}`;

  const startRes = await fetch(`${base}/api/scan`, {
    method: 'POST',
    headers: { 'x-residue-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ roots: [scanRoot] }),
  });
  assert.equal(startRes.status, 202);
  const body = (await startRes.json()) as { scanId: string };
  scanId = body.scanId;
  events = await readSSE(`${base}/api/scan/${scanId}/events`, { 'x-residue-token': token });
});

after(async () => {
  (server as any).closeAllConnections?.();
  await new Promise<void>((ok) => server.close(() => ok()));
  for (const k of ENV_KEYS) {
    if (origEnv[k] === undefined) delete process.env[k];
    else process.env[k] = origEnv[k];
  }
  await rm(sandbox, { recursive: true, force: true });
  await rm(scanRoot, { recursive: true, force: true });
});

test('A: olay kimlikleri 1..N artan ve N >= SCAN_EVENT_BUFFER', () => {
  const ids = events.map((e) => e.id);
  assert.ok(ids.length >= SCAN_EVENT_BUFFER, `olay sayisi ${ids.length} < ${SCAN_EVENT_BUFFER}`);
  for (let i = 1; i < ids.length; i++) {
    assert.ok((ids[i] as number) > (ids[i - 1] as number), `kimlik artmiyor: ${ids[i - 1]} -> ${ids[i]}`);
  }
  // Ilk olay sunucunun anlik gorunum (snapshot) progress'idir ve id tasimaz (0).
  // Ardindan gelen akan olaylar 1..N kesin artandir.
  const streamed = ids.filter((x) => x > 0);
  assert.equal(streamed[0]!, 1, 'akan olaylar 1 ile baslamali');
  for (let i = 1; i < streamed.length; i++) {
    assert.equal(streamed[i]!, streamed[i-1]! + 1, 'akan kimlikler ardisik olmali');
  }
});

test('B: replay dilimi Last-Event-ID N-1000 -> 1000 olay, N-999..N', async () => {
  const N = events[events.length-1]!.id;
  const replayed = await readSSE(`${base}/api/scan/${scanId}/events`, {
    'x-residue-token': token,
    'last-event-id': String(N - 1000),
  });
  assert.equal(replayed.length, 1000, `replay ${replayed.length} olay`);
  for (let i = 0; i < replayed.length; i++) {
    assert.equal(replayed[i]!.id, N - 999 + i, `kimlik uyusmuyor idx ${i}`);
  }
});

test('C: tampon disi istek (N-BUFFER-5) -> replay yok, ilk olay progress', async () => {
  const N = events[events.length-1]!.id;
  const lastId = N - SCAN_EVENT_BUFFER - 5;
  const out = await readSSE(`${base}/api/scan/${scanId}/events?lastEventId=${lastId}`, {
    'x-residue-token': token,
  });
  assert.ok(out.length > 0, 'anlik gorunum bos');
  assert.equal(out[0]!.data.type, 'progress', `ilk olay ${out[0]!.data.type}`);
});

test('D: gecersiz Last-Event-ID -> cokme yok, anlik gorunum', async () => {
  const out = await readSSE(`${base}/api/scan/${scanId}/events`, {
    'x-residue-token': token,
    'last-event-id': 'abc',
  });
  assert.ok(out.length > 0, 'anlik gorunum bos');
  assert.equal(out[0]!.data.type, 'progress', `ilk olay ${out[0]!.data.type}`);
});

test('E: son kimlik Last-Event-ID N -> hic olay, akis kapanir', async () => {
  const N = events[events.length-1]!.id;
  const out = await readSSE(`${base}/api/scan/${scanId}/events`, {
    'x-residue-token': token,
    'last-event-id': String(N),
  });
  assert.equal(out.length, 0, `beklenmeyen olay: ${out.length}`);
});

test('F: tampon tavani — Last-Event-ID N-BUFFER -> tam BUFFER olay', async () => {
  const N = events[events.length-1]!.id;
  const replayed = await readSSE(`${base}/api/scan/${scanId}/events`, {
    'x-residue-token': token,
    'last-event-id': String(N - SCAN_EVENT_BUFFER),
  });
  assert.equal(replayed.length, SCAN_EVENT_BUFFER, `replay ${replayed.length} olay`);
  assert.equal(replayed[0]!.id, N - SCAN_EVENT_BUFFER + 1, 'tamponun ilk kimligi');
  assert.equal(replayed[replayed.length - 1]!.id, N, 'tamponun son kimligi');
});