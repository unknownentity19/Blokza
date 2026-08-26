/**
 * Completing an email confirmation.
 *
 * The fragment GoTrue redirects with is a credential, so the interesting cases
 * are all about not mishandling it: erasing it from the URL, refusing a
 * half-session that would expire into a silent sign-out, and telling someone
 * their link is stale instead of dropping them on a page that looks fine.
 */

import { describe, expect, it, vi } from 'vitest';

import { consumeAuthCallback } from '../src/cloud/callback';

const APP = 'https://saaswise.dev/app/';

describe('consumeAuthCallback', () => {
  it('does nothing on an ordinary URL', () => {
    expect(consumeAuthCallback(APP).kind).toBe('none');
    expect(consumeAuthCallback(`${APP}?seed=demo`).kind).toBe('none');
  });

  it('survives a URL it cannot parse rather than throwing on load', () => {
    expect(consumeAuthCallback('not a url').kind).toBe('none');
  });

  it('turns a confirmation fragment into a session', () => {
    const result = consumeAuthCallback(
      `${APP}#access_token=at-1&refresh_token=rt-1&expires_in=3600&token_type=bearer&type=signup`,
    );
    expect(result.kind).toBe('session');
    if (result.kind !== 'session') return;
    expect(result.session.accessToken).toBe('at-1');
    expect(result.session.refreshToken).toBe('rt-1');
    expect(result.confirmed).toBe(true);
    expect(result.session.expiresAt).toBeGreaterThan(Date.now());
  });

  /**
   * The whole point of consuming it. An access token left in the address bar is
   * copied into pasted links, and left in history for anyone on the machine.
   */
  it('erases every auth parameter from the URL', () => {
    const scrub = vi.fn();
    consumeAuthCallback(
      `${APP}?seed=demo#access_token=at-1&refresh_token=rt-1&expires_in=3600&type=signup`,
      scrub,
    );
    expect(scrub).toHaveBeenCalledTimes(1);
    const cleaned = scrub.mock.calls[0][0] as string;
    expect(cleaned).not.toContain('access_token');
    expect(cleaned).not.toContain('refresh_token');
    expect(cleaned).not.toContain('type=signup');
    // and it keeps what was not ours
    expect(cleaned).toContain('seed=demo');
  });

  /**
   * The case my first pass got wrong: `type` and `expires_in` were read *after*
   * the scrub had deleted them, so with scrubbing on — which is how it always
   * runs in the app — a confirmed sign-up silently reported itself as not
   * confirmed and the "Email confirmed" notice never appeared.
   */
  it('still reports the confirmation and expiry when the URL is being scrubbed', () => {
    const result = consumeAuthCallback(
      `${APP}#access_token=at-1&refresh_token=rt-1&expires_in=60&type=signup`,
      () => {},
    );
    expect(result.kind).toBe('session');
    if (result.kind !== 'session') return;
    expect(result.confirmed).toBe(true);
    // 60s, not the 3600s default
    expect(result.session.expiresAt).toBeLessThan(Date.now() + 120_000);
  });

  it('keeps any unrelated fragment the page was using', () => {
    const scrub = vi.fn();
    consumeAuthCallback(`${APP}#panel=insert&access_token=at-1&refresh_token=rt-1`, scrub);
    expect(scrub.mock.calls[0][0]).toContain('panel=insert');
  });

  /**
   * An access token with no refresh token works until it expires and then signs
   * the person out with no warning. Refusing it is the kinder failure.
   */
  it('refuses a session with no refresh token', () => {
    const result = consumeAuthCallback(`${APP}#access_token=at-1&expires_in=3600&type=signup`);
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.message).toMatch(/complete session/i);
  });

  it('explains an expired link instead of failing silently', () => {
    const result = consumeAuthCallback(
      `${APP}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`,
    );
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.message).toMatch(/expired/i);
    // not GoTrue's raw wording, and not a plus-encoded sentence
    expect(result.message).not.toContain('+');
  });

  it('reads an error from the query string too, and still clears it', () => {
    const scrub = vi.fn();
    const result = consumeAuthCallback(
      `${APP}?error=access_denied&error_description=Something+went+wrong`,
      scrub,
    );
    expect(result.kind).toBe('error');
    expect(scrub.mock.calls[0][0]).not.toContain('error');
  });

  it('says so plainly when the address was already confirmed', () => {
    const result = consumeAuthCallback(
      `${APP}#error=invalid_request&error_description=Email+link+already+used`,
    );
    if (result.kind !== 'error') throw new Error('expected an error');
    expect(result.message).toMatch(/already confirmed/i);
  });

  it('does not scrub when no callback is present', () => {
    const scrub = vi.fn();
    consumeAuthCallback(`${APP}#panel=insert`, scrub);
    expect(scrub).not.toHaveBeenCalled();
  });
});
