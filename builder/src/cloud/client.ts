/**
 * A small Neon client: auth plus one table.
 *
 * Hand-written rather than `@neondatabase/neon-js` because this app needs eight
 * HTTP calls, and the SDK would add to a bundle that already warns about its
 * size. Everything here is plain REST against Neon Auth (Better Auth, proxied
 * through this site's own `/api/auth`) and the Neon Data API (PostgREST).
 *
 * Two things differ from the Supabase client this replaces, and both shape the
 * code below:
 *
 *   - The session is an HTTP-only cookie, not a token pair. There is no refresh
 *     token to store, because there is nothing the browser could do with one:
 *     the cookie authenticates the call to `/token`, and `/token` mints the
 *     short-lived JWT the Data API wants. "Refreshing" is just asking again.
 *
 *   - That JWT is Ed25519-signed and verified by the Data API against Neon's
 *     published JWKS. Nothing here verifies it; the payload is read only to
 *     learn when to ask for the next one.
 *
 * `fetch` is injectable so the whole surface can be tested without a network or
 * a project, which is the only way any of this gets exercised in CI.
 */

import type { SiteDoc } from '../core/types';
import { cloudConfig, type CloudConfig } from './config';

export interface Session {
  /** Short-lived JWT from Neon Auth's `/token`, sent to the Data API. */
  accessToken: string;
  /** Epoch milliseconds, read from the JWT's own `exp`. */
  expiresAt: number;
  user: { id: string; email: string };
}

export interface SiteSummary {
  id: string;
  name: string;
  revision: number;
  updatedAt: string;
}

export interface SiteRecord extends SiteSummary {
  doc: SiteDoc;
}

/**
 * A failure worth showing someone.
 *
 * `kind` exists so callers can react without matching on prose: a conflict
 * needs a choice from the user, an offline error needs a retry, and bad
 * credentials need the form again.
 */
export class CloudError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'conflict' | 'offline' | 'notFound' | 'server' = 'server',
    readonly status = 0,
  ) {
    super(message);
    this.name = 'CloudError';
  }
}

type Fetch = typeof fetch;

/** Fetch the next token this long before the current one actually expires. */
const REFRESH_MARGIN_MS = 60_000;

/**
 * When a JWT expires, in epoch milliseconds.
 *
 * Returns 0 — "already expired" — for anything unreadable, so a malformed token
 * is refetched rather than trusted until some far-future date. The signature is
 * deliberately ignored: verifying it here would prove nothing, because the
 * client is not the party the token is presented to.
 */
function expiryOf(token: string): number {
  try {
    const payload = token.split('.')[1];
    if (!payload) return 0;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/**
 * Neon Auth's wording is accurate and unhelpful; these are the cases people hit.
 *
 * Keyed on `code` rather than prose, because the code is the part of the
 * contract that is stable — the message is free to be reworded upstream, and
 * matching on it is how this kind of mapping silently stops working.
 */
function friendlyAuthMessage(status: number, body: unknown): string {
  const data = (body ?? {}) as Record<string, unknown>;
  const code = String(data.code ?? '');
  const text = String(data.message ?? '');

  switch (code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'That email and password do not match.';
    case 'EMAIL_NOT_VERIFIED':
      return 'Check your inbox and confirm the address first.';
    case 'USER_ALREADY_EXISTS':
      return 'That email already has an account — sign in instead.';
    case 'PASSWORD_TOO_SHORT':
      return 'Pick a longer password — at least 8 characters.';
    case 'PASSWORD_TOO_LONG':
      return 'That password is too long.';
    case 'INVALID_EMAIL':
      return 'That does not look like an email address.';
  }

  // Codes are not exhaustive, so a couple of shapes still need the prose.
  if (/rate limit|too many/i.test(text)) return 'Too many attempts. Wait a minute and try again.';
  if (status === 401 || status === 403) return 'Your session has expired. Sign in again.';
  return text || `Request failed (${status}).`;
}

/**
 * A display name for someone who was only asked for an email.
 *
 * Neon Auth requires a name on sign-up. Adding a third field to the form to
 * satisfy an API is the tail wagging the dog, so the local part of the address
 * stands in until the user changes it — which is what they would have typed
 * anyway, most of the time.
 */
function nameFromEmail(email: string): string {
  const local = email.split('@')[0]?.trim();
  return local && local.length > 0 ? local : 'Blokza user';
}

export function createCloudClient(config: CloudConfig | null = cloudConfig(), doFetch?: Fetch) {
  if (!config) return null;
  // Bound to a const so it stays narrowed inside the closures below.
  const cfg: CloudConfig = config;
  const http: Fetch = doFetch ?? ((...args) => fetch(...args));

  async function request(
    url: string,
    init: RequestInit & { headers: Record<string, string> },
    authEndpoint: boolean,
  ): Promise<{ status: number; body: unknown }> {
    let response: Response;
    try {
      response = await http(url, init);
    } catch (error) {
      // A rejected fetch is a transport failure — no network, DNS, CORS, or a
      // suspended project. None of them are the user's fault, and all of them
      // look the same from here.
      // Deliberately not the browser's own wording: "Failed to fetch" tells a
      // user nothing, while a scaled-to-zero project — which looks exactly like
      // this on the first request after an idle spell — is the likeliest cause
      // and resolves itself on a retry.
      void error;
      throw new CloudError(
        'Could not reach the server. Check your connection, or try again — an idle project takes a moment to wake.',
        'offline',
      );
    }

    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    if (!response.ok) {
      /*
       * Anything the auth endpoints reject is an auth problem, whatever the
       * status. Better Auth answers a wrong password with 401 but an existing
       * address with 422, so keying only on 401/403 would file "already
       * registered" under "server error" and the form would have no reason to
       * reappear.
       */
      const kind =
        response.status === 401 || response.status === 403 || (authEndpoint && response.status < 500)
          ? 'auth'
          : response.status === 404
            ? 'notFound'
            : 'server';
      throw new CloudError(friendlyAuthMessage(response.status, body), kind, response.status);
    }
    return { status: response.status, body };
  }

  /**
   * Call Neon Auth.
   *
   * `credentials: 'include'` is the whole mechanism: the session is a cookie,
   * so a call that omits it is anonymous no matter who is signed in.
   */
  async function auth(
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; body: unknown }> {
    return request(
      `${cfg.authUrl}${path}`,
      {
        ...init,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...((init.headers as Record<string, string>) ?? {}) },
      },
      true,
    );
  }

  /**
   * Call the Data API.
   *
   * No cookie is sent, and none would be accepted: authority here is the bearer
   * JWT and nothing else, which is what lets the Data API live on a different
   * origin from the site without any of the cookie problems that shaped `auth`.
   */
  async function data(
    path: string,
    init: RequestInit & { token: string; prefer?: string } = { token: '' },
  ): Promise<{ status: number; body: unknown }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${init.token}`,
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    };
    if (init.prefer) headers.Prefer = init.prefer;
    return request(`${cfg.dataUrl}${path}`, { ...init, credentials: 'omit', headers }, false);
  }

  function userOf(body: unknown): { id: string; email: string } | null {
    const data = (body ?? {}) as Record<string, unknown>;
    const user = (data.user ?? data) as Record<string, unknown>;
    if (!user || typeof user.id !== 'string' || !user.id) return null;
    return { id: user.id, email: String(user.email ?? '') };
  }

  return {
    /**
     * Create an account.
     *
     * Returns no session when the project requires email verification, which is
     * a different outcome rather than a failure: the caller has to say "check
     * your email" instead of dropping the user into the editor.
     */
    async signUp(
      email: string,
      password: string,
      callbackURL?: string,
    ): Promise<{ id: string; email: string } | null> {
      /*
       * `callbackURL` decides where the confirmation link lands. Without it
       * Better Auth falls back to its configured base URL, which is not this
       * site — so a visitor clicked "confirm" and arrived somewhere that could
       * do nothing with the session it had just created. Sending them back to
       * the editor they signed up from means the account they confirmed is the
       * account they end up signed into.
       */
      const { body } = await auth('/sign-up/email', {
        method: 'POST',
        body: JSON.stringify({
          name: nameFromEmail(email),
          email,
          password,
          ...(callbackURL ? { callbackURL } : {}),
        }),
      });
      // A session token in the reply means the project does not require
      // verification and the account is usable now. Its absence is not a
      // failure — it is the "check your inbox" path, and the caller has to say
      // so rather than dropping someone into an editor they cannot save from.
      const token = (body as Record<string, unknown> | null)?.token;
      return token ? userOf(body) : null;
    },

    /**
     * Send the verification email again.
     *
     * The single most common way an email sign-up stalls: the first message goes
     * to spam, or expires while the person is doing something else, and without
     * this the only way forward is to try to sign up again and be told the
     * address is already taken.
     */
    async resendConfirmation(email: string, callbackURL?: string): Promise<void> {
      await auth('/send-verification-email', {
        method: 'POST',
        body: JSON.stringify({ email, ...(callbackURL ? { callbackURL } : {}) }),
      });
    },

    async signIn(email: string, password: string): Promise<{ id: string; email: string } | null> {
      const { body } = await auth('/sign-in/email', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      return userOf(body);
    },

    /** The signed-in user, or null for a visitor. Never throws on "nobody". */
    async getSession(): Promise<{ id: string; email: string } | null> {
      try {
        const { body } = await auth('/get-session');
        return userOf(body);
      } catch (error) {
        // An expired or absent cookie is the normal case for a first visit, not
        // something to surface. A transport failure still is.
        if (error instanceof CloudError && error.kind === 'auth') return null;
        throw error;
      }
    },

    /**
     * Mint the JWT the Data API wants.
     *
     * This is what "refresh" means here: the cookie is the durable credential,
     * and every short-lived token is minted from it on demand.
     */
    async token(user: { id: string; email: string }): Promise<Session> {
      const { body } = await auth('/token');
      const accessToken = String((body as Record<string, unknown> | null)?.token ?? '');
      if (!accessToken) throw new CloudError('The server did not return a usable session.', 'auth');
      return { accessToken, expiresAt: expiryOf(accessToken), user };
    },

    /** Best effort: a failure here still means the local session is discarded. */
    async signOut(): Promise<void> {
      try {
        await auth('/sign-out', { method: 'POST' });
      } catch {
        /* the caller forgets the session regardless */
      }
    },

    async listSites(token: string): Promise<SiteSummary[]> {
      const { body } = await data(
        '/sites?select=id,name,revision,updated_at&order=updated_at.desc',
        { token },
      );
      const rows = Array.isArray(body) ? body : [];
      return rows.map((row) => {
        const r = row as Record<string, unknown>;
        return {
          id: String(r.id),
          name: String(r.name ?? 'Untitled site'),
          revision: Number(r.revision ?? 1),
          updatedAt: String(r.updated_at ?? ''),
        };
      });
    },

    async loadSite(token: string, id: string): Promise<SiteRecord> {
      const { body } = await data(
        `/sites?id=eq.${encodeURIComponent(id)}&select=id,name,doc,revision,updated_at`,
        { token },
      );
      const row = (Array.isArray(body) ? body[0] : undefined) as Record<string, unknown> | undefined;
      if (!row) throw new CloudError('That site is no longer there.', 'notFound', 404);
      return {
        id: String(row.id),
        name: String(row.name ?? 'Untitled site'),
        revision: Number(row.revision ?? 1),
        updatedAt: String(row.updated_at ?? ''),
        doc: row.doc as SiteDoc,
      };
    },

    async createSite(token: string, name: string, doc: SiteDoc): Promise<SiteRecord> {
      // `owner` is deliberately absent: the column defaults to `auth.user_id()`,
      // so the browser cannot even name a different owner.
      const { body } = await data('/sites?select=id,name,doc,revision,updated_at', {
        method: 'POST',
        token,
        prefer: 'return=representation',
        body: JSON.stringify({ name, doc }),
      });
      const row = (Array.isArray(body) ? body[0] : body) as Record<string, unknown>;
      return {
        id: String(row.id),
        name: String(row.name ?? name),
        revision: Number(row.revision ?? 1),
        updatedAt: String(row.updated_at ?? ''),
        doc,
      };
    },

    /**
     * Save, but only over the revision the caller last saw.
     *
     * PostgREST filters the update, so a stale revision matches no row and comes
     * back empty rather than overwriting. That empty result *is* the conflict
     * signal: another tab or device has saved since this one loaded, and the
     * user has to choose which version wins.
     */
    async saveSite(
      token: string,
      id: string,
      revision: number,
      patch: { doc?: SiteDoc; name?: string },
    ): Promise<SiteSummary> {
      const { body } = await data(
        `/sites?id=eq.${encodeURIComponent(id)}&revision=eq.${revision}` +
          '&select=id,name,revision,updated_at',
        { method: 'PATCH', token, prefer: 'return=representation', body: JSON.stringify(patch) },
      );
      const row = (Array.isArray(body) ? body[0] : body) as Record<string, unknown> | undefined;
      if (!row?.id) {
        throw new CloudError(
          'This site changed somewhere else since you opened it.',
          'conflict',
          409,
        );
      }
      return {
        id: String(row.id),
        name: String(row.name ?? ''),
        revision: Number(row.revision ?? revision + 1),
        updatedAt: String(row.updated_at ?? ''),
      };
    },

    async deleteSite(token: string, id: string): Promise<void> {
      await data(`/sites?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', token });
    },
  };
}

export type CloudClient = NonNullable<ReturnType<typeof createCloudClient>>;

/** True when the token is expired, or close enough that a call would race it. */
export function needsRefresh(session: Session, now = Date.now()): boolean {
  return session.expiresAt - REFRESH_MARGIN_MS <= now;
}
