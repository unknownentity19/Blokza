/**
 * Allowlist HTML sanitiser for the two places the builder accepts markup:
 * the rich-text field and the embed component.
 *
 * User content is authored by the site owner, not by a visitor, but it is still
 * sanitised: the same string is rendered inside the editor (where a script tag
 * would run against the editor's own origin and localStorage) and shipped to
 * the exported site. Parsing happens in a detached document so nothing
 * executes, loads, or fires while we inspect it.
 */

const INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'br', 'code', 'del', 'em', 'i', 'ins', 'kbd', 'mark', 'q',
  's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var',
]);

const BLOCK_TAGS = new Set([
  'blockquote', 'div', 'dd', 'dl', 'dt', 'figcaption', 'figure', 'h1', 'h2',
  'h3', 'h4', 'h5', 'h6', 'hr', 'li', 'ol', 'p', 'pre', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'tr', 'ul',
]);

const EMBED_TAGS = new Set(['iframe', 'video', 'audio', 'source', 'track', 'picture', 'img']);

const GLOBAL_ATTRS = new Set(['class', 'id', 'title', 'dir', 'lang', 'role']);

const ATTRS_BY_TAG: Record<string, Set<string>> = {
  a: new Set(['href', 'target', 'rel', 'download']),
  time: new Set(['datetime']),
  img: new Set(['src', 'alt', 'width', 'height', 'loading', 'decoding', 'srcset', 'sizes']),
  iframe: new Set(['src', 'width', 'height', 'allow', 'allowfullscreen', 'loading', 'referrerpolicy']),
  video: new Set(['src', 'poster', 'width', 'height', 'controls', 'autoplay', 'loop', 'muted', 'playsinline', 'preload']),
  audio: new Set(['src', 'controls', 'autoplay', 'loop', 'muted', 'preload']),
  source: new Set(['src', 'srcset', 'type', 'media']),
  track: new Set(['src', 'kind', 'srclang', 'label', 'default']),
  ol: new Set(['start', 'reversed', 'type']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan', 'scope']),
};

/** Schemes allowed in any url-bearing attribute. */
const SAFE_URL = /^(?:https?:|mailto:|tel:|\/|\.\/|\.\.\/|#|data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,)/i;

export interface SanitizeOptions {
  /** Allow iframe/video/audio/img. On for the embed component, off for rich text. */
  allowEmbeds?: boolean;
}

function isUrlAttr(name: string): boolean {
  return name === 'href' || name === 'src' || name === 'srcset' || name === 'poster';
}

function allowedTag(tag: string, allowEmbeds: boolean): boolean {
  if (INLINE_TAGS.has(tag) || BLOCK_TAGS.has(tag)) return true;
  return allowEmbeds && EMBED_TAGS.has(tag);
}

/**
 * Returns markup containing only allowlisted tags and attributes.
 *
 * Disallowed *elements* are unwrapped rather than dropped so that text survives
 * a paste from Word or Google Docs — losing a `<font>` wrapper is fine, losing
 * the sentence inside it is not. `script`, `style`, and friends are removed
 * outright, contents included.
 */
export function sanitizeHtml(input: string, options: SanitizeOptions = {}): string {
  if (!input) return '';
  if (typeof DOMParser === 'undefined') {
    // Server/test environment without a DOM: fall back to escaping everything.
    return escapeHtml(input);
  }
  const allowEmbeds = options.allowEmbeds === true;
  const doc = new DOMParser().parseFromString(`<body>${input}</body>`, 'text/html');
  const body = doc.body;

  for (const el of Array.from(body.querySelectorAll('script, style, template, noscript, object, embed, link, meta, base, form, input, button, select, textarea'))) {
    el.remove();
  }

  // Depth-first over a static list so unwrapping does not disturb the walk.
  const elements = Array.from(body.querySelectorAll('*'));
  for (const el of elements) {
    if (!el.isConnected) continue;
    const tag = el.tagName.toLowerCase();

    if (!allowedTag(tag, allowEmbeds)) {
      unwrap(el);
      continue;
    }

    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const permitted =
        GLOBAL_ATTRS.has(name) || ATTRS_BY_TAG[tag]?.has(name) === true;
      if (!permitted || name.startsWith('on')) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (isUrlAttr(name) && !SAFE_URL.test(attr.value.trim())) {
        el.removeAttribute(attr.name);
      }
    }

    // Anything that opens a new context gets hardened against tab-nabbing.
    if (tag === 'a' && el.getAttribute('target') === '_blank') {
      el.setAttribute('rel', 'noopener noreferrer');
    }
    if (tag === 'iframe') {
      el.setAttribute('loading', 'lazy');
      el.setAttribute('referrerpolicy', 'no-referrer');
    }
  }

  return body.innerHTML;
}

/** Plain text from markup — used for layer names and meta descriptions. */
export function htmlToText(input: string): string {
  if (!input) return '';
  if (typeof DOMParser === 'undefined') return input.replace(/<[^>]*>/g, ' ').trim();
  const doc = new DOMParser().parseFromString(`<body>${input}</body>`, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only http(s), mail, tel, fragments and site-relative paths survive. */
export function safeHref(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '#';
  if (!SAFE_URL.test(raw)) return '#';
  return raw;
}

function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) {
    el.remove();
    return;
  }
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}
