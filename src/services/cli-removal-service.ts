import { removeSingleTool, reinstallSpec, type CliRemovalResult } from '../actions/cli-remove.ts';
import { ApprovalRules } from '../core/approval.ts';
import { buildInventoryGraph } from '../core/dependency-graph.ts';
import { info } from '../util/log.ts';
import { ServiceError } from './errors.ts';
import type { CliInventoryService } from './cli-inventory-service.ts';
import type { UninstallSpec } from '../core/cli-inventory-types.ts';
import type { CliExecuteResultView } from '../core/contract.ts';

/**
 * CLI kaldirma servisi: tek arac kaldirma + onay.
 *
 * Envanter `CliInventoryService`ten alinir; kaldirma sonrasi onbellek
 * gecersiz kilinir. Paket yoneticisinin kendi uninstall komutu kullanilir.
 */
export class CliRemovalService {
  private readonly inventory: CliInventoryService;

  constructor(inventory: CliInventoryService) {
    this.inventory = inventory;
  }

  async removeSingle(
    id: string,
    phrase: string,
    backup = true,
  ): Promise<CliExecuteResultView> {
    if (!id) throw new ServiceError(400, 'Arac secilmedi');

    const inv = await this.inventory.ensure();
    const wanted = id.toLowerCase();
    const byId = inv.tools.filter((t) => t.id.toLowerCase() === wanted);
    const selected =
      byId.length > 0
        ? byId[0]
        : inv.tools.find((t) => t.command.toLowerCase() === wanted);
    if (!selected) throw new ServiceError(404, 'Secilen arac envanterde yok');
    if (selected.status === 'protected' || !selected.uninstall) {
      throw new ServiceError(400, 'Korunan araclar kaldirilamaz');
    }

    if (!ApprovalRules.matches('delete', phrase)) {
      throw new ServiceError(
        400,
        `Onay metni hatali ("${ApprovalRules.phrase('delete')}" bekleniyordu)`,
      );
    }

    // Golgede kalan bir paket secildiyse kaldirma sonrasi aktif paketi
    // yeniden baglayacak onarim komutunu hesapla.
    let repair: UninstallSpec | null = null;
    for (const d of inv.duplicates) {
      if (d.removeIds.includes(selected.id)) {
        const keep = inv.tools.find((t) => t.id === d.keepId);
        if (keep) repair = reinstallSpec(keep);
      }
    }

    info('cli kaldirma baslatildi', { arac: selected.command });

    const result = await removeSingleTool(selected, backup, repair);

    // Envanter artik eski; bir sonraki planlama yeniden tarar.
    this.inventory.setLast(null);

    return {
      command: result.command,
      ok: result.ok,
      manual: result.manual,
      output: result.output,
      ...(result.error ? { error: result.error } : {}),
      ...(result.backupDir ? { backupDir: result.backupDir } : {}),
      verified: result.verified,
    };
  }
}