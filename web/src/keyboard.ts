/**
 * Klavye hedefi yardımcısı.
 *
 * Yazı alanındayken kısayollar devre dışı kalır. Tek kaynak: App (global
 * kısayollar) ve Disk (tarama sahnesi `P`) aynı kuralı paylaşır; iki kopya
 * zamanla ayrışmasın.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}
