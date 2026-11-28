-- ============================================================================
--  Grounds Operations — Database schema, PHASE 43 (Deliveries + stock log)
-- ============================================================================
--
--  HOW TO RUN THIS (once): Supabase → SQL Editor → New query → paste → Run.
--  Safe to re-run.
--
--  Two stores behind the richer Inventory "Receive delivery" flow and the
--  per-product stock movement log:
--
--   1. stock_deliveries — a real receiving record: one row per delivery
--      (date, vendor, invoice #) with its product lines in a JSONB column, so
--      new line fields never need another migration. Each line carries
--      cases / units-per-case / oz-per-unit (→ computed oz), cost per case,
--      whether it was Planned or Extra (with a reason for Extra), and an
--      optional link to the spray sheet it was bought for.
--
--      NOTE: this is deliberately separate from Finance. Delivery cost is for
--      the grounds team's own ordering picture only and never feeds Budget.
--
--   2. stock_adjustments — manual corrections entered from the movement log
--      (spillage, a miscount caught later, product written off). A signed qty
--      in the product's own stock unit, with a reason.
--
--  The legacy public.deliveries table (phase 1) is left untouched; its old
--  rows still appear in the delivery history as simple single-line receipts.
-- ============================================================================

-- ── Stock deliveries (rich receiving records) ───────────────────────────────
create table if not exists public.stock_deliveries (
  id          uuid primary key default gen_random_uuid(),
  received_on date,
  vendor      text,
  invoice     text,
  -- { lines: [{ id, product, cases, ozPerCase, oz, costPerCase,
  --             kind: 'planned'|'extra', reason, linkedSheetId }], note }
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists stock_deliveries_received_idx
  on public.stock_deliveries (received_on desc);

alter table public.stock_deliveries enable row level security;

drop policy if exists "stock_deliveries readable by authenticated" on public.stock_deliveries;
create policy "stock_deliveries readable by authenticated"
  on public.stock_deliveries for select to authenticated using (true);

drop policy if exists "stock_deliveries writable by managers" on public.stock_deliveries;
create policy "stock_deliveries writable by managers"
  on public.stock_deliveries for all to authenticated
  using (public.current_user_role() in ('superintendent', 'director'))
  with check (public.current_user_role() in ('superintendent', 'director'));


-- ── Stock adjustments (manual corrections) ──────────────────────────────────
create table if not exists public.stock_adjustments (
  id          uuid primary key default gen_random_uuid(),
  product     text not null,
  adjusted_on date,
  -- Signed change applied to on-hand, in the product's own stock unit
  -- (negative = removed, positive = added back).
  qty         numeric,
  unit        text,
  reason      text,
  created_at  timestamptz not null default now()
);

create index if not exists stock_adjustments_product_idx
  on public.stock_adjustments (product);
create index if not exists stock_adjustments_adjusted_idx
  on public.stock_adjustments (adjusted_on desc);

alter table public.stock_adjustments enable row level security;

drop policy if exists "stock_adjustments readable by authenticated" on public.stock_adjustments;
create policy "stock_adjustments readable by authenticated"
  on public.stock_adjustments for select to authenticated using (true);

drop policy if exists "stock_adjustments writable by managers" on public.stock_adjustments;
create policy "stock_adjustments writable by managers"
  on public.stock_adjustments for all to authenticated
  using (public.current_user_role() in ('superintendent', 'director'))
  with check (public.current_user_role() in ('superintendent', 'director'));
