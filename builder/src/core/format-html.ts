/**
 * HTML pretty-printer for the export.
 *
 * `renderToStaticMarkup` emits one enormous line and the export promises
 * readable markup, so this re-indents it. Two rules keep it from changing what
 * the page renders:
 *
 *  1. Whitespace *inside* an inline formatting context is preserved. The space
 *     in `Hello <b>world</b>` is a real space; collapsing or moving it would
 *     change the rendered text. Only runs of whitespace are collapsed to one,
 *     which is what the browser does anyway.
 *  2. An element whose content is entirely text and inline elements stays on a
 *     single line. That is where whitespace is significant, so it is never
 *     touched — and it happens to be the more readable output too.
 *
 * Line breaks are therefore only ever introduced between block-level elements,
 * where they collapse away in every layout mode the builder can produce.
 */

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

const INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'button', 'cite', 'code', 'data', 'del',
  'dfn', 'em', 'i', 'img', 'input', 'ins', 'kbd', 'label', 'mark', 'q', 's',
  'samp', 'select', 'small', 'span', 'strong', 'sub', 'sup', 'svg', 'textarea',
  'time', 'u', 'var', 'wbr',
]);

/** Content is copied through byte for byte. */
const RAW_TAGS = new Set(['pre', 'textarea', 'script', 'style']);

const TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!--?[^>]*>|<\/([a-zA-Z][a-zA-Z0-9:-]*)\s*>|<([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;

type Token =
  | { kind: 'open'; name: string; raw: string; selfClosing: boolean }
  | { kind: 'close'; name: string; raw: string }
  | { kind: 'text'; raw: string }
  | { kind: 'other'; raw: string };

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  TOKEN.lastIndex = 0;

  while ((match = TOKEN.exec(html)) !== null) {
    if (match.index > cursor) tokens.push({ kind: 'text', raw: html.slice(cursor, match.index) });
    cursor = match.index + match[0].length;

    const closeName = match[1];
    const openName = match[2];
    if (closeName) {
      tokens.push({ kind: 'close', name: closeName.toLowerCase(), raw: match[0] });
    } else if (openName) {
      const name = openName.toLowerCase();
      tokens.push({
        kind: 'open',
        name,
        raw: match[0],
        selfClosing: match[4] === '/' || VOID_TAGS.has(name),
      });
    } else {
      tokens.push({ kind: 'other', raw: match[0] });
    }
  }

  if (cursor < html.length) tokens.push({ kind: 'text', raw: html.slice(cursor) });
  return tokens;
}

/** Index of the token closing the element opened at `start`, or -1. */
function matchingClose(tokens: Token[], start: number): number {
  const open = tokens[start];
  if (open.kind !== 'open' || open.selfClosing) return -1;
  let depth = 0;
  for (let i = start + 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.kind === 'open' && token.name === open.name && !token.selfClosing) depth += 1;
    else if (token.kind === 'close' && token.name === open.name) {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

/** True when nothing between `from` and `to` starts a block-level element. */
function inlineOnly(tokens: Token[], from: number, to: number): boolean {
  for (let i = from; i < to; i += 1) {
    const token = tokens[i];
    if (token.kind === 'other') return false;
    if ((token.kind === 'open' || token.kind === 'close') && !INLINE_TAGS.has(token.name)) return false;
    if (token.kind === 'open' && RAW_TAGS.has(token.name)) return false;
  }
  return true;
}

/** Collapse whitespace runs to one space, keeping the edges. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ');
}

export function formatHtml(html: string, indent = '  '): string {
  const tokens = tokenize(html);
  const lines: string[] = [];
  let depth = 0;

  const emit = (content: string) => {
    if (content) lines.push(indent.repeat(Math.max(0, depth)) + content);
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (token.kind === 'text') {
      const trimmed = collapse(token.raw).trim();
      if (trimmed) emit(trimmed);
      continue;
    }

    if (token.kind === 'other') {
      emit(token.raw);
      continue;
    }

    if (token.kind === 'close') {
      depth -= 1;
      emit(token.raw);
      continue;
    }

    if (token.selfClosing) {
      emit(token.raw);
      continue;
    }

    const close = matchingClose(tokens, i);

    // Unbalanced markup: emit the tag and do not change depth, so one bad tag
    // cannot cascade into runaway indentation for the rest of the document.
    if (close === -1) {
      emit(token.raw);
      continue;
    }

    if (RAW_TAGS.has(token.name)) {
      // Verbatim, including the original whitespace.
      const inner = tokens
        .slice(i + 1, close)
        .map((t) => t.raw)
        .join('');
      emit(`${token.raw}${inner}${tokens[close].raw}`);
      i = close;
      continue;
    }

    if (inlineOnly(tokens, i + 1, close)) {
      // One line, whitespace between inline children preserved exactly.
      const inner = tokens
        .slice(i + 1, close)
        .map((t) => (t.kind === 'text' ? collapse(t.raw) : t.raw))
        .join('');
      emit(`${token.raw}${inner.trim() === '' ? '' : inner}${tokens[close].raw}`);
      i = close;
      continue;
    }

    emit(token.raw);
    depth += 1;
  }

  return lines.join('\n');
}
