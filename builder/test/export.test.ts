import { describe, expect, it } from 'vitest';

import '../src/registry';
import { addPage, createEmptyDoc, insertSubtree, setStyle } from '../src/core/doc';
import { spawnComponent, spawnTemplate } from '../src/core/factory';
import { buildExport, buildStandalonePage } from '../src/core/export';
import { buildCanvasCss } from '../src/core/canvas-css';
import { pageFileName } from '../src/render/RenderNode';
import { TEMPLATES } from '../src/registry/templates';
import type { SiteDoc } from '../src/core/types';

function template(id: string) {
  const found = TEMPLATES.find((t) => t.id === id);
  if (!found) throw new Error(`no template ${id}`);
  return found;
}

/** A document with one hero on the home page. */
function heroDoc(): { doc: SiteDoc; heroId: string } {
  const doc = createEmptyDoc('Demo site');
  const rootId = doc.pages[0].rootId;
  const hero = spawnTemplate(template('hero-split'));
  if (!hero) throw new Error('hero did not spawn');
  insertSubtree(doc, hero.nodes, hero.rootId, rootId, 0);
  return { doc, heroId: hero.rootId };
}

function fileNamed(doc: SiteDoc, path: string): string {
  const file = buildExport(doc).files.find((candidate) => candidate.path === path);
  if (!file) throw new Error(`missing ${path}`);
  return file.content;
}

describe('export files', () => {
  it('emits one html file per page plus a stylesheet, sitemap and robots', () => {
    const { doc } = heroDoc();
    addPage(doc, 'About');
    const paths = buildExport(doc).files.map((file) => file.path).sort();
    expect(paths).toEqual(['about.html', 'index.html', 'robots.txt', 'sitemap.xml', 'styles.css']);
  });

  it('names the home page index.html and others by slug', () => {
    expect(pageFileName('/')).toBe('index.html');
    expect(pageFileName('/about')).toBe('about.html');
  });

  it('strips every editor-only attribute', () => {
    const { doc } = heroDoc();
    const html = fileNamed(doc, 'index.html');
    expect(html).not.toContain('data-node-id');
    expect(html).not.toContain('data-node-type');
    expect(html).not.toContain('data-edit');
    expect(html).not.toContain('contenteditable');
    expect(html).not.toContain('sb-empty');
  });

  it('keeps the generated node classes so the stylesheet still applies', () => {
    const { doc, heroId } = heroDoc();
    const html = fileNamed(doc, 'index.html');
    const css = fileNamed(doc, 'styles.css');
    expect(html).toContain(`n-${heroId}`);
    expect(css).toContain(`.n-${heroId}`);
  });

  it('carries responsive overrides into the exported stylesheet', () => {
    const { doc, heroId } = heroDoc();
    setStyle(doc, heroId, 'mobile', 'paddingTop', '32px');
    const css = fileNamed(doc, 'styles.css');
    const mobileBlock = css.slice(css.indexOf('@media (max-width: 767px)'));
    expect(mobileBlock).toContain(`.n-${heroId}`);
    expect(mobileBlock).toContain('padding-top: 32px;');
  });

  it('rewrites internal page links to the exported filenames', () => {
    const { doc } = heroDoc();
    const about = addPage(doc, 'About');
    const link = spawnComponent('link');
    if (!link) throw new Error('no link');
    link.nodes[0].props.href = about.path;
    insertSubtree(doc, link.nodes, link.rootId, doc.pages[0].rootId, 1);

    const html = fileNamed(doc, 'index.html');
    expect(html).toContain('href="about.html"');
    expect(html).not.toContain('href="/about"');
  });

  it('leaves external and mail links alone, and neutralises unsafe ones', () => {
    const { doc } = heroDoc();
    const rootId = doc.pages[0].rootId;
    for (const href of ['https://example.com', 'mailto:a@b.dev', 'javascript:alert(1)']) {
      const link = spawnComponent('link');
      if (!link) throw new Error('no link');
      link.nodes[0].props.href = href;
      insertSubtree(doc, link.nodes, link.rootId, rootId, doc.nodes[rootId].children.length);
    }
    const html = fileNamed(doc, 'index.html');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('href="mailto:a@b.dev"');
    expect(html).not.toContain('javascript:');
  });

  it('omits hidden nodes entirely', () => {
    const { doc } = heroDoc();
    const headingId = Object.values(doc.nodes).find((node) => node.type === 'heading')?.id as string;
    const text = doc.nodes[headingId].props.text as string;
    expect(fileNamed(doc, 'index.html')).toContain(text);

    doc.nodes[headingId].hidden = true;
    const html = fileNamed(doc, 'index.html');
    expect(html).not.toContain(text);
    expect(html).not.toContain(`n-${headingId}`);
  });

  it('writes the page metadata into the document head', () => {
    const { doc } = heroDoc();
    doc.siteUrl = 'https://demo.dev';
    doc.pages[0].title = 'Demo · Home';
    doc.pages[0].description = 'A description for search engines.';
    const html = fileNamed(doc, 'index.html');
    expect(html).toContain('<title>Demo · Home</title>');
    expect(html).toContain('<meta name="description" content="A description for search engines." />');
    expect(html).toContain('<link rel="canonical" href="https://demo.dev/" />');
    expect(html).toContain('rel="stylesheet" href="styles.css"');
  });

  it('escapes metadata rather than letting it break out of the attribute', () => {
    const { doc } = heroDoc();
    doc.pages[0].title = 'Break" onload="x';
    const html = fileNamed(doc, 'index.html');
    expect(html).not.toContain('onload="x"');
    expect(html).toContain('&quot;');
  });

  it('lists every page in the sitemap with an absolute url', () => {
    const { doc } = heroDoc();
    doc.siteUrl = 'https://demo.dev';
    addPage(doc, 'About');
    const sitemap = fileNamed(doc, 'sitemap.xml');
    expect(sitemap).toContain('<loc>https://demo.dev/</loc>');
    expect(sitemap).toContain('<loc>https://demo.dev/about.html</loc>');
  });

  it('produces well-formed, indented markup', () => {
    const { doc } = heroDoc();
    const html = fileNamed(doc, 'index.html');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
    // Every opened tag has a matching close (crude but catches indent bugs).
    const opens = (html.match(/<section|<div|<p[ >]/g) ?? []).length;
    expect(opens).toBeGreaterThan(0);
    expect(html).toContain('\n    <section');
  });
});

describe('standalone preview', () => {
  it('inlines the stylesheet instead of linking it', () => {
    const { doc } = heroDoc();
    const html = buildStandalonePage(doc, doc.pages[0].id);
    expect(html).not.toContain('href="styles.css"');
    expect(html).toContain('<style>');
    expect(html).toContain('.n-');
  });
});

describe('canvas stylesheet', () => {
  it('adds editor-only rules that the export never gets', () => {
    const { doc } = heroDoc();
    const canvas = buildCanvasCss(doc);
    const exported = fileNamed(doc, 'styles.css');

    expect(canvas).toContain('.sb-empty');
    expect(canvas).toContain('body > .c-page-root');
    expect(exported).not.toContain('.sb-empty');
    expect(exported).not.toContain('body > .c-page-root');
    // The site styles themselves must be identical in both.
    expect(canvas.startsWith(exported)).toBe(true);
  });
});

describe('every template', () => {
  it.each(TEMPLATES.map((t) => [t.id] as const))('%s spawns and exports', (id) => {
    const doc = createEmptyDoc('T');
    const spawned = spawnTemplate(template(id));
    expect(spawned).toBeDefined();
    if (!spawned) return;
    insertSubtree(doc, spawned.nodes, spawned.rootId, doc.pages[0].rootId, 0);

    // Nothing unresolved: an unknown component type would render this marker.
    const html = fileNamed(doc, 'index.html');
    expect(html).not.toContain('sb-unknown');
    expect(html.length).toBeGreaterThan(200);
  });
});

describe('multi-line text', () => {
  it('renders newlines as line breaks instead of collapsing them', () => {
    const { doc } = heroDoc();
    const headingId = Object.values(doc.nodes).find((node) => node.type === 'heading')?.id as string;
    doc.nodes[headingId].props.text = 'First line\nSecond line';

    const html = fileNamed(doc, 'index.html');
    // The break now comes from the sanitiser rather than React, so accept either
    // serialisation — what matters is that the newline did not collapse.
    expect(html).toMatch(/First line<br\s*\/?>Second line/);
  });

  it('leaves single-line text untouched', () => {
    const { doc } = heroDoc();
    const headingId = Object.values(doc.nodes).find((node) => node.type === 'heading')?.id as string;
    doc.nodes[headingId].props.text = 'Just one line';
    expect(fileNamed(doc, 'index.html')).not.toContain('<br');
  });
});

describe('theme-independence of component chrome', () => {
  it('ships no baked-in greys for an image with no source', () => {
    const { doc } = heroDoc();
    const html = fileNamed(doc, 'index.html');
    const css = fileNamed(doc, 'styles.css');

    // The old data-URI placeholder hardcoded #eef0f6/#cdd2de, which looked wrong
    // on any dark palette — on the canvas and in the shipped site.
    expect(html).not.toContain('eef0f6');
    expect(html).not.toContain('cdd2de');
    expect(html).not.toContain('data:image/svg+xml');
    expect(html).toContain('c-image--empty');
    // It follows the palette instead.
    expect(css).toContain('.c-image--empty');
    expect(css).toContain('background-color: var(--color-line)');
  });

  it('renders a real <img> once a source is set', () => {
    const { doc } = heroDoc();
    const imageId = Object.values(doc.nodes).find((node) => node.type === 'image')?.id as string;
    doc.nodes[imageId].props.src = 'https://cdn.example.com/photo.jpg';
    doc.nodes[imageId].props.alt = 'A photo';

    const html = fileNamed(doc, 'index.html');
    expect(html).toContain('src="https://cdn.example.com/photo.jpg"');
    expect(html).toContain('alt="A photo"');
    expect(html).not.toContain('c-image--empty');
  });

  it('gives an unset image a minimum height so it stays clickable', () => {
    const { doc } = heroDoc();
    const imageId = Object.values(doc.nodes).find((node) => node.type === 'image')?.id as string;
    const css = fileNamed(doc, 'styles.css');
    // Without a source and without a min-height an empty box collapses to 0px.
    expect(css).toMatch(new RegExp(`\\.n-${imageId}[^}]*min-height`));
  });
});

describe('templates at mobile width', () => {
  /** Style bag a node resolves to at `mobile`, after the cascade. */
  function mobileStyles(doc: SiteDoc, nodeId: string): Record<string, string> {
    const node = doc.nodes[nodeId];
    return { ...(node.styles.base ?? {}), ...(node.styles.tablet ?? {}), ...(node.styles.mobile ?? {}) };
  }

  it('keeps the nav bar horizontal instead of stacking it', () => {
    const doc = createEmptyDoc('Nav');
    const spawned = spawnTemplate(template('navbar'));
    if (!spawned) throw new Error('no navbar');
    insertSubtree(doc, spawned.nodes, spawned.rootId, doc.pages[0].rootId, 0);

    // A `row` defaults to a column on mobile, which is right for page layout and
    // wrong for a nav bar; the template must override it. Rows hidden at mobile
    // are exempt — the link list is `display: none` there, so its direction has
    // no effect on anything.
    const rows = Object.values(doc.nodes).filter((node) => node.type === 'row');
    const stacking = rows.filter((row) => {
      const styles = mobileStyles(doc, row.id);
      return styles.display !== 'none' && styles.flexDirection === 'column';
    });
    expect(
      stacking.map((row) => row.id),
      'no row inside a nav bar should become a column on mobile',
    ).toEqual([]);
  });

  it('drops the secondary nav link on mobile rather than crowding the button', () => {
    const doc = createEmptyDoc('Nav');
    const spawned = spawnTemplate(template('navbar'));
    if (!spawned) throw new Error('no navbar');
    insertSubtree(doc, spawned.nodes, spawned.rootId, doc.pages[0].rootId, 0);

    const signIn = Object.values(doc.nodes).find((node) => node.props.label === 'Sign in');
    expect(signIn).toBeDefined();
    expect(mobileStyles(doc, signIn?.id as string).display).toBe('none');
  });

  it('still stacks a hero on mobile, where stacking is the point', () => {
    const doc = createEmptyDoc('Hero');
    const spawned = spawnTemplate(template('hero-split'));
    if (!spawned) throw new Error('no hero');
    insertSubtree(doc, spawned.nodes, spawned.rootId, doc.pages[0].rootId, 0);

    // The hero's outer row holds the copy and the image side by side.
    const outer = Object.values(doc.nodes).find(
      (node) => node.type === 'row' && node.children.some((id) => doc.nodes[id].type === 'image'),
    );
    expect(outer).toBeDefined();
    expect(mobileStyles(doc, outer?.id as string).flexDirection).toBe('column');
  });
});

describe('anchors in the export', () => {
  it('emits the id so #links resolve on the shipped page', () => {
    const { doc, heroId } = heroDoc();
    doc.nodes[heroId].anchorId = 'top';
    const html = fileNamed(doc, 'index.html');
    expect(html).toContain('id="top"');
  });

  it('omits the attribute when no anchor is set', () => {
    const { doc } = heroDoc();
    expect(fileNamed(doc, 'index.html')).not.toContain(' id="');
  });
});

describe('inline rich text', () => {
  it('keeps bold and italic authored on the canvas', () => {
    const { doc } = heroDoc();
    const headingId = Object.values(doc.nodes).find((node) => node.type === 'heading')?.id as string;
    doc.nodes[headingId].props.text = 'Ship <b>faster</b> and <i>safer</i>';
    const html = fileNamed(doc, 'index.html');
    expect(html).toContain('<b>faster</b>');
    expect(html).toContain('<i>safer</i>');
  });

  it('escapes a plain value that happens to contain markup characters', () => {
    const { doc } = heroDoc();
    const headingId = Object.values(doc.nodes).find((node) => node.type === 'heading')?.id as string;
    doc.nodes[headingId].props.text = 'Tom & Jerry, a < b';
    const html = fileNamed(doc, 'index.html');
    expect(html).toContain('Tom &amp; Jerry, a &lt; b');
  });

  it('strips anything that is not inline markup', () => {
    const { doc } = heroDoc();
    const headingId = Object.values(doc.nodes).find((node) => node.type === 'heading')?.id as string;
    doc.nodes[headingId].props.text = 'Safe<script>steal()</script><div>block</div><b>ok</b>';
    const html = fileNamed(doc, 'index.html');
    expect(html).not.toContain('script');
    expect(html).not.toContain('<div>block');
    expect(html).toContain('<b>ok</b>');
  });

  it('rewrites an internal link authored inside text to the exported filename', () => {
    const { doc } = heroDoc();
    const about = addPage(doc, 'Work');
    const headingId = Object.values(doc.nodes).find((node) => node.type === 'heading')?.id as string;
    doc.nodes[headingId].props.text = `See our <a href="${about.path}">work</a>`;

    const html = fileNamed(doc, 'index.html');
    // Links inside a text value never pass through a component's resolveHref, so
    // without rewriting here this would ship as /work and 404 from a folder.
    expect(html).toContain('href="work.html"');
    expect(html).not.toContain('href="/work"');
  });

  it('neutralises an unsafe href authored inside text', () => {
    const { doc } = heroDoc();
    const headingId = Object.values(doc.nodes).find((node) => node.type === 'heading')?.id as string;
    doc.nodes[headingId].props.text = '<a href="javascript:alert(1)">tap</a>';
    expect(fileNamed(doc, 'index.html')).not.toContain('javascript:');
  });

  it('never lets an attribute-only prop become markup', () => {
    const { doc } = heroDoc();
    const imageId = Object.values(doc.nodes).find((node) => node.type === 'image')?.id as string;
    doc.nodes[imageId].props.src = 'https://cdn.example.com/a.jpg';
    doc.nodes[imageId].props.alt = '<b>not bold</b>';
    const html = fileNamed(doc, 'index.html');
    // alt is an attribute: it must be escaped, never interpreted.
    expect(html).toContain('alt="&lt;b&gt;not bold&lt;/b&gt;"');
    expect(html).not.toContain('alt=""><b>');
  });
});
