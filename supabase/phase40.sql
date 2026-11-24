-- ============================================================================
--  Grounds Operations — PHASE 40 (Course Map: tonight's watering plan)
-- ============================================================================
--  Run (once) in Supabase → SQL Editor, AFTER phase36/38/39. Safe to re-run.
--
--  Tonight's chosen watering depth per green, and the per-day approval that
--  locks it. Anyone on the team may pick a depth (logged with who/when); only a
--  Superintendent or Director approves (enforced in the UI). There is NO Toro
--  Lynx connection — the plan is text the team re-enters in Lynx Drive.
-- ============================================================================

create table if not exists public.watering_plan (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs (id) on delete cascade,
  course_id  uuid references public.courses (id) on delete set null,
  area_id    uuid not null references public.areas (id) on delete cascade,
  plan_date  date not null,
  depth_in   numeric,                 -- null = Skip
  chosen_by  uuid references public.profiles (id) on delete set null,
  chosen_at  timestamptz not null default now(),
  unique (area_id, plan_date)
);
create index if not exists watering_plan_idx on public.watering_plan (club_id, plan_date);

alter table public.watering_plan enable row level security;
-- Any team member of the club may set a depth.
drop policy if exists "watering_plan readable by club" on public.watering_plan;
create policy "watering_plan readable by club" on public.watering_plan for select to authenticated using (club_id = public.my_club());
drop policy if exists "watering_plan writable by club" on public.watering_plan;
create policy "watering_plan writable by club" on public.watering_plan for all to authenticated
  using (club_id = public.my_club()) with check (club_id = public.my_club());

-- Per-day meta: the forecast ET used, and the approval that locks the night.
create table if not exists public.watering_day (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null references public.clubs (id) on delete cascade,
  course_id   uuid references public.courses (id) on delete set null,
  plan_date   date not null,
  forecast_et numeric,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  unique (course_id, plan_date)
);
alter table public.watering_day enable row level security;
drop policy if exists "watering_day readable by club" on public.watering_day;
create policy "watering_day readable by club" on public.watering_day for select to authenticated using (club_id = public.my_club());
drop policy if exists "watering_day writable by managers" on public.watering_day;
create policy "watering_day writable by managers" on public.watering_day for all to authenticated
  using (club_id = public.my_club() and public.is_grounds_manager())
  with check (club_id = public.my_club() and public.is_grounds_manager());
