/**
 * Id generation.
 *
 * Ids double as CSS class fragments (`.n-<id>` — see `core/css.ts`), so the
 * alphabet is restricted to characters that are valid in an identifier and the
 * first character is always a letter. `crypto.getRandomValues` is used where
 * available so two tabs editing the same document never collide.
 */

const FIRST = 'abcdefghijklmnopqrstuvwxyz';
const REST = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(out);
    return out;
  }
  for (let i = 0; i < n; i += 1) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/** A short, CSS-identifier-safe unique id (e.g. `k3f9a2be`). */
export function uid(length = 8): string {
  const bytes = randomBytes(length);
  let out = FIRST[bytes[0] % FIRST.length];
  for (let i = 1; i < length; i += 1) out += REST[bytes[i] % REST.length];
  return out;
}

/** Turn arbitrary text into a url/file-safe slug. Always returns something. */
export function slugify(input: string, fallback = 'page'): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || fallback;
}

/**
 * Make `slug` unique against `taken` by appending `-2`, `-3`, … The comparison
 * is exact, so callers must normalise before passing values in.
 */
export function uniqueSlug(slug: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(slug)) return slug;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${slug}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${slug}-${uid(4)}`;
}
