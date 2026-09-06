/**
 * The cloud client, against Neon Auth and the Neon Data API.
 *
 * Exercised against a stub `fetch`, because the alternative is a client that is
 * only ever tested by hand against a live project — which is how the subtle
 * cases (a stale revision, a suspended project, an unverified email) reach a
 * user before they reach a test.
 */

import { describe, expect, it, vi } from 'vitest';

import { CloudError, createCloudClient, needsRefresh } from '../src/cloud/client';
import { createEmptyDoc } from '../src/core/doc';

const CONFIG = {
  authUrl: 'https://blokza.test/api/auth',
  dataUrl: 'https://ep-x.apirest.example.aws.neon.tech/neondb/rest/v1',
};

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

/**
 * A JWT with a real `exp`, unsigned.
 *
 * The client only ever reads the payload to learn when to fetch another one;
 * verification is the Data API's job and happens server-side against the
 * published JWKS. Signing these would test nothing the client does.
 */
function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'EdDSA', typ: 'JWT' })}.${b64(claims)}.signature`;
}

const NOW = 1_700_000_000_000;
const TOKEN = jwt({ sub: 'user-1', exp: Math.floor(NOW / 1000) + 3600 });
const USER = { id: 'user-1', email: 'a@b.co', name: 'A' };

describe('createCloudClient', () => {
  it('is null when the build has no project, so the editor stays local-only', () => {
    expect(createCloudClient(null)).toBeNull();
  });

  it('sends cookies on auth calls — the session is a cookie, not a stored token', async () => {
    const { client, calls } = clientWith([{ body: { token: 'sess', user: USER } }]);
    await client.signIn('a@b.co', 'pw');
    expect(calls[0].url).toBe('https://blokza.test/api/auth/sign-in/email');
    expect(calls[0].init.credentials).toBe('include');
  });

  it('sends the user JWT as a bearer on data calls, and no api key', async () => {
    const { client, calls } = clientWith([{ body: [] }]);
    await client.listSites(TOKEN);
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0].init.headers.apikey).toBeUndefined();
    expect(calls[0].url.startsWith(CONFIG.dataUrl)).toBe(true);
  });

  describe('signUp', () => {
    it('sends a name, because Neon Auth requires one', async () => {
      const { client, calls } = clientWith([{ body: { token: 't', user: USER } }]);
      await client.signUp('a@b.co', 'pw-123456', 'https://blokza.test/app/');
      const sent = JSON.parse(String(calls[0].init.body));
      expect(sent.email).toBe('a@b.co');
      expect(sent.password).toBe('pw-123456');
      expect(typeof sent.name).toBe('string');
      expect(sent.name.length).toBeGreaterThan(0);
    });

    it('derives the name from the address rather than asking for one', async () => {
      const { client, calls } = clientWith([{ body: { token: 't', user: USER } }]);
      await client.signUp('ada.lovelace@example.com', 'pw-123456');
      expect(JSON.parse(String(calls[0].init.body)).name).toBe('ada.lovelace');
    });

    it('passes the confirmation landing page as callbackURL', async () => {
      const { client, calls } = clientWith([{ body: { token: 't', user: USER } }]);
      await client.signUp('a@b.co', 'pw-123456', 'https://blokza.test/app/');
      expect(JSON.parse(String(calls[0].init.body)).callbackURL).toBe('https://blokza.test/app/');
    });

    it('reports the address already being taken in words a person can act on', async () => {
      const { client } = clientWith([
        { status: 422, body: { code: 'USER_ALREADY_EXISTS', message: 'User already exists' } },
      ]);
      await expect(client.signUp('a@b.co', 'pw-123456')).rejects.toMatchObject({
        kind: 'auth',
        message: expect.stringContaining('sign in instead'),
      });
    });
  });

  describe('session', () => {
    it('reads the expiry out of the JWT rather than trusting a wall clock', async () => {
      const { client } = clientWith([{ body: { token: TOKEN } }]);
      const session = await client.token({ id: 'user-1', email: 'a@b.co' });
      expect(session.accessToken).toBe(TOKEN);
      expect(session.expiresAt).toBe((Math.floor(NOW / 1000) + 3600) * 1000);
    });

    it('treats a token with no readable expiry as already expired', async () => {
      const { client } = clientWith([{ body: { token: 'not-a-jwt' } }]);
      const session = await client.token({ id: 'user-1', email: 'a@b.co' });
      expect(needsRefresh(session, NOW)).toBe(true);
    });

    it('refreshes early, so a token cannot expire in flight', () => {
      const session = { accessToken: TOKEN, expiresAt: NOW + 30_000, user: { id: 'u', email: '' } };
      expect(needsRefresh(session, NOW)).toBe(true);
      expect(needsRefresh({ ...session, expiresAt: NOW + 600_000 }, NOW)).toBe(false);
    });

    it('returns null for a signed-out visitor rather than throwing', async () => {
      const { client } = clientWith([{ body: null }]);
      expect(await client.getSession()).toBeNull();
    });

    it('reads the user out of a live session', async () => {
      const { client } = clientWith([{ body: { session: { id: 's' }, user: USER } }]);
      expect(await client.getSession()).toEqual({ id: 'user-1', email: 'a@b.co' });
    });
  });

  describe('sites', () => {
    it('never names an owner — the column defaults from the JWT', async () => {
      const doc = createEmptyDoc('Site');
      const { client, calls } = clientWith([
        { body: [{ id: 's1', name: 'Site', revision: 1, updated_at: '2026-01-01' }] },
      ]);
      await client.createSite(TOKEN, 'Site', doc);
      expect(String(calls[0].init.body)).not.toContain('owner');
    });

    it('reports a stale revision as a conflict, not a server error', async () => {
      const { client } = clientWith([{ body: [] }]);
      await expect(
        client.saveSite(TOKEN, 's1', 3, { name: 'x' }),
      ).rejects.toMatchObject({ kind: 'conflict' });
    });

    it('filters the update on the revision the caller last saw', async () => {
      const { client, calls } = clientWith([
        { body: [{ id: 's1', name: 'x', revision: 4, updated_at: '2026-01-01' }] },
      ]);
      await client.saveSite(TOKEN, 's1', 3, { name: 'x' });
      expect(calls[0].url).toContain('revision=eq.3');
    });

    it('says so plainly when a site has gone', async () => {
      const { client } = clientWith([{ body: [] }]);
      await expect(client.loadSite(TOKEN, 'gone')).rejects.toMatchObject({ kind: 'notFound' });
    });
  });

  describe('failures', () => {
    it('turns a dead network into an explanation, not "Failed to fetch"', async () => {
      const { client } = clientWith([{ throws: new TypeError('Failed to fetch') }]);
      await expect(client.listSites(TOKEN)).rejects.toMatchObject({ kind: 'offline' });
      await expect(client.listSites(TOKEN)).rejects.toThrow(/connection|suspended/i);
    });

    it('files a rejected sign-in under auth even though it answers 401', async () => {
      const { client } = clientWith([
        { status: 401, body: { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' } },
      ]);
      const error = await client.signIn('a@b.co', 'nope').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CloudError);
      expect((error as CloudError).kind).toBe('auth');
      expect((error as CloudError).message).toMatch(/do not match/i);
    });

    it('tells an unverified user to check their inbox', async () => {
      const { client } = clientWith([
        { status: 403, body: { code: 'EMAIL_NOT_VERIFIED', message: 'Email not verified' } },
      ]);
      await expect(client.signIn('a@b.co', 'pw')).rejects.toThrow(/inbox|confirm/i);
    });

    it('forgets the session even when signing out fails', async () => {
      const { client } = clientWith([{ status: 500, body: { message: 'boom' } }]);
      await expect(client.signOut()).resolves.toBeUndefined();
    });
  });
});
