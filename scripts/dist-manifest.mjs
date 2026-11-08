#!/usr/bin/env node
/**
 * Dagitim manifesti uretici (scoop kanali).
 *
 *   tsx scripts/dist-manifest.mjs --verify-local   # yerel tarball icerigini denetle
 *   tsx scripts/dist-manifest.mjs                  # beta kanali icin manifest yaz
 *   tsx scripts/dist-manifest.mjs --tag latest     # kararli kanal
 *   tsx scripts/dist-manifest.mjs --dry-run        # yazma, ekrana bas
 *
 * Kanit kurali: manifest yalnizca yayindaki tarball gerekli dosyalari
 * ICERIYORSA yazilir; eksikse hicbir sey yazilmaz ve cikis kodu 1 olur.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DIST_PACKAGE_NAME,
  buildScoopManifest,
  checkverUrl,
  parseTarEntries,
  scoopReadiness,
  tarballUrl,
  validateScoopManifest,
} from '../src/core/dist-manifest.ts';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outFile = join(root, 'packaging', 'scoop', 'bucket', 'residue.json');

const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const useNodeNpm = existsSync(npmCli);
const npmCommand = useNodeNpm ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmArgs = (args) => (useNodeNpm ? [npmCli, ...args] : args);

function argOf(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : fallback;
}

const hasFlag = (name) => process.argv.includes(name);

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function integrityOf(buffer) {
  return `sha512-${createHash('sha512').update(buffer).digest('base64')}`;
}

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

function entriesFromTarball(buffer) {
  const tar = buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer) : buffer;
  return parseTarEntries(new Uint8Array(tar));
}

async function registryVersion(tag) {
  const url = checkverUrl(tag);
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) fail([`npm kayit defteri yanit vermedi: ${url} -> ${response.status}`]);
  const body = await response.json();
  const version = body?.version;
  if (typeof version !== 'string') fail([`surum okunamadi: ${url}`]);
  return { version, dist: body.dist ?? {} };
}

async function verifyLocal() {
  const raw = execFileSync(npmCommand, npmArgs(['pack', '--dry-run', '--json', '--ignore-scripts']), {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const parsed = JSON.parse(raw);
  const files = (Array.isArray(parsed) ? parsed[0]?.files ?? [] : []).map((file) => `package/${file.path}`);
  if (files.length === 0) fail(['npm pack --dry-run dosya listesi bos; dogrulama yapilamadi.']);

  const readiness = scoopReadiness(files);
  const headline = `Yerel tarball: ${files.length} dosya`;
  if (!readiness.ready) {
    fail([
      `${headline} — scoop icin HAZIR DEGIL.`,
      `Eksik: ${readiness.missing.join(', ')}`,
      '',
      'Scoop shim katmani `.mjs` baglayamaz (bash varsayar); pakette',
      '"bin/residue.cmd" bulunmak zorunda. Dosya depoda var mi kontrol et',
      've package.json "files" icinde "bin/" gectiginden emin ol.',
    ]);
  }
  console.log(`${headline} — scoop icin hazir (bin/residue.cmd pakette).`);
}

async function generate() {
  const tag = argOf('--tag', 'beta');
  const localTarball = argOf('--tarball', null);

  let version;
  let buffer;
  let dist = {};

  if (localTarball) {
    // Yayin oncesi dogrulama: yayindaki surum yerine yerel `npm pack` ciktisi.
    version = argOf('--version', JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version);
    buffer = readFileSync(localTarball);
    console.log(`Kaynak: yerel tarball ${localTarball}`);
  } else {
    const resolved = await registryVersion(tag);
    version = resolved.version;
    dist = resolved.dist;
    const url = dist.tarball ?? tarballUrl(version);
    const response = await fetch(url);
    if (!response.ok) fail([`tarball indirilemedi: ${url} -> ${response.status}`]);
    buffer = Buffer.from(await response.arrayBuffer());
  }

  if (typeof dist.integrity === 'string' && dist.integrity !== integrityOf(buffer)) {
    fail(['tarball butunlugu kayit defteriyle uyusmuyor (integrity).', `  beklenen: ${dist.integrity}`, `  olculen : ${integrityOf(buffer)}`]);
  }

  const entries = entriesFromTarball(buffer);
  const readiness = scoopReadiness(entries);
  if (!readiness.ready) {
    fail([
      `residue-cleaner@${version} tarball'i scoop icin HAZIR DEGIL.`,
      `Eksik: ${readiness.missing.join(', ')}`,
      '',
      'Bu surum yayinlanmis ama icinde cmd sarmalayici yok. Cozum:',
      '  1) bin/residue.cmd depoda (bu commit ile geldi)',
      '  2) sonraki surumu yayinla (or. 0.3.0-beta.2)',
      '  3) sonra bu komutu tekrar calistir',
      '',
      'Manifest yazilmadi.',
    ]);
  }

  const manifest = buildScoopManifest({ version, sha256: sha256(buffer), tag });
  const problems = validateScoopManifest(manifest);
  if (problems.length > 0) fail(['Manifest kendi icinde tutarsiz:', ...problems.map((p) => `  - ${p}`)]);

  if (hasFlag('--dry-run')) {
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Manifest yazildi: ${relative(root, outFile)}`);
  console.log(`  surum : ${version} (${tag} etiketi)`);
  console.log(`  hash  : ${manifest.hash}`);
  console.log(`  dosya : ${entries.length}`);
}

if (hasFlag('--verify-local')) {
  await verifyLocal();
} else {
  await generate();
}
