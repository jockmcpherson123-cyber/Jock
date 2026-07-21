-- ============================================================================
--  Grounds Operations — Database schema, PHASE 1 (Spray Ops)
-- ============================================================================
--
--  HOW TO RUN THIS (once):
--    Supabase → SQL Editor → New query → paste this whole file → Run.
--    Safe to re-run: it only creates things that don't already exist and only
--    seeds rows that aren't there yet.
--
--  This builds on Phase 0 (the profiles table + roles). It adds the tables the
--  Spray Ops module needs, locks each one down with role-based security, and
--  loads Congressional's starter data (products, areas, staff, lists).
-- ============================================================================


-- ── Helper: what role is the current user? ──────────────────────────────────
-- Reads the logged-in user's role from their profile. Used by the security
-- policies below so the database itself enforces who can do what.
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid();
$$;


-- ── Products (the Chemical Library) ─────────────────────────────────────────
-- Each product is one row. The full editable object lives in `data` (jsonb);
-- name and type are also mirrored to columns so we can query/sort on them.
create table if not exists public.products (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  type       text,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products enable row level security;

-- Everyone signed in can read the library (needed for dropdowns everywhere).
drop policy if exists "products readable by authenticated" on public.products;
create policy "products readable by authenticated"
  on public.products for select to authenticated using (true);

-- Only superintendents and directors can add/change/remove products.
drop policy if exists "products writable by managers" on public.products;
create policy "products writable by managers"
  on public.products for all to authenticated
  using (public.current_user_role() in ('superintendent', 'director'))
  with check (public.current_user_role() in ('superintendent', 'director'));


-- ── App settings (areas, people lists, targets, sheet types, club info) ─────
-- A single configuration row (id = 1). Stored as jsonb blobs because these are
-- inherently config, and it keeps the shapes identical to the app.
create table if not exists public.app_settings (
  id          int primary key default 1,
  areas       jsonb not null default '{}'::jsonb,
  operators   jsonb not null default '[]'::jsonb,
  directors   jsonb not null default '[]'::jsonb,
  targets     jsonb not null default '[]'::jsonb,
  sheet_types jsonb not null default '[]'::jsonb,
  course_info jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  constraint app_settings_singleton check (id = 1)
);

alter table public.app_settings enable row level security;

drop policy if exists "settings readable by authenticated" on public.app_settings;
create policy "settings readable by authenticated"
  on public.app_settings for select to authenticated using (true);

drop policy if exists "settings writable by managers" on public.app_settings;
create policy "settings writable by managers"
  on public.app_settings for all to authenticated
  using (public.current_user_role() in ('superintendent', 'director'))
  with check (public.current_user_role() in ('superintendent', 'director'));


-- ── Spray sheets ────────────────────────────────────────────────────────────
-- Top-level columns are the fields we filter/secure on; the rest of the sheet
-- (weather, product rows, targets, tanks, etc.) lives in `data`.
create table if not exists public.spray_sheets (
  id             uuid primary key default gen_random_uuid(),
  sheet_type     text,
  spray_date     date,
  area           text,
  operator       text,
  status         text not null default 'pending' check (status in ('pending', 'approved')),
  director_sig   text,
  director_date  timestamptz,
  data           jsonb not null default '{}'::jsonb,
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.spray_sheets enable row level security;

-- Operators can see ONLY approved sheets. Managers see everything.
drop policy if exists "sheets readable by role" on public.spray_sheets;
create policy "sheets readable by role"
  on public.spray_sheets for select to authenticated
  using (
    public.current_user_role() in ('superintendent', 'director')
    or status = 'approved'
  );

-- Only managers can create/edit sheets (operators are read-only).
drop policy if exists "sheets insertable by managers" on public.spray_sheets;
create policy "sheets insertable by managers"
  on public.spray_sheets for insert to authenticated
  with check (public.current_user_role() in ('superintendent', 'director'));

drop policy if exists "sheets updatable by managers" on public.spray_sheets;
create policy "sheets updatable by managers"
  on public.spray_sheets for update to authenticated
  using (public.current_user_role() in ('superintendent', 'director'))
  with check (public.current_user_role() in ('superintendent', 'director'));

drop policy if exists "sheets deletable by managers" on public.spray_sheets;
create policy "sheets deletable by managers"
  on public.spray_sheets for delete to authenticated
  using (public.current_user_role() in ('superintendent', 'director'));


-- ── Deliveries (inventory receipts) ─────────────────────────────────────────
create table if not exists public.deliveries (
  id         uuid primary key default gen_random_uuid(),
  product    text,
  qty        numeric,
  unit       text,
  supplier   text,
  delivered  date,
  created_at timestamptz not null default now()
);

alter table public.deliveries enable row level security;

drop policy if exists "deliveries readable by authenticated" on public.deliveries;
create policy "deliveries readable by authenticated"
  on public.deliveries for select to authenticated using (true);

drop policy if exists "deliveries writable by managers" on public.deliveries;
create policy "deliveries writable by managers"
  on public.deliveries for all to authenticated
  using (public.current_user_role() in ('superintendent', 'director'))
  with check (public.current_user_role() in ('superintendent', 'director'));


-- ============================================================================
--  SEED DATA — Congressional's starter products, areas, people and lists.
--  All of this is editable in the app afterwards.
-- ============================================================================

insert into public.products (name, type, data) values
  ('Ascernity', 'Fungicide', '{"name":"Ascernity","type":"Fungicide","rate":1,"basis":"oz / M","unit":"oz","labelMaxM":1.2,"labelMaxA":null,"labelMinM":0.8,"labelMinA":null,"stock":0,"lowStockThreshold":0}'::jsonb),
  ('Azoxy D', 'Fungicide', '{"name":"Azoxy D","type":"Fungicide","rate":0.65,"basis":"oz / M","unit":"oz","labelMaxM":0.8,"labelMaxA":null,"labelMinM":null,"labelMinA":null,"stock":0,"lowStockThreshold":0}'::jsonb),
  ('Banol', 'Fungicide', '{"name":"Banol","type":"Fungicide","rate":1,"basis":"oz / M","unit":"oz","labelMaxM":1.5,"labelMaxA":null,"labelMinM":null,"labelMinA":null,"stock":0,"lowStockThreshold":0}'::jsonb),
  ('Daconil Action', 'Fungicide', '{"name":"Daconil Action","type":"Fungicide","rate":1.8,"basis":"oz / M","unit":"oz","labelMaxM":3.6,"labelMaxA":null,"labelMinM":1.8,"labelMinA":null,"stock":0,"lowStockThreshold":0}'::jsonb),
  ('Daconil ZN', 'Fungicide', '{"name":"Daconil ZN","type":"Fungicide","rate":3.2,"basis":"oz / M","unit":"oz","labelMaxM":5.5,"labelMaxA":null,"labelMinM":null,"labelMinA":null,"stock":0,"lowStockThreshold":0}'::jsonb),
  ('Heritage TL', 'Fungicide', '{"name":"Heritage TL","type":"Fungicide","rate":2,"basis":"oz / M","unit":"oz","labelMaxM":2,"labelMaxA":null,"labelMinM":null,"labelMinA":null,"stock":0,"lowStockThreshold":0}'::jsonb),
  ('Insignia SC', 'Fungicide', '{"name":"Insignia SC","type":"Fungicide","rate":0.71,"basis":"oz / M","unit":"oz","labelMaxM":0.9,"labelMaxA":null,"labelMinM":null,"labelMinA":null,"stock":0,"lowStockThreshold":0}'::jsonb),
  ('Secure Action', 'Fungicide', '{"name":"Secure Action","type":"Fungicide","rate":0.5,"basis":"oz / M","unit":"oz","labelMaxM":0.5,"labelMaxA":null,"labelMinM":null,"labelMinA":null,"stock":0,"lowStockThreshold":0}'::jsonb),
  ('Subdue Maxx', 'Fungicide', '{"name":"Subdue Maxx","type":"Fungicide","rate":0.7,"basis":"oz / M","unit":"oz","labelMaxM":1,"labelMaxA":null,"labelMinM":null,"labelMinA":null,"stock":0,"lowStockThreshold":0}'::jsonb),
  ('Velista', 'Fungicide', '{"name":"Velista","type":"Fungicide","rate":0.4,"basis":"lbs / M","unit":"lbs","labelMaxM":0.5,"labelMaxA":null,"labelMinM":null,"labelMinA":null,"stock":0,"lowStockThreshold":0}'::jsonb),
  ('Acclaim Extra', 'Herbicide', '{"name":"Acclaim Extra","type":"Herbicide","rate":3.5,"basis":"oz / A","unit":"oz","labelMaxM":null,"labelMaxA":4.5,"labelMinM":null,"labelMinA":null,"stock":0,"lowStockThreshold":0}'::jsonb),
  ('Arkon', 'Herbicide', '{"name":"Arkon","type":"Herbicide","rate":65,"basis":"oz / A","unit":"oz","labelMaxM":null,"labelMaxA":87,"labelMinM":null,"labelMinA":null,"stock":0,"lowStockThreshold":0}'::jsonb),
  ('Confront', 'Herbicide', '{"name":"Confront","type":"Herbicide","rate":16,"basis":"oz / A","unit":"oz","labelMaxM":null,"labelMaxA":24,"labelMinM":null,"labelMinA":null,"stock":0,"lowStockThreshold":0}'::jsonb),
  ('Tenacity', 'Herbicide', '{"name":"Tenacity","type":"Herbicide","rate":4,"basis":"oz / A","unit":"oz","labelMaxM":null,"labelMaxA":8,"labelMinM":null,"labelMinA":4,"stock":0,"lowStockThreshold":0}'::jsonb),
  ('Acelepryn', 'Insecticide', '{"name":"Acelepryn","type":"Insecticide","rate":8,"basis":"oz / A","unit":"oz","labelMaxM":null,"labelMaxA":12,"labelMinM":null,"labelMinA":8,"stock":0,"lowStockThreshold":0}'::jsonb),
  ('Scimitar', 'Insecticide', '{"name":"Scimitar","type":"Insecticide","rate":10,"basis":"oz / A","unit":"oz","labelMaxM":null,"labelMaxA":14,"labelMinM":null,"labelMinA":null,"stock":0,"lowStockThreshold":0}'::jsonb),
  ('Anuew', 'Growth Reg', '{"name":"Anuew","type":"Growth Reg","rate":2,"basis":"lbs / A","unit":"lbs","labelMaxM":null,"labelMaxA":2.6,"labelMinM":null,"labelMinA":null,"stock":0,"lowStockThreshold":0}'::jsonb),
  ('Primo MAXX', 'Growth Reg', '{"name":"Primo MAXX","type":"Growth Reg","rate":8,"basis":"oz / A","unit":"oz","labelMaxM":null,"labelMaxA":16,"labelMinM":null,"labelMinA":4,"stock":0,"lowStockThreshold":0}'::jsonb),
  ('Earthworks Kick', 'Biological', '{"name":"Earthworks Kick","type":"Biological","rate":8.19,"basis":"oz / M","unit":"oz","labelMaxM":null,"labelMaxA":null,"labelMinM":null,"labelMinA":null,"stock":0,"lowStockThreshold":0}'::jsonb),
  ('Hydra-Cal', 'Biological', '{"name":"Hydra-Cal","type":"Biological","rate":1.78,"basis":"oz / M","unit":"oz","labelMaxM":null,"labelMaxA":null,"labelMinM":null,"labelMinA":null,"stock":0,"lowStockThreshold":0}'::jsonb),
  ('Hydra-Kace 0-0-29', 'Biological', '{"name":"Hydra-Kace 0-0-29","type":"Biological","rate":1.78,"basis":"oz / M","unit":"oz","labelMaxM":null,"labelMaxA":null,"labelMinM":null,"labelMinA":null,"stock":0,"lowStockThreshold":0}'::jsonb),
  ('Hydra-Mn Combo', 'Biological', '{"name":"Hydra-Mn Combo","type":"Biological","rate":1.78,"basis":"oz / M","unit":"oz","labelMaxM":null,"labelMaxA":null,"labelMinM":null,"labelMinA":null,"stock":0,"lowStockThreshold":0}'::jsonb),
  ('Protein Plus', 'Biological', '{"name":"Protein Plus","type":"Biological","rate":5,"basis":"oz / M","unit":"oz","labelMaxM":null,"labelMaxA":null,"labelMinM":null,"labelMinA":null,"stock":0,"lowStockThreshold":0}'::jsonb),
  ('Cascade Plus', 'Wetting Agent', '{"name":"Cascade Plus","type":"Wetting Agent","rate":4,"basis":"oz / M","unit":"oz","labelMaxM":null,"labelMaxA":null,"labelMinM":null,"labelMinA":null,"stock":0,"lowStockThreshold":0}'::jsonb),
  ('21-0-0 Ammonium Sulfate', 'Fertilizer', '{"name":"21-0-0 Ammonium Sulfate","type":"Fertilizer","rate":null,"basis":"lbs / M","unit":"lbs","labelMaxM":null,"labelMaxA":null,"labelMinM":null,"labelMinA":null,"stock":0,"lowStockThreshold":0}'::jsonb),
  ('46-0-0 Urea', 'Fertilizer', '{"name":"46-0-0 Urea","type":"Fertilizer","rate":null,"basis":"lbs / M","unit":"lbs","labelMaxM":null,"labelMaxA":null,"labelMinM":null,"labelMinA":null,"stock":0,"lowStockThreshold":0}'::jsonb)
on conflict (name) do nothing;

insert into public.app_settings (id, areas, operators, directors, targets, sheet_types, course_info) values
  (1,
   '{"Blue Greens SprayBug 1.67gpm":{"gear":"Spray Bug 2.6 MPH","psi":"~45 PSI","tanks":1,"galTank":300,"sprayRate":1.67,"nozzle":"Blue Nozzle","sqft":179640},"Blue Fairways HD300":{"gear":"2nd Gear, 5.0 MPH","psi":"~45 PSI","tanks":6,"galTank":300,"sprayRate":44,"nozzle":"White Nozzle","sqft":300000},"Blue Rough HD300":{"gear":"2nd Gear, 5.0 MPH","psi":"~45 PSI","tanks":8,"galTank":300,"sprayRate":44,"nozzle":"White Nozzle","sqft":300000},"Gold Greens HD200":{"gear":"1st Gear, 3.5 MPH","psi":"~45 PSI","tanks":2,"galTank":150,"sprayRate":78.41,"nozzle":"Light Blue Nozzle","sqft":83333},"Gold Greens SprayBug 1.67gpm":{"gear":"Spray Bug 2.6 MPH","psi":"41 PSI","tanks":1,"galTank":250,"sprayRate":1.67,"nozzle":"Blue Nozzle","sqft":149700},"Gold Fairways and Tees HD300":{"gear":"2nd Gear, 5.0 MPH","psi":"~45 PSI","tanks":4,"galTank":300,"sprayRate":44,"nozzle":"White Nozzle","sqft":300000},"Gold Intermediate HD300":{"gear":"2nd Gear, 5.0 MPH","psi":"~45 PSI","tanks":1,"galTank":300,"sprayRate":44,"nozzle":"White Nozzle","sqft":300000},"Gold Rough HD300":{"gear":"2nd Gear, 5.0 MPH","psi":"~45 PSI","tanks":9,"galTank":300,"sprayRate":44,"nozzle":"White Nozzle","sqft":300000},"Driving Range HD300":{"gear":"2nd Gear, 5.0 MPH","psi":"~45 PSI","tanks":1,"galTank":200,"sprayRate":44,"nozzle":"White Nozzle","sqft":200000}}'::jsonb,
   '["Ryan Geils","Kevin Johnson","Jock McPherson","Mitch Penn","Kyle Zumwinkel","Mark Gates","Josh Muldowney","Mitchell Vesper"]'::jsonb,
   '["Mark Gates","Ryan Geils","Kevin Johnson"]'::jsonb,
   '["Dollar Spot","Brown Patch","Pythium","Anthracnose","Fairy Ring","Poa Annua","Crabgrass","Grubs","Growth Regulation","Nutrition","Preventative Fungicide"]'::jsonb,
   '["Greens Spray","Fairway Spray","Intermediate Spray","Rough Spray"]'::jsonb,
   '{"clubName":"Congressional Country Club","deptName":"Golf Maintenance"}'::jsonb)
on conflict (id) do nothing;
