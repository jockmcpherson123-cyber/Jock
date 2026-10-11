-- Phase 29 — Inventory counts / audit (build brief §C1).
-- A physical count sheet: the counted quantity per product, the computed stock
-- at the time, the variance, and who counted it. Applying a count also updates
-- the product's stock (done in the app via upsertProduct); this table is the
-- audit trail of every adjustment. Safe to re-run.

create table if not exists public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  counted_at timestamptz not null default now(),
  counted_by text not null default '',
  product text not null,
  prev_stock numeric,                      -- computed stock before the count
  counted_stock numeric,                   -- what was physically counted
  variance numeric,                        -- counted - prev
  unit text not null default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists inventory_counts_at_idx on public.inventory_counts (counted_at desc);

alter table public.inventory_counts enable row level security;

drop policy if exists "inventory_counts readable" on public.inventory_counts;
create policy "inventory_counts readable"
  on public.inventory_counts for select to authenticated using (true);

-- Managers (who can change stock) record counts.
drop policy if exists "inventory_counts writable by managers" on public.inventory_counts;
create policy "inventory_counts writable by managers"
  on public.inventory_counts for all to authenticated
  using (public.current_user_role() in ('superintendent', 'director'))
  with check (public.current_user_role() in ('superintendent', 'director'));
