import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzePathSources, expandEnv, parseRegPath } from '../src/core/path-sources.ts';

test('parseRegPath REG_SZ / REG_EXPAND_SZ degerlerini okur', () => {
  assert.equal(parseRegPath('    Path    REG_SZ    C:\\bin'), 'C:\\bin');
  assert.equal(parseRegPath('  path  REG_EXPAND_SZ  %USERPROFILE%\\bin  \r\n'), '%USERPROFILE%\\bin');
  assert.equal(parseRegPath('HKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    C:\\a;C:\\b\r\n'), 'C:\\a;C:\\b');
  assert.equal(parseRegPath('    TEMP    REG_SZ    C:\\temp'), null);
  assert.equal(parseRegPath(''), null);
});

test('expandEnv harf duyarsiz genisletir, bilinmeyeni birakir', () => {
  assert.equal(expandEnv('%HOME%\\x;%bin%', { HOME: 'C:\\Users\\A', BIN: 'C:\\Tools' }), 'C:\\Users\\A\\x;C:\\Tools');
  assert.equal(expandEnv('%MISSING%\\x', { HOME: 'C:\\' }), '%MISSING%\\x');
  assert.equal(expandEnv('no variables', {}), 'no variables');
  assert.equal(expandEnv('%A%/%B%', { A: 'a', B: 'b' }), 'a/b');
});

test('analyzePathSources kaynak, sira ve tekil sayiyi korur', () => {
  const r = analyzePathSources(
    'C:\\bin;%LOCAL%\\tools',
    'C:\\Windows;C:\\bin',
    'C:\\bin;C:\\Windows;C:\\Tools',
    { LOCAL: 'C:\\Local' },
  );
  assert.deepEqual(r.userDirs, ['C:\\bin', 'C:\\Local\\tools']);
  assert.deepEqual(r.machineDirs, ['C:\\Windows', 'C:\\bin']);
  assert.equal(r.mergedDirs, 3);
  assert.equal(r.duplicates.length, 1);
  assert.equal(r.duplicates[0]?.path, 'C:\\bin');
  assert.deepEqual(r.duplicates[0]?.sources, ['user', 'machine']);
});

test('analyzePathSources bos parcalari, tekrarlari ve yazim farklarini eler', () => {
  const r = analyzePathSources(
    'C:\\Bin\\;c:/bin;C:\\BIN;;  ',
    '',
    '',
    {},
  );
  assert.deepEqual(r.userDirs, ['C:\\Bin\\']);
  assert.equal(r.duplicates.length, 1);
  assert.match(r.duplicates[0]?.detail ?? '', /User PATH icinde 3 kez/);
  assert.deepEqual(r.duplicates[0]?.sources, ['user']);
});

test('analyzePathSources makine ici tekrari da cakisma sayar', () => {
  const r = analyzePathSources('', 'C:\\a;C:\\A;', 'C:\\a', {});
  assert.equal(r.duplicates.length, 0, 'ayni kaynakta tekrar sources tek eleman oldugu icin ana kural yakalamaz');
  assert.equal(r.machineDirs.length, 1);
});
