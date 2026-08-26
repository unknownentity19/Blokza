/**
 * Completing an email confirmation.
 *
 * GoTrue's confirmation link goes to the API, which verifies the token and then
 * redirects back here with the session in the URL *fragment*:
 *
 *   https://saaswise.dev/app/#access_token=…&refresh_token=…&type=signup
 *
 * Nothing read that fragment before, so confirming an address dropped the
 * visitor on a page with an access token visible in the address bar and no
 * session — they had to go back and sign in by hand, and the token stayed in
 * their history.
 *
 * A failed or expired link comes back the same way but carries `error` and
 * `error_description` instead, which is worth telling someone about rather than
 * leaving them on an ordinary-looking page wondering whether it worked.
 *
 * The fragment is consumed and erased in one step: it is a credential, and it
 * has no business surviving in `history` or being copied out of the address bar.
 */

import type { Session } from './client';

export type CallbackResult =
  | { kind: 'none' }
  | { kind: 'session'; session: Session; confirmed: boolean }
  | { kind: 'error'; message: string };

/** GoTrue's wording is accurate and unhelpful; these are the cases people hit. */
function friendly(code: string, description: string): string {
  const text = description.replace(/\+/g, ' ');
  if (/expired/i.test(code) || /expired/i.test(text)) {
    return 'That confirmation link has expired. Sign up again, or ask for a new one.';
  }
  if (/already/i.test(text)) return 'That address is already confirmed. Sign in below.';
  return text || 'That confirmation link could not be used.';
}

/**
 * Read and clear an auth callback from the current URL.
 *
 * `scrub` is injectable so the whole thing is testable without a real History
 * API, and so a caller can decide not to rewrite the URL.
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

  // The fragment carries the session; a `?error=` can arrive in either place.
  const frag = new URLSearchParams(url.hash.replace(/^#/, ''));
  const query = url.searchParams;

  // Everything is read out before the scrub below deletes it. Reading `type` or
  // `expires_in` afterwards silently yielded the defaults, so a confirmed
  // sign-up never announced itself.
  const errorCode = frag.get('error') ?? frag.get('error_code') ?? query.get('error') ?? '';
  const errorText = frag.get('error_description') ?? query.get('error_description') ?? '';
  const accessToken = frag.get('access_token') ?? '';
  const refreshToken = frag.get('refresh_token') ?? '';
  const isSignup = (frag.get('type') ?? '') === 'signup';
  const expiresInRaw = Number(frag.get('expires_in') ?? 3600);
  const expiresIn = Number.isFinite(expiresInRaw) && expiresInRaw > 0 ? expiresInRaw : 3600;

  if (!errorCode && !accessToken) return { kind: 'none' };

  // Strip every auth parameter and put the tidy URL back, whatever the outcome.
  if (scrub) {
    for (const key of [
      'error', 'error_code', 'error_description', 'access_token', 'refresh_token',
      'expires_in', 'expires_at', 'token_type', 'type', 'provider_token',
    ]) {
      frag.delete(key);
      query.delete(key);
    }
    const rest = frag.toString();
    url.hash = rest ? `#${rest}` : '';
    scrub(url.toString());
  }

  if (errorCode || (errorText && !accessToken)) {
    return { kind: 'error', message: friendly(errorCode, errorText) };
  }

  if (!refreshToken) {
    // An access token with nothing to refresh it would work until it expired and
    // then silently sign the person out, which is worse than not accepting it.
    return { kind: 'error', message: 'That link did not carry a complete session. Sign in below.' };
  }

  return {
    kind: 'session',
    confirmed: isSignup,
    session: {
      accessToken,
      refreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
      // The fragment does not carry the user; `restore` fills this in from the
      // API on the next call, and nothing in the UI needs it before then.
      user: { id: '', email: '' },
    },
  };
}

/** Where a confirmation link should come back to: this exact editor page. */
export function authRedirectTarget(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const { origin, pathname } = window.location;
  if (!origin || origin === 'null') return undefined;
  return `${origin}${pathname}`;
}
