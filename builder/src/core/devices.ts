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
    icon: 'M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2zM8 21L16 21M12 17L12 21',
  },
  {
    id: 'laptop',
    label: 'Laptop',
    width: 1180,
    height: 800,
    breakpoint: 'base',
    icon: 'M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2zM20.054 15.987H3.946',
  },
  {
    id: 'tablet',
    label: 'Tablet',
    width: 820,
    height: 1024,
    breakpoint: 'tablet',
    icon: 'M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-16a2 2 0 0 1 2 -2zM12 18L12.01 18',
  },
  {
    id: 'mobile',
    label: 'Mobile',
    width: 390,
    height: 844,
    breakpoint: 'mobile',
    icon: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-16a2 2 0 0 1 2 -2zM12 18h.01',
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
