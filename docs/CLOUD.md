# Accounts and cloud-saved sites

Everything here is on free tiers. The only thing that ever costs money is a
custom domain, and the free `*.netlify.app` / `*.pages.dev` subdomain avoids
even that.

## What you get

Sign in, and your sites live on the server instead of only in one browser — open
them from another machine, or after clearing site data. Without an account the
editor works exactly as it always has: everything in `localStorage`, nothing
sent anywhere.

## Setup, once (about five minutes)

1. **Create a Supabase project** — <https://supabase.com>, free tier. Pick a
   region near you; the database password it asks for is for direct SQL access
   and is not used by this app.

2. **Create the table.** Open the project's **SQL Editor**, paste all of
   [`../supabase/schema.sql`](../supabase/schema.sql), and run it. That creates
   one `sites` table and the row-level-security policies that make the whole
   thing safe.

3. **Turn on email sign-in.** *Authentication → Providers → Email* is on by
   default. Set **Site URL** and **Redirect URLs** (*Authentication → URL
   Configuration*) to your deployed URL, and add the editor's own path —
   `https://saaswise.dev/app/` — to Redirect URLs. The confirmation link comes
   back to that exact page; if it is not on the allow-list GoTrue quietly sends
   people to Site URL instead, and they land somewhere that cannot use the
   session the link carries.

   Then pick one of the two email paths below. Both are free.

### Path A — no confirmation email (nothing to send, nothing to limit)

Set **Confirm email: off**. Sign-up completes immediately and the person is in
the editor. No mail leaves Supabase, so there is no rate limit and nothing to
configure.

The trade is that an address is never proven. Someone can sign up as
`someone-else@example.com`. For an editor whose data is scoped to the account
that made it, that mostly costs you the ability to email your users later.

### Path B — real email confirmation, on a free sender

Set **Confirm email: on**. The flow is wired up end to end:

- sign-up sends `redirect_to` pointing at the editor page it was started from
- Supabase mails a link; the panel says so and offers **Send the confirmation
  email again**, because the first message going to spam is the usual way this
  stalls
- the link comes back to the editor with the session in the URL fragment, which
  `cloud/callback.ts` consumes, stores, and then erases from the address bar and
  from history — it is a credential, and it has no business staying visible
- an expired or already-used link says so instead of silently doing nothing

**The catch, and it is the whole reason Path A exists:** Supabase's built-in
mailer is rate limited to a handful of messages an hour and its own docs
describe it as unsuitable for production. It is fine for testing and useless for
real sign-ups.

To actually use Path B, point Supabase at your own SMTP under *Project Settings
→ Authentication → SMTP Settings*. Providers with a free tier that suits a
low-volume signup flow include **Resend** and **Brevo** — check their current
free limits before committing, since those move. You will also need a verified
sending domain, which for `saaswise.dev` means adding the DNS records they give
you in Cloudflare, alongside the Email Routing records for receiving.

Until custom SMTP is configured, expect confirmation mail to be throttled. That
is a limit of the free mailer, not of this code.

4. **Give the build your project details.** Copy `builder/.env.example` to
   `builder/.env.local` and paste the **Project URL** and the **anon public
   key** from *Project Settings → API*.

   Both are meant to be public and are compiled into the bundle. The
   `service_role` key is not — it bypasses every policy, and must never go in
   the front end.

5. **Rebuild and deploy.**

   ```bash
   cd builder && npm run build
   ```

   That writes `app/`, which is committed, so deploying is just pushing the
   files your host already serves.

## Two limits worth knowing

- **Free Supabase projects pause after about a week of inactivity.** Resuming is
  one button in the dashboard, but a paused project looks like being offline:
  the editor will say it cannot reach the server and keep saving locally.
- **Sign-in does not work when the editor is opened from a file.** A `file://`
  page has an opaque origin, which the API rejects, so the Cloud panel explains
  that and the editor stays in local mode. Use the deployed URL for cloud work,
  and the local file when you just want to edit offline.

## How syncing behaves

- `localStorage` is still written on every edit. The cloud is a second, slower
  sink — pushes are debounced by a couple of seconds, and flushed when the tab
  closes.
- Saves carry the revision the editor last saw. If another browser or device
  saved in the meantime, the write matches nothing and the editor tells you
  instead of overwriting. You choose: keep what is on screen, or take the saved
  version.
- Deleting a site in the Cloud panel removes it from the account. The copy in
  the current browser is left alone.

## If you would rather not use Supabase

The client is one file, [`../builder/src/cloud/client.ts`](../builder/src/cloud/client.ts),
holding six HTTP calls behind a small interface. Pointing it at Firebase,
Pocketbase or your own endpoint means rewriting that file and nothing else — the
editor talks to the interface, not to Supabase.
