/**
 * Keeping someone signed in between visits.
 *
 * The session lives in `localStorage` under its own key, separate from the
 * document: signing out must never risk the work, and a corrupt session must
 * never stop the editor loading. Every read is therefore validated and a bad
 * value is discarded rather than thrown.
 *
 * A refresh token in `localStorage` is the same exposure every browser app of
 * this shape accepts — a successful XSS would take it. The mitigation that
 * matters is upstream: no untrusted HTML reaches the page unsanitised (see
 * `core/sanitize.ts`), and the token only ever grants what row-level security
 * allows, which is one user's own rows.
 */

import { needsRefresh, type CloudClient, type Session } from './client';

export const SESSION_KEY = 'altask:session:v1';

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<Session>;
  return (
    typeof s.accessToken === 'string' &&
    s.accessToken.length > 0 &&
    typeof s.refreshToken === 'string' &&
    s.refreshToken.length > 0 &&
    typeof s.expiresAt === 'number' &&
    Number.isFinite(s.expiresAt) &&
    typeof s.user === 'object' &&
    s.user !== null &&
    typeof (s.user as Session['user']).id === 'string'
  );
}

export function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeSession(session: Session | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Private mode or a full quota. Staying signed in is a convenience; losing
    // it is not worth failing the operation the user actually asked for.
  }
}

/**
 * A session guaranteed usable for the next call, or null if it cannot be.
 *
 * Refreshing early avoids the case where a token passes this check and expires
 * in flight. A failed refresh means the stored token is spent — the session is
 * cleared so the UI asks for a password rather than looping on 401s.
 */
export async function ensureFresh(
  client: CloudClient,
  session: Session | null,
): Promise<Session | null> {
  if (!session) return null;
  if (!needsRefresh(session)) return session;
  try {
    const next = await client.refresh(session.refreshToken);
    writeSession(next);
    return next;
  } catch {
    writeSession(null);
    return null;
  }
}
