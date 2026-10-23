import type {
  PlanPanelGroup,
  PlanPanelItem,
  PlanPanelView,
  PlanView,
} from './contract.ts';

/**
 * Sag panel "Planlananlar" gorunumu.
 *
 * Plan yanitindaki kume/hedef yapisini gruplara ayirir, her hedefe
 * KARARLI bir kimlik verir ve siralamayi belirler. Istemci cikarma
 * isteginde YOL DEGIL yalnizca `id` (tek hedef) veya `key` (kume)
 * yollar; kimlikler bu dosyadaki tek fonksiyondan uretilir.
 *
 * Saf TS: node builtin importu YOK (motor/arayuz ayrimi, AGENTS.md 18).
 */

/** FNV-1a (32 bit): kume anahtari + yol ozetinden kararli hedef kimligi. */
export function planTargetId(clusterKey: string, path: string): string {
  const input = `${clusterKey}\u0000${path}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `t-${(h >>> 0).toString(16).padStart(8, '0')}`;
}

/** Siralama yardimcisi: bayt azalan; esitlikte verilen ikincil kural. */
function byBytesDesc<T extends { bytes: number }>(
  tieBreak: (a: T, b: T) => number,
): (a: T, b: T) => number {
  return (a, b) => b.bytes - a.bytes || tieBreak(a, b);
}

export class PlanPanel {
  /**
   * Plan gorunumunden sag panel verisini kurar.
   *
   * Gruplar: `bytes` azalan, esitse `key` alfabetik.
   * Hedefler: `bytes` azalan, esitse `path` alfabetik.
   * `totalBytes` planidan oldugu gibi korunur (yeniden hesaplanmaz).
   */
  static from(view: PlanView): PlanPanelView {
    const groups: PlanPanelGroup[] = view.clusters
      .map((c) => {
        const items: PlanPanelItem[] = c.targets
          .map((t) => ({
            id: planTargetId(c.key, t.target.path),
            path: t.target.path,
            label: t.target.label,
            kind: t.target.kind,
            ...(t.target.minAgeDays !== undefined
              ? { minAgeDays: t.target.minAgeDays }
              : {}),
            bytes: t.bytes,
          }))
          .sort(byBytesDesc((a, b) => a.path.localeCompare(b.path)));
        const bytes = items.reduce((a, t) => a + t.bytes, 0);
        return {
          key: c.key,
          title: c.title,
          reason: c.reason,
          risk: c.risk,
          bytes,
          targetCount: items.length,
          items,
        };
      })
      .sort(byBytesDesc((a, b) => a.key.localeCompare(b.key)));

    return {
      mode: view.mode,
      groups,
      keys: groups.map((g) => g.key),
      totalBytes: view.totalBytes,
      clusterCount: groups.length,
      targetCount: groups.reduce((a, g) => a + g.targetCount, 0),
    };
  }
}
