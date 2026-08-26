/**
 * A small Supabase client: auth plus one table.
 *
 * Hand-written rather than `@supabase/supabase-js` because this app needs six
 * HTTP calls, and the SDK would add roughly a third to a bundle that already
 * warns about its size. Everything here is plain REST against GoTrue
 * (`/auth/v1`) and PostgREST (`/rest/v1`).
 *
 * `fetch` is injectable so the whole surface can be tested without a network or
 * a project, which is the only way any of this gets exercised in CI.
 */

import type { SiteDoc } from '../core/types';
import { cloudConfig, type CloudConfig } from './config';

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
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

/** Refresh this long before the token actually expires. */
const REFRESH_MARGIN_MS = 60_000;

function friendlyAuthMessage(status: number, body: unknown): string {
  const raw =
    (body && typeof body === 'object'
      ? ((body as Record<string, unknown>).error_description ??
        (body as Record<string, unknown>).msg ??
        (body as Record<string, unknown>).message)
      : undefined) ?? '';
  const text = String(raw);
  // GoTrue's wording is accurate and unhelpful; these are the cases people hit.
  if (/invalid login credentials/i.test(text)) return 'That email and password do not match.';
  if (/email not confirmed/i.test(text)) return 'Check your inbox and confirm the address first.';
  if (/already registered|already been registered/i.test(text)) {
    return 'That email already has an account — sign in instead.';
  }
  if (/password should be at least/i.test(text)) return text;
  if (/rate limit|too many/i.test(text)) return 'Too many attempts. Wait a minute and try again.';
  if (status === 401 || status === 403) return 'Your session has expired. Sign in again.';
  return text || `Request failed (${status}).`;
}

export function createCloudClient(config: CloudConfig | null = cloudConfig(), doFetch?: Fetch) {
  if (!config) return null;
  // Bound to a const so it stays narrowed inside the closures below.
  const cfg: CloudConfig = config;
  const http: Fetch = doFetch ?? ((...args) => fetch(...args));

  async function call(
    path: string,
    init: RequestInit & { token?: string; prefer?: string; query?: string } = {},
  ): Promise<{ status: number; body: unknown }> {
    const headers: Record<string, string> = {
      apikey: cfg.anonKey,
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    };
    // Requests before sign-in still need a bearer token; the anon key is it.
    headers.Authorization = `Bearer ${init.token ?? cfg.anonKey}`;
    if (init.prefer) headers.Prefer = init.prefer;

    let response: Response;
    try {
      const url = init.query
        ? `${cfg.url}${path}${path.includes('?') ? '&' : '?'}${init.query}`
        : `${cfg.url}${path}`;
      response = await http(url, { ...init, headers });
    } catch (error) {
      // A rejected fetch is a transport failure — no network, DNS, CORS, or a
      // paused project. None of them are the user's fault, and all of them look
      // the same from here.
      // Deliberately not the browser's own wording: "Failed to fetch" tells a
      // user nothing, while a paused free-tier project — which looks exactly
      // like this — is the most likely cause and is one click to fix.
      void error;
      throw new CloudError(
        'Could not reach the server. Check your connection, or whether the project is paused.',
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
       * status. GoTrue answers a wrong password with 400, not 401, so keying
       * only on 401/403 filed bad credentials under "server error" and the
       * sign-in form had no reason to reappear.
       */
      const isAuthEndpoint = path.startsWith('/auth/v1');
      const kind =
        response.status === 401 || response.status === 403 || (isAuthEndpoint && response.status < 500)
          ? 'auth'
          : response.status === 404
            ? 'notFound'
            : 'server';
      throw new CloudError(friendlyAuthMessage(response.status, body), kind, response.status);
    }
    return { status: response.status, body };
  }

  function toSession(body: unknown): Session {
    const data = (body ?? {}) as Record<string, unknown>;
    const accessToken = String(data.access_token ?? '');
    const refreshToken = String(data.refresh_token ?? '');
    const user = (data.user ?? {}) as Record<string, unknown>;
    if (!accessToken || !refreshToken || !user.id) {
      throw new CloudError('The server did not return a usable session.', 'server');
    }
    const expiresIn = Number(data.expires_in ?? 3600);
    return {
      accessToken,
      refreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
      user: { id: String(user.id), email: String(user.email ?? '') },
    };
  }

  return {
    /**
     * Create an account.
     *
     * Returns no session when the project requires email confirmation, which is
     * a different outcome rather than a failure: the caller has to say "check
     * your email" instead of dropping the user into the editor.
     */
    async signUp(
      email: string,
      password: string,
      emailRedirectTo?: string,
    ): Promise<Session | null> {
      /*
       * `emailRedirectTo` decides where the confirmation link lands. Without it
       * GoTrue falls back to the project's Site URL, which is the marketing
       * homepage — so a visitor clicked "confirm", arrived on a page with an
       * access token sitting in the address bar, and nothing there could use it.
       * Sending them back to the editor they signed up from means the session in
       * that link is the session they end up with.
       *
       * The URL has to be on the project's Redirect URLs allow-list or GoTrue
       * silently uses Site URL instead.
       */
      const { body } = await call('/auth/v1/signup', {
        method: 'POST',
        body: JSON.stringify(
          emailRedirectTo ? { email, password, options: { email_redirect_to: emailRedirectTo } }
                          : { email, password },
        ),
        query: emailRedirectTo ? `redirect_to=${encodeURIComponent(emailRedirectTo)}` : undefined,
      });
      const data = (body ?? {}) as Record<string, unknown>;
      return data.access_token ? toSession(body) : null;
    },

    /**
     * Send the confirmation email again.
     *
     * The single most common way an email sign-up stalls: the first message goes
     * to spam, or expires while the person is doing something else, and without
     * this the only way forward is to try to sign up again and be told the
     * address is already taken.
     */
    async resendConfirmation(email: string, emailRedirectTo?: string): Promise<void> {
      await call('/auth/v1/resend', {
        method: 'POST',
        body: JSON.stringify({ type: 'signup', email }),
        query: emailRedirectTo ? `redirect_to=${encodeURIComponent(emailRedirectTo)}` : undefined,
      });
    },

    async signIn(email: string, password: string): Promise<Session> {
      const { body } = await call('/auth/v1/token?grant_type=password', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      return toSession(body);
    },

    async refresh(refreshToken: string): Promise<Session> {
      const { body } = await call('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      return toSession(body);
    },

    /** Best effort: a failure here still means the local session is discarded. */
    async signOut(token: string): Promise<void> {
      try {
        await call('/auth/v1/logout', { method: 'POST', token });
      } catch {
        /* the caller forgets the session regardless */
      }
    },

    async listSites(token: string): Promise<SiteSummary[]> {
      const { body } = await call(
        '/rest/v1/sites?select=id,name,revision,updated_at&order=updated_at.desc',
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
      const { body } = await call(
        `/rest/v1/sites?id=eq.${encodeURIComponent(id)}&select=id,name,doc,revision,updated_at`,
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
      // `owner` is deliberately absent: the column defaults to `auth.uid()`, so
      // the browser cannot even name a different owner.
      const { body } = await call('/rest/v1/sites?select=id,name,doc,revision,updated_at', {
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
      const { body } = await call(
        `/rest/v1/sites?id=eq.${encodeURIComponent(id)}&revision=eq.${revision}` +
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
      await call(`/rest/v1/sites?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', token });
    },
  };
}

export type CloudClient = NonNullable<ReturnType<typeof createCloudClient>>;

/** True when the token is expired, or close enough that a call would race it. */
export function needsRefresh(session: Session, now = Date.now()): boolean {
  return session.expiresAt - REFRESH_MARGIN_MS <= now;
}
