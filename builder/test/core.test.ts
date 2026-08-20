import { describe, expect, it } from 'vitest';

import '../src/registry';
import {
  addPage,
  cloneSubtree,
  createEmptyDoc,
  duplicateNode,
  insertSubtree,
  moveNode,
  removeNode,
  removePage,
  repairDoc,
  setStyle,
} from '../src/core/doc';
import { nodeLabel, spawnComponent, spawnPreset } from '../src/core/factory';
import { ancestorsOf, canDrop, descendantsOf, indexOf, isDescendant } from '../src/core/tree';
import { dropRules } from '../src/registry/registry';
import { compileCss, effectiveStyles, isSafeValue, kebab } from '../src/core/css';
import { formatHtml } from '../src/core/format-html';
import { sanitizeHtml, safeHref } from '../src/core/sanitize';
import { migrateLegacyState } from '../src/core/migrate';
import { parseProject, serialiseProject } from '../src/core/storage';
import type { SiteDoc } from '../src/core/types';

/** Build a doc with `types` inserted under the home page root, in order. */
function docWith(...types: string[]): { doc: SiteDoc; rootId: string; ids: string[] } {
  const doc = createEmptyDoc('Test site');
  const rootId = doc.pages[0].rootId;
  const ids: string[] = [];
  for (const type of types) {
    const spawned = spawnComponent(type);
    if (!spawned) throw new Error(`no component ${type}`);
    insertSubtree(doc, spawned.nodes, spawned.rootId, rootId, doc.nodes[rootId].children.length);
    ids.push(spawned.rootId);
  }
  return { doc, rootId, ids };
}

describe('document structure', () => {
  it('inserts children in order and links both directions', () => {
    const { doc, rootId, ids } = docWith('section', 'section');
    expect(doc.nodes[rootId].children).toEqual(ids);
    expect(doc.nodes[ids[0]].parent).toBe(rootId);
  });

  it('reorders within the same parent using pre-detach indices', () => {
    const { doc, rootId, ids } = docWith('section', 'section', 'section');
    const [a, b, c] = ids;

    // Drop the first item at the indicator between b and c (index 2).
    moveNode(doc, a, rootId, 2);
    expect(doc.nodes[rootId].children).toEqual([b, a, c]);

    // Dropping at its own position is a no-op, not a duplicate or a shift.
    expect(moveNode(doc, a, rootId, 1)).toBe(false);
    expect(doc.nodes[rootId].children).toEqual([b, a, c]);
  });

  it('moves a node into a different parent', () => {
    const { doc, rootId, ids } = docWith('section', 'section');
    const heading = spawnComponent('heading');
    if (!heading) throw new Error('no heading');
    insertSubtree(doc, heading.nodes, heading.rootId, ids[0], 0);

    moveNode(doc, heading.rootId, ids[1], 0);
    expect(doc.nodes[ids[0]].children).toEqual([]);
    expect(doc.nodes[ids[1]].children).toEqual([heading.rootId]);
    expect(doc.nodes[heading.rootId].parent).toBe(ids[1]);
    expect(ancestorsOf(doc.nodes, heading.rootId)).toEqual([ids[1], rootId]);
  });

  it('refuses to move a node inside its own subtree', () => {
    const { doc } = docWith('section');
    const outer = spawnPreset({ type: 'section', children: [{ type: 'container', children: [{ type: 'stack' }] }] });
    if (!outer) throw new Error('no tree');
    const doc2 = createEmptyDoc();
    const root = doc2.pages[0].rootId;
    insertSubtree(doc2, outer.nodes, outer.rootId, root, 0);
    const container = doc2.nodes[outer.rootId].children[0];

    expect(isDescendant(doc2.nodes, outer.rootId, container)).toBe(true);
    expect(moveNode(doc2, outer.rootId, container, 0)).toBe(false);
    // Untouched: still attached to the page root.
    expect(doc2.nodes[outer.rootId].parent).toBe(root);
    expect(doc.pages).toHaveLength(1);
  });

  it('deletes a whole subtree and detaches it from its parent', () => {
    const spawned = spawnPreset({
      type: 'section',
      children: [{ type: 'container', children: [{ type: 'heading' }, { type: 'text' }] }],
    });
    if (!spawned) throw new Error('no tree');
    const doc = createEmptyDoc();
    const root = doc.pages[0].rootId;
    insertSubtree(doc, spawned.nodes, spawned.rootId, root, 0);

    expect(descendantsOf(doc.nodes, spawned.rootId)).toHaveLength(3);
    const removed = removeNode(doc, spawned.rootId);
    expect(removed).toHaveLength(4);
    expect(doc.nodes[root].children).toEqual([]);
    expect(Object.keys(doc.nodes)).toEqual([root]);
  });

  it('duplicates with fresh ids directly after the original', () => {
    const spawned = spawnPreset({ type: 'section', children: [{ type: 'heading' }] });
    if (!spawned) throw new Error('no tree');
    const doc = createEmptyDoc();
    const root = doc.pages[0].rootId;
    insertSubtree(doc, spawned.nodes, spawned.rootId, root, 0);

    const copyId = duplicateNode(doc, spawned.rootId);
    expect(copyId).toBeDefined();
    expect(indexOf(doc.nodes, copyId as string)).toBe(1);
    // No id is shared between original and copy.
    const originalIds = new Set([spawned.rootId, ...descendantsOf(doc.nodes, spawned.rootId)]);
    for (const id of [copyId as string, ...descendantsOf(doc.nodes, copyId as string)]) {
      expect(originalIds.has(id)).toBe(false);
    }
  });

  it('deep-clones props so edits do not leak between copies', () => {
    const doc = createEmptyDoc();
    const root = doc.pages[0].rootId;
    const spawned = spawnComponent('list');
    if (!spawned) throw new Error('no list');
    insertSubtree(doc, spawned.nodes, spawned.rootId, root, 0);

    const copyId = duplicateNode(doc, spawned.rootId) as string;
    const original = doc.nodes[spawned.rootId].props.items as { text: string }[];
    const copy = doc.nodes[copyId].props.items as { text: string }[];
    copy[0].text = 'changed';
    expect(original[0].text).not.toBe('changed');
  });
});

describe('pages', () => {
  it('gives new pages unique paths', () => {
    const doc = createEmptyDoc();
    const a = addPage(doc, 'About');
    const b = addPage(doc, 'About');
    expect(a.path).toBe('/about');
    expect(b.path).toBe('/about-2');
  });

  it('keeps the last page and drops the tree of a removed one', () => {
    const doc = createEmptyDoc();
    const page = addPage(doc, 'About');
    const spawned = spawnComponent('section');
    if (!spawned) throw new Error('no section');
    insertSubtree(doc, spawned.nodes, spawned.rootId, page.rootId, 0);

    expect(removePage(doc, page.id)).toBe(true);
    expect(doc.nodes[spawned.rootId]).toBeUndefined();
    expect(removePage(doc, doc.pages[0].id)).toBe(false);
  });
});

describe('drop validation', () => {
  it('rejects children a leaf cannot hold', () => {
    const { doc, ids } = docWith('divider');
    const decision = canDrop(doc.nodes, dropRules, { kind: 'new', componentType: 'heading' }, ids[0]);
    expect(decision).toEqual({ ok: false, reason: 'not-a-container' });
  });

  it('honours allowParents (a section only belongs to a page root)', () => {
    const doc = createEmptyDoc();
    const root = doc.pages[0].rootId;
    const container = spawnComponent('container');
    if (!container) throw new Error('no container');
    insertSubtree(doc, container.nodes, container.rootId, root, 0);

    expect(canDrop(doc.nodes, dropRules, { kind: 'new', componentType: 'section' }, root).ok).toBe(true);
    expect(canDrop(doc.nodes, dropRules, { kind: 'new', componentType: 'section' }, container.rootId)).toEqual({
      ok: false,
      reason: 'parent-rejected',
    });
  });

  it('refuses to move a page root, or to drop into a locked parent', () => {
    const { doc, rootId, ids } = docWith('section');
    expect(canDrop(doc.nodes, dropRules, { kind: 'move', nodeId: rootId }, ids[0])).toEqual({
      ok: false,
      reason: 'fixed-node',
    });
    doc.nodes[ids[0]].locked = true;
    expect(canDrop(doc.nodes, dropRules, { kind: 'new', componentType: 'heading' }, ids[0])).toEqual({
      ok: false,
      reason: 'locked-parent',
    });
  });
});

describe('css compilation', () => {
  it('emits base rules, hover, and media queries in cascade order', () => {
    const { doc, ids } = docWith('section');
    const id = ids[0];
    setStyle(doc, id, 'base', 'backgroundColor', '#fff');
    setStyle(doc, id, 'tablet', 'paddingTop', '40px');
    setStyle(doc, id, 'mobile', 'paddingTop', '24px');
    setStyle(doc, id, 'hover', 'backgroundColor', '#eee');

    const css = compileCss(doc);
    expect(css).toContain(`.n-${id} {`);
    expect(css).toContain('background-color: #fff;');
    expect(css).toContain('@media (max-width: 1023px)');
    expect(css).toContain('@media (max-width: 767px)');
    expect(css.indexOf('max-width: 1023px')).toBeLessThan(css.indexOf('max-width: 767px'));
    expect(css).toContain(`.n-${id}:hover {`);
  });

  it('drops values that could escape the declaration', () => {
    expect(isSafeValue('#fff')).toBe(true);
    expect(isSafeValue('url(/a.png)')).toBe(true);
    expect(isSafeValue('red} body{display:none')).toBe(false);
    expect(isSafeValue('url(javascript:alert(1))')).toBe(false);
    expect(isSafeValue('red;position:fixed')).toBe(false);

    const { doc, ids } = docWith('section');
    setStyle(doc, ids[0], 'base', 'color', 'red} body{display:none');
    expect(compileCss(doc)).not.toContain('display:none');
  });

  it('ignores properties outside the whitelist', () => {
    const { doc, ids } = docWith('section');
    // Simulates a tampered or future document.
    (doc.nodes[ids[0]].styles.base as Record<string, string>).behaviour = 'url(x.htc)';
    expect(compileCss(doc)).not.toContain('behaviour');
  });

  it('emits shared component css once', () => {
    const { doc } = docWith('button', 'submit');
    const css = compileCss(doc, { componentCss: (type) => (type === 'button' || type === 'submit' ? '.c-button { color: red; }' : undefined) });
    expect(css.match(/\.c-button \{ color: red; \}/g)).toHaveLength(1);
  });

  it('cascades effective styles down the breakpoints', () => {
    const styles = { base: { color: 'red', fontSize: '20px' }, mobile: { fontSize: '14px' } } as const;
    expect(effectiveStyles(styles, 'base')).toEqual({ color: 'red', fontSize: '20px' });
    expect(effectiveStyles(styles, 'mobile')).toEqual({ color: 'red', fontSize: '14px' });
  });

  it('converts camelCase keys', () => {
    expect(kebab('backgroundColor')).toBe('background-color');
    expect(kebab('gridTemplateColumns')).toBe('grid-template-columns');
  });
});

describe('sanitising', () => {
  it('strips scripts and event handlers but keeps the text', () => {
    const out = sanitizeHtml('<p onclick="steal()">hi <script>bad()</script><b>there</b></p>');
    expect(out).toContain('hi');
    expect(out).toContain('<b>there</b>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('onclick');
  });

  it('unwraps unknown tags instead of dropping their text', () => {
    expect(sanitizeHtml('<font size="4">keep me</font>')).toBe('keep me');
  });

  it('rejects javascript: urls', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript');
    expect(safeHref('javascript:alert(1)')).toBe('#');
    expect(safeHref('/about')).toBe('/about');
    expect(safeHref('https://x.dev')).toBe('https://x.dev');
  });

  it('keeps iframes only when embeds are allowed', () => {
    const html = '<iframe src="https://player.vimeo.com/1"></iframe>';
    expect(sanitizeHtml(html)).not.toContain('iframe');
    expect(sanitizeHtml(html, { allowEmbeds: true })).toContain('iframe');
  });

  it('hardens new-tab links', () => {
    expect(sanitizeHtml('<a href="https://x.dev" target="_blank">x</a>')).toContain('noopener');
  });
});

describe('html formatting', () => {
  it('indents block elements and leaves inline content alone', () => {
    const out = formatHtml('<div class="a"><p>Hello <b>world</b></p></div>');
    expect(out).toBe('<div class="a">\n  <p>Hello <b>world</b></p>\n</div>');
  });

  it('does not reformat the inside of a pre block', () => {
    const out = formatHtml('<div><pre>a\n  b</pre></div>');
    expect(out).toContain('a\n  b');
  });

  it('keeps an all-inline element on one line, void children included', () => {
    const out = formatHtml('<div><img src="a.png"/><br><span>x</span></div>');
    expect(out).toBe('<div><img src="a.png"/><br><span>x</span></div>');
  });

  it('indents once per level of block nesting', () => {
    const out = formatHtml('<section><div><p>a</p><p>b</p></div></section>');
    expect(out).toBe('<section>\n  <div>\n    <p>a</p>\n    <p>b</p>\n  </div>\n</section>');
  });

  it('preserves the space between text and an inline element', () => {
    expect(formatHtml('<p>Hello <b>world</b> again</p>')).toBe('<p>Hello <b>world</b> again</p>');
    expect(formatHtml('<p><b>a</b><b>b</b></p>')).toBe('<p><b>a</b><b>b</b></p>');
  });

  it('does not let unbalanced markup run away with the indentation', () => {
    const out = formatHtml('<div><section><p>a</p></div>');
    expect(out.split('\n').every((line) => line.length - line.trimStart().length <= 4)).toBe(true);
  });
});

describe('legacy migration', () => {
  it('turns old flat blocks into trees, carrying the text across', () => {
    const result = migrateLegacyState({
      name: 'My old site',
      blocks: [
        { type: 'navbar', props: { brand: 'Acme', links: 'One, Two, Three', cta: 'Go', ctaHref: '#' } },
        { type: 'hero', props: { title: 'Old title', subtitle: 'Old subtitle', primaryLabel: 'Start' } },
        { type: 'text', props: { body: 'Some copy' } },
        { type: 'somethingRemoved', props: {} },
      ],
    });

    expect(result).toBeDefined();
    expect(result?.name).toBe('My old site');
    expect(result?.trees).toHaveLength(3);
    expect(result?.skipped).toEqual(['somethingRemoved']);

    const doc = createEmptyDoc(result?.name);
    const root = doc.pages[0].rootId;
    for (const tree of result?.trees ?? []) {
      const spawned = spawnPreset(tree);
      if (spawned) insertSubtree(doc, spawned.nodes, spawned.rootId, root, doc.nodes[root].children.length);
    }
    const texts = Object.values(doc.nodes).map((n) => n.props.text);
    expect(texts).toContain('Old title');
    expect(texts).toContain('Old subtitle');
    expect(texts).toContain('Some copy');
    // The old navbar stored the brand as text and its links as a comma list.
    expect(texts).toContain('Acme');
    const labels = Object.values(doc.nodes).map((n) => n.props.label);
    expect(labels).toContain('One');
    expect(labels).toContain('Three');
    expect(labels).toContain('Go');
  });

  it('ignores state with no blocks', () => {
    expect(migrateLegacyState({ blocks: [] })).toBeUndefined();
    expect(migrateLegacyState(null)).toBeUndefined();
  });
});

describe('project files', () => {
  it('round-trips a project', () => {
    const { doc } = docWith('section', 'heading');
    const parsed = parseProject(serialiseProject(doc));
    expect('doc' in parsed).toBe(true);
    if ('doc' in parsed) expect(Object.keys(parsed.doc.nodes)).toHaveLength(Object.keys(doc.nodes).length);
  });

  it('reports a helpful error for junk', () => {
    expect(parseProject('not json')).toEqual({ error: 'That file is not valid JSON.' });
    expect(parseProject('{"a":1}')).toEqual({ error: 'That file does not look like an Altask project.' });
  });
});

describe('repair', () => {
  it('drops orphans, prunes dangling children and rebuilds parents', () => {
    const { doc, rootId, ids } = docWith('section');
    doc.nodes[rootId].children.push('does-not-exist');
    doc.nodes[ids[0]].parent = 'wrong';
    doc.nodes.orphan = { id: 'orphan', type: 'text', props: {}, styles: {}, children: [], parent: null };

    const fixed = repairDoc(doc);
    expect(fixed).toBeGreaterThan(0);
    expect(doc.nodes[rootId].children).toEqual([ids[0]]);
    expect(doc.nodes[ids[0]].parent).toBe(rootId);
    expect(doc.nodes.orphan).toBeUndefined();
  });

  it('clones a subtree without touching the original', () => {
    const spawned = spawnPreset({ type: 'section', children: [{ type: 'heading' }] });
    if (!spawned) throw new Error('no tree');
    const doc = createEmptyDoc();
    insertSubtree(doc, spawned.nodes, spawned.rootId, doc.pages[0].rootId, 0);
    const before = JSON.stringify(doc.nodes[spawned.rootId]);
    cloneSubtree(doc, spawned.rootId);
    expect(JSON.stringify(doc.nodes[spawned.rootId])).toBe(before);
  });
});

describe('node labels for a real site', () => {
  it('names a section by its semantic tag, not "Section"', () => {
    const doc = createEmptyDoc('Labels');
    const spawned = spawnPreset({ type: 'section', props: { tag: 'header' } });
    if (!spawned) throw new Error('no section');
    insertSubtree(doc, spawned.nodes, spawned.rootId, doc.pages[0].rootId, 0);
    expect(nodeLabel(doc, doc.nodes[spawned.rootId])).toBe('Header');
  });

  it('falls back to the first heading inside it', () => {
    const doc = createEmptyDoc('Labels');
    const spawned = spawnPreset({
      type: 'section',
      children: [
        { type: 'container', children: [{ type: 'heading', props: { text: 'Why teams switch' } }] },
      ],
    });
    if (!spawned) throw new Error('no section');
    insertSubtree(doc, spawned.nodes, spawned.rootId, doc.pages[0].rootId, 0);
    // Without this a page of sections is a list of identical rows in Layers.
    expect(nodeLabel(doc, doc.nodes[spawned.rootId])).toBe('Why teams switch');
  });

  it('prefers a name the user set', () => {
    const doc = createEmptyDoc('Labels');
    const spawned = spawnPreset({ type: 'section', props: { tag: 'header' } });
    if (!spawned) throw new Error('no section');
    insertSubtree(doc, spawned.nodes, spawned.rootId, doc.pages[0].rootId, 0);
    doc.nodes[spawned.rootId].name = 'Top bar';
    expect(nodeLabel(doc, doc.nodes[spawned.rootId])).toBe('Top bar');
  });

  it('still labels content elements by their own text', () => {
    const doc = createEmptyDoc('Labels');
    const spawned = spawnPreset({ type: 'section', children: [{ type: 'heading', props: { text: 'Pricing' } }] });
    if (!spawned) throw new Error('no section');
    insertSubtree(doc, spawned.nodes, spawned.rootId, doc.pages[0].rootId, 0);
    const headingId = doc.nodes[spawned.rootId].children[0];
    expect(nodeLabel(doc, doc.nodes[headingId])).toBe('Pricing');
  });

  it('truncates a long label rather than breaking the panel layout', () => {
    const doc = createEmptyDoc('Labels');
    const long = 'A heading long enough that it would otherwise overflow the layers panel entirely';
    const spawned = spawnPreset({ type: 'heading', props: { text: long } });
    if (!spawned) throw new Error('no heading');
    insertSubtree(doc, spawned.nodes, spawned.rootId, doc.pages[0].rootId, 0);
    const label = nodeLabel(doc, doc.nodes[spawned.rootId]);
    expect(label.length).toBeLessThanOrEqual(35);
    expect(label.endsWith('…')).toBe(true);
  });
});

describe('labels do not repeat down the tree', () => {
  it('names only the top-level section after its heading', () => {
    const doc = createEmptyDoc('Labels');
    const spawned = spawnPreset({
      type: 'section',
      children: [
        {
          type: 'container',
          children: [{ type: 'row', children: [{ type: 'heading', props: { text: 'Our work' } }] }],
        },
      ],
    });
    if (!spawned) throw new Error('no section');
    insertSubtree(doc, spawned.nodes, spawned.rootId, doc.pages[0].rootId, 0);

    const sectionId = spawned.rootId;
    const containerId = doc.nodes[sectionId].children[0];
    const rowId = doc.nodes[containerId].children[0];

    expect(nodeLabel(doc, doc.nodes[sectionId])).toBe('Our work');
    // Inner boxes describe their role; repeating the heading hid the nesting.
    expect(nodeLabel(doc, doc.nodes[containerId])).toBe('Container');
    expect(nodeLabel(doc, doc.nodes[rowId])).toBe('Row');
  });

  it('names the page root after the page', () => {
    const doc = createEmptyDoc('Labels');
    doc.pages[0].name = 'Home';
    expect(nodeLabel(doc, doc.nodes[doc.pages[0].rootId])).toBe('Home');
  });
});
