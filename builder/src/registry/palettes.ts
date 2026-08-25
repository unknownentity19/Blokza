/**
 * Theme presets.
 *
 * Re-skinning a site meant editing eight hex fields one at a time, which is a lot
 * of work to answer "what would this look like dark?". A preset writes all of them
 * at once.
 *
 * Token *names* are identical across every preset, and that is the whole point:
 * elements reference `var(--color-brand)`, so switching palettes restyles the
 * existing document instead of orphaning every colour already in use.
 */

import type { Theme } from '../core/types';

export interface Palette {
  id: string;
  label: string;
  /** Swatches shown on the button, in the order they read best. */
  preview: string[];
  colors: Record<
    | 'brand'
    | 'brand-dark'
    | 'brand-soft'
    /** Text on top of `brand`. Must clear 4.5:1 against it — see palettes.test.ts. */
    | 'brand-ink'
    | 'ink'
    | 'muted'
    | 'line'
    | 'surface'
    | 'canvas',
    string
  >;
  fonts?: Partial<Theme['fonts']>;
  radius?: string;
}

export const PALETTES: Palette[] = [
  {
    id: 'saaswise',
    label: 'SAASWISE',
    preview: ['#7a5fe5', '#f4f1ff', '#181024', '#f8f9fb'],
    colors: {
      brand: '#7a5fe5',
      'brand-dark': '#4f30c2',
      'brand-soft': '#f4f1ff',
      'brand-ink': '#ffffff',
      ink: '#181024',
      muted: '#5b5470',
      line: '#e1e5ed',
      surface: '#ffffff',
      canvas: '#f8f9fb',
    },
    fonts: { heading: '"Fraunces", Georgia, serif', body: '"Inter", system-ui, sans-serif' },
    radius: '6px',
  },
  {
    id: 'midnight',
    label: 'Midnight',
    preview: ['#e0a33c', '#2a2117', '#f4f1ea', '#0e0d0b'],
    colors: {
      brand: '#e0a33c',
      'brand-dark': '#c2872a',
      'brand-soft': '#2a2117',
      // Ochre is far too light for white text (2.2:1); near-black gives 8:1.
      'brand-ink': '#1a1408',
      ink: '#f4f1ea',
      muted: '#a29b8d',
      line: '#2c2925',
      surface: '#171613',
      canvas: '#0e0d0b',
    },
    fonts: { heading: '"Fraunces", Georgia, serif', body: '"Inter", system-ui, sans-serif' },
    radius: '4px',
  },
  {
    id: 'editorial',
    label: 'Editorial',
    preview: ['#c02b1d', '#f7efe4', '#1b1815', '#fdfaf5'],
    colors: {
      brand: '#c02b1d',
      'brand-dark': '#94200f',
      'brand-soft': '#f9ece7',
      'brand-ink': '#ffffff',
      ink: '#1b1815',
      muted: '#6b6259',
      line: '#e5dccd',
      surface: '#fdfaf5',
      canvas: '#f7f2e9',
    },
    fonts: { heading: '"Playfair Display", Georgia, serif', body: '"Inter", system-ui, sans-serif' },
    radius: '0px',
  },
  {
    id: 'forest',
    label: 'Forest',
    preview: ['#2f7d5c', '#e7f2ec', '#132019', '#f6faf7'],
    colors: {
      brand: '#2f7d5c',
      'brand-dark': '#1f5c42',
      'brand-soft': '#e7f2ec',
      'brand-ink': '#ffffff',
      ink: '#132019',
      muted: '#54655c',
      line: '#d8e6dd',
      surface: '#ffffff',
      canvas: '#f6faf7',
    },
    fonts: { heading: '"Manrope", system-ui, sans-serif', body: '"Inter", system-ui, sans-serif' },
    radius: '10px',
  },
  {
    id: 'mono',
    label: 'Mono',
    preview: ['#111111', '#f0f0f0', '#111111', '#ffffff'],
    colors: {
      brand: '#111111',
      'brand-dark': '#000000',
      'brand-soft': '#f1f1f1',
      'brand-ink': '#ffffff',
      ink: '#111111',
      muted: '#6d6d6d',
      line: '#e2e2e2',
      surface: '#ffffff',
      canvas: '#fafafa',
    },
    fonts: { heading: '"Inter", system-ui, sans-serif', body: '"Inter", system-ui, sans-serif' },
    radius: '2px',
  },
];

export function paletteById(id: string): Palette | undefined {
  return PALETTES.find((palette) => palette.id === id);
}
