/**
 * Tree queries over the normalised node map.
 *
 * Every function here is pure and takes the node map (not the whole document)
 * so the drag layer and the layers panel can share the same validation the
 * mutation helpers use. Nothing in this file mutates its arguments.
 */

import type { SBNode, DragPayload } from './types';

export type NodeMap = Record<string, SBNode>;

export function getNode(nodes: NodeMap, id: string | null | undefined): SBNode | undefined {
  return id ? nodes[id] : undefined;
}

/** Ids from the node up to (and including) its page root, nearest first. */
export function ancestorsOf(nodes: NodeMap, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cursor = nodes[id]?.parent ?? null;
  while (cursor && nodes[cursor] && !seen.has(cursor)) {
    out.push(cursor);
    seen.add(cursor);
    cursor = nodes[cursor].parent;
  }
  return out;
}

/** Depth of the node below its page root (root itself is 0). */
export function depthOf(nodes: NodeMap, id: string): number {
  return ancestorsOf(nodes, id).length;
}

/** The page-root ancestor of `id`, or `id` itself when it is already a root. */
export function rootOf(nodes: NodeMap, id: string): string | undefined {
  if (!nodes[id]) return undefined;
  const chain = ancestorsOf(nodes, id);
  return chain.length ? chain[chain.length - 1] : id;
}

/**
 * Every descendant of `id`, parents before children. Excludes `id`.
 * Cycle-safe: a node is never visited twice even if the map is corrupt.
 */
export function descendantsOf(nodes: NodeMap, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  const stack = [...(nodes[id]?.children ?? [])].reverse();
  while (stack.length) {
    const next = stack.pop() as string;
    if (seen.has(next) || !nodes[next]) continue;
    seen.add(next);
    out.push(next);
    const kids = nodes[next].children;
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
  }
  return out;
}

/** `id` and everything under it, parents before children. */
export function subtreeOf(nodes: NodeMap, id: string): string[] {
  return nodes[id] ? [id, ...descendantsOf(nodes, id)] : [];
}

export function isDescendant(nodes: NodeMap, ancestorId: string, maybeChildId: string): boolean {
  if (ancestorId === maybeChildId) return false;
  return ancestorsOf(nodes, maybeChildId).includes(ancestorId);
}

/** Index of `id` inside its parent's child list, or -1. */
export function indexOf(nodes: NodeMap, id: string): number {
  const parent = nodes[id]?.parent;
  if (!parent || !nodes[parent]) return -1;
  return nodes[parent].children.indexOf(id);
}

/** Walk a subtree depth-first, calling `visit(node, depth)`. */
export function walk(
  nodes: NodeMap,
  rootId: string,
  visit: (node: SBNode, depth: number) => void,
  depth = 0,
): void {
  const node = nodes[rootId];
  if (!node) return;
  visit(node, depth);
  for (const child of node.children) walk(nodes, child, visit, depth + 1);
}

/**
 * The node the user should actually select when they click `id`.
 * Locked nodes are transparent to clicks, so selection travels up to the
 * nearest unlocked ancestor (matching how Figma and Webflow behave).
 */
export function selectableAncestor(nodes: NodeMap, id: string): string | undefined {
  if (!nodes[id]) return undefined;
  if (!nodes[id].locked) return id;
  for (const ancestorId of ancestorsOf(nodes, id)) {
    if (!nodes[ancestorId].locked) return ancestorId;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Drop validation                                                     */
/* ------------------------------------------------------------------ */

/** What a component needs to expose for drop validation. Keeps `tree` free of registry imports. */
export interface DropRules {
  /** Can this type hold children at all? */
  container: boolean;
  /** Whitelist of child types, or `undefined` for "anything". */
  allowChildren?: string[];
  /** Whitelist of parent types, or `undefined` for "anything". */
  allowParents?: string[];
  /** Page roots: cannot be moved, deleted or duplicated. */
  fixed: boolean;
}

export type RulesLookup = (type: string) => DropRules | undefined;

export interface DropDecision {
  ok: boolean;
  /** Machine-readable reason, useful in tests and for the cursor hint. */
  reason?:
    | 'unknown-node'
    | 'unknown-type'
    | 'not-a-container'
    | 'locked-parent'
    | 'child-rejected'
    | 'parent-rejected'
    | 'fixed-node'
    | 'into-self'
    | 'into-descendant';
}

const OK: DropDecision = { ok: true };

/**
 * Can `payload` be placed inside `parentId`?
 *
 * This is the single source of truth used by the canvas drag layer, the layers
 * panel drag layer, and the paste/duplicate commands. The `index` is not part of
 * the decision — any index inside a valid parent is valid.
 */
export function canDrop(
  nodes: NodeMap,
  rules: RulesLookup,
  payload: DragPayload,
  parentId: string,
): DropDecision {
  const parent = nodes[parentId];
  if (!parent) return { ok: false, reason: 'unknown-node' };
  if (parent.locked) return { ok: false, reason: 'locked-parent' };

  const parentRules = rules(parent.type);
  if (!parentRules) return { ok: false, reason: 'unknown-type' };
  if (!parentRules.container) return { ok: false, reason: 'not-a-container' };

  const childType = payload.kind === 'new' ? payload.componentType : nodes[payload.nodeId]?.type;
  if (!childType) return { ok: false, reason: 'unknown-node' };

  const childRules = rules(childType);
  if (!childRules) return { ok: false, reason: 'unknown-type' };

  if (parentRules.allowChildren && !parentRules.allowChildren.includes(childType)) {
    return { ok: false, reason: 'child-rejected' };
  }
  if (childRules.allowParents && !childRules.allowParents.includes(parent.type)) {
    return { ok: false, reason: 'parent-rejected' };
  }

  if (payload.kind === 'move') {
    if (childRules.fixed) return { ok: false, reason: 'fixed-node' };
    if (payload.nodeId === parentId) return { ok: false, reason: 'into-self' };
    // Moving a node inside its own subtree would detach that subtree from the
    // document, so it is rejected before any mutation runs.
    if (isDescendant(nodes, payload.nodeId, parentId)) {
      return { ok: false, reason: 'into-descendant' };
    }
  }

  return OK;
}

/** Can this node be dragged, deleted or duplicated? */
export function canMutate(nodes: NodeMap, rules: RulesLookup, id: string): boolean {
  const node = nodes[id];
  if (!node || node.locked) return false;
  return !rules(node.type)?.fixed;
}
