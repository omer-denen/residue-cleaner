/**
 * Dagitim manifesti testleri (ag YOK, dosya sistemi yalnizca depo icinden
 * okunur).
 *
 * Kapsanan kararlar:
 *  - tar govdesinden dosya listesi dogru okunuyor mu (dizin kaydi atlanir)
 *  - scoop icin "hazir" olma kosulu cmd sarmalayiciya bagli mi
 *  - manifest kendi icinde tutarli mi (surum/hash/url/bin/depends)
 *  - depodaki bin/residue.cmd gercekten paketle yollaniyor mu
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCOOP_MIN_ENTRIES,
  SCOOP_SHIM_BIN,
  SCOOP_SHIM_ENTRY,
  buildScoopManifest,
  checkverUrl,
  parseTarEntries,
  scoopReadiness,
  tarballUrl,
  validateScoopManifest,
} from '../src/core/dist-manifest.ts';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function tarHeader(name: string, size: number, type: string): Uint8Array {
  const header = new Uint8Array(512);
  const encoder = new TextEncoder();
  header.set(encoder.encode(name).subarray(0, 100), 0);
  header.set(encoder.encode('0000644\0'), 100);
  header.set(encoder.encode('0000000\0'), 108);
  header.set(encoder.encode('0000000\0'), 116);
  header.set(encoder.encode(`${size.toString(8).padStart(11, '0')}\0`), 124);
  header.set(encoder.encode('00000000000\0'), 136);
  header.set(encoder.encode('        '), 148);
  header.set(encoder.encode(type), 156);
  header.set(encoder.encode('ustar\0'), 257);
  header.set(encoder.encode('00'), 263);
  return header;
}

function makeTar(entries: Array<{ name: string; body?: string; type?: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const entry of entries) {
    const body = encoder.encode(entry.body ?? '');
    chunks.push(tarHeader(entry.name, body.length, entry.type ?? '0'));
    if (body.length > 0) {
      chunks.push(body);
      const pad = (512 - (body.length % 512)) % 512;
      if (pad > 0) chunks.push(new Uint8Array(pad));
    }
  }
  chunks.push(new Uint8Array(1024));
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

const fullEntries = [...SCOOP_MIN_ENTRIES];

test('parseTarEntries: dosya yollarini okur, dizin kaydini atlar', () => {
  const tar = makeTar([
    { name: 'package/', type: '5' },
    { name: 'package/package.json', body: '{"name":"x"}' },
    { name: 'package/bin/residue.cmd', body: '@echo off\n' },
  ]);

  const entries = parseTarEntries(tar);
  assert.deepEqual(entries, ['package/package.json', 'package/bin/residue.cmd']);
  assert.equal(entries.includes('package/'), false);
});

test('parseTarEntries: 512 bayti asan govde sonraki basligi kaydirmaz', () => {
  const longBody = 'x'.repeat(1200);
  const entries = parseTarEntries(
    makeTar([
      { name: 'package/big.bin', body: longBody },
      { name: 'package/bin/residue.cmd', body: '@echo off\n' },
    ]),
  );
  assert.deepEqual(entries, ['package/big.bin', 'package/bin/residue.cmd']);
});

test('parseTarEntries: bos girdi bos liste dondurur', () => {
  assert.deepEqual(parseTarEntries(new Uint8Array(1024)), []);
});

test('scoopReadiness: cmd sarmalayici yoksa hazir degil', () => {
  const readiness = scoopReadiness(['package/package.json', 'package/bin/residue.mjs']);
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.missing, [SCOOP_SHIM_ENTRY]);
});

test('scoopReadiness: uc dosya da varsa hazir', () => {
  const readiness = scoopReadiness(fullEntries);
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.missing, []);
});

test('scoopReadiness: yalnizca cmd varsa digerleri eksik kalir', () => {
  const readiness = scoopReadiness([SCOOP_SHIM_ENTRY]);
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.missing, ['package/package.json', 'package/bin/residue.mjs']);
});

test('buildScoopManifest: surum, url ve hash tutarli', () => {
  const manifest = buildScoopManifest({ version: '0.3.0-beta.2', sha256: 'A'.repeat(64), tag: 'beta' });
  assert.equal(manifest.version, '0.3.0-beta.2');
  assert.equal(manifest.url, tarballUrl('0.3.0-beta.2'));
  assert.equal(manifest.url, 'https://registry.npmjs.org/residue-cleaner/-/residue-cleaner-0.3.0-beta.2.tgz');
  assert.equal(manifest.hash, 'a'.repeat(64), 'hash kucuk harfe cevrilmeli');
  assert.deepEqual(validateScoopManifest(manifest), []);
});

test('buildScoopManifest: iki komut adi da ayni cmd dosyasina baglanir', () => {
  const manifest = buildScoopManifest({ version: '1.0.0', sha256: 'b'.repeat(64), tag: 'latest' });
  assert.deepEqual(manifest.bin, [
    [SCOOP_SHIM_BIN, 'residue'],
    [SCOOP_SHIM_BIN, 'residue-cleaner'],
  ]);
  assert.equal(manifest.extract_dir, 'package');
  assert.deepEqual(manifest.depends, ['nodejs']);
});

test('buildScoopManifest: checkver secilen etikete bakar, autoupdate $version kullanir', () => {
  const beta = buildScoopManifest({ version: '0.3.0-beta.2', sha256: 'c'.repeat(64), tag: 'beta' });
  assert.equal(beta.checkver.url, checkverUrl('beta'));
  assert.equal(beta.checkver.url, 'https://registry.npmjs.org/residue-cleaner/beta');
  assert.equal(beta.checkver.jsonpath, '$.version');
  assert.equal(beta.autoupdate.url, 'https://registry.npmjs.org/residue-cleaner/-/residue-cleaner-$version.tgz');
  assert.equal(beta.autoupdate.hash.mode, 'download');

  const latest = buildScoopManifest({ version: '2.2.0', sha256: 'd'.repeat(64), tag: 'latest' });
  assert.equal(latest.checkver.url, 'https://registry.npmjs.org/residue-cleaner/latest');
});

test('validateScoopManifest: bozuk hash ve yanlis bin hedefini yakalar', () => {
  const manifest = buildScoopManifest({ version: '1.0.0', sha256: 'e'.repeat(64), tag: 'latest' });
  const broken = {
    ...manifest,
    hash: 'xyz',
    url: 'https://registry.npmjs.org/residue-cleaner/-/residue-cleaner-9.9.9.tgz',
    bin: [['bin\\residue.mjs', 'residue']],
  };
  const problems = validateScoopManifest(broken);
  assert.ok(problems.some((problem) => problem.includes('sha256')), 'hash sorunu bildirilmeli');
  assert.ok(problems.some((problem) => problem.includes('url')), 'url/surum uyusmazligi bildirilmeli');
  assert.ok(problems.some((problem) => problem.includes('cmd olmali')), 'bin hedefi cmd olmali');
  assert.ok(problems.some((problem) => problem.includes('residue-cleaner')), 'eksik alias bildirilmeli');
});

test('validateScoopManifest: depends nodejs olmadan gecerli saymaz', () => {
  const manifest = buildScoopManifest({ version: '1.0.0', sha256: 'f'.repeat(64), tag: 'latest' });
  const problems = validateScoopManifest({ ...manifest, depends: [] });
  assert.deepEqual(problems, ['depends nodejs icermeli']);
});

test('depo: bin/residue.cmd var, BOM yok, node ile residue.mjs cagirir', () => {
  const shim = readFileSync(join(root, 'bin', 'residue.cmd'));
  assert.notEqual(shim[0], 0xef, 'BOM olmamali');
  const text = shim.toString('utf8');
  assert.match(text, /node "%~dp0residue\.mjs" %\*/);
  assert.match(text, /where node >nul 2>nul/, 'node yoksa acik hata vermeli');
  assert.ok(/^[\x00-\x7f]*$/.test(text), 'cmd dosyasi ASCII olmali (kod sayfasi bozulmasin)');
});

test('depo: package.json "files" bin/ klasorunu paketliyor', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.ok(Array.isArray(pkg.files));
  assert.ok(pkg.files.includes('bin/'), 'bin/ paketlenmeli ki residue.cmd tarball\'a girsin');
  assert.equal(pkg.bin.residue, 'bin/residue.mjs', 'npm bin giris noktasi degismemeli');
});
