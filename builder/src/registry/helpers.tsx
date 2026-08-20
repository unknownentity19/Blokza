/**
 * Shared render helpers for component definitions.
 *
 * Two rules every component follows:
 *  1. Spread `p.attrs` onto the root element — that is what carries the node's
 *     generated class, the hit-testing id, and the drag hooks.
 *  2. Mark inline-editable text with `data-edit="<propKey>"`. The canvas owns
 *     contenteditable; components only declare which element edits which prop.
 */

import { Fragment, type ReactNode } from 'react';
import type { FieldOption, RenderProps } from '../core/types';
import { sanitizeHtml } from '../core/sanitize';

export function str(props: Record<string, unknown>, key: string, fallback = ''): string {
  const value = props[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return fallback;
}

export function bool(props: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = props[key];
  return typeof value === 'boolean' ? value : fallback;
}

export function num(props: Record<string, unknown>, key: string, fallback = 0): number {
  const value = props[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function list(props: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = props[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
}

/** Attributes that mark an element as the inline editor for `key`. */
export function editSlot(p: RenderProps, key: string): Record<string, string> {
  return p.mode === 'canvas' ? { 'data-edit': key } : {};
}

/**
 * Text node with an inline-edit slot.
 *
 * Two things it has to get right:
 *
 *  - **Line breaks survive.** HTML collapses newlines, so text typed across
 *    several lines (in the inspector's textarea, or with shift+enter on the
 *    canvas) would silently render as one run. Each newline becomes a `<br />`,
 *    which round-trips cleanly because `innerText` turns it back into `\n` when
 *    the inline editor commits.
 *  - **Empty text stays clickable.** A heading with no content has no height and
 *    cannot be selected or typed into, so the canvas renders a zero-width space.
 */
export function Txt({ p, k, fallback = '' }: { p: RenderProps; k: string; fallback?: string }): ReactNode {
  const value = str(p.props, k, fallback);
  if (!value) return p.mode === 'canvas' ? '\u200b' : null;
  if (!value.includes('\n')) return value;

  const lines = value.split('\n');
  return lines.map((line, index) => (
    <Fragment key={index}>
      {index > 0 ? <br /> : null}
      {line}
    </Fragment>
  ));
}

export function textOf(p: RenderProps, k: string, fallback = ''): string {
  return str(p.props, k, fallback);
}

/** Sanitised rich text. Never renders raw user markup. */
export function RichHtml({ html, allowEmbeds = false }: { html: string; allowEmbeds?: boolean }): ReactNode {
  return <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(html, { allowEmbeds }) }} />;
}

export function options(...pairs: [string, string][]): FieldOption[] {
  return pairs.map(([value, label]) => ({ value, label }));
}

/** `select` options from plain values, label = value. */
export function valueOptions(...values: string[]): FieldOption[] {
  return values.map((value) => ({ value, label: value }));
}

/**
 * Placeholder shown in the canvas when a container has no children. Without it
 * an empty flex container collapses to 0px and cannot be dropped into.
 */
export function EmptySlot({ p, label }: { p: RenderProps; label?: string }): ReactNode {
  if (p.mode === 'export') return null;
  if (p.node.children.length > 0) return null;
  return (
    <span className="sb-empty" data-sb-empty="" aria-hidden="true">
      {label ?? 'Drop elements here'}
    </span>
  );
}

/** Shared CSS for the empty-container placeholder. Canvas-only. */
export const EMPTY_SLOT_CSS = `.sb-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  min-height: 64px;
  min-width: 64px;
  padding: 12px;
  border: 1px dashed rgba(122, 95, 229, 0.45);
  border-radius: 4px;
  background: rgba(122, 95, 229, 0.04);
  color: #7a5fe5;
  font: 500 11px/1.3 var(--font-body, system-ui);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  text-align: center;
  user-select: none;
}`;

/**
 * Root className plus extra component classes.
 *
 * Variant classes are deliberately flat (`c-button--primary`, not
 * `.c-button[data-variant=primary]`): a single class keeps them at the same
 * specificity as the per-node rule `.n-<id>`, and node rules are emitted after
 * component rules, so anything the user sets in the inspector wins.
 */
export function cls(p: RenderProps, ...extra: (string | false | null | undefined)[]): string {
  return [p.attrs.className, ...extra.filter(Boolean)].join(' ');
}
