-- ============================================================================
--  Grounds Operations — Database schema, PHASE 2 (Annual Program)
-- ============================================================================
--
--  HOW TO RUN THIS (once): Supabase → SQL Editor → New query → paste → Run.
--  Safe to re-run.
--
--  Adds the tables for the season-long spray program: a SeasonProgram (one per
--  year) and the planned applications within it. This is what the Excel import
--  fills, and what the "Annual Program" screen reads and edits.
--
--  Note: products gained extra fields (manufacturer, active ingredient, case
--  size, cost per case, vendor, etc.) but those live in the products.data jsonb
--  column, so NO product-table change is needed here.
-- ============================================================================


-- ── Season programs (one per year) ──────────────────────────────────────────
create table if not exists public.season_programs (
  id         uuid primary key default gen_random_uuid(),
  year       int,
  name       text,
  status     text not null default 'active' check (status in ('draft', 'active', 'archived')),
  created_at timestamptz not null default now()
);

alter table public.season_programs enable row level security;

drop policy if exists "programs readable by authenticated" on public.season_programs;
create policy "programs readable by authenticated"
  on public.season_programs for select to authenticated using (true);

drop policy if exists "programs writable by managers" on public.season_programs;
create policy "programs writable by managers"
  on public.season_programs for all to authenticated
  using (public.current_user_role() in ('superintendent', 'director'))
  with check (public.current_user_role() in ('superintendent', 'director'));


-- ── Planned applications within a program ───────────────────────────────────
create table if not exists public.program_applications (
  id             uuid primary key default gen_random_uuid(),
  program_id     uuid not null references public.season_programs (id) on delete cascade,
  area           text,
  product        text,
  rate_oz_m      numeric,
  rate_oz_a      numeric,
  basis          text default 'oz / M',
  type           text,
  target         text,
  planned_date   date,   -- date to run it this season
  template_date  date,   -- original baseline date (for year-over-year shifting)
  linked_sheet_id uuid references public.spray_sheets (id) on delete set null,
  data           jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists program_applications_program_idx
  on public.program_applications (program_id);
create index if not exists program_applications_area_idx
  on public.program_applications (program_id, area);

alter table public.program_applications enable row level security;

drop policy if exists "applications readable by authenticated" on public.program_applications;
create policy "applications readable by authenticated"
  on public.program_applications for select to authenticated using (true);

drop policy if exists "applications writable by managers" on public.program_applications;
create policy "applications writable by managers"
  on public.program_applications for all to authenticated
  using (public.current_user_role() in ('superintendent', 'director'))
  with check (public.current_user_role() in ('superintendent', 'director'));
