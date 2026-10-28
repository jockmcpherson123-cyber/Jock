-- ============================================================================
--  Grounds Operations — Database schema, PHASE 31 (Inventory count log)
-- ============================================================================
--
--  HOW TO RUN THIS (once): Supabase → SQL Editor → New query → paste → Run.
--  Safe to re-run.
--
--  The Inventory Count screen logs every physical count so stock changes have an
--  audit trail ("every change is logged"). The app reads/writes
--  public.inventory_counts, but the table was never created — so counts failed
--  and every product read as 0 on hand, which in turn zeroed the Early Order
--  "net of stock", the spray-sheet short-stock warnings and the tank checks.
--  This creates the table with the exact columns lib/db.js expects.
-- ============================================================================

create table if not exists public.inventory_counts (
  id            uuid primary key default gen_random_uuid(),
  counted_at    timestamptz not null default now(),
  counted_by    text,
  product       text not null,
  prev_stock    numeric,
  counted_stock numeric,
  variance      numeric,
  -- What the counted amount was measured in (e.g. "oz", "cases", "jugs").
  unit          text,
  created_at    timestamptz not null default now()
);

create index if not exists inventory_counts_product_idx on public.inventory_counts (product);
create index if not exists inventory_counts_counted_at_idx on public.inventory_counts (counted_at desc);

alter table public.inventory_counts enable row level security;

-- Everyone signed in can read the count history.
drop policy if exists "inventory_counts readable by authenticated" on public.inventory_counts;
create policy "inventory_counts readable by authenticated"
  on public.inventory_counts for select to authenticated using (true);

-- Only superintendents and directors can record counts.
drop policy if exists "inventory_counts writable by managers" on public.inventory_counts;
create policy "inventory_counts writable by managers"
  on public.inventory_counts for all to authenticated
  using (public.current_user_role() in ('superintendent', 'director'))
  with check (public.current_user_role() in ('superintendent', 'director'));
