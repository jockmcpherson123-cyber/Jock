-- ============================================================================
--  Grounds Operations — PHASE 34 (Budget: import settings)
-- ============================================================================
--  Run (once) in Supabase → SQL Editor. Safe to re-run.
--
--  Remembers how to read the club's uploaded files: which column is the GL
--  account, the date/period, the amount, the vendor, etc. (set on the first
--  Jonas upload and reused after), plus any "unmatched GL → budget line"
--  choices the CFO makes. Also stores the Jonas export column order (Phase 4).
-- ============================================================================
create table if not exists public.budget_import_config (
  source         text primary key,                 -- 'jonas' | 'ottimate'
  mapping        jsonb not null default '{}'::jsonb, -- { gl, date, amount, debit, credit, vendor, description, reference }
  gl_aliases     jsonb not null default '{}'::jsonb, -- { "RAW GL AS IN FILE": "612800-13" }
  export_columns jsonb,                             -- Phase 4: Jonas import column order
  updated_at     timestamptz not null default now()
);

alter table public.budget_import_config enable row level security;

drop policy if exists "import_config readable" on public.budget_import_config;
create policy "import_config readable"
  on public.budget_import_config for select to authenticated
  using (public.has_budget());

drop policy if exists "import_config writable by finance" on public.budget_import_config;
create policy "import_config writable by finance"
  on public.budget_import_config for all to authenticated
  using (public.has_budget_admin())
  with check (public.has_budget_admin());
