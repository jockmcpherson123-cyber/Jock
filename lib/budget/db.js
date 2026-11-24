// Data access for the Budget section. Same browser-client pattern as lib/db.js:
// every read/write runs as the logged-in user, so the database's row-level
// security (phase33.sql) decides what each person can actually do.
//
// Rows come back snake_case from Supabase; we map them into the camelCase
// shapes lib/budget/calc.js expects, so the math module never sees a raw row.
import { createClient } from '@/lib/supabase/client'

let _client = null
const supabase = new Proxy({}, {
  get(_t, prop) {
    if (!_client) _client = createClient()
    const v = _client[prop]
    return typeof v === 'function' ? v.bind(_client) : v
  },
})

// ── Years ────────────────────────────────────────────────────────────────────
export async function fetchBudgetYears() {
  const { data, error } = await supabase
    .from('budget_years')
    .select('id, fiscal_year, starts_on, status, approved_at')
    .order('fiscal_year', { ascending: false })
  if (error) { console.error('fetchBudgetYears', error); return [] }
  return (data || []).map((y) => ({
    id: y.id, fiscalYear: y.fiscal_year, startsOn: y.starts_on, status: y.status, approvedAt: y.approved_at,
  }))
}

// ── Everything for one year, assembled for the calc module ─────────────────────
export async function fetchBudgetData(yearId) {
  if (!yearId) return null

  const [linesRes, transfersRes] = await Promise.all([
    supabase.from('budget_lines')
      .select('id, gl_code, description, section, group_key, sort')
      .eq('year_id', yearId).order('sort', { ascending: true }),
    supabase.from('transfers')
      .select('id, from_line_id, to_line_id, amount_cents, reason, status, effective_month, requested_by, requested_at, decided_by, decided_at, decision_note')
      .eq('year_id', yearId).order('requested_at', { ascending: false }),
  ])
  if (linesRes.error) { console.error('budget lines', linesRes.error); return null }
  const lines = (linesRes.data || []).map((l) => ({
    id: l.id, glCode: l.gl_code, description: l.description, section: l.section, groupKey: l.group_key, sort: l.sort,
  }))
  const lineIds = lines.map((l) => l.id)

  // Child tables, filtered to this year's lines. (No lines yet → skip the queries.)
  const empty = { data: [] }
  const [monthsRes, actualsRes, forecastsRes, notesRes] = lineIds.length
    ? await Promise.all([
        supabase.from('budget_months').select('line_id, month_index, amount_cents').in('line_id', lineIds),
        supabase.from('actuals').select('id, line_id, month_index, amount_cents, source, status, vendor, invoice_no, invoice_date, memo').in('line_id', lineIds),
        supabase.from('forecasts').select('line_id, year_end_cents, note, created_by, created_at').in('line_id', lineIds).order('created_at', { ascending: false }),
        supabase.from('line_notes').select('id, line_id, author_id, body, read_by, created_at').in('line_id', lineIds).order('created_at', { ascending: true }),
      ])
    : [empty, empty, empty, empty]

  // budget months → { lineId: number[12] cents }
  const monthsByLine = {}
  for (const id of lineIds) monthsByLine[id] = Array(12).fill(0)
  for (const m of (monthsRes.data || [])) {
    const arr = monthsByLine[m.line_id]
    if (arr && m.month_index >= 1 && m.month_index <= 12) arr[m.month_index - 1] = Number(m.amount_cents) || 0
  }

  // actuals → { lineId: [...] }
  const actualsByLine = {}
  for (const id of lineIds) actualsByLine[id] = []
  for (const a of (actualsRes.data || [])) {
    ;(actualsByLine[a.line_id] ||= []).push({
      id: a.id, monthIndex: a.month_index, amountCents: Number(a.amount_cents) || 0,
      source: a.source, status: a.status, vendor: a.vendor, invoiceNo: a.invoice_no,
      invoiceDate: a.invoice_date, memo: a.memo,
    })
  }

  // transfers (year-wide; calc filters per line)
  const transfers = (transfersRes.data || []).map((t) => ({
    id: t.id, fromLineId: t.from_line_id, toLineId: t.to_line_id, amountCents: Number(t.amount_cents) || 0,
    reason: t.reason, status: t.status, effectiveMonth: t.effective_month,
    requestedBy: t.requested_by, requestedAt: t.requested_at,
    decidedBy: t.decided_by, decidedAt: t.decided_at, decisionNote: t.decision_note,
  }))
  const approvedTransfers = transfers.filter((t) => t.status === 'approved')

  // latest forecast per line
  const forecastByLine = {}
  for (const f of (forecastsRes.data || [])) {
    if (!forecastByLine[f.line_id]) {
      forecastByLine[f.line_id] = { yearEndCents: Number(f.year_end_cents) || 0, note: f.note, createdBy: f.created_by, createdAt: f.created_at }
    }
  }

  // notes per line
  const notesByLine = {}
  for (const n of (notesRes.data || [])) {
    ;(notesByLine[n.line_id] ||= []).push({
      id: n.id, authorId: n.author_id, body: n.body, readBy: n.read_by || [], createdAt: n.created_at,
    })
  }

  // per-line calc inputs (approved transfers only feed the budget math)
  const inputsByLine = {}
  for (const l of lines) {
    inputsByLine[l.id] = {
      lineId: l.id,
      budgetMonths: monthsByLine[l.id],
      actuals: actualsByLine[l.id],
      transfers: approvedTransfers,
      forecastYearEndCents: forecastByLine[l.id]?.yearEndCents ?? null,
    }
  }

  return { lines, monthsByLine, actualsByLine, transfers, approvedTransfers, forecastByLine, notesByLine, inputsByLine }
}
