# Deploying to Cloudflare Pages

The domain lives on Cloudflare (for Email Routing), so Pages is the host that
costs the least trouble: same dashboard as the DNS, certificates issued
automatically, and Access available later if the editor should ever be private.

Free throughout. The domain itself is the only thing that costs money.

## Why direct upload rather than a connected repository

Pages normally builds from a Git push. This project is kept local and is not
pushed, so deploys go up directly from the machine with Wrangler instead. Same
result, no repository required.

## What actually gets uploaded

`scripts/deploy.sh` assembles `dist/` from a list, rather than publishing the
repository root. That is not tidiness:

- The root also holds `builder/node_modules` (~98 MB) and `legacy/` (~419 MB).
  Netlify tolerated this because `netlify.toml` redirected those paths to a 404 —
  but the files were still uploaded. **Cloudflare Pages caps a deployment at
  20,000 files and 25 MB per file, so the repository root cannot be published
  there at all.**
- Listing what belongs on the site is the only way to be sure the TypeScript
  source is not on it.

The result is about 60 files and 9 MB: the marketing pages, `assets/`, the built
editor in `app/`, and the four files a host reads from the root (`_headers`,
`_redirects`, `robots.txt`, `sitemap.xml`).

The script refuses to continue if `dist/` ever contains `node_modules`, `src` or
`legacy`, or if the editor did not build.

## Redirects and headers

Cloudflare reads `_headers` — the same file Netlify uses, no translation needed.

It **ignores `netlify.toml`**, so the redirects that lived there are duplicated in
`_redirects`. Without that file they would disappear on deploy with no error.
`netlify.toml` is kept so Netlify still works as a fallback.

## One-time setup

1. **Domain on Cloudflare** — add the site, move the nameservers, then turn on
   *Email → Email Routing* for forwarding. Email is MX-level and independent of
   where the site is hosted.

2. **Log Wrangler in to your account** (opens a browser; it is your account, so
   this step is yours):

   ```bash
   npx wrangler login
   ```

3. **First deploy**, which also creates the Pages project:

   ```bash
   ./scripts/deploy.sh --deploy
   ```

   It publishes to a project called `cilbs`; set `CF_PAGES_PROJECT` to use
   another name. You get a `*.pages.dev` URL immediately.

4. **Attach the domain** — *Workers & Pages → cilbs → Custom domains → Set up a
   custom domain*. Because the zone is already yours, Cloudflare writes the DNS
   record itself and issues the certificate. An apex domain works through CNAME
   flattening.

5. **Tell Supabase the real URL** — *Authentication → URL Configuration*: set
   **Site URL** and add the domain to **Redirect URLs**. Sign-in will fail from an
   origin the project has not been told about.

6. **Put the Supabase keys in the build** — `builder/.env.local`, as described in
   [CLOUD.md](CLOUD.md). They are compiled in, so this must happen *before* the
   build in step 3. If you deployed first, just deploy again.

## Every deploy after that

```bash
./scripts/deploy.sh
```

Assembles and checks `dist/` without publishing, so you can look at it. Then:

```bash
./scripts/deploy.sh --deploy
```

The editor is rebuilt each time, so `app/` is never stale — which was a real
failure mode when the built editor was committed and the source moved on
without it.

## Worth knowing

- **The build happens on your machine**, so the Supabase URL and anon key come
  from `builder/.env.local`. There is nothing to configure in the Cloudflare
  dashboard, and no environment variables to keep in step.
- **`_headers` sends HSTS with `preload` and `includeSubDomains`.** The header
  alone changes nothing until the domain is submitted at hstspreload.org, but
  once it is, every subdomain is HTTPS-only and that is deliberately hard to
  undo. Fine alongside email; a problem only if you ever want a plain-HTTP
  subdomain.
- **Tests do not run in CI**, because nothing is pushed. Run them before a
  deploy:

  ```bash
  npm --prefix builder test
  ```

- **Cache headers assume content hashing.** `app/assets/*` is immutable for a
  year and safe because Vite hashes those filenames; `app/index.html` and the
  marketing HTML always revalidate. Do not add long caching to an unhashed file.
