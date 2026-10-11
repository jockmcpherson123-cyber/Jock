-- Phase 28 — Green firmness readings (build brief §D).
-- Mirrors greens_speeds: one firmness reading per green per day. DEACON and
-- Playbooks both report firmness alongside green speed; this gives it a home so
-- the scheduled DEACON task can stop dropping it. Safe to re-run.

create table if not exists public.greens_firmness (
  id uuid primary key default gen_random_uuid(),
  area text not null,
  reading_date date not null,
  firmness numeric,                       -- Gravities (DEACON) / Clegg / club unit
  unit text not null default 'Gravities',
  notes text not null default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists greens_firmness_area_date_idx on public.greens_firmness (area, reading_date);

alter table public.greens_firmness enable row level security;

drop policy if exists "greens_firmness readable" on public.greens_firmness;
create policy "greens_firmness readable"
  on public.greens_firmness for select to authenticated using (true);

drop policy if exists "greens_firmness insertable" on public.greens_firmness;
create policy "greens_firmness insertable"
  on public.greens_firmness for insert to authenticated with check (true);

drop policy if exists "greens_firmness updatable" on public.greens_firmness;
create policy "greens_firmness updatable"
  on public.greens_firmness for update to authenticated using (true) with check (true);

drop policy if exists "greens_firmness deletable" on public.greens_firmness;
create policy "greens_firmness deletable"
  on public.greens_firmness for delete to authenticated using (true);
