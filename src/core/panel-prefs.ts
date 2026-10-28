/**
 * Sag panel modul gorunurlugu (saf TS, node builtin YOK).
 *
 * Kullanici hangi modulleri gorecegini secer (UX-005 / P1). Motor yalnizca
 * sira/koruma kuralini uygular; arayuz yalnizca sonucu gosterir (AGENTS.md
 * kural 18).
 *
 * Modul kimlikleri SABITTIR ve tum ekranlarda ortaktir: kullanici bir modulu
 * bir kez gizlerse her ekranda gizli kalir. Bu yuzden `sanitize` yalnizca
 * TANINAN kimlikleri korur, ekranin o anki listesine gore elemez; ekran
 * listesine gore eleme `resolve` icinde yapilir. Aksi halde baska ekranda
 * yapilan bir gizleme, o ekranda bulunmayan kimligi sessizce silerdi.
 */

/** Taninan sag panel modulleri (ekran plani yalnizca bunlardan secer). */
const MODULE_IDS: readonly string[] = ['evidence', 'action', 'planned', 'context'];

export interface PanelVisibility {
  visible: string[];
  hidden: string[];
}

export class PanelPrefs {
  /** Taninan modul kimlikleri (salt okunur). */
  static readonly MODULE_IDS: readonly string[] = MODULE_IDS;

  /** Gizli listesini temizler: taninmayan, bos ve tekrar eden kimlikler atilir. */
  static sanitize(hidden: unknown): string[] {
    if (!Array.isArray(hidden)) return [];
    const allowed = new Set(MODULE_IDS);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of hidden) {
      if (typeof item !== 'string') continue;
      const v = item.trim();
      if (v === '') continue;
      if (!allowed.has(v)) continue;
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  }

  /**
   * Ekranin modul listesini gorunur/gizli diye ayirir. Sira her zaman ekran
   * planindan gelir (`modules`). Hepsi gizliyse ilk modul gorunur kalir:
   * bos panel kullaniciyi kilitlememeli.
   */
  static resolve(modules: readonly string[], hidden: readonly string[]): PanelVisibility {
    const hiddenSet = new Set(PanelPrefs.sanitize(hidden));
    const visible = modules.filter((m) => !hiddenSet.has(m));
    const hiddenOut = modules.filter((m) => hiddenSet.has(m));
    if (visible.length === 0 && modules.length > 0) {
      const first = modules[0]!;
      const idx = hiddenOut.indexOf(first);
      if (idx >= 0) hiddenOut.splice(idx, 1);
      visible.push(first);
    }
    return { visible, hidden: hiddenOut };
  }

  /**
   * Gizle/goster. `modules` yalnizca "son gorunur modul gizlenemez" korumasi
   * icin gerekir; listede olmayan gizli kimlikler korunur (global tercih).
   */
  static toggle(hidden: readonly string[], id: string, modules: readonly string[]): string[] {
    const current = PanelPrefs.sanitize(hidden);
    if (current.includes(id)) {
      return current.filter((x) => x !== id);
    }
    if (!MODULE_IDS.includes(id)) return current;
    const next = [...current, id];
    const hiddenSet = new Set(next);
    const visible = modules.filter((m) => !hiddenSet.has(m));
    if (visible.length === 0) return current;
    return next;
  }

  /** localStorage'dan okunan ham JSON'u gizli listesine cevirir (bozuk -> []). */
  static parse(raw: string | null): string[] {
    if (raw === null || raw === '') return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return PanelPrefs.sanitize(parsed);
  }
}
