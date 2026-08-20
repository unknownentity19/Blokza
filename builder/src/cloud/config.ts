/**
 * Cloud configuration.
 *
 * Both values are compiled into the bundle by Vite, and both are meant to be
 * public: the anon key identifies the project, it does not grant access. What
 * protects the data is row-level security in `supabase/schema.sql` — every
 * policy compares `auth.uid()` to the row's owner, so a stolen anon key can
 * read nothing without a signed-in user's token.
 *
 * The *service role* key is the opposite: it bypasses RLS entirely. It must
 * never appear in this file, in the front end, or in the repository.
 *
 * With no configuration the editor runs exactly as it always has — local only,
 * no account, no network — which is also the mode it must stay in when opened
 * from a `file://` URL, where the API would reject the null origin anyway.
 */

const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

export interface CloudConfig {
  url: string;
  anonKey: string;
}

/** Null when the build carries no project, or when sync cannot work here. */
export function cloudConfig(): CloudConfig | null {
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/**
 * Whether this page can talk to the API at all.
 *
 * A document opened from disk has an opaque origin: the browser sends
 * `Origin: null`, which CORS on the API will refuse. Rather than let every
 * request fail one by one, the account UI is hidden and the editor stays in its
 * local-only mode, which is the honest description of what it can do there.
 */
export function cloudAvailable(): boolean {
  if (!cloudConfig()) return false;
  if (typeof window === 'undefined') return false;
  return window.location.protocol === 'http:' || window.location.protocol === 'https:';
}

/** Why the account UI is absent, for a one-line explanation in the editor. */
export function cloudUnavailableReason(): string | null {
  if (!cloudConfig()) return 'This build has no cloud project configured.';
  if (!cloudAvailable()) {
    return 'Opened from a file, so sign-in is unavailable. Your work is saved in this browser.';
  }
  return null;
}
