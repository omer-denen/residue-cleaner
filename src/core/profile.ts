import type { UserProfile } from './contract.ts';

/**
 * Kullanici profili (persona) yardimcilari — SAF TS, node builtin importu YOK.
 *
 * Persona YALNIZ sunum secer (docs/PROFILE-MODEL.md). Bu modul karar
 * mantigi uretmez; yalniz kimlik dogrulama + normalize etme yapar.
 */

export const USER_PROFILES: readonly UserProfile[] = ['developer', 'vibe', 'hybrid'];
export const DEFAULT_USER_PROFILE: UserProfile = 'hybrid';

export function isUserProfile(v: unknown): v is UserProfile {
  return typeof v === 'string' && (USER_PROFILES as readonly string[]).includes(v);
}

export function normalizeUserProfile(v: unknown): UserProfile {
  return isUserProfile(v) ? v : DEFAULT_USER_PROFILE;
}