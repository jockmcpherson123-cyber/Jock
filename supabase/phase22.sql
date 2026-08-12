-- Phase 22 — Head arc + radius (from the on-head compass tool).
-- Lay the phone flat on a head, set 0° at the start of the throw, sweep to the
-- end; the app records the arc (degrees). Radius (throw, ft) can be stored too.
-- Safe to re-run.

alter table public.irrigation_features add column if not exists arc double precision;
alter table public.irrigation_features add column if not exists arc_start double precision;
alter table public.irrigation_features add column if not exists radius double precision;
