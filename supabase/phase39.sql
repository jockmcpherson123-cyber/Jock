-- ============================================================================
--  Grounds Operations — PHASE 39 (Course Map: moisture readings)
-- ============================================================================
--  Run (once) in Supabase → SQL Editor, AFTER phase36/38. Safe to re-run.
--
--  DEACON (and manual) moisture readings, each placed on the green its GPS falls
--  in, and grouped into rounds (readings on one green within 60 min). Club-scoped
--  by RLS. The per-club column mapping for imports lives in club_settings.settings.
-- ============================================================================

create table if not exists public.moisture_rounds (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs (id) on delete cascade,
  area_id    uuid references public.areas (id) on delete set null,
  started_at timestamptz,
  ended_at   timestamptz,
  n_readings int,
  avg_vwc    numeric,
  min_vwc    numeric,
  max_vwc    numeric,
  created_at timestamptz not null default now()
);
create index if not exists moisture_rounds_club_idx on public.moisture_rounds (club_id, area_id, started_at desc);

alter table public.moisture_rounds enable row level security;
drop policy if exists "moisture_rounds readable by club" on public.moisture_rounds;
create policy "moisture_rounds readable by club" on public.moisture_rounds for select to authenticated using (club_id = public.my_club());
drop policy if exists "moisture_rounds writable by managers" on public.moisture_rounds;
create policy "moisture_rounds writable by managers" on public.moisture_rounds for all to authenticated
  using (club_id = public.my_club() and public.is_grounds_manager())
  with check (club_id = public.my_club() and public.is_grounds_manager());

create table if not exists public.moisture_readings (
  id           uuid primary key default gen_random_uuid(),
  club_id      uuid not null references public.clubs (id) on delete cascade,
  course_id    uuid references public.courses (id) on delete set null,
  taken_at     timestamptz,
  lat          double precision,
  lon          double precision,
  vwc_pct      numeric,
  soil_temp_f  numeric,
  salinity_dsm numeric,
  tine_in      numeric,
  source       text not null default 'deacon' check (source in ('deacon', 'manual', 'other')),
  device       text,
  spot         text,            -- the reading's spot label within a round (DEACON "point")
  external_id  text,            -- a globally-unique device/feed id when one exists (not DEACON "point")
  area_id      uuid references public.areas (id) on delete set null,
  round_id     uuid references public.moisture_rounds (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists moisture_readings_club_idx on public.moisture_readings (club_id, area_id, taken_at);
create index if not exists moisture_readings_round_idx on public.moisture_readings (round_id);
-- Dedupe helper: an external id is unique within a club when present.
create unique index if not exists moisture_readings_ext_uniq on public.moisture_readings (club_id, external_id) where external_id is not null;

alter table public.moisture_readings enable row level security;
drop policy if exists "moisture_readings readable by club" on public.moisture_readings;
create policy "moisture_readings readable by club" on public.moisture_readings for select to authenticated using (club_id = public.my_club());
drop policy if exists "moisture_readings writable by managers" on public.moisture_readings;
create policy "moisture_readings writable by managers" on public.moisture_readings for all to authenticated
  using (club_id = public.my_club() and public.is_grounds_manager())
  with check (club_id = public.my_club() and public.is_grounds_manager());
