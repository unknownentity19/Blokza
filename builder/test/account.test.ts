/**
 * Cloud sync state.
 *
 * These pin the two properties that decide whether anyone loses work: a push
 * only happens for a site that is actually bound, and an unresolved conflict
 * stops pushing entirely rather than letting the next keystroke overwrite what
 * another device saved.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../src/registry';
import { CloudError, type CloudClient, type Session } from '../src/cloud/client';
import { SESSION_KEY } from '../src/cloud/session';
import { useAccount } from '../src/store/account';
import { createEmptyDoc } from '../src/core/doc';
import type { SiteDoc } from '../src/core/types';

function session(): Session {
  return {
    accessToken: 'access-1',
    // Far in the future, so nothing tries to mint another mid-test.
    expiresAt: Date.now() + 60 * 60 * 1000,
    user: { id: 'user-1', email: 'a@b.co' },
  };
}

/** A client recording what it was asked, with overridable behaviour per test. */
function fakeClient(overrides: Partial<CloudClient> = {}) {
  const saves: { id: string; revision: number; name?: string }[] = [];
  const base = {
    saveSite: vi.fn(async (_t: string, id: string, revision: number, patch: { name?: string }) => {
      saves.push({ id, revision, name: patch.name });
      return { id, name: patch.name ?? 'S', revision: revision + 1, updatedAt: 'now' };
    }),
    loadSite: vi.fn(async (_t: string, id: string) => ({
      id,
      name: 'S',
      revision: 9,
      updatedAt: 'now',
      doc: createEmptyDoc('Remote'),
    })),
    listSites: vi.fn(async () => []),
    createSite: vi.fn(async (_t: string, name: string, doc: SiteDoc) => ({
      id: 'new-site',
      name,
      revision: 1,
      updatedAt: 'now',
      doc,
    })),
    deleteSite: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    signIn: vi.fn(),
    signUp: vi.fn(),
    getSession: vi.fn(async () => ({ id: 'user-1', email: 'a@b.co' })),
    token: vi.fn(async () => session()),
  };
  return { client: { ...base, ...overrides } as unknown as CloudClient, saves, base };
}

const S = () => useAccount.getState();

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.removeItem(SESSION_KEY);
  S().unbind();
  useAccount.setState({ client: null, session: null, sites: [], error: null, notice: null });
});

afterEach(() => {
  S().unbind();
  vi.useRealTimers();
});

describe('queueSave', () => {
  it('does nothing at all when no cloud site is bound', async () => {
    const { client, base } = fakeClient();
    useAccount.setState({ client, session: session() });

    S().queueSave(createEmptyDoc('Local only'), 'Local only');
    await vi.advanceTimersByTimeAsync(10_000);

    expect(base.saveSite).not.toHaveBeenCalled();
    expect(S().sync.kind).toBe('off');
  });

  it('collapses a burst of edits into one push carrying the last document', async () => {
    const { client, saves, base } = fakeClient();
    useAccount.setState({
      client,
      session: session(),
      boundSiteId: 'site-1',
      boundRevision: 4,
      sync: { kind: 'idle' },
    });

    for (const name of ['one', 'two', 'three']) {
      S().queueSave(createEmptyDoc(name), name);
      await vi.advanceTimersByTimeAsync(200);
    }
    await vi.advanceTimersByTimeAsync(5_000);

    expect(base.saveSite).toHaveBeenCalledTimes(1);
    expect(saves[0]).toMatchObject({ id: 'site-1', revision: 4, name: 'three' });
  });

  it('advances the revision it will send next, so the following save is not a conflict', async () => {
    const { client, saves } = fakeClient();
    useAccount.setState({
      client,
      session: session(),
      boundSiteId: 'site-1',
      boundRevision: 4,
      sync: { kind: 'idle' },
    });

    S().queueSave(createEmptyDoc('first'), 'first');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(S().boundRevision).toBe(5);

    S().queueSave(createEmptyDoc('second'), 'second');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(saves.map((s) => s.revision)).toEqual([4, 5]);
    expect(S().sync.kind).toBe('saved');
  });
});

describe('a conflict', () => {
  /** Returns the overriding spy, not the base one it replaced. */
  function conflicting() {
    const saveSite = vi.fn(async () => {
      throw new CloudError('changed elsewhere', 'conflict', 409);
    });
    return { ...fakeClient({ saveSite }), saveSite };
  }

  it('is reported rather than retried, and leaves the local document alone', async () => {
    const { client } = conflicting();
    useAccount.setState({
      client,
      session: session(),
      boundSiteId: 'site-1',
      boundRevision: 4,
      sync: { kind: 'idle' },
    });

    S().queueSave(createEmptyDoc('mine'), 'mine');
    await vi.advanceTimersByTimeAsync(5_000);

    expect(S().sync.kind).toBe('conflict');
    // the revision is untouched: nothing was accepted
    expect(S().boundRevision).toBe(4);
  });

  /**
   * The property that prevents silent data loss. Once a conflict is known, the
   * next keystroke must not queue another push — the second attempt would race
   * the user's decision, and whichever landed last would win by accident.
   */
  it('stops further pushes until the user decides', async () => {
    const { client, saveSite } = conflicting();
    useAccount.setState({
      client,
      session: session(),
      boundSiteId: 'site-1',
      boundRevision: 4,
      sync: { kind: 'idle' },
    });

    S().queueSave(createEmptyDoc('mine'), 'mine');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(saveSite).toHaveBeenCalledTimes(1);

    for (const name of ['again', 'and again']) {
      S().queueSave(createEmptyDoc(name), name);
      await vi.advanceTimersByTimeAsync(5_000);
    }
    expect(saveSite).toHaveBeenCalledTimes(1);
  });

  it('resolves by overwriting from the revision the server actually holds', async () => {
    const { client, saves, base } = fakeClient();
    useAccount.setState({
      client,
      session: session(),
      boundSiteId: 'site-1',
      boundRevision: 4,
      sync: { kind: 'conflict' },
    });

    await S().forceSave(createEmptyDoc('mine'), 'mine');

    // It reads the current revision (9) rather than trusting its stale 4.
    expect(base.loadSite).toHaveBeenCalled();
    expect(saves[0].revision).toBe(9);
    expect(S().sync.kind).toBe('saved');
  });

  it('resolves the other way by handing back the remote document', async () => {
    const { client } = fakeClient();
    useAccount.setState({
      client,
      session: session(),
      boundSiteId: 'site-1',
      boundRevision: 4,
      sync: { kind: 'conflict' },
    });

    const remote = await S().reloadFromCloud();

    expect(remote?.name).toBe('Remote');
    expect(S().boundRevision).toBe(9);
    expect(S().sync.kind).toBe('idle');
  });
});

describe('signing out', () => {
  it('drops the session, the site list, and any queued push', async () => {
    const { client, base } = fakeClient();
    useAccount.setState({
      client,
      session: session(),
      boundSiteId: 'site-1',
      boundRevision: 4,
      sites: [{ id: 'site-1', name: 'S', revision: 4, updatedAt: 'now' }],
      sync: { kind: 'idle' },
    });
    localStorage.setItem(SESSION_KEY, JSON.stringify(session()));

    S().queueSave(createEmptyDoc('unsaved'), 'unsaved');
    await S().signOut();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(S().session).toBeNull();
    expect(S().sites).toEqual([]);
    expect(S().boundSiteId).toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    // the pending push must not fire against a signed-out account
    expect(base.saveSite).not.toHaveBeenCalled();
  });
});

describe('deleting the open site', () => {
  it('unbinds so the next edit does not save into a row that is gone', async () => {
    const { client } = fakeClient();
    useAccount.setState({
      client,
      session: session(),
      boundSiteId: 'site-1',
      boundRevision: 4,
      sync: { kind: 'idle' },
    });

    await S().deleteSite('site-1');

    expect(S().boundSiteId).toBeNull();
    expect(S().sync.kind).toBe('off');
  });
});

/**
 * The confirmation round trip.
 *
 * All of this is about the moment someone clicks the link in their inbox. Neon
 * Auth verifies the address and sets the cookie before redirecting, so the job
 * here is no longer to catch a credential out of the URL — it is to notice that
 * we arrived from a confirmation, ask the server who we now are, and say so.
 */
describe('completing an email confirmation', () => {
  /** Point the test at a URL as if we had just arrived from the email. */
  function arriveAt(search: string) {
    window.history.replaceState(null, '', `/app/${search}`);
  }

  it('picks the session up from the cookie and clears the marker from the URL', async () => {
    const { client, base } = fakeClient();
    useAccount.setState({ client });
    arriveAt('?confirmed=1');

    await S().restore();

    // Nothing was read out of the URL: the session came from asking the server
    // who the cookie belongs to.
    expect(base.getSession).toHaveBeenCalled();
    expect(S().session?.accessToken).toBe('access-1');
    expect(S().notice).toMatch(/confirmed/i);
    // the session is cached, so a reload does not cost another round trip
    expect(localStorage.getItem(SESSION_KEY)).toContain('access-1');
    // and the sites list was fetched with the new token
    expect(base.listSites).toHaveBeenCalled();
    // the marker is gone, so a refresh does not re-announce the confirmation
    expect(window.location.href).not.toContain('confirmed');
    expect(window.location.search).toBe('');
  });

  it('stays signed out when the cookie did not survive the redirect', async () => {
    const { client } = fakeClient({
      getSession: vi.fn(async () => null),
    } as Partial<CloudClient>);
    useAccount.setState({ client });
    arriveAt('?confirmed=1');

    await S().restore();

    expect(S().session).toBeNull();
    expect(S().restoring).toBe(false);
  });

  it('reports an expired link instead of appearing to work', async () => {
    const { client } = fakeClient();
    useAccount.setState({ client });
    arriveAt('?error=invalid_token&error_description=Token+is+invalid+or+has+expired');

    await S().restore();

    expect(S().session).toBeNull();
    expect(S().error).toMatch(/expired/i);
    expect(window.location.href).not.toContain('error');
  });

  it('leaves an ordinary visit alone, restoring a stored session as before', async () => {
    const { client } = fakeClient();
    localStorage.setItem(SESSION_KEY, JSON.stringify(session()));
    useAccount.setState({ client });
    arriveAt('');

    await S().restore();

    expect(S().session?.accessToken).toBe('access-1');
    expect(S().notice).toBeNull();
  });

  it('offers a resend only while an address is waiting, and stops once signed in', async () => {
    const resend = vi.fn(async () => undefined);
    const { client } = fakeClient({
      signUp: vi.fn(async () => null),
      resendConfirmation: resend,
      signIn: vi.fn(async () => ({ id: 'user-1', email: 'a@b.co' })),
    } as Partial<CloudClient>);
    useAccount.setState({ client });

    await S().signUp('new@b.co', 'pw-123456');
    expect(S().pendingEmail).toBe('new@b.co');

    await S().resendConfirmation();
    expect(resend).toHaveBeenCalledWith('new@b.co', expect.anything());

    await S().signIn('new@b.co', 'pw-123456');
    expect(S().pendingEmail).toBeNull();
  });
});
