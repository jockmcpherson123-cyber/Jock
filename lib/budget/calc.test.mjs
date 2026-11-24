// Unit tests for the budget calc module. Run: `node lib/budget/calc.test.mjs`
// No test framework — plain asserts so it runs anywhere node does.
import {
  monthLabel, fiscalMonthIndex, monthsToArray, transfersNetForLine,
  monthBudgetCents, yearBudgetCents, ytdBudgetCents,
  monthActualCents, ytdActualCents, lineStatus, forecastCents,
  computeLine, aggregate, latestPostedMonth, yearProgressFraction,
  formatMoneyCents, formatSignedCents, formatPct,
} from './calc.js'

let pass = 0, fail = 0
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) { pass++; }
  else { fail++; console.error(`✗ ${msg}\n    expected ${e}\n    got      ${a}`) }
}

// $ helper: dollars → cents
const $ = (d) => Math.round(d * 100)

// ── Fiscal months ──────────────────────────────────────────────────────────
eq(monthLabel(1), 'Nov', 'month 1 = Nov')
eq(monthLabel(3), 'Jan', 'month 3 = Jan')
eq(monthLabel(12), 'Oct', 'month 12 = Oct')
eq(fiscalMonthIndex('2025-11-15', '2025-11-01'), 1, 'Nov 2025 = month 1')
eq(fiscalMonthIndex('2026-07-15', '2025-11-01'), 9, 'Jul 2026 = month 9')
eq(fiscalMonthIndex('2026-10-31', '2025-11-01'), 12, 'Oct 2026 = month 12')
eq(fiscalMonthIndex('2026-11-01', '2025-11-01'), null, 'next Nov is out of FY2026')

// ── Budget / YTD with a flat $1,000/mo line ──────────────────────────────────
const flat = monthsToArray(Array(12).fill($(1000)))
eq(yearBudgetCents(flat, null), $(12000), 'year budget = 12 × 1,000')
eq(ytdBudgetCents(flat, null, 9), $(9000), 'YTD through month 9 = 9,000')
eq(monthBudgetCents(flat, null, 5), $(1000), 'month 5 budget = 1,000')

// ── Actuals (posted + pending) ───────────────────────────────────────────────
const actuals = [
  { monthIndex: 7, amountCents: $(50000), status: 'posted' },
  { monthIndex: 7, amountCents: $(50000), status: 'posted' },
  { monthIndex: 7, amountCents: $(52300), status: 'posted' },
  { monthIndex: 8, amountCents: $(4000), status: 'pending' },
]
eq(monthActualCents(actuals, 7), $(152300), 'July actual = 152,300 (Jonas test)')
eq(monthActualCents(actuals, 8, { includePending: false }), 0, 'Aug posted-only = 0')
eq(monthActualCents(actuals, 8), $(4000), 'Aug incl pending = 4,000')
eq(latestPostedMonth(actuals), 7, 'latest posted month = 7')

// ── Status thresholds ────────────────────────────────────────────────────────
eq(lineStatus($(100), $(100)), 'on-track', '100/100 = on track')
eq(lineStatus($(105), $(100)), 'watch', '105/100 = watch')
eq(lineStatus($(106), $(100)), 'over', '106/100 = over')
eq(lineStatus($(10), 0), 'over', 'spend with no budget = over')
eq(lineStatus(0, 0), 'on-track', 'nothing spent, no budget = on track')

// ── Forecast default = YTD actual + remaining budget ─────────────────────────
eq(forecastCents({ budgetMonths: flat, transfersNet: null, actuals: [{ monthIndex: 1, amountCents: $(900), status: 'posted' }], forecastYearEndCents: null, throughMonth: 1 }),
  $(900) + $(11000), 'forecast = 900 YTD + 11 remaining months')
eq(forecastCents({ budgetMonths: flat, transfersNet: null, actuals: [], forecastYearEndCents: $(13000), throughMonth: 6 }),
  $(13000), 'manual forecast wins')

// ── The spec transfer example: Sod → Chemicals $16,000 ───────────────────────
// Chemicals year budget 619,470 → 635,470; Sod 60,200 → 44,200; total unchanged.
const chemMonths = monthsToArray(Array(12).fill(Math.round($(619470) / 12)))
// force the exact year total regardless of rounding of the synthetic split:
const chemBudget = () => yearBudgetCents(chemMonths, null)
const sodMonths = monthsToArray(Array(12).fill(Math.round($(60200) / 12)))
const transfer = [{ fromLineId: 'sod', toLineId: 'chem', amountCents: $(16000), status: 'approved', effectiveMonth: 9 }]
const chemNet = transfersNetForLine(transfer, 'chem')
const sodNet = transfersNetForLine(transfer, 'sod')
eq(yearBudgetCents(chemMonths, chemNet) - chemBudget(), $(16000), 'Chemicals year budget +16,000 after transfer')
eq(yearBudgetCents(sodMonths, sodNet) - yearBudgetCents(sodMonths, null), -$(16000), 'Sod year budget −16,000 after transfer')
// total of the two lines unchanged
const beforeTotal = yearBudgetCents(chemMonths, null) + yearBudgetCents(sodMonths, null)
const afterTotal = yearBudgetCents(chemMonths, chemNet) + yearBudgetCents(sodMonths, sodNet)
eq(afterTotal, beforeTotal, 'transfer leaves the two-line total unchanged')

// ── computeLine + aggregate wiring ───────────────────────────────────────────
const line = computeLine({ budgetMonths: flat, actuals: [{ monthIndex: 1, amountCents: $(1200), status: 'posted' }] }, 1)
eq(line.ytdBudget, $(1000), 'computeLine YTD budget')
eq(line.ytdActual, $(1200), 'computeLine YTD actual')
eq(line.varianceYtd, $(200), 'computeLine variance (over by 200)')
eq(line.left, $(12000) - $(1200), 'computeLine left = year − YTD actual')
eq(line.status, 'over', 'computeLine status over')
const agg = aggregate([line, computeLine({ budgetMonths: flat, actuals: [] }, 1)])
eq(agg.yearBudget, $(24000), 'aggregate year budget sums lines')
eq(agg.ytdActual, $(1200), 'aggregate YTD actual sums lines')

// ── Year progress ─────────────────────────────────────────────────────────────
eq(yearProgressFraction('2026-07-15', '2025-11-01'), 9 / 12, 'progress = 9/12 in July')

// ── Formatting ─────────────────────────────────────────────────────────────────
eq(formatMoneyCents($(1234)), '$1,234', 'money whole dollars with comma')
eq(formatMoneyCents(-$(1234)), '−$1,234', 'negative money uses real minus, sign before $')
eq(formatMoneyCents($(619470)), '$619,470', 'Chemicals budget formats')
eq(formatSignedCents($(200)), '+$200', 'signed positive')
eq(formatSignedCents(-$(200)), '−$200', 'signed negative')
eq(formatPct(0.753), '75%', 'percent rounds to whole')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
