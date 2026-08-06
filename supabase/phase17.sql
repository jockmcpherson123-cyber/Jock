-- Phase 17 — two levels of notes on a crew job.
-- Adds a whole-crew note per task (group_note) alongside the existing per-person
-- note (notes). The board writes the same group_note across everyone on a job,
-- and each person keeps their own individual note in `notes`.
-- Safe to re-run.

alter table public.crew_tasks
  add column if not exists group_note text not null default '';
