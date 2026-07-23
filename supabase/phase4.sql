-- ============================================================================
--  Grounds Operations — Database schema, PHASE 4 (Field crew permissions)
-- ============================================================================
--
--  HOW TO RUN THIS (once): Supabase → SQL Editor → New query → paste → Run.
--  Safe to re-run.
--
--  Lets the field crew (operator role) do their job on the iPads WITHOUT giving
--  them the whole app: they can log a spray (weather, who sprayed, mark it
--  sprayed) on APPROVED sheets, and check off inventory (log deliveries, adjust
--  stock). They still cannot touch the annual program, chemical-library
--  definitions, settings, or approvals — those stay manager-only.
--
--  The "completed / sprayed" state lives inside the sheet's data (jsonb), so no
--  columns change here — this file is purely about permissions.
-- ============================================================================

-- Crew may update an APPROVED sheet (to log weather + mark it sprayed). The
-- WITH CHECK keeps status = 'approved' so they can't un-approve or re-route it.
drop policy if exists "sheets loggable by field crew" on public.spray_sheets;
create policy "sheets loggable by field crew"
  on public.spray_sheets for update to authenticated
  using (status = 'approved')
  with check (status = 'approved');

-- Crew may log deliveries (receiving / checking off stock).
drop policy if exists "deliveries loggable by field crew" on public.deliveries;
create policy "deliveries loggable by field crew"
  on public.deliveries for insert to authenticated
  with check (true);

-- Crew may adjust product stock counts (inventory check-off / auto-deduction).
drop policy if exists "product stock updatable by field crew" on public.products;
create policy "product stock updatable by field crew"
  on public.products for update to authenticated
  using (true)
  with check (true);
