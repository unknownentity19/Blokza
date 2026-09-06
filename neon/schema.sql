-- BLOKZA cloud sites — run this once in the Neon SQL editor.
--
-- The editor document is a single JSON blob, so there is nothing to shred into
-- columns: one row per site, the whole document in `doc`.
--
-- IMPORTANT: the Data API is reachable from any browser. These row-level
-- security policies are the only thing protecting the data — a request can only
-- ever see or change rows whose owner matches the signed-in user. The Data API
-- refuses to expose a table that has RLS disabled, which is the behaviour we
-- want: a forgotten `enable row level security` fails closed rather than open.
--
-- Never put the Neon connection string in the front end. The browser only ever
-- holds a short-lived JWT from Neon Auth, which is exactly one user's authority.

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------

create table if not exists public.sites (
  id          uuid        primary key default gen_random_uuid(),

  -- `text`, not `uuid`, and this is not a style choice. Neon Auth is Better
  -- Auth underneath, and its user ids are nanoid-style strings rather than
  -- UUIDs, so `auth.uid()` — which parses the JWT's `sub` as a UUID — returns
  -- NULL for every one of them and every policy silently denies. `auth.user_id()`
  -- returns `sub` as text, which is what these ids actually are.
  --
  -- Defaulted server-side from the JWT, so the browser never names an owner and
  -- cannot attempt to write a row on someone else's behalf.
  owner       text        not null default (auth.user_id()),

  name        text        not null default 'Untitled site',
  doc         jsonb       not null,

  -- Bumped on every write. The editor sends the revision it last saw, so a
  -- second tab or device cannot quietly overwrite newer work: the update simply
  -- matches no row and the client asks what to do.
  revision    bigint      not null default 1,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- No foreign key to the auth user table on purpose: Neon Auth owns that schema
-- and manages its own migrations, so pointing a constraint at it couples this
-- table's integrity to someone else's release cycle. RLS is what enforces
-- ownership here; the FK would only add referential tidiness.

alter table public.sites enable row level security;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
--
-- Two roles reach this table through the Data API: `authenticated` for a
-- request carrying a user's JWT, and `anonymous` for one that carries none.
-- `anonymous` is granted nothing at all, so an unauthenticated caller can see
-- no row of anyone's — not even an empty-set leak of the column names.

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.sites to authenticated;

-- Policies are scoped `to authenticated` as well as filtered by owner. Both
-- matter: the grant decides who may attempt the statement, the policy decides
-- which rows it may touch.
drop policy if exists "sites: read own"   on public.sites;
drop policy if exists "sites: insert own" on public.sites;
drop policy if exists "sites: update own" on public.sites;
drop policy if exists "sites: delete own" on public.sites;

create policy "sites: read own"   on public.sites for select to authenticated
  using (auth.user_id() = owner);

create policy "sites: insert own" on public.sites for insert to authenticated
  with check (auth.user_id() = owner);

create policy "sites: update own" on public.sites for update to authenticated
  using (auth.user_id() = owner)
  with check (auth.user_id() = owner);

create policy "sites: delete own" on public.sites for delete to authenticated
  using (auth.user_id() = owner);

create index if not exists sites_owner_updated on public.sites (owner, updated_at desc);

-- ---------------------------------------------------------------------------
-- Keep `revision` and `updated_at` honest server-side, so a client cannot claim
-- a revision it did not earn.
-- ---------------------------------------------------------------------------

create or replace function public.touch_site() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.revision   := old.revision + 1;
  -- Belt and braces, not the primary defence: the update policy's WITH CHECK
  -- is evaluated against the *new* row, so an attempt to PATCH `owner` to
  -- someone else's id already fails there. This pins it anyway, so that the
  -- column stays correct even if a future policy is loosened by accident.
  new.owner      := old.owner;
  return new;
end;
$$;

drop trigger if exists sites_touch on public.sites;
create trigger sites_touch before update on public.sites
  for each row execute function public.touch_site();
