/**
 * Dagitim manifesti motoru (saf TS, node builtin YOK).
 *
 * Amac: npm tarball'inin GERCEK icerigine bakarak paket yoneticisi
 * manifestini uretmek. Karar burada verilir, dosya/ag isi
 * `scripts/dist-manifest.mjs` icindedir (B18 deseni: karar cekirdekte,
 * uygulama disarida).
 *
 * Kanit kurali: manifest ancak tarball gerekli dosyalari ICERIYORSA
 * uretilir. Eksikse manifest yazilmaz — "muhtemelen olur" denmez.
 */

export const DIST_PACKAGE_NAME = 'residue-cleaner';
export const DIST_REGISTRY = 'https://registry.npmjs.org';
export const DIST_HOMEPAGE = 'https://github.com/omer-denen/residue-cleaner#readme';
export const DIST_LICENSE = 'MIT';
export const DIST_DESCRIPTION =
  'Evidence-first cleaner and auditor for developer caches, CLI installs and AI runtime leftovers.';

/**
 * Scoop shim'i yalnizca `.exe|.com`, `.bat|.cmd`, `.ps1`, `.jar`, `.py`
 * uzantilarini tanir; digerlerinde bash/cygwin varsayar (lib/core.ps1 ->
 * `function shim` son `else` dalI). Bu yuzden `.mjs` dogrudan baglanamaz:
 * pakette cmd sarmalayici bulunmak ZORUNDA.
 */
export const SCOOP_SHIM_ENTRY = 'package/bin/residue.cmd';
export const SCOOP_SHIM_BIN = 'bin\\residue.cmd';
export const SCOOP_SHIM_ALIASES = ['residue', 'residue-cleaner'] as const;
export const SCOOP_DEPENDS = ['nodejs'] as const;
export const SCOOP_MIN_ENTRIES: readonly string[] = [
  'package/package.json',
  'package/bin/residue.mjs',
  SCOOP_SHIM_ENTRY,
];

export interface ScoopReadiness {
  ready: boolean;
  missing: string[];
}

export interface ScoopManifestInput {
  version: string;
  sha256: string;
  tag: string;
  pkg?: string;
}

export interface ScoopManifest {
  $schema: string;
  version: string;
  description: string;
  homepage: string;
  license: string;
  depends: string[];
  url: string;
  hash: string;
  extract_dir: string;
  bin: string[][];
  notes: string[];
  checkver: { url: string; jsonpath: string };
  autoupdate: { url: string; hash: { mode: string } };
}

export function tarballUrl(version: string, pkg: string = DIST_PACKAGE_NAME): string {
  return `${DIST_REGISTRY}/${pkg}/-/${pkg}-${version}.tgz`;
}

export function checkverUrl(tag: string, pkg: string = DIST_PACKAGE_NAME): string {
  return `${DIST_REGISTRY}/${pkg}/${tag}`;
}

/**
 * gzip'i ACILMIS tar govdesinden dosya yollarini okur. Dizin kayitlari
 * atlanir; PAX/GNU uzun-ad kayitlari yalnizca boylariyla gecirilir.
 */
export function parseTarEntries(tar: Uint8Array): string[] {
  const paths: string[] = [];
  const decoder = new TextDecoder('utf-8');
  const blockSize = 512;

  const field = (start: number, length: number): string => {
    const slice = tar.subarray(start, start + length);
    const zero = slice.indexOf(0);
    const bytes = zero === -1 ? slice : slice.subarray(0, zero);
    return decoder.decode(bytes).trim();
  };

  let offset = 0;
  while (offset + blockSize <= tar.length) {
    const header = tar.subarray(offset, offset + blockSize);
    if (!header.some((byte) => byte !== 0)) break;

    const name = field(offset, 100);
    if (!name) break;

    const sizeField = field(offset + 124, 12);
    const parsed = sizeField ? Number.parseInt(sizeField, 8) : 0;
    const size = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    const prefix = field(offset + 345, 155);
    const type = tar[offset + 156] ?? 0;
    const path = prefix ? `${prefix}/${name}` : name;

    // 0x30 = '0' (regular file), 0x00 = eski tar duzeninde regular file.
    if ((type === 0 || type === 0x30) && path) paths.push(path);

    offset += blockSize + Math.ceil(size / blockSize) * blockSize;
  }

  return paths;
}

export function scoopReadiness(entries: readonly string[]): ScoopReadiness {
  const missing = SCOOP_MIN_ENTRIES.filter((entry) => !entries.includes(entry));
  return { ready: missing.length === 0, missing };
}

export function buildScoopManifest(input: ScoopManifestInput): ScoopManifest {
  const pkg = input.pkg ?? DIST_PACKAGE_NAME;
  return {
    $schema: 'https://raw.githubusercontent.com/ScoopInstaller/Schemas/master/schema.json',
    version: input.version,
    description: DIST_DESCRIPTION,
    homepage: DIST_HOMEPAGE,
    license: DIST_LICENSE,
    depends: [...SCOOP_DEPENDS],
    url: tarballUrl(input.version, pkg),
    hash: input.sha256.toLowerCase(),
    extract_dir: 'package',
    bin: SCOOP_SHIM_ALIASES.map((alias) => [SCOOP_SHIM_BIN, alias]),
    notes: ['Usage: residue --help', 'Browser UI: residue ui --web --no-browser'],
    checkver: { url: checkverUrl(input.tag, pkg), jsonpath: '$.version' },
    autoupdate: {
      url: `${DIST_REGISTRY}/${pkg}/-/${pkg}-$version.tgz`,
      hash: { mode: 'download' },
    },
  };
}

/** Manifestin kendi icinde tutarli olup olmadigini denetler. */
export function validateScoopManifest(manifest: ScoopManifest): string[] {
  const problems: string[] = [];
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
    problems.push(`gecersiz surum: ${manifest.version}`);
  }
  if (!/^[0-9a-f]{64}$/.test(manifest.hash)) {
    problems.push(`hash sha256 degil: ${manifest.hash}`);
  }
  if (!manifest.url.endsWith(`-${manifest.version}.tgz`)) {
    problems.push(`url surumle uyusmuyor: ${manifest.url}`);
  }
  if (manifest.extract_dir !== 'package') {
    problems.push(`extract_dir beklenen "package": ${manifest.extract_dir}`);
  }
  if (!manifest.depends.includes('nodejs')) {
    problems.push('depends nodejs icermeli');
  }
  const aliases = manifest.bin.map((pair) => pair[1]);
  for (const alias of SCOOP_SHIM_ALIASES) {
    if (!aliases.includes(alias)) problems.push(`bin alias eksik: ${alias}`);
  }
  for (const pair of manifest.bin) {
    if (pair[0] !== SCOOP_SHIM_BIN) problems.push(`bin hedefi cmd olmali: ${pair[0]}`);
  }
  if (!manifest.autoupdate.url.includes('$version')) {
    problems.push('autoupdate url $version kullanmali');
  }
  return problems;
}
