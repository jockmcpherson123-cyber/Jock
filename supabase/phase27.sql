-- Phase 27 — Chemical Library cleanup (build brief §3.2–§3.3).
--   1. Add 15 products that appear in spray history but weren't in the library,
--      so their nutrients / active ingredients count in reports.
--   2. Merge near-duplicate library records into one canonical spelling,
--      repointing all spray sheets, fert sheets and planned applications first
--      so no history is orphaned, and enriching the canonical record from the
--      duplicate so no data is lost.
-- Idempotent — safe to re-run. Does NOT touch the ambiguous "Stressgard" /
-- "Stressguard" records (Dedicate / Exteris) — those await a manual decision.

-- ── 1) Missing products ─────────────────────────────────────────────────────
-- Classification confirmed with Jock 2026-10-11. Stored in `data` jsonb exactly
-- as the app reads it ({...data, name, type}); nutrients as n/p/k, chemistry as
-- activeIngredient + moaGroup (FRAC/HRAC).
insert into public.products (name, type, data) values
  ('15.5-0-0',                 'Fertilizer', '{"type":"Fertilizer","n":15.5,"p":0,"k":0,"activeIngredient":"calcium nitrate","unit":"lbs","stock":0,"lowStockThreshold":0}'::jsonb),
  ('Sweet Heat 0-0-2',         'Fertilizer', '{"type":"Fertilizer","n":0,"p":0,"k":2,"unit":"gal","stock":0,"lowStockThreshold":0}'::jsonb),
  ('Renovate Plus 1-0-1',      'Fertilizer', '{"type":"Fertilizer","n":1,"p":0,"k":1,"unit":"gal","stock":0,"lowStockThreshold":0}'::jsonb),
  ('Hydra-Mn',                 'Fertilizer', '{"type":"Fertilizer","n":0,"p":0,"k":0,"activeIngredient":"manganese","unit":"gal","stock":0,"lowStockThreshold":0}'::jsonb),
  ('Trin Pac Select',          'Growth Reg', '{"type":"Growth Reg","activeIngredient":"trinexapac-ethyl","unit":"oz","stock":0,"lowStockThreshold":0}'::jsonb),
  ('Azoxy 2SC',                'Fungicide',  '{"type":"Fungicide","activeIngredient":"azoxystrobin","moaGroup":"11","unit":"oz","stock":0,"lowStockThreshold":0}'::jsonb),
  ('Ipro 2',                   'Fungicide',  '{"type":"Fungicide","activeIngredient":"iprodione","moaGroup":"2","unit":"oz","stock":0,"lowStockThreshold":0}'::jsonb),
  ('Propiconazole 14.3 Select','Fungicide',  '{"type":"Fungicide","activeIngredient":"propiconazole","moaGroup":"3","unit":"oz","stock":0,"lowStockThreshold":0}'::jsonb),
  ('TM 4.5F Select',           'Fungicide',  '{"type":"Fungicide","activeIngredient":"thiophanate-methyl","moaGroup":"1","unit":"oz","stock":0,"lowStockThreshold":0}'::jsonb),
  ('Propam Select',            'Fungicide',  '{"type":"Fungicide","activeIngredient":"propamocarb","moaGroup":"28","unit":"oz","stock":0,"lowStockThreshold":0}'::jsonb),
  ('Halo 75WDG Select',        'Herbicide',  '{"type":"Herbicide","activeIngredient":"halosulfuron","moaGroup":"2","unit":"oz","stock":0,"lowStockThreshold":0}'::jsonb),
  ('SedgeMaster',              'Herbicide',  '{"type":"Herbicide","activeIngredient":"halosulfuron","moaGroup":"2","unit":"oz","stock":0,"lowStockThreshold":0}'::jsonb),
  ('Thatchzyme',               'Biological', '{"type":"Biological","unit":"gal","stock":0,"lowStockThreshold":0}'::jsonb),
  ('Endurant Premium',         'Colorant',   '{"type":"Colorant","unit":"gal","stock":0,"lowStockThreshold":0}'::jsonb),
  ('Spray And Stay',           'Adjuvant',   '{"type":"Adjuvant","unit":"oz","stock":0,"lowStockThreshold":0}'::jsonb)
on conflict (name) do nothing;

-- ── 2) Merge near-duplicate library records ─────────────────────────────────
do $$
declare
  pairs text[][] := array[
    array['Primo MAXX',                 'Primo Maxx'],
    array['Subdue MAXX',                'Subdue Maxx'],
    array['Signature XTRA Stressguard', 'Signature Xtra Stressgard'],
    array['Signature XTRA Stressguard', 'Chipco Signature Xtra Stressgard'],
    array['AzoxyD Select',              'Azoxy D Select'],
    array['Briskway',                   'Brsikway'],
    array['Chlorothalonil WS (Generic)','Chlorathalonil'],
    array['QuickSilver',                'Quick Silver'],
    array['Triton Flo',                 'Triton FLO'],
    array['Trefinti SC',                'Trefinti'],
    array['Flexguard',                  'Flex-guard'],
    array['Insignia SC',                'Insignia'],
    array['Fame + C',                   'Fame +C']
  ];
  pr text[];
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
      -- Canonical record doesn't exist yet: just rename the duplicate to it.
      update public.products set name = canon where name = dupe;
    else
      -- Keep the canonical record's values, but fill any keys only the
      -- duplicate had (shallow merge, canonical wins), then drop the duplicate.
      update public.products c
        set data = d.data || c.data
        from public.products d
        where c.name = canon and d.name = dupe;
      delete from public.products where name = dupe;
    end if;

    -- Repoint every reference from the old spelling to the canonical name.
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
