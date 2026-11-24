-- ============================================================================
--  Grounds Operations — PHASE 37 (Course Map: imagery storage bucket)
-- ============================================================================
--  Run (once) in Supabase → SQL Editor, AFTER phase36.sql. Safe to re-run.
--
--  A PRIVATE Storage bucket for aerial photos, with club-scoped access: every
--  file is stored under a top folder named for the club id, and the policies
--  below only let a user read/write files under THEIR club's folder. That is
--  what stops another club seeing this club's photo (as a file, not just a row).
-- ============================================================================

insert into storage.buckets (id, name, public)
  values ('imagery', 'imagery', false)
  on conflict (id) do nothing;

-- Read a photo only if it sits under your own club's folder.
drop policy if exists "imagery storage read own club" on storage.objects;
create policy "imagery storage read own club"
  on storage.objects for select to authenticated
  using (bucket_id = 'imagery' and (storage.foldername(name))[1] = public.my_club()::text);

-- Managers may upload / change / remove photos under their own club's folder.
drop policy if exists "imagery storage write managers" on storage.objects;
create policy "imagery storage write managers"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'imagery' and (storage.foldername(name))[1] = public.my_club()::text and public.is_grounds_manager());

drop policy if exists "imagery storage update managers" on storage.objects;
create policy "imagery storage update managers"
  on storage.objects for update to authenticated
  using (bucket_id = 'imagery' and (storage.foldername(name))[1] = public.my_club()::text and public.is_grounds_manager())
  with check (bucket_id = 'imagery' and (storage.foldername(name))[1] = public.my_club()::text and public.is_grounds_manager());

drop policy if exists "imagery storage delete managers" on storage.objects;
create policy "imagery storage delete managers"
  on storage.objects for delete to authenticated
  using (bucket_id = 'imagery' and (storage.foldername(name))[1] = public.my_club()::text and public.is_grounds_manager());
