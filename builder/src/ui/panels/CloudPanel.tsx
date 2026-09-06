/**
 * Account and cloud sites.
 *
 * Three states, and the empty one matters most: with no project configured — or
 * opened from disk, where the API cannot be reached at all — this says so
 * plainly instead of offering a sign-in that could never work. Those are also
 * the only modes where the editor opens without a session at all; everywhere
 * else `AuthGate` has already required one before this panel can be reached.
 *
 * A conflict is the only place the editor asks the user to choose. It cannot be
 * resolved automatically: two devices have both edited the same site, and no
 * rule the editor could apply is better than being told which one to keep.
 */

import { useEffect, useState } from 'react';

import { Field, Icon } from '../common';
import { TextControl } from '../inspector/controls';
import { cloudUnavailableReason } from '../../cloud/config';
import { useAccount } from '../../store/account';
import { useEditor } from '../../store/editor';

function relative(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function CloudPanel() {
  const client = useAccount((s) => s.client);
  const session = useAccount((s) => s.session);
  const sites = useAccount((s) => s.sites);
  const busy = useAccount((s) => s.busy);
  const error = useAccount((s) => s.error);
  const notice = useAccount((s) => s.notice);
  const pendingEmail = useAccount((s) => s.pendingEmail);
  const sync = useAccount((s) => s.sync);
  const boundSiteId = useAccount((s) => s.boundSiteId);
  const account = useAccount();

  const doc = useEditor((s) => s.doc);
  const replaceDoc = useEditor((s) => s.replaceDoc);
  const toast = useEditor((s) => s.toast);

  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    void account.restore();
    // Restoring once on mount is the intent; `account` is a stable store handle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unavailable = cloudUnavailableReason();
  if (!client) {
    return (
      <div className="ui-panel">
        <header className="ui-panel__head">
          <strong>Cloud</strong>
        </header>
        <div className="ui-panel__scroll cl">
          <p className="cl__hint">{unavailable ?? 'Cloud sync is not set up for this build.'}</p>
          <p className="cl__hint">
            Your work is saved in this browser and stays there. Publish exports the finished site as
            files you can host anywhere.
          </p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="ui-panel">
        <header className="ui-panel__head">
          <strong>{mode === 'in' ? 'Sign in' : 'Create an account'}</strong>
        </header>
        <div className="ui-panel__scroll cl">
          <p className="cl__hint">
            Signing in keeps your sites on the server so you can open them from another
            browser or machine.
          </p>
          <Field label="Email">
            <TextControl value={email} placeholder="you@example.com" onCommit={setEmail} />
          </Field>
          <Field label="Password" hint={mode === 'up' ? 'At least six characters.' : undefined}>
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
          {error ? <p className="cl__error">{error}</p> : null}
          {notice ? <p className="cl__notice">{notice}</p> : null}
          {/*
            * Offered only while an address is actually waiting on a
            * confirmation. The first mail going to spam, or expiring while
            * someone does something else, is the usual way an email sign-up
            * stalls — and without this the only route forward is to try to sign
            * up again and be told the address is already taken.
            */}
          {pendingEmail ? (
            <button
              type="button"
              className="cl__link"
              disabled={busy}
              onClick={() => void account.resendConfirmation()}
            >
              {busy ? 'Sending…' : 'Send the confirmation email again'}
            </button>
          ) : null}
          <div className="ui-btnrow">
            <button
              type="button"
              className="ui-btn is-primary"
              disabled={busy || !email || !password}
              onClick={() => {
                void (mode === 'in'
                  ? account.signIn(email, password)
                  : account.signUp(email, password)
                ).then((ok) => {
                  if (ok) setPassword('');
                });
              }}
            >
              {busy ? 'Working…' : mode === 'in' ? 'Sign in' : 'Create account'}
            </button>
          </div>
          <button
            type="button"
            className="cl__link"
            onClick={() => setMode(mode === 'in' ? 'up' : 'in')}
          >
            {mode === 'in' ? 'No account yet? Create one' : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ui-panel">
      <header className="ui-panel__head">
        <strong>Cloud</strong>
        <span className="ui-panel__sub">{session.user.email}</span>
      </header>
      <div className="ui-panel__scroll cl">
        {sync.kind === 'conflict' ? (
          <div className="cl__conflict">
            <strong>This site changed elsewhere</strong>
            <p>
              Another browser or device saved after you opened it. Nothing has been overwritten —
              choose which version to keep.
            </p>
            <div className="ui-btnrow">
              <button
                type="button"
                className="ui-btn"
                onClick={() => void account.forceSave(doc, doc.name)}
              >
                Keep what is on screen
              </button>
              <button
                type="button"
                className="ui-btn"
                onClick={() => {
                  void account.reloadFromCloud().then((remote) => {
                    if (remote) {
                      replaceDoc(remote, 'Loaded the version from the cloud');
                    }
                  });
                }}
              >
                Use the saved version
              </button>
            </div>
          </div>
        ) : null}

        {error ? <p className="cl__error">{error}</p> : null}

        {boundSiteId ? (
          <p className="cl__hint">
            <Icon path="M5 13l4 4L19 7" size={13} />
            {sync.kind === 'saving'
              ? 'Saving to the cloud…'
              : sync.kind === 'saved'
                ? 'Saved to the cloud.'
                : sync.kind === 'error'
                  ? sync.message
                  : 'Changes will sync as you edit.'}
          </p>
        ) : (
          <div className="cl__cta">
            <p className="cl__hint">
              This site is only in this browser. Put a copy in the cloud to reach it from anywhere.
            </p>
            <button
              type="button"
              className="ui-btn is-primary"
              disabled={busy}
              onClick={() => {
                void account.createSite(doc.name || 'Untitled site', doc).then((id) => {
                  if (id) toast('Saved to your account', 'success');
                });
              }}
            >
              Save this site to my account
            </button>
          </div>
        )}

        <div className="cl__list">
          <span className="cl__legend">
            {sites.length} {sites.length === 1 ? 'site' : 'sites'} in your account
          </span>
          {sites.map((site) => (
            <div key={site.id} className={`cl__site ${site.id === boundSiteId ? 'is-open' : ''}`}>
              <button
                type="button"
                className="cl__open"
                disabled={busy || site.id === boundSiteId}
                onClick={() => {
                  void account.openSite(site.id).then((remote) => {
                    if (remote) replaceDoc(remote, `Opened “${site.name}”`);
                  });
                }}
              >
                <span className="cl__site-name">{site.name}</span>
                <span className="cl__site-meta">
                  {site.id === boundSiteId ? 'open' : relative(site.updatedAt)}
                </span>
              </button>
              <button
                type="button"
                className="cl__del"
                title={`Delete “${site.name}” from your account`}
                onClick={() => void account.deleteSite(site.id)}
              >
                <Icon path="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" size={13} />
              </button>
            </div>
          ))}
          {sites.length === 0 ? <p className="cl__hint">Nothing saved to the cloud yet.</p> : null}
        </div>

        <div className="ui-btnrow">
          <button type="button" className="ui-btn" onClick={() => void account.signOut()}>
            Sign out
          </button>
        </div>
        <p className="cl__hint cl__fine">
          Deleting a site here removes it from your account. The copy in this browser is untouched.
        </p>
      </div>
    </div>
  );
}
