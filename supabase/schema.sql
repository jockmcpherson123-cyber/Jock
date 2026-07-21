-- ============================================================================
--  Grounds Operations — Database schema
--  Phase 0: user profiles + roles
-- ============================================================================
--
--  HOW TO RUN THIS (you only do this once):
--    1. Open your project at https://supabase.com
--    2. Left sidebar → "SQL Editor" → "New query"
--    3. Paste this whole file in and click "Run".
--
--  Supabase already gives you a hidden "auth.users" table that holds emails and
--  passwords securely. We never touch that directly. Instead we keep a matching
--  "profiles" row for each user to store their display name and their role.
-- ============================================================================


-- ── 1. The profiles table ───────────────────────────────────────────────────
-- One row per user. The id is the SAME id Supabase Auth assigns, so the two are
-- permanently linked. If a user is deleted from Auth, their profile is removed
-- too (that's what "on delete cascade" means).
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  -- role controls what the person can do in the app. It can only ever be one of
  -- these three values (the CHECK enforces that).
  role       text not null default 'operator'
             check (role in ('operator', 'superintendent', 'director')),
  created_at timestamptz not null default now()
);


-- ── 2. Turn on Row Level Security ───────────────────────────────────────────
-- With RLS on, NOBODY can read or write this table unless a policy below
-- explicitly allows it. This is the real lock on the door.
alter table public.profiles enable row level security;


-- ── 3. Access policies ──────────────────────────────────────────────────────

-- Any logged-in team member can see everyone's profile (needed so dropdowns of
-- operators/directors work across the app).
drop policy if exists "profiles are readable by authenticated users" on public.profiles;
create policy "profiles are readable by authenticated users"
  on public.profiles
  for select
  to authenticated
  using (true);

-- A user may edit their OWN profile (e.g. fix their display name) but not
-- anyone else's. Note: this does not stop them changing their own role yet —
-- role management for admins comes in a later phase. For now roles are set by
-- you directly in the SQL editor (see the bottom of this file).
drop policy if exists "users can update their own profile" on public.profiles;
create policy "users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);


-- ── 4. Auto-create a profile when a new user signs up ───────────────────────
-- This function runs automatically every time Supabase Auth creates a user, so
-- we never have to remember to create the matching profile row by hand. It also
-- copies a "full_name" if one was provided when the user was created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();


-- ============================================================================
--  AFTER you have created your own user (Authentication → Users → Add user),
--  make yourself the top-level admin by running this ONE line — replacing the
--  email with your own:
--
--      update public.profiles
--      set role = 'director', full_name = 'Jock McPherson'
--      where id = (select id from auth.users where email = 'jmcpherson@ccclub.org');
--
--  Roles: 'operator' (read-only), 'superintendent' (manage), 'director' (approve).
-- ============================================================================
