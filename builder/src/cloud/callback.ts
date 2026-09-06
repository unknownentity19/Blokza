/**
 * Completing an email confirmation.
 *
 * Neon Auth verifies the address server-side: the link in the email goes to
 * `/verify-email?token=…&callbackURL=…`, which checks the token, sets the
 * session cookie, and redirects here. By the time this code runs the visitor is
 * already signed in — there is nothing to extract and nothing to store.
 *
 * That is a real improvement on what this file used to do. The previous flow
 * came back with the session in the URL *fragment*:
 *
 *   https://blokza.com/app/#access_token=…&refresh_token=…&type=signup
 *
 * so a live credential sat in the address bar, in `history`, and in anything
 * that scraped either. It had to be read out and scrubbed before it leaked. Now
 * no credential is ever in the URL at all, because the cookie was set by the
 * redirect that brought the user here.
 *
 * What remains is only ever a *notice*: either "your address is confirmed", or
 * an explanation of why the link did not work.
 */

export type CallbackResult =
  | { kind: 'none' }
  | { kind: 'confirmed' }
  | { kind: 'error'; message: string };

/**
 * The marker we ask Neon Auth to redirect back with.
 *
 * Better Auth returns to the bare `callbackURL` on success, so without adding
 * something ourselves there is no way to tell "just confirmed an address" from
 * "opened the editor". Putting it in the URL we hand over is the only signal
 * that survives the round trip.
 */
export const CONFIRMED_PARAM = 'confirmed';

/** Their wording is accurate and unhelpful; these are the cases people hit. */
function friendly(code: string, description: string): string {
  const text = description.replace(/\+/g, ' ');
  if (/expired/i.test(code) || /expired/i.test(text)) {
    return 'That confirmation link has expired. Sign up again, or ask for a new one.';
  }
  if (/already/i.test(code) || /already/i.test(text)) {
    return 'That address is already confirmed. Sign in below.';
  }
  if (/invalid|token/i.test(code)) {
    return 'That confirmation link could not be used. Ask for a new one.';
  }
  return text || 'That confirmation link could not be used.';
}

/**
 * Read and clear an auth callback from the current URL.
 *
 * `scrub` is injectable so the whole thing is testable without a real History
 * API, and so a caller can decide not to rewrite the URL. Nothing here is
 * secret any more, but a reload should not re-announce a confirmation that
 * already happened.
 */
export function consumeAuthCallback(
  href: string,
  scrub?: (cleanUrl: string) => void,
): CallbackResult {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { kind: 'none' };
  }

  // An error can arrive in either place depending on how the redirect was
  // built, and reading both costs nothing.
  const frag = new URLSearchParams(url.hash.replace(/^#/, ''));
  const query = url.searchParams;

  // Read everything out before the scrub below deletes it.
  const errorCode = query.get('error') ?? query.get('error_code') ?? frag.get('error') ?? '';
  const errorText =
    query.get('error_description') ?? frag.get('error_description') ?? '';
  const confirmed = query.get(CONFIRMED_PARAM) === '1';

  if (!errorCode && !errorText && !confirmed) return { kind: 'none' };

  // Strip every callback parameter and put the tidy URL back, whatever the
  // outcome — a refresh should not repeat the message.
  if (scrub) {
    for (const key of [CONFIRMED_PARAM, 'error', 'error_code', 'error_description', 'token']) {
      frag.delete(key);
      query.delete(key);
    }
    const rest = frag.toString();
    url.hash = rest ? `#${rest}` : '';
    scrub(url.toString());
  }

  if (errorCode || errorText) {
    return { kind: 'error', message: friendly(errorCode, errorText) };
  }

  return { kind: 'confirmed' };
}

/**
 * Where a confirmation link should come back to: this exact editor page,
 * carrying the marker that says why the visitor arrived.
 */
export function authRedirectTarget(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const { origin, pathname } = window.location;
  if (!origin || origin === 'null') return undefined;
  return `${origin}${pathname}?${CONFIRMED_PARAM}=1`;
}
