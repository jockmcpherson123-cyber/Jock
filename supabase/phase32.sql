-- ============================================================================
--  Grounds Operations — Database schema, PHASE 32 (Assistant Superintendent role)
-- ============================================================================
--
--  HOW TO RUN THIS (once): Supabase → SQL Editor → New query → paste → Run.
--  Safe to re-run.
--
--  Adds a fourth role, "assistant" (Assistant Superintendent), between operator
--  and superintendent. It can manage the app (build plans, sheets, library,
--  settings and logins) but cannot give final approval — that stays with the
--  Director. Widening the CHECK lets a profile hold the new value.
-- ============================================================================

alter table public.profiles drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('operator', 'assistant', 'superintendent', 'director'));
