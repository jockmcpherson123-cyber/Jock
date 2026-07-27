-- ============================================================================
--  Grounds Operations — Database schema, PHASE 12 (Soil tests)
-- ============================================================================
--
--  HOW TO RUN THIS (once): Supabase → SQL Editor → New query → paste → Run.
--  Safe to re-run.
--
--  Soil-test results per area per date. Macronutrients are stored in ppm
--  (Mehlich-3), matching the MLSN fertility guidelines the app uses to turn a
--  test into a fertilizer recommendation. The jsonb `extras` column keeps any
--  micronutrients or lab fields we don't model as columns.
-- ============================================================================

create table if not exists public.soil_tests (
  id uuid primary key default gen_random_uuid(),
  area text not null,
  test_date date not null,
  ph numeric,
  buffer_ph numeric,
  om_pct numeric,
  cec numeric,
  p_ppm numeric,
  k_ppm numeric,
  ca_ppm numeric,
  mg_ppm numeric,
  s_ppm numeric,
  annual_n numeric,          -- planned lb N / 1000 sq ft / yr for this area
  lab text not null default '',
  notes text not null default '',
  extras jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists soil_tests_area_date_idx on public.soil_tests (area, test_date);

alter table public.soil_tests enable row level security;

drop policy if exists "soil_tests readable" on public.soil_tests;
create policy "soil_tests readable"
  on public.soil_tests for select to authenticated using (true);

drop policy if exists "soil_tests insertable" on public.soil_tests;
create policy "soil_tests insertable"
  on public.soil_tests for insert to authenticated with check (true);

drop policy if exists "soil_tests updatable" on public.soil_tests;
create policy "soil_tests updatable"
  on public.soil_tests for update to authenticated using (true) with check (true);

drop policy if exists "soil_tests deletable" on public.soil_tests;
create policy "soil_tests deletable"
  on public.soil_tests for delete to authenticated using (true);
