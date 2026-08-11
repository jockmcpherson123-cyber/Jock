-- Phase 21 — Editable irrigation features (heads, valves, etc.) on the Course Map.
-- Real map objects with real-world coordinates: crisp at any zoom, draggable,
-- and each carries type / zone / size / status / notes / photo. Populated by
-- standing on a head (GPS), tapping the calibrated overlay, or importing a
-- Toro Lynx export later. Safe to re-run.

create table if not exists public.irrigation_features (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'head',        -- head | valve | quick_coupler | controller | other
  lat double precision not null,
  lng double precision not null,
  label text not null default '',           -- e.g. station number / name
  zone text not null default '',            -- zone / station / satellite
  size text not null default '',            -- nozzle or pipe size
  status text not null default 'ok',        -- ok | repair | replaced
  notes text not null default '',
  photo text not null default '',           -- compressed image data URL
  source text not null default 'manual',    -- manual | gps | toro | import
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists irrigation_kind_idx on public.irrigation_features (kind);
create index if not exists irrigation_zone_idx on public.irrigation_features (zone);

alter table public.irrigation_features enable row level security;

drop policy if exists "irrigation readable" on public.irrigation_features;
create policy "irrigation readable"
  on public.irrigation_features for select to authenticated using (true);

drop policy if exists "irrigation insertable" on public.irrigation_features;
create policy "irrigation insertable"
  on public.irrigation_features for insert to authenticated with check (true);

drop policy if exists "irrigation updatable" on public.irrigation_features;
create policy "irrigation updatable"
  on public.irrigation_features for update to authenticated using (true) with check (true);

drop policy if exists "irrigation deletable" on public.irrigation_features;
create policy "irrigation deletable"
  on public.irrigation_features for delete to authenticated using (true);
