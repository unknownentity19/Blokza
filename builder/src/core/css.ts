/**
 * Compiles a document into a stylesheet.
 *
 * Why a stylesheet instead of inline styles:
 *   - `@media` rules cannot be expressed inline, so responsive overrides would
 *     be fake (the old editor only resized the sheet).
 *   - `:hover` cannot be expressed inline either.
 *   - Removing a property means deleting a declaration rather than remembering
 *     to reset it, so styles can never leak between renders.
 *
 * The same output is used by the canvas iframe and by the export, so what the
 * user sees is what ships.
 */

import { walk } from './tree';
import {
  BREAKPOINT_MAX_WIDTH,
  STYLE_STATES,
  isStyleKey,
  type Breakpoint,
  type SiteDoc,
  type StyleBag,
  type StyleKey,
  type Theme,
} from './types';

/** Class applied to a node's root element. Also the CSS hook for its styles. */
export function nodeClass(id: string): string {
  return `n-${id}`;
}

/** Class applied to every instance of a component type, for its static CSS. */
export function typeClass(type: string): string {
  return `c-${type}`;
}

export function cssVarName(token: string): string {
  return `--${token.replace(/[^a-zA-Z0-9-]/g, '-')}`;
}

/* ------------------------------------------------------------------ */
/* Declaration safety                                                  */
/* ------------------------------------------------------------------ */

const CAMEL = /[A-Z]/g;

export function kebab(key: string): string {
  return key.replace(CAMEL, (m) => `-${m.toLowerCase()}`);
}

/**
 * Characters that would let a value escape its declaration, plus the two
 * constructs that can execute script from a stylesheet. Property *names* are
 * already constrained by the `STYLE_KEYS` whitelist, so this only has to make
 * values inert.
 */
const UNSAFE_VALUE = /[{}<>;]|\/\*|\*\/|@import|javascript:|expression\s*\(|url\s*\(\s*['"]?\s*(?:javascript|data:text\/html)/i;

export function isSafeValue(value: string): boolean {
  return value.length <= 600 && !UNSAFE_VALUE.test(value);
}

/** Serialise one bag into `prop: value;` lines, dropping anything unsafe. */
export function declarations(bag: StyleBag | undefined, indent = '  '): string {
  if (!bag) return '';
  const out: string[] = [];
  // Sorted so the generated stylesheet is stable across edits (nicer diffs,
  // and it lets the export be byte-compared in tests).
  for (const key of Object.keys(bag).sort()) {
    if (!isStyleKey(key)) continue;
    const value = bag[key as StyleKey];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || !isSafeValue(trimmed)) continue;
    out.push(`${indent}${kebab(key)}: ${trimmed};`);
  }
  return out.join('\n');
}

function rule(selector: string, bag: StyleBag | undefined, indent = ''): string {
  const body = declarations(bag, `${indent}  `);
  if (!body) return '';
  return `${indent}${selector} {\n${body}\n${indent}}\n`;
}

/* ------------------------------------------------------------------ */
/* Effective styles (used by the inspector)                            */
/* ------------------------------------------------------------------ */

/** Breakpoints that cascade into `bp`, widest first. */
export function cascadeFor(bp: Breakpoint): Breakpoint[] {
  if (bp === 'base') return ['base'];
  if (bp === 'tablet') return ['base', 'tablet'];
  return ['base', 'tablet', 'mobile'];
}

/**
 * What the node actually renders as at `bp`, i.e. base overlaid with each
 * narrower breakpoint's overrides. The inspector shows these as the *inherited*
 * value (greyed) when the current breakpoint has no explicit override.
 */
export function effectiveStyles(
  styles: { base?: StyleBag; tablet?: StyleBag; mobile?: StyleBag },
  bp: Breakpoint,
): StyleBag {
  const out: StyleBag = {};
  for (const layer of cascadeFor(bp)) Object.assign(out, styles[layer] ?? {});
  return out;
}

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

export function themeCss(theme: Theme): string {
  const lines: string[] = [];
  for (const token of theme.colors) {
    const value = token.value.trim();
    if (!token.name || !isSafeValue(value)) continue;
    lines.push(`  ${cssVarName(`color-${token.name}`)}: ${value};`);
  }
  for (const [key, value] of Object.entries(theme.fonts)) {
    if (isSafeValue(value)) lines.push(`  ${cssVarName(`font-${key}`)}: ${value};`);
  }
  if (isSafeValue(theme.radius)) lines.push(`  ${cssVarName('radius')}: ${theme.radius};`);
  if (isSafeValue(theme.maxWidth)) lines.push(`  ${cssVarName('max-width')}: ${theme.maxWidth};`);
  return `:root {\n${lines.join('\n')}\n}\n`;
}

/**
 * Document-level reset. Kept small on purpose: the goal is a predictable
 * starting point, not an opinionated framework the user has to fight.
 */
export const RESET_CSS = `*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.6;
  color: var(--color-ink, #181024);
  background: var(--color-canvas, #ffffff);
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3, h4, h5, h6 { margin: 0; font-family: var(--font-heading); line-height: 1.15; }
p, figure, blockquote, ul, ol, dl, pre { margin: 0; }
ul, ol { padding: 0; list-style: none; }
img, svg, video, iframe { display: block; max-width: 100%; }
a { color: inherit; text-decoration: none; }
button, input, textarea, select { font: inherit; color: inherit; }
`;

/* ------------------------------------------------------------------ */
/* Document compilation                                                */
/* ------------------------------------------------------------------ */

export interface CompileOptions {
  /** Static CSS per component type, keyed by type. Emitted once per used type. */
  componentCss?: (type: string) => string | undefined;
  /** Restrict output to one page's tree. Defaults to every page. */
  pageIds?: string[];
  /** Include the reset. Off when the caller already emitted it. */
  includeReset?: boolean;
}

/**
 * Emit the whole stylesheet: reset, theme, component CSS, then per-node rules
 * grouped so that base rules come first and narrower breakpoints override them.
 *
 * `:hover` rules are emitted before the media queries but still win, because
 * `.n-x:hover` (class + pseudo-class) outranks `.n-x` on specificity. That is
 * intentional — it means a hover style set once keeps working at every
 * breakpoint without being duplicated into each media query.
 */
export function compileCss(doc: SiteDoc, options: CompileOptions = {}): string {
  const { componentCss, pageIds, includeReset = true } = options;

  const pages = pageIds ? doc.pages.filter((p) => pageIds.includes(p.id)) : doc.pages;

  // Walk in document order so output is deterministic.
  const order: string[] = [];
  const seen = new Set<string>();
  const usedTypes = new Set<string>();
  const collect = (rootId: string) => {
    walk(doc.nodes, rootId, (node) => {
      if (seen.has(node.id)) return;
      seen.add(node.id);
      order.push(node.id);
      usedTypes.add(node.type);
    });
  };

  for (const page of pages) collect(page.rootId);

  /*
   * Shared masters are deliberately detached from every page, so a walk over the
   * pages alone never reaches them — which meant a shared nav rendered with no
   * styles at all: `display: flex` gone, the container's max-width gone, the
   * whole bar collapsed into the corner. They are roots in their own right here
   * for the same reason they are in `repairDoc`.
   */
  for (const shared of doc.shared ?? []) collect(shared.rootId);

  const chunks: string[] = [];
  if (includeReset) chunks.push(RESET_CSS);
  chunks.push(themeCss(doc.theme));

  if (componentCss) {
    // De-duplicated by content: several component types share one CSS constant
    // (buttons, form controls), and each should be emitted exactly once.
    const typeChunks: string[] = [];
    const emitted = new Set<string>();
    for (const type of [...usedTypes].sort()) {
      const css = componentCss(type)?.trim();
      if (!css || emitted.has(css)) continue;
      emitted.add(css);
      typeChunks.push(css);
    }
    if (typeChunks.length) chunks.push(`${typeChunks.join('\n\n')}\n`);
  }

  // Base breakpoint.
  const base: string[] = [];
  for (const id of order) {
    const node = doc.nodes[id];
    base.push(rule(`.${nodeClass(id)}`, node.styles.base));
  }
  const baseCss = base.filter(Boolean).join('');
  if (baseCss) chunks.push(baseCss);

  // Interaction states.
  for (const state of STYLE_STATES) {
    const stateRules: string[] = [];
    for (const id of order) {
      const bag = doc.nodes[id].styles[state];
      if (bag) stateRules.push(rule(`.${nodeClass(id)}:${state}`, bag));
    }
    const css = stateRules.filter(Boolean).join('');
    if (css) chunks.push(css);
  }

  // Narrower breakpoints, widest first so mobile overrides tablet.
  for (const bp of ['tablet', 'mobile'] as const) {
    const inner: string[] = [];
    for (const id of order) {
      const bag = doc.nodes[id].styles[bp];
      if (bag) inner.push(rule(`.${nodeClass(id)}`, bag, '  '));
    }
    const body = inner.filter(Boolean).join('');
    if (body) {
      chunks.push(`@media (max-width: ${BREAKPOINT_MAX_WIDTH[bp]}px) {\n${body}}\n`);
    }
  }

  if (doc.theme.customCss && doc.theme.customCss.trim()) {
    chunks.push(`/* custom */\n${doc.theme.customCss.trim()}\n`);
  }

  return chunks.filter(Boolean).join('\n');
}
