/**
 * Cloud configuration.
 *
 * Both values are compiled into the bundle by Vite, and both are meant to be
 * public. Neither is a credential: the Data API URL is just an address, and
 * what protects the data is row-level security in `neon/schema.sql` — every
 * policy compares `auth.user_id()` to the row's owner, so knowing the URL grants
 * nothing without a signed-in user's JWT.
 *
 * The Neon *connection string* is the opposite: it carries a password and full
 * database authority. It must never appear in this file, in the front end, or
 * in the repository.
 *
 * With no configuration the editor runs exactly as it always has — local only,
 * no account, no network — which is also the mode it must stay in when opened
 * from a `file://` URL, where the API would reject the null origin anyway.
 */

/**
 * Where the auth endpoints live.
 *
 * Defaults to this site's own `/api/auth`, which is the Vercel function
 * proxying Neon Auth, and that default is the important part: Neon Auth keeps
 * its session in an HTTP-only cookie, so it must be served from the site's own
 * origin. Called directly on its `*.neon.tech` hostname the cookie is
 * third-party, and Safari discards it — the user signs in, the page reloads,
 * and they are signed out again with nothing to show why.
 *
 * Overridable so `vite dev` can point straight at Neon when running without
 * `vercel dev`, where the same-origin function does not exist.
 */
const authUrl = (import.meta.env.VITE_NEON_AUTH_URL ?? '/api/auth').trim().replace(/\/+$/, '');

/** The Neon Data API base, e.g. `https://<ep>.apirest.<region>.aws.neon.tech/neondb/rest/v1`. */
const dataUrl = (import.meta.env.VITE_NEON_DATA_URL ?? '').trim().replace(/\/+$/, '');

export interface CloudConfig {
  authUrl: string;
  dataUrl: string;
}

/** Null when the build carries no project, or when sync cannot work here. */
export function cloudConfig(): CloudConfig | null {
  // The auth URL alone is not enough to be useful: signing in with nowhere to
  // save to is a worse experience than staying local-only and saying so.
  if (!authUrl || !dataUrl) return null;
  return { authUrl, dataUrl };
}

/**
 * Whether this page can talk to the API at all.
 *
 * A document opened from disk has an opaque origin: the browser sends
 * `Origin: null`, which CORS on the API will refuse, and a relative `/api/auth`
 * would resolve against the filesystem root. Rather than let every request fail
 * one by one, the account UI is hidden and the editor stays in its local-only
 * mode, which is the honest description of what it can do there.
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
