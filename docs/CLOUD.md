# Accounts and cloud-saved sites

The editor works with no account at all: everything is saved in the browser it
was made in. Signing in adds one thing — the same site, from another browser or
another machine — and nothing else changes.

Identity and storage are both Neon: **Neon Auth** (Better Auth, managed) issues
the session, and the **Neon Data API** (PostgREST) holds one table.

## What you get

- Email and password sign-in, with a real confirmation email
- Sites saved to Postgres, one row each, readable only by their owner
- The editor stays local-first: `localStorage` is written on every edit, and
  the cloud is a second, slower sink

## Setup, once

### 1. Create the project

Neon Console → new project. Two things matter and one of them is permanent:

- **Region cannot be changed later.** The only way out is a new project and a
  `pg_dump`/`pg_restore` migration. Auth runs in the same region as the
  database, so this sets your sign-in latency for good.
- **Neon Auth must be toggled on.** It is off by default, and it is not offered
  in every region — if the toggle is greyed out, that is the region talking.

### 2. Run the schema

Paste `neon/schema.sql` into the Neon SQL editor and run it. It creates the
`sites` table, enables row-level security, and grants the `authenticated` role
exactly what it needs.

Read the comments in that file before changing it. The two that bite:

- `owner` is `text`, not `uuid`. Better Auth's user ids are nanoid-style
  strings, so `auth.uid()` — which parses the JWT's `sub` as a UUID — returns
  NULL for every one of them and every policy silently denies. `auth.user_id()`
  returns `sub` as text, which is what these ids actually are.
- The Data API refuses to expose a table with RLS disabled. That is the
  behaviour you want: a forgotten `enable row level security` fails closed.

### 3. Enable the Data API

Neon Console → Data API. Note the base URL; it looks like

```
https://ep-<id>.apirest.<region>.aws.neon.tech/neondb/rest/v1
```

### 4. Add your origins to Neon Auth

**The step that is easy to miss, and fails confusingly when you do.** Better
Auth rejects any state-changing request whose `Origin` it does not recognise —
you get `403 INVALID_ORIGIN`, which reads like a bug in the site rather than a
setting.

`localhost` is trusted out of the box, so local development works immediately
and the problem only appears once deployed. In Neon Console → Auth →
Configuration, add every origin the site is served from:

- `https://blokza.com`
- `https://www.blokza.com`, if you use it
- your Vercel preview domain

### 5. Configure the deployment

Two values, and they are not interchangeable.

**On Vercel**, as a project environment variable:

```
NEON_AUTH_URL=https://ep-<id>.neonauth.<region>.aws.neon.tech/neondb/auth
```

No `VITE_` prefix. This one is read by the serverless function in
`api/auth.mjs` and must *not* be inlined into the browser bundle.

**In `builder/.env.local`**, for the build:

```
VITE_NEON_DATA_URL=https://ep-<id>.apirest.<region>.aws.neon.tech/neondb/rest/v1
```

`VITE_NEON_AUTH_URL` is optional and usually wrong to set: it defaults to
`/api/auth`, this site's own proxy, which is the whole point (see below). Set it
only to run `vite dev` without `vercel dev`, pointing straight at Neon.

Neither value is a credential. The Neon **connection string** is — it carries a
password and full database authority, and it belongs in neither file.

## Why the auth calls go through this site

`api/auth.mjs` proxies `/api/auth/*` to Neon Auth. It exists for one
reason: the session is an HTTP-only cookie.

Called directly on its `*.neon.tech` hostname, that cookie is **third-party** to
blokza.com. Safari blocks third-party cookies outright and Chrome is phasing
them out, so a visitor would sign in, watch the page reload, and be signed out
again with nothing on screen to explain why. Neon's own roadmap lists
"standalone frontend + backend" as not yet supported, for exactly this reason.

Proxying through the site's own origin makes the cookie first-party, which no
browser objects to. The proxy also drops the cookie's `Domain` attribute — so it
binds to this host only — and tightens `SameSite=None` to `Lax`, which is now
both correct and stricter.

## How a session actually works

Worth knowing, because it is not the usual token pair:

- The **cookie** is the durable credential. JavaScript cannot read it.
- `GET /api/auth/token` mints a short-lived **JWT** from that cookie, and that
  JWT is what the Data API accepts.
- "Refreshing" is just asking for another one.

There is no refresh token anywhere, which is a real improvement on what this
replaced: `localStorage` used to hold a long-lived credential that a successful
XSS could take and reuse indefinitely. The worst it now holds is a JWT with
minutes left on it, and minting another needs the cookie.

The JWT is Ed25519-signed and verified by the Data API against Neon's published
JWKS at `/.well-known/jwks.json`. Nothing in the browser verifies it — the
client reads the payload only to learn when to ask for the next one.

## Two limits worth knowing

**The free tier scales to zero.** After an idle spell the project suspends, so
the first request wakes it and takes noticeably longer. The client says so
rather than blaming the network.

**Confirmation email is rate-limited.** The panel offers to send it again, which
is what people need when the first one lands in spam.

## How syncing behaves

Saves are debounced and revision-checked. The editor sends the revision it last
saw; a stale one matches no row, comes back empty, and the user is asked which
version wins rather than having one silently overwritten. That check is enforced
in Postgres by the `sites_touch` trigger, so a client cannot claim a revision it
did not earn.

## If you would rather not use Neon

Leave `VITE_NEON_DATA_URL` unset. `cloudConfig()` returns null, the account UI
disappears, and the editor is local-only — which is also exactly what happens
when it is opened from a `file://` URL, where no API would accept the request
anyway.
