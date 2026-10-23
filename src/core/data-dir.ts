import { join } from 'node:path';

/**
 * Aracin kendi veri dizini (gunluk, kasa, tarama onbellegi, ayarlar).
 *
 * Tek kaynak: bu dosya. Diger moduller yol uydurmaz, buradan alir.
 */

/** Guncel veri dizini adi (LOCALAPPDATA altinda). */
export const DATA_DIR_NAME = 'residue';

/** Guncel veri dizininin tam yolu. */
export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.LOCALAPPDATA ?? '.', DATA_DIR_NAME);
}
