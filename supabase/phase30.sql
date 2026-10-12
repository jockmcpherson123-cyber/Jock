-- Phase 30 — Chemical Library duplicate merge (import spec §7).
-- Collapses every near-duplicate product spelling onto the ONE spelling tied to
-- the 2026 plan (the first-listed name in each group), repointing all spray
-- sheets (jsonb products array), fert sheets and planned applications first so
-- no history is orphaned, enriching the kept record from the duplicate so no
-- data is lost, then deleting the duplicate. Idempotent / safe to re-run.
--
-- This supersedes and completes the merges in phase27: the kept spellings here
-- are authoritative (they match the import file). It also folds in the spellings
-- phase27 would have kept (e.g. Flexguard, QuickSilver), so the library lands on
-- the §7 names whether or not phase27 has already run.

do $$
declare
  pairs text[][] := array[
    array['Primo MAXX',                  'Primo Maxx'],
    array['Subdue MAXX',                 'Subdue Maxx'],
    array['Subdue MAXX',                 'Subdue Maxx (Generic)'],
    array['Exteris StressGard',          'Exteris Stressgard'],
    array['Dedicate Stressgard',         'Dedicate Stressguard'],
    array['Fame + C',                    'Fame +C'],
    array['Flex-guard',                  'Flexguard'],
    array['Quick Silver',                'QuickSilver'],
    array['Triton FLO',                  'Triton Flo'],
    array['Azoxy D Select',              'AzoxyD Select'],
    array['Acelepryn Extra',             'Acelepryn Xtra'],
    array['Briskway',                    'Brsikway'],
    array['Chlorothalonil WS (Generic)', 'Chlorathalonil WS (Generic)'],
    array['Chlorothalonil WS (Generic)', 'Chlorathalonil'],
    array['Signature Xtra Stressgard',   'Signature XTRA Stressguard'],
    array['Signature Xtra Stressgard',   'Chipco Signature Xtra Stressgard'],
    array['Trefinti',                    'Trefinti SC'],
    array['Thiophanate-Methyl',          'Thiophanate-Methyl (Generic)'],
    array['Triclopyr',                   'Triclopyr (Generic)'],
    array['Torque',                      'Torque (Generic)']
  ];
  canon text;
  dupe text;
  canon_exists boolean;
  dupe_exists boolean;
begin
  for i in 1 .. array_length(pairs, 1) loop
    canon := pairs[i][1];
    dupe  := pairs[i][2];
    if canon = dupe then continue; end if;

    select exists(select 1 from public.products where name = dupe)  into dupe_exists;
    if not dupe_exists then continue; end if;
    select exists(select 1 from public.products where name = canon) into canon_exists;

    if not canon_exists then
      update public.products set name = canon where name = dupe;
    else
      update public.products c
        set data = d.data || c.data
        from public.products d
        where c.name = canon and d.name = dupe;
      delete from public.products where name = dupe;
    end if;

    update public.program_applications set product = canon where product = dupe;
    update public.fert_sheets           set product = canon where product = dupe;
    update public.spray_sheets s
      set data = jsonb_set(s.data, '{products}', (
        select jsonb_agg(
          case when elem->>'product' = dupe
               then jsonb_set(elem, '{product}', to_jsonb(canon))
               else elem end)
        from jsonb_array_elements(s.data->'products') elem))
      where s.data ? 'products'
        and jsonb_typeof(s.data->'products') = 'array'
        and exists (
          select 1 from jsonb_array_elements(s.data->'products') e
          where e->>'product' = dupe);
  end loop;
end $$;
