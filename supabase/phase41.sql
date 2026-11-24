-- ============================================================================
--  Grounds Operations — PHASE 41 (Course Map: moisture targets)
-- ============================================================================
--  Run (once) in Supabase → SQL Editor, AFTER phase36/38. Safe to re-run.
--
--  Seasonal moisture ranges (a round is judged against the target active on its
--  date, so past readings keep their colors) and per-green exceptions. Seeds one
--  whole-year season at 20–30% for Congressional; change it on the Targets page.
-- ============================================================================

create table if not exists public.moisture_targets (
  id           uuid primary key default gen_random_uuid(),
  club_id      uuid not null references public.clubs (id) on delete cascade,
  course_id    uuid references public.courses (id) on delete set null,
  surface      text not null default 'green',
  name         text,
  start_md     text not null,      -- 'MM-DD'
  end_md       text not null,      -- 'MM-DD' (may wrap the new year)
  vwc_lo       numeric not null,
  vwc_hi       numeric not null,
  aim          numeric,            -- default (lo+hi)/2 in the app
  salinity_max numeric,
  created_at   timestamptz not null default now()
);
create index if not exists moisture_targets_club_idx on public.moisture_targets (club_id, course_id);
alter table public.moisture_targets enable row level security;
drop policy if exists "moisture_targets readable by club" on public.moisture_targets;
create policy "moisture_targets readable by club" on public.moisture_targets for select to authenticated using (club_id = public.my_club());
drop policy if exists "moisture_targets writable by managers" on public.moisture_targets;
create policy "moisture_targets writable by managers" on public.moisture_targets for all to authenticated
  using (club_id = public.my_club() and public.is_grounds_manager())
  with check (club_id = public.my_club() and public.is_grounds_manager());

create table if not exists public.target_exceptions (
  id        uuid primary key default gen_random_uuid(),
  club_id   uuid not null references public.clubs (id) on delete cascade,
  area_id   uuid not null references public.areas (id) on delete cascade,
  target_id uuid references public.moisture_targets (id) on delete cascade,  -- null = all seasons
  vwc_lo    numeric, vwc_hi numeric, aim numeric,
  reason    text,
  created_at timestamptz not null default now()
);
create index if not exists target_exceptions_club_idx on public.target_exceptions (club_id, area_id);
alter table public.target_exceptions enable row level security;
drop policy if exists "target_exceptions readable by club" on public.target_exceptions;
create policy "target_exceptions readable by club" on public.target_exceptions for select to authenticated using (club_id = public.my_club());
drop policy if exists "target_exceptions writable by managers" on public.target_exceptions;
create policy "target_exceptions writable by managers" on public.target_exceptions for all to authenticated
  using (club_id = public.my_club() and public.is_grounds_manager())
  with check (club_id = public.my_club() and public.is_grounds_manager());

-- Seed one whole-year season (20–30%) for Congressional, if none exist yet.
do $$
declare cid uuid;
begin
  select id into cid from public.clubs where name = 'Congressional Country Club';
  if cid is not null and not exists (select 1 from public.moisture_targets where club_id = cid) then
    insert into public.moisture_targets (club_id, surface, name, start_md, end_md, vwc_lo, vwc_hi)
      values (cid, 'green', 'All season', '11-01', '10-31', 20, 30);
  end if;
end $$;
