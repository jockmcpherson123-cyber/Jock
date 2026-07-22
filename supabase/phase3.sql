-- ============================================================================
--  Grounds Operations — Database schema, PHASE 3 (Weather / location)
-- ============================================================================
--
--  HOW TO RUN THIS (once): Supabase → SQL Editor → New query → paste → Run.
--  Safe to re-run.
--
--  Adds an editable club location to the settings so weather can be pulled for
--  the correct spot. Designed so that when the app becomes multi-club, each
--  club simply stores its own location — nothing here is hardcoded to one club.
-- ============================================================================

-- Location lives on the single settings row as a jsonb blob:
--   { address, lat, lng, timezone }
alter table public.app_settings
  add column if not exists location jsonb not null default '{}'::jsonb;

-- Seed the current club's location (only if not already set).
update public.app_settings
set location = '{"address":"8500 River Road, Bethesda, MD 20817","lat":38.9726,"lng":-77.1735,"timezone":"America/New_York"}'::jsonb
where id = 1 and (location is null or location = '{}'::jsonb);
