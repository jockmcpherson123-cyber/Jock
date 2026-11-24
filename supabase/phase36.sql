-- ============================================================================
--  Grounds Operations — PHASE 36 (Course Map: club / course / imagery)
-- ============================================================================
--  Run (once) in Supabase → SQL Editor. Safe to re-run.
--
--  Foundation for the Course Map section, built multi-club from the start so it
--  can be sold to other clubs: every new table carries club_id and RLS restricts
--  every row to the signed-in user's club. Secrets (the Nearmap API key) live in
--  a separate table with NO browser-readable policy, so they never reach the
--  client — only server routes (service-role) can read them.
--
--  Seeds Congressional Country Club + the Blue course, and ties every existing
--  user to Congressional.
-- ============================================================================

-- ── Each user belongs to a club ────────────────────────────────────────────────
alter table public.profiles add column if not exists club_id uuid;

-- ── Helpers ────────────────────────────────────────────────────────────────────
create or replace function public.my_club()
returns uuid language sql stable security definer set search_path = '' as $$
  select club_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_grounds_manager()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_user_role() in ('assistant', 'superintendent', 'director');
$$;

-- ── Clubs ──────────────────────────────────────────────────────────────────────
create table if not exists public.clubs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);
alter table public.clubs enable row level security;
drop policy if exists "clubs readable by own members" on public.clubs;
create policy "clubs readable by own members" on public.clubs for select to authenticated using (id = public.my_club());

-- ── Courses ────────────────────────────────────────────────────────────────────
create table if not exists public.courses (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs (id) on delete cascade,
  name       text not null,
  holes      int not null default 18,
  created_at timestamptz not null default now(),
  unique (club_id, name)
);
alter table public.courses enable row level security;
drop policy if exists "courses readable by club" on public.courses;
create policy "courses readable by club" on public.courses for select to authenticated using (club_id = public.my_club());
drop policy if exists "courses writable by managers" on public.courses;
create policy "courses writable by managers" on public.courses for all to authenticated
  using (club_id = public.my_club() and public.is_grounds_manager())
  with check (club_id = public.my_club() and public.is_grounds_manager());

-- ── Imagery (one per uploaded / sourced aerial) ────────────────────────────────
-- For the Stage-1 rotated-overlay approach we store the world-file placement
-- (ul_x/ul_y = EPSG:3857 of the upper-left pixel centre, px sizes, dimensions);
-- file_path points at the photo in Supabase Storage. status defaults 'ready'
-- (no tiling job in Stage 1).
create table if not exists public.imagery (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null references public.clubs (id) on delete cascade,
  course_id   uuid references public.courses (id) on delete set null,
  captured_on date,
  source      text not null default 'upload' check (source in ('upload', 'nearmap_api', 'default')),
  file_path   text,
  crs         text not null default 'EPSG:3857',
  ul_x        double precision,
  ul_y        double precision,
  px_size_x   double precision,
  px_size_y   double precision,
  width_px    int,
  height_px   int,
  tiles_path  text,
  status      text not null default 'ready' check (status in ('processing', 'ready', 'error')),
  uploaded_by uuid references public.profiles (id) on delete set null,
  uploaded_at timestamptz not null default now()
);
create index if not exists imagery_club_idx on public.imagery (club_id, captured_on desc);
alter table public.imagery enable row level security;
drop policy if exists "imagery readable by club" on public.imagery;
create policy "imagery readable by club" on public.imagery for select to authenticated using (club_id = public.my_club());
drop policy if exists "imagery writable by managers" on public.imagery;
create policy "imagery writable by managers" on public.imagery for all to authenticated
  using (club_id = public.my_club() and public.is_grounds_manager())
  with check (club_id = public.my_club() and public.is_grounds_manager());

-- ── Club settings (non-secret) ─────────────────────────────────────────────────
create table if not exists public.club_settings (
  club_id            uuid primary key references public.clubs (id) on delete cascade,
  default_imagery_id uuid references public.imagery (id) on delete set null,
  inches_per_point   numeric not null default 0.03,  -- inches of water per moisture point
  max_depth          numeric not null default 0.25,  -- cap on a night's suggested depth
  settings           jsonb not null default '{}'::jsonb,
  updated_at         timestamptz not null default now()
);
alter table public.club_settings enable row level security;
drop policy if exists "club_settings readable by club" on public.club_settings;
create policy "club_settings readable by club" on public.club_settings for select to authenticated using (club_id = public.my_club());
drop policy if exists "club_settings writable by managers" on public.club_settings;
create policy "club_settings writable by managers" on public.club_settings for all to authenticated
  using (club_id = public.my_club() and public.is_grounds_manager())
  with check (club_id = public.my_club() and public.is_grounds_manager());

-- ── Club secrets (server-only; NO browser policy) ──────────────────────────────
-- RLS is on with no policy for 'authenticated', so the anon/user client can read
-- NOTHING here. Only server routes using the service-role key (which bypasses
-- RLS) can read the Nearmap key.
create table if not exists public.club_secrets (
  club_id         uuid primary key references public.clubs (id) on delete cascade,
  nearmap_api_key text,
  updated_at      timestamptz not null default now()
);
alter table public.club_secrets enable row level security;

-- ── Seed Congressional + Blue, tie existing users to it ────────────────────────
do $$
declare cid uuid;
begin
  insert into public.clubs (name) values ('Congressional Country Club')
    on conflict (name) do update set name = excluded.name
    returning id into cid;
  insert into public.courses (club_id, name, holes) values (cid, 'Blue', 18) on conflict (club_id, name) do nothing;
  insert into public.club_settings (club_id) values (cid) on conflict (club_id) do nothing;
  insert into public.club_secrets (club_id) values (cid) on conflict (club_id) do nothing;
  update public.profiles set club_id = cid where club_id is null;
end $$;
