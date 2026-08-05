-- Phase 16 — job "rounds" on the crew board.
-- Adds a slot to each crew task so the board can show 1st / 2nd / 3rd jobs
-- (morning, afternoon, and later runs) as separate sections through the day.
-- Safe to re-run.

alter table public.crew_tasks
  add column if not exists slot text not null default '1';   -- '1' | '2' | '3'

create index if not exists crew_tasks_slot_idx on public.crew_tasks (task_date, slot);
