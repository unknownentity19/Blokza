# Deploying

The site is static files plus one serverless function. Vercel serves the
repository as it stands and runs `api/auth/[...all].mjs` for `/api/auth/*`.

There is no build step on Vercel, and that is deliberate: `.vercelignore`
excludes `builder/`, so the editor bundle in `app/` is served exactly as
committed. **That means a stale commit ships a stale editor.** `scripts/release.sh`
exists to make sure it never does.

## The loop

```bash
./scripts/preflight.sh      # is everything configured?
./scripts/release.sh        # build, regenerate, stamp
git commit -am "…" && git push
```

Vercel deploys the push. Nothing else to run.

### What `release.sh` does, and why it has to

Three things must be true *in the commit*, because nothing downstream will do
them:

1. **`app/` holds a current editor build.** No build step on the far side.
2. **`sitemap.xml` matches the pages on disk.** It is generated, not kept by
   hand — a hand-kept list is one forgotten edit from advertising a page that
   does not exist.
3. **Every asset URL carries a hash of that asset's contents.** This is the one
   that bites. `vercel.json` serves `/assets/*` as `immutable` for a year, and
   `immutable` means browsers will not revalidate *even on a forced reload*. An
   unstamped image is a file you cannot replace for twelve months without
   renaming it. Deriving the `?v=` from the bytes means it can never be stale
   and never needs remembering.

`./scripts/release.sh --check` does all of it without writing, and fails if the
tree would change. That is the CI-shaped question: would deploying this commit
serve something wrong?

## First-time setup

### Vercel

Import the repository. The defaults are right — no framework, no build command,
no output directory. Then set one environment variable:

```
NEON_AUTH_URL=https://ep-<id>.neonauth.<region>.aws.neon.tech/neondb/auth
```

No `VITE_` prefix. It is read by the serverless function and must not reach the
browser bundle.

`vercel.json` pins functions to `sin1` to sit beside the Neon project in
Singapore. If you ever move the Neon region, move this too — otherwise every
sign-in goes browser → Singapore-region-function → wherever Neon now is.

### Neon

See [CLOUD.md](CLOUD.md) for the full setup. The step people miss:

> **Add `https://blokza.com` to Neon Auth's trusted origins.**
> `localhost` is trusted by default, so sign-in works perfectly in development
> and returns `403 INVALID_ORIGIN` the moment it is deployed.

`preflight.sh` checks this, because it is otherwise invisible until production.

### Why `cleanUrls` is off

`vercel.json` sets `"cleanUrls": false`, and it needs to stay that way. The site
is built end to end around `.html` URLs: 652 internal links, every `<link
rel="canonical">`, and every entry `scripts/sitemap.py` generates.

With `cleanUrls: true`, Vercel serves `/about` and **308-redirects**
`/about.html` to it. That would put a redirect in front of every internal
navigation, and — worse — point every canonical tag at a URL that redirects,
which is exactly what a canonical is not supposed to do.

Turning it on is a whole-site change (links, canonicals, sitemap generator), not
a config flag.

### The domain

Add `blokza.com` in Vercel and follow its DNS instructions.

One consequence of the move from `.dev`: **`.dev` is HSTS-preloaded at the TLD
level and `.com` is not.** The `Strict-Transport-Security` header in
`vercel.json` still applies after a first visit, but the `preload` directive
does nothing until the domain is submitted at
[hstspreload.org](https://hstspreload.org).

## What is no longer here

`scripts/deploy.sh`, `_headers`, `_redirects` and `netlify.toml` are gone. The
first published to Cloudflare Pages via Wrangler; the rest were host config for
Cloudflare and Netlify, duplicating what `vercel.json` now says. Two files
describing the same headers is a drift waiting to happen — `vercel.json` is the
only source of truth for headers, redirects and the function region.

`supabase/` is gone too. Identity and storage are both Neon; see
[CLOUD.md](CLOUD.md).
