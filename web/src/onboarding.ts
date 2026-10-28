import type { UserProfile } from '../../src/core/contract.ts';

export const ONBOARDING_KEY = 'residue.onboarded';
export const ONBOARDING_DONE = '1';

export function shouldOnboard(stored: string | null): boolean {
  return stored !== ONBOARDING_DONE;
}

export function onboardingChoice(id: UserProfile | null | undefined): UserProfile {
  if (id === 'developer' || id === 'vibe' || id === 'hybrid') return id;
  return 'hybrid';
}
