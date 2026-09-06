/**
 * Keeping someone signed in between visits.
 *
 * What is stored here is now only a *cache*, and that is the whole difference
 * from the previous version. The durable credential is Neon Auth's HTTP-only
 * cookie, which JavaScript cannot read at all; this holds the short-lived JWT
 * minted from it plus the user it belongs to, so the editor can render a signed
 * in state and make its first Data API call without a round trip.
 *
 * That removes the exposure the old design accepted. It kept a *refresh* token
 * in `localStorage` — a long-lived credential that a successful XSS would take
 * and could then use indefinitely. There is no refresh token any more: the
 * worst an attacker gets from this key is a JWT with minutes left on it, and
 * they cannot mint another without the cookie.
 *
 * The key is separate from the document: signing out must never risk the work,
 * and a corrupt session must never stop the editor loading. Every read is
 * therefore validated and a bad value discarded rather than thrown.
 */

import { needsRefresh, type CloudClient, type Session } from './client';

export const SESSION_KEY = 'altask:session:v1';

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<Session>;
  return (
    typeof s.accessToken === 'string' &&
    s.accessToken.length > 0 &&
    typeof s.expiresAt === 'number' &&
    Number.isFinite(s.expiresAt) &&
    typeof s.user === 'object' &&
    s.user !== null &&
    typeof (s.user as Session['user']).id === 'string' &&
    (s.user as Session['user']).id.length > 0
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
 * "Refreshing" is minting a new JWT from the cookie, so this succeeds exactly
 * when the cookie is still good. Doing it early avoids the case where a token
 * passes this check and expires in flight. A failure means the cookie is gone
 * or expired — the cache is cleared so the UI asks for a password rather than
 * looping on 401s from the Data API.
 */
export async function ensureFresh(
  client: CloudClient,
  session: Session | null,
): Promise<Session | null> {
  if (!session) return null;
  if (!needsRefresh(session)) return session;
  try {
    const next = await client.token(session.user);
    writeSession(next);
    return next;
  } catch {
    writeSession(null);
    return null;
  }
}
