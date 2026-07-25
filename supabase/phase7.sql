-- ============================================================================
--  Grounds Operations — Database schema, PHASE 7 (Applicator licenses)
-- ============================================================================
--
--  HOW TO RUN THIS (once): Supabase → SQL Editor → New query → paste → Run.
--  Safe to re-run.
--
--  Stores each applicator's pesticide and fertilizer license numbers so they
--  can be attached to a spray sheet at sign-off. The map is keyed by the
--  applicator's name:
--    { "Jock McPherson": { "pesticide": "MD-12345", "fertilizer": "F-678" } }
--
--  The signature the applicator draws on the iPad lives inside each spray
--  sheet's own jsonb (no column needed here).
-- ============================================================================

alter table public.app_settings
  add column if not exists applicator_licenses jsonb not null default '{}'::jsonb;
