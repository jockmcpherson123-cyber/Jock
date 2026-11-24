// Tests for the Jonas import logic. Run: node lib/budget/import.test.mjs
import { normGl, buildGlIndex, matchLineId, parseMoneyToCents, cellToFiscalMonth, dedupeKey, planImport } from './import.js'

let pass = 0, fail = 0
const eq = (a, e, m) => { if (JSON.stringify(a) === JSON.stringify(e)) pass++; else { fail++; console.error(`✗ ${m}\n   exp ${JSON.stringify(e)}\n   got ${JSON.stringify(a)}`) } }

const lines = [
  { id: 'chem', glCode: '612800-13', section: 'operating' },
  { id: 'sod', glCode: '613605-13', section: 'operating' },
  { id: 'sal', glCode: '610100-13', section: 'payroll' },
]
const idx = buildGlIndex(lines)

// GL matching: with dash, without, bare account
eq(matchLineId(idx, '612800-13'), 'chem', 'match full GL')
eq(matchLineId(idx, '61280013'), 'chem', 'match no-dash GL')
eq(matchLineId(idx, '612800'), 'chem', 'match bare account (dept 13 implied)')
eq(matchLineId(idx, '612800 - 13'), 'chem', 'match with spaces')
eq(matchLineId(idx, '999999'), null, 'no match for unknown GL')
eq(normGl('612800-13'), '61280013', 'normGl strips punctuation')

// aliases
const idx2 = buildGlIndex(lines, { 'MISC-CHEM': 'chem' })
eq(matchLineId(idx2, 'misc-chem'), 'chem', 'alias maps to a line')

// money parsing
eq(parseMoneyToCents('$1,234.56'), 123456, 'money with $ and comma')
eq(parseMoneyToCents('(1,000.00)'), -100000, 'parentheses = negative')
eq(parseMoneyToCents(152300), 15230000, 'number dollars → cents')
eq(parseMoneyToCents('152300'), 15230000, 'string dollars → cents')

// fiscal month from various cell formats (FY starts 2025-11-01)
eq(cellToFiscalMonth('2026-07-15', '2025-11-01'), 9, 'ISO date July = 9')
eq(cellToFiscalMonth('2026-07', '2025-11-01'), 9, 'YYYY-MM July = 9')
eq(cellToFiscalMonth('Jul 2026', '2025-11-01'), 9, 'Mon YYYY = 9')
eq(cellToFiscalMonth('Nov-25', '2025-11-01'), 1, 'Mon-YY Nov 2025 = 1')
eq(cellToFiscalMonth('07/15/2026', '2025-11-01'), 9, 'US date = 9')
eq(cellToFiscalMonth('garbage', '2025-11-01'), null, 'unparseable = null')

// dedupe key stability
eq(dedupeKey({ externalId: 'X1' }), 'ext:X1', 'external id key')

// plan: the Phase 2 test — 3 rows for 612800-13 in July totalling $152,300
const plan = planImport({
  startsOn: '2025-11-01',
  lines,
  rows: [
    { glRaw: '612800-13', dateRaw: '2026-07-03', amount: '50,000.00', vendor: 'Harrell', invoiceNo: 'A1' },
    { glRaw: '612800', dateRaw: '2026-07-10', amount: '50,000.00', vendor: 'Harrell', invoiceNo: 'A2' },
    { glRaw: '61280013', dateRaw: 'Jul 2026', amount: '52,300.00', vendor: 'Site One', invoiceNo: 'B9' },
  ],
})
eq(plan.matchedCount, 3, 'all 3 rows matched')
eq(plan.totalCents, 15230000, 'July Chemicals total = $152,300')
eq(plan.monthsTouched, [9], 'only July (month 9) touched')
eq(plan.unmatchedCount, 0, 'nothing unmatched')
eq(plan.bySection.operating, 15230000, 'operating section total')

// plan: an unknown GL lands in unmatched
const plan2 = planImport({
  startsOn: '2025-11-01', lines,
  rows: [{ glRaw: '700000-13', dateRaw: '2026-07-01', amount: '100' }],
})
eq(plan2.unmatchedCount, 1, 'unknown GL unmatched')
eq(plan2.unmatched[0].reason, 'no matching GL', 'unmatched reason')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
