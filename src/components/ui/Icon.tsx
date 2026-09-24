// Iconos de línea del diseño (24×24, trazo). Cada uno es el atributo `d` de un <path>.

export const ICON = {
  summary: 'M3 11l9-8 9 8M5 9.5V21h14V9.5',
  agent: 'M4 5h16v11H8l-4 4z',
  patients:
    'M16 20v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8M21 20v-2a4 4 0 0 0-3-3.9M16 2.1a4 4 0 0 1 0 7.8',
  beds: 'M3 19V6M3 14h18v5M21 14v-2a3 3 0 0 0-3-3h-7v5M7 12a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3',
  drugs: 'M10.5 20.5l10-10a4.95 4.95 0 0 0-7-7l-10 10a4.95 4.95 0 0 0 7 7zM8.5 8.5l7 7',
  surgeries: 'M4 5h16v16H4zM4 10h16M9 3v4M15 3v4',
  alerts: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  sources:
    'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  users:
    'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5M8 16.5c1-1.5 2.4-2 4-2s3 .5 4 2',
  logs: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  warning: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 8v5M12 16h.01',
  check: 'M5 12l5 5 9-10',
  close: 'M6 6l12 12M18 6L6 18',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  download: 'M12 3v12M6 11l6 6 6-6M4 21h16',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  logout: 'M15 4h4v16h-4M10 17l5-5-5-5M15 12H3',
  menu: 'M3 6h18M3 12h18M3 18h18',
  chevron: 'M6 9l6 6 6-6',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  file: 'M6 3h9l4 4v14H6zM14 3v5h5',
  offline: 'M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01M3 3l18 18',
  info: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 8v5M12 16h.01',
  clock: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 7v5l3 2',
} as const;

export type IconName = keyof typeof ICON;

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function Icon({ name, size = 18, strokeWidth = 1.8, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={ICON[name]} />
    </svg>
  );
}
