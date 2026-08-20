/**
 * Migration from the previous editor's saved state.
 *
 * The old editor stored a flat array of "blocks" under
 * `altask:editor-state-v2`, where each block was a whole section with named
 * text props (`title`, `f1Body`, …) and its internals unreachable. This module
 * expands each of those into the equivalent tree of primitives, so anyone who
 * had work in progress opens the new builder and finds their page rather than
 * an empty canvas.
 *
 * Text content is carried over. Per-block `_style.*` overrides are not: they
 * were keyed to markup that no longer exists, and a wrong style is worse than a
 * clean default.
 */

import type { PresetChild } from './types';
import { TEMPLATES } from '../registry/templates';

interface LegacyBlock {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
}

export interface LegacyState {
  blocks?: LegacyBlock[];
  name?: string;
  siteUrl?: string;
}

export const LEGACY_STORAGE_KEYS = ['altask:editor-state-v2', 'altask:editor-state-v1'];

function s(props: Record<string, unknown>, key: string, fallback = ''): string {
  const value = props[key];
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback;
}

/** Clone a template tree and rewrite the text of specific descendants. */
function fromTemplate(id: string, edits: (tree: PresetChild) => void): PresetChild | undefined {
  const template = TEMPLATES.find((t) => t.id === id);
  if (!template) return undefined;
  const tree = JSON.parse(JSON.stringify(template.tree)) as PresetChild;
  edits(tree);
  return tree;
}

/** Depth-first list of every node in a preset tree with the given type. */
function ofType(tree: PresetChild, type: string): PresetChild[] {
  const out: PresetChild[] = [];
  const visit = (node: PresetChild) => {
    if (node.type === type) out.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  return out;
}

function setText(node: PresetChild | undefined, key: string, value: string): void {
  if (!node || !value) return;
  node.props = { ...(node.props ?? {}), [key]: value };
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * One legacy block becomes one preset tree. Returns `undefined` for block types
 * with no sensible equivalent, which are then skipped.
 */
export function migrateBlock(block: LegacyBlock): PresetChild | undefined {
  const type = typeof block.type === 'string' ? block.type : '';
  const props = block.props ?? {};

  switch (type) {
    case 'navbar':
      return fromTemplate('navbar', (tree) => {
        const headings = ofType(tree, 'heading');
        setText(headings[0], 'text', s(props, 'brand'));
        const links = ofType(tree, 'link');
        const labels = splitList(s(props, 'links'));
        labels.slice(0, 3).forEach((label, i) => setText(links[i], 'label', label));
        const buttons = ofType(tree, 'button');
        setText(buttons[0], 'label', s(props, 'cta'));
        setText(buttons[0], 'href', s(props, 'ctaHref', '#'));
      });

    case 'hero':
    case 'heroOverlay':
      return fromTemplate('hero-split', (tree) => {
        setText(ofType(tree, 'heading')[0], 'text', s(props, 'title'));
        setText(ofType(tree, 'text')[0], 'text', s(props, 'subtitle'));
        const buttons = ofType(tree, 'button');
        setText(buttons[0], 'label', s(props, 'primaryLabel'));
        setText(buttons[0], 'href', s(props, 'primaryHref', '#'));
        setText(buttons[1], 'label', s(props, 'secondaryLabel'));
        setText(buttons[1], 'href', s(props, 'secondaryHref', '#'));
      });

    case 'features':
      return fromTemplate('feature-grid', (tree) => {
        const headings = ofType(tree, 'heading');
        setText(headings[0], 'text', s(props, 'title'));
        const texts = ofType(tree, 'text');
        for (let i = 0; i < 3; i += 1) {
          setText(headings[i + 1], 'text', s(props, `f${i + 1}Title`));
          setText(texts[i + 1], 'text', s(props, `f${i + 1}Body`));
        }
      });

    case 'columns':
      return fromTemplate('feature-alt', (tree) => {
        setText(ofType(tree, 'heading')[0], 'text', s(props, 'title'));
        setText(ofType(tree, 'text')[1], 'text', s(props, 'body'));
      });

    case 'gallery':
      return fromTemplate('gallery', () => {});

    case 'quote':
      return fromTemplate('testimonials', (tree) => {
        const quotes = ofType(tree, 'quote');
        setText(quotes[0], 'text', s(props, 'body'));
        // The old editor stored "Name, Role" in one field.
        const [author, ...rest] = s(props, 'author').split(',');
        setText(quotes[0], 'author', (author ?? '').trim());
        setText(quotes[0], 'role', rest.join(',').trim());
      });

    case 'cta':
      return fromTemplate('cta', (tree) => {
        setText(ofType(tree, 'heading')[0], 'text', s(props, 'title'));
        setText(ofType(tree, 'text')[0], 'text', s(props, 'subtitle'));
        setText(ofType(tree, 'button')[0], 'label', s(props, 'label'));
        setText(ofType(tree, 'button')[0], 'href', s(props, 'href', '#'));
      });

    case 'form':
    case 'contactForm':
      return fromTemplate('contact', (tree) => {
        setText(ofType(tree, 'heading')[0], 'text', s(props, 'title'));
        setText(ofType(tree, 'text')[1], 'text', s(props, 'subtitle'));
      });

    case 'footer':
      return fromTemplate('footer', (tree) => {
        const texts = ofType(tree, 'text');
        setText(texts[texts.length - 1], 'text', s(props, 'note'));
      });

    case 'heading':
      return {
        type: 'section',
        children: [
          {
            type: 'container',
            children: [
              { type: 'heading', props: { text: s(props, 'title'), level: 'h2' } },
              { type: 'text', props: { text: s(props, 'subtitle') } },
            ],
          },
        ],
      };

    case 'text':
      return {
        type: 'section',
        children: [
          { type: 'container', children: [{ type: 'text', props: { text: s(props, 'body') } }] },
        ],
      };

    case 'image':
      return {
        type: 'section',
        children: [
          { type: 'container', children: [{ type: 'image', props: { src: s(props, 'url'), alt: '' } }] },
        ],
      };

    case 'button':
      return {
        type: 'section',
        children: [
          {
            type: 'container',
            children: [
              {
                type: 'button',
                props: { label: s(props, 'label', 'Button'), href: s(props, 'href', '#'), variant: 'primary' },
              },
            ],
          },
        ],
      };

    case 'buttonGroup':
      return {
        type: 'section',
        children: [
          {
            type: 'container',
            children: [
              {
                type: 'row',
                styles: { base: { width: 'auto', gap: '12px' } },
                children: [
                  { type: 'button', props: { label: s(props, 'primaryLabel', 'Get started'), href: s(props, 'primaryHref', '#'), variant: 'primary' } },
                  { type: 'button', props: { label: s(props, 'secondaryLabel', 'Learn more'), href: s(props, 'secondaryHref', '#'), variant: 'secondary' } },
                ],
              },
            ],
          },
        ],
      };

    case 'spacer':
      return { type: 'section', children: [{ type: 'spacer' }] };

    case 'divider':
      return { type: 'section', children: [{ type: 'container', children: [{ type: 'divider' }] }] };

    default:
      return undefined;
  }
}

export interface MigrationResult {
  trees: PresetChild[];
  name: string;
  /** Legacy block types that had no equivalent and were dropped. */
  skipped: string[];
}

export function migrateLegacyState(raw: unknown): MigrationResult | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const state = raw as LegacyState;
  if (!Array.isArray(state.blocks) || state.blocks.length === 0) return undefined;

  const trees: PresetChild[] = [];
  const skipped: string[] = [];
  for (const block of state.blocks) {
    const tree = migrateBlock(block);
    if (tree) trees.push(tree);
    else if (typeof block.type === 'string') skipped.push(block.type);
  }
  if (!trees.length) return undefined;

  return {
    trees,
    name: typeof state.name === 'string' && state.name.trim() ? state.name.trim() : 'Untitled site',
    skipped: [...new Set(skipped)],
  };
}
