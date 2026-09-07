/**
 * The sign-in wall.
 *
 * Shown instead of the editor when nobody is signed in. This is a product
 * decision rather than a security one, and the distinction matters: the bundle
 * is public, so anyone determined can step around this component. What actually
 * protects anything is row-level security in Postgres — signed out, the Data API
 * returns no row of anyone's, whatever the browser claims.
 *
 * It does not appear where it could never be satisfied. Opened from a `file://`
 * URL, or built with no cloud project, there is no API to sign in against, so
 * gating would lock the editor shut with no way through. `cloudAvailable()`
 * decides, and in those modes the editor stays local-only exactly as before.
 *
 * This is also the only place in the product that asks for a password, which is
 * why `/signin.html` and `/signup.html` now redirect here rather than carrying
 * forms of their own. Two implementations of one form is two chances to drift.
 */

import { useEffect, useRef, useState } from 'react';

import { Icon } from './common';
import { useAccount } from '../store/account';

import brandGlyph from '../../../assets/images/brand-glyph.png';

/** `?mode=signup` arrives from the marketing site's "Get started" links. */
function initialMode(): 'in' | 'up' {
  if (typeof window === 'undefined') return 'in';
  const mode = new URLSearchParams(window.location.search).get('mode');
  return mode === 'signup' || mode === 'up' ? 'up' : 'in';
}

export function AuthGate() {
  const busy = useAccount((s) => s.busy);
  const error = useAccount((s) => s.error);
  const notice = useAccount((s) => s.notice);
  const pendingEmail = useAccount((s) => s.pendingEmail);
  const account = useAccount();

  const [mode, setMode] = useState<'in' | 'up'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const emailRef = useRef<HTMLInputElement>(null);

  // The one field anyone needs to touch first.
  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  /*
   * A real form, and real inputs.
   *
   * Enter submits because the browser makes it, not because a window-level
   * keydown listener is watching — and a password manager will offer to fill
   * and save a `<form>` with the right `autocomplete` values, which it will not
   * do for the inspector's commit-on-blur control. On a screen whose entire job
   * is one password, that is the difference between working and nearly working.
   */
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !email || !password) return;
    if (mode === 'in') await account.signIn(email, password);
    else await account.signUp(email, password);
  };

  const signingIn = mode === 'in';

  return (
    <div className="gate">
      <div className="gate__shell">
        <a className="gate__brand" href="/">
          <img src={brandGlyph} width={24} height={30} alt="" />
          <span>BLOKZA</span>
        </a>

        <div className="gate__card">
          <h1 className="gate__title">{signingIn ? 'Sign in' : 'Create your account'}</h1>
          <p className="gate__lead">
            {signingIn
              ? 'Your sites are saved to your account, so they follow you to any browser or machine.'
              : 'Free, and it takes a moment. One account holds every site you build.'}
          </p>

          <form onSubmit={(event) => void submit(event)}>
            <label className="gate__label" htmlFor="gate-email">
              Email
            </label>
            <input
              id="gate-email"
              ref={emailRef}
              className="gate__input"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />

            <label className="gate__label" htmlFor="gate-password">
              Password
            </label>
            <input
              id="gate-password"
              className="gate__input"
              type="password"
              // `new-password` is what tells a manager to offer a generated one
              // rather than trying to fill an account that does not exist yet.
              autoComplete={signingIn ? 'current-password' : 'new-password'}
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {!signingIn ? <p className="gate__hint">At least eight characters.</p> : null}

            {error ? (
              <p className="gate__error" role="alert">
                {error}
              </p>
            ) : null}
            {notice ? <p className="gate__notice">{notice}</p> : null}

            {/*
             * Offered only while an address is actually waiting on a
             * confirmation. The first mail going to spam is the usual way an
             * email sign-up stalls, and without this the only route forward is
             * to try again and be told the address is already taken.
             */}
            {pendingEmail ? (
              <button
                type="button"
                className="gate__link"
                disabled={busy}
                onClick={() => void account.resendConfirmation()}
              >
                {busy ? 'Sending…' : 'Send the confirmation email again'}
              </button>
            ) : null}

            <button className="gate__submit" type="submit" disabled={busy || !email || !password}>
              {busy ? 'Working…' : signingIn ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p className="gate__alt">
            {signingIn ? 'New here? ' : 'Already have an account? '}
            <button
              type="button"
              className="gate__switch"
              onClick={() => {
                setMode(signingIn ? 'up' : 'in');
                // A "wrong password" left over from the other mode is confusing
                // rather than helpful; the store owns it, so clear it here.
                useAccount.setState({ error: null, notice: null });
              }}
            >
              {signingIn ? 'Create an account' : 'Sign in'}
            </button>
          </p>
        </div>

        <a className="gate__back" href="/">
          <Icon path="M15 6l-6 6 6 6" size={13} strokeWidth={2} /> Back to blokza.com
        </a>
      </div>
    </div>
  );
}
