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
 */

import { useEffect, useState } from 'react';

import { Field, Icon } from './common';
import { TextControl } from './inspector/controls';
import { useAccount } from '../store/account';

import brandGlyph from '../../../assets/images/brand-glyph.png';

export function AuthGate() {
  const busy = useAccount((s) => s.busy);
  const error = useAccount((s) => s.error);
  const notice = useAccount((s) => s.notice);
  const pendingEmail = useAccount((s) => s.pendingEmail);
  const account = useAccount();

  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Enter should submit from either field. A wall with a button you have to
  // hunt for is a worse wall.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !busy && email && password) void submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const submit = async () => {
    if (mode === 'in') await account.signIn(email, password);
    else await account.signUp(email, password);
  };

  return (
    <div className="gate">
      <div className="gate__card">
        <div className="gate__brand">
          <img src={brandGlyph} width={26} height={33} alt="" />
          <span>BLOKZA</span>
        </div>

        <h1 className="gate__title">{mode === 'in' ? 'Sign in' : 'Create an account'}</h1>
        <p className="gate__lead">
          {mode === 'in'
            ? 'Your sites are saved to your account, so they follow you to any browser or machine.'
            : 'One account keeps every site you build, on every machine you use.'}
        </p>

        <Field label="Email">
          <TextControl value={email} placeholder="you@example.com" onCommit={setEmail} />
        </Field>
        <Field label="Password" hint={mode === 'up' ? 'At least eight characters.' : undefined}>
          <TextControl
            value={password}
            password
            // Lets a password manager offer to generate and save one, rather
            // than trying to fill an account that does not exist yet.
            autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
            placeholder="••••••••"
            onCommit={setPassword}
          />
        </Field>

        {error ? <p className="gate__error">{error}</p> : null}
        {notice ? <p className="gate__notice">{notice}</p> : null}

        {/*
         * Offered only while an address is actually waiting on a confirmation.
         * The first mail going to spam is the usual way an email sign-up stalls,
         * and without this the only route forward is to try again and be told
         * the address is already taken.
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

        <button
          type="button"
          className="gate__submit"
          disabled={busy || !email || !password}
          onClick={() => void submit()}
        >
          {busy ? 'Working…' : mode === 'in' ? 'Sign in' : 'Create account'}
        </button>

        <button
          type="button"
          className="gate__link"
          onClick={() => {
            setMode(mode === 'in' ? 'up' : 'in');
            // A "wrong password" left over from the other mode is confusing
            // rather than helpful; the store owns the fields, so clear them here.
            useAccount.setState({ error: null, notice: null });
          }}
        >
          {mode === 'in' ? 'No account yet? Create one' : 'Already have an account? Sign in'}
        </button>

        <a className="gate__back" href="/">
          <Icon path="M15 6l-6 6 6 6" size={13} strokeWidth={2} /> Back to blokza.com
        </a>
      </div>
    </div>
  );
}
