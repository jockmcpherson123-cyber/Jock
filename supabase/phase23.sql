-- Phase 23 — Irrigation symbol type (from the as-built legend).
-- Lets each placed object remember exactly which legend symbol it is
-- (e.g. 'inf34-346', 'ev-2', 'qc-1'), so the map can colour/label it and the
-- stamp palette can drop the right icon. Safe to re-run.

alter table public.irrigation_features add column if not exists symbol text;
