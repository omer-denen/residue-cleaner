import type {
  BackgroundFacts,
  BackgroundRowId,
  BackgroundRowView,
  BackgroundViewResponse,
} from './contract.ts';

function cleanNumber(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  return v;
}

const ROW_ORDER: BackgroundRowId[] = [
  'busy',
  'schedules',
  'plans',
  'update',
  'launch',
  'retention',
];

/**
 * Arka plan gorunurlugu motoru (T64/P4).
 *
 * Salt okunur: yalniz verilen gercekleri biçimler, yan etki yok.
 * Karar/hesap burada; arayuz yalnizca kimlik + sayi gosterir.
 */
export class BackgroundView {
  static view(facts: BackgroundFacts): BackgroundViewResponse {
    const busy = facts.busy;
    const scheduleRules = cleanNumber(facts.scheduleRules);
    const schedulesDueToday = cleanNumber(facts.schedulesDueToday);
    const missedRuns = cleanNumber(facts.missedRuns);
    const pendingPlans = cleanNumber(facts.pendingPlans);
    const vaultRetentionDays = cleanNumber(facts.vaultRetentionDays);

    const busyRow: BackgroundRowView = {
      id: 'busy',
      count: null,
      tone: busy === null ? 'ok' : 'warn',
      valueId: busy ?? 'none',
    };

    let schedulesTone: BackgroundRowView['tone'] = scheduleRules === 0 ? 'dim' : 'ok';
    if (schedulesDueToday > 0 || missedRuns > 0) schedulesTone = 'warn';
    const schedulesRow: BackgroundRowView = {
      id: 'schedules',
      count: scheduleRules,
      tone: schedulesTone,
    };

    const plansRow: BackgroundRowView = {
      id: 'plans',
      count: pendingPlans,
      tone: pendingPlans === 0 ? 'dim' : 'warn',
    };

    const updateRow: BackgroundRowView = {
      id: 'update',
      count: null,
      tone: facts.updateCheck === 'off' ? 'dim' : 'ok',
      valueId: facts.updateCheck,
    };

    const launchRow: BackgroundRowView = {
      id: 'launch',
      count: null,
      tone: facts.scanOnLaunch === 'manual' ? 'dim' : 'ok',
      valueId: facts.scanOnLaunch,
    };

    const retentionRow: BackgroundRowView = {
      id: 'retention',
      count: vaultRetentionDays,
      tone: vaultRetentionDays <= 0 ? 'dim' : 'ok',
    };

    const rows: BackgroundRowView[] = [
      busyRow,
      schedulesRow,
      plansRow,
      updateRow,
      launchRow,
      retentionRow,
    ];

    // Sabit sira garanti
    const ordered = ROW_ORDER.map((id) => rows.find((r) => r.id === id)!);

    return {
      busy,
      automatic: false,
      rows: ordered,
    };
  }
}
