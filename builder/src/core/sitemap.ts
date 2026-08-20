/**
 * Derives the site map: which pages link to which.
 *
 * The graph is *computed*, never stored. Links live on the elements that carry
 * them, so anything else would be a second copy of the truth that drifts the
 * moment someone edits an href in the inspector. The cost is a walk over the
 * node map, which is trivial at document scale.
 */

import { walkRendered } from './doc';
import type { Page, SiteDoc } from './types';

export interface PageEdge {
  fromPageId: string;
  toPageId: string;
  /** Node ids carrying this connection, so the UI can select or remove them. */
  nodeIds: string[];
  /** Link text, for the edge label. Falls back to the target page's name. */
  label: string;
}

/** Props that can hold a link. Kept in one place so the graph and the export agree. */
const HREF_KEYS = ['href', 'url'];

function hrefOf(props: Record<string, unknown>): string | undefined {
  for (const key of HREF_KEYS) {
    const value = props[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function labelOf(props: Record<string, unknown>): string | undefined {
  for (const key of ['label', 'text']) {
    const value = props[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * One edge per (source page → target page) pair, merging the several links that
 * usually point at the same place (a nav item and a footer item, say).
 */
export function pageEdges(doc: SiteDoc): PageEdge[] {
  const byPath = new Map<string, Page>(doc.pages.map((page) => [page.path, page]));
  const merged = new Map<string, PageEdge>();

  for (const page of doc.pages) {
    // `walkRendered`, not `walk`: the nav is usually a shared section, and a
    // plain tree walk stops at the reference and finds none of its links.
    walkRendered(doc, page.rootId, (node) => {
      const href = hrefOf(node.props);
      if (!href) return;
      const target = byPath.get(href);
      // Self-links are real markup but a self-loop tells the user nothing.
      if (!target || target.id === page.id) return;

      const key = `${page.id}->${target.id}`;
      const existing = merged.get(key);
      if (existing) {
        existing.nodeIds.push(node.id);
        return;
      }
      merged.set(key, {
        fromPageId: page.id,
        toPageId: target.id,
        nodeIds: [node.id],
        label: labelOf(node.props) ?? target.name,
      });
    });
  }

  return [...merged.values()];
}

/** Pages nothing links to. Reachable only by typing the URL. */
export function orphanPages(doc: SiteDoc): string[] {
  const linked = new Set(pageEdges(doc).map((edge) => edge.toPageId));
  const home = doc.pages[0]?.id;
  return doc.pages.filter((page) => page.id !== home && !linked.has(page.id)).map((page) => page.id);
}

/**
 * The row inside a page's nav bar, if it has one — where a new nav link belongs.
 *
 * Identified structurally (a `row` inside a section whose tag is `header`) rather
 * than by a marker prop, because the nav is assembled from ordinary primitives
 * and the user is free to rebuild it by hand.
 */
export function navRowOf(doc: SiteDoc, pageId: string): string | undefined {
  const page = doc.pages.find((candidate) => candidate.id === pageId);
  if (!page) return undefined;

  let headerId: string | undefined;
  walkRendered(doc, page.rootId, (node) => {
    if (headerId) return;
    if (node.type === 'section' && node.props.tag === 'header') headerId = node.id;
  });
  if (!headerId) return undefined;

  // Prefer the deepest row that already holds links — that is the link list,
  // not the outer row that also holds the logo and the call to action.
  let best: string | undefined;
  let bestLinks = 0;
  walkRendered(doc, headerId, (node) => {
    if (node.type !== 'row') return;
    const links = node.children.filter((id) => doc.nodes[id]?.type === 'link').length;
    if (links > bestLinks) {
      bestLinks = links;
      best = node.id;
    }
    if (!best) best = node.id;
  });
  return best;
}
