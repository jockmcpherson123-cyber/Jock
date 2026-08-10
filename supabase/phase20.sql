-- Phase 20 — Scouting log.
-- A dated, photo-backed record of what you find on the course: disease, weeds,
-- insects, wear, or anything worth noting, tagged by area. Builds a scouting
-- history the team can look back on. Photos are stored inline (compressed data
-- URLs) so no separate file storage is needed. Safe to re-run.

create table if not exists public.scouting (
  id uuid primary key default gen_random_uuid(),
  area text not null default '',
  observed_date date not null,
  kind text not null default 'Other',        -- Disease | Weed | Insect | Wear | Other
  target text not null default '',            -- e.g. "Dollar Spot", "Poa Annua"
  severity text not null default '',          -- Low | Moderate | High
  notes text not null default '',
  photo text not null default '',             -- compressed image data URL
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists scouting_date_idx on public.scouting (observed_date desc);
create index if not exists scouting_area_idx on public.scouting (area);

alter table public.scouting enable row level security;

drop policy if exists "scouting readable" on public.scouting;
create policy "scouting readable"
  on public.scouting for select to authenticated using (true);

drop policy if exists "scouting insertable" on public.scouting;
create policy "scouting insertable"
  on public.scouting for insert to authenticated with check (true);

drop policy if exists "scouting updatable" on public.scouting;
create policy "scouting updatable"
  on public.scouting for update to authenticated using (true) with check (true);

drop policy if exists "scouting deletable" on public.scouting;
create policy "scouting deletable"
  on public.scouting for delete to authenticated using (true);
