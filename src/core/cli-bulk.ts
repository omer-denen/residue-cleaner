import type { CliTool } from './cli-inventory-types.ts';

/**
 * Arac listesinde toplu islem kapsami.
 *
 * Kaldirma/onarim/karantina icin "secilebilir" kumesini KANITTAN turetir:
 * - kaldirma: motorun `selectableIds` listesi (paket yoneticisi uninstall'i var)
 * - onarim: aracin `repair` komutu var (bozuk/yarim kurulum)
 * - karantina: paket yoneticisi olmayan (standalone) ve shim'i olan arac
 *
 * Arayuz bu kumeyi kendi hesaplamaz; yalnizca gosterir (kural 18).
 */
export type CliBulkKind = 'repair' | 'quarantine';

export interface CliBulkCounts {
  selectable: number;
  repair: number;
  quarantine: number;
}

export class CliBulk {
  /** Satirda secim kutusu gosterilsin mi? (en az bir toplu islem uygun) */
  static isSelectable(tool: CliTool, selectableIds: readonly string[]): boolean {
    return (
      selectableIds.includes(tool.id) ||
      Boolean(tool.repair) ||
      (tool.source === 'standalone' && tool.shims.length > 0)
    );
  }

  static repairIds(tools: readonly CliTool[]): string[] {
    return tools.filter((tool) => Boolean(tool.repair)).map((tool) => tool.id);
  }

  static quarantineIds(tools: readonly CliTool[]): string[] {
    return tools
      .filter((tool) => tool.source === 'standalone' && tool.shims.length > 0)
      .map((tool) => tool.id);
  }

  static idsFor(tools: readonly CliTool[], kind: CliBulkKind): string[] {
    return kind === 'repair' ? this.repairIds(tools) : this.quarantineIds(tools);
  }

  static counts(
    tools: readonly CliTool[],
    selectableIds: readonly string[],
  ): CliBulkCounts {
    return {
      selectable: tools.filter((tool) => this.isSelectable(tool, selectableIds)).length,
      repair: this.repairIds(tools).length,
      quarantine: this.quarantineIds(tools).length,
    };
  }
}
