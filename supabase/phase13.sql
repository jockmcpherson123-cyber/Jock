-- ============================================================================
--  Grounds Operations — Database schema, PHASE 13 (Crew Whiteboard)
-- ============================================================================
--
--  HOW TO RUN THIS (once): Supabase → SQL Editor → New query → paste → Run.
--  Safe to re-run.
--
--  The morning crew board — who's doing what today. Each row is one job for one
--  day: what it is, where, who's on it, what equipment, and how it's going
--  (to do / doing / done), with optional minutes so we can look at how long
--  jobs take later. This is the raw daily-jobs log that the efficiency and
--  trend views will be built from.
-- ============================================================================

create table if not exists public.crew_tasks (
  id uuid primary key default gen_random_uuid(),
  task_date date not null,
  job text not null,
  area text not null default '',
  assignee text not null default '',
  equipment text not null default '',
  status text not null default 'todo',   -- 'todo' | 'doing' | 'done'
  minutes numeric,
  sort int not null default 0,
  notes text not null default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Which course the job is on (multi-course clubs); '' = whole property / single
-- course. Added separately so re-running on an existing table picks it up.
alter table public.crew_tasks add column if not exists course text not null default '';

create index if not exists crew_tasks_date_idx on public.crew_tasks (task_date);
create index if not exists crew_tasks_assignee_date_idx on public.crew_tasks (assignee, task_date);

alter table public.crew_tasks enable row level security;

-- Everyone signed in can read the board.
drop policy if exists "crew_tasks readable" on public.crew_tasks;
create policy "crew_tasks readable"
  on public.crew_tasks for select to authenticated using (true);

-- Any signed-in crew member can add, update (e.g. mark done), or remove a task.
drop policy if exists "crew_tasks insertable" on public.crew_tasks;
create policy "crew_tasks insertable"
  on public.crew_tasks for insert to authenticated with check (true);

drop policy if exists "crew_tasks updatable" on public.crew_tasks;
create policy "crew_tasks updatable"
  on public.crew_tasks for update to authenticated using (true) with check (true);

drop policy if exists "crew_tasks deletable" on public.crew_tasks;
create policy "crew_tasks deletable"
  on public.crew_tasks for delete to authenticated using (true);

-- Broadcast row changes over Realtime so the live TV board updates instantly.
-- (Idempotent: only add the table to the publication if it isn't already there.)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'crew_tasks'
  ) then
    alter publication supabase_realtime add table public.crew_tasks;
  end if;
end $$;
