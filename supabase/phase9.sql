-- ============================================================================
--  Grounds Operations — Database schema, PHASE 9 (Soil types)
-- ============================================================================
--
--  HOW TO RUN THIS (once): Supabase → SQL Editor → New query → paste → Run.
--  Safe to re-run.
--
--  Adds a configurable list of soil types. Which soil each area has lives inside
--  the areas jsonb (area.soilType), so only this one list needs a column. The
--  agronomy engine uses soil type to inform rate/timing suggestions.
-- ============================================================================

alter table public.app_settings
  add column if not exists soil_types jsonb not null default '[]'::jsonb;

update public.app_settings
set soil_types = '["Sand-based","Native/Push-up","Sandy Loam","Loam","Clay Loam","Clay"]'::jsonb
where id = 1 and (soil_types is null or soil_types = '[]'::jsonb);
