-- ============================================================================
--  Grounds Operations — Database schema, PHASE 11 (Cultural practices)
-- ============================================================================
--
--  HOW TO RUN THIS (once): Supabase → SQL Editor → New query → paste → Run.
--  Safe to re-run.
--
--  Cultural-practice log — the non-spray work that shapes the turf: mowing,
--  rolling, brushing, grooming, verticutting, topdressing, aerifying, and so on.
--  Logged per area per date (optionally with a value like passes or height) so it
--  sits alongside sprays, clippings and GDD in the record and the trends.
-- ============================================================================

create table if not exists public.cultural_practices (
  id uuid primary key default gen_random_uuid(),
  area text not null,
  practice text not null,
  practice_date date not null,
  value numeric,
  unit text not null default '',
  notes text not null default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists cultural_practices_date_idx on public.cultural_practices (practice_date);
create index if not exists cultural_practices_area_date_idx on public.cultural_practices (area, practice_date);

alter table public.cultural_practices enable row level security;

-- Everyone signed in can read the practice history.
drop policy if exists "cultural_practices readable" on public.cultural_practices;
create policy "cultural_practices readable"
  on public.cultural_practices for select to authenticated using (true);

-- Any signed-in crew member can log, edit, or remove a practice entry.
drop policy if exists "cultural_practices insertable" on public.cultural_practices;
create policy "cultural_practices insertable"
  on public.cultural_practices for insert to authenticated with check (true);

drop policy if exists "cultural_practices updatable" on public.cultural_practices;
create policy "cultural_practices updatable"
  on public.cultural_practices for update to authenticated using (true) with check (true);

drop policy if exists "cultural_practices deletable" on public.cultural_practices;
create policy "cultural_practices deletable"
  on public.cultural_practices for delete to authenticated using (true);
