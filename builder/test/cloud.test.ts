/**
 * The cloud client.
 *
 * Exercised against a stub `fetch`, because the alternative is a client that is
 * only ever tested by hand against a live project — which is how the subtle
 * cases (a stale revision, a paused project, an unconfirmed email) reach a user
 * before they reach a test.
 */

import { describe, expect, it, vi } from 'vitest';

import { CloudError, createCloudClient, needsRefresh } from '../src/cloud/client';
import { createEmptyDoc } from '../src/core/doc';

const CONFIG = { url: 'https://project.supabase.co', anonKey: 'anon-key-123' };

interface Reply {
  status?: number;
  body?: unknown;
  /** Reject instead of replying, the way a dead network does. */
  throws?: Error;
}

/** A stub `fetch` that replies in order and records what it was asked. */
function stub(replies: Reply[]) {
  const calls: { url: string; init: RequestInit & { headers: Record<string, string> } }[] = [];
  let i = 0;
  const doFetch = vi.fn(async (url: unknown, init: unknown) => {
    calls.push({
      url: String(url),
      init: (init ?? {}) as RequestInit & { headers: Record<string, string> },
    });
    const reply = replies[Math.min(i, replies.length - 1)];
    i += 1;
    if (reply.throws) throw reply.throws;
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (reply.body === undefined ? '' : JSON.stringify(reply.body)),
    } as unknown as Response;
  });
  return { calls, doFetch: doFetch as unknown as typeof fetch };
}

function clientWith(replies: Reply[]) {
  const s = stub(replies);
  const client = createCloudClient(CONFIG, s.doFetch);
  if (!client) throw new Error('client should exist for a configured project');
  return { client, ...s };
}

const SESSION_BODY = {
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expires_in: 3600,
  user: { id: 'user-1', email: 'a@b.co' },
};

describe('createCloudClient', () => {
  it('is null when the build has no project, so the editor stays local-only', () => {
    expect(createCloudClient(null)).toBeNull();
  });

  it('sends the anon key on every request and the user token once signed in', async () => {
    const { client, calls } = clientWith([{ body: SESSION_BODY }, { body: [] }]);
    await client.signIn('a@b.co', 'pw');
    await client.listSites('access-1');

    expect(calls[0].init.headers.apikey).toBe('anon-key-123');
    // Before sign-in the anon key is also the bearer; afterwards the user's is.
    expect(calls[0].init.headers.Authorization).toBe('Bearer anon-key-123');
    expect(calls[1].init.headers.Authorization).toBe('Bearer access-1');
  });

  it('turns a token response into a session with an absolute expiry', async () => {
    const { client } = clientWith([{ body: SESSION_BODY }]);
    const before = Date.now();
    const session = await client.signIn('a@b.co', 'pw');
    expect(session.user).toEqual({ id: 'user-1', email: 'a@b.co' });
    expect(session.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000 - 50);
  });

  it('reports a sign-up that needs email confirmation as "no session", not failure', async () => {
    const { client } = clientWith([{ body: { user: { id: 'u', email: 'a@b.co' } } }]);
    await expect(client.signUp('a@b.co', 'pw')).resolves.toBeNull();
  });

  it('translates the credentials error into something worth reading', async () => {
    const { client } = clientWith([
      { status: 400, body: { error_description: 'Invalid login credentials' } },
    ]);
    await expect(client.signIn('a@b.co', 'wrong')).rejects.toMatchObject({
      kind: 'auth',
      message: 'That email and password do not match.',
    });
  });

  it('calls a dead network offline rather than blaming the user', async () => {
    const { client } = clientWith([{ throws: new TypeError('Failed to fetch') }]);
    const error = await client.signIn('a@b.co', 'pw').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudError);
    expect((error as CloudError).kind).toBe('offline');
    // Names the likely cause instead of repeating the browser's "Failed to fetch".
    expect((error as CloudError).message).toContain('paused');
    expect((error as CloudError).message).not.toContain('Failed to fetch');
  });

  it('never sends an owner when creating a site — the column defaults from the JWT', async () => {
    const doc = createEmptyDoc('Cloud test');
    const { client, calls } = clientWith([
      { status: 201, body: [{ id: 'site-1', name: 'Cloud test', revision: 1, updated_at: 'now' }] },
    ]);
    await client.createSite('access-1', 'Cloud test', doc);
    const sent = JSON.parse(String(calls[0].init.body));
    expect(Object.keys(sent).sort()).toEqual(['doc', 'name']);
    expect(sent.owner).toBeUndefined();
  });

  describe('saving against a revision', () => {
    it('filters the update by the revision it last saw', async () => {
      const doc = createEmptyDoc('Cloud test');
      const { client, calls } = clientWith([
        { body: [{ id: 'site-1', name: 'S', revision: 8, updated_at: 'now' }] },
      ]);
      const saved = await client.saveSite('access-1', 'site-1', 7, { doc });
      expect(calls[0].url).toContain('id=eq.site-1');
      expect(calls[0].url).toContain('revision=eq.7');
      expect(saved.revision).toBe(8);
    });

    /**
     * The important case. PostgREST returns an empty array when the filter
     * matches nothing, which is exactly what a stale revision produces — so an
     * empty result is a conflict, not a success with no data. Reading it as
     * success is how another device's work gets silently overwritten.
     */
    it('reads an empty result as a conflict rather than a successful save', async () => {
      const doc = createEmptyDoc('Cloud test');
      const { client } = clientWith([{ body: [] }]);
      const error = await client
        .saveSite('access-1', 'site-1', 7, { doc })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CloudError);
      expect((error as CloudError).kind).toBe('conflict');
      expect((error as CloudError).status).toBe(409);
    });
  });

  it('treats a missing site as missing, not as an empty document', async () => {
    const { client } = clientWith([{ body: [] }]);
    await expect(client.loadSite('access-1', 'gone')).rejects.toMatchObject({ kind: 'notFound' });
  });

  it('forgets the session even when the logout call fails', async () => {
    const { client } = clientWith([{ status: 500, body: { msg: 'boom' } }]);
    await expect(client.signOut('access-1')).resolves.toBeUndefined();
  });
});

describe('needsRefresh', () => {
  const session = {
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: 10_000_000,
    user: { id: 'u', email: 'e' },
  };

  it('is false well before expiry', () => {
    expect(needsRefresh(session, 10_000_000 - 5 * 60_000)).toBe(false);
  });

  it('is true inside the margin, so a call cannot race the expiry', () => {
    expect(needsRefresh(session, 10_000_000 - 30_000)).toBe(true);
  });

  it('is true once expired', () => {
    expect(needsRefresh(session, 10_000_001)).toBe(true);
  });
});

describe('email sign-up', () => {
  /**
   * Without a redirect the confirmation link goes to the project's Site URL,
   * which is the marketing homepage — a page that cannot use the session the
   * link carries. So the target has to reach GoTrue, and it goes in the query
   * string, not just the body.
   */
  it('sends the confirmation link back to the page that asked for it', async () => {
    const { client, calls } = clientWith([{ body: { user: { id: 'u', email: 'a@b.co' } } }]);
    await client.signUp('a@b.co', 'pw', 'https://saaswise.dev/app/');
    expect(calls[0].url).toContain('redirect_to=https%3A%2F%2Fsaaswise.dev%2Fapp%2F');
  });

  it('omits the redirect entirely when there is none, rather than sending an empty one', async () => {
    const { client, calls } = clientWith([{ body: { user: { id: 'u', email: 'a@b.co' } } }]);
    await client.signUp('a@b.co', 'pw');
    expect(calls[0].url).not.toContain('redirect_to');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ email: 'a@b.co', password: 'pw' });
  });

  it('can send the confirmation again for an address that has not confirmed', async () => {
    const { client, calls } = clientWith([{ body: {} }]);
    await client.resendConfirmation('a@b.co', 'https://saaswise.dev/app/');
    expect(calls[0].url).toContain('/auth/v1/resend');
    expect(calls[0].url).toContain('redirect_to=');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ type: 'signup', email: 'a@b.co' });
  });

  it('reports a resend that was rate limited in words worth reading', async () => {
    const { client } = clientWith([
      { status: 429, body: { error_description: 'For security purposes, rate limit exceeded' } },
    ]);
    const error = await client.resendConfirmation('a@b.co').catch((e: unknown) => e);
    expect((error as CloudError).kind).toBe('auth');
    expect((error as CloudError).message).toMatch(/wait a minute|too many/i);
  });
});
