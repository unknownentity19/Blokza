/**
 * Builds node trees from the component registry.
 *
 * This is the one module under `core/` that knows the registry exists. Keeping
 * that dependency in a single place is what lets `doc.ts`, `tree.ts` and
 * `css.ts` stay pure data modules that tests can drive with fixtures.
 */

import { uid } from './ids';
import { PAGE_ROOT_TYPE, SHARED_TYPE } from './doc';
import type { NodeStyles, PresetChild, SBNode, SiteDoc, StyleBag } from './types';
import { getComponent } from '../registry/registry';
import type { Template } from '../registry/templates';

export interface Spawned {
  rootId: string;
  /** Parents before children, so `insertSubtree` can add them in order. */
  nodes: SBNode[];
}

/** Layer-wise merge: a preset's declarations win over the component's defaults. */
function mergeStyles(base: NodeStyles | undefined, override: NodeStyles | undefined): NodeStyles {
  if (!base && !override) return {};
  const out: NodeStyles = {};
  const layers = new Set([...Object.keys(base ?? {}), ...Object.keys(override ?? {})]) as Set<
    keyof NodeStyles
  >;
  for (const layer of layers) {
    const merged: StyleBag = { ...(base?.[layer] ?? {}), ...(override?.[layer] ?? {}) };
    if (Object.keys(merged).length) out[layer] = merged;
  }
  return out;
}

function clone<T>(value: T): T {
  return value === null || typeof value !== 'object' ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/**
 * Expand one preset node (and its children) into detached `SBNode`s.
 * Unknown component types are skipped rather than throwing, so a document from
 * a newer version of the builder degrades instead of failing to open.
 */
function build(preset: PresetChild, parent: string | null, out: SBNode[]): string | undefined {
  const def = getComponent(preset.type);
  if (!def) return undefined;

  const node: SBNode = {
    id: uid(),
    type: preset.type,
    props: { ...clone(def.defaults ?? {}), ...clone(preset.props ?? {}) },
    styles: mergeStyles(def.defaultStyles, preset.styles),
    children: [],
    parent,
  };
  out.push(node);

  // A preset's own children replace the component's `presetChildren`; that way a
  // template can compose a container without inheriting its stock contents.
  const kids = preset.children ?? def.presetChildren ?? [];
  for (const child of kids) {
    const childId = build(child, node.id, out);
    if (childId) node.children.push(childId);
  }

  return node.id;
}

/** A fresh instance of one component type, including its preset children. */
export function spawnComponent(type: string): Spawned | undefined {
  const nodes: SBNode[] = [];
  const rootId = build({ type }, null, nodes);
  return rootId ? { rootId, nodes } : undefined;
}

/** A fresh instance of a preset tree. */
export function spawnPreset(preset: PresetChild): Spawned | undefined {
  const nodes: SBNode[] = [];
  const rootId = build(preset, null, nodes);
  return rootId ? { rootId, nodes } : undefined;
}

export function spawnTemplate(template: Template): Spawned | undefined {
  return spawnPreset(template.tree);
}

/**
 * Label for a node, given the whole document.
 *
 * A section carries no text of its own, so `displayName` fell back to the
 * component label and a real site turned into a layers panel full of identical
 * "Section" rows. This looks one step further: the semantic tag first, then the
 * first heading inside, which is how a person actually refers to a section.
 */
export function nodeLabel(doc: SiteDoc, node: SBNode): string {
  if (node.name) return node.name;

  if (node.type === SHARED_TYPE) {
    const shared = (doc.shared ?? []).find((entry) => entry.id === node.props.sharedId);
    const master = shared ? doc.nodes[shared.rootId] : undefined;
    const inner = master ? nodeLabel(doc, master) : 'Shared section';
    return shared?.name && shared.name !== 'Section' ? shared.name : inner;
  }

  // A page root is the page.
  if (node.parent === null && node.type === PAGE_ROOT_TYPE) {
    const page = doc.pages.find((candidate) => candidate.rootId === node.id);
    return page ? page.name : 'Page';
  }

  const own = displayName(node);
  const def = getComponent(node.type);
  // `displayName` already found real content — keep it.
  if (own !== (def?.label ?? node.type)) return own;

  const tag = node.props.tag;
  if (typeof tag === 'string' && SEMANTIC_LABELS[tag]) return SEMANTIC_LABELS[tag];

  /*
   * The heading fallback is only for a *top-level* section.
   *
   * Applied to every container it named the whole ancestor chain after the same
   * heading — page, section, container, row and stack all reading "Design the
   * page. Ship the site." — which is less useful than the generic labels, because
   * it hides the nesting. Inner boxes keep "Container", "Row", "Stack": those
   * describe the role, which is what a tree needs.
   */
  const parent = node.parent ? doc.nodes[node.parent] : undefined;
  const isTopLevel = node.parent === null || parent?.type === PAGE_ROOT_TYPE;
  if (!isTopLevel) return own;

  return firstHeadingIn(doc, node.id) ?? own;
}

const SEMANTIC_LABELS: Record<string, string> = {
  header: 'Header',
  footer: 'Footer',
  nav: 'Navigation',
  aside: 'Sidebar',
  main: 'Main',
  article: 'Article',
};

/** Text of the first heading in a subtree, for naming a container by its content. */
function firstHeadingIn(doc: SiteDoc, rootId: string, depth = 0): string | undefined {
  if (depth > 6) return undefined;
  const node = doc.nodes[rootId];
  if (!node) return undefined;
  if (node.type === 'heading') {
    const text = node.props.text;
    if (typeof text === 'string' && text.trim()) return trimLabel(text);
  }
  for (const child of node.children) {
    const found = firstHeadingIn(doc, child, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function trimLabel(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length > 34 ? `${trimmed.slice(0, 34)}…` : trimmed;
}

/** Human-readable default label from a node alone, with no document context. */
export function displayName(node: SBNode): string {
  if (node.name) return node.name;
  const def = getComponent(node.type);
  const label = def?.label ?? node.type;
  // Text-ish nodes read much better in a tree when labelled by their content.
  for (const key of ['text', 'label', 'name']) {
    const value = node.props[key];
    if (typeof value === 'string' && value.trim()) return trimLabel(value);
  }
  return label;
}
