/**
 * Structural mutations on a `SiteDoc`.
 *
 * Every function takes the document as its first argument and mutates it in
 * place. That is deliberate: the store runs them inside an Immer draft, so
 * "mutating" produces a new immutable document with structural sharing, which
 * is what makes snapshot-based undo cheap.
 *
 * These helpers know nothing about the component registry — see `core/factory.ts`
 * for anything that needs component defaults.
 */

import { uid, slugify, uniqueSlug } from './ids';
import { descendantsOf, indexOf, isDescendant, subtreeOf } from './tree';
import {
  DOC_VERSION,
  type Breakpoint,
  type Page,
  type SBNode,
  type SharedSection,
  type SiteDoc,
  type StyleBag,
  type StyleKey,
  type StyleState,
  type Theme,
} from './types';

export const PAGE_ROOT_TYPE = 'page-root';
/** Node type that stands in for a shared section on a page. */
export const SHARED_TYPE = 'shared';

/** Where a style edit lands: a breakpoint bag or a state bag. */
export type StyleLayer = Breakpoint | StyleState;

export function defaultTheme(): Theme {
  return {
    colors: [
      { name: 'brand', value: '#7a5fe5' },
      { name: 'brand-dark', value: '#4f30c2' },
      { name: 'brand-soft', value: '#f4f1ff' },
      // Text drawn on top of `brand`. A separate token because a light brand
      // colour needs dark text, and hardcoding white made those unreadable.
      { name: 'brand-ink', value: '#ffffff' },
      { name: 'ink', value: '#181024' },
      { name: 'muted', value: '#5b5470' },
      { name: 'line', value: '#e1e5ed' },
      { name: 'surface', value: '#ffffff' },
      { name: 'canvas', value: '#f8f9fb' },
    ],
    fonts: {
      heading: '"Fraunces", Georgia, serif',
      body: '"Inter", system-ui, -apple-system, sans-serif',
      mono: 'ui-monospace, "JetBrains Mono", Menlo, monospace',
    },
    radius: '6px',
    maxWidth: '1180px',
  };
}

export function createPageRoot(): SBNode {
  return {
    id: uid(),
    type: PAGE_ROOT_TYPE,
    props: {},
    styles: {},
    children: [],
    parent: null,
  };
}

/** A document with a single empty home page. */
export function createEmptyDoc(name = 'Untitled site'): SiteDoc {
  const root = createPageRoot();
  const now = Date.now();
  return {
    version: DOC_VERSION,
    id: uid(10),
    name,
    siteUrl: `https://${slugify(name, 'site')}.altask.dev`,
    pages: [
      {
        id: uid(),
        name: 'Home',
        path: '/',
        // Left empty on purpose: an explicit title is a user decision, and a
        // copy of the name taken at creation goes stale the moment either is
        // renamed. `defaultPageTitle` derives the effective title instead.
        title: '',
        description: '',
        rootId: root.id,
        createdAt: now,
        updatedAt: now,
      },
    ],
    nodes: { [root.id]: root },
    theme: defaultTheme(),
    updatedAt: now,
  };
}

/**
 * The title a page ships with when the author has not written one.
 *
 * Kept here rather than in the exporter so the Pages panel can show the very
 * same string as the Title field's placeholder — the author sees what will be
 * published instead of guessing.
 */
export function defaultPageTitle(doc: SiteDoc, page: Page): string {
  const site = doc.name.trim();
  const name = page.name.trim();
  if (!site) return name;
  if (!name || page.path === '/') return site;
  return `${name} — ${site}`;
}

/**
 * Pre-order list of node types in a subtree, ignoring ids, props and styles.
 *
 * Two sections spawned from the same template share a signature even after
 * their text has been edited, which is what lets sharing recognise the copies
 * of a nav bar a user has already put on every page.
 */
export function structureSignature(doc: SiteDoc, rootId: string): string {
  const parts: string[] = [];
  const walk = (id: string): void => {
    const node = doc.nodes[id];
    if (!node) return;
    parts.push(node.type);
    for (const child of node.children) walk(child);
  };
  walk(rootId);
  return parts.join('>');
}

export function findPage(doc: SiteDoc, pageId: string): Page | undefined {
  return doc.pages.find((p) => p.id === pageId);
}

export function pageOfNode(doc: SiteDoc, nodeId: string): Page | undefined {
  const seen = new Set<string>();
  let cursor: string | null = nodeId;
  while (cursor && doc.nodes[cursor] && !seen.has(cursor)) {
    seen.add(cursor);
    const parent: string | null = doc.nodes[cursor].parent;
    if (parent === null) {
      const id = cursor;
      return doc.pages.find((p) => p.rootId === id);
    }
    cursor = parent;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */

export function normalisePath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed || trimmed === '/') return '/';
  const slug = slugify(trimmed.replace(/^\/+/, ''), 'page');
  return `/${slug}`;
}

export function addPage(doc: SiteDoc, name = 'New page', path?: string): Page {
  const root = createPageRoot();
  doc.nodes[root.id] = root;
  const taken = doc.pages.map((p) => p.path.replace(/^\//, ''));
  const wanted = slugify(path ? path.replace(/^\//, '') : name, 'page');
  const now = Date.now();
  const page: Page = {
    id: uid(),
    name,
    path: `/${uniqueSlug(wanted, taken)}`,
    // See `createEmptyDoc` — derived, not copied.
    title: '',
    description: '',
    rootId: root.id,
    createdAt: now,
    updatedAt: now,
  };
  doc.pages.push(page);
  return page;
}

/** Removes a page and its whole node tree. The last remaining page is kept. */
export function removePage(doc: SiteDoc, pageId: string): boolean {
  if (doc.pages.length <= 1) return false;
  const index = doc.pages.findIndex((p) => p.id === pageId);
  if (index < 0) return false;
  const [page] = doc.pages.splice(index, 1);
  for (const id of subtreeOf(doc.nodes, page.rootId)) delete doc.nodes[id];
  return true;
}

export function duplicatePage(doc: SiteDoc, pageId: string): Page | undefined {
  const source = findPage(doc, pageId);
  if (!source) return undefined;
  const clone = cloneSubtree(doc, source.rootId);
  if (!clone) return undefined;

  // `cloneSubtree` returns detached nodes; a duplicated page has no parent to
  // attach to, so they are registered here and the new root is made a page root.
  for (const node of clone.nodes) doc.nodes[node.id] = node;
  doc.nodes[clone.rootId].parent = null;

  const taken = doc.pages.map((p) => p.path.replace(/^\//, ''));
  const now = Date.now();
  const page: Page = {
    ...source,
    id: uid(),
    name: `${source.name} copy`,
    path: `/${uniqueSlug(slugify(`${source.name}-copy`, 'page'), taken)}`,
    rootId: clone.rootId,
    createdAt: now,
    updatedAt: now,
  };
  doc.pages.push(page);
  return page;
}

/** Reorder pages. Out-of-range indices are clamped rather than throwing. */
export function movePage(doc: SiteDoc, pageId: string, toIndex: number): void {
  const from = doc.pages.findIndex((p) => p.id === pageId);
  if (from < 0) return;
  const [page] = doc.pages.splice(from, 1);
  doc.pages.splice(Math.max(0, Math.min(toIndex, doc.pages.length)), 0, page);
}

/* ------------------------------------------------------------------ */
/* Node structure                                                      */
/* ------------------------------------------------------------------ */

/**
 * Add a detached subtree to the document and link it under `parentId`.
 * `nodes` must contain `rootId` and be internally consistent (as produced by
 * `factory.spawn` or `cloneSubtree`).
 */
export function insertSubtree(
  doc: SiteDoc,
  nodes: SBNode[],
  rootId: string,
  parentId: string,
  index: number,
): boolean {
  const parent = doc.nodes[parentId];
  if (!parent) return false;
  for (const node of nodes) doc.nodes[node.id] = node;
  doc.nodes[rootId].parent = parentId;
  parent.children.splice(clampIndex(index, parent.children.length), 0, rootId);
  return true;
}

/**
 * Move an existing node to a new parent and index.
 *
 * `index` is interpreted against the child list *before* the node is detached,
 * which is what a drop indicator shows the user. The correction for same-parent
 * moves happens here so no caller has to remember it.
 */
export function moveNode(doc: SiteDoc, nodeId: string, parentId: string, index: number): boolean {
  const node = doc.nodes[nodeId];
  const parent = doc.nodes[parentId];
  if (!node || !parent) return false;
  if (nodeId === parentId || isDescendant(doc.nodes, nodeId, parentId)) return false;

  const sameParent = node.parent === parentId;
  const currentIndex = indexOf(doc.nodes, nodeId);
  let target = clampIndex(index, parent.children.length + (sameParent ? 0 : 1));

  if (sameParent) {
    if (currentIndex >= 0 && target > currentIndex) target -= 1;
    if (target === currentIndex) return false;
  }

  detach(doc, nodeId);
  node.parent = parentId;
  parent.children.splice(clampIndex(target, parent.children.length), 0, nodeId);
  return true;
}

/** Unlink a node from its parent without deleting it. */
export function detach(doc: SiteDoc, nodeId: string): void {
  const node = doc.nodes[nodeId];
  if (!node || !node.parent) return;
  const parent = doc.nodes[node.parent];
  if (!parent) return;
  const at = parent.children.indexOf(nodeId);
  if (at >= 0) parent.children.splice(at, 1);
}

/** Delete a node and its descendants. Returns the ids that were removed. */
export function removeNode(doc: SiteDoc, nodeId: string): string[] {
  const node = doc.nodes[nodeId];
  if (!node) return [];
  const ids = subtreeOf(doc.nodes, nodeId);
  detach(doc, nodeId);
  for (const id of ids) delete doc.nodes[id];
  return ids;
}

/**
 * Deep-copy a subtree with fresh ids. The copy is *detached* — `rootId`'s parent
 * is left pointing at the original parent so callers can decide where it lands.
 */
export function cloneSubtree(
  doc: SiteDoc,
  nodeId: string,
): { rootId: string; nodes: SBNode[] } | undefined {
  const source = doc.nodes[nodeId];
  if (!source) return undefined;

  const ids = [nodeId, ...descendantsOf(doc.nodes, nodeId)];
  const remap = new Map<string, string>();
  for (const id of ids) remap.set(id, uid());

  const nodes = ids.map((id) => {
    const original = doc.nodes[id];
    const copy: SBNode = {
      ...original,
      id: remap.get(id) as string,
      props: structuredCloneSafe(original.props),
      styles: structuredCloneSafe(original.styles),
      children: original.children.map((c) => remap.get(c) as string).filter(Boolean),
      parent: id === nodeId ? original.parent : (remap.get(original.parent as string) as string),
    };
    return copy;
  });

  return { rootId: remap.get(nodeId) as string, nodes };
}

/** Duplicate a node in place, directly after the original. Returns the new id. */
export function duplicateNode(doc: SiteDoc, nodeId: string): string | undefined {
  const node = doc.nodes[nodeId];
  if (!node || !node.parent) return undefined;
  const clone = cloneSubtree(doc, nodeId);
  if (!clone) return undefined;
  const at = indexOf(doc.nodes, nodeId);
  const inserted = insertSubtree(doc, clone.nodes, clone.rootId, node.parent, at + 1);
  return inserted ? clone.rootId : undefined;
}

/**
 * Wrap `nodeId` in an already-built container subtree, keeping its position.
 * Used by "wrap in container" and by templates that need to nest existing nodes.
 */
export function wrapNode(
  doc: SiteDoc,
  nodeId: string,
  wrapper: SBNode[],
  wrapperRootId: string,
): boolean {
  const node = doc.nodes[nodeId];
  if (!node || !node.parent) return false;
  const parentId = node.parent;
  const at = indexOf(doc.nodes, nodeId);
  detach(doc, nodeId);
  if (!insertSubtree(doc, wrapper, wrapperRootId, parentId, at)) return false;
  node.parent = wrapperRootId;
  doc.nodes[wrapperRootId].children.push(nodeId);
  return true;
}

/* ------------------------------------------------------------------ */
/* Shared sections                                                     */
/* ------------------------------------------------------------------ */

export function sharedList(doc: SiteDoc): SharedSection[] {
  return doc.shared ?? [];
}

export function findShared(doc: SiteDoc, sharedId: string): SharedSection | undefined {
  return sharedList(doc).find((entry) => entry.id === sharedId);
}

/** The shared section a `shared` node points at. */
export function sharedOfNode(doc: SiteDoc, nodeId: string): SharedSection | undefined {
  const node = doc.nodes[nodeId];
  if (!node || node.type !== SHARED_TYPE) return undefined;
  const sharedId = node.props.sharedId;
  return typeof sharedId === 'string' ? findShared(doc, sharedId) : undefined;
}

/**
 * The shared section a node belongs to, if any — by containment.
 *
 * `sharedOfNode` answers this for an *instance*, which is the pointer. This
 * answers it for the markup: the master's root and everything under it. The
 * canvas needs that form, because clicking a nav bar selects a heading inside
 * the master, and whether an edit is about to change every page is the single
 * most important thing to tell someone before they make it.
 */
export function sharedContaining(doc: SiteDoc, nodeId: string): SharedSection | undefined {
  const masters = sharedList(doc);
  if (!masters.length) return undefined;
  const byRoot = new Map(masters.map((entry) => [entry.rootId, entry]));
  let current: string | null | undefined = nodeId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const hit = byRoot.get(current);
    if (hit) return hit;
    current = doc.nodes[current]?.parent;
  }
  return undefined;
}

/** A placeholder node that renders a shared section. */
function makeSharedNode(sharedId: string, parent: string | null): SBNode {
  return {
    id: uid(),
    type: SHARED_TYPE,
    props: { sharedId },
    styles: {},
    children: [],
    parent,
  };
}

/**
 * Where an instance of a shared section belongs on a page.
 *
 * A header goes to the top and a footer to the bottom, because that is the only
 * placement that is ever meant — putting the nav in the middle of a page would
 * be a bug, not a choice.
 */
export function sharedInsertIndex(doc: SiteDoc, sharedId: string, pageId: string): number {
  const page = findPage(doc, pageId);
  if (!page) return 0;
  const shared = findShared(doc, sharedId);
  const tag = shared ? doc.nodes[shared.rootId]?.props.tag : undefined;
  if (tag === 'header') return 0;
  return doc.nodes[page.rootId].children.length;
}

/** Add an instance of a shared section to a page. Returns the new node's id. */
export function addSharedInstance(
  doc: SiteDoc,
  sharedId: string,
  pageId: string,
  index?: number,
): string | undefined {
  const page = findPage(doc, pageId);
  if (!page || !findShared(doc, sharedId)) return undefined;
  const at = index ?? sharedInsertIndex(doc, sharedId, pageId);
  const node = makeSharedNode(sharedId, page.rootId);
  doc.nodes[node.id] = node;
  doc.nodes[page.rootId].children.splice(clampIndex(at, doc.nodes[page.rootId].children.length), 0, node.id);
  return node.id;
}

/**
 * Turn a section already on a page into a shared one.
 *
 * The existing subtree is detached and becomes the shared master, and the page
 * gets an instance in its place — so the section the user was looking at does
 * not move or change, it just becomes the single copy everyone points at.
 */
export function makeShared(doc: SiteDoc, nodeId: string, name: string): SharedSection | undefined {
  const node = doc.nodes[nodeId];
  if (!node || !node.parent || node.type === SHARED_TYPE) return undefined;

  const parentId = node.parent;
  const at = indexOf(doc.nodes, nodeId);
  detach(doc, nodeId);
  node.parent = null;

  const shared: SharedSection = { id: uid(), name, rootId: nodeId };
  doc.shared = [...sharedList(doc), shared];

  const instance = makeSharedNode(shared.id, parentId);
  doc.nodes[instance.id] = instance;
  doc.nodes[parentId].children.splice(at, 0, instance.id);
  return shared;
}

/**
 * Replace one instance with its own private copy of the markup.
 *
 * The last instance takes ownership of the master rather than copying it, so
 * un-sharing everywhere leaves no orphaned tree behind.
 */
export function inlineShared(doc: SiteDoc, instanceId: string): string | undefined {
  const instance = doc.nodes[instanceId];
  const shared = sharedOfNode(doc, instanceId);
  if (!instance || !instance.parent || !shared) return undefined;

  const parentId = instance.parent;
  const at = indexOf(doc.nodes, instanceId);
  const others = countSharedInstances(doc, shared.id) - 1;

  let rootId: string;
  if (others === 0) {
    rootId = shared.rootId;
    doc.shared = sharedList(doc).filter((entry) => entry.id !== shared.id);
  } else {
    const clone = cloneSubtree(doc, shared.rootId);
    if (!clone) return undefined;
    for (const copied of clone.nodes) doc.nodes[copied.id] = copied;
    rootId = clone.rootId;
  }

  detach(doc, instanceId);
  delete doc.nodes[instanceId];
  doc.nodes[rootId].parent = parentId;
  doc.nodes[parentId].children.splice(clampIndex(at, doc.nodes[parentId].children.length), 0, rootId);
  return rootId;
}

export function countSharedInstances(doc: SiteDoc, sharedId: string): number {
  return Object.values(doc.nodes).filter(
    (node) => node.type === SHARED_TYPE && node.props.sharedId === sharedId,
  ).length;
}

/** Remove a shared section and every instance of it. */
export function removeShared(doc: SiteDoc, sharedId: string): void {
  const shared = findShared(doc, sharedId);
  if (!shared) return;
  for (const node of Object.values(doc.nodes)) {
    if (node.type === SHARED_TYPE && node.props.sharedId === sharedId) removeNode(doc, node.id);
  }
  for (const id of subtreeOf(doc.nodes, shared.rootId)) delete doc.nodes[id];
  doc.shared = sharedList(doc).filter((entry) => entry.id !== sharedId);
}

export function renameShared(doc: SiteDoc, sharedId: string, name: string): void {
  const shared = findShared(doc, sharedId);
  if (shared && name.trim()) shared.name = name.trim().slice(0, 80);
}

/**
 * Walk a page, following shared references into their masters.
 *
 * `tree.walk` deliberately knows nothing about shared sections; anything that
 * needs the *rendered* structure of a page — the layers tree, the site map's
 * link graph — has to come through here or it will miss everything inside a
 * shared nav.
 */
export function walkRendered(
  doc: SiteDoc,
  rootId: string,
  visit: (node: SBNode, depth: number) => void,
  depth = 0,
  seen: Set<string> = new Set(),
): void {
  const node = doc.nodes[rootId];
  if (!node || seen.has(rootId)) return;
  seen.add(rootId);
  visit(node, depth);

  if (node.type === SHARED_TYPE) {
    const shared = sharedOfNode(doc, rootId);
    if (shared) walkRendered(doc, shared.rootId, visit, depth + 1, seen);
    return;
  }
  for (const child of node.children) walkRendered(doc, child, visit, depth + 1, seen);
}

/* ------------------------------------------------------------------ */
/* Node data                                                           */
/* ------------------------------------------------------------------ */

export function setProps(doc: SiteDoc, nodeId: string, patch: Record<string, unknown>): void {
  const node = doc.nodes[nodeId];
  if (!node) return;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete node.props[key];
    else node.props[key] = value;
  }
}

/**
 * Set a nested prop by path (`items.2.text`).
 *
 * Inline editing of list items needs this: the element being edited belongs to
 * one entry of a `list` field, so the edit target is a path rather than a key.
 * Missing intermediate objects are *not* created — a path that does not resolve
 * is ignored, because inventing structure would corrupt the field's schema.
 */
export function setPropPath(doc: SiteDoc, nodeId: string, path: string, value: unknown): boolean {
  const node = doc.nodes[nodeId];
  if (!node) return false;

  const parts = path.split('.');
  if (parts.length === 1) {
    node.props[parts[0]] = value;
    return true;
  }

  let cursor: unknown = node.props;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (cursor === null || typeof cursor !== 'object') return false;
    cursor = (cursor as Record<string, unknown>)[parts[i]];
  }
  if (cursor === null || typeof cursor !== 'object') return false;
  (cursor as Record<string, unknown>)[parts[parts.length - 1]] = value;
  return true;
}

/** Write (or clear, when `value` is null/empty) one declaration on one layer. */
export function setStyle(
  doc: SiteDoc,
  nodeId: string,
  layer: StyleLayer,
  key: StyleKey,
  value: string | null,
): void {
  const node = doc.nodes[nodeId];
  if (!node) return;
  const bag = (node.styles[layer] ?? {}) as StyleBag;
  if (value === null || value === '') delete bag[key];
  else bag[key] = value;
  if (Object.keys(bag).length === 0) delete node.styles[layer];
  else node.styles[layer] = bag;
}

/** Write several declarations on one layer in a single pass. */
export function setStyles(
  doc: SiteDoc,
  nodeId: string,
  layer: StyleLayer,
  patch: Partial<Record<StyleKey, string | null>>,
): void {
  for (const [key, value] of Object.entries(patch)) {
    setStyle(doc, nodeId, layer, key as StyleKey, value ?? null);
  }
}

/** Drop every declaration a layer holds (the "reset overrides" button). */
export function clearStyleLayer(doc: SiteDoc, nodeId: string, layer: StyleLayer): void {
  const node = doc.nodes[nodeId];
  if (node) delete node.styles[layer];
}

export function renameNode(doc: SiteDoc, nodeId: string, name: string): void {
  const node = doc.nodes[nodeId];
  if (!node) return;
  const trimmed = name.trim();
  if (trimmed) node.name = trimmed.slice(0, 80);
  else delete node.name;
}

/**
 * Set the element's anchor id.
 *
 * Normalised to a slug because the value goes straight into markup as `id` and
 * into hrefs as `#id`: spaces, punctuation and duplicates would all produce
 * links that silently do nothing. An id already used elsewhere is rejected
 * rather than quietly renamed, so the user is told.
 */
export function setAnchorId(doc: SiteDoc, nodeId: string, value: string): 'ok' | 'taken' | 'cleared' {
  const node = doc.nodes[nodeId];
  if (!node) return 'cleared';

  const slug = slugify(value, '');
  if (!slug) {
    delete node.anchorId;
    return 'cleared';
  }
  const clash = Object.values(doc.nodes).some(
    (other) => other.id !== nodeId && other.anchorId === slug,
  );
  if (clash) return 'taken';

  node.anchorId = slug;
  return 'ok';
}

/** Every anchor on one page, for the link picker. */
export function anchorsOnPage(doc: SiteDoc, pageId: string): { id: string; anchorId: string }[] {
  const page = findPage(doc, pageId);
  if (!page) return [];
  const out: { id: string; anchorId: string }[] = [];
  for (const id of subtreeOf(doc.nodes, page.rootId)) {
    const anchor = doc.nodes[id]?.anchorId;
    if (anchor) out.push({ id, anchorId: anchor });
  }
  return out;
}

export function setNodeFlag(
  doc: SiteDoc,
  nodeId: string,
  flag: 'hidden' | 'locked',
  value: boolean,
): void {
  const node = doc.nodes[nodeId];
  if (!node) return;
  if (value) node[flag] = true;
  else delete node[flag];
}

/* ------------------------------------------------------------------ */
/* Integrity                                                           */
/* ------------------------------------------------------------------ */

/**
 * Repair a document loaded from storage or an import.
 *
 * Removes nodes unreachable from any page root, drops child ids that no longer
 * resolve, and rebuilds `parent` from the child lists (the child list is treated
 * as authoritative). Returns the number of problems fixed, which the caller can
 * surface as a warning.
 */
export function repairDoc(doc: SiteDoc): number {
  let fixed = 0;

  /*
   * Older versions copied a name into `title` when a page was created, so every
   * page of an existing document exports `<title>Page 4</title>` however often
   * it has been renamed since. Clearing those auto-filled values hands the page
   * back to `defaultPageTitle`; a title equal to what that would produce is
   * cleared too, because doing so cannot change the output.
   */
  for (const page of doc.pages) {
    const title = (page.title ?? '').trim();
    if (!title) continue;
    const autoFilled =
      /^Page \d+$/.test(title) ||
      title === 'New page' ||
      // the name `createEmptyDoc` uses when the author has not named the site,
      // which older versions copied onto the home page
      title === 'Untitled site' ||
      title === defaultPageTitle(doc, page);
    if (autoFilled) {
      page.title = '';
      fixed += 1;
    }
  }

  for (const page of doc.pages) {
    if (!doc.nodes[page.rootId]) {
      const root = createPageRoot();
      doc.nodes[root.id] = root;
      page.rootId = root.id;
      fixed += 1;
    }
  }

  // Child lists are authoritative: prune dangling ids and rebuild parents.
  const claimed = new Set<string>();
  for (const node of Object.values(doc.nodes)) {
    const kept = node.children.filter((id) => {
      if (!doc.nodes[id] || claimed.has(id) || id === node.id) return false;
      claimed.add(id);
      return true;
    });
    if (kept.length !== node.children.length) fixed += node.children.length - kept.length;
    node.children = kept;
    if (!Array.isArray(node.children)) node.children = [];
    if (!node.props || typeof node.props !== 'object') node.props = {};
    if (!node.styles || typeof node.styles !== 'object') node.styles = {};
  }

  const roots = new Set(doc.pages.map((p) => p.rootId));
  for (const node of Object.values(doc.nodes)) {
    if (roots.has(node.id) && node.parent !== null) {
      node.parent = null;
      fixed += 1;
    }
  }
  for (const node of Object.values(doc.nodes)) {
    for (const child of node.children) {
      if (doc.nodes[child].parent !== node.id) {
        doc.nodes[child].parent = node.id;
        fixed += 1;
      }
    }
  }

  // Anything not reachable is unreferenced: drop it. Shared masters are roots in
  // their own right — they are deliberately detached from every page, so leaving
  // them out here would delete the whole feature on the next load.
  const reachable = new Set<string>();
  for (const page of doc.pages) for (const id of subtreeOf(doc.nodes, page.rootId)) reachable.add(id);
  doc.shared = sharedList(doc).filter((entry) => doc.nodes[entry.rootId] !== undefined);
  for (const entry of sharedList(doc)) {
    doc.nodes[entry.rootId].parent = null;
    for (const id of subtreeOf(doc.nodes, entry.rootId)) reachable.add(id);
  }
  for (const id of Object.keys(doc.nodes)) {
    if (!reachable.has(id)) {
      delete doc.nodes[id];
      fixed += 1;
    }
  }

  return fixed;
}

/* ------------------------------------------------------------------ */

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return length;
  return Math.max(0, Math.min(Math.trunc(index), length));
}

/** `structuredClone` is not available in every target, and props are JSON-safe. */
function structuredCloneSafe<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
