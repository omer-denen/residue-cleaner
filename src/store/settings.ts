import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isUpdateMode, type UpdateCheckMode } from '../core/update-check.ts';
import type { ScanOnLaunchMode } from '../core/contract.ts';
import type { UserProfile } from '../core/contract.ts';
import { normalizeUserProfile, DEFAULT_USER_PROFILE } from '../core/profile.ts';
import { dataDir } from '../core/data-dir.ts';
import { longPath } from '../util/longpath.ts';

/**
 * Web arayuzu ayarlari (kalici).
 *
 * Sabit kodlanmis 24 saat kurali yerine kullanici ayari tutulur.
 * Dosya aracin kendi veri dizinindedir; taranmaz, silinmez.
 */

export interface WebSettings {
  /** Tarama onbellegi gecerlilik suresi (saat). 1..720 */
  scanCacheHours: number;
  /** Kasa kayitlari icin onerilen saklama suresi (gun). Bilgi amacli. */
  vaultRetentionDays: number;
  /**
   * Surum kontrolu (T41). Varsayilan KAPALI: acikca opt-in.
   * 'off' | 'daily' | 'weekly'
   */
  updateCheck: UpdateCheckMode;
  /** Acilista tarama modu. Varsayilan always. */
  scanOnLaunch: ScanOnLaunchMode;
  /** Gelismis mod: keep/report-only kumeleri de plana alinabilir. Varsayilan KAPALI. */
  advancedDelete: boolean;
  /** Kullanici profili (persona). Yalniz sunum secer. */
  uiProfile: UserProfile;
}

export const DEFAULT_SETTINGS: WebSettings = {
  scanCacheHours: 24,
  vaultRetentionDays: 30,
  updateCheck: 'off',
  scanOnLaunch: 'always',
  advancedDelete: false,
  uiProfile: DEFAULT_USER_PROFILE,
};
export const MIN_CACHE_HOURS = 1;
export const MAX_CACHE_HOURS = 720;
export const MIN_VAULT_DAYS = 1;
export const MAX_VAULT_DAYS = 3650;

export function settingsPath(): string {
  return join(dataDir(), 'settings.json');
}

function clampHours(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return DEFAULT_SETTINGS.scanCacheHours;
  return Math.min(MAX_CACHE_HOURS, Math.max(MIN_CACHE_HOURS, Math.round(v)));
}

function clampVaultDays(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return DEFAULT_SETTINGS.vaultRetentionDays;
  return Math.min(MAX_VAULT_DAYS, Math.max(MIN_VAULT_DAYS, Math.round(v)));
}

export const SCAN_ON_LAUNCH_MODES: ScanOnLaunchMode[] = ['always', 'daily', 'manual'];

export function isScanOnLaunchMode(v: unknown): v is ScanOnLaunchMode {
  return typeof v === 'string' && (SCAN_ON_LAUNCH_MODES as string[]).includes(v);
}

export async function loadSettings(): Promise<WebSettings> {
  try {
    const txt = await readFile(longPath(settingsPath()), 'utf8');
    const j = JSON.parse(txt) as Partial<WebSettings>;
    return {
      scanCacheHours: clampHours(j.scanCacheHours),
      vaultRetentionDays: clampVaultDays(j.vaultRetentionDays),
      updateCheck: isUpdateMode(j.updateCheck) ? j.updateCheck : DEFAULT_SETTINGS.updateCheck,
      scanOnLaunch: isScanOnLaunchMode(j.scanOnLaunch) ? j.scanOnLaunch : DEFAULT_SETTINGS.scanOnLaunch,
      advancedDelete: typeof j.advancedDelete === 'boolean' ? j.advancedDelete : DEFAULT_SETTINGS.advancedDelete,
      uiProfile: normalizeUserProfile(j.uiProfile),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(patch: Partial<WebSettings>): Promise<WebSettings> {
  const current = await loadSettings();
  const next: WebSettings = {
    ...current,
    ...(patch.scanCacheHours !== undefined ? { scanCacheHours: clampHours(patch.scanCacheHours) } : {}),
    ...(patch.vaultRetentionDays !== undefined
      ? { vaultRetentionDays: clampVaultDays(patch.vaultRetentionDays) }
      : {}),
    ...(isUpdateMode(patch.updateCheck) ? { updateCheck: patch.updateCheck } : {}),
    ...(patch.scanOnLaunch !== undefined
      ? { scanOnLaunch: isScanOnLaunchMode(patch.scanOnLaunch) ? patch.scanOnLaunch : DEFAULT_SETTINGS.scanOnLaunch }
      : {}),
    ...(typeof patch.advancedDelete === 'boolean' ? { advancedDelete: patch.advancedDelete } : {}),
    ...(patch.uiProfile !== undefined ? { uiProfile: normalizeUserProfile(patch.uiProfile) } : {}),
  };
  try {
    const file = settingsPath();
    await mkdir(longPath(dirname(file)), { recursive: true });
    await writeFile(longPath(file), JSON.stringify(next, null, 2), 'utf8');
  } catch {
    /* yazilamadi: varsayilanla devam */
  }
  return next;
}
