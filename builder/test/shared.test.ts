/**
 * Shared sections.
 *
 * The problem this solves: building a six-page site meant six copies of the nav
 * bar, kept in step by hand. These tests pin the property that makes it worth
 * having — one copy of the markup, edited from anywhere.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import '../src/registry';
import { useEditor } from '../src/store/editor';
import {
  SHARED_TYPE,
  countSharedInstances,
  createEmptyDoc,
  sharedContaining,
  sharedList,
  walkRendered,
} from '../src/core/doc';
import { buildExport } from '../src/core/export';
import { pageEdges } from '../src/core/sitemap';
import { TEMPLATES } from '../src/registry/templates';
import { repairDoc } from '../src/core/doc';
import type { SiteDoc } from '../src/core/types';

const S = () => useEditor.getState();

function template(id: string) {
  const found = TEMPLATES.find((t) => t.id === id);
  if (!found) throw new Error(`no template ${id}`);
  return found;
}

function reset(): void {
  const doc = createEmptyDoc('Shared test');
  useEditor.setState({
    doc,
    past: [],
    future: [],
    lastCommit: null,
    currentPageId: doc.pages[0].id,
    selectedId: null,
    toasts: [],
    view: 'design',
  });
}

/** Home page with a nav bar, returning the nav section's node id. */
function withNavbar(): string {
  S().insertTemplate(template('navbar'));
  return S().selectedId as string;
}

/** The nav's brand heading, wherever it currently lives. */
function brandId(doc: SiteDoc): string {
  const found = Object.values(doc.nodes).find(
    (node) => node.type === 'heading' && node.props.text === 'BLOKZA',
  );
  if (!found) throw new Error('no brand heading');
  return found.id;
}

beforeEach(reset);

describe('making a section shared', () => {
  it('replaces the section with a reference and keeps the markup once', () => {
    const navId = withNavbar();
    const nodesBefore = Object.keys(S().doc.nodes).length;

    S().shareSection(navId);

    const doc = S().doc;
    expect(sharedList(doc)).toHaveLength(1);
    // The page now holds a reference, not the section itself.
    const first = doc.nodes[doc.pages[0].rootId].children[0];
    expect(doc.nodes[first].type).toBe(SHARED_TYPE);
    // The original tree survives, plus one node for the reference.
    expect(Object.keys(doc.nodes).length).toBe(nodesBefore + 1);
    expect(doc.nodes[navId]).toBeDefined();
    expect(doc.nodes[navId].parent).toBeNull();
  });

  it('puts it on every existing page at once', () => {
    S().addPage();
    S().addPage();
    S().selectPage(S().doc.pages[0].id);
    const navId = withNavbar();

    S().shareSection(navId);

    const doc = S().doc;
    expect(doc.pages).toHaveLength(3);
    expect(countSharedInstances(doc, sharedList(doc)[0].id)).toBe(3);
    // A header belongs at the top of each page.
    for (const page of doc.pages) {
      const first = doc.nodes[page.rootId].children[0];
      expect(doc.nodes[first].type).toBe(SHARED_TYPE);
    }
  });

  it('edits once and changes every page — the whole point', () => {
    S().addPage();
    S().selectPage(S().doc.pages[0].id);
    S().shareSection(withNavbar());

    S().setProp(brandId(S().doc), 'text', 'Meridian');

    // Rendered structure of both pages must show the new brand.
    for (const page of S().doc.pages) {
      const seen: string[] = [];
      walkRendered(S().doc, page.rootId, (node) => {
        if (typeof node.props.text === 'string') seen.push(node.props.text);
      });
      expect(seen, `page ${page.name}`).toContain('Meridian');
      expect(seen).not.toContain('BLOKZA');
    }
  });

  it('refuses to share something nested inside a section', () => {
    const navId = withNavbar();
    const containerId = S().doc.nodes[navId].children[0];
    S().shareSection(containerId);
    expect(sharedList(S().doc)).toHaveLength(0);
    expect(S().toasts.at(-1)?.kind).toBe('error');
  });

  it('does not share the same section twice', () => {
    const navId = withNavbar();
    S().shareSection(navId);
    const instanceId = S().doc.nodes[S().doc.pages[0].rootId].children[0];
    S().shareSection(instanceId);
    expect(sharedList(S().doc)).toHaveLength(1);
  });

  it('is undoable', () => {
    const navId = withNavbar();
    S().shareSection(navId);
    expect(sharedList(S().doc)).toHaveLength(1);
    S().undo();
    expect(sharedList(S().doc) ?? []).toHaveLength(0);
    expect(S().doc.nodes[navId].parent).toBe(S().doc.pages[0].rootId);
  });
});

describe('new pages', () => {
  it('arrive with the shared sections already on them', () => {
    S().shareSection(withNavbar());
    S().addPage();

    const doc = S().doc;
    const newPage = doc.pages[doc.pages.length - 1];
    const kinds = doc.nodes[newPage.rootId].children.map((id) => doc.nodes[id].type);
    expect(kinds).toEqual([SHARED_TYPE]);
  });

  it('are still blank when nothing is shared', () => {
    S().addPage();
    const doc = S().doc;
    expect(doc.nodes[doc.pages[1].rootId].children).toEqual([]);
  });
});

describe('un-sharing', () => {
  it('gives one page a private copy and leaves the others shared', () => {
    S().addPage();
    S().selectPage(S().doc.pages[0].id);
    S().shareSection(withNavbar());
    const sharedId = sharedList(S().doc)[0].id;

    S().selectPage(S().doc.pages[1].id);
    const instanceId = S().doc.nodes[S().doc.pages[1].rootId].children[0];
    S().unshareSection(instanceId);

    const doc = S().doc;
    // Page 2 has real markup again; page 1 still points at the master.
    expect(doc.nodes[doc.pages[1].rootId].children.map((id) => doc.nodes[id].type)).toEqual(['section']);
    expect(countSharedInstances(doc, sharedId)).toBe(1);
    expect(sharedList(doc)).toHaveLength(1);

    // And they are now independent.
    const copyBrand = Object.values(doc.nodes).find(
      (node) => node.type === 'heading' && node.parent && doc.nodes[node.parent] !== undefined,
    );
    expect(copyBrand).toBeDefined();
  });

  it('drops the shared entry when the last instance is inlined', () => {
    S().shareSection(withNavbar());
    const instanceId = S().doc.nodes[S().doc.pages[0].rootId].children[0];
    S().unshareSection(instanceId);
    expect(sharedList(S().doc)).toHaveLength(0);
    // No orphaned master left behind.
    expect(repairDoc(structuredCloneDoc(S().doc))).toBe(0);
  });

  it('removing a shared section clears it from every page', () => {
    S().addPage();
    S().selectPage(S().doc.pages[0].id);
    S().shareSection(withNavbar());
    const sharedId = sharedList(S().doc)[0].id;

    S().removeSharedEverywhere(sharedId);

    const doc = S().doc;
    expect(sharedList(doc)).toHaveLength(0);
    for (const page of doc.pages) expect(doc.nodes[page.rootId].children).toEqual([]);
  });
});

describe('shared sections survive the round trips', () => {
  it('repairDoc keeps the master, which is detached by design', () => {
    S().shareSection(withNavbar());
    const doc = structuredCloneDoc(S().doc);
    const fixed = repairDoc(doc);
    expect(fixed).toBe(0);
    expect(sharedList(doc)).toHaveLength(1);
    expect(doc.nodes[sharedList(doc)[0].rootId]).toBeDefined();
  });

  it('exports the shared markup into every page', () => {
    S().addPage();
    S().selectPage(S().doc.pages[0].id);
    S().shareSection(withNavbar());
    S().setProp(brandId(S().doc), 'text', 'Meridian');

    const files = buildExport(S().doc).files.filter((file) => file.path.endsWith('.html'));
    expect(files).toHaveLength(2);
    for (const file of files) {
      expect(file.content, file.path).toContain('Meridian');
      // The reference itself must never reach the output.
      expect(file.content, file.path).not.toContain('c-shared');
    }
  });

  it('counts links inside a shared nav as page links', () => {
    S().addPage();
    const other = S().doc.pages[1];
    S().updatePage(other.id, { name: 'Work', path: '/work' });
    S().selectPage(S().doc.pages[0].id);
    S().shareSection(withNavbar());

    // Point a nav link at the second page, then check the site map sees it
    // through the shared reference.
    const link = Object.values(S().doc.nodes).find((node) => node.type === 'link');
    S().setProp(link?.id as string, 'href', '/work');

    const edges = pageEdges(S().doc);
    expect(edges.some((edge) => edge.toPageId === other.id)).toBe(true);
  });
});

/** Deep copy, so repair tests cannot mutate the store's document. */
function structuredCloneDoc(doc: SiteDoc): SiteDoc {
  return JSON.parse(JSON.stringify(doc)) as SiteDoc;
}

describe('shared sections are styled', () => {
  it('emits per-node css for the master, which no page tree contains', () => {
    S().shareSection(withNavbar());
    const master = sharedList(S().doc)[0].rootId;
    const css = buildExport(S().doc).files.find((f) => f.path === 'styles.css')?.content ?? '';

    // Regression: `compileCss` walked only page trees, and a master is detached
    // from every page — so a shared nav shipped with no styles whatsoever.
    expect(css).toContain(`.n-${master}`);
    const rule = css.slice(css.indexOf(`.n-${master} {`));
    expect(rule.slice(0, 400)).toContain('display: flex');
  });

  it('emits the component css for types that only appear inside a shared section', () => {
    S().shareSection(withNavbar());
    const css = buildExport(S().doc).files.find((f) => f.path === 'styles.css')?.content ?? '';
    // The nav is the only thing using buttons on this site.
    expect(css).toContain('.c-button--primary');
  });

  it('styles every descendant of the master, not just its root', () => {
    S().shareSection(withNavbar());
    const master = sharedList(S().doc)[0].rootId;
    const containerId = S().doc.nodes[master].children[0];
    const css = buildExport(S().doc).files.find((f) => f.path === 'styles.css')?.content ?? '';
    expect(css).toContain(`.n-${containerId}`);
    expect(css.slice(css.indexOf(`.n-${containerId} {`), css.indexOf(`.n-${containerId} {`) + 300)).toContain('max-width');
  });

  it('emits a shared node once, not once per page that uses it', () => {
    S().addPage();
    S().selectPage(S().doc.pages[0].id);
    S().shareSection(withNavbar());
    const master = sharedList(S().doc)[0].rootId;
    const css = buildExport(S().doc).files.find((f) => f.path === 'styles.css')?.content ?? '';

    // Count only unindented rules: the same selector legitimately reappears
    // inside the tablet and mobile media queries.
    const baseRules = css.split('\n').filter((line) => line === `.n-${master} {`);
    expect(baseRules).toHaveLength(1);
  });
});

describe('sharing a section a user already copied onto every page', () => {
  beforeEach(reset);

  /**
   * The bug this pins: anyone building a multi-page site drops a nav bar on
   * every page first and only later wishes the copies were one. Sharing used to
   * add an instance without removing the copy, leaving two identical nav bars
   * stacked on every page but the one being shared from.
   */
  function threePagesEachWithTheirOwnNav(): void {
    withNavbar();
    for (const name of ['Work', 'About']) {
      S().addPage();
      S().updatePage(S().doc.pages[S().doc.pages.length - 1].id, { name });
      S().insertTemplate(template('navbar'));
    }
    S().selectPage(S().doc.pages[0].id);
  }

  it('replaces the copies instead of stacking a second nav bar on each page', () => {
    threePagesEachWithTheirOwnNav();
    const navId = S().doc.nodes[S().pageRootId()].children[0];

    S().shareSection(navId);

    const doc = S().doc;
    expect(sharedList(doc)).toHaveLength(1);
    for (const page of doc.pages) {
      const kids = doc.nodes[page.rootId].children.map((id) => doc.nodes[id]);
      expect(kids.filter((k) => k.type === SHARED_TYPE)).toHaveLength(1);
      // the whole point: exactly one nav bar per page, not two
      expect(kids).toHaveLength(1);
    }
  });

  it('keeps each page rendering a single header', () => {
    threePagesEachWithTheirOwnNav();
    S().shareSection(S().doc.nodes[S().pageRootId()].children[0]);

    const { files } = buildExport(S().doc);
    const pages = files.filter((f) => f.path.endsWith('.html'));
    expect(pages).toHaveLength(3);
    for (const file of pages) {
      expect(file.content.split('<header').length - 1).toBe(1);
    }
  });

  it('replaces in place, so a nav below a banner does not jump to the top', () => {
    // page two puts something above its nav, which the replacement must respect
    withNavbar();
    S().addPage();
    S().insertTemplate(template('hero-center'));
    S().insertTemplate(template('navbar'));
    const other = S().doc.pages[1];
    const navIndexBefore = S().doc.nodes[other.rootId].children.length - 1;

    S().selectPage(S().doc.pages[0].id);
    S().shareSection(S().doc.nodes[S().pageRootId()].children[0]);

    const kids = S().doc.nodes[other.rootId].children;
    expect(S().doc.nodes[kids[navIndexBefore]].type).toBe(SHARED_TYPE);
  });

  it('still adds an instance to a page that has no matching section', () => {
    withNavbar();
    S().addPage();
    S().insertTemplate(template('hero-center'));
    const bare = S().doc.pages[1];

    S().selectPage(S().doc.pages[0].id);
    S().shareSection(S().doc.nodes[S().pageRootId()].children[0]);

    const kids = S().doc.nodes[bare.rootId].children.map((id) => S().doc.nodes[id]);
    expect(kids.filter((k) => k.type === SHARED_TYPE)).toHaveLength(1);
    // the hero it already had is untouched
    expect(kids.filter((k) => k.type === 'section')).toHaveLength(1);
  });

  it('says how many copies it replaced', () => {
    threePagesEachWithTheirOwnNav();
    S().shareSection(S().doc.nodes[S().pageRootId()].children[0]);
    expect(S().toasts.at(-1)?.message).toContain('shared across 3 pages');
    expect(S().toasts.at(-1)?.message).toContain('replaced 2 copies');
  });

  it('is undoable in one step', () => {
    threePagesEachWithTheirOwnNav();
    const before = JSON.stringify(S().doc.pages.map((p) => S().doc.nodes[p.rootId].children.length));
    S().shareSection(S().doc.nodes[S().pageRootId()].children[0]);
    S().undo();
    expect(JSON.stringify(S().doc.pages.map((p) => S().doc.nodes[p.rootId].children.length))).toBe(before);
    expect(sharedList(S().doc)).toHaveLength(0);
  });
});

describe('what sharing leaves selected and says', () => {
  beforeEach(reset);

  /**
   * Selecting the instance reads as the more correct choice and breaks the
   * canvas: an instance renders its master's subtree without contributing an
   * element of its own, so it has no box to outline and the overlay and context
   * panel have nothing to attach to. The master's root is what is on screen.
   */
  it('keeps the section the user was looking at selected', () => {
    const navId = withNavbar();
    S().addPage();
    S().selectPage(S().doc.pages[0].id);
    // the path the UI takes: the section is selected, which is how the user
    // reached the "use on all pages" button in the first place
    S().select(navId);

    S().shareSection(navId);

    expect(S().selectedId).toBe(navId);
    expect(S().doc.nodes[navId].type).not.toBe(SHARED_TYPE);
    // it is the master now, reached through an instance rather than a page
    expect(S().doc.nodes[navId].parent).toBeNull();
    expect(sharedList(S().doc)[0].rootId).toBe(navId);
  });

  it('reports an edit inside a shared master as affecting every page', () => {
    const navId = withNavbar();
    S().addPage();
    S().selectPage(S().doc.pages[0].id);
    S().shareSection(navId);

    // the heading inside the nav, which is what a click on the canvas selects
    const brand = brandId(S().doc);
    expect(sharedContaining(S().doc, brand)?.rootId).toBe(navId);
    expect(countSharedInstances(S().doc, sharedList(S().doc)[0].id)).toBe(2);
    // and a node outside any master is not reported as shared
    S().selectPage(S().doc.pages[1].id);
    S().insertTemplate(template('hero-center'));
    expect(sharedContaining(S().doc, S().selectedId as string)).toBeUndefined();
  });

  it('reports adding separately from replacing', () => {
    withNavbar();
    S().addPage(); // a page with nothing on it
    S().selectPage(S().doc.pages[0].id);
    S().shareSection(S().doc.nodes[S().pageRootId()].children[0]);
    expect(S().toasts.at(-1)?.message).toContain('added to 1 page');
    expect(S().toasts.at(-1)?.message).not.toContain('replaced');
  });
});
