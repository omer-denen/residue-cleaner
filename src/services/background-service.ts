import { BackgroundView } from '../core/background-view.ts';
import type { BackgroundViewResponse } from '../core/contract.ts';
import type { PlanRecordService } from './plan-record-service.ts';
import type { ScanService } from './scan-service.ts';
import type { ScheduleService } from './schedule-service.ts';
import type { ActivityGate } from './activity.ts';

/**
 * Arka plan durumunu toplar (T64/P4).
 *
 * Yalnizca BELLEKTEKI durumu okur: tarama baslatmaz, plan calistirmaz, kasa
 * bosaltmaz, ag istegi yapmaz. Hesap `BackgroundView` motorundadir; burada
 * yalnizca gercekler toplanir.
 */
export class BackgroundService {
  private readonly scan: ScanService;
  private readonly schedules: ScheduleService;
  private readonly plans: PlanRecordService;
  private readonly gate: ActivityGate;

  constructor(
    scan: ScanService,
    schedules: ScheduleService,
    plans: PlanRecordService,
    gate: ActivityGate,
  ) {
    this.scan = scan;
    this.schedules = schedules;
    this.plans = plans;
    this.gate = gate;
  }

  async view(): Promise<BackgroundViewResponse> {
    // Kural/plan/ayar okumalari ayri ayri korunur: biri patlarsa digerleri
    // yine gosterilir (salt okunur ozet, hata bandi degil).
    let scheduleRules = 0;
    let schedulesDue = 0;
    let missed = 0;
    try {
      const rules = await this.schedules.list();
      scheduleRules = rules.length;
      schedulesDue = rules.filter((r) => r.due).length;
      missed = rules.reduce((n, r) => n + (r.missed > 0 ? r.missed : 0), 0);
    } catch {
      // Kural deposu okunamadi: 0 kalir.
    }

    let pendingPlans = 0;
    try {
      const res = await this.plans.list();
      pendingPlans = res.records.filter((r) => r.status === 'pending').length;
    } catch {
      // Plan deposu okunamadi: 0 kalir.
    }

    let updateCheck: 'off' | 'daily' | 'weekly' = 'off';
    let scanOnLaunch: 'always' | 'daily' | 'manual' = 'manual';
    let vaultRetentionDays = 0;
    try {
      const s = await this.scan.settings();
      updateCheck = s.updateCheck;
      scanOnLaunch = s.scanOnLaunch;
      vaultRetentionDays = s.vaultRetentionDays;
    } catch {
      // Ayarlar okunamadi: muhafazakar varsayilanlar (kapali/elle) kalir.
    }

    return BackgroundView.view({
      busy: this.gate.busy(),
      scheduleRules,
      // `due`: su an tetiklenmeyi bekleyen kural (ScheduleView.due).
      schedulesDueToday: schedulesDue,
      missedRuns: missed,
      updateCheck,
      scanOnLaunch,
      vaultRetentionDays,
      pendingPlans,
    });
  }
}
