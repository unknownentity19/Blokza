/**
 * Inline rich text.
 *
 * Text props used to hold plain strings. They now hold a restricted inline
 * subset so bold, italic and links can be applied on the canvas, which puts a
 * sanitiser on the path of every heading and label in the document — including
 * on the way to the exported site. These tests pin that boundary.
 */

import { describe, expect, it } from 'vitest';

import { sanitizeHtml, sanitizeInline } from '../src/core/sanitize';

describe('plain values still render as themselves', () => {
  it('escapes markup characters rather than interpreting them', () => {
    expect(sanitizeInline('Tom & Jerry')).toBe('Tom &amp; Jerry');
    expect(sanitizeInline('a < b')).toBe('a &lt; b');
    expect(sanitizeInline('5 > 3')).toBe('5 &gt; 3');
  });

  it('leaves ordinary text untouched', () => {
    expect(sanitizeInline('Design the page. Ship the site.')).toBe('Design the page. Ship the site.');
  });

  it('turns the newlines older documents stored into line breaks', () => {
    // Multi-line text was represented with \n before rich text existed; HTML
    // collapses those, so they have to become real breaks.
    expect(sanitizeInline('First line\nSecond line')).toBe('First line<br />Second line');
  });

  it('is idempotent, so re-editing does not accumulate escaping', () => {
    const once = sanitizeInline('Tom & Jerry');
    expect(sanitizeInline(once)).toBe(once);
  });
});

describe('what inline markup survives', () => {
  it('keeps the emphasis and link tags the toolbar produces', () => {
    expect(sanitizeInline('Ship <b>faster</b>')).toBe('Ship <b>faster</b>');
    expect(sanitizeInline('Ship <i>safer</i>')).toBe('Ship <i>safer</i>');
    expect(sanitizeInline('<strong>bold</strong> and <em>italic</em>')).toContain('<strong>bold</strong>');
    // Serialisation of a void element is the DOM's choice, not ours.
    expect(sanitizeInline('a<br />b')).toMatch(/^a<br\s*\/?>b$/);
  });

  it('unwraps block tags, which are invalid inside a heading', () => {
    expect(sanitizeInline('<div>block</div>')).toBe('block');
    expect(sanitizeInline('before<p>para</p>after')).toBe('beforeparaafter');
    expect(sanitizeInline('<h2>nested heading</h2>')).toBe('nested heading');
  });

  it('removes scripting outright, contents included', () => {
    const out = sanitizeInline('Safe<script>steal()</script>');
    expect(out).toBe('Safe');
    expect(out).not.toContain('steal');
  });

  it('drops event handlers and style attributes', () => {
    expect(sanitizeInline('<b onclick="x()">t</b>')).toBe('<b>t</b>');
    expect(sanitizeInline('<span style="position:fixed">t</span>')).toBe('<span>t</span>');
  });
});

describe('normalising what browsers actually emit', () => {
  it('converts a styled span into a semantic tag', () => {
    // Safari's execCommand('bold') emits this. The style attribute is not on the
    // allowlist, so without conversion the formatting would silently vanish.
    expect(sanitizeInline('<span style="font-weight: bold">t</span>')).toBe('<b>t</b>');
    expect(sanitizeInline('<span style="font-weight: 700">t</span>')).toBe('<b>t</b>');
    expect(sanitizeInline('<span style="font-style: italic">t</span>')).toBe('<i>t</i>');
  });

  it('nests when a span asks for both', () => {
    const out = sanitizeInline('<span style="font-weight:bold;font-style:italic">t</span>');
    expect(out).toBe('<b><i>t</i></b>');
  });

  it('drops a span that only removes emphasis', () => {
    // `font-weight: normal` has no semantic equivalent; the toolbar does not
    // offer the command that produces it.
    expect(sanitizeInline('<span style="font-weight: normal">t</span>')).toBe('<span>t</span>');
  });

  it('only normalises in inline mode, leaving rich text bodies alone', () => {
    expect(sanitizeHtml('<span style="font-weight:bold">t</span>')).toBe('<span>t</span>');
  });
});

describe('links authored inside text', () => {
  it('keeps a safe href', () => {
    expect(sanitizeInline('<a href="https://x.dev">x</a>')).toContain('href="https://x.dev"');
    expect(sanitizeInline('<a href="/work">x</a>')).toContain('href="/work"');
    expect(sanitizeInline('<a href="#pricing">x</a>')).toContain('href="#pricing"');
  });

  it('strips an unsafe scheme', () => {
    expect(sanitizeInline('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript');
    expect(sanitizeInline('<a href="data:text/html,<script>">x</a>')).not.toContain('data:text/html');
  });

  it('rewrites internal hrefs through the caller, for the export', () => {
    // A link inside a text value never passes through a component's resolveHref,
    // so this hook is the only thing that stops /work shipping unrewritten.
    const out = sanitizeInline('<a href="/work">w</a>', {
      resolveHref: (href) => (href === '/work' ? 'work.html' : href),
    });
    expect(out).toContain('href="work.html"');
  });

  it('does not hand an unsafe href to the resolver', () => {
    const seen: string[] = [];
    sanitizeInline('<a href="javascript:alert(1)">x</a>', {
      resolveHref: (href) => {
        seen.push(href);
        return href;
      },
    });
    expect(seen).toEqual([]);
  });

  it('hardens a new-tab link', () => {
    expect(sanitizeInline('<a href="https://x.dev" target="_blank">x</a>')).toContain('noopener');
  });
});

describe('the empty case', () => {
  it('returns nothing for an empty value', () => {
    expect(sanitizeInline('')).toBe('');
  });

  it('does not treat a zero-width space as content worth keeping', () => {
    // The canvas renders one so an empty slot stays clickable; it must not become
    // part of the stored value.
    expect(sanitizeInline('​').replace(/​/g, '')).toBe('');
  });
});
