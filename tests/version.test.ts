import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentVersion } from '../src/util/version.ts';

function tempEntry(pkg: string | null): string {
  const root = mkdtempSync(join(tmpdir(), 'residue-version-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  if (pkg !== null) writeFileSync(join(root, 'package.json'), pkg, 'utf8');
  return join(bin, 'entry.mjs');
}

test('currentVersion package.json surumunu okur', () => {
  assert.equal(currentVersion(tempEntry('{"version":"1.2.3"}')), '1.2.3');
});

test('currentVersion eksik/bozuk package.json icin unknown doner', () => {
  assert.equal(currentVersion(tempEntry(null)), 'unknown');
  assert.equal(currentVersion(tempEntry('not json')), 'unknown');
  assert.equal(currentVersion(tempEntry('{"version":""}')), 'unknown');
  assert.equal(currentVersion(tempEntry('{"name":"x"}')), 'unknown');
  assert.equal(currentVersion(''), 'unknown');
});
