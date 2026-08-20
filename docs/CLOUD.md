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
   default. Two settings worth changing on a free project:
   - **Confirm email: off**, unless you want the confirmation round trip. The
     built-in mailer is rate limited to a handful of messages an hour, which is
     easy to trip while testing.
   - **Site URL** and **Redirect URLs** (*Authentication → URL Configuration*):
     add your deployed URL, e.g. `https://yoursite.netlify.app`.

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
