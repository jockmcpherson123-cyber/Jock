-- ============================================================================
--  Grounds Operations — Database schema, PHASE 33 (Budget Tracker)
-- ============================================================================
--
--  HOW TO RUN THIS (once): Supabase → SQL Editor → New query → paste → Run.
--  Safe to re-run (every statement is idempotent).
--
--  Adds the Budget section for Golf Courses & Grounds: the yearly plan, the
--  actual spend pulled in from the club's books, notes, forecasts and the
--  transfers that move money between lines. Also adds a new "finance" role for
--  the CFO and Accounting, who see ONLY the Budget section — no other part of
--  the app — and a budget-wide permission enforced here in the database (RLS),
--  not just in the screens.
--
--  WHO CAN SEE / DO WHAT (enforced by the two helper functions below):
--    • View everything, add notes, update forecasts, request transfers:
--        superintendent, director, finance
--    • Approve/decline transfers, upload actuals, upload/approve the yearly
--        budget, edit budget lines directly:
--        finance only
--  Every change the app makes is also written to budget_audit (who/when/old/new).
--
--  MONEY IS STORED AS INTEGER CENTS everywhere (amount_cents, *_cents). Never
--  round when importing — $1,234.56 is stored as 123456.
-- ============================================================================


-- ── 1. New "finance" role ────────────────────────────────────────────────────
-- Widen the CHECK so a profile may hold 'finance'. CFO and Accounting share this
-- single role; who did what is still tracked per-user through the audit log.
alter table public.profiles drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('operator', 'assistant', 'superintendent', 'director', 'finance'));


-- ── 2. Permission helpers ────────────────────────────────────────────────────
-- One place that decides budget access, reused by every policy below. Change the
-- role lists here and the whole section follows.

-- Can open the Budget section at all (view, notes, forecasts, transfer requests).
create or replace function public.has_budget()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_user_role() in ('superintendent', 'director', 'finance');
$$;

-- Can take the finance-only actions: approve/decline transfers, upload actuals,
-- upload/approve the yearly budget, edit budget lines directly.
create or replace function public.has_budget_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_user_role() = 'finance';
$$;


-- ── 3. Budget years ──────────────────────────────────────────────────────────
-- One row per fiscal year. The fiscal year runs Nov 1 → Oct 31, so FY2026 starts
-- 2025-11-01 and month index 1 = November.
create table if not exists public.budget_years (
  id          uuid primary key default gen_random_uuid(),
  fiscal_year int  not null unique,                 -- e.g. 2026
  starts_on   date not null,                        -- e.g. 2025-11-01
  status      text not null default 'draft'
              check (status in ('draft', 'submitted', 'approved')),
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  created_at  timestamptz not null default now()
);

alter table public.budget_years enable row level security;

drop policy if exists "budget_years readable" on public.budget_years;
create policy "budget_years readable"
  on public.budget_years for select to authenticated
  using (public.has_budget());

drop policy if exists "budget_years writable by finance" on public.budget_years;
create policy "budget_years writable by finance"
  on public.budget_years for all to authenticated
  using (public.has_budget_admin())
  with check (public.has_budget_admin());


-- ── 4. Budget lines (the GL lines) ─────────────────────────────────────────────
-- One row per GL line within a year. section is 'payroll' or 'operating';
-- group_key drives the card groups on screen (chem, equip, materials, …).
create table if not exists public.budget_lines (
  id          uuid primary key default gen_random_uuid(),
  year_id     uuid not null references public.budget_years (id) on delete cascade,
  gl_code     text not null,                        -- e.g. '612800-13'
  description text not null,
  section     text not null check (section in ('payroll', 'operating')),
  group_key   text not null default 'operating',
  sort        int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (year_id, gl_code)
);

create index if not exists budget_lines_year_idx on public.budget_lines (year_id);

alter table public.budget_lines enable row level security;

drop policy if exists "budget_lines readable" on public.budget_lines;
create policy "budget_lines readable"
  on public.budget_lines for select to authenticated
  using (public.has_budget());

drop policy if exists "budget_lines writable by finance" on public.budget_lines;
create policy "budget_lines writable by finance"
  on public.budget_lines for all to authenticated
  using (public.has_budget_admin())
  with check (public.has_budget_admin());


-- ── 5. Budget months (the approved plan) ───────────────────────────────────────
-- 12 rows per line: month_index 1..12 (1 = November), amount in cents. This is
-- the plan only — approved transfers are applied on top in the calc module, they
-- do NOT edit these rows.
create table if not exists public.budget_months (
  id           uuid primary key default gen_random_uuid(),
  line_id      uuid not null references public.budget_lines (id) on delete cascade,
  month_index  int  not null check (month_index between 1 and 12),
  amount_cents bigint not null default 0,
  unique (line_id, month_index)
);

create index if not exists budget_months_line_idx on public.budget_months (line_id);

alter table public.budget_months enable row level security;

drop policy if exists "budget_months readable" on public.budget_months;
create policy "budget_months readable"
  on public.budget_months for select to authenticated
  using (public.has_budget());

drop policy if exists "budget_months writable by finance" on public.budget_months;
create policy "budget_months writable by finance"
  on public.budget_months for all to authenticated
  using (public.has_budget_admin())
  with check (public.has_budget_admin());


-- ── 6. Import batches (one per uploaded file) ──────────────────────────────────
-- Created BEFORE actuals, because actuals.import_batch_id points at it.
create table if not exists public.import_batches (
  id              uuid primary key default gen_random_uuid(),
  source          text not null check (source in ('jonas', 'ottimate', 'manual')),
  file_name       text,
  period_through  date,
  uploaded_by     uuid references public.profiles (id) on delete set null,
  uploaded_at     timestamptz not null default now(),
  row_count       int not null default 0,
  unmatched_count int not null default 0
);

alter table public.import_batches enable row level security;

drop policy if exists "import_batches readable" on public.import_batches;
create policy "import_batches readable"
  on public.import_batches for select to authenticated
  using (public.has_budget());

drop policy if exists "import_batches writable by finance" on public.import_batches;
create policy "import_batches writable by finance"
  on public.import_batches for all to authenticated
  using (public.has_budget_admin())
  with check (public.has_budget_admin());


-- ── 7. Actuals (spend pulled from the books) ───────────────────────────────────
-- One row per posted/pending amount against a line in a month. source says where
-- it came from; status 'pending' = Ottimate invoice not yet in Jonas, 'posted' =
-- in Jonas. external_id / (date,gl,amount,reference) are used to dedupe uploads.
create table if not exists public.actuals (
  id              uuid primary key default gen_random_uuid(),
  line_id         uuid not null references public.budget_lines (id) on delete cascade,
  month_index     int  not null check (month_index between 1 and 12),
  amount_cents    bigint not null default 0,
  source          text not null default 'manual'
                  check (source in ('jonas', 'ottimate', 'manual')),
  status          text not null default 'posted'
                  check (status in ('posted', 'pending')),
  vendor          text,
  invoice_no      text,
  invoice_date    date,
  memo            text,
  external_id     text,
  import_batch_id uuid references public.import_batches (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists actuals_line_idx on public.actuals (line_id);
create index if not exists actuals_line_month_idx on public.actuals (line_id, month_index);

alter table public.actuals enable row level security;

drop policy if exists "actuals readable" on public.actuals;
create policy "actuals readable"
  on public.actuals for select to authenticated
  using (public.has_budget());

drop policy if exists "actuals writable by finance" on public.actuals;
create policy "actuals writable by finance"
  on public.actuals for all to authenticated
  using (public.has_budget_admin())
  with check (public.has_budget_admin());


-- ── 8. Forecasts (history kept; latest wins) ───────────────────────────────────
create table if not exists public.forecasts (
  id             uuid primary key default gen_random_uuid(),
  line_id        uuid not null references public.budget_lines (id) on delete cascade,
  year_end_cents bigint not null,
  note           text,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists forecasts_line_idx on public.forecasts (line_id, created_at desc);

alter table public.forecasts enable row level security;

drop policy if exists "forecasts readable" on public.forecasts;
create policy "forecasts readable"
  on public.forecasts for select to authenticated
  using (public.has_budget());

-- Anyone with budget access may add a forecast; history is immutable (no update
-- or delete policy), so each update is a new row and the latest one wins.
drop policy if exists "forecasts insertable" on public.forecasts;
create policy "forecasts insertable"
  on public.forecasts for insert to authenticated
  with check (public.has_budget() and created_by = auth.uid());


-- ── 9. Transfers (move money between lines) ────────────────────────────────────
-- A request lowers one line and raises another by the same amount. The total
-- budget never changes. Only finance can approve/decline.
create table if not exists public.transfers (
  id            uuid primary key default gen_random_uuid(),
  year_id       uuid not null references public.budget_years (id) on delete cascade,
  from_line_id  uuid not null references public.budget_lines (id) on delete cascade,
  to_line_id    uuid not null references public.budget_lines (id) on delete cascade,
  amount_cents  bigint not null,
  reason        text,
  status        text not null default 'pending'
                check (status in ('pending', 'approved', 'declined')),
  effective_month int check (effective_month between 1 and 12),  -- month the move lands (default: approval month)
  requested_by  uuid references public.profiles (id) on delete set null,
  requested_at  timestamptz not null default now(),
  decided_by    uuid references public.profiles (id) on delete set null,
  decided_at    timestamptz,
  decision_note text
);

create index if not exists transfers_year_idx on public.transfers (year_id);

alter table public.transfers enable row level security;

drop policy if exists "transfers readable" on public.transfers;
create policy "transfers readable"
  on public.transfers for select to authenticated
  using (public.has_budget());

-- Anyone with budget access may REQUEST a transfer (as themselves, pending).
drop policy if exists "transfers requestable" on public.transfers;
create policy "transfers requestable"
  on public.transfers for insert to authenticated
  with check (public.has_budget() and requested_by = auth.uid() and status = 'pending');

-- Only finance may decide (approve/decline) a transfer.
drop policy if exists "transfers decidable by finance" on public.transfers;
create policy "transfers decidable by finance"
  on public.transfers for update to authenticated
  using (public.has_budget_admin())
  with check (public.has_budget_admin());


-- ── 10. Line notes (a thread per line) ─────────────────────────────────────────
-- read_by holds the user ids that have opened the note, so each side can show an
-- unread badge for the other side's notes.
create table if not exists public.line_notes (
  id         uuid primary key default gen_random_uuid(),
  line_id    uuid not null references public.budget_lines (id) on delete cascade,
  author_id  uuid references public.profiles (id) on delete set null,
  body       text not null,
  read_by    uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists line_notes_line_idx on public.line_notes (line_id, created_at);

alter table public.line_notes enable row level security;

drop policy if exists "line_notes readable" on public.line_notes;
create policy "line_notes readable"
  on public.line_notes for select to authenticated
  using (public.has_budget());

drop policy if exists "line_notes insertable" on public.line_notes;
create policy "line_notes insertable"
  on public.line_notes for insert to authenticated
  with check (public.has_budget() and author_id = auth.uid());

-- Updates are only to mark a note read (append to read_by); any budget user may.
drop policy if exists "line_notes markable read" on public.line_notes;
create policy "line_notes markable read"
  on public.line_notes for update to authenticated
  using (public.has_budget())
  with check (public.has_budget());


-- ── 11. Audit log (who / when / old → new) ─────────────────────────────────────
create table if not exists public.budget_audit (
  id         uuid primary key default gen_random_uuid(),
  table_name text not null,
  row_id     uuid,
  field      text,
  old_value  text,
  new_value  text,
  user_id    uuid references public.profiles (id) on delete set null,
  at         timestamptz not null default now()
);

create index if not exists budget_audit_at_idx on public.budget_audit (at desc);

alter table public.budget_audit enable row level security;

drop policy if exists "budget_audit readable" on public.budget_audit;
create policy "budget_audit readable"
  on public.budget_audit for select to authenticated
  using (public.has_budget());

-- The app writes an audit row for each change, as the acting user.
drop policy if exists "budget_audit insertable" on public.budget_audit;
create policy "budget_audit insertable"
  on public.budget_audit for insert to authenticated
  with check (public.has_budget() and user_id = auth.uid());


-- ============================================================================
--  NOTE on the finance role: a 'finance' user (CFO / Accounting) is meant to see
--  ONLY the Budget section. The screens hide every other menu for them; this
--  file governs the budget tables. Existing non-budget tables keep their current
--  policies (unchanged), and no individual payroll detail ever enters the app.
--
--  To make someone finance, after they have a login:
--      update public.profiles set role = 'finance'
--      where id = (select id from auth.users where email = 'cfo@ccclub.org');
-- ============================================================================
