-- ============================================================================
--  Grounds Operations — Database schema, PHASE 5 (Live sheets)
-- ============================================================================
--
--  HOW TO RUN THIS (once): Supabase → SQL Editor → New query → paste → Run.
--  Safe to re-run.
--
--  Turns on real-time updates for spray sheets, so several iPads open on the
--  same sheet see each other's product/tank check-offs live. Row-level security
--  still applies to the live stream — a viewer only receives changes for sheets
--  they're allowed to see.
--
--  The check-off state (which products are in the tank, which tank you're on)
--  lives inside the sheet's jsonb — no columns change here.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'spray_sheets'
  ) then
    execute 'alter publication supabase_realtime add table public.spray_sheets';
  end if;
end $$;
