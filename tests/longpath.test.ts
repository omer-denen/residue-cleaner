import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorCode, isDenied, isLongPathError, longPath, prettyPath } from '../src/util/longpath.ts';

test('longPath uzun yol onekini dogru uygular', () => {
  assert.equal(longPath('\\\\?\\C:\\x'), '\\\\?\\C:\\x');
  assert.equal(longPath('\\\\server\\share\\x'), '\\\\?\\UNC\\server\\share\\x');
  assert.equal(longPath('C:\\'), 'C:\\');
  assert.equal(longPath('C:'), 'C:\\');
  assert.equal(longPath('relative\\x'), 'relative\\x');
  assert.equal(longPath('C:\\Users\\x'), '\\\\?\\C:\\Users\\x');
  assert.equal(longPath('D:/Users/x'), '\\\\?\\D:/Users/x');
});

test('hata yardimcilari yalniz bilinen kodlari tanir', () => {
  assert.equal(isLongPathError({ code: 'ENAMETOOLONG' }), true);
  assert.equal(isLongPathError({ code: 'ERR_FS_FILE_TOO_LARGE' }), true);
  assert.equal(isLongPathError({ code: 'ENOENT' }), false);
  assert.equal(isLongPathError(null), false);
  assert.equal(isDenied({ code: 'EACCES' }), true);
  assert.equal(isDenied({ code: 'EPERM' }), true);
  assert.equal(isDenied({ code: 'ENOENT' }), false);
  assert.equal(errorCode({ code: 'EBUSY' }), 'EBUSY');
  assert.equal(errorCode(undefined), undefined);
});

test('prettyPath LOCALAPPDATA, APPDATA ve ev dizinini kisaltir', () => {
  const env = { USERPROFILE: 'C:\\Users\\A', LOCALAPPDATA: 'C:\\Users\\A\\AppData\\Local', APPDATA: 'C:\\Users\\A\\AppData\\Roaming' };
  assert.equal(prettyPath('C:\\Users\\A\\AppData\\Local\\Temp\\x', env), '%LOCALAPPDATA%\\Temp\\x');
  assert.equal(prettyPath('C:\\Users\\A\\AppData\\Roaming\\x', env), '%APPDATA%\\x');
  assert.equal(prettyPath('C:\\Users\\A\\docs\\x', env), '~\\docs\\x');
  assert.equal(prettyPath('D:\\other\\x', env), 'D:\\other\\x');
});

test('prettyPath ev dizini yokken yolu degistirmez', () => {
  assert.equal(prettyPath('C:\\x', {}), 'C:\\x');
});
