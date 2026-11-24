-- ============================================================================
--  Grounds Operations — PHASE 38 (Course Map: areas + sqft)
-- ============================================================================
--  Run (once) in Supabase → SQL Editor, AFTER phase36.sql. Safe to re-run.
--
--  Drawn course areas (greens, tees, fairways, bunkers…) as GeoJSON polygons in
--  jsonb (WGS84), with their geodesic sqft. Every edit snapshots the old shape
--  into area_history so "Was X sqft (traced <date>)" is always truthful.
--  Club-scoped by RLS, managers edit.
-- ============================================================================

create table if not exists public.areas (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs (id) on delete cascade,
  course_id  uuid references public.courses (id) on delete set null,
  hole       int,                                   -- 1..18 (nullable for 'other')
  type       text not null check (type in ('green', 'approach', 'fairway', 'tee', 'bunker', 'other')),
  name       text,
  geom       jsonb not null,                        -- GeoJSON Polygon, WGS84
  sqft       numeric,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists areas_club_idx on public.areas (club_id, course_id);

alter table public.areas enable row level security;
drop policy if exists "areas readable by club" on public.areas;
create policy "areas readable by club" on public.areas for select to authenticated using (club_id = public.my_club());
drop policy if exists "areas writable by managers" on public.areas;
create policy "areas writable by managers" on public.areas for all to authenticated
  using (club_id = public.my_club() and public.is_grounds_manager())
  with check (club_id = public.my_club() and public.is_grounds_manager());

-- History: a row per previous shape. club_id is carried for simple RLS.
create table if not exists public.area_history (
  id         uuid primary key default gen_random_uuid(),
  area_id    uuid not null references public.areas (id) on delete cascade,
  club_id    uuid not null references public.clubs (id) on delete cascade,
  geom       jsonb not null,
  sqft       numeric,
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists area_history_area_idx on public.area_history (area_id, changed_at desc);

alter table public.area_history enable row level security;
drop policy if exists "area_history readable by club" on public.area_history;
create policy "area_history readable by club" on public.area_history for select to authenticated using (club_id = public.my_club());
drop policy if exists "area_history writable by managers" on public.area_history;
create policy "area_history writable by managers" on public.area_history for all to authenticated
  using (club_id = public.my_club() and public.is_grounds_manager())
  with check (club_id = public.my_club() and public.is_grounds_manager());
