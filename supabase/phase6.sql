-- ============================================================================
--  Grounds Operations — Database schema, PHASE 6 (Grass types)
-- ============================================================================
--
--  HOW TO RUN THIS (once): Supabase → SQL Editor → New query → paste → Run.
--  Safe to re-run.
--
--  Adds a configurable list of grass types. Which grasses are on each area lives
--  inside the areas jsonb, and which grasses a product can damage lives inside
--  the product jsonb — so only this one list needs a column.
-- ============================================================================

alter table public.app_settings
  add column if not exists grass_types jsonb not null default '[]'::jsonb;

update public.app_settings
set grass_types = '["Bentgrass","Poa Annua","Perennial Ryegrass","Kentucky Bluegrass","Tall Fescue","Fine Fescue","Bermudagrass","Zoysiagrass"]'::jsonb
where id = 1 and (grass_types is null or grass_types = '[]'::jsonb);
