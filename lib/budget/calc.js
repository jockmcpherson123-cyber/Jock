// ============================================================================
//  Budget math — THE single source of truth.
//
//  Every budget screen, table, export and test imports from this module, so a
//  number can never disagree between the cards and the CFO's table. Nothing
//  here touches the database or React; it is plain functions over plain data.
//
//  MONEY IS INTEGER CENTS. $1,234.56 is 123456. We never round when storing or
//  summing — rounding happens only when a figure is formatted for display.
//
//  FISCAL YEAR runs Nov 1 → Oct 31. month_index 1..12, where 1 = November.
//
//  Normalized shapes this module expects (the db layer maps rows into these):
//    budgetMonths : number[12] of cents, index 0 = month 1 (Nov) … index 11 = Oct
//    actuals      : { monthIndex:1..12, amountCents, status:'posted'|'pending' }[]
//    transfers    : { fromLineId, toLineId, amountCents, status, effectiveMonth }[]
//    forecast     : latest forecasts.year_end_cents for the line, or null
// ============================================================================

// ── Small coercions ──────────────────────────────────────────────────────────
const c = (x) => {
  const n = Number(x)
  return Number.isFinite(n) ? n : 0
}

function toDate(d) {
  if (!d) return null
  const dt = typeof d === 'string'
    ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00` : d)
    : d
  return dt && !isNaN(dt.getTime()) ? dt : null
}

// ── Fiscal-month helpers ───────────────────────────────────────────────────────
// Labels for month_index 1..12, starting at November.
export const FY_MONTHS = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']

export function monthLabel(monthIndex) {
  const i = Math.trunc(Number(monthIndex))
  return i >= 1 && i <= 12 ? FY_MONTHS[i - 1] : ''
}

// Which fiscal month a real date falls in, given the year's starts_on (a Nov 1).
// Returns 1..12, or null if the date is outside the fiscal year.
export function fiscalMonthIndex(date, startsOn) {
  const d = toDate(date)
  const s = toDate(startsOn)
  if (!d || !s) return null
  const idx = (d.getFullYear() - s.getFullYear()) * 12 + (d.getMonth() - s.getMonth()) + 1
  return idx >= 1 && idx <= 12 ? idx : null
}

// Normalize budget months into a dense number[12] of cents. Accepts an array
// (length 12) or a list of { month_index|monthIndex, amount_cents|amountCents }.
export function monthsToArray(months) {
  const out = Array(12).fill(0)
  if (!months) return out
  if (Array.isArray(months) && months.length === 12 && typeof months[0] !== 'object') {
    for (let i = 0; i < 12; i++) out[i] = c(months[i])
    return out
  }
  for (const m of months) {
    const mi = Math.trunc(Number(m.monthIndex ?? m.month_index))
    if (mi >= 1 && mi <= 12) out[mi - 1] += c(m.amountCents ?? m.amount_cents)
  }
  return out
}

// ── Transfers ──────────────────────────────────────────────────────────────────
// Net approved transfer (cents) for a line, by month: + when money lands on the
// line, − when it leaves. Only approved transfers count; they never change the
// section total, so a from-line's − equals the to-line's +.
export function transfersNetForLine(transfers, lineId) {
  const net = Array(12).fill(0)
  for (const t of transfers || []) {
    if ((t.status ?? 'approved') !== 'approved') continue
    const m = Math.trunc(Number(t.effectiveMonth ?? t.effective_month))
    if (!(m >= 1 && m <= 12)) continue
    const amt = c(t.amountCents ?? t.amount_cents)
    if ((t.toLineId ?? t.to_line_id) === lineId) net[m - 1] += amt
    if ((t.fromLineId ?? t.from_line_id) === lineId) net[m - 1] -= amt
  }
  return net
}

// ── Per-month / YTD budget (plan + approved transfers) ──────────────────────────
export function monthBudgetCents(budgetMonths, transfersNet, m) {
  const i = m - 1
  return c(budgetMonths?.[i]) + c(transfersNet?.[i])
}

export function yearBudgetCents(budgetMonths, transfersNet) {
  let t = 0
  for (let m = 1; m <= 12; m++) t += monthBudgetCents(budgetMonths, transfersNet, m)
  return t
}

export function ytdBudgetCents(budgetMonths, transfersNet, throughMonth) {
  let t = 0
  for (let m = 1; m <= throughMonth; m++) t += monthBudgetCents(budgetMonths, transfersNet, m)
  return t
}

// ── Per-month / YTD actuals ─────────────────────────────────────────────────────
export function monthActualCents(actuals, m, { includePending = true } = {}) {
  let t = 0
  for (const a of actuals || []) {
    const mi = Math.trunc(Number(a.monthIndex ?? a.month_index))
    if (mi !== m) continue
    const status = a.status ?? 'posted'
    if (!includePending && status !== 'posted') continue
    t += c(a.amountCents ?? a.amount_cents)
  }
  return t
}

export function ytdActualCents(actuals, throughMonth, opts) {
  let t = 0
  for (let m = 1; m <= throughMonth; m++) t += monthActualCents(actuals, m, opts)
  return t
}

// ── Status ───────────────────────────────────────────────────────────────────
// Ratio of YTD actual to YTD budget: ≤1.00 on track, ≤1.05 watch, else over.
// No YTD budget but spend exists → over.
export function lineStatus(ytdActual, ytdBudget) {
  if (ytdBudget === 0) return ytdActual > 0 ? 'over' : 'on-track'
  const r = ytdActual / ytdBudget
  if (r <= 1.0) return 'on-track'
  if (r <= 1.05) return 'watch'
  return 'over'
}

// ── Forecast ───────────────────────────────────────────────────────────────────
// The latest manual forecast if there is one; otherwise YTD actual plus the
// remaining months' budget.
export function forecastCents({ budgetMonths, transfersNet, actuals, forecastYearEndCents, throughMonth }) {
  if (forecastYearEndCents != null) return c(forecastYearEndCents)
  let rest = 0
  for (let m = throughMonth + 1; m <= 12; m++) rest += monthBudgetCents(budgetMonths, transfersNet, m)
  return ytdActualCents(actuals, throughMonth) + rest
}

// ── One line, every figure ──────────────────────────────────────────────────────
// Pass a line's normalized data + the "through month". committedCents is the
// Phase-5 approved-but-not-invoiced spend (shown separately, never in actuals).
export function computeLine(input, throughMonth) {
  const budgetMonths = monthsToArray(input.budgetMonths)
  const transfersNet = input.transfersNet || transfersNetForLine(input.transfers, input.lineId)
  const actuals = input.actuals || []
  const m = Math.max(0, Math.min(12, Math.trunc(Number(throughMonth) || 0)))

  const yearBudget = yearBudgetCents(budgetMonths, transfersNet)
  const ytdBudget = ytdBudgetCents(budgetMonths, transfersNet, m)
  const ytdActual = ytdActualCents(actuals, m)
  const monthBudget = m >= 1 ? monthBudgetCents(budgetMonths, transfersNet, m) : 0
  const monthActual = m >= 1 ? monthActualCents(actuals, m) : 0
  const monthActualPosted = m >= 1 ? monthActualCents(actuals, m, { includePending: false }) : 0
  const forecast = forecastCents({ budgetMonths, transfersNet, actuals, forecastYearEndCents: input.forecastYearEndCents, throughMonth: m })

  return {
    throughMonth: m,
    monthBudget,
    monthActual,
    monthActualPosted,
    monthActualPending: monthActual - monthActualPosted,
    ytdBudget,
    ytdActual,
    yearBudget,
    left: yearBudget - ytdActual,
    varianceYtd: ytdActual - ytdBudget, // positive = over
    pctUsed: yearBudget === 0 ? 0 : ytdActual / yearBudget,
    forecast,
    forecastVsBudget: forecast - yearBudget, // positive = forecast over plan
    committed: c(input.committedCents),
    status: lineStatus(ytdActual, ytdBudget),
  }
}

// ── Roll several computed lines into a group / section / whole-budget total ──────
export function aggregate(computedLines) {
  const sum = (k) => computedLines.reduce((s, l) => s + c(l[k]), 0)
  const ytdBudget = sum('ytdBudget')
  const ytdActual = sum('ytdActual')
  return {
    monthBudget: sum('monthBudget'),
    monthActual: sum('monthActual'),
    ytdBudget,
    ytdActual,
    yearBudget: sum('yearBudget'),
    left: sum('left'),
    varianceYtd: ytdActual - ytdBudget,
    forecast: sum('forecast'),
    committed: sum('committed'),
    pctUsed: sum('yearBudget') === 0 ? 0 : ytdActual / sum('yearBudget'),
    status: lineStatus(ytdActual, ytdBudget),
  }
}

// Latest fiscal month that has any POSTED actual (the default "through month").
// Null when nothing is posted yet.
export function latestPostedMonth(actuals) {
  let max = 0
  for (const a of actuals || []) {
    if ((a.status ?? 'posted') !== 'posted') continue
    const mi = Math.trunc(Number(a.monthIndex ?? a.month_index))
    if (mi >= 1 && mi <= 12 && mi > max) max = mi
  }
  return max || null
}

// Year progress: fraction of the fiscal year elapsed by today (for the gold
// marker), i.e. months elapsed ÷ 12.
export function yearProgressFraction(today, startsOn) {
  const mi = fiscalMonthIndex(today, startsOn)
  if (mi == null) {
    const d = toDate(today)
    const s = toDate(startsOn)
    if (d && s && d < s) return 0
    return 1
  }
  return mi / 12
}

// ── Display ────────────────────────────────────────────────────────────────────
// Money from cents: "$1,234" by default (whole dollars, commas), "−$1,234" for
// negatives (a real minus sign, sign before the $). Pass { decimals: 2 } for cents.
export function formatMoneyCents(cents, { decimals = 0 } = {}) {
  if (cents == null || !Number.isFinite(Number(cents))) return '—'
  const dollars = Number(cents) / 100
  const sign = dollars < 0 ? '−' : ''
  return `${sign}$${Math.abs(dollars).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

// A signed figure for variances: "+$1,234" / "−$1,234".
export function formatSignedCents(cents, opts = {}) {
  if (cents == null || !Number.isFinite(Number(cents))) return '—'
  const n = Number(cents)
  const body = formatMoneyCents(Math.abs(n), opts)
  return n < 0 ? `−${body.replace('−', '')}` : `+${body}`
}

export function formatPct(fraction, { decimals = 0 } = {}) {
  if (fraction == null || !Number.isFinite(Number(fraction))) return '—'
  return `${(Number(fraction) * 100).toFixed(decimals)}%`
}

// The group keys, in display order, with their human labels.
export const GROUP_LABELS = {
  chem: 'Chemicals & Fertilizer',
  equip: 'Equipment',
  materials: 'Course Materials',
  repairs: 'Repairs & Maintenance',
  utilities: 'Utilities',
  admin: 'Administration',
  payroll: 'Payroll',
}
export const OPERATING_GROUP_ORDER = ['chem', 'equip', 'materials', 'repairs', 'utilities', 'admin']
