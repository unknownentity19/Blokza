/**
 * Device presets for the canvas.
 *
 * `width` is the real CSS width given to the preview iframe, which is why the
 * media queries in the compiled stylesheet actually fire: the iframe genuinely
 * *is* 375px wide, rather than a 1440px page scaled down to look small.
 */

import { type Breakpoint, type DevicePreset } from './types';

export const DEVICES: DevicePreset[] = [
  {
    id: 'desktop',
    label: 'Desktop',
    width: 1440,
    height: 900,
    breakpoint: 'base',
    icon: 'M3 5h18v11H3zM8 20h8M12 16v4',
  },
  {
    id: 'laptop',
    label: 'Laptop',
    width: 1180,
    height: 800,
    breakpoint: 'base',
    icon: 'M5 5h14v10H5zM2 18h20',
  },
  {
    id: 'tablet',
    label: 'Tablet',
    width: 820,
    height: 1024,
    breakpoint: 'tablet',
    icon: 'M6 3h12v18H6zM12 18h.01',
  },
  {
    id: 'mobile',
    label: 'Mobile',
    width: 390,
    height: 844,
    breakpoint: 'mobile',
    icon: 'M8 2h8v20H8zM12 18.5h.01',
  },
];

export function deviceById(id: string): DevicePreset {
  return DEVICES.find((device) => device.id === id) ?? DEVICES[0];
}

export function breakpointForDevice(id: string): Breakpoint {
  return deviceById(id).breakpoint;
}

/** Discrete zoom stops, so the keyboard and the wheel land on the same values. */
export const ZOOM_STEPS = [0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1, 1.25, 1.5, 2];

export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

export function nextZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find((step) => step > current + 0.001) ?? MAX_ZOOM;
  const lower = [...ZOOM_STEPS].reverse().find((step) => step < current - 0.001);
  return lower ?? MIN_ZOOM;
}

export function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}
