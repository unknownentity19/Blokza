-- Altask cloud sites — run this once in the Supabase SQL editor.
--
-- The editor document is a single JSON blob, so there is nothing to shred into
-- columns: one row per site, the whole document in `doc`.
--
-- IMPORTANT: the anon key shipped in the browser bundle is public by design.
-- These row-level-security policies are what actually protect the data — a
-- request can only ever see or change rows whose owner matches the signed-in
-- user. Never put the *service role* key in the front end; it bypasses all of
-- this.

create table if not exists public.sites (
  id          uuid        primary key default gen_random_uuid(),
  -- Defaulted server-side from the JWT, so the browser never names an owner and
  -- cannot attempt to write a row on someone else's behalf.
  owner       uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  name        text        not null default 'Untitled site',
  doc         jsonb       not null,
  -- Bumped on every write. The editor sends the revision it last saw, so a
  -- second tab or device cannot quietly overwrite newer work: the update simply
  -- matches no row and the client asks what to do.
  revision    bigint      not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.sites enable row level security;

drop policy if exists "sites: read own"   on public.sites;
drop policy if exists "sites: insert own" on public.sites;
drop policy if exists "sites: update own" on public.sites;
drop policy if exists "sites: delete own" on public.sites;

create policy "sites: read own"   on public.sites for select using (auth.uid() = owner);
create policy "sites: insert own" on public.sites for insert with check (auth.uid() = owner);
create policy "sites: update own" on public.sites for update using (auth.uid() = owner)
                                                          with check (auth.uid() = owner);
create policy "sites: delete own" on public.sites for delete using (auth.uid() = owner);

create index if not exists sites_owner_updated on public.sites (owner, updated_at desc);

-- Keep `revision` and `updated_at` honest server-side, so a client cannot claim
-- a revision it did not earn.
create or replace function public.touch_site() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.revision   := old.revision + 1;
  return new;
end;
$$;

drop trigger if exists sites_touch on public.sites;
create trigger sites_touch before update on public.sites
  for each row execute function public.touch_site();
