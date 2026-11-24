'use client'

// ============================================================================
//  Budget — Golf Courses & Grounds
//
//  The department budget vs actual spend: cards, a CFO table, line detail, and
//  payroll (line totals only). All math comes from lib/budget/calc.js — this
//  file only fetches, lays out and formats. Phase 1 shows the approved plan;
//  actuals, notes, forecasts, transfers and the budget builder arrive in later
//  phases (their tabs are present as sign-posts).
//
//  Rule: no React hook is placed after an early return (a #310 crash once came
//  from exactly that). Every hook here sits at the top of its component.
// ============================================================================
import React, { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Download, Upload, Lock } from 'lucide-react'
import { FOREST, FERN, GOLD, PAPER, PAPER_2, HAIR, INK, INK_2, INK_3, RED, AMBER, PAGE } from '@/lib/theme'
import * as bdb from '@/lib/budget/db'
import { planImport, parseMoneyToCents } from '@/lib/budget/import'
import {
  computeLine, aggregate, latestPostedMonth, fiscalMonthIndex, yearProgressFraction,
  monthLabel, FY_MONTHS, formatMoneyCents, formatSignedCents, formatPct,
  GROUP_LABELS, OPERATING_GROUP_ORDER,
} from '@/lib/budget/calc'
import { formatDate } from '@/lib/format'

const GREEN = '#1E7A46'
const STATUS = {
  'on-track': { label: 'On track', fg: GREEN, bg: '#E7F3EC' },
  watch: { label: 'Watch', fg: AMBER, bg: '#FBF2E0' },
  over: { label: 'Over', fg: RED, bg: '#F6E5E2' },
}
const statusOf = (s) => STATUS[s] || STATUS['on-track']

// ── Root ───────────────────────────────────────────────────────────────────
export default function BudgetApp({ user }) {
  const isAdmin = user?.role === 'finance' // CFO / Accounting

  const [years, setYears] = useState([])
  const [yearId, setYearId] = useState(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [through, setThrough] = useState(12)
  const [touchedThrough, setTouchedThrough] = useState(false)
  const [tab, setTab] = useState('expenses')
  const [view, setView] = useState('cards')
  const [filter, setFilter] = useState('all')
  const [showEmpty, setShowEmpty] = useState(false)
  const [selLineId, setSelLineId] = useState(null)
  const [sort, setSort] = useState({ key: 'sort', dir: 1 })
  const [notice, setNotice] = useState('')
  const [batches, setBatches] = useState([])
  const [uploadOpen, setUploadOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  // Load the list of years once.
  useEffect(() => {
    let live = true
    ;(async () => {
      const ys = await bdb.fetchBudgetYears()
      if (!live) return
      setYears(ys)
      setYearId((cur) => cur || ys[0]?.id || null)
      if (!ys.length) setLoading(false)
    })()
    return () => { live = false }
  }, [])

  // Load the selected year's data.
  useEffect(() => {
    if (!yearId) return
    let live = true
    setLoading(true); setErr('')
    ;(async () => {
      try {
        const [d, b] = await Promise.all([bdb.fetchBudgetData(yearId), bdb.fetchImportBatches(20)])
        if (!live) return
        setData(d); setBatches(b)
      } catch (e) {
        if (live) setErr('Could not load the budget — check your connection.')
        console.error(e)
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => { live = false }
  }, [yearId, refreshKey])

  const year = years.find((y) => y.id === yearId) || null

  // Default the "through" month from the data: latest posted actual, else the
  // current fiscal month, else the full year.
  useEffect(() => {
    if (!data || touchedThrough) return
    const allActuals = Object.values(data.actualsByLine || {}).flat()
    const posted = latestPostedMonth(allActuals)
    let m = posted
    if (!m && year?.startsOn) m = fiscalMonthIndex(new Date(), year.startsOn)
    setThrough(m || 12)
  }, [data, year, touchedThrough])

  // Compute every line once, for the chosen through-month.
  const computed = useMemo(() => {
    if (!data) return null
    const byLine = {}
    for (const l of data.lines) byLine[l.id] = computeLine(data.inputsByLine[l.id], through)
    const withCalc = data.lines.map((l) => ({ line: l, c: byLine[l.id] }))
    const operating = withCalc.filter((x) => x.line.section === 'operating')
    const payroll = withCalc.filter((x) => x.line.section === 'payroll')
    return {
      byLine,
      operating,
      payroll,
      operatingAgg: aggregate(operating.map((x) => x.c)),
      payrollAgg: aggregate(payroll.map((x) => x.c)),
      totalAgg: aggregate(withCalc.map((x) => x.c)),
    }
  }, [data, through])

  // ---- hooks done; safe to branch ----
  if (loading) return <Centered>Loading the budget…</Centered>
  if (err) return <Centered>{err}</Centered>
  if (!year || !computed) {
    return (
      <Centered>
        No budget year found. Run <code className="mx-1">supabase/phase33.sql</code> then
        <code className="mx-1">supabase/phase33_seed.sql</code> in Supabase, then reload.
      </Centered>
    )
  }

  const isEmptyLine = (x) => x.c.yearBudget === 0 && x.c.ytdActual === 0 && x.c.committed === 0
  const visibleOperating = computed.operating.filter((x) => showEmpty || !isEmptyLine(x))
  const filterCounts = {
    all: visibleOperating.length,
    over: visibleOperating.filter((x) => x.c.status === 'over').length,
    watch: visibleOperating.filter((x) => x.c.status === 'watch').length,
    'on-track': visibleOperating.filter((x) => x.c.status === 'on-track').length,
  }
  const shownOperating = visibleOperating.filter((x) => filter === 'all' || x.c.status === filter)

  const selected = selLineId ? computed.operating.concat(computed.payroll).find((x) => x.line.id === selLineId) : null

  const exportCsv = () => downloadCsv(year, through, computed)

  return (
    <div className={`${PAGE} py-5`}>
      <Header
        year={year} years={years} onYear={(id) => { setYearId(id); setSelLineId(null) }}
        through={through} onThrough={(m) => { setThrough(m); setTouchedThrough(true) }}
        isAdmin={isAdmin} onExport={exportCsv}
        onUpload={() => setUploadOpen(true)}
        batches={batches}
      />

      {uploadOpen && (
        <UploadModal
          year={year} lines={data.lines}
          onClose={() => setUploadOpen(false)}
          onDone={(msg) => { setUploadOpen(false); setNotice(msg); setRefreshKey((k) => k + 1) }}
        />
      )}

      {notice && (
        <div className="mb-3 rounded-xl px-3 py-2 font-body text-[12px] flex items-center justify-between" style={{ backgroundColor: '#FBF2E0', color: AMBER }}>
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="font-bold px-2" aria-label="Dismiss">×</button>
        </div>
      )}

      <Tabs tab={tab} onTab={(t) => { setTab(t); setSelLineId(null) }} requests={data.transfers.filter((t) => t.status === 'pending').length} nextYear={year.fiscalYear + 1} />

      {tab === 'expenses' && !selected && (
        <>
          <SummaryTiles computed={computed} year={year} through={through} />
          <YearProgress year={year} operatingAgg={computed.operatingAgg} />
          <FilterBar
            filter={filter} counts={filterCounts} onFilter={setFilter}
            view={view} onView={setView} showEmpty={showEmpty} onShowEmpty={setShowEmpty}
          />
          {view === 'cards'
            ? <Cards groups={groupOperating(shownOperating)} onOpen={setSelLineId} />
            : <ExpenseTable rows={shownOperating} sort={sort} onSort={setSort} onOpen={setSelLineId} grand={aggregate(shownOperating.map((x) => x.c))} />}
        </>
      )}

      {tab === 'expenses' && selected && (
        <LineDetail key={selected.line.id} item={selected} data={data} through={through} onBack={() => setSelLineId(null)} />
      )}

      {tab === 'payroll' && <PayrollTab payroll={computed.payroll} agg={computed.payrollAgg} />}

      {tab === 'requests' && <Placeholder phase={3} title="Transfer requests" note="Request, approve and track moves between lines." />}
      {tab === 'build' && <Placeholder phase={4} title={`Build FY${year.fiscalYear + 1} budget`} note="Start from this year or last year's actuals, spread across months, submit and approve." />}
      {tab === 'activity' && <Placeholder phase={3} title="Activity" note="A feed of uploads, approvals, forecast changes, notes and edits." />}
    </div>
  )
}

// ── Header ─────────────────────────────────────────────────────────────────
function Header({ year, years, onYear, through, onThrough, isAdmin, onExport, onUpload, batches }) {
  const jonas = (batches || []).find((b) => b.source === 'jonas')
  const ottimate = (batches || []).find((b) => b.source === 'ottimate')
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold" style={{ color: FOREST }}>Budget</h1>
          <div className="mt-1 h-px" style={{ width: 30, backgroundColor: GOLD }} />
          <p className="font-body text-[13px] mt-1.5" style={{ color: INK_2 }}>
            Golf Courses &amp; Grounds · Fiscal year {year.fiscalYear} (Nov {year.fiscalYear - 1} – Oct {year.fiscalYear})
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={year.id} onChange={onYear} aria-label="Fiscal year"
            options={years.map((y) => ({ value: y.id, label: `FY${y.fiscalYear}` }))} />
          <Select value={through} onChange={(v) => onThrough(Number(v))} aria-label="Through month"
            options={FY_MONTHS.map((m, i) => ({ value: i + 1, label: `Thru ${m}` }))} />
          <button onClick={onExport} className="inline-flex items-center gap-1.5 font-body text-[12px] font-bold px-3 py-2 rounded-xl" style={{ border: `1px solid ${HAIR}`, color: FOREST, backgroundColor: 'white' }}>
            <Download size={14} /> Export
          </button>
          {isAdmin && (
            <button onClick={onUpload} className="inline-flex items-center gap-1.5 font-body text-[12px] font-bold px-3 py-2 rounded-xl text-white" style={{ backgroundColor: FOREST }}>
              <Upload size={14} /> Upload Jonas file
            </button>
          )}
        </div>
      </div>
      <div className="mt-2 font-body text-[11px]" style={{ color: INK_3 }}>
        {jonas
          ? `Jonas posted thru ${jonas.periodThrough ? formatDate(jonas.periodThrough, 'header') : '—'}`
          : 'No Jonas file uploaded yet — showing the approved plan.'}
        {ottimate && ` · Ottimate synced ${formatDate(ottimate.uploadedAt, 'list')}`}
      </div>
    </div>
  )
}

// ── Tabs ───────────────────────────────────────────────────────────────────
function Tabs({ tab, onTab, requests, nextYear }) {
  const items = [
    ['expenses', 'Expenses'],
    ['payroll', 'Payroll'],
    ['requests', `Requests${requests ? ` (${requests})` : ''}`],
    ['build', `Build FY${nextYear}`],
    ['activity', 'Activity'],
  ]
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 mb-4 border-b" style={{ borderColor: HAIR }}>
      {items.map(([key, label]) => (
        <button key={key} onClick={() => onTab(key)}
          className="font-body text-[13px] font-bold px-3.5 py-2 whitespace-nowrap transition"
          style={tab === key
            ? { color: FOREST, borderBottom: `2.5px solid ${GOLD}` }
            : { color: INK_3, borderBottom: '2.5px solid transparent' }}>
          {label}
        </button>
      ))}
    </div>
  )
}

// ── Summary tiles ────────────────────────────────────────────────────────────
function SummaryTiles({ computed, through }) {
  const op = computed.operatingAgg, pay = computed.payrollAgg, tot = computed.totalAgg
  const attention = computed.operating.filter((x) => x.c.status === 'over' || x.c.status === 'watch').length
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <Tile title="Operating budget (year)">
        <Big>{formatMoneyCents(op.yearBudget)}</Big>
        <Sub>Payroll {formatMoneyCents(pay.yearBudget)}</Sub>
        <Sub>Total {formatMoneyCents(tot.yearBudget)}</Sub>
      </Tile>
      <Tile title={`Spent YTD · thru ${monthLabel(through)}`}>
        <Big>{formatMoneyCents(op.ytdActual)}</Big>
        <Sub style={{ color: op.varianceYtd > 0 ? RED : GREEN }}>
          {formatSignedCents(op.varianceYtd)} vs YTD budget
        </Sub>
        <Sub>{formatPct(op.pctUsed)} of year budget</Sub>
      </Tile>
      <Tile title="Forecast year-end">
        <Big>{formatMoneyCents(op.forecast)}</Big>
        <Sub style={{ color: op.forecast - op.yearBudget > 0 ? RED : GREEN }}>
          {formatSignedCents(op.forecast - op.yearBudget)} vs plan
        </Sub>
      </Tile>
      <Tile title="Needs attention">
        <Big>{attention}</Big>
        <Sub>{computed.operating.filter((x) => x.c.status === 'over').length} over · {computed.operating.filter((x) => x.c.status === 'watch').length} watch</Sub>
        <Sub>0 open requests · 0 unread notes</Sub>
      </Tile>
    </div>
  )
}

// ── Year progress ─────────────────────────────────────────────────────────────
function YearProgress({ year, operatingAgg }) {
  const elapsed = yearProgressFraction(new Date(), year.startsOn)
  const spent = operatingAgg.yearBudget === 0 ? 0 : operatingAgg.ytdActual / operatingAgg.yearBudget
  const pct = (f) => `${Math.max(0, Math.min(100, f * 100)).toFixed(0)}%`
  return (
    <div className="rounded-2xl border p-4 mb-4" style={{ borderColor: HAIR, backgroundColor: 'white' }}>
      <div className="flex items-center justify-between mb-2">
        <p className="font-body text-[11px] font-bold uppercase tracking-wide" style={{ color: INK_3 }}>Year progress</p>
        <p className="font-body text-[11px]" style={{ color: INK_2 }}>{pct(spent)} spent · {pct(elapsed)} of year elapsed</p>
      </div>
      <div className="relative h-3 rounded-full overflow-hidden" style={{ backgroundColor: PAPER_2 }}>
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct(spent), backgroundColor: spent > elapsed + 0.02 ? AMBER : FERN }} />
        {/* gold marker at % of year elapsed */}
        <div className="absolute inset-y-[-3px] w-[2.5px]" style={{ left: pct(elapsed), backgroundColor: GOLD }} title="Year elapsed" />
      </div>
    </div>
  )
}

// ── Filter + view bar ──────────────────────────────────────────────────────
function FilterBar({ filter, counts, onFilter, view, onView, showEmpty, onShowEmpty }) {
  const pills = [['all', 'All'], ['over', 'Over'], ['watch', 'Watch'], ['on-track', 'On track']]
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      {pills.map(([key, label]) => {
        const on = filter === key
        const meta = key === 'all' ? { fg: FOREST } : statusOf(key)
        return (
          <button key={key} onClick={() => onFilter(key)}
            className="font-body text-[12px] font-bold px-3 py-1.5 rounded-full transition"
            style={on
              ? { backgroundColor: FOREST, color: 'white' }
              : { backgroundColor: 'white', color: meta.fg, border: `1px solid ${HAIR}` }}>
            {label} <span style={{ opacity: 0.7 }}>{counts[key] ?? 0}</span>
          </button>
        )
      })}
      <label className="ml-1 flex items-center gap-1.5 font-body text-[11.5px]" style={{ color: INK_2 }}>
        <input type="checkbox" checked={showEmpty} onChange={(e) => onShowEmpty(e.target.checked)} /> Show empty lines
      </label>
      <div className="ml-auto flex rounded-full overflow-hidden" style={{ border: `1px solid ${HAIR}` }}>
        {['cards', 'table'].map((v) => (
          <button key={v} onClick={() => onView(v)}
            className="font-body text-[12px] font-bold px-3 py-1.5 capitalize transition"
            style={view === v ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: INK_2 }}>
            {v}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Cards ──────────────────────────────────────────────────────────────────
function groupOperating(rows) {
  const by = {}
  for (const r of rows) (by[r.line.groupKey] ||= []).push(r)
  return OPERATING_GROUP_ORDER
    .filter((k) => by[k]?.length)
    .map((k) => ({ key: k, label: GROUP_LABELS[k] || k, rows: by[k], agg: aggregate(by[k].map((x) => x.c)) }))
}

function Cards({ groups, onOpen }) {
  if (!groups.length) return <Empty>No lines match this filter.</Empty>
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g.key}>
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="font-display text-[15px] font-semibold" style={{ color: FOREST }}>{g.label}</h3>
            <p className="font-body text-[12px]" style={{ color: INK_2 }}>
              {formatMoneyCents(g.agg.ytdActual)} of {formatMoneyCents(g.agg.ytdBudget)} YTD
              <span style={{ color: g.agg.varianceYtd > 0 ? RED : GREEN }}> · {formatSignedCents(g.agg.varianceYtd)}</span>
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {g.rows.map((r) => <LineCard key={r.line.id} item={r} onOpen={onOpen} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

function Bar({ actual, budget, color }) {
  const pct = budget <= 0 ? (actual > 0 ? 100 : 0) : Math.min(100, (actual / budget) * 100)
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: PAPER_2 }}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  )
}

function LineCard({ item, onOpen }) {
  const { line, c } = item
  const st = statusOf(c.status)
  return (
    <button onClick={() => onOpen(line.id)} className="text-left rounded-2xl border p-3.5 transition hover:shadow-sm w-full" style={{ borderColor: HAIR, backgroundColor: 'white' }}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="font-body text-[13.5px] font-bold truncate" style={{ color: INK }}>{line.description}</p>
          <p className="font-body text-[10.5px]" style={{ color: INK_3 }}>{line.glCode}</p>
        </div>
        <span className="shrink-0 font-body text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ color: st.fg, backgroundColor: st.bg }}>{st.label}</span>
      </div>
      <Row label={`Month · ${monthLabel(c.throughMonth)}`} a={c.monthActual} b={c.monthBudget} color={st.fg} />
      <Row label="YTD" a={c.ytdActual} b={c.ytdBudget} color={st.fg} />
      <div className="flex items-center justify-between mt-2 pt-2 font-body text-[11px] border-t" style={{ borderColor: HAIR, color: INK_2 }}>
        <span>Year {formatMoneyCents(c.yearBudget)}</span>
        <span>Left {formatMoneyCents(c.left)}</span>
        <span style={{ color: c.forecast - c.yearBudget > 0 ? RED : INK_2 }}>Fcst {formatMoneyCents(c.forecast)}</span>
      </div>
      {c.committed > 0 && <p className="font-body text-[10.5px] mt-1" style={{ color: FERN }}>Committed {formatMoneyCents(c.committed)}</p>}
    </button>
  )
}

function Row({ label, a, b, color }) {
  return (
    <div className="mb-1.5">
      <div className="flex items-center justify-between font-body text-[11.5px] mb-0.5" style={{ color: INK_2 }}>
        <span>{label}</span>
        <span><b style={{ color: INK }}>{formatMoneyCents(a)}</b> of {formatMoneyCents(b)}</span>
      </div>
      <Bar actual={a} budget={b} color={color} />
    </div>
  )
}

// ── Expense table ─────────────────────────────────────────────────────────────
const TABLE_COLS = [
  ['description', 'Description', 'l'],
  ['monthActual', 'Month act', 'r'],
  ['monthBudget', 'Month bud', 'r'],
  ['ytdActual', 'YTD act', 'r'],
  ['ytdBudget', 'YTD bud', 'r'],
  ['varianceYtd', 'Variance', 'r'],
  ['yearBudget', 'Year bud', 'r'],
  ['left', 'Left', 'r'],
  ['forecast', 'Forecast', 'r'],
  ['status', 'Status', 'c'],
]

function ExpenseTable({ rows, sort, onSort, onOpen, grand }) {
  const groups = groupOperating(rows)
  const dir = sort.dir
  const sortRows = (rs) => [...rs].sort((a, b) => {
    if (sort.key === 'description') return a.line.description.localeCompare(b.line.description) * dir
    if (sort.key === 'status') return String(a.c.status).localeCompare(String(b.c.status)) * dir
    if (sort.key === 'sort') return (a.line.sort - b.line.sort) * dir
    return ((a.c[sort.key] ?? 0) - (b.c[sort.key] ?? 0)) * dir
  })
  const head = (key) => () => onSort({ key, dir: sort.key === key ? -sort.dir : 1 })
  return (
    <div className="rounded-2xl border overflow-x-auto" style={{ borderColor: HAIR, backgroundColor: 'white' }}>
      <table className="w-full" style={{ minWidth: 900, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ backgroundColor: PAPER }}>
            <th className="text-left font-body text-[10px] font-bold uppercase tracking-wide px-2 py-2" style={{ color: INK_3 }}>GL</th>
            {TABLE_COLS.map(([key, label, align]) => (
              <th key={key} onClick={head(key)}
                className={`font-body text-[10px] font-bold uppercase tracking-wide px-2 py-2 cursor-pointer select-none ${align === 'l' ? 'text-left' : align === 'c' ? 'text-center' : 'text-right'}`}
                style={{ color: sort.key === key ? FOREST : INK_3 }}>
                {label}{sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <React.Fragment key={g.key}>
              <tr style={{ backgroundColor: '#F4F6F4' }}>
                <td colSpan={11} className="px-2 py-1.5 font-body text-[11px] font-bold" style={{ color: FOREST }}>{g.label}</td>
              </tr>
              {sortRows(g.rows).map((r) => <TableRow key={r.line.id} item={r} onOpen={onOpen} />)}
              <SubtotalRow label={`${g.label} subtotal`} c={g.agg} />
            </React.Fragment>
          ))}
          <SubtotalRow label="TOTAL OPERATING" c={grand} grand />
        </tbody>
      </table>
    </div>
  )
}

function TableRow({ item, onOpen }) {
  const { line, c } = item
  const st = statusOf(c.status)
  const cell = (v, extra = {}) => <td className="px-2 py-1.5 font-body text-[12px] text-right tabular-nums" style={{ color: INK, ...extra }}>{formatMoneyCents(v)}</td>
  return (
    <tr onClick={() => onOpen(line.id)} className="cursor-pointer border-t hover:bg-black/[0.02]" style={{ borderColor: HAIR }}>
      <td className="px-2 py-1.5 font-body text-[10.5px]" style={{ color: INK_3 }}>{line.glCode}</td>
      <td className="px-2 py-1.5 font-body text-[12px] font-semibold" style={{ color: INK }}>{line.description}</td>
      {cell(c.monthActual)}{cell(c.monthBudget)}{cell(c.ytdActual)}{cell(c.ytdBudget)}
      <td className="px-2 py-1.5 font-body text-[12px] text-right tabular-nums font-semibold" style={{ color: c.varianceYtd > 0 ? RED : GREEN }}>{formatSignedCents(c.varianceYtd)}</td>
      {cell(c.yearBudget)}{cell(c.left)}
      <td className="px-2 py-1.5 font-body text-[12px] text-right tabular-nums" style={{ color: c.forecast - c.yearBudget > 0 ? RED : INK }}>{formatMoneyCents(c.forecast)}</td>
      <td className="px-2 py-1.5 text-center"><span className="font-body text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ color: st.fg, backgroundColor: st.bg }}>{st.label}</span></td>
    </tr>
  )
}

function SubtotalRow({ label, c, grand }) {
  const td = (v, extra = {}) => <td className="px-2 py-1.5 font-body text-[12px] text-right tabular-nums font-bold" style={{ color: INK, ...extra }}>{formatMoneyCents(v)}</td>
  return (
    <tr className="border-t" style={{ borderColor: HAIR, backgroundColor: grand ? '#EFF3EF' : 'transparent' }}>
      <td />
      <td className="px-2 py-1.5 font-body text-[11.5px] font-bold" style={{ color: FOREST }}>{label}</td>
      {td(c.monthActual)}{td(c.monthBudget)}{td(c.ytdActual)}{td(c.ytdBudget)}
      <td className="px-2 py-1.5 font-body text-[12px] text-right tabular-nums font-bold" style={{ color: c.varianceYtd > 0 ? RED : GREEN }}>{formatSignedCents(c.varianceYtd)}</td>
      {td(c.yearBudget)}{td(c.left)}{td(c.forecast)}
      <td />
    </tr>
  )
}

// ── Payroll tab ───────────────────────────────────────────────────────────────
function PayrollTab({ payroll, agg }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3 rounded-xl px-3 py-2" style={{ backgroundColor: '#EFF3EF', color: INK_2 }}>
        <Lock size={14} style={{ color: FOREST }} />
        <span className="font-body text-[11.5px]">Line totals only, no individual pay. Visible to Superintendent, Director of Grounds, CFO and Accounting.</span>
      </div>
      <div className="rounded-2xl border overflow-x-auto" style={{ borderColor: HAIR, backgroundColor: 'white' }}>
        <table className="w-full" style={{ minWidth: 760, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: PAPER }}>
              {['Line', 'Month act', 'Month bud', 'YTD act', 'YTD bud', 'Difference', 'Year bud', 'Status'].map((h, i) => (
                <th key={h} className={`font-body text-[10px] font-bold uppercase tracking-wide px-2 py-2 ${i === 0 ? 'text-left' : i === 7 ? 'text-center' : 'text-right'}`} style={{ color: INK_3 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {payroll.map(({ line, c }) => {
              const st = statusOf(c.status)
              const cell = (v, extra = {}) => <td className="px-2 py-1.5 font-body text-[12px] text-right tabular-nums" style={{ color: INK, ...extra }}>{formatMoneyCents(v)}</td>
              return (
                <tr key={line.id} className="border-t" style={{ borderColor: HAIR }}>
                  <td className="px-2 py-1.5 font-body text-[12px] font-semibold" style={{ color: INK }}>{line.description}<span className="ml-1.5 font-normal" style={{ color: INK_3 }}>{line.glCode}</span></td>
                  {cell(c.monthActual)}{cell(c.monthBudget)}{cell(c.ytdActual)}{cell(c.ytdBudget)}
                  <td className="px-2 py-1.5 font-body text-[12px] text-right tabular-nums font-semibold" style={{ color: c.varianceYtd > 0 ? RED : GREEN }}>{formatSignedCents(c.varianceYtd)}</td>
                  {cell(c.yearBudget)}
                  <td className="px-2 py-1.5 text-center"><span className="font-body text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ color: st.fg, backgroundColor: st.bg }}>{st.label}</span></td>
                </tr>
              )
            })}
            <tr className="border-t" style={{ borderColor: HAIR, backgroundColor: '#EFF3EF' }}>
              <td className="px-2 py-1.5 font-body text-[11.5px] font-bold" style={{ color: FOREST }}>TOTAL PAYROLL</td>
              {[agg.monthActual, agg.monthBudget, agg.ytdActual, agg.ytdBudget].map((v, i) => <td key={i} className="px-2 py-1.5 font-body text-[12px] text-right tabular-nums font-bold" style={{ color: INK }}>{formatMoneyCents(v)}</td>)}
              <td className="px-2 py-1.5 font-body text-[12px] text-right tabular-nums font-bold" style={{ color: agg.varianceYtd > 0 ? RED : GREEN }}>{formatSignedCents(agg.varianceYtd)}</td>
              <td className="px-2 py-1.5 font-body text-[12px] text-right tabular-nums font-bold" style={{ color: INK }}>{formatMoneyCents(agg.yearBudget)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Line detail ────────────────────────────────────────────────────────────
function LineDetail({ item, data, through, onBack }) {
  const { line, c } = item
  const [monthPick, setMonthPick] = useState(through)
  const st = statusOf(c.status)
  const budgetMonths = data.monthsByLine[line.id] || Array(12).fill(0)
  const actuals = data.actualsByLine[line.id] || []
  const net = data.approvedTransfers // calc already applied; chart shows plan
  const invoices = actuals.filter((a) => a.monthIndex === monthPick)
  const invTotal = invoices.reduce((s, a) => s + a.amountCents, 0)
  const maxBar = Math.max(1, ...budgetMonths, ...FY_MONTHS.map((_, i) => actualOf(actuals, i + 1)))

  return (
    <div>
      <button onClick={onBack} className="inline-flex items-center gap-1 font-body text-[12px] font-bold mb-3" style={{ color: FERN }}>
        <ArrowLeft size={14} /> Back to Expenses
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl font-bold" style={{ color: FOREST }}>{line.description}</h2>
            <span className="font-body text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ color: st.fg, backgroundColor: st.bg }}>{st.label}</span>
          </div>
          <p className="font-body text-[11.5px] mt-0.5" style={{ color: INK_3 }}>{line.glCode}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {['Add note', 'Update forecast', 'Request transfer'].map((b) => (
            <button key={b} disabled title="Available in Phase 3"
              className="font-body text-[12px] font-bold px-3 py-2 rounded-xl opacity-50 cursor-not-allowed" style={{ border: `1px solid ${HAIR}`, color: INK_2 }}>{b}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Tile title="Year budget"><Big>{formatMoneyCents(c.yearBudget)}</Big></Tile>
        <Tile title={`Spent YTD · thru ${monthLabel(through)}`}><Big>{formatMoneyCents(c.ytdActual)}</Big><Sub style={{ color: c.varianceYtd > 0 ? RED : GREEN }}>{formatSignedCents(c.varianceYtd)} vs YTD budget</Sub></Tile>
        <Tile title="Committed"><Big>{formatMoneyCents(c.committed)}</Big><Sub>Approved, not yet invoiced</Sub></Tile>
        <Tile title="Forecast year-end"><Big>{formatMoneyCents(c.forecast)}</Big><Sub style={{ color: c.forecast - c.yearBudget > 0 ? RED : GREEN }}>{formatSignedCents(c.forecast - c.yearBudget)} vs plan</Sub></Tile>
      </div>

      {/* Month-by-month: budget bars; actual (dark) for months up to `through`, forecast (gold) after */}
      <div className="rounded-2xl border p-4 mb-4" style={{ borderColor: HAIR, backgroundColor: 'white' }}>
        <p className="font-body text-[11px] font-bold uppercase tracking-wide mb-3" style={{ color: INK_3 }}>Month by month · Nov → Oct</p>
        <div className="flex items-end gap-1.5" style={{ height: 150 }}>
          {FY_MONTHS.map((m, i) => {
            const mi = i + 1
            const bud = budgetMonths[i] || 0
            const act = actualOf(actuals, mi)
            const isPast = mi <= through
            const barH = (v) => `${Math.round((v / maxBar) * 120)}px`
            return (
              <div key={m} className="flex-1 flex flex-col items-center justify-end gap-1" onClick={() => setMonthPick(mi)} style={{ cursor: 'pointer' }}>
                <div className="w-full flex items-end justify-center gap-0.5" style={{ height: 120 }}>
                  <div style={{ width: 7, height: barH(bud), backgroundColor: PAPER_2, borderRadius: 2 }} title={`Budget ${formatMoneyCents(bud)}`} />
                  {act > 0 && <div style={{ width: 7, height: barH(act), backgroundColor: isPast ? FOREST : GOLD, borderRadius: 2 }} title={`${isPast ? 'Actual' : 'Forecast'} ${formatMoneyCents(act)}`} />}
                </div>
                <span className="font-body text-[9px]" style={{ color: mi === monthPick ? FOREST : INK_3, fontWeight: mi === monthPick ? 800 : 400 }}>{m}</span>
              </div>
            )
          })}
        </div>
        <p className="font-body text-[10.5px] mt-2" style={{ color: INK_3 }}>Grey = budget. Dark = posted/period actual. {actuals.length ? '' : 'No actuals yet — actual & forecast bars appear once a Jonas file is uploaded (Phase 2).'}</p>
      </div>

      {/* Invoices for the picked month */}
      <div className="rounded-2xl border p-4 mb-4" style={{ borderColor: HAIR, backgroundColor: 'white' }}>
        <div className="flex items-center justify-between mb-2">
          <p className="font-body text-[11px] font-bold uppercase tracking-wide" style={{ color: INK_3 }}>Invoices · {monthLabel(monthPick)}</p>
          <p className="font-body text-[12px] font-bold" style={{ color: INK }}>{formatMoneyCents(invTotal)}</p>
        </div>
        {invoices.length === 0
          ? <p className="font-body text-[12px]" style={{ color: INK_3 }}>No invoices for {monthLabel(monthPick)}.</p>
          : (
            <table className="w-full" style={{ borderCollapse: 'collapse' }}>
              <tbody>
                {invoices.map((a) => (
                  <tr key={a.id} className="border-t" style={{ borderColor: HAIR }}>
                    <td className="py-1.5 font-body text-[12px]" style={{ color: INK_2 }}>{a.invoiceDate || '—'}</td>
                    <td className="py-1.5 font-body text-[12px] font-semibold" style={{ color: INK }}>{a.vendor || '—'}</td>
                    <td className="py-1.5 font-body text-[12px]" style={{ color: INK_2 }}>{a.memo || ''}</td>
                    <td className="py-1.5 font-body text-[11px]" style={{ color: a.status === 'pending' ? AMBER : GREEN }}>{a.status === 'pending' ? 'Pending' : 'Posted'}</td>
                    <td className="py-1.5 font-body text-[12px] text-right tabular-nums" style={{ color: INK }}>{formatMoneyCents(a.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      {/* Forecast history */}
      <div className="rounded-2xl border p-4 mb-4" style={{ borderColor: HAIR, backgroundColor: 'white' }}>
        <p className="font-body text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: INK_3 }}>Forecast history</p>
        <div className="flex items-center justify-between font-body text-[12px] py-1">
          <span style={{ color: INK_2 }}>Original approved budget</span>
          <span className="font-bold" style={{ color: INK }}>{formatMoneyCents(c.yearBudget)}</span>
        </div>
        {data.forecastByLine[line.id]
          ? <div className="flex items-center justify-between font-body text-[12px] py-1 border-t" style={{ borderColor: HAIR }}><span style={{ color: INK_2 }}>Latest forecast</span><span className="font-bold" style={{ color: INK }}>{formatMoneyCents(data.forecastByLine[line.id].yearEndCents)}</span></div>
          : <p className="font-body text-[11px] mt-1" style={{ color: INK_3 }}>No forecast updates yet (Phase 3).</p>}
      </div>

      <Placeholder phase={3} title="Notes & transfers" note="The notes thread and transfer request panel for this line arrive in Phase 3." />
    </div>
  )
}

function actualOf(actuals, mi) {
  let t = 0
  for (const a of actuals) if (a.monthIndex === mi) t += a.amountCents
  return t
}

// ── Small shared bits ─────────────────────────────────────────────────────────
function Tile({ title, children }) {
  return (
    <div className="rounded-2xl border p-3.5" style={{ borderColor: HAIR, backgroundColor: 'white' }}>
      <p className="font-body text-[10.5px] font-bold uppercase tracking-wide mb-1" style={{ color: INK_3 }}>{title}</p>
      {children}
    </div>
  )
}
const Big = ({ children }) => <p className="font-display text-xl font-bold" style={{ color: FOREST }}>{children}</p>
const Sub = ({ children, style }) => <p className="font-body text-[11px] mt-0.5" style={{ color: INK_2, ...style }}>{children}</p>

function Select({ value, onChange, options, ...rest }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} {...rest}
      className="font-body text-[12px] font-bold px-2.5 py-2 rounded-xl bg-white" style={{ border: `1px solid ${HAIR}`, color: FOREST }}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function Placeholder({ phase, title, note }) {
  return (
    <div className="rounded-2xl border border-dashed p-8 text-center" style={{ borderColor: HAIR }}>
      <p className="font-display text-[15px] font-semibold" style={{ color: FOREST }}>{title}</p>
      <p className="font-body text-[12px] mt-1" style={{ color: INK_2 }}>{note}</p>
      <p className="font-body text-[11px] mt-2 inline-block px-2.5 py-1 rounded-full" style={{ backgroundColor: PAPER_2, color: INK_3 }}>Lands in Phase {phase}</p>
    </div>
  )
}

const Centered = ({ children }) => (
  <div className={`${PAGE} py-16`}><p className="font-body text-[13px] text-center" style={{ color: INK_2 }}>{children}</p></div>
)
const Empty = ({ children }) => (
  <div className="rounded-2xl border p-8 text-center font-body text-[13px]" style={{ borderColor: HAIR, color: INK_3, backgroundColor: 'white' }}>{children}</div>
)

// ── Jonas file upload (CSV/XLSX) with a column-mapping step ────────────────────
const MAP_FIELDS = [
  ['gl', 'GL account', true],
  ['date', 'Date or period', true],
  ['amount', 'Amount', false],
  ['debit', 'Debit', false],
  ['credit', 'Credit', false],
  ['vendor', 'Vendor', false],
  ['description', 'Description / memo', false],
  ['reference', 'Invoice / reference', false],
]
function autoGuess(headers, cur) {
  const find = (re) => headers.find((h) => re.test(h.toLowerCase())) || ''
  return {
    gl: cur.gl || find(/\b(gl|account|acct)\b/),
    date: cur.date || find(/date|period|posted/),
    amount: cur.amount || find(/^amount$|^total$|net/),
    debit: cur.debit || find(/debit/),
    credit: cur.credit || find(/credit/),
    vendor: cur.vendor || find(/vendor|supplier|payee|name/),
    description: cur.description || find(/desc|memo|detail|narr/),
    reference: cur.reference || find(/ref|invoice|doc|number|no\b/),
    useDebitCredit: cur.useDebitCredit || false,
  }
}
const maxDate = (dates) => dates.filter(Boolean).map((d) => bdbIso(d)).filter(Boolean).sort().slice(-1)[0] || null
function bdbIso(v) {
  if (!v) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return v
  const d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function UploadModal({ year, lines, onClose, onDone }) {
  const [stage, setStage] = useState('file')
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState([])
  const [rows, setRows] = useState([])
  const [mapping, setMapping] = useState({ useDebitCredit: false })
  const [aliases, setAliases] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    bdb.fetchImportConfig('jonas').then((cfg) => { if (live) { setMapping((m) => ({ ...cfg.mapping, ...m })); setAliases(cfg.glAliases || {}) } })
    return () => { live = false }
  }, [])

  const glToLine = useMemo(() => Object.fromEntries(lines.map((l) => [l.glCode, l.id])), [lines])
  const aliasesLineId = useMemo(() => {
    const out = {}
    for (const [raw, gl] of Object.entries(aliases)) if (glToLine[gl]) out[raw] = glToLine[gl]
    return out
  }, [aliases, glToLine])

  const mappedRows = useMemo(() => rows.map((r) => ({
    glRaw: r[mapping.gl],
    dateRaw: r[mapping.date],
    amountCents: mapping.useDebitCredit
      ? parseMoneyToCents(r[mapping.debit]) - parseMoneyToCents(r[mapping.credit])
      : parseMoneyToCents(r[mapping.amount]),
    vendor: mapping.vendor ? r[mapping.vendor] : null,
    invoiceNo: mapping.reference ? r[mapping.reference] : null,
    memo: mapping.description ? r[mapping.description] : null,
  })), [rows, mapping])

  const plan = useMemo(() => planImport({ rows: mappedRows, lines, aliases: aliasesLineId, startsOn: year.startsOn }), [mappedRows, lines, aliasesLineId, year])

  async function onFile(file) {
    setError('')
    try {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const arr = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
      const hr = arr.findIndex((r) => r.some((c) => String(c).trim()))
      if (hr < 0) { setError('That file looks empty.'); return }
      const hs = arr[hr].map((h) => String(h).trim())
      const objs = arr.slice(hr + 1).filter((r) => r.some((c) => String(c).trim())).map((r) => Object.fromEntries(hs.map((h, i) => [h, r[i] ?? ''])))
      setHeaders(hs); setRows(objs); setFileName(file.name)
      setMapping((m) => autoGuess(hs, m)); setStage('map')
    } catch (e) { setError('Could not read that file. Use the Jonas CSV or Excel export.'); console.error(e) }
  }

  // unmatched, grouped by GL so mapping one maps them all
  const unmatchedByGl = useMemo(() => {
    const by = {}
    for (const u of plan.unmatched) (by[u.glRaw || '(blank)'] ||= []).push(u)
    return Object.entries(by)
  }, [plan])

  async function apply() {
    setBusy(true); setError('')
    try {
      await bdb.saveImportConfig('jonas', { mapping, glAliases: aliases })
      await bdb.applyJonasImport({
        lineIds: lines.map((l) => l.id), matched: plan.matched, monthsTouched: plan.monthsTouched,
        fileName, periodThrough: maxDate(plan.matched.map((r) => r.invoiceDate)), unmatchedCount: plan.unmatchedCount,
      })
      onDone(`Imported ${plan.matched.length} rows from ${fileName} — ${formatMoneyCents(plan.totalCents)} across ${plan.monthsTouched.length} month(s).`)
    } catch (e) { setError('Import failed — ' + (e.message || 'please try again.')); setBusy(false) }
  }

  const colSelect = (field, label, required) => (
    <label className="flex items-center justify-between gap-3 py-1.5">
      <span className="font-body text-[12px]" style={{ color: INK_2 }}>{label}{required ? ' *' : ''}</span>
      <select value={mapping[field] || ''} onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))}
        className="font-body text-[12px] px-2 py-1.5 rounded-lg bg-white" style={{ border: `1px solid ${HAIR}`, minWidth: 180 }}>
        <option value="">—</option>
        {headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </label>
  )

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center p-4 overflow-y-auto" style={{ backgroundColor: 'rgba(10,20,14,0.5)' }} onClick={onClose}>
      <div className="relative w-full max-w-2xl my-8 rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-lg font-bold" style={{ color: FOREST }}>Upload Jonas file</h3>
          <button onClick={onClose} className="font-body text-xl px-2" style={{ color: INK_3 }} aria-label="Close">×</button>
        </div>
        {error && <div className="mb-3 rounded-xl px-3 py-2 font-body text-[12px]" style={{ backgroundColor: '#F6E5E2', color: RED }}>{error}</div>}

        {stage === 'file' && (
          <div>
            <p className="font-body text-[12.5px] mb-3" style={{ color: INK_2 }}>Upload the GL export from Jonas (CSV or Excel). You'll map the columns next — the mapping is saved and reused for future uploads.</p>
            <label className="block rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer" style={{ borderColor: HAIR, color: FERN }}>
              <Upload size={22} className="inline" />
              <p className="font-body text-[13px] font-bold mt-1">Choose a .csv or .xlsx file</p>
              <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
          </div>
        )}

        {stage === 'map' && (
          <div>
            <p className="font-body text-[12px] mb-2" style={{ color: INK_2 }}><b>{fileName}</b> · {rows.length} rows. Tell me which column is which:</p>
            <label className="flex items-center gap-2 mb-1 font-body text-[12px]" style={{ color: INK_2 }}>
              <input type="checkbox" checked={!!mapping.useDebitCredit} onChange={(e) => setMapping((m) => ({ ...m, useDebitCredit: e.target.checked }))} />
              This file uses separate Debit / Credit columns (not one Amount)
            </label>
            <div className="rounded-xl border p-3" style={{ borderColor: HAIR }}>
              {MAP_FIELDS.filter(([f]) => mapping.useDebitCredit ? f !== 'amount' : (f !== 'debit' && f !== 'credit')).map(([f, label, req]) => colSelect(f, label, req))}
            </div>
            <div className="flex justify-between mt-4">
              <button onClick={() => setStage('file')} className="font-body text-[12px] font-bold px-3 py-2 rounded-xl" style={{ color: INK_2, border: `1px solid ${HAIR}` }}>Back</button>
              <button onClick={() => setStage('review')} disabled={!mapping.gl || !mapping.date || (mapping.useDebitCredit ? (!mapping.debit && !mapping.credit) : !mapping.amount)}
                className="font-body text-[12px] font-bold px-4 py-2 rounded-xl text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>Preview →</button>
            </div>
          </div>
        )}

        {stage === 'review' && (
          <div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              <Mini label="Rows read" v={plan.rowCount} />
              <Mini label="Matched" v={plan.matchedCount} />
              <Mini label="Unmatched" v={plan.unmatchedCount} warn={plan.unmatchedCount > 0} />
              <Mini label="Total" v={formatMoneyCents(plan.totalCents)} />
            </div>
            <p className="font-body text-[12px] mb-3" style={{ color: INK_2 }}>
              Operating {formatMoneyCents(plan.bySection.operating)} · Payroll {formatMoneyCents(plan.bySection.payroll)} ·
              Months: {plan.monthsTouched.map((m) => monthLabel(m)).join(', ') || '—'}
            </p>

            {unmatchedByGl.length > 0 && (
              <div className="rounded-xl border p-3 mb-3" style={{ borderColor: HAIR }}>
                <p className="font-body text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: AMBER }}>Unmatched — map each GL to a line, or leave to ignore</p>
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {unmatchedByGl.map(([gl, list]) => (
                    <div key={gl} className="flex items-center justify-between gap-2">
                      <span className="font-body text-[12px]" style={{ color: INK }}>{gl} <span style={{ color: INK_3 }}>({list.length})</span></span>
                      <select value={aliases[gl] || ''} onChange={(e) => setAliases((a) => { const n = { ...a }; if (e.target.value) n[gl] = e.target.value; else delete n[gl]; return n })}
                        className="font-body text-[12px] px-2 py-1.5 rounded-lg bg-white" style={{ border: `1px solid ${HAIR}`, minWidth: 220 }}>
                        <option value="">Ignore</option>
                        {lines.map((l) => <option key={l.id} value={l.glCode}>{l.glCode} · {l.description}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="font-body text-[11px] mb-3" style={{ color: INK_3 }}>Re-uploading a period replaces that period's Jonas rows, so applying this won't double-count {plan.monthsTouched.map((m) => monthLabel(m)).join(', ')}.</p>
            <div className="flex justify-between">
              <button onClick={() => setStage('map')} className="font-body text-[12px] font-bold px-3 py-2 rounded-xl" style={{ color: INK_2, border: `1px solid ${HAIR}` }}>Back</button>
              <button onClick={apply} disabled={busy || plan.matchedCount === 0}
                className="font-body text-[12px] font-bold px-4 py-2 rounded-xl text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>
                {busy ? 'Importing…' : `Apply ${plan.matchedCount} rows`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
const Mini = ({ label, v, warn }) => (
  <div className="rounded-xl border p-2.5" style={{ borderColor: HAIR }}>
    <p className="font-body text-[9.5px] font-bold uppercase tracking-wide" style={{ color: INK_3 }}>{label}</p>
    <p className="font-display text-[15px] font-bold" style={{ color: warn ? AMBER : FOREST }}>{v}</p>
  </div>
)

// ── CSV export of the current operating table ──────────────────────────────────
function downloadCsv(year, through, computed) {
  const head = ['GL', 'Description', 'Group', 'Month actual', 'Month budget', 'YTD actual', 'YTD budget', 'Variance', 'Year budget', 'Left', 'Forecast', 'Status']
  const d = (c) => (c / 100).toFixed(2)
  const lines = [head.join(',')]
  for (const { line, c } of computed.operating) {
    lines.push([line.glCode, `"${line.description}"`, line.groupKey, d(c.monthActual), d(c.monthBudget), d(c.ytdActual), d(c.ytdBudget), d(c.varianceYtd), d(c.yearBudget), d(c.left), d(c.forecast), c.status].join(','))
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `budget_FY${year.fiscalYear}_thru_${monthLabel(through)}.csv`
  a.click(); URL.revokeObjectURL(url)
}
