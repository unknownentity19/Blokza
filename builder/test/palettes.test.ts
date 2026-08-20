/**
 * Contrast guarantees for the built-in palettes.
 *
 * This exists because of a real bug: `.c-button--primary` hardcoded white text,
 * so the Midnight palette's ochre brand produced a 2.22:1 button label — well
 * under the 4.5:1 WCAG AA floor and genuinely hard to read. The fix was a
 * `brand-ink` token; this test is what stops the next palette from reintroducing
 * the problem.
 */

import { describe, expect, it } from 'vitest';

import { PALETTES, paletteById } from '../src/registry/palettes';
import { BUTTON_CSS } from '../src/registry/shared-css';
import { defaultTheme } from '../src/core/doc';

/** WCAG relative luminance of an #rrggbb colour. */
function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => {
    const raw = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return raw <= 0.03928 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Pairs that appear as text-on-background in the shipped components. */
const TEXT_PAIRS: { fg: keyof (typeof PALETTES)[number]['colors']; bg: keyof (typeof PALETTES)[number]['colors']; where: string; min: number }[] = [
  { fg: 'brand-ink', bg: 'brand', where: 'primary button label', min: 4.5 },
  { fg: 'ink', bg: 'canvas', where: 'body text on the page', min: 4.5 },
  { fg: 'ink', bg: 'surface', where: 'text on a card', min: 4.5 },
  { fg: 'muted', bg: 'canvas', where: 'secondary text on the page', min: 4.5 },
  { fg: 'muted', bg: 'surface', where: 'secondary text on a card', min: 4.5 },
  { fg: 'ink', bg: 'brand-soft', where: 'text on a tinted panel', min: 4.5 },
  { fg: 'brand-dark', bg: 'brand-soft', where: 'badge label', min: 4.5 },
  // A link or icon in the brand colour is not body copy, so the large-text floor applies.
  { fg: 'brand', bg: 'canvas', where: 'brand-coloured link on the page', min: 3 },
  { fg: 'brand', bg: 'surface', where: 'brand-coloured link on a card', min: 3 },
];

describe('palette contrast', () => {
  it.each(PALETTES.map((p) => [p.id] as const))('%s meets WCAG AA everywhere it is used', (id) => {
    const palette = paletteById(id);
    if (!palette) throw new Error(`missing palette ${id}`);

    for (const pair of TEXT_PAIRS) {
      const fg = palette.colors[pair.fg];
      const bg = palette.colors[pair.bg];
      const ratio = contrast(fg, bg);
      expect(
        ratio,
        `${id}: ${pair.where} — ${pair.fg} ${fg} on ${pair.bg} ${bg} is ${ratio.toFixed(2)}:1, needs ${pair.min}:1`,
      ).toBeGreaterThanOrEqual(pair.min);
    }
  });

  it('every palette defines the same token names', () => {
    const expected = [...Object.keys(PALETTES[0].colors)].sort();
    for (const palette of PALETTES) {
      expect(Object.keys(palette.colors).sort(), palette.id).toEqual(expected);
      // Switching palettes must restyle existing elements, which only works
      // while the names stay identical.
      for (const value of Object.values(palette.colors)) {
        expect(value, `${palette.id} ${value}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('a new document ships every token a palette expects', () => {
    const names = new Set(defaultTheme().colors.map((token) => token.name));
    for (const name of Object.keys(PALETTES[0].colors)) {
      expect(names.has(name), `defaultTheme is missing "${name}"`).toBe(true);
    }
  });

  it('component css never hardcodes a text colour on the brand', () => {
    // The specific regression: `color: #ffffff` on a brand background.
    const brandRules = BUTTON_CSS.split('\n').filter((line) => line.includes('--color-brand'));
    expect(brandRules.length).toBeGreaterThan(0);
    for (const rule of brandRules) {
      expect(rule, `hardcoded colour in: ${rule.trim()}`).not.toMatch(/color:\s*#[0-9a-f]{3,8}\s*;/i);
    }
  });

  it('keeps a fallback so documents predating the token still render', () => {
    expect(BUTTON_CSS).toContain('var(--color-brand-ink, #ffffff)');
  });
});
