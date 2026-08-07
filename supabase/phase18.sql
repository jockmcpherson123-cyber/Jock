-- Phase 18 — Greens Speed (Stimpmeter) tracking.
-- Logs a green's speed (in feet) by green and date, so the crew can track
-- consistency across the greens and over time. Mirrors the clippings table.
-- Safe to re-run.

create table if not exists public.greens_speeds (
  id uuid primary key default gen_random_uuid(),
  area text not null,
  reading_date date not null,
  speed numeric,
  notes text not null default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists greens_speeds_area_date_idx on public.greens_speeds (area, reading_date);

alter table public.greens_speeds enable row level security;

-- Everyone signed in can read the greens-speed history.
drop policy if exists "greens_speeds readable" on public.greens_speeds;
create policy "greens_speeds readable"
  on public.greens_speeds for select to authenticated using (true);

-- Any signed-in crew member can log, edit, or remove a reading.
drop policy if exists "greens_speeds insertable" on public.greens_speeds;
create policy "greens_speeds insertable"
  on public.greens_speeds for insert to authenticated with check (true);

drop policy if exists "greens_speeds updatable" on public.greens_speeds;
create policy "greens_speeds updatable"
  on public.greens_speeds for update to authenticated using (true) with check (true);

drop policy if exists "greens_speeds deletable" on public.greens_speeds;
create policy "greens_speeds deletable"
  on public.greens_speeds for delete to authenticated using (true);
