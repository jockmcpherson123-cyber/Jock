-- Phase 19 — Tournament Operations.
-- Everything needed to run a championship: a tournament record, the people
-- (volunteers + crew) working it with a unique badge code for check-in, and a
-- public sign-up staging table volunteers fill out themselves. Safe to re-run.

-- ── Tournaments ──────────────────────────────────────────────────────────────
-- One row per event. `data` (jsonb) holds jobs, handbook sections, committees,
-- shift definitions, and settings — no schema change needed as those grow.
create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date,
  end_date date,
  location text not null default '',
  is_active boolean not null default false,
  signup_open boolean not null default false,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tournaments enable row level security;

drop policy if exists "tournaments readable" on public.tournaments;
create policy "tournaments readable"
  on public.tournaments for select to authenticated using (true);

drop policy if exists "tournaments insertable" on public.tournaments;
create policy "tournaments insertable"
  on public.tournaments for insert to authenticated with check (true);

drop policy if exists "tournaments updatable" on public.tournaments;
create policy "tournaments updatable"
  on public.tournaments for update to authenticated using (true) with check (true);

drop policy if exists "tournaments deletable" on public.tournaments;
create policy "tournaments deletable"
  on public.tournaments for delete to authenticated using (true);

-- ── People (volunteers + crew) ───────────────────────────────────────────────
-- `code` is the unique badge token that goes in the QR the PGA prints on the
-- card. `data` holds role, committee, job assignment, shift, contact info,
-- check-in/out timestamps and status.
create table if not exists public.tournament_people (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name text not null,
  code text not null,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, code)
);

create index if not exists tournament_people_tid_idx on public.tournament_people (tournament_id);

alter table public.tournament_people enable row level security;

drop policy if exists "tournament_people readable" on public.tournament_people;
create policy "tournament_people readable"
  on public.tournament_people for select to authenticated using (true);

drop policy if exists "tournament_people insertable" on public.tournament_people;
create policy "tournament_people insertable"
  on public.tournament_people for insert to authenticated with check (true);

drop policy if exists "tournament_people updatable" on public.tournament_people;
create policy "tournament_people updatable"
  on public.tournament_people for update to authenticated using (true) with check (true);

drop policy if exists "tournament_people deletable" on public.tournament_people;
create policy "tournament_people deletable"
  on public.tournament_people for delete to authenticated using (true);

-- ── Public sign-ups (staging) ────────────────────────────────────────────────
-- Volunteers fill out a public form; entries land here as "pending" for staff
-- to review and pull into the roster. Writes come through a server route using
-- the service role, so no anonymous RLS policy is needed — only signed-in staff
-- read/update these rows here.
create table if not exists public.tournament_signups (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name text not null,
  email text not null default '',
  phone text not null default '',
  status text not null default 'pending',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tournament_signups_tid_idx on public.tournament_signups (tournament_id, status);

alter table public.tournament_signups enable row level security;

drop policy if exists "tournament_signups readable" on public.tournament_signups;
create policy "tournament_signups readable"
  on public.tournament_signups for select to authenticated using (true);

drop policy if exists "tournament_signups updatable" on public.tournament_signups;
create policy "tournament_signups updatable"
  on public.tournament_signups for update to authenticated using (true) with check (true);

drop policy if exists "tournament_signups deletable" on public.tournament_signups;
create policy "tournament_signups deletable"
  on public.tournament_signups for delete to authenticated using (true);

-- ── Realtime ─────────────────────────────────────────────────────────────────
-- The live check-in desk and the TV board need push updates as people are
-- checked in and jobs change. Add the tables to the realtime publication.
do $$
begin
  begin
    alter publication supabase_realtime add table public.tournament_people;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.tournaments;
  exception when duplicate_object then null;
  end;
end $$;
