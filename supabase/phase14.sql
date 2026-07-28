-- ============================================================================
--  Grounds Operations — Database schema, PHASE 14 (Translation cache)
-- ============================================================================
--
--  HOW TO RUN THIS (once): Supabase → SQL Editor → New query → paste → Run.
--  Safe to re-run.
--
--  A permanent cache of translated phrases for the crew board. Each job or tool
--  name is translated by AI once per language, stored here, and reused forever —
--  so the AI cost is a one-time thing per new phrase, not per view.
-- ============================================================================

create table if not exists public.translations (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  lang text not null,
  translation text not null,
  created_at timestamptz not null default now(),
  unique (source, lang)
);

create index if not exists translations_lang_idx on public.translations (lang);

alter table public.translations enable row level security;

drop policy if exists "translations readable" on public.translations;
create policy "translations readable"
  on public.translations for select to authenticated using (true);

drop policy if exists "translations insertable" on public.translations;
create policy "translations insertable"
  on public.translations for insert to authenticated with check (true);

drop policy if exists "translations updatable" on public.translations;
create policy "translations updatable"
  on public.translations for update to authenticated using (true) with check (true);
