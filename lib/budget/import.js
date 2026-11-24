// ============================================================================
//  Jonas (and manual) actuals import — pure logic, no DB and no React.
//
//  The club's books live in Jonas, which has no API, so the CFO uploads a GL
//  export (CSV/XLSX). We don't have a sample yet, so the UI has a column-mapping
//  step; this module turns mapped rows into actuals, matches them to budget
//  lines by GL code, derives the fiscal month, and plans the period-replace so
//  a re-upload never double-counts.
//
//  All money is integer cents. Fiscal month 1 = November.
// ============================================================================
import { fiscalMonthIndex } from './calc.js'

// ── GL normalization + matching ────────────────────────────────────────────
// Strip everything but letters/digits so "612800-13", "61280013" and
// "612800 - 13" all compare equal. Department 13 is the Golf & Grounds suffix.
export function normGl(gl) {
  return String(gl ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Build a lookup from every normalized form of each line's GL to its id, so a
// file row can match whether or not it carries the "-13" department suffix.
export function buildGlIndex(lines, aliases = {}) {
  const idx = new Map()
  for (const l of lines) {
    const n = normGl(l.glCode)
    idx.set(n, l.id)
    if (n.endsWith('13')) idx.set(n.slice(0, -2), l.id) // bare account, dept implied
  }
  // Saved unmatched→line aliases win if present.
  for (const [gl, lineId] of Object.entries(aliases || {})) idx.set(normGl(gl), lineId)
  return idx
}

export function matchLineId(idx, fileGl) {
  const n = normGl(fileGl)
  if (!n) return null
  if (idx.has(n)) return idx.get(n)
  if (idx.has(n + '13')) return idx.get(n + '13') // file had bare account, dept 13
  return null
}

// ── Money + date parsing from free-form cells ────────────────────────────────
// "$1,234.56", "1234.56", "(1,234.56)" (parens = negative) → integer cents.
export function parseMoneyToCents(v) {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return Math.round(v * 100)
  let s = String(v).trim()
  const neg = /^\(.*\)$/.test(s) || /-\s*$/.test(s) || /^-/.test(s)
  s = s.replace(/[(),$\s]/g, '').replace(/-/g, '')
  const n = parseFloat(s)
  if (!isFinite(n)) return 0
  return Math.round(n * 100) * (neg ? -1 : 1)
}

// Derive a fiscal month (1..12) from a date or period cell. Handles ISO dates,
// "YYYY-MM", "MM/DD/YYYY", "Mon YYYY", and a bare "YYYY-MM"/"Mon-YY".
export function cellToFiscalMonth(value, startsOn) {
  if (value == null || value === '') return null
  const s = String(value).trim()
  // YYYY-MM or YYYY/MM (period, no day)
  let m = s.match(/^(\d{4})[-/](\d{1,2})$/)
  if (m) return fiscalMonthIndex(`${m[1]}-${String(m[2]).padStart(2, '0')}-01`, startsOn)
  // Mon YYYY  / Mon-YY  (e.g. "Jul 2026", "Jul-26")
  m = s.match(/^([A-Za-z]{3,})[\s-]+(\d{2,4})$/)
  if (m) {
    const mi = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1].slice(0, 3).toLowerCase())
    if (mi >= 0) {
      const yr = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2])
      return fiscalMonthIndex(`${yr}-${String(mi + 1).padStart(2, '0')}-01`, startsOn)
    }
  }
  // Fall back to Date parsing (ISO, US dates, etc.)
  const d = new Date(s)
  if (!isNaN(d.getTime())) return fiscalMonthIndex(d, startsOn)
  return null
}

// A stable key to dedupe a row across uploads when there is no external id.
export function dedupeKey(r) {
  if (r.externalId) return `ext:${r.externalId}`
  return ['k', r.invoiceDate || '', normGl(r.glRaw || ''), r.amountCents, r.invoiceNo || ''].join('|')
}

// ── Plan an import from already-mapped rows ──────────────────────────────────
// `rows` are objects already pulled through the column mapping:
//   { glRaw, dateRaw, amountCents, vendor, invoiceNo, memo, externalId }
// Returns matched actuals, an unmatched list (to map or ignore), the fiscal
// months the file touches (for the period-replace), and summary totals.
export function planImport({ rows, lines, aliases = {}, startsOn }) {
  const idx = buildGlIndex(lines, aliases)
  const lineById = Object.fromEntries(lines.map((l) => [l.id, l]))
  const matched = []
  const unmatched = []
  const monthsTouched = new Set()
  let totalCents = 0
  const bySection = { payroll: 0, operating: 0 }

  for (const r of rows) {
    const amountCents = r.amountCents ?? parseMoneyToCents(r.amount)
    const lineId = matchLineId(idx, r.glRaw)
    const monthIndex = cellToFiscalMonth(r.dateRaw, startsOn)
    const base = {
      glRaw: r.glRaw, amountCents, monthIndex,
      vendor: r.vendor || null, invoiceNo: r.invoiceNo || null,
      invoiceDate: r.dateRaw || null, memo: r.memo || null, externalId: r.externalId || null,
    }
    if (lineId && monthIndex) {
      matched.push({ ...base, lineId, dedupeKey: dedupeKey(base) })
      monthsTouched.add(monthIndex)
      totalCents += amountCents
      const sec = lineById[lineId]?.section || 'operating'
      bySection[sec] = (bySection[sec] || 0) + amountCents
    } else {
      unmatched.push({ ...base, reason: !lineId ? 'no matching GL' : 'no readable date/period' })
    }
  }

  return {
    matched,
    unmatched,
    monthsTouched: [...monthsTouched].sort((a, b) => a - b),
    totalCents,
    bySection,
    rowCount: rows.length,
    matchedCount: matched.length,
    unmatchedCount: unmatched.length,
  }
}
