-- Phase 24 — Drawn map shapes: surfaces (greens/tees/bunkers/water…) and pipe
-- lines you add on the Course Map. Makes the map a one-stop edit shop alongside
-- the head/valve objects. Points are stored as [[lat,lng],…]. Safe to re-run.

create table if not exists public.course_shapes (
  id uuid primary key default gen_random_uuid(),
  shape text not null default 'area',        -- 'area' (polygon) | 'line' (polyline)
  kind text not null default 'fairway',      -- surface type, or pipe size class
  color text not null default '',            -- display colour (hex)
  points jsonb not null default '[]'::jsonb, -- [[lat,lng],…]
  label text not null default '',
  notes text not null default '',
  source text not null default 'draw',       -- draw | import
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists course_shapes_shape_idx on public.course_shapes (shape);

alter table public.course_shapes enable row level security;

drop policy if exists "shapes readable" on public.course_shapes;
create policy "shapes readable" on public.course_shapes for select to authenticated using (true);

drop policy if exists "shapes insertable" on public.course_shapes;
create policy "shapes insertable" on public.course_shapes for insert to authenticated with check (true);

drop policy if exists "shapes updatable" on public.course_shapes;
create policy "shapes updatable" on public.course_shapes for update to authenticated using (true) with check (true);

drop policy if exists "shapes deletable" on public.course_shapes;
create policy "shapes deletable" on public.course_shapes for delete to authenticated using (true);
