-- ============================================================================
--  Grounds Operations — PHASE 33 SEED: FY2026 approved budget
-- ============================================================================
--  Run AFTER phase33.sql, in the Supabase SQL Editor. Safe to re-run (idempotent).
--  Transcribed from FY2026_Golf_Grounds_Budget.csv. Amounts are the MONTH cells,
--  stored as integer cents; year/YTD totals are computed from these months.
-- ============================================================================
do $$
declare y uuid;
begin
  insert into public.budget_years (fiscal_year, starts_on, status)
    values (2026, date '2025-11-01', 'approved')
    on conflict (fiscal_year) do update set starts_on = excluded.starts_on
    returning id into y;

  create temp table _seed (
    gl text, descr text, section text, grp text, sort int,
    m1 bigint, m2 bigint, m3 bigint, m4 bigint, m5 bigint, m6 bigint,
    m7 bigint, m8 bigint, m9 bigint, m10 bigint, m11 bigint, m12 bigint
  ) on commit drop;

  insert into _seed values
    ('610100-13', 'Salaries & Wages', 'payroll', 'payroll', 1, 28636600, 28224500, 27807600, 25903800, 30430600, 31508300, 33606200, 33390600, 34475500, 33704000, 31891400, 31754200),
    ('610103-13', 'Allocated Salaries & Wages Capital', 'payroll', 'payroll', 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ('610200-13', 'Extra Wages', 'payroll', 'payroll', 3, 87300, 0, 0, 0, 777400, 2813600, 3187800, 3597300, 3717200, 3472900, 2907000, 2774300),
    ('610800-13', 'Employee Benefits', 'payroll', 'payroll', 4, 4903600, 4890500, 5091800, 5030900, 5175700, 5210200, 5277300, 5270400, 5305200, 5280500, 5222500, 5218100),
    ('610900-13', 'Payroll Taxes', 'payroll', 'payroll', 5, 2031700, 2002800, 1973600, 1840400, 2157200, 2232700, 2379500, 2364400, 2440400, 2386400, 2259500, 2249900),
    ('610901-13', 'Worker''s Compensation Ins', 'payroll', 'payroll', 6, 267000, 248600, 242800, 229300, 290000, 324200, 352300, 358400, 370300, 356500, 329500, 321000),
    ('611000-13', 'Employees Meals', 'payroll', 'payroll', 7, 779900, 727000, 734100, 692100, 856400, 990400, 1071200, 1071500, 1134200, 1120500, 1000200, 976000),
    ('611800-13', 'Supplies-Other', 'operating', 'repairs', 8, 72900, 90500, 77300, 75000, 325000, 325000, 300000, 300000, 300000, 300000, 300000, 300000),
    ('611810-13', 'Supplies-Small Tools', 'operating', 'repairs', 9, 50000, 50000, 50000, 600000, 550000, 350000, 350000, 250000, 150000, 50000, 50000, 0),
    ('611811-13', 'Golf Course Accessories', 'operating', 'repairs', 10, 125000, 125000, 125000, 1525000, 1510000, 1010000, 880000, 625000, 275000, 275000, 275000, 250000),
    ('611900-13', 'Repairs & Maintenance', 'operating', 'repairs', 11, 0, 0, 0, 0, 0, 9100, 0, 0, 0, 0, 0, 0),
    ('611901-13', 'TV, Internet & Phone', 'operating', 'utilities', 12, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000),
    ('611903-13', 'Irrigation Repairs/Drainage', 'operating', 'repairs', 13, 281000, 641000, 306000, 676000, 1006000, 1046000, 531000, 616000, 506000, 356000, 306000, 231000),
    ('611905-13', 'Repairs & Maint-Buildings', 'operating', 'repairs', 14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ('611906-13', 'Repairs & Maintenance-Courses', 'operating', 'repairs', 15, 700000, 700000, 700000, 700000, 800000, 800000, 800000, 900000, 1000000, 800000, 800000, 2700000),
    ('611910-13', 'Repairs & Maint-Equipment', 'operating', 'equip', 16, 1600000, 1300000, 1300000, 1300000, 1500000, 1100000, 900000, 900000, 1200000, 1100000, 1150000, 1200000),
    ('611920-13', 'Repairs & Maint-Fences & Bridges', 'operating', 'repairs', 17, 200000, 295000, 35000, 150000, 280000, 0, 0, 0, 0, 0, 0, 0),
    ('611950-13', 'Equipment Lease', 'operating', 'equip', 18, 6883900, 7787200, 7763800, 7763800, 7763800, 7763800, 7763800, 7763800, 7763800, 7763800, 7763800, 7763800),
    ('611999-13', 'Waste Recycling', 'operating', 'utilities', 19, 750000, 650000, 650000, 540000, 640000, 550000, 440000, 440000, 440000, 550000, 440000, 750000),
    ('612100-13', 'Water & Sewage', 'operating', 'utilities', 20, 50000, 60000, 65000, 62500, 42500, 67500, 764000, 2165000, 1100000, 67500, 62500, 50000),
    ('612500-13', 'Licenses', 'operating', 'admin', 21, 88000, 8100, 0, 0, 0, 0, 37000, 75500, 157500, 0, 0, 20000),
    ('612800-13', 'Chemicals', 'operating', 'chem', 22, 152200, 152200, 0, 0, 152200, 9702200, 8602200, 10052200, 13652200, 11502200, 5727200, 2252200),
    ('612802-13', 'Fungicide', 'operating', 'chem', 23, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ('612810-13', 'Fertilizer', 'operating', 'chem', 24, 0, 0, 0, 270000, 1810000, 1400000, 1575000, 865000, 970000, 1500000, 1800000, 1700000),
    ('613000-13', 'Gasoline & Oil', 'operating', 'equip', 25, 325000, 375000, 375000, 475000, 775000, 825000, 875000, 875000, 875000, 875000, 675000, 475000),
    ('613100-13', 'Heating Fuel', 'operating', 'utilities', 26, 80000, 80000, 70000, 70000, 95000, 65000, 50000, 50000, 65000, 25000, 150000, 200000),
    ('613200-13', 'Electric Expense', 'operating', 'utilities', 27, 420000, 400000, 450000, 600000, 518000, 900000, 2000000, 2000000, 2000000, 2000000, 900000, 312000),
    ('613601-13', 'Sand-Bunkers', 'operating', 'materials', 28, 0, 0, 0, 280000, 140000, 500000, 400000, 0, 125000, 125000, 0, 0),
    ('613602-13', 'Divot Mix', 'operating', 'materials', 29, 0, 0, 0, 0, 650000, 0, 0, 250000, 0, 250000, 0, 0),
    ('613603-13', 'Topdressing', 'operating', 'materials', 30, 0, 1300000, 0, 0, 300000, 0, 0, 0, 800000, 1200000, 0, 1200000),
    ('613604-13', 'Seed', 'operating', 'materials', 31, 0, 0, 0, 0, 0, 400000, 100000, 0, 50000, 550000, 1200000, 485300),
    ('613605-13', 'Sod', 'operating', 'materials', 32, 1230000, 430000, 0, 0, 200000, 200000, 200000, 0, 0, 500000, 1600000, 1660000),
    ('613700-13', 'Postage', 'operating', 'admin', 33, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ('613900-13', 'Dues & Subscriptions', 'operating', 'admin', 34, 640000, 140000, 140000, 140000, 140000, 205000, 235000, 205000, 270000, 620000, 140000, 140000),
    ('614300-13', 'Education & Travel', 'operating', 'admin', 35, 39000, 1000000, 323000, 530000, 400000, 254500, 195800, 269600, 0, 0, 250000, 245000),
    ('614400-13', 'Publicity & Promotion', 'operating', 'admin', 36, 25000, 15000, 0, 0, 25000, 40000, 25000, 25000, 25000, 25000, 40000, 40000),
    ('615200-13', 'Uniforms', 'operating', 'admin', 37, 0, 180000, 2152000, 0, 1208000, 0, 290000, 50000, 120000, 0, 0, 0),
    ('615300-13', 'Equipment Rental', 'operating', 'equip', 38, 75000, 75000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ('616900-13', 'Roadway Maintenance', 'operating', 'repairs', 39, 53400, 190000, 414000, 441800, 0, 0, 0, 400000, 53400, 0, 191100, 50000),
    ('617000-13', 'Trash Removal', 'operating', 'utilities', 40, 50000, 50000, 50000, 50000, 50000, 50000, 50000, 50000, 50000, 50000, 50000, 50000),
    ('618000-13', 'Data Processing', 'operating', 'admin', 41, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ('618600-13', 'Club House Grounds', 'operating', 'repairs', 42, 638100, 7400, 35600, 301100, 133700, 421600, 1569500, 434900, 472000, 230800, 0, 763200),
    ('618601-13', 'Plants-Golf Course', 'operating', 'materials', 43, 0, 0, 0, 0, 550100, 0, 0, 550100, 0, 0, 0, 0),
    ('618700-13', 'Tree Trimming', 'operating', 'repairs', 44, 0, 400000, 400000, 400000, 0, 0, 0, 0, 0, 0, 400000, 0),
    ('619900-13', 'Other Operating Expenses', 'operating', 'admin', 45, 0, 0, 0, 0, 0, 0, 0, 0, 252100, 0, 0, 0);

  insert into public.budget_lines (year_id, gl_code, description, section, group_key, sort)
    select y, gl, descr, section, grp, sort from _seed
    on conflict (year_id, gl_code) do update
      set description = excluded.description, section = excluded.section,
          group_key = excluded.group_key, sort = excluded.sort;

  insert into public.budget_months (line_id, month_index, amount_cents)
    select l.id, m.idx, m.cents
    from _seed s
    join public.budget_lines l on l.year_id = y and l.gl_code = s.gl
    cross join lateral (values
      (1, s.m1), (2, s.m2), (3, s.m3), (4, s.m4), (5, s.m5), (6, s.m6),
      (7, s.m7), (8, s.m8), (9, s.m9), (10, s.m10), (11, s.m11), (12, s.m12)
    ) as m(idx, cents)
    on conflict (line_id, month_index) do update set amount_cents = excluded.amount_cents;
end $$;
