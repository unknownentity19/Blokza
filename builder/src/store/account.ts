/**
 * Account and cloud-sync state.
 *
 * Deliberately a separate store from the editor. The editor's document is the
 * thing being edited and has undo history; who is signed in and whether the last
 * push succeeded are neither, and mixing them would put "signed out" on the undo
 * stack.
 *
 * The design is local-first and stays that way. `localStorage` is written on
 * every edit exactly as before, and the cloud is a second, slower sink. That
 * ordering is what keeps the editor usable with no account, offline, and from a
 * `file://` URL — none of which the cloud can serve.
 */

import { create } from 'zustand';

import {
  CloudError,
  createCloudClient,
  type CloudClient,
  type Session,
  type SiteSummary,
} from '../cloud/client';
import { authRedirectTarget, consumeAuthCallback } from '../cloud/callback';
import { cloudAvailable } from '../cloud/config';
import { ensureFresh, readSession, writeSession } from '../cloud/session';
import type { SiteDoc } from '../core/types';
import { useEditor } from './editor';

/** Cloud pushes are slower than local writes: typing should not be a request. */
const PUSH_DELAY_MS = 2500;

export type SyncState =
  | { kind: 'off' }
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'conflict' }
  | { kind: 'error'; message: string };

export interface AccountState {
  /** Null when the build has no project, or the page cannot reach it. */
  client: CloudClient | null;
  session: Session | null;
  /** True while restoring a stored session, so the UI can avoid flashing. */
  restoring: boolean;
  busy: boolean;
  error: string | null;
  /** Set after a sign-up that needs an email confirmation. */
  notice: string | null;
  /** The address awaiting confirmation, so the mail can be sent again. */
  pendingEmail: string | null;

  sites: SiteSummary[];
  /** The cloud site the editor is currently bound to, if any. */
  boundSiteId: string | null;
  boundRevision: number;
  sync: SyncState;

  restore: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (email: string, password: string) => Promise<boolean>;
  /** Send the confirmation email again, for the address that just signed up. */
  resendConfirmation: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshSites: () => Promise<void>;
  /** Push the document to a new row and bind the editor to it. */
  createSite: (name: string, doc: SiteDoc) => Promise<string | null>;
  /** Bind to an existing row, returning its document for the editor to adopt. */
  openSite: (id: string) => Promise<SiteDoc | null>;
  deleteSite: (id: string) => Promise<void>;
  unbind: () => void;
  /** Debounced push. Called on every document change; cheap when unbound. */
  queueSave: (doc: SiteDoc, name: string) => void;
  flushSave: () => void;
  /** Resolve a conflict by overwriting the remote with what is on screen. */
  forceSave: (doc: SiteDoc, name: string) => Promise<void>;
  /** Resolve a conflict by discarding local work in favour of the remote. */
  reloadFromCloud: () => Promise<SiteDoc | null>;
}

let timer: ReturnType<typeof setTimeout> | undefined;
let pending: { doc: SiteDoc; name: string } | undefined;

export const useAccount = create<AccountState>((set, get) => {
  /** A live token, or null — and the UI is told to sign in again if it cannot. */
  const token = async (): Promise<string | null> => {
    const { client, session } = get();
    if (!client || !session) return null;
    const fresh = await ensureFresh(client, session);
    if (!fresh) {
      set({ session: null, sites: [], boundSiteId: null, sync: { kind: 'off' } });
      return null;
    }
    if (fresh !== session) set({ session: fresh });
    return fresh.accessToken;
  };

  const fail = (error: unknown): string => {
    const message =
      error instanceof CloudError ? error.message : 'Something went wrong. Try again.';
    set({ error: message, busy: false });
    return message;
  };

  /**
   * Build a session from the cookie alone.
   *
   * Used where the browser may already be signed in without this tab knowing:
   * after an email confirmation redirect, and on a first load in a second tab.
   * Asking the server who we are is the only way to find out, because the cookie
   * that proves it is HTTP-only and unreadable from here.
   *
   * Returns null rather than throwing for a visitor who simply is not signed in,
   * which is the ordinary case and not an error worth showing anyone.
   */
  const establish = async (client: CloudClient): Promise<Session | null> => {
    try {
      const user = await client.getSession();
      if (!user) return null;
      const session = await client.token(user);
      writeSession(session);
      return session;
    } catch {
      writeSession(null);
      return null;
    }
  };

  const push = async (): Promise<void> => {
    const job = pending;
    pending = undefined;
    if (!job) return;
    const { client, boundSiteId, boundRevision } = get();
    if (!client || !boundSiteId) return;
    const accessToken = await token();
    if (!accessToken) return;

    set({ sync: { kind: 'saving' } });
    try {
      const saved = await client.saveSite(accessToken, boundSiteId, boundRevision, {
        doc: job.doc,
        name: job.name,
      });
      set({ boundRevision: saved.revision, sync: { kind: 'saved', at: Date.now() } });
    } catch (error) {
      if (error instanceof CloudError && error.kind === 'conflict') {
        // Do not retry and do not overwrite: the user has to choose. Keeping the
        // local document on screen is the safe default — it is the version they
        // can see and have not agreed to lose.
        set({ sync: { kind: 'conflict' } });
        return;
      }
      set({
        sync: {
          kind: 'error',
          message: error instanceof CloudError ? error.message : 'Could not save to the cloud.',
        },
      });
    }
  };

  return {
    client: cloudAvailable() ? createCloudClient() : null,
    session: null,
    restoring: false,
    busy: false,
    error: null,
    notice: null,
  pendingEmail: null,
    sites: [],
    boundSiteId: null,
    boundRevision: 0,
    sync: { kind: 'off' },

    async restore() {
      const { client } = get();
      if (!client) return;

      /*
       * An email confirmation lands here with the session in the URL fragment,
       * so that is checked before any stored session: someone who has just
       * clicked "confirm" should end up signed in, not looking at a sign-in form
       * with their credentials sitting in the address bar.
       */
      const callback = consumeAuthCallback(window.location.href, (clean) => {
        window.history.replaceState(null, '', clean);
      });
      if (callback.kind === 'error') {
        set({ error: callback.message });
      } else if (callback.kind === 'confirmed') {
        // Neon Auth set the cookie during the redirect that brought us here, so
        // there is nothing to read out of the URL — ask who we are instead.
        set({ restoring: true, notice: 'Email confirmed. You are signed in.' });
        const fresh = await establish(client);
        set({ session: fresh, restoring: false });
        if (fresh) await get().refreshSites();
        return;
      }

      const stored = readSession();
      if (!stored) return;
      set({ restoring: true });
      const fresh = await ensureFresh(client, stored);
      set({ session: fresh, restoring: false });
      if (fresh) await get().refreshSites();
    },

    async signIn(email, password) {
      const { client } = get();
      if (!client) return false;
      set({ busy: true, error: null, notice: null, pendingEmail: null });
      try {
        const user = await client.signIn(email, password);
        if (!user) throw new CloudError('That sign-in did not complete. Try again.', 'auth');
        const session = await client.token(user);
        writeSession(session);
        set({ session, busy: false });
        await get().refreshSites();
        return true;
      } catch (error) {
        fail(error);
        return false;
      }
    },

    async signUp(email, password) {
      const { client } = get();
      if (!client) return false;
      set({ busy: true, error: null, notice: null });
      try {
        const user = await client.signUp(email, password, authRedirectTarget());
        if (!user) {
          set({
            busy: false,
            // The address is kept so the panel can offer to send it again, which
            // is the one thing people need when the first mail does not arrive.
            pendingEmail: email,
            notice: 'Account created. Open the link in your inbox to confirm it.',
          });
          return false;
        }
        const session = await client.token(user);
        writeSession(session);
        set({ session, busy: false });
        await get().refreshSites();
        return true;
      } catch (error) {
        fail(error);
        return false;
      }
    },

    async resendConfirmation() {
      const { client, pendingEmail } = get();
      if (!client || !pendingEmail) return;
      set({ busy: true, error: null });
      try {
        await client.resendConfirmation(pendingEmail, authRedirectTarget());
        set({ busy: false, notice: `Sent again to ${pendingEmail}. Check spam too.` });
      } catch (error) {
        fail(error);
      }
    },

    async signOut() {
      const { client, session } = get();
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = undefined;
      if (client && session) await client.signOut();
      writeSession(null);
      set({
        session: null,
        sites: [],
        boundSiteId: null,
        boundRevision: 0,
        sync: { kind: 'off' },
        error: null,
        notice: null,
        pendingEmail: null,
      });
    },

    async refreshSites() {
      const { client } = get();
      if (!client) return;
      const accessToken = await token();
      if (!accessToken) return;
      try {
        set({ sites: await client.listSites(accessToken) });
      } catch (error) {
        fail(error);
      }
    },

    async createSite(name, doc) {
      const { client } = get();
      if (!client) return null;
      const accessToken = await token();
      if (!accessToken) return null;
      set({ busy: true, error: null });
      try {
        const created = await client.createSite(accessToken, name, doc);
        set({
          busy: false,
          boundSiteId: created.id,
          boundRevision: created.revision,
          sync: { kind: 'saved', at: Date.now() },
        });
        await get().refreshSites();
        return created.id;
      } catch (error) {
        fail(error);
        return null;
      }
    },

    async openSite(id) {
      const { client } = get();
      if (!client) return null;
      const accessToken = await token();
      if (!accessToken) return null;
      set({ busy: true, error: null });
      try {
        const record = await client.loadSite(accessToken, id);
        set({
          busy: false,
          boundSiteId: record.id,
          boundRevision: record.revision,
          sync: { kind: 'idle' },
        });
        return record.doc;
      } catch (error) {
        fail(error);
        return null;
      }
    },

    async deleteSite(id) {
      const { client, boundSiteId } = get();
      if (!client) return;
      const accessToken = await token();
      if (!accessToken) return;
      try {
        await client.deleteSite(accessToken, id);
        // Deleting the open site leaves the document on screen but unbound, so
        // the next edit does not try to save into a row that is gone.
        if (boundSiteId === id) {
          set({ boundSiteId: null, boundRevision: 0, sync: { kind: 'off' } });
        }
        await get().refreshSites();
      } catch (error) {
        fail(error);
      }
    },

    unbind() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = undefined;
      set({ boundSiteId: null, boundRevision: 0, sync: { kind: 'off' } });
    },

    queueSave(doc, name) {
      const { boundSiteId, sync } = get();
      if (!boundSiteId) return;
      // An unresolved conflict must not be papered over by the next keystroke.
      if (sync.kind === 'conflict') return;
      pending = { doc, name };
      if (timer === undefined) {
        timer = setTimeout(() => {
          timer = undefined;
          void push();
        }, PUSH_DELAY_MS);
      }
    },

    flushSave() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      void push();
    },

    async forceSave(doc, name) {
      const { client, boundSiteId } = get();
      if (!client || !boundSiteId) return;
      const accessToken = await token();
      if (!accessToken) return;
      set({ sync: { kind: 'saving' } });
      try {
        // Read the current revision and write over it: the user has been shown
        // the conflict and asked for their version to win.
        const current = await client.loadSite(accessToken, boundSiteId);
        const saved = await client.saveSite(accessToken, boundSiteId, current.revision, {
          doc,
          name,
        });
        set({ boundRevision: saved.revision, sync: { kind: 'saved', at: Date.now() } });
      } catch (error) {
        set({
          sync: {
            kind: 'error',
            message: error instanceof CloudError ? error.message : 'Could not save to the cloud.',
          },
        });
      }
    },

    async reloadFromCloud() {
      const { client, boundSiteId } = get();
      if (!client || !boundSiteId) return null;
      const accessToken = await token();
      if (!accessToken) return null;
      try {
        const record = await client.loadSite(accessToken, boundSiteId);
        set({ boundRevision: record.revision, sync: { kind: 'idle' } });
        return record.doc;
      } catch (error) {
        fail(error);
        return null;
      }
    },
  };
});

/**
 * Start pushing document changes to the cloud.
 *
 * A subscription rather than a hook so the editor's render path is untouched:
 * nothing about drawing the canvas should depend on whether a network write is
 * in flight. `queueSave` returns immediately when no cloud site is bound, which
 * is the common case, so the cost on every keystroke is one comparison.
 */
export function startCloudSync(): () => void {
  const unsubscribe = useEditor.subscribe((state, previous) => {
    if (state.doc === previous.doc) return;
    useAccount.getState().queueSave(state.doc, state.doc.name);
  });

  // A debounced push that has not fired yet would otherwise be lost on close.
  const flush = () => useAccount.getState().flushSave();
  window.addEventListener('beforeunload', flush);

  return () => {
    unsubscribe();
    window.removeEventListener('beforeunload', flush);
  };
}
