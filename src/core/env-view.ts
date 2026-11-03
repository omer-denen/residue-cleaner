import type { EnvAnalysis, EnvScope, PathEntry } from './env-engine.ts';

export type EnvEntryState = 'missing' | 'duplicate' | 'shadowed' | 'ok';

export interface EnvEntryView {
  id: string;
  scope: EnvScope;
  index: number;
  raw: string;
  expanded: string;
  exists: boolean;
  state: EnvEntryState;
  /** Yalnizca diskte olmayan veya tekrar eden girdiler kaldirilabilir. */
  removable: boolean;
}

/**
 * PATH girdisi secimi icin saf gorunum. Kaldirilabilirlik kanittan gelir:
 * eksik dizin veya ayni kapsamda tekrar. Golgede kalan girdi kaldirilamaz;
 * etkin PATH'te baska bir kaynak tarafindan gizlenmis olabilir.
 */
export class EnvSelection {
  static id(entry: Pick<PathEntry, 'scope' | 'index'>): string {
    return `${entry.scope}:${entry.index}`;
  }

  static state(entry: PathEntry): EnvEntryState {
    if (!entry.exists) return 'missing';
    if (entry.duplicateOf !== undefined) return 'duplicate';
    if (entry.shadowedBy !== undefined) return 'shadowed';
    return 'ok';
  }

  static entries(analysis: EnvAnalysis): EnvEntryView[] {
    return analysis.pathEntries.map((entry) => {
      const state = EnvSelection.state(entry);
      return {
        id: EnvSelection.id(entry),
        scope: entry.scope,
        index: entry.index,
        raw: entry.raw,
        expanded: entry.expanded,
        exists: entry.exists,
        state,
        removable: state === 'missing' || state === 'duplicate',
      };
    });
  }

  /** Secilen kapsamdaki (veya iki kapsamdaki) kaldirilabilir kimlikler. */
  static candidateIds(analysis: EnvAnalysis, scope: EnvScope | 'both'): string[] {
    return EnvSelection.entries(analysis)
      .filter((entry) => entry.removable && (scope === 'both' || entry.scope === scope))
      .map((entry) => entry.id);
  }

  /** Kaldirma listesinden yalnizca hala gecerli kimlikleri dondurur. */
  static retain(analysis: EnvAnalysis, ids: Iterable<string>): string[] {
    const known = new Set(EnvSelection.entries(analysis).map((entry) => entry.id));
    return [...ids].filter((id) => known.has(id));
  }
}
