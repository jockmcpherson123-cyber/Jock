-- Phase 25 — Fertilizer sheets (granular fert applications, per area).
-- Mirrors the club's Excel fert sheets: one product at one rate across the
-- sections of an area, with per-section square footage, lbs, bags and cost.
-- Sections are stored inline as JSON. Safe to re-run.

create table if not exists public.fert_sheets (
  id uuid primary key default gen_random_uuid(),
  area text not null default '',
  product text not null default '',
  analysis jsonb not null default '{}'::jsonb,   -- {n,p,k} guaranteed analysis %
  rate double precision not null default 0,      -- lbs product / 1,000 sq ft
  bag double precision not null default 50,      -- lb per bag
  adjust_pct double precision not null default 0,-- area overlap %
  price_per_bag double precision not null default 0,
  applicator text not null default '',
  app_date date,
  status text not null default 'planned',        -- planned | complete
  sections jsonb not null default '[]'::jsonb,   -- [{name,sqft,actual}]
  notes text not null default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fert_sheets_area_idx on public.fert_sheets (area);

alter table public.fert_sheets enable row level security;

drop policy if exists "fert readable" on public.fert_sheets;
create policy "fert readable" on public.fert_sheets for select to authenticated using (true);

drop policy if exists "fert insertable" on public.fert_sheets;
create policy "fert insertable" on public.fert_sheets for insert to authenticated with check (true);

drop policy if exists "fert updatable" on public.fert_sheets;
create policy "fert updatable" on public.fert_sheets for update to authenticated using (true) with check (true);

drop policy if exists "fert deletable" on public.fert_sheets;
create policy "fert deletable" on public.fert_sheets for delete to authenticated using (true);
