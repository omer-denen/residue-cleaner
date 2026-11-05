import { access } from 'node:fs/promises';
import { longPath } from './longpath.ts';

/**
 * Yol var mi? Uzun yol destekli; hata durumunda `false` doner.
 *
 * Kasa geri yukleme yaniti (`originalExists`) bu yardimciyi kullanir.
 * Eski Windows Geri Donusum Kutusu yolu (Shell.Application `undelete`)
 * 2.x'te kaldirildi; geri alma yalniz kasadan yapilir.
 */
export async function exists(p: string): Promise<boolean> {
  try {
    await access(longPath(p));
    return true;
  } catch {
    return false;
  }
}
