import type { ReactElement } from 'react';

/**
 * ICON SETI — inline SVG, bagimlilik yok.
 *
 * Yalnizca sunum: ikonlar karar vermez, sadece bir dugmeyi etiketler.
 * Rengi `currentColor` ile devralir (aktif/pasif durum CSS'ten gelir).
 */

export type IconName =
  | 'menu'
  | 'close'
  | 'dashboard'
  | 'disk'
  | 'plan'
  | 'projects'
  | 'tools'
  | 'env'
  | 'graph'
  | 'schedules'
  | 'vault'
  | 'settings'
  | 'panel'
  | 'check'
  | 'chevronDown'
  | 'file'
  | 'lock'
  | 'arrowRight'
  | 'search';

const PATHS: Record<IconName, ReactElement> = {
  menu: <path d="M2 4h12M2 8h12M2 12h12" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  dashboard: (
    <>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </>
  ),
  disk: (
    <>
      <rect x="1.5" y="4.5" width="13" height="7" rx="1.5" />
      <circle cx="4.5" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <path d="M7 8h5" />
    </>
  ),
  plan: (
    <>
      <rect x="3.5" y="3" width="9" height="11" rx="1.5" />
      <path d="M6 2h4v2H6z" />
      <path d="M6 8.5l1.6 1.6L10.6 6.8" />
    </>
  ),
  projects: (
    <path d="M1.5 4.5h4l1.5 2h7.5v6a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 1.5 12.5z" />
  ),
  tools: (
    <>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M4 6.5l2.5 2L4 10.5" />
      <path d="M8.5 10.5h3.5" />
    </>
  ),
  env: (
    <>
      <path d="M2 5h12M2 11h12" />
      <circle cx="6" cy="5" r="1.8" />
      <circle cx="10" cy="11" r="1.8" />
    </>
  ),
  graph: (
    <>
      <circle cx="3.5" cy="3.5" r="1.8" />
      <circle cx="12.5" cy="12.5" r="1.8" />
      <circle cx="12.5" cy="3.5" r="1.8" />
      <path d="M5.1 4.1l5.9 1.1M4.4 5l6.8 5.9" />
    </>
  ),
  schedules: (
    <>
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M5.5 2v2M10.5 2v2" />
    </>
  ),
  vault: (
    <>
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
      <path d="M2 6.5h12" />
      <path d="M6.5 10h3" />
    </>
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3M12.6 12.6l-1.3-1.3M4.7 4.7L3.4 3.4" />
    </>
  ),
  panel: (
    <>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M10 2.5v11" />
    </>
  ),
  check: <path d="M3 8.5l3.5 3.5L13 4.5" />,
  chevronDown: <path d="M4 6l4 4 4-4" />,
  file: (
    <>
      <path d="M4 1.5h5l3 3V14.5H4z" />
      <path d="M9 1.5v3h3" />
    </>
  ),
  lock: (
    <>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
      <circle cx="8" cy="10.4" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  arrowRight: <path d="M3 8h10M9 4l4 4-4 4" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </>
  ),
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
