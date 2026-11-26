-- ---------------------------------------------------------------------------
--  Phase 42 — allow more area types on the Course Map
--
--  The original areas table (phase38) pinned `type` to a fixed list:
--     check (type in ('green','approach','fairway','tee','bunker','other'))
--  Since then the map gained Rough, Natives and Water, plus user-defined
--  custom type names (with colours handled in the app settings). Saving an
--  area of any of those types failed the old CHECK, so the insert was
--  rejected. Relax the constraint to accept any short, non-empty type string.
-- ---------------------------------------------------------------------------

alter table public.areas drop constraint if exists areas_type_check;

alter table public.areas
  add constraint areas_type_check
  check (type is not null and char_length(type) between 1 and 40);
