-- ============================================================================
--  Grounds Operations — Database schema, PHASE 10 (Clipping yields)
-- ============================================================================
--
--  HOW TO RUN THIS (once): Supabase → SQL Editor → New query → paste → Run.
--  Safe to re-run.
--
--  Clipping yield logs — volume of clippings collected off an area on a date.
--  This is the gold-standard feedback for growth-regulator performance, tracked
--  over time per area.
-- ============================================================================

create table if not exists public.clippings (
  id uuid primary key default gen_random_uuid(),
  area text not null,
  clip_date date not null,
  volume numeric,
  unit text not null default 'L',
  notes text not null default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists clippings_area_date_idx on public.clippings (area, clip_date);

alter table public.clippings enable row level security;

-- Everyone signed in can read the clipping history.
drop policy if exists "clippings readable" on public.clippings;
create policy "clippings readable"
  on public.clippings for select to authenticated using (true);

-- Any signed-in crew member can log, edit, or remove a clipping entry.
drop policy if exists "clippings insertable" on public.clippings;
create policy "clippings insertable"
  on public.clippings for insert to authenticated with check (true);

drop policy if exists "clippings updatable" on public.clippings;
create policy "clippings updatable"
  on public.clippings for update to authenticated using (true) with check (true);

drop policy if exists "clippings deletable" on public.clippings;
create policy "clippings deletable"
  on public.clippings for delete to authenticated using (true);
