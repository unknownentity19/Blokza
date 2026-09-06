/**
 * Completing an email confirmation.
 *
 * Neon Auth verifies the address server-side and redirects here with the cookie
 * already set, so unlike the flow this replaces there is no credential in the
 * URL to mishandle. What is left is a notice, and the interesting cases are all
 * about showing the right one exactly once: announcing a confirmation, keeping
 * the page's own fragment, explaining a stale link, and not repeating any of it
 * on a refresh.
 */

import { describe, expect, it, vi } from 'vitest';

import { CONFIRMED_PARAM, authRedirectTarget, consumeAuthCallback } from '../src/cloud/callback';

const APP = 'https://blokza.com/app/';

describe('consumeAuthCallback', () => {
  it('does nothing on an ordinary URL', () => {
    expect(consumeAuthCallback(APP).kind).toBe('none');
    expect(consumeAuthCallback(`${APP}?seed=demo`).kind).toBe('none');
  });

  it('survives a URL it cannot parse rather than throwing on load', () => {
    expect(consumeAuthCallback('not a url').kind).toBe('none');
  });

  it('reports a confirmed address', () => {
    expect(consumeAuthCallback(`${APP}?${CONFIRMED_PARAM}=1`).kind).toBe('confirmed');
  });

  /**
   * The reason the marker exists at all: Better Auth returns to the bare
   * callback URL on success, so without something of our own there is no way to
   * tell a fresh confirmation from someone simply opening the editor, and the
   * "Email confirmed" notice would either never appear or appear every time.
   */
  it('round-trips the marker that authRedirectTarget asks for', () => {
    const target = 'https://blokza.com/app/index.html?confirmed=1';
    expect(consumeAuthCallback(target).kind).toBe('confirmed');
  });

  it('erases the callback parameters from the URL', () => {
    const scrub = vi.fn();
    consumeAuthCallback(`${APP}?seed=demo&${CONFIRMED_PARAM}=1`, scrub);
    expect(scrub).toHaveBeenCalledTimes(1);
    const cleaned = scrub.mock.calls[0][0] as string;
    expect(cleaned).not.toContain(CONFIRMED_PARAM);
    // and it keeps what was not ours
    expect(cleaned).toContain('seed=demo');
  });

  /**
   * The mistake the previous version of this file was written to catch: values
   * read *after* the scrub had deleted them came back as defaults, so with
   * scrubbing on — which is how it always runs in the app — a confirmed sign-up
   * silently reported itself as not confirmed.
   */
  it('still reports the confirmation when the URL is being scrubbed', () => {
    expect(consumeAuthCallback(`${APP}?${CONFIRMED_PARAM}=1`, () => {}).kind).toBe('confirmed');
  });

  it('keeps any unrelated fragment the page was using', () => {
    const scrub = vi.fn();
    consumeAuthCallback(`${APP}?${CONFIRMED_PARAM}=1#panel=insert`, scrub);
    expect(scrub.mock.calls[0][0]).toContain('panel=insert');
  });

  it('explains an expired link instead of failing silently', () => {
    const result = consumeAuthCallback(
      `${APP}?error=invalid_token&error_description=Token+is+invalid+or+has+expired`,
    );
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.message).toMatch(/expired/i);
    // not the raw upstream wording, and not a plus-encoded sentence
    expect(result.message).not.toContain('+');
  });

  it('reads an error from the fragment too, and still clears it', () => {
    const scrub = vi.fn();
    const result = consumeAuthCallback(`${APP}#error=access_denied`, scrub);
    expect(result.kind).toBe('error');
    expect(scrub.mock.calls[0][0]).not.toContain('error');
  });

  it('says so plainly when the address was already confirmed', () => {
    const result = consumeAuthCallback(`${APP}?error=already_verified`);
    if (result.kind !== 'error') throw new Error('expected an error');
    expect(result.message).toMatch(/already confirmed/i);
  });

  it('does not scrub when no callback is present', () => {
    const scrub = vi.fn();
    consumeAuthCallback(`${APP}#panel=insert`, scrub);
    expect(scrub).not.toHaveBeenCalled();
  });
});

describe('authRedirectTarget', () => {
  /**
   * The target has to carry the marker, or the confirmation notice never fires:
   * Better Auth redirects to exactly this URL and adds nothing of its own.
   */
  it('carries the marker consumeAuthCallback looks for', () => {
    const target = authRedirectTarget();
    expect(target).toContain(`${CONFIRMED_PARAM}=1`);
    expect(consumeAuthCallback(String(target)).kind).toBe('confirmed');
  });
});
