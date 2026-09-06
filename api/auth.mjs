/**
 * Neon Auth, served from this site's own origin.
 *
 * This is a proxy, and it exists for exactly one reason: cookies.
 *
 * Neon Auth keeps the session in an HTTP-only cookie. Called directly on its
 * `*.neon.tech` hostname that cookie is third-party to blokza.com — Safari
 * blocks those outright and Chrome is phasing them out, so a visitor would sign
 * in, watch the page reload, and be signed out again with nothing on screen to
 * explain why. Neon's own roadmap lists "standalone frontend + backend" as not
 * yet supported for the same reason.
 *
 * Routing the calls through `/api/auth/*` makes the cookie first-party, which
 * is a thing the browser has no objection to at all. The site keeps its
 * static-hosting shape; this one function is the entire server.
 *
 * Plain JavaScript rather than TypeScript on purpose: the repository root has
 * no `package.json`, and adding one — plus `@vercel/node` for types, plus a
 * build step — to type a sixty-line proxy would cost more than it explains.
 *
 * `.mjs` rather than `.js` for the same reason there is no package.json: with
 * nothing declaring `"type": "module"`, a `.js` file here is CommonJS, and this
 * one is not. Recent Node sniffs the syntax and gets it right anyway, which is
 * precisely the problem — it would work locally and depend on the runtime
 * version in production. The extension says it outright.
 *
 * A plain file rather than a `[...all]` catch-all, reached through a rewrite in
 * `vercel.json`. The catch-all deployed and served one segment — `/api/auth/ok`
 * answered — but 404'd at the edge on anything deeper, so `/sign-in/email` and
 * `/.well-known/jwks.json` never reached this code. The rewrite hands the
 * sub-path over in `__path`, which leaves nothing about the routing implicit.
 *
 * Set `NEON_AUTH_URL` in the Vercel project (no `VITE_` prefix — this runs on
 * the server, and the value must not be inlined into the browser bundle).
 */

/**
 * Read per request, not once at module scope.
 *
 * A value captured at import time is frozen for the whole life of the warm
 * instance, so changing it in the Vercel dashboard would appear to do nothing
 * until something happened to force a cold start — and it makes the handler
 * impossible to exercise from a test, which is how the mistake would survive.
 */
function upstream() {
  return (process.env.NEON_AUTH_URL || '').replace(/\/+$/, '');
}

/**
 * Query parameter the rewrite carries the sub-path in. Deliberately ugly so it
 * cannot collide with anything Better Auth defines, and stripped before the
 * request goes upstream.
 */
const PATH_PARAM = '__path';

/**
 * Headers that describe *this* hop and must not be replayed onto the next one.
 *
 * `host`: forwarding blokza.com's Host to Neon routes the request to nothing.
 *
 * `x-forwarded-host` cost a production debugging session. Vercel sets it to the
 * deployment's own hostname, Neon Auth validates it, and every proxied call came
 * back `{"code":"INVALID_HOSTNAME"}` — with the auth endpoint itself perfectly
 * healthy. `forwarded` (RFC 7239) carries the same thing in a different shape,
 * so it goes too.
 *
 * `x-forwarded-for` and `x-forwarded-proto` are deliberately NOT here. Neon
 * rate-limits by client IP; dropping it would collapse every visitor onto
 * Vercel's egress address, where one abuser throttles everybody.
 */
const HOP_BY_HOP = new Set([
  'host',
  'x-forwarded-host',
  'forwarded',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'content-length',
]);

/**
 * Platform internals. Nothing upstream needs to know the deployment id or the
 * request's route through Vercel, and a third party has no business being told.
 */
function isPlatformHeader(name) {
  return name.startsWith('x-vercel-');
}

/**
 * Rebind a cookie to this origin.
 *
 * Upstream sets `Domain=…neon.tech; SameSite=None`, which is right for the
 * hostname it was sent from and wrong here. Dropping `Domain` binds the cookie
 * to blokza.com — a host-only cookie, which is the narrower and better default
 * — and `SameSite=Lax` is now correct *and* stricter, because the request is no
 * longer cross-site. `Secure` and `HttpOnly` are left exactly as they came.
 */
function rebindCookie(cookie) {
  return cookie
    .split(/;\s*/)
    .filter((part) => !/^domain=/i.test(part))
    .map((part) => (/^samesite=/i.test(part) ? 'SameSite=Lax' : part))
    .join('; ');
}

async function rawBody(req) {
  // Vercel parses JSON bodies onto `req.body` and consumes the stream doing it,
  // so re-serialising is the only way to get those bytes back. Anything it did
  // not parse is still sitting in the stream.
  if (req.body !== undefined && req.body !== null) {
    return typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

export default async function handler(req, res) {
  const base = upstream();
  if (!base) {
    res.status(500).json({
      message: 'Auth is not configured on this deployment (NEON_AUTH_URL is unset).',
      code: 'AUTH_NOT_CONFIGURED',
    });
    return;
  }

  /*
   * Where upstream should be asked.
   *
   * `vercel.json` rewrites `/api/auth/:path*` here with the segments in
   * `__path`, because a bare rewrite would leave `req.url` pointing at this
   * function rather than at what the caller asked for. The fallback parses
   * `req.url` directly, which is what happens under `vite dev` — and would also
   * cover a future where the rewrite is dropped.
   */
  const asked = new URL(String(req.url || '/'), 'http://placeholder');
  const carried = asked.searchParams.get(PATH_PARAM);
  asked.searchParams.delete(PATH_PARAM);
  const path = carried
    ? `/${carried.replace(/^\/+/, '')}`
    : asked.pathname.replace(/^\/api\/auth/, '') || '/';
  const query = asked.searchParams.toString();
  const target = `${base}${path}${query ? `?${query}` : ''}`;

  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    const key = name.toLowerCase();
    if (HOP_BY_HOP.has(key) || isPlatformHeader(key) || value === undefined) continue;
    headers[name] = Array.isArray(value) ? value.join(', ') : value;
  }

  let response;
  try {
    response = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await rawBody(req),
      // Never follow. `/verify-email` answers 302 to the callback URL, and the
      // browser has to be the one that follows it — otherwise the redirect is
      // swallowed here and the visitor lands on a blank proxy response with
      // their freshly-set cookie going nowhere.
      redirect: 'manual',
    });
  } catch (error) {
    res.status(502).json({
      message: 'Could not reach the authentication service. Try again in a moment.',
      code: 'AUTH_UPSTREAM_UNREACHABLE',
      detail: String(error && error.message ? error.message : error),
    });
    return;
  }

  // `getSetCookie` keeps multiple cookies separate; joining and re-splitting on
  // commas would corrupt any `Expires=` date, which contains one.
  const cookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [];
  if (cookies.length) res.setHeader('Set-Cookie', cookies.map(rebindCookie));

  response.headers.forEach((value, name) => {
    const key = name.toLowerCase();
    if (key === 'set-cookie' || HOP_BY_HOP.has(key)) return;
    // The upstream CORS headers describe its origin, not ours. Same-origin
    // requests need none of them, and passing them through only invites a
    // browser to disagree with a header it did not need in the first place.
    if (key.startsWith('access-control-')) return;
    if (key === 'content-encoding') return; // fetch already decoded the body
    res.setHeader(name, value);
  });

  res.status(response.status);
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}
