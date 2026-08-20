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
    (node) => node.type === 'heading' && node.props.text === 'Altask',
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
      expect(seen).not.toContain('Altask');
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
