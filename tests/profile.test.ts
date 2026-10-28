import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { ApprovalRules, type ApprovalKind } from '../src/core/approval.ts';

const ALLOWED_UIPROFILE_FILES = new Set([
  'src/core/contract.ts',
  'src/core/profile.ts',
  'src/store/settings.ts',
  'src/services/scan-service.ts',
  'src/web/server.ts',
]);

function walkFiles(dir: string, base: string = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkFiles(full, base));
    } else if (st.isFile() && (full.endsWith('.ts') || full.endsWith('.tsx'))) {
      out.push(full.slice(base.length + 1).replace(/\\/g, '/'));
    }
  }
  return out;
}

test('PROFILE-01: fresh sandbox default uiProfile hybrid', async () => {
  const root = await mkdtemp(join(tmpdir(), 'residue-profile-01-'));
  process.env.LOCALAPPDATA = root;
  const { loadSettings } = await import('../src/store/settings.ts');
  const { normalizeUserProfile } = await import('../src/core/profile.ts');
  const s = await loadSettings();
  assert.equal(s.uiProfile, 'hybrid');
  assert.equal(normalizeUserProfile(undefined), 'hybrid');
  assert.equal(normalizeUserProfile('admin'), 'hybrid');
  await rm(root, { recursive: true, force: true });
});

test('PROFILE-02: saveSettings roundtrip + invalid normalize', async () => {
  const root = await mkdtemp(join(tmpdir(), 'residue-profile-02-'));
  process.env.LOCALAPPDATA = root;
  const { loadSettings, saveSettings } = await import('../src/store/settings.ts');
  await saveSettings({ uiProfile: 'vibe' });
  const s = await loadSettings();
  assert.equal(s.uiProfile, 'vibe');
  await saveSettings({ uiProfile: 'admin' as never });
  const s2 = await loadSettings();
  assert.equal(s2.uiProfile, 'hybrid');
  await rm(root, { recursive: true, force: true });
});

test('PROFILE-01/02: isUserProfile valid identities; DEVELOPER not recognized', async () => {
  const { isUserProfile } = await import('../src/core/profile.ts');
  assert.equal(isUserProfile('developer'), true);
  assert.equal(isUserProfile('vibe'), true);
  assert.equal(isUserProfile('hybrid'), true);
  assert.equal(isUserProfile('DEVELOPER'), false);
});

test('PROFILE-06: ApprovalRules phrases constant; persona not included', () => {
  const expected: Record<string, string> = {
    delete: 'SIL',
    vaultMove: 'TASI',
    repair: 'ONAR',
    quarantine: 'KARANTINA',
    vaultPurge: 'BOŞALT',
    projectRestore: 'KUR',
    envClean: 'TEMIZLE',
    schedule: 'PLANLA',
    advanced: 'GELİŞMİŞ',
  };
  for (const [kind, phrase] of Object.entries(expected)) {
    assert.equal(ApprovalRules.phrase(kind as ApprovalKind), phrase, kind);
  }
});

test('source hygiene: uiProfile only in allowed files', () => {
  const root = process.cwd();
  const srcDir = join(root, 'src');
  const files = walkFiles(srcDir, root);
  const offenders: string[] = [];
  for (const f of files) {
    if (ALLOWED_UIPROFILE_FILES.has(f)) continue;
    const txt = readFileSync(join(root, f), 'utf8');
    if (txt.includes('uiProfile')) offenders.push(f);
  }
  assert.deepEqual(offenders, [], `uiProfile found in: ${offenders.join(', ')}`);
});