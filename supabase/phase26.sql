-- Phase 26 — Irrigation parts inventory.
-- A simple stockroom for irrigation parts (heads, nozzles, valves, fittings,
-- swing joints, wire/splices, controllers, sensors, tools…): part number, name,
-- a photo, how many are on hand, and a low-stock level that flags reorders.
-- Safe to re-run.

create table if not exists public.irrigation_parts (
  id uuid primary key default gen_random_uuid(),
  part_number text not null default '',
  name text not null default '',
  category text not null default '',       -- Head | Nozzle | Valve | Fitting | Pipe/PVC | Swing Joint | Wire/Splice | Controller | Sensor | Tool | Other
  brand text not null default '',          -- Toro | Rain Bird | Hunter | …
  size text not null default '',           -- e.g. 3/4", 1"
  photo text not null default '',          -- base64 data URL
  stock double precision not null default 0,       -- in stock total
  low_stock double precision not null default 0,   -- flag at/below this
  unit text not null default 'each',       -- each | box | ft | roll
  location text not null default '',       -- where it lives in the shop (bin/shelf)
  supplier text not null default '',       -- vendor
  price double precision not null default 0,       -- unit cost
  notes text not null default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists irrigation_parts_category_idx on public.irrigation_parts (category);

alter table public.irrigation_parts enable row level security;

drop policy if exists "parts readable" on public.irrigation_parts;
create policy "parts readable" on public.irrigation_parts for select to authenticated using (true);

drop policy if exists "parts insertable" on public.irrigation_parts;
create policy "parts insertable" on public.irrigation_parts for insert to authenticated with check (true);

drop policy if exists "parts updatable" on public.irrigation_parts;
create policy "parts updatable" on public.irrigation_parts for update to authenticated using (true) with check (true);

drop policy if exists "parts deletable" on public.irrigation_parts;
create policy "parts deletable" on public.irrigation_parts for delete to authenticated using (true);
