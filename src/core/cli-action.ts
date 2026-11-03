import type { CliTool } from './cli-inventory-types.ts';

/**
 * Bir araci kaldirma yolu.
 *
 * - `package`: paket yoneticisinin kendi uninstall komutu.
 * - `quarantine`: paket yoneticisi olmayan bagimsiz arac; shim'ler kasaya
 *   tasinir, durum klasorleri kopyalanir.
 */
export type CliRemovalKind = 'package' | 'quarantine';

/**
 * Arac kaldirma karari.
 *
 * Arayuz "uninstall var mi" diye kendi kararini vermez; hangi yolun
 * kullanilacagi bu motordan gelir. Boylece bagimsiz araclar da tek
 * kaldirma akisiyla gorunur olur.
 */
export class CliAction {
  static removal(tool: CliTool | null | undefined): CliRemovalKind | null {
    if (!tool || tool.status === 'protected') return null;
    if (tool.uninstall) return 'package';
    if (tool.source === 'standalone' && tool.shims.length > 0) return 'quarantine';
    return null;
  }

  static removable(tool: CliTool | null | undefined): boolean {
    return CliAction.removal(tool) !== null;
  }
}
