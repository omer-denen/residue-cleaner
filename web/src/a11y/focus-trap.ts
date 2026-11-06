/**
 * Diyalog odak tuzagi icin saf indeks hesabi.
 *
 * `inside=false` (odak arka planda kalmis) durumunda Tab ilk ogeye,
 * Shift+Tab son ogeye goturur. Boylece `aria-modal` ile isaretlenmis
 * diyalog acikken klavye arka plana kacmaz.
 */
export function nextFocusIndex(
  current: number,
  count: number,
  shift: boolean,
  inside: boolean,
): number {
  if (count <= 0) return -1;
  if (!inside || current < 0) return shift ? count - 1 : 0;
  if (shift) return current <= 0 ? count - 1 : current - 1;
  return current >= count - 1 ? 0 : current + 1;
}
