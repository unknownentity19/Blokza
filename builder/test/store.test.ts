import { beforeEach, describe, expect, it } from 'vitest';

import '../src/registry';
import { useEditor } from '../src/store/editor';
import { anchorsOnPage, createEmptyDoc, insertSubtree } from '../src/core/doc';
import { spawnComponent, spawnTemplate } from '../src/core/factory';
import { indexOf } from '../src/core/tree';
import { TEMPLATES } from '../src/registry/templates';
import type { SBNode } from '../src/core/types';

const S = () => useEditor.getState();

/** Fresh document, empty history, nothing selected. */
function reset(): string {
  const doc = createEmptyDoc('Test');
  useEditor.setState({
    doc,
    past: [],
    future: [],
    lastCommit: null,
    currentPageId: doc.pages[0].id,
    selectedId: null,
    hoverId: null,
    editing: null,
    drag: null,
    clipboard: null,
    toasts: [],
    device: 'desktop',
    styleState: null,
  });
  return doc.pages[0].rootId;
}

/** Insert a component under `parentId` without going through the store. */
function put(type: string, parentId: string, index = -1): string {
  const spawned = spawnComponent(type);
  if (!spawned) throw new Error(`no component ${type}`);
  const doc = S().doc;
  const at = index < 0 ? doc.nodes[parentId].children.length : index;
  // Direct structural edit, so tests can arrange state without polluting history.
  const next = { ...doc, nodes: { ...doc.nodes } };
  insertSubtree(next, spawned.nodes, spawned.rootId, parentId, at);
  useEditor.setState({ doc: next });
  return spawned.rootId;
}

function typesUnder(parentId: string): string[] {
  const doc = S().doc;
  return doc.nodes[parentId].children.map((id) => doc.nodes[id].type);
}

let rootId = '';
beforeEach(() => {
  rootId = reset();
});

describe('click-to-insert placement', () => {
  it('drops into the selection when it can hold the component', () => {
    const sectionId = put('section', rootId);
    S().select(sectionId);
    S().insertComponent('heading');
    expect(typesUnder(sectionId)).toEqual(['heading']);
  });

  it('inserts after the selection when the selection cannot hold it', () => {
    const sectionId = put('section', rootId);
    const headingId = put('heading', sectionId);
    S().select(headingId);

    // A heading is not a container, so the button becomes its next sibling.
    S().insertComponent('button');
    expect(typesUnder(sectionId)).toEqual(['heading', 'button']);
    expect(indexOf(S().doc.nodes, S().selectedId as string)).toBe(1);
  });

  it('walks up until something accepts the component', () => {
    const sectionId = put('section', rootId);
    const headingId = put('heading', sectionId);
    S().select(headingId);

    // A section only belongs to a page root, so it cannot land next to the
    // heading; it has to travel up to the page.
    S().insertComponent('section');
    expect(typesUnder(rootId)).toEqual(['section', 'section']);
  });

  it('falls back to the end of the page with nothing selected', () => {
    put('section', rootId);
    S().select(null);
    S().insertComponent('section');
    expect(typesUnder(rootId)).toEqual(['section', 'section']);
  });

  it('selects what it just inserted', () => {
    const sectionId = put('section', rootId);
    S().select(sectionId);
    S().insertComponent('heading');
    const selected = S().doc.nodes[S().selectedId as string];
    expect(selected.type).toBe('heading');
  });
});

describe('templates', () => {
  it('inserts a whole tree and selects its root', () => {
    const hero = TEMPLATES.find((t) => t.id === 'hero-split');
    if (!hero) throw new Error('no hero');
    S().insertTemplate(hero);

    const selected = S().doc.nodes[S().selectedId as string];
    expect(selected.type).toBe('section');
    // The tree is real primitives, not one opaque block.
    expect(Object.keys(S().doc.nodes).length).toBeGreaterThan(8);
  });

  it('refuses a template whose root cannot go in the target', () => {
    const hero = TEMPLATES.find((t) => t.id === 'hero-split');
    if (!hero) throw new Error('no hero');
    const sectionId = put('section', rootId);
    const containerId = put('container', sectionId);
    S().select(containerId);
    S().insertTemplateAt(hero, containerId, 0);
    expect(typesUnder(containerId)).toEqual([]);
  });
});

describe('drop validation through the store', () => {
  it('will not move a node into its own descendant', () => {
    const sectionId = put('section', rootId);
    const containerId = put('container', sectionId);
    const before = JSON.stringify(S().doc.nodes);
    S().moveTo(sectionId, containerId, 0);
    expect(JSON.stringify(S().doc.nodes)).toBe(before);
  });

  it('will not put a section inside a container', () => {
    const sectionA = put('section', rootId);
    const sectionB = put('section', rootId);
    const containerId = put('container', sectionA);
    S().moveTo(sectionB, containerId, 0);
    expect(typesUnder(containerId)).toEqual([]);
  });

  it('moves a node between parents', () => {
    const sectionA = put('section', rootId);
    const sectionB = put('section', rootId);
    const headingId = put('heading', sectionA);
    S().moveTo(headingId, sectionB, 0);
    expect(typesUnder(sectionA)).toEqual([]);
    expect(typesUnder(sectionB)).toEqual(['heading']);
  });
});

describe('delete, duplicate, copy, paste', () => {
  it('selects a sibling after deleting, so the inspector is not left blank', () => {
    const sectionId = put('section', rootId);
    const a = put('heading', sectionId);
    const b = put('text', sectionId);
    S().select(a);
    S().remove();
    expect(S().selectedId).toBe(b);
  });

  it('falls back to the parent when there is no sibling left', () => {
    const sectionId = put('section', rootId);
    const only = put('heading', sectionId);
    S().select(only);
    S().remove();
    expect(S().selectedId).toBe(sectionId);
  });

  it('refuses to delete a locked node', () => {
    const sectionId = put('section', rootId);
    useEditor.setState({
      doc: {
        ...S().doc,
        nodes: { ...S().doc.nodes, [sectionId]: { ...S().doc.nodes[sectionId], locked: true } },
      },
    });
    S().remove(sectionId);
    expect(S().doc.nodes[sectionId]).toBeDefined();
    expect(S().toasts.at(-1)?.kind).toBe('error');
  });

  it('duplicates and selects the copy', () => {
    const sectionId = put('section', rootId);
    const headingId = put('heading', sectionId);
    S().duplicate(headingId);
    expect(typesUnder(sectionId)).toEqual(['heading', 'heading']);
    expect(S().selectedId).not.toBe(headingId);
    expect(S().doc.nodes[S().selectedId as string].type).toBe('heading');
  });

  it('copies and pastes with fresh ids', () => {
    const sectionId = put('section', rootId);
    const headingId = put('heading', sectionId);
    S().setProp(headingId, 'text', 'Copied heading');
    S().copy(headingId);
    S().select(sectionId);
    S().paste();

    const kids = S().doc.nodes[sectionId].children;
    expect(kids).toHaveLength(2);
    expect(kids[0]).not.toBe(kids[1]);
    expect(S().doc.nodes[kids[1]].props.text).toBe('Copied heading');
  });

  it('reports when a paste has nowhere to go', () => {
    const sectionId = put('section', rootId);
    S().copy(sectionId);
    const containerId = put('container', sectionId);
    S().select(containerId);
    S().paste();
    // The section walks up to the page root rather than failing outright.
    expect(typesUnder(rootId)).toEqual(['section', 'section']);
  });

  it('wraps a node in a stack, keeping its position', () => {
    const sectionId = put('section', rootId);
    put('heading', sectionId);
    const textId = put('text', sectionId);
    S().wrapInContainer(textId);

    const kids = S().doc.nodes[sectionId].children;
    expect(S().doc.nodes[kids[1]].type).toBe('stack');
    expect(S().doc.nodes[kids[1]].children).toEqual([textId]);
  });
});

describe('reordering', () => {
  it('moves a node down and up within its parent', () => {
    const sectionId = put('section', rootId);
    const a = put('heading', sectionId);
    const b = put('text', sectionId);
    const c = put('button', sectionId);

    S().reorderSibling(a, 1);
    expect(S().doc.nodes[sectionId].children).toEqual([b, a, c]);

    S().reorderSibling(a, -1);
    expect(S().doc.nodes[sectionId].children).toEqual([a, b, c]);
  });

  it('does nothing at the ends', () => {
    const sectionId = put('section', rootId);
    const a = put('heading', sectionId);
    const b = put('text', sectionId);
    S().reorderSibling(a, -1);
    S().reorderSibling(b, 1);
    expect(S().doc.nodes[sectionId].children).toEqual([a, b]);
  });
});

describe('history', () => {
  it('records one entry per structural change', () => {
    const sectionId = put('section', rootId);
    S().select(sectionId);
    expect(S().past).toHaveLength(0);

    S().insertComponent('heading');
    S().insertComponent('text');
    expect(S().past).toHaveLength(2);

    S().undo();
    expect(typesUnder(sectionId)).toEqual(['heading']);
    S().undo();
    expect(typesUnder(sectionId)).toEqual([]);
    S().redo();
    expect(typesUnder(sectionId)).toEqual(['heading']);
  });

  it('coalesces a run of typing into one undo step', () => {
    const sectionId = put('section', rootId);
    const headingId = put('heading', sectionId);

    for (const value of ['H', 'He', 'Hel', 'Hell', 'Hello']) {
      S().setProp(headingId, 'text', value, true);
    }
    expect(S().past).toHaveLength(1);

    S().undo();
    expect(S().doc.nodes[headingId].props.text).not.toBe('Hello');
  });

  it('does not coalesce across different properties', () => {
    const sectionId = put('section', rootId);
    const headingId = put('heading', sectionId);
    S().setProp(headingId, 'text', 'A', true);
    S().setProp(headingId, 'level', 'h3', true);
    expect(S().past).toHaveLength(2);
  });

  it('clears the redo stack once a new change lands', () => {
    const sectionId = put('section', rootId);
    S().select(sectionId);
    S().insertComponent('heading');
    S().undo();
    expect(S().future).toHaveLength(1);
    S().insertComponent('text');
    expect(S().future).toHaveLength(0);
  });

  it('drops a selection that undo removed from the document', () => {
    const sectionId = put('section', rootId);
    S().select(sectionId);
    S().insertComponent('heading');
    const headingId = S().selectedId as string;
    S().undo();
    expect(S().doc.nodes[headingId]).toBeUndefined();
    expect(S().selectedId).toBeNull();
  });

  it('caps history growth', () => {
    const sectionId = put('section', rootId);
    S().select(sectionId);
    for (let i = 0; i < 120; i += 1) S().insertComponent('divider');
    expect(S().past.length).toBeLessThanOrEqual(100);
  });
});

describe('styles', () => {
  it('writes to the breakpoint matching the current device', () => {
    const sectionId = put('section', rootId);
    S().setDevice('mobile');
    S().setStyleValue(sectionId, 'paddingTop', '12px');
    expect(S().doc.nodes[sectionId].styles.mobile?.paddingTop).toBe('12px');
    expect(S().doc.nodes[sectionId].styles.base?.paddingTop).toBe('96px');
  });

  it('writes to the hover bag when hover is armed', () => {
    const sectionId = put('section', rootId);
    S().setStyleState('hover');
    S().setStyleValue(sectionId, 'backgroundColor', '#eee');
    expect(S().doc.nodes[sectionId].styles.hover?.backgroundColor).toBe('#eee');
    expect(S().doc.nodes[sectionId].styles.base?.backgroundColor).toBeUndefined();
  });

  it('switching device resets the hover arming, so edits do not land unexpectedly', () => {
    S().setStyleState('hover');
    S().setDevice('tablet');
    expect(S().styleState).toBeNull();
  });

  it('clearing a value removes the declaration rather than blanking it', () => {
    const sectionId = put('section', rootId);
    S().setStyleValue(sectionId, 'paddingTop', null);
    expect(S().doc.nodes[sectionId].styles.base?.paddingTop).toBeUndefined();
    expect('paddingTop' in (S().doc.nodes[sectionId].styles.base ?? {})).toBe(false);
  });
});

describe('selection', () => {
  it('selects the nearest unlocked ancestor when a locked node is clicked', () => {
    const sectionId = put('section', rootId);
    const headingId = put('heading', sectionId);
    useEditor.setState({
      doc: {
        ...S().doc,
        nodes: { ...S().doc.nodes, [headingId]: { ...S().doc.nodes[headingId], locked: true } },
      },
    });
    S().select(headingId);
    expect(S().selectedId).toBe(sectionId);
  });

  it('walks up with selectParent', () => {
    const sectionId = put('section', rootId);
    const headingId = put('heading', sectionId);
    S().select(headingId);
    S().selectParent();
    expect(S().selectedId).toBe(sectionId);
    S().selectParent();
    expect(S().selectedId).toBe(rootId);
  });
});

describe('pages', () => {
  it('adds, switches and deletes pages', () => {
    S().addPage();
    expect(S().doc.pages).toHaveLength(2);
    const second = S().doc.pages[1];
    expect(S().currentPageId).toBe(second.id);

    S().selectPage(S().doc.pages[0].id);
    expect(S().currentPageId).toBe(S().doc.pages[0].id);

    S().deletePage(second.id);
    expect(S().doc.pages).toHaveLength(1);
  });

  it('refuses to delete the only page', () => {
    S().deletePage(S().doc.pages[0].id);
    expect(S().doc.pages).toHaveLength(1);
    expect(S().toasts.at(-1)?.kind).toBe('error');
  });

  it('moves off a deleted page rather than leaving a dangling id', () => {
    S().addPage();
    const second = S().currentPageId;
    S().deletePage(second);
    expect(S().currentPageId).not.toBe(second);
    expect(S().doc.pages.some((page) => page.id === S().currentPageId)).toBe(true);
  });

  it('will not give two pages the same path', () => {
    S().addPage();
    const [home, other] = S().doc.pages;
    S().updatePage(other.id, { path: '/' });
    expect(S().doc.pages.find((page) => page.id === other.id)?.path).not.toBe(home.path);
  });

  it('normalises a typed path', () => {
    S().addPage();
    const other = S().doc.pages[1];
    S().updatePage(other.id, { path: 'About Us!' });
    expect(S().doc.pages.find((page) => page.id === other.id)?.path).toBe('/about-us');
  });

  it('duplicates a page with its own copy of the tree', () => {
    const sectionId = put('section', rootId);
    const pageId = S().currentPageId;
    S().duplicatePage(pageId);
    expect(S().doc.pages).toHaveLength(2);

    const copy = S().doc.pages[1];
    const copiedIds: string[] = [];
    const walk = (id: string) => {
      copiedIds.push(id);
      for (const child of S().doc.nodes[id].children) walk(child);
    };
    walk(copy.rootId);
    expect(copiedIds).not.toContain(sectionId);
    expect(copiedIds).toHaveLength(2);
  });
});

describe('theme', () => {
  it('edits tokens and keeps them on the document', () => {
    S().setThemeColor(0, { value: '#ff0000' });
    expect(S().doc.theme.colors[0].value).toBe('#ff0000');

    S().addThemeColor();
    const count = S().doc.theme.colors.length;
    S().removeThemeColor(count - 1);
    expect(S().doc.theme.colors).toHaveLength(count - 1);
  });

  it('theme edits are undoable', () => {
    const before = S().doc.theme.colors[0].value;
    S().setThemeColor(0, { value: '#123456' });
    S().undo();
    expect(S().doc.theme.colors[0].value).toBe(before);
  });
});

describe('spawned nodes', () => {
  it('gives every node its component defaults', () => {
    const sectionId = put('section', rootId);
    const node: SBNode = S().doc.nodes[sectionId];
    expect(node.props.tag).toBe('section');
    expect(node.styles.base?.paddingTop).toBe('96px');
    expect(node.styles.mobile?.paddingTop).toBe('56px');
  });

  it('template overrides win over component defaults', () => {
    const hero = TEMPLATES.find((t) => t.id === 'hero-split');
    if (!hero) throw new Error('no hero');
    const spawned = spawnTemplate(hero);
    if (!spawned) throw new Error('no spawn');
    const root = spawned.nodes[0];
    expect(root.styles.base?.paddingTop).toBe('110px');
    // and the untouched breakpoints still come from the component
    expect(root.styles.mobile?.paddingTop).toBe('56px');
  });
});

describe('time travel leaves no dangling references', () => {
  it('moves off a page that undo removed', () => {
    S().addPage();
    const added = S().currentPageId;
    expect(S().doc.pages).toHaveLength(2);

    S().undo();
    expect(S().doc.pages).toHaveLength(1);
    // The open page no longer exists; the canvas must not point at it.
    expect(S().currentPageId).not.toBe(added);
    expect(S().doc.pages.some((page) => page.id === S().currentPageId)).toBe(true);
  });

  it('restores the page and keeps it selectable on redo', () => {
    S().addPage();
    const added = S().currentPageId;
    S().undo();
    S().redo();
    expect(S().doc.pages.some((page) => page.id === added)).toBe(true);
    S().selectPage(added);
    expect(S().currentPageId).toBe(added);
  });

  it('clears an inline edit whose node undo removed', () => {
    const sectionId = put('section', rootId);
    S().select(sectionId);
    S().insertComponent('heading');
    const headingId = S().selectedId as string;
    S().beginEdit(headingId, 'text');
    expect(S().editing).not.toBeNull();

    S().undo();
    expect(S().editing).toBeNull();
    expect(S().selectedId).toBeNull();
  });
});

describe('toasts', () => {
  it('caps the stack so a burst of actions cannot cover the canvas', () => {
    for (let i = 0; i < 8; i += 1) S().toast(`Message ${i}`);
    expect(S().toasts).toHaveLength(3);
    // The newest survive.
    expect(S().toasts.map((t) => t.message)).toEqual(['Message 5', 'Message 6', 'Message 7']);
  });
});

describe('anchors for in-page links', () => {
  it('slugifies whatever the user types, since it becomes an id and an href', () => {
    const sectionId = put('section', rootId);
    S().setAnchor(sectionId, '  Our Pricing!! ');
    expect(S().doc.nodes[sectionId].anchorId).toBe('our-pricing');
  });

  it('refuses an id already in use and says so', () => {
    const a = put('section', rootId);
    const b = put('section', rootId);
    S().setAnchor(a, 'pricing');
    S().setAnchor(b, 'pricing');

    expect(S().doc.nodes[b].anchorId).toBeUndefined();
    expect(S().toasts.at(-1)?.kind).toBe('error');
    expect(S().toasts.at(-1)?.message).toContain('#pricing');
  });

  it('lets the same element keep its own id', () => {
    const sectionId = put('section', rootId);
    S().setAnchor(sectionId, 'pricing');
    S().setAnchor(sectionId, 'pricing');
    expect(S().doc.nodes[sectionId].anchorId).toBe('pricing');
  });

  it('clears the id on an empty value', () => {
    const sectionId = put('section', rootId);
    S().setAnchor(sectionId, 'pricing');
    S().setAnchor(sectionId, '');
    expect(S().doc.nodes[sectionId].anchorId).toBeUndefined();
  });

  it('lists the anchors on a page for the link picker', () => {
    const a = put('section', rootId);
    const b = put('section', rootId);
    S().setAnchor(a, 'work');
    S().setAnchor(b, 'contact');
    const found = anchorsOnPage(S().doc, S().currentPageId).map((entry) => entry.anchorId);
    expect(found).toEqual(['work', 'contact']);
  });

  it('does not list anchors from a different page', () => {
    const onHome = put('section', rootId);
    S().setAnchor(onHome, 'work');
    S().addPage();
    expect(anchorsOnPage(S().doc, S().currentPageId)).toEqual([]);
  });
});
