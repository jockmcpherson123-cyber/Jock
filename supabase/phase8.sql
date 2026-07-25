-- ============================================================================
--  Grounds Operations — Database schema, PHASE 8 (Director approval PINs)
-- ============================================================================
--
--  HOW TO RUN THIS (once): Supabase → SQL Editor → New query → paste → Run.
--  Safe to re-run.
--
--  Stores each director's private approval PIN, keyed by name:
--    { "Mark Gates": "1234", "Ryan Geils": "5580" }
--
--  A director types their PIN (and draws a signature) to approve a spray sheet,
--  proving it was really them even on a shared iPad. The director's drawn
--  signature is stored on each spray sheet's own jsonb (no column needed here).
--
--  NOTE: these are low-stakes internal approval codes, not account passwords —
--  they are stored as plain text in this settings row.
-- ============================================================================

alter table public.app_settings
  add column if not exists director_pins jsonb not null default '{}'::jsonb;
