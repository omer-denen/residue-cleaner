import type { CategoryKey } from './categories.ts';
import { categoryOf } from './categories.ts';
import type { Cluster, Risk } from './types.ts';

/**
 * Plan motoru (zamanlama dahil).
 *
 * Kural: PLANLI ISLEM YALNIZCA KASAYA TASIR. Kalici silme ve ortam
 * degiskeni duzenlemesi otomatik YAPILMAZ. Kural, sabit bir yol listesi
 * degil bir SECICI saklar; calisma aninda yeniden degerlendirilir.
 */

export type ScheduleFrequency = 'once' | 'daily' | 'weekly';
export type ScheduledStatus = 'pending' | 'running' | 'done' | 'missed' | 'failed' | 'cancelled';

/**
 * Planli islem turu.
 *
 * - `vault`: secilen kumeleri KASAYA tasir (kalici silme yok).
 * - `env`: PATH temizligi uygular; kural olusturulurken yazili `TEMIZLE`
 *   onayi alinir, her calismada ortam YEDEKLENIR ve denetim kaydi yazilir.
 *
 * Konsolidasyon (coklu kurulumu birlestirme) henuz plan turu DEGILDIR.
 */
export type ScheduleMode = 'vault' | 'env';

/** Ortam kapsami: kullanici (HKCU), makine (HKLM) veya ikisi. */
export type ScheduleEnvScope = 'user' | 'machine' | 'both';

export interface ScheduleEnvOptions {
  scope: ScheduleEnvScope;
  /** Diskte olmayan PATH girdilerini kaldir. */
  removeMissing: boolean;
  /** Baska bir girdinin tekrari olan PATH girdilerini kaldir. */
  removeDuplicates: boolean;
}

export const DEFAULT_ENV_OPTIONS: ScheduleEnvOptions = {
  scope: 'user',
  removeMissing: true,
  removeDuplicates: true,
};

/** Kuraldaki ortam seceneklerini guvenli varsayilanlarla dondurur. */
export function envOptionsOf(rule: Pick<ScheduleRule, 'env'>): ScheduleEnvOptions {
  const scope = rule.env?.scope;
  return {
    scope: scope === 'machine' || scope === 'both' ? scope : 'user',
    removeMissing: rule.env?.removeMissing !== false,
    removeDuplicates: rule.env?.removeDuplicates !== false,
  };
}


export interface ScheduleSelector {
  /** Belirli kume anahtarlari (bos = kategori/risk secimi). */
  keys?: string[];
  categories?: CategoryKey[];
  /** Bu risk ve altindakiler. Varsayilan: yalnizca safe. */
  maxRisk?: Risk;
  /** En az bu kadar gundur dokunulmamis. */
  minIdleDays?: number;
  /** Tek calismada en fazla kume. */
  maxItems?: number;
}

export interface ScheduleRule {
  id: string;
  name: string;
  frequency: ScheduleFrequency;
  /** 0..23 */
  hour: number;
  /** 0..59 */
  minute: number;
  /** weekly icin 0=Pazar..6=Cumartesi */
  weekday?: number;
  /** once icin mutlak zaman (ms). */
  runAt?: number;
  selector: ScheduleSelector;
  mode: ScheduleMode;
  /** Yalniz `mode: 'env'` icin; yoksa varsayilanlar kullanilir. */
  env?: ScheduleEnvOptions;
  /**
   * `env` kuralinda yazili `TEMIZLE` onayinin verildigi an. Kayit yoksa
   * calisma ANINDA reddedilir (onaysiz otomasyon yok).
   */
  envApprovedAt?: number;
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  /**
   * Kacirilan calisma telafisi: true ise sunucu bir sonraki acilista
   * "kacirilan calisma" onerisi sunar; false ise yalnizca sonraki zaman.
   */
  compensateMissed: boolean;
}

export interface ScheduleRun {
  id: string;
  ruleId: string;
  plannedAt: number;
  startedAt?: number;
  finishedAt?: number;
  status: ScheduledStatus;
  itemCount: number;
  bytes: number;
  journalPath?: string;
  /** `env` calismasinda yazilan ortam yedegi dosyasi. */
  envBackup?: string;
  error?: string;
}

const RISK_ORDER: Record<Risk, number> = { safe: 0, low: 1, medium: 2, high: 3 };

function atTime(base: Date, hour: number, minute: number): number {
  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

/** Kuralin bir sonraki calisma zamani; `once` gecmisse null. */
export function nextRunAt(rule: ScheduleRule, from = Date.now()): number | null {
  if (!rule.enabled) return null;
  if (rule.frequency === 'once') {
    return rule.runAt !== undefined && rule.runAt > from ? rule.runAt : null;
  }
  if (rule.frequency === 'daily') {
    const today = atTime(new Date(from), rule.hour, rule.minute);
    if (today > from) return today;
    const next = new Date(from);
    next.setDate(next.getDate() + 1);
    return atTime(next, rule.hour, rule.minute);
  }
  // weekly
  const target = rule.weekday ?? 1;
  const cur = new Date(from);
  const diff = (target - cur.getDay() + 7) % 7;
  const candidate = new Date(cur);
  candidate.setDate(cur.getDate() + diff);
  const t = atTime(candidate, rule.hour, rule.minute);
  if (t > from) return t;
  candidate.setDate(candidate.getDate() + 7);
  return atTime(candidate, rule.hour, rule.minute);
}

/** Kural su an calistirilmali mi? (gecikmis calismalar icin `missed`). */
export function dueNow(rule: ScheduleRule, now = Date.now()): boolean {
  if (!rule.enabled) return false;
  if (rule.frequency === 'once') {
    return rule.runAt !== undefined && rule.runAt <= now && rule.lastRunAt === undefined;
  }
  const prev = previousRunAt(rule, now);
  if (prev === null) return false;
  const last = rule.lastRunAt ?? rule.createdAt;
  return last < prev;
}

/** Bu andan onceki en yakin plan zamani. */
export function previousRunAt(rule: ScheduleRule, now = Date.now()): number | null {
  if (rule.frequency === 'once') {
    return rule.runAt !== undefined && rule.runAt <= now ? rule.runAt : null;
  }
  const d = new Date(now);
  if (rule.frequency === 'daily') {
    const today = atTime(d, rule.hour, rule.minute);
    if (today <= now) return today;
    d.setDate(d.getDate() - 1);
    return atTime(d, rule.hour, rule.minute);
  }
  const target = rule.weekday ?? 1;
  const diff = (d.getDay() - target + 7) % 7;
  const candidate = new Date(d);
  candidate.setDate(d.getDate() - diff);
  const t = atTime(candidate, rule.hour, rule.minute);
  if (t <= now) return t;
  candidate.setDate(candidate.getDate() - 7);
  return atTime(candidate, rule.hour, rule.minute);
}

/** Kacirilan calisma sayisi (son calismadan bu yana plan zamani gecen). */
export function missedRuns(rule: ScheduleRule, now = Date.now()): number {
  if (rule.frequency === 'once') return 0;
  const last = rule.lastRunAt;
  if (last === undefined) return 0;
  let count = 0;
  let cur = last;
  for (let i = 0; i < 366; i++) {
    const next = nextRunAt(rule, cur);
    if (next === null || next > now) break;
    count++;
    cur = next;
  }
  return count;
}

/** Seciciyi uygular: yalnizca kasa moduna uygun (safe, hedefli) kumeler. */
export function selectClusters(rule: ScheduleRule, clusters: Cluster[]): Cluster[] {
  const sel = rule.selector;
  const maxRisk = RISK_ORDER[sel.maxRisk ?? 'safe'];
  const wantedCats = new Set(sel.categories ?? []);
  const wantedKeys = new Set(sel.keys ?? []);
  const now = Date.now();
  const minIdle = (sel.minIdleDays ?? 0) * 86_400_000;

  const out = clusters.filter((c) => {
    if (c.verdict.kind !== 'recommend') return false;
    if (c.verdict.regenerability !== 'regenerable') return false;
    if (c.verdict.confidence === 'low') return false;
    if ((c.deleteTargets?.length ?? 0) === 0) return false;
    if (RISK_ORDER[c.verdict.risk] > maxRisk) return false;
    if (wantedKeys.size > 0 && !wantedKeys.has(c.key)) return false;
    if (wantedCats.size > 0 && !wantedCats.has(categoryOf(c))) return false;
    if (minIdle > 0 && c.lastTouched > 0 && now - c.lastTouched < minIdle) return false;
    return true;
  });
  const max = sel.maxItems ?? 10;
  return out.slice(0, Math.max(1, max));
}

export interface EnvChangePreview {
  scope: 'user' | 'machine';
  name: string;
  reason: string;
}

export interface PlanPreview {
  ruleId: string;
  items: Array<{ key: string; title: string; bytes: number; category: CategoryKey; risk: Risk }>;
  totalBytes: number;
  skipped: Array<{ key: string; reason: string }>;
  mode: ScheduleMode;
  envChanges: EnvChangePreview[];
}

/** Calisma aninda onizleme; hicbir sey silmez/yazmaz. */
export function previewRule(rule: ScheduleRule, clusters: Cluster[]): PlanPreview {
  const selected = selectClusters(rule, clusters);
  return {
    ruleId: rule.id,
    mode: 'vault',
    envChanges: [],
    totalBytes: selected.reduce((a, c) => a + c.reclaimableBytes, 0),
    items: selected.map((c) => ({
      key: c.key,
      title: c.title,
      bytes: c.reclaimableBytes,
      category: categoryOf(c),
      risk: c.verdict.risk,
    })),
    skipped: clusters
      .filter((c) => !selected.includes(c))
      .slice(0, 50)
      .map((c) => ({ key: c.key, reason: 'secici kosullarini saglamadi veya limit disinda' })),
  };
}

/**
 * `env` kuralinin onizlemesi: kume yok, PATH degisiklikleri listelenir.
 * Hicbir sey yazilmaz; yalniz gosterim.
 */
export function envPreview(rule: ScheduleRule, changes: readonly EnvChangePreview[]): PlanPreview {
  return {
    ruleId: rule.id,
    mode: 'env',
    items: [],
    totalBytes: 0,
    skipped: [],
    envChanges: changes.map((c) => ({ scope: c.scope, name: c.name, reason: c.reason })),
  };
}
