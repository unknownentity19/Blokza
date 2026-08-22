import { beforeEach, describe, expect, it } from 'vitest';

import '../src/registry';
import { useEditor } from '../src/store/editor';
import { addPage, createEmptyDoc, insertSubtree } from '../src/core/doc';
import { spawnComponent, spawnPreset, spawnTemplate } from '../src/core/factory';
import { navRowOf, orphanPages, pageEdges } from '../src/core/sitemap';
import { TEMPLATES } from '../src/registry/templates';
import type { SiteDoc } from '../src/core/types';

const S = () => useEditor.getState();

function reset(): void {
  const doc = createEmptyDoc('Map test');
  useEditor.setState({
    doc,
    past: [],
    future: [],
    lastCommit: null,
    currentPageId: doc.pages[0].id,
    selectedId: null,
    toasts: [],
    view: 'flow',
  });
}

/** Put a link with `href` on the given page. */
function linkOn(doc: SiteDoc, pageId: string, href: string, label = 'Go'): void {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) throw new Error('no page');
  const spawned = spawnPreset({ type: 'link', props: { label, href } });
  if (!spawned) throw new Error('no link');
  insertSubtree(doc, spawned.nodes, spawned.rootId, page.rootId, doc.nodes[page.rootId].children.length);
}

beforeEach(reset);

describe('page edges', () => {
  it('finds a link from one page to another', () => {
    const doc = createEmptyDoc('S');
    const about = addPage(doc, 'About');
    linkOn(doc, doc.pages[0].id, about.path, 'About us');

    const edges = pageEdges(doc);
    expect(edges).toHaveLength(1);
    expect(edges[0].fromPageId).toBe(doc.pages[0].id);
    expect(edges[0].toPageId).toBe(about.id);
    expect(edges[0].label).toBe('About us');
  });

  it('merges several links to the same page into one edge', () => {
    const doc = createEmptyDoc('S');
    const about = addPage(doc, 'About');
    linkOn(doc, doc.pages[0].id, about.path, 'Nav');
    linkOn(doc, doc.pages[0].id, about.path, 'Footer');

    const edges = pageEdges(doc);
    expect(edges).toHaveLength(1);
    expect(edges[0].nodeIds).toHaveLength(2);
  });

  it('ignores external links and self-links', () => {
    const doc = createEmptyDoc('S');
    linkOn(doc, doc.pages[0].id, 'https://example.com');
    linkOn(doc, doc.pages[0].id, '#pricing');
    linkOn(doc, doc.pages[0].id, '/');
    expect(pageEdges(doc)).toHaveLength(0);
  });

  it('picks up button hrefs, not just links', () => {
    const doc = createEmptyDoc('S');
    const about = addPage(doc, 'About');
    const spawned = spawnPreset({ type: 'button', props: { label: 'See pricing', href: about.path } });
    if (!spawned) throw new Error('no button');
    insertSubtree(doc, spawned.nodes, spawned.rootId, doc.pages[0].rootId, 0);
    expect(pageEdges(doc)).toHaveLength(1);
  });

  it('reports pages nothing links to', () => {
    const doc = createEmptyDoc('S');
    const about = addPage(doc, 'About');
    const secret = addPage(doc, 'Secret');
    linkOn(doc, doc.pages[0].id, about.path);

    const orphans = orphanPages(doc);
    // Home is never an orphan; About is linked; Secret is not.
    expect(orphans).toEqual([secret.id]);
  });
});

describe('nav row detection', () => {
  it('finds the link row inside a nav bar template', () => {
    const doc = createEmptyDoc('S');
    const navbar = TEMPLATES.find((t) => t.id === 'navbar');
    if (!navbar) throw new Error('no navbar');
    const spawned = spawnTemplate(navbar);
    if (!spawned) throw new Error('no spawn');
    insertSubtree(doc, spawned.nodes, spawned.rootId, doc.pages[0].rootId, 0);

    const rowId = navRowOf(doc, doc.pages[0].id);
    expect(rowId).toBeDefined();
    // It should be the row that already holds the nav links.
    const row = doc.nodes[rowId as string];
    expect(row.type).toBe('row');
    expect(row.children.filter((id) => doc.nodes[id].type === 'link').length).toBeGreaterThan(1);
  });

  it('returns nothing for a page with no header section', () => {
    const doc = createEmptyDoc('S');
    const section = spawnComponent('section');
    if (!section) throw new Error('no section');
    insertSubtree(doc, section.nodes, section.rootId, doc.pages[0].rootId, 0);
    expect(navRowOf(doc, doc.pages[0].id)).toBeUndefined();
  });
});

describe('connecting pages from the site map', () => {
  it('adds a nav link into the nav bar when the page has one', () => {
    const navbar = TEMPLATES.find((t) => t.id === 'navbar');
    if (!navbar) throw new Error('no navbar');
    S().insertTemplate(navbar);
    S().addPage();
    const [home, other] = S().doc.pages;
    S().updatePage(other.id, { name: 'Docs', path: '/docs' });

    const rowBefore = navRowOf(S().doc, home.id) as string;
    const countBefore = S().doc.nodes[rowBefore].children.length;

    expect(S().connectPages(home.id, other.id)).toBe(true);

    const row = S().doc.nodes[rowBefore];
    expect(row.children.length).toBe(countBefore + 1);
    const added = S().doc.nodes[row.children[row.children.length - 1]];
    expect(added.type).toBe('link');
    expect(added.props.href).toBe('/docs');
    expect(added.props.label).toBe('Docs');
  });

  it('falls back to the page root when there is no nav bar', () => {
    S().addPage();
    const [home, other] = S().doc.pages;
    expect(S().connectPages(home.id, other.id)).toBe(true);

    const root = S().doc.nodes[home.rootId];
    expect(root.children.map((id) => S().doc.nodes[id].type)).toContain('link');
  });

  it('refuses to add a second link to the same page', () => {
    S().addPage();
    const [home, other] = S().doc.pages;
    expect(S().connectPages(home.id, other.id)).toBe(true);
    expect(S().connectPages(home.id, other.id)).toBe(false);
    expect(pageEdges(S().doc)).toHaveLength(1);
    expect(S().toasts.at(-1)?.message).toContain('already links');
  });

  it('refuses to connect a page to itself', () => {
    const home = S().doc.pages[0];
    expect(S().connectPages(home.id, home.id)).toBe(false);
  });

  it('removes every link behind an edge when disconnected', () => {
    S().addPage();
    const [home, other] = S().doc.pages;
    S().connectPages(home.id, other.id);
    // A second link to the same target, as a footer would add.
    S().commit((draft) => linkOn(draft, home.id, other.path, 'Footer'));
    expect(pageEdges(S().doc)[0].nodeIds).toHaveLength(2);

    S().disconnectPages(home.id, other.id);
    expect(pageEdges(S().doc)).toHaveLength(0);
  });

  it('is undoable', () => {
    S().addPage();
    const [home, other] = S().doc.pages;
    S().connectPages(home.id, other.id);
    expect(pageEdges(S().doc)).toHaveLength(1);
    S().undo();
    expect(pageEdges(S().doc)).toHaveLength(0);
  });
});

describe('card positions', () => {
  it('stores a dragged position on the page and coalesces the drag', () => {
    const pageId = S().doc.pages[0].id;
    S().setPagePosition(pageId, 120, 240);
    const stepsBefore = S().past.length;
    S().setPagePosition(pageId, 130, 250);
    S().setPagePosition(pageId, 140, 260);

    const page = S().doc.pages[0];
    expect({ x: page.x, y: page.y }).toEqual({ x: 140, y: 260 });
    // One undo step for the whole drag.
    expect(S().past.length).toBe(stepsBefore);
  });

  it('rounds to whole pixels', () => {
    const pageId = S().doc.pages[0].id;
    S().setPagePosition(pageId, 10.4, 20.6);
    expect({ x: S().doc.pages[0].x, y: S().doc.pages[0].y }).toEqual({ x: 10, y: 21 });
  });
});

/**
 * A shared nav bar links every page to every other page. On a seven-page site
 * that is thirty edges, and drawing each one as its own wire produced a map you
 * could not read and that said nothing: "the nav is on every page" is one fact,
 * not thirty relationships.
 *
 * So an edge records where its links live. Chrome — anything inside a shared
 * section — is site-wide navigation; a link sitting on the page itself is a
 * content link, and those are the ones worth drawing.
 */
describe('nav links versus content links', () => {
  function twoPagesWithSharedNav() {
    S().addPage();
    const other = S().doc.pages[1];
    S().updatePage(other.id, { name: 'Work', path: '/work' });
    S().selectPage(S().doc.pages[0].id);

    const navbar = TEMPLATES.find((t) => t.id === 'navbar');
    if (!navbar) throw new Error('no navbar');
    const spawned = spawnTemplate(navbar);
    if (!spawned) throw new Error('no navbar nodes');
    const home = S().doc.pages[0];
    useEditor.setState((state) => {
      const doc = structuredCloneDoc(state.doc);
      insertSubtree(doc, spawned.nodes, spawned.rootId, home.rootId, 0);
      return { doc };
    });
    const inserted = spawned.rootId;
    S().shareSection(inserted);

    const link = Object.values(S().doc.nodes).find((node) => node.type === 'link');
    S().setProp(link?.id as string, 'href', '/work');
    return other;
  }

  it('marks an edge that exists only inside a shared section as chrome', () => {
    const other = twoPagesWithSharedNav();
    const edge = pageEdges(S().doc).find((e) => e.toPageId === other.id);
    expect(edge).toBeDefined();
    expect(edge?.viaChrome).toBe(true);
  });

  it('marks a link placed on the page itself as content', () => {
    const doc = createEmptyDoc('S');
    const about = addPage(doc, 'About');
    linkOn(doc, doc.pages[0].id, about.path);
    expect(pageEdges(doc)[0].viaChrome).toBe(false);
  });

  /**
   * The case that decides the drawing. A hero button pointing at a page that is
   * also in the nav is a real content link and has to stay visible, so one node
   * on the page is enough to take the whole edge out of the chrome bucket.
   */
  it('treats an edge as content when only one of its links is on the page', () => {
    const other = twoPagesWithSharedNav();
    const home = S().doc.pages[0];
    useEditor.setState((state) => {
      const doc = structuredCloneDoc(state.doc);
      const spawned = spawnPreset({ type: 'button', props: { label: 'See work', href: '/work' } });
      if (!spawned) throw new Error('no button');
      insertSubtree(doc, spawned.nodes, spawned.rootId, home.rootId, 1);
      return { doc };
    });

    const edge = pageEdges(S().doc).find(
      (e) => e.fromPageId === home.id && e.toPageId === other.id,
    );
    expect(edge?.nodeIds.length).toBeGreaterThan(1);
    expect(edge?.viaChrome).toBe(false);
  });

  it('still counts a page reached only through the nav as linked, not orphaned', () => {
    const other = twoPagesWithSharedNav();
    expect(orphanPages(S().doc)).not.toContain(other.id);
  });
});

/** Deep copy, so a test cannot mutate the store's document in place. */
function structuredCloneDoc(doc: SiteDoc): SiteDoc {
  return JSON.parse(JSON.stringify(doc)) as SiteDoc;
}
