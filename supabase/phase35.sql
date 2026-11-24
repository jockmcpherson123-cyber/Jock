-- ============================================================================
--  Grounds Operations — PHASE 35 (Budget: build-next-year permissions)
-- ============================================================================
--  Run (once) in Supabase → SQL Editor. Safe to re-run.
--
--  Phase 33 made budget_years / budget_lines / budget_months writable by finance
--  only. Building NEXT year's budget is grounds' job (Superintendent / Director
--  draft it, then the CFO approves), so these policies now let any budget user
--  edit a year while it is 'draft' or 'submitted', and submit it — but only
--  finance may APPROVE it (move it to 'approved') or edit it afterwards. That
--  keeps an approved year locked except to the CFO, exactly as the spec's
--  permission table says.
-- ============================================================================

-- ── budget_years ──────────────────────────────────────────────────────────────
drop policy if exists "budget_years writable by finance" on public.budget_years;

drop policy if exists "budget_years insert" on public.budget_years;
create policy "budget_years insert"
  on public.budget_years for insert to authenticated
  with check (public.has_budget_admin() or (public.has_budget() and status = 'draft'));

-- Grounds may move a draft/submitted year around (incl. submit); only finance
-- may set it to 'approved' or touch it once approved.
drop policy if exists "budget_years update" on public.budget_years;
create policy "budget_years update"
  on public.budget_years for update to authenticated
  using (public.has_budget_admin() or (public.has_budget() and status in ('draft', 'submitted')))
  with check (public.has_budget_admin() or (public.has_budget() and status in ('draft', 'submitted')));

drop policy if exists "budget_years delete by finance" on public.budget_years;
create policy "budget_years delete by finance"
  on public.budget_years for delete to authenticated
  using (public.has_budget_admin());

-- ── budget_lines ────────────────────────────────────────────────────────────────
drop policy if exists "budget_lines writable by finance" on public.budget_lines;
create policy "budget_lines writable"
  on public.budget_lines for all to authenticated
  using (
    public.has_budget_admin() or (public.has_budget() and exists (
      select 1 from public.budget_years y where y.id = budget_lines.year_id and y.status in ('draft', 'submitted')))
  )
  with check (
    public.has_budget_admin() or (public.has_budget() and exists (
      select 1 from public.budget_years y where y.id = budget_lines.year_id and y.status in ('draft', 'submitted')))
  );

-- ── budget_months ─────────────────────────────────────────────────────────────
drop policy if exists "budget_months writable by finance" on public.budget_months;
create policy "budget_months writable"
  on public.budget_months for all to authenticated
  using (
    public.has_budget_admin() or (public.has_budget() and exists (
      select 1 from public.budget_lines l join public.budget_years y on y.id = l.year_id
      where l.id = budget_months.line_id and y.status in ('draft', 'submitted')))
  )
  with check (
    public.has_budget_admin() or (public.has_budget() and exists (
      select 1 from public.budget_lines l join public.budget_years y on y.id = l.year_id
      where l.id = budget_months.line_id and y.status in ('draft', 'submitted')))
  );
