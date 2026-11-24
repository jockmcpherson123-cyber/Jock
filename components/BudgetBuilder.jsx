'use client'

// Build next year's budget. Starts from this year's budget, its actuals, or
// blank; edits month-by-month like the Annual Program grid (Enter commits and
// moves down, ⌘/Ctrl-Z undoes); spread + %-change tools; Submit → Approve with a
// lock; and exports a Jonas import file and a printable business-plan PDF.
//
// All math is in whole dollars on screen, stored as integer cents. No hook sits
// after an early return.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { FOREST, FERN, GOLD, PAPER, PAPER_2, HAIR, INK, INK_2, INK_3, RED } from '@/lib/theme'
import * as bdb from '@/lib/budget/db'
import { FY_MONTHS, GROUP_LABELS, OPERATING_GROUP_ORDER, formatMoneyCents } from '@/lib/budget/calc'

const sum = (a) => a.reduce((s, x) => s + (Number(x) || 0), 0)

export default function BudgetBuilder({ currentYear, years, isAdmin, canEdit, onReloadYears }) {
  const nextFy = currentYear.fiscalYear + 1
  const draftYear = years.find((y) => y.fiscalYear === nextFy) || null

  const [draft, setDraft] = useState(null)       // fetched draft-year data
  const [prior, setPrior] = useState(null)       // this year's data (for "like last year")
  const [vals, setVals] = useState({})           // { lineId: number[12] dollars }
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [pct, setPct] = useState('3')
  const [scope, setScope] = useState('payroll')
  const undoRef = useRef([])

  useEffect(() => {
    let live = true
    setLoading(true)
    ;(async () => {
      try {
        const [d, p] = await Promise.all([
          draftYear ? bdb.fetchBudgetData(draftYear.id) : Promise.resolve(null),
          bdb.fetchBudgetData(currentYear.id),
        ])
        if (!live) return
        setPrior(p)
        if (d) {
          setDraft(d)
          const v = {}
          for (const l of d.lines) v[l.id] = (d.monthsByLine[l.id] || Array(12).fill(0)).map((c) => Math.round(c / 100))
          setVals(v)
        }
      } catch (e) { console.error(e) } finally { if (live) setLoading(false) }
    })()
    return () => { live = false }
  }, [draftYear?.id, currentYear.id])

  // ⌘/Ctrl-Z — restore the last snapshot
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && undoRef.current.length) {
        e.preventDefault()
        const prev = undoRef.current.pop()
        setVals(prev.vals)
        if (prev.lineId) bdb.saveDraftMonths(prev.lineId, prev.vals[prev.lineId].map((d) => d * 100)).catch(() => {})
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const locked = draftYear?.status === 'approved' || !canEdit
  const snapshot = (lineId) => { undoRef.current.push({ lineId, vals: structuredClone(vals) }); if (undoRef.current.length > 30) undoRef.current.shift() }

  const setCell = (lineId, i, dollars) => setVals((v) => ({ ...v, [lineId]: v[lineId].map((x, j) => (j === i ? dollars : x)) }))
  const saveRow = async (lineId) => { try { await bdb.saveDraftMonths(lineId, (vals[lineId] || []).map((d) => Math.round(Number(d) || 0) * 100)) } catch (e) { console.error(e) } }

  const spreadEven = (lineId) => { snapshot(lineId); const total = sum(vals[lineId]); const per = Math.round(total / 12); const arr = Array(12).fill(per); arr[11] = total - per * 11; setVals((v) => ({ ...v, [lineId]: arr })); setTimeout(() => saveRow(lineId), 0) }
  const spreadLikeLastYear = (lineId, glCode) => {
    snapshot(lineId)
    const total = sum(vals[lineId])
    const priorLine = prior?.lines.find((l) => l.glCode === glCode)
    const pm = priorLine ? (prior.monthsByLine[priorLine.id] || []) : []
    const pTotal = sum(pm)
    const arr = pTotal > 0 ? pm.map((c) => Math.round((c / pTotal) * total)) : Array(12).fill(Math.round(total / 12))
    // fix rounding drift into the last month
    arr[11] = total - sum(arr.slice(0, 11))
    setVals((v) => ({ ...v, [lineId]: arr })); setTimeout(() => saveRow(lineId), 0)
  }

  const applyPct = async () => {
    if (!draft) return
    const f = 1 + (Number(pct) || 0) / 100
    const affected = draft.lines.filter((l) => scope === 'all' ? true : scope === 'payroll' || scope === 'operating' ? l.section === scope : l.groupKey === scope)
    undoRef.current.push({ lineId: null, vals: structuredClone(vals) })
    const next = { ...vals }
    for (const l of affected) next[l.id] = (vals[l.id] || []).map((d) => Math.round((Number(d) || 0) * f))
    setVals(next)
    setBusy(true)
    try { for (const l of affected) await bdb.saveDraftMonths(l.id, next[l.id].map((d) => d * 100)) } catch (e) { console.error(e) }
    setBusy(false)
  }

  const start = async (basis) => { setBusy(true); try { await bdb.createNextYear({ fromYear: currentYear, basis }); onReloadYears() } catch (e) { console.error(e); alert('Could not start the next year — ' + (e.message || '')) } setBusy(false) }
  const submit = async () => { setBusy(true); try { await bdb.setYearStatus(draftYear.id, 'submitted'); onReloadYears() } catch (e) { console.error(e) } setBusy(false) }
  const approve = async () => { setBusy(true); try { await bdb.setYearStatus(draftYear.id, 'approved'); onReloadYears() } catch (e) { console.error(e) } setBusy(false) }

  // ---- hooks done ----
  if (loading) return <p className="font-body text-[13px]" style={{ color: INK_2 }}>Loading…</p>

  if (!draftYear) {
    return (
      <div className="rounded-2xl border p-6" style={{ borderColor: HAIR, backgroundColor: 'white' }}>
        <p className="font-display text-[15px] font-semibold mb-1" style={{ color: FOREST }}>Build the FY{nextFy} budget</p>
        <p className="font-body text-[12.5px] mb-4" style={{ color: INK_2 }}>Start from a copy you can edit, then submit it for the CFO to approve.</p>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <StartBtn onClick={() => start('budget')} busy={busy}>Start from FY{currentYear.fiscalYear} budget</StartBtn>
            <StartBtn onClick={() => start('actuals')} busy={busy}>Start from FY{currentYear.fiscalYear} actuals</StartBtn>
            <StartBtn onClick={() => start('blank')} busy={busy} ghost>Start blank</StartBtn>
          </div>
        ) : <p className="font-body text-[12px]" style={{ color: INK_3 }}>No FY{nextFy} draft yet.</p>}
      </div>
    )
  }

  const rowsByGroup = groupLines(draft.lines)
  const grand = Array(12).fill(0)
  for (const l of draft.lines) (vals[l.id] || []).forEach((d, i) => { grand[i] += Number(d) || 0 })
  const payrollTotal = sumLines(draft.lines.filter((l) => l.section === 'payroll'), vals)
  const operatingTotal = sumLines(draft.lines.filter((l) => l.section === 'operating'), vals)

  const statusBadge = { draft: ['Draft', GOLD], submitted: ['Submitted — awaiting CFO', FERN], approved: ['Approved — locked', FOREST] }[draftYear.status] || ['Draft', GOLD]

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-[15px] font-semibold" style={{ color: FOREST }}>FY{nextFy} budget</h3>
          <span className="font-body text-[10px] font-bold px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: statusBadge[1] }}>{statusBadge[0]}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => exportJonas(draft, vals, nextFy)} className="font-body text-[12px] font-bold px-3 py-2 rounded-xl" style={{ border: `1px solid ${HAIR}`, color: FOREST }}>Export Jonas file</button>
          <button onClick={() => printPlan(draft, vals, nextFy, payrollTotal, operatingTotal)} className="font-body text-[12px] font-bold px-3 py-2 rounded-xl" style={{ border: `1px solid ${HAIR}`, color: FOREST }}>Print PDF</button>
          {!locked && draftYear.status === 'draft' && <button onClick={submit} disabled={busy} className="font-body text-[12px] font-bold px-3 py-2 rounded-xl text-white disabled:opacity-40" style={{ backgroundColor: FERN }}>Submit to CFO</button>}
          {draftYear.status === 'submitted' && isAdmin && <button onClick={approve} disabled={busy} className="font-body text-[12px] font-bold px-3 py-2 rounded-xl text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>Approve &amp; lock</button>}
        </div>
      </div>

      {!locked && (
        <div className="flex flex-wrap items-center gap-2 mb-3 rounded-xl p-2.5" style={{ backgroundColor: PAPER }}>
          <span className="font-body text-[11.5px] font-bold" style={{ color: INK_2 }}>Adjust</span>
          <select value={scope} onChange={(e) => setScope(e.target.value)} className="border rounded-lg px-2 py-1.5 font-body text-[12px] bg-white" style={{ borderColor: HAIR }}>
            <option value="payroll">Payroll (section)</option>
            <option value="operating">Operating (section)</option>
            <option value="all">Whole budget</option>
            {OPERATING_GROUP_ORDER.map((k) => <option key={k} value={k}>{GROUP_LABELS[k]}</option>)}
          </select>
          <span className="font-body text-[11.5px]" style={{ color: INK_2 }}>by</span>
          <input value={pct} onChange={(e) => setPct(e.target.value)} className="w-16 border rounded-lg px-2 py-1.5 font-body text-[12px] text-right" style={{ borderColor: HAIR }} />
          <span className="font-body text-[11.5px]" style={{ color: INK_2 }}>%</span>
          <button onClick={applyPct} disabled={busy} className="font-body text-[12px] font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>Apply</button>
          <span className="font-body text-[11px] ml-2" style={{ color: INK_3 }}>Enter commits a cell; ⌘/Ctrl-Z undoes.</span>
        </div>
      )}

      <div className="rounded-2xl border overflow-x-auto" style={{ borderColor: HAIR, backgroundColor: 'white' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead>
            <tr style={{ backgroundColor: PAPER }}>
              <th className="sticky left-0 text-left font-body text-[10px] font-bold uppercase px-2 py-2" style={{ color: INK_3, backgroundColor: PAPER, minWidth: 190 }}>Line</th>
              {FY_MONTHS.map((m) => <th key={m} className="font-body text-[10px] font-bold uppercase px-1.5 py-2 text-right" style={{ color: INK_3 }}>{m}</th>)}
              <th className="font-body text-[10px] font-bold uppercase px-2 py-2 text-right" style={{ color: FOREST }}>Total</th>
              {!locked && <th />}
            </tr>
          </thead>
          <tbody>
            {rowsByGroup.map((g) => (
              <React.Fragment key={g.key}>
                <tr style={{ backgroundColor: '#F4F6F4' }}><td colSpan={15} className="px-2 py-1 font-body text-[11px] font-bold" style={{ color: FOREST }}>{g.label}</td></tr>
                {g.lines.map((l, ri) => {
                  const row = vals[l.id] || Array(12).fill(0)
                  return (
                    <tr key={l.id} className="border-t" style={{ borderColor: HAIR }}>
                      <td className="sticky left-0 px-2 py-1 font-body text-[12px] font-semibold" style={{ color: INK, backgroundColor: 'white', minWidth: 190 }}>{l.description}<span className="ml-1 font-normal" style={{ color: INK_3 }}>{l.glCode}</span></td>
                      {row.map((d, i) => (
                        <td key={i} className="px-0.5 py-0.5">
                          <input
                            value={d || ''} disabled={locked}
                            data-r={`${g.key}:${ri}`} data-c={i}
                            onChange={(e) => setCell(l.id, i, Number(e.target.value.replace(/[^0-9.-]/g, '')) || 0)}
                            onFocus={() => snapshot(l.id)}
                            onBlur={() => saveRow(l.id)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); const nx = document.querySelector(`input[data-r="${g.key}:${ri + 1}"][data-c="${i}"]`); nx?.focus() } }}
                            className="w-16 text-right font-body text-[12px] tabular-nums rounded px-1 py-1" style={{ border: `1px solid ${HAIR}`, backgroundColor: locked ? PAPER_2 : 'white' }}
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1 text-right font-body text-[12px] font-bold tabular-nums" style={{ color: INK }}>{sum(row).toLocaleString('en-US')}</td>
                      {!locked && (
                        <td className="px-1 whitespace-nowrap">
                          <button onClick={() => spreadEven(l.id)} title="Spread evenly" className="font-body text-[10.5px] font-bold px-1.5" style={{ color: FERN }}>Even</button>
                          <button onClick={() => spreadLikeLastYear(l.id, l.glCode)} title="Spread like last year" className="font-body text-[10.5px] font-bold px-1.5" style={{ color: FERN }}>×LY</button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </React.Fragment>
            ))}
            <tr className="border-t" style={{ borderColor: HAIR, backgroundColor: '#EFF3EF' }}>
              <td className="sticky left-0 px-2 py-1.5 font-body text-[11.5px] font-bold" style={{ color: FOREST, backgroundColor: '#EFF3EF' }}>TOTAL</td>
              {grand.map((v, i) => <td key={i} className="px-1.5 py-1.5 text-right font-body text-[11.5px] font-bold tabular-nums" style={{ color: INK }}>{v.toLocaleString('en-US')}</td>)}
              <td className="px-2 py-1.5 text-right font-body text-[11.5px] font-bold tabular-nums" style={{ color: FOREST }}>{sum(grand).toLocaleString('en-US')}</td>
              {!locked && <td />}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-4 mt-3 font-body text-[12.5px]" style={{ color: INK }}>
        <span>Total Payroll <b>{formatMoneyCents(payrollTotal * 100)}</b></span>
        <span>Total Operating <b>{formatMoneyCents(operatingTotal * 100)}</b></span>
        <span>TOTAL <b>{formatMoneyCents((payrollTotal + operatingTotal) * 100)}</b></span>
      </div>
      {draftYear.status === 'submitted' && !isAdmin && <p className="font-body text-[12px] mt-3" style={{ color: INK_3 }}>Submitted to the CFO for approval. Once approved, the year locks and later changes go through transfers.</p>}
    </div>
  )
}

function groupLines(lines) {
  const payroll = lines.filter((l) => l.section === 'payroll')
  const groups = OPERATING_GROUP_ORDER.map((k) => ({ key: k, label: GROUP_LABELS[k], lines: lines.filter((l) => l.section === 'operating' && l.groupKey === k) })).filter((g) => g.lines.length)
  return [{ key: 'payroll', label: 'Payroll', lines: payroll }, ...groups]
}
function sumLines(lines, vals) { let t = 0; for (const l of lines) t += sum(vals[l.id] || []); return t }

const StartBtn = ({ onClick, busy, children, ghost }) => (
  <button onClick={onClick} disabled={busy} className="font-body text-[12.5px] font-bold px-4 py-2.5 rounded-xl disabled:opacity-40" style={ghost ? { border: `1px solid ${HAIR}`, color: FOREST } : { backgroundColor: FOREST, color: 'white' }}>{children}</button>
)

// ── Jonas import file (GL + 12 monthly amounts) ────────────────────────────────
function exportJonas(draft, vals, fy) {
  const head = ['GL Code', ...FY_MONTHS.map((m) => `${m}`)]
  const lines = [head.join(',')]
  for (const l of draft.lines) lines.push([l.glCode, ...(vals[l.id] || Array(12).fill(0)).map((d) => Math.round(Number(d) || 0))].join(','))
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `jonas_import_FY${fy}.csv`; a.click(); URL.revokeObjectURL(url)
}

// ── Printable business-plan sheet ──────────────────────────────────────────────
function printPlan(draft, vals, fy, payrollTotal, operatingTotal) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  const money = (n) => Number(n || 0).toLocaleString('en-US')
  const groups = groupLines(draft.lines)
  const row = (l) => { const r = vals[l.id] || Array(12).fill(0); return `<tr><td class="d">${esc(l.description)} <span class="gl">${esc(l.glCode)}</span></td>${r.map((d) => `<td class="n">${money(d)}</td>`).join('')}<td class="n b">${money(sum(r))}</td></tr>` }
  const body = groups.map((g) => `<tr class="grp"><td colspan="14">${esc(g.label)}</td></tr>${g.lines.map(row).join('')}`).join('')
  const totalsRow = (label, lines2) => { const t = Array(12).fill(0); for (const l of lines2) (vals[l.id] || []).forEach((d, i) => { t[i] += Number(d) || 0 }); return `<tr class="tot"><td>${label}</td>${t.map((d) => `<td class="n">${money(d)}</td>`).join('')}<td class="n">${money(sum(t))}</td></tr>` }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>FY${fy} Business Plan — Golf Courses & Grounds</title>
  <style>@page{size:landscape;margin:0.4in}body{font-family:Georgia,serif;color:#1A2A1F;margin:0}h1{font-size:18px;margin:0 0 2px}.sub{color:#3A6B4A;font-weight:bold;font-size:12px;margin-bottom:10px}
  table{border-collapse:collapse;width:100%;font-size:10px}td,th{border:1px solid #D9E0DB;padding:3px 5px}th{background:#EEF3EE;font-size:9px;text-transform:uppercase}
  .n{text-align:right;font-variant-numeric:tabular-nums}.d{font-weight:bold}.gl{color:#8A9A8E;font-weight:normal}.b{font-weight:bold}.grp td{background:#F4F6F4;font-weight:bold;color:#16291F}
  .tot td{background:#EFF3EF;font-weight:bold}</style></head><body>
  <h1>FY${fy} Business Plan — Golf Courses &amp; Grounds</h1><div class="sub">Fiscal year ${fy} (Nov ${fy - 1} – Oct ${fy})</div>
  <table><thead><tr><th>Line</th>${FY_MONTHS.map((m) => `<th class="n">${m}</th>`).join('')}<th class="n">Total</th></tr></thead>
  <tbody>${body}
  ${totalsRow('TOTAL PAYROLL', draft.lines.filter((l) => l.section === 'payroll'))}
  ${totalsRow('TOTAL OPERATING', draft.lines.filter((l) => l.section === 'operating'))}
  ${totalsRow('TOTAL', draft.lines)}
  </tbody></table></body></html>`
  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 400)
}
