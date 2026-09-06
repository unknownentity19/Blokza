/**
 * The auth proxy — `api/auth/[...all].mjs`.
 *
 * It is the only server-side code in the project and the only thing that
 * touches cookies, so the parts worth pinning down are the security-relevant
 * ones: that a session cookie is rebound to this origin, that a redirect is
 * handed to the browser rather than followed here, and that nothing describing
 * the upstream hop is replayed onto the reply.
 *
 * `fetch` is stubbed. A test that reached the real endpoint would be a slow
 * test of Neon's uptime rather than a fast test of this file.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// @ts-expect-error — plain JS, deliberately untyped: the repository root has no
// package.json and typing a sixty-line proxy is not worth adding one.
import handler from '../../api/auth/[...all].mjs';

const UPSTREAM = 'https://ep-test.neonauth.example.aws.neon.tech/neondb/auth';

interface Captured {
  url: string;
  init: RequestInit;
}

function stubFetch(reply: {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  setCookie?: string[];
}) {
  const seen: Captured[] = [];
  const doFetch = vi.fn(async (url: unknown, init: unknown) => {
    seen.push({ url: String(url), init: (init ?? {}) as RequestInit });
    const headers = new Headers(reply.headers ?? {});
    for (const cookie of reply.setCookie ?? []) headers.append('set-cookie', cookie);
    return {
      status: reply.status ?? 200,
      headers,
      arrayBuffer: async () => new TextEncoder().encode(reply.body ?? '').buffer,
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', doFetch);
  return seen;
}

function fakeReq(method: string, url: string, headers: Record<string, string> = {}, body?: unknown) {
  const req = { method, url, headers: { host: 'blokza.com', ...headers }, body } as Record<string, unknown>;
  // The handler falls back to reading the stream when `body` is absent.
  (req as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] = async function* () {};
  return req;
}

function fakeRes() {
  const out = { code: 0, headers: {} as Record<string, unknown>, body: '' };
  return {
    out,
    status(code: number) { out.code = code; return this; },
    setHeader(key: string, value: unknown) { out.headers[key.toLowerCase()] = value; },
    json(payload: unknown) { out.code = out.code || 200; out.body = JSON.stringify(payload); },
    end(buf?: Uint8Array) { out.body = buf ? Buffer.from(buf).toString('utf8') : ''; },
  };
}

async function call(method: string, url: string, opts: {
  headers?: Record<string, string>;
  body?: unknown;
  reply?: Parameters<typeof stubFetch>[0];
} = {}) {
  const seen = stubFetch(opts.reply ?? {});
  const res = fakeRes();
  await handler(fakeReq(method, url, opts.headers, opts.body), res);
  return { ...res.out, seen };
}

beforeEach(() => {
  process.env.NEON_AUTH_URL = UPSTREAM;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEON_AUTH_URL;
});

describe('the auth proxy', () => {
  it('rewrites /api/auth/* onto the upstream path, query and all', async () => {
    const { seen } = await call('GET', '/api/auth/verify-email?token=abc&callbackURL=%2Fapp%2F');
    expect(seen[0].url).toBe(`${UPSTREAM}/verify-email?token=abc&callbackURL=%2Fapp%2F`);
  });

  /**
   * The cookie is the entire reason this file exists. Upstream sets it for its
   * own hostname with `SameSite=None`, which is right there and wrong here:
   * dropping `Domain` binds it to this host only, and the request is no longer
   * cross-site so `Lax` is both correct and stricter. `HttpOnly` and `Secure`
   * must survive untouched.
   */
  it('rebinds the session cookie to this origin', async () => {
    const { headers } = await call('POST', '/api/auth/sign-in/email', {
      reply: {
        setCookie: [
          '__Secure-session=abc; Path=/; Domain=.neon.tech; HttpOnly; Secure; SameSite=None',
        ],
      },
    });
    const [cookie] = headers['set-cookie'] as string[];
    expect(cookie).not.toMatch(/domain=/i);
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('__Secure-session=abc');
  });

  /**
   * Joining cookies on commas and re-splitting corrupts any `Expires=` date,
   * which contains one — so two cookies must stay two.
   */
  it('keeps multiple cookies separate', async () => {
    const { headers } = await call('POST', '/api/auth/sign-in/email', {
      reply: {
        setCookie: [
          'a=1; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly',
          'b=2; Path=/; HttpOnly',
        ],
      },
    });
    const cookies = headers['set-cookie'] as string[];
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain('Expires=Wed, 21 Oct 2026 07:28:00 GMT');
  });

  /**
   * `/verify-email` answers 302 to the callback URL. Following it here would
   * swallow the redirect and land the visitor on a blank proxy response with a
   * freshly-set cookie going nowhere.
   */
  it('hands a redirect to the browser instead of following it', async () => {
    const { code, headers, seen } = await call('GET', '/api/auth/verify-email?token=abc', {
      reply: { status: 302, headers: { location: 'https://blokza.com/app/?confirmed=1' } },
    });
    expect(seen[0].init.redirect).toBe('manual');
    expect(code).toBe(302);
    expect(headers.location).toBe('https://blokza.com/app/?confirmed=1');
  });

  it('forwards the Origin, because upstream rejects a request without one', async () => {
    const { seen } = await call('POST', '/api/auth/sign-in/email', {
      headers: { origin: 'https://blokza.com', cookie: 'session=x' },
    });
    const sent = seen[0].init.headers as Record<string, string>;
    expect(sent.origin).toBe('https://blokza.com');
    expect(sent.cookie).toBe('session=x');
  });

  /** Forwarding this host's Host header routes the upstream request to nothing. */
  it('does not replay hop-by-hop headers onto the next hop', async () => {
    const { seen } = await call('POST', '/api/auth/sign-in/email', {
      headers: { connection: 'keep-alive', 'content-length': '42' },
    });
    const sent = seen[0].init.headers as Record<string, string>;
    expect(sent.host).toBeUndefined();
    expect(sent.connection).toBeUndefined();
    expect(sent['content-length']).toBeUndefined();
  });

  /**
   * Found in production, not in a test: Vercel adds `x-forwarded-host` with its
   * own hostname, Neon Auth validates that header, and every proxied call came
   * back `INVALID_HOSTNAME`. It describes this hop, so it must not describe the
   * next one. `x-forwarded-for` and `-proto` are deliberately kept — Neon
   * rate-limits by client IP, and collapsing every user onto Vercel's egress
   * address would make one abuser throttle everyone.
   */
  it('strips the forwarding headers that describe this hop', async () => {
    const { seen } = await call('POST', '/api/auth/sign-in/email', {
      headers: {
        'x-forwarded-host': 'blokza.vercel.app',
        'x-forwarded-for': '1.2.3.4',
        'x-forwarded-proto': 'https',
        forwarded: 'host=blokza.vercel.app;proto=https',
        'x-vercel-id': 'sin1::abc123',
        'x-vercel-deployment-url': 'blokza-xyz.vercel.app',
      },
    });
    const sent = seen[0].init.headers as Record<string, string>;
    expect(sent['x-forwarded-host']).toBeUndefined();
    expect(sent.forwarded).toBeUndefined();
    expect(sent['x-vercel-id']).toBeUndefined();
    expect(sent['x-vercel-deployment-url']).toBeUndefined();
    // but the client's identity survives, because upstream throttles on it
    expect(sent['x-forwarded-for']).toBe('1.2.3.4');
    expect(sent['x-forwarded-proto']).toBe('https');
  });

  it('does not replay the upstream CORS headers onto a same-origin reply', async () => {
    const { headers } = await call('GET', '/api/auth/ok', {
      reply: { headers: { 'access-control-allow-origin': 'https://elsewhere.example' } },
    });
    expect(Object.keys(headers).some((h) => h.startsWith('access-control-'))).toBe(false);
  });

  it('preserves the upstream status rather than flattening it to 500', async () => {
    const { code, body } = await call('POST', '/api/auth/sign-in/email', {
      reply: { status: 401, body: '{"code":"INVALID_EMAIL_OR_PASSWORD"}' },
    });
    expect(code).toBe(401);
    expect(body).toContain('INVALID_EMAIL_OR_PASSWORD');
  });

  it('says so plainly when the deployment has no auth URL', async () => {
    delete process.env.NEON_AUTH_URL;
    const { code, body } = await call('GET', '/api/auth/ok');
    expect(code).toBe(500);
    expect(body).toContain('AUTH_NOT_CONFIGURED');
  });

  it('answers 502, not a crash, when the auth service is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const res = fakeRes();
    await handler(fakeReq('GET', '/api/auth/ok'), res);
    expect(res.out.code).toBe(502);
    expect(res.out.body).toContain('AUTH_UPSTREAM_UNREACHABLE');
  });
});
