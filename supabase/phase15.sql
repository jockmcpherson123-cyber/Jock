-- ============================================================================
--  Grounds Operations — Database schema, PHASE 15 (Playbook / SOPs)
-- ============================================================================
--
--  HOW TO RUN THIS (once): Supabase → SQL Editor → New query → paste → Run.
--  Safe to re-run.
--
--  The Playbook — one place for the crew to look things up fast:
--    • SOPs / how-to procedures (with the manufacturer's manual attached)
--    • Emergency procedures (flagged + pinned first)
--    • Contacts & phone numbers (vendors, services, staff)
--    • Supplies — "this product for that job", and where to buy it
--
--  One table with a `kind` discriminator ('sop' | 'contact' | 'supply'); the
--  bits that differ per kind ride in `data` (jsonb), and any attached files
--  (PDF manuals, photos) ride in `attachments` (jsonb array). Files themselves
--  live in a Storage bucket created at the bottom of this script.
-- ============================================================================

create table if not exists public.playbook_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'sop',        -- 'sop' | 'contact' | 'supply'
  title text not null default '',           -- SOP title / contact name / supply job
  category text not null default '',        -- SOP category / contact grouping
  notes text not null default '',           -- SOP steps/body · contact notes · supply notes
  data jsonb not null default '{}'::jsonb,   -- contact {company,phone,email} · supply {product,supplier}
  attachments jsonb not null default '[]'::jsonb, -- [{name,url,path,kind}]
  emergency boolean not null default false,  -- SOPs: pin to top + red-flag
  sort int not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists playbook_items_kind_idx on public.playbook_items (kind);

alter table public.playbook_items enable row level security;

-- Everyone signed in can read the Playbook.
drop policy if exists "playbook readable" on public.playbook_items;
create policy "playbook readable"
  on public.playbook_items for select to authenticated using (true);

-- Any signed-in user can add/edit/remove. (The UI limits editing to managers;
-- this keeps the DB rules simple and matches the rest of the app.)
drop policy if exists "playbook insertable" on public.playbook_items;
create policy "playbook insertable"
  on public.playbook_items for insert to authenticated with check (true);

drop policy if exists "playbook updatable" on public.playbook_items;
create policy "playbook updatable"
  on public.playbook_items for update to authenticated using (true) with check (true);

drop policy if exists "playbook deletable" on public.playbook_items;
create policy "playbook deletable"
  on public.playbook_items for delete to authenticated using (true);

-- ── File storage for attachments (manuals, photos) ──────────────────────────
-- A public bucket named "playbook". Files get random (uuid) names, so the URLs
-- aren't guessable; reads work via the public URL, uploads/deletes require
-- being signed in.
insert into storage.buckets (id, name, public)
values ('playbook', 'playbook', true)
on conflict (id) do nothing;

drop policy if exists "playbook files readable" on storage.objects;
create policy "playbook files readable"
  on storage.objects for select to authenticated using (bucket_id = 'playbook');

drop policy if exists "playbook files insertable" on storage.objects;
create policy "playbook files insertable"
  on storage.objects for insert to authenticated with check (bucket_id = 'playbook');

drop policy if exists "playbook files updatable" on storage.objects;
create policy "playbook files updatable"
  on storage.objects for update to authenticated using (bucket_id = 'playbook') with check (bucket_id = 'playbook');

drop policy if exists "playbook files deletable" on storage.objects;
create policy "playbook files deletable"
  on storage.objects for delete to authenticated using (bucket_id = 'playbook');
