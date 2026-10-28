import type { UserProfile } from '../../src/core/contract.ts';
import type { PanelScreen } from './panel-plan.ts';

export type ProfileDensity = 'compact' | 'normal' | 'detailed';

export interface ProfileView {
  id: UserProfile;
  initialScreen: PanelScreen;
  navOrder: PanelScreen[];
  // Sag panel modulu persona ile SECILMEZ: ekran basina karar panel-plan.ts.
  density: ProfileDensity;
  copyKey: 'profile.copy.developer' | 'profile.copy.vibe' | 'profile.copy.hybrid';
}

export const PROFILE_IDS: readonly UserProfile[] = ['developer', 'vibe', 'hybrid'];

const NAV_ORDER_DEVELOPER: PanelScreen[] = [
  'dashboard',
  'disk',
  'plan',
  'projects',
  'graph',
  'env',
  'tools',
  'schedules',
  'vault',
  'settings',
];

const NAV_ORDER_VIBE: PanelScreen[] = [
  'dashboard',
  'disk',
  'plan',
  'tools',
  'projects',
  'env',
  'graph',
  'schedules',
  'vault',
  'settings',
];

const NAV_ORDER_HYBRID: PanelScreen[] = [
  'dashboard',
  'disk',
  'plan',
  'projects',
  'tools',
  'env',
  'graph',
  'schedules',
  'vault',
  'settings',
];

export const PROFILE_VIEWS: Record<UserProfile, ProfileView> = {
  developer: {
    id: 'developer',
    initialScreen: 'projects',
    navOrder: NAV_ORDER_DEVELOPER,
    density: 'compact',
    copyKey: 'profile.copy.developer',
  },
  vibe: {
    id: 'vibe',
    initialScreen: 'dashboard',
    navOrder: NAV_ORDER_VIBE,
    density: 'normal',
    copyKey: 'profile.copy.vibe',
  },
  hybrid: {
    id: 'hybrid',
    initialScreen: 'dashboard',
    navOrder: NAV_ORDER_HYBRID,
    density: 'detailed',
    copyKey: 'profile.copy.hybrid',
  },
};

export function profileViewFor(
  id: UserProfile | string | null | undefined,
): ProfileView {
  if (id === 'developer' || id === 'vibe' || id === 'hybrid') {
    return PROFILE_VIEWS[id];
  }
  return PROFILE_VIEWS.hybrid;
}