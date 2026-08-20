/**
 * Icon set shared by the palette, the inspector, and the `icon` component.
 * 24×24 viewBox, stroke-based, so one path string renders at any size.
 */

export const ICONS: Record<string, string> = {
  check: 'M20 6L9 17l-5-5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  arrowRight: 'M5 12h14M13 5l7 7-7 7',
  arrowUpRight: 'M7 17L17 7M8 7h9v9',
  star: 'M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9z',
  heart: 'M12 20s-7-4.4-7-9.2A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.8C19 15.6 12 20 12 20z',
  bolt: 'M13 2L4 14h6l-1 8 9-12h-6z',
  shield: 'M12 3l8 3v6c0 5-3.6 8.3-8 9-4.4-.7-8-4-8-9V6z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.4 3.8 5.5 3.8 9S14.5 19.6 12 21c-2.5-1.4-3.8-4.5-3.8-9S9.5 5.4 12 3z',
  lock: 'M6 11h12v10H6zM9 11V8a3 3 0 0 1 6 0v3',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  phone: 'M6 3h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 4 5a2 2 0 0 1 2-2z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  users: 'M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 5a4 4 0 0 1 0 7M18 21h4a6 6 0 0 0-3-5',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 18l9 5 9-5',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  code: 'M9 18l-6-6 6-6M15 6l6 6-6 6',
  play: 'M6 4l14 8-14 8z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4 12h1M19 12h1M12 4v1M12 19v1M6.3 6.3l.7.7M17 17l.7.7M17.7 6.3l-.7.7M7 17l-.7.7',
  cart: 'M3 4h2l2.4 11h10.2L20 8H7M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  image: 'M3 5h18v14H3zM8 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM3 17l6-5 5 4 3-2 4 3',
  quote: 'M9 7c-3 0-5 2.4-5 5.4V19h6v-6H7c0-2 1-3.2 2.6-3.4zM20 7c-3 0-5 2.4-5 5.4V19h6v-6h-3c0-2 1-3.2 2.6-3.4z',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
};

export type IconName = keyof typeof ICONS;

export const ICON_NAMES = Object.keys(ICONS);

export function iconPath(name: string): string {
  return ICONS[name] ?? ICONS.star;
}
