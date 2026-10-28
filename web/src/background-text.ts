import type { BackgroundRowView, BackgroundViewResponse } from '../../src/core/contract.ts';
import type { MessageKey } from './i18n.ts';

/**
 * Arka plan satirinin metnini uretir (T64/P4).
 *
 * Metin secimi BURADA degil motorda: `row.valueId` / `row.count` motorun
 * kararidir, burada yalnizca TR/EN sozluk anahtari secilir (AGENTS.md
 * kural 18 — arayuz karar vermez, gosterir).
 */
export function backgroundRowText(
  row: BackgroundRowView,
  view: BackgroundViewResponse,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): string {
  if (row.id === 'busy') {
    const id = row.valueId ?? view.busy ?? 'none';
    return t(`background.busy.${id}` as MessageKey);
  }
  if (row.id === 'update' || row.id === 'launch') {
    if (!row.valueId) return '—';
    return t(`background.value.${row.valueId}` as MessageKey);
  }
  const count = row.count ?? 0;
  if (row.id === 'schedules') return t('background.count.rules', { count });
  if (row.id === 'plans') return t('background.count.plans', { count });
  return t('background.count.days', { count });
}
