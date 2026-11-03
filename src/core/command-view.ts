/**
 * KOMUT PALETI SORGUSU — saf motor (AGENTS.md kural 18).
 *
 * Arayuz yalnizca ETIKET ve KIMLIK tasir; eslestirme/siralama burada olur.
 * Turkce karakterler ASCII'ye katlanir ("Ayarlar" icin "ayar" da bulur).
 * Girdi dizisi DEGISTIRILMEZ.
 */

export interface CommandCandidate {
  /** Ekran ya da eylem kimligi (arayuz yorumlar). */
  id: string;
  /** Gorunen ad (i18n'den gelir). */
  label: string;
  /** Ek arama sozcukleri (ekran kimligi, anahtar kelimeler). */
  keywords?: readonly string[];
}

export type CommandMatch = CommandCandidate & {
  /** 0 = etiket baslangici, 1 = sozcuk baslangici, 2 = icinde, 3 = anahtar sozcuk. */
  rank: number;
};

const FOLD: Record<string, string> = {
  ı: 'i',
  İ: 'i',
  ş: 's',
  Ş: 's',
  ğ: 'g',
  Ğ: 'g',
  ü: 'u',
  Ü: 'u',
  ö: 'o',
  Ö: 'o',
  ç: 'c',
  Ç: 'c',
  â: 'a',
  Â: 'a',
};

/** Kucuk harf + Turkce katlama + bosluk sadelestirme. */
export function fold(text: string): string {
  return text
    .toLocaleLowerCase('tr')
    .replace(/[ıİşŞğĞüÜöÖçÇâÂ]/g, (ch) => FOLD[ch] ?? ch)
    .replace(/\s+/g, ' ')
    .trim();
}

export class CommandView {
  /** Sorguya uyan adaylar; esit puanda GIRDI SIRASI korunur. */
  static filter<T extends CommandCandidate>(
    query: string,
    items: readonly T[],
    limit = 12,
  ): Array<T & { rank: number }> {
    const q = fold(query);
    const scored: Array<{ item: T; rank: number; order: number }> = [];

    items.forEach((item, order) => {
      const label = fold(item.label);
      let rank = -1;

      if (q.length === 0) rank = 0;
      else if (label.startsWith(q)) rank = 0;
      else if (label.split(' ').some((word) => word.startsWith(q))) rank = 1;
      else if (label.includes(q)) rank = 2;
      else if ((item.keywords ?? []).some((word) => fold(word).includes(q))) rank = 3;

      if (rank >= 0) scored.push({ item, rank, order });
    });

    scored.sort((a, b) => a.rank - b.rank || a.order - b.order);
    return scored.slice(0, Math.max(0, limit)).map(({ item, rank }) => ({ ...item, rank }));
  }

  /** Ok tusu: liste sonunda basa doner; bos listede -1. */
  static move(index: number, delta: number, length: number): number {
    if (length <= 0) return -1;
    return (((index + delta) % length) + length) % length;
  }
}
