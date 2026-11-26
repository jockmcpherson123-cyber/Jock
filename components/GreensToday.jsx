'use client'

// ============================================================================
//  Course Map — Greens today (Phase D).
//
//  Per-green moisture heatmap (clipped to the green, drawn on a crop of the
//  aerial), morning/afternoon/change views, tonight's watering-depth suggestion
//  and the per-green plan, plus the readings import. All math is lib/coursemap.
//
//  No React hook is placed after an early return.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { FOREST, FERN, GOLD, HAIR, INK, INK_2, INK_3, PAPER, PAPER_2, RED, BLUE } from '@/lib/theme'
import * as cmdb from '@/lib/coursemap/db'
import { planReadingsImport, guessReadingMapping } from '@/lib/coursemap/import'
import { idwValue, moistureStops, changeStops, colorAt, changeReadings } from '@/lib/coursemap/heat'
import { suggestDepth, planByDepth } from '@/lib/coursemap/depth'
import { lonLatToPixel, lonLatTo3857, m3857ToLonLat } from '@/lib/coursemap/geo'
import { resolveTarget, withException, coverageIssues, timelineMonths, targetFields, targetAvg } from '@/lib/coursemap/targets'
import { fetchWeather, dailyFromHourly } from '@/lib/weather'
import { formatNumber, formatDate } from '@/lib/format'

const ringCentroid = (ring) => { let x = 0, y = 0; for (const [lon, lat] of ring) { x += lon; y += lat } return [x / ring.length, y / ring.length] }

const DEFAULT_TARGET = { lo: 20, hi: 30, aim: 25 } // fallback until a season is defined
const GREEN_OK = '#1E7A46'
const canApprove = (role) => role === 'superintendent' || role === 'director'
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const shiftDate = (iso, days) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const statusOf = (avg, t) => {
  if (avg == null || t == null) return { label: '—', c: INK_3 }
  const d = avg - (t.aim ?? ((t.lo + t.hi) / 2))
  if (Math.abs(d) <= 2) return { label: 'On target', c: GREEN_OK }
  return d < 0 ? { label: `${Math.abs(d).toFixed(1)} under`, c: RED } : { label: `${d.toFixed(1)} over`, c: BLUE }
}

export default function GreensToday({ ctx, courseId, manage, user, activeImagery }) {
  const [date, setDate] = useState(todayISO())
  const [greens, setGreens] = useState([])
  const [rounds, setRounds] = useState([]) // the day's rounds with readings
  const [plan, setPlan] = useState({ depths: {}, day: {} })
  const [targets, setTargets] = useState([])
  const [exceptions, setExceptions] = useState([])
  const [view, setView] = useState('morning')
  const [selId, setSelId] = useState(null)
  const [showSpots, setShowSpots] = useState(false)
  const [loading, setLoading] = useState(true)
  const [staleDate, setStaleDate] = useState(null) // set when today is blank and we fall back to the last day with readings
  const [addOpen, setAddOpen] = useState(false)
  const [aerial, setAerial] = useState(null)
  const [etDraft, setEtDraft] = useState('')
  const [autoEt, setAutoEt] = useState(null)
  const [adjTarget, setAdjTarget] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    if (!courseId) { setLoading(false); return }
    const g = await cmdb.fetchGreens(courseId)
    setGreens(g)
    const areaIds = g.map((x) => x.id)
    const start = `${date}T00:00:00`; const end = `${date}T23:59:59.999`
    let rs = await cmdb.fetchDayRounds(courseId, areaIds, new Date(start).toISOString(), new Date(end).toISOString())
    // When the chosen day has no readings, fall back to the most recent day that
    // does (shown greyed with its date), so the page is never blank — rather than
    // leave the superintendent staring at an empty heatmap first thing.
    if (rs.length === 0) {
      const latestDate = await cmdb.fetchLatestRoundDate(areaIds)
      if (latestDate && latestDate !== date) {
        const ls = `${latestDate}T00:00:00`; const le = `${latestDate}T23:59:59.999`
        const lr = await cmdb.fetchDayRounds(courseId, areaIds, new Date(ls).toISOString(), new Date(le).toISOString())
        if (lr.length) { rs = lr; setStaleDate(latestDate) } else setStaleDate(null)
      } else setStaleDate(null)
    } else setStaleDate(null)
    setRounds(rs)
    const p = await cmdb.fetchWateringPlan(courseId, date)
    setPlan(p); setEtDraft(p.day?.forecast_et != null ? String(p.day.forecast_et) : '0.10')
    const [tg, ex] = await Promise.all([cmdb.fetchTargets(courseId), cmdb.fetchExceptions()])
    setTargets(tg); setExceptions(ex)
    setView(rs.some((r) => r.slot === 'afternoon') ? 'afternoon' : 'morning')
    setSelId((cur) => cur || g[0]?.id || null)
    setLoading(false)
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [courseId, date])

  const baseTarget = resolveTarget(targets, date) || DEFAULT_TARGET
  const targetFor = (areaId) => withException(baseTarget, exceptions, areaId)

  // Load the aerial image once (for cropping under the heatmap).
  useEffect(() => {
    let live = true
    if (!activeImagery?.filePath) { setAerial(null); return }
    cmdb.signedUrl(activeImagery.filePath).then((url) => {
      if (!live || !url) return
      const img = new Image(); img.crossOrigin = 'anonymous'
      img.onload = () => { if (live) setAerial(img) }
      img.src = url
    })
    return () => { live = false }
  }, [activeImagery?.id])

  // Auto ET — tomorrow's forecast evapotranspiration (inches) for the course,
  // from the app's weather source, using a green's location.
  useEffect(() => {
    let live = true
    if (!greens.length) return
    const [lon, lat] = ringCentroid(greens[0].ring)
    ;(async () => {
      try {
        const daily = dailyFromHourly(await fetchWeather(lat, lon, { pastDays: 1, forecastDays: 3 }))
        const tmr = shiftDate(todayISO(), 1)
        const d = daily.find((x) => x.date === tmr)
        if (live && d?.et != null) setAutoEt(Math.round(Number(d.et) * 100) / 100)
      } catch (e) { console.error('auto ET', e) }
    })()
    return () => { live = false }
  }, [greens])

  // Default the ET field to the auto forecast when nothing is saved for the day.
  useEffect(() => {
    if (autoEt != null && (plan.day?.forecast_et == null)) setEtDraft(String(autoEt))
  }, [autoEt, plan.day?.forecast_et])

  const reloadTargets = async () => setTargets(await cmdb.fetchTargets(courseId))
  const saveRange = async () => {
    const t = Number(adjTarget.target)
    if (!isFinite(t)) { alert('Enter a target %.'); return }
    const f = targetFields(t)
    const full = targets.find((x) => x.id === baseTarget.id)
    try {
      await cmdb.saveTarget(full ? { ...full, clubId: ctx.club.id, courseId, ...f } : { clubId: ctx.club.id, courseId, name: 'All season', startMd: '11-01', endMd: '10-31', ...f })
      await reloadTargets(); setAdjTarget(null)
    } catch (e) { console.error(e); alert('Could not save the target.') }
  }

  // round pickers
  const roundsByGreen = useMemo(() => {
    const m = {}
    for (const r of rounds) {
      const b = (m[r.areaId] ||= { morning: null, afternoon: null, latest: null })
      if (r.slot === 'morning' && !b.morning) b.morning = r
      if (r.slot === 'afternoon' && !b.afternoon) b.afternoon = r
      if (!b.latest || new Date(r.startedAt) > new Date(b.latest.startedAt)) b.latest = r
    }
    return m
  }, [rounds])

  const roundForView = (areaId) => {
    const b = roundsByGreen[areaId]; if (!b) return null
    return view === 'afternoon' ? b.afternoon : view === 'change' ? b.afternoon : b.morning
  }
  const greenAvg = (areaId) => { const r = roundForView(areaId); return r?.avg != null ? Number(r.avg) : null }

  const setDepth = async (areaId, depth) => {
    if (plan.day?.approved_at) return
    setBusy(true)
    try { await cmdb.setWateringDepth({ clubId: ctx.club.id, courseId, areaId, date, depthIn: depth }); const p = await cmdb.fetchWateringPlan(courseId, date); setPlan(p) } catch (e) { console.error(e) }
    setBusy(false)
  }
  const saveEt = async () => {
    const et = Number(etDraft)
    if (!isFinite(et)) return
    try { await cmdb.saveForecastEt({ clubId: ctx.club.id, courseId, date, et }); setPlan((p) => ({ ...p, day: { ...p.day, forecast_et: et } })) } catch (e) { console.error(e) }
  }
  const toggleApprove = async () => {
    setBusy(true)
    try { await cmdb.approveWateringDay({ clubId: ctx.club.id, courseId, date, approve: !plan.day?.approved_at }); const p = await cmdb.fetchWateringPlan(courseId, date); setPlan(p) } catch (e) { console.error(e) }
    setBusy(false)
  }

  if (loading) return <p className="font-body text-[13px]" style={{ color: INK_2 }}>Loading…</p>
  if (greens.length === 0) {
    return (
      <div>
        {manage && <div className="flex justify-end mb-3"><button onClick={() => setAddOpen(true)} className="inline-flex items-center gap-1.5 font-body text-[12px] font-bold px-3 py-2 rounded-xl text-white" style={{ backgroundColor: FOREST }}><Upload size={14} /> Add readings</button></div>}
        {addOpen && <AddReadings ctx={ctx} courseId={courseId} greens={greens} onClose={() => setAddOpen(false)} onDone={() => { setAddOpen(false); setLoading(true); load() }} />}
        <div className="rounded-2xl border border-dashed p-8 text-center" style={{ borderColor: HAIR }}><p className="font-body text-[13px]" style={{ color: INK_2 }}>Draw your greens on the <b>Map</b> tab first.</p></div>
      </div>
    )
  }

  const sel = greens.find((g) => g.id === selId) || greens[0]
  const selTarget = targetFor(sel.id)
  const selRound = roundForView(sel.id)
  const latest = roundsByGreen[sel.id]?.latest
  const et = plan.day?.forecast_et != null ? Number(plan.day.forecast_et) : (Number(etDraft) || autoEt || 0)
  const etIsAuto = plan.day?.forecast_et == null && autoEt != null && (etDraft === '' || Number(etDraft) === autoEt)
  const ipp = ctx?.settings?.inches_per_point ?? 0.03
  const maxDepth = ctx?.settings?.max_depth ?? 0.25
  const suggested = latest?.avg != null ? suggestDepth({ et, aim: selTarget.aim, latestAvg: Number(latest.avg), inchesPerPoint: ipp, maxDepth }) : null

  // readings for the heat view
  let heatReadings = selRound?.readings || []
  let changeMissing = false
  if (view === 'change') {
    const b = roundsByGreen[sel.id]
    if (b?.morning && b?.afternoon) heatReadings = changeReadings(b.afternoon.readings, b.morning.readings)
    else { heatReadings = []; changeMissing = true }
  }
  const vals = heatReadings.map((r) => r.vwcPct).filter((v) => v != null)
  const lo = view === 'change' ? -6 : selTarget.lo
  const hi = view === 'change' ? 0 : selTarget.hi

  // tonight's plan grouping
  const greenDepths = greens.map((g) => ({ green: g.hole || greens.indexOf(g) + 1, depth: plan.depths[g.id]?.depth ?? undefined })).filter((x) => x.depth !== undefined)
  const planGroups = planByDepth(greenDepths.map((x) => ({ green: x.green, depth: x.depth })))

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button onClick={() => setDate(shiftDate(date, -1))} className="font-body text-[13px] font-bold px-2.5 py-1.5 rounded-lg" style={{ border: `1px solid ${HAIR}`, color: INK_2 }} aria-label="Previous day">‹</button>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="font-body text-[12px] px-2 py-1.5 rounded-lg" style={{ border: `1px solid ${HAIR}`, color: INK }} />
        <button onClick={() => setDate(shiftDate(date, 1))} className="font-body text-[13px] font-bold px-2.5 py-1.5 rounded-lg" style={{ border: `1px solid ${HAIR}`, color: INK_2 }} aria-label="Next day">›</button>
        {date !== todayISO() && <button onClick={() => setDate(todayISO())} className="font-body text-[12px] font-bold px-2.5 py-1.5 rounded-lg" style={{ color: FERN }}>Today</button>}
        <span className="font-body text-[11.5px] ml-1" style={{ color: INK_3 }}>target {selTarget.aim}%{selTarget.exception ? ' (green exception)' : ''}</span>
        {manage && !adjTarget && <button onClick={() => setAdjTarget({ target: baseTarget.aim })} className="font-body text-[11.5px] font-bold" style={{ color: FERN }}>Adjust target</button>}
      </div>
      {adjTarget && (
        <div className="rounded-xl border p-2.5 mb-3 flex flex-wrap items-end gap-2" style={{ borderColor: HAIR, backgroundColor: PAPER }}>
          <div><label className="font-body text-[10px] font-bold uppercase block" style={{ color: INK_3 }}>{baseTarget.name || 'Season'} target %</label>
            <input value={adjTarget.target ?? ''} onChange={(e) => setAdjTarget({ target: e.target.value })} className="w-20 font-body text-[13px] px-2 py-1.5 rounded-lg mt-0.5 text-right" style={{ border: `1px solid ${HAIR}` }} /></div>
          <button onClick={saveRange} className="font-body text-[12px] font-bold px-3 py-1.5 rounded-lg text-white" style={{ backgroundColor: FOREST }}>Save</button>
          <button onClick={() => setAdjTarget(null)} className="font-body text-[12px] font-bold px-2.5 py-1.5 rounded-lg" style={{ color: INK_2 }}>Cancel</button>
          <span className="font-body text-[10.5px] self-center" style={{ color: INK_3 }}>Sets the average for the whole {baseTarget.name || 'season'} — more on the Targets tab.</span>
        </div>
      )}
      {staleDate && (
        <div className="rounded-xl border px-3 py-2 mb-3 flex items-center gap-2" style={{ borderColor: HAIR, backgroundColor: PAPER_2 }}>
          <span className="font-body text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ color: INK_3, backgroundColor: PAPER }}>Latest</span>
          <p className="font-body text-[12px]" style={{ color: INK_2 }}>No readings {date === todayISO() ? 'today' : 'on this day'} — showing the last round from <b>{formatDate(staleDate, 'list')}</b>.</p>
        </div>
      )}
      <div className="flex items-center justify-between mb-3" style={staleDate ? { opacity: 0.6 } : undefined}>
        <div className="flex gap-1.5">
          {[['morning', 'Morning'], ['afternoon', 'Afternoon'], ['change', 'Change']].map(([k, label]) => (
            <button key={k} onClick={() => setView(k)} className="font-body text-[12px] font-bold px-3 py-1.5 rounded-full" style={view === k ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: INK_2, border: `1px solid ${HAIR}` }}>{label}</button>
          ))}
        </div>
        {manage && <button onClick={() => setAddOpen(true)} className="inline-flex items-center gap-1.5 font-body text-[12px] font-bold px-3 py-2 rounded-xl text-white" style={{ backgroundColor: FOREST }}><Upload size={14} /> Add readings</button>}
      </div>
      {addOpen && <AddReadings ctx={ctx} courseId={courseId} greens={greens} onClose={() => setAddOpen(false)} onDone={() => { setAddOpen(false); setLoading(true); load() }} />}

      {/* Green buttons */}
      <div className="flex flex-wrap gap-1.5 mb-4" style={staleDate ? { opacity: 0.85 } : undefined}>
        {greens.map((g, i) => {
          const avg = greenAvg(g.id)
          const st = statusOf(avg, targetFor(g.id))
          const on = g.id === sel.id
          return (
            <button key={g.id} onClick={() => setSelId(g.id)} className="rounded-xl px-2.5 py-1.5 text-center min-w-[52px]" style={on ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', border: `1px solid ${HAIR}` }}>
              <div className="font-body text-[12px] font-bold" style={{ color: on ? 'white' : INK }}>{g.hole || i + 1}</div>
              <div className="font-body text-[10px]" style={{ color: on ? 'rgba(255,255,255,0.85)' : st.c }}>{avg != null ? `${avg.toFixed(0)}%` : '—'}</div>
            </button>
          )
        })}
      </div>

      {/* Main card */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border p-3" style={{ borderColor: HAIR, backgroundColor: 'white' }}>
          {changeMissing ? (
            <div className="h-64 flex items-center justify-center text-center font-body text-[13px]" style={{ color: INK_3 }}>Need a morning and an afternoon round today.</div>
          ) : vals.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-center font-body text-[13px]" style={{ color: INK_3 }}>No {view} readings on this green today.</div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <p className="font-body text-[11.5px] font-bold" style={{ color: INK_2 }}>Low {Math.min(...vals).toFixed(1)}% · High {Math.max(...vals).toFixed(1)}% · {vals.length} readings</p>
                <button onClick={() => setShowSpots((v) => !v)} className="font-body text-[11px] font-bold px-2 py-1 rounded-lg" style={{ border: `1px solid ${HAIR}`, color: INK_2 }}>{showSpots ? 'Hide values' : 'Show values'}</button>
              </div>
              <GreenHeat green={sel} readings={heatReadings} mode={view === 'change' ? 'change' : 'abs'} lo={lo} hi={hi} showSpots={showSpots} aerial={aerial} georef={activeImagery} />
              <ColorBar mode={view === 'change' ? 'change' : 'abs'} lo={lo} hi={hi} target={selTarget.aim} />
            </>
          )}
        </div>

        <div className="rounded-2xl border p-4" style={{ borderColor: HAIR, backgroundColor: 'white' }}>
          <p className="font-body text-[12px]" style={{ color: INK_3 }}>Green {sel.hole || ''} {selRound ? `· ${formatDate(selRound.startedAt, 'list')}` : ''}</p>
          {view === 'change' ? (
            <>
              <p className="font-display text-3xl font-bold mt-1" style={{ color: INK }}>{vals.length ? `${(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)} pts` : '—'}</p>
              <span className="font-body text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ color: '#9A3412', backgroundColor: '#FDE8D6' }}>Dried {vals.length ? Math.abs(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '0'} points since morning</span>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mt-1">
                <p className="font-display text-3xl font-bold" style={{ color: FOREST }}>{selRound?.avg != null ? `${Number(selRound.avg).toFixed(1)}%` : '—'}</p>
                {selRound?.avg != null && <span className="font-body text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ color: statusOf(Number(selRound.avg), selTarget).c, backgroundColor: '#F1F5F1' }}>{statusOf(Number(selRound.avg), selTarget).label}</span>}
              </div>
              {selRound && <DriestSpot round={selRound} />}
            </>
          )}

          {/* Water tonight */}
          <div className="mt-4 pt-3 border-t" style={{ borderColor: HAIR }}>
            <p className="font-body text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: INK_3 }}>Water tonight</p>
            <div className="flex flex-wrap gap-1.5">
              {[['Skip', null], ['.05', 0.05], ['.10', 0.10], ['.15', 0.15], ['.20', 0.20]].map(([label, d]) => {
                const chosen = plan.depths[sel.id]?.depth
                const isChosen = (d == null && chosen === null && sel.id in plan.depths) || (d != null && chosen === d)
                const isSuggest = d === suggested
                return (
                  <button key={label} onClick={() => setDepth(sel.id, d)} disabled={busy || !!plan.day?.approved_at}
                    className="font-body text-[12px] font-bold px-3 py-1.5 rounded-lg disabled:opacity-60"
                    style={isChosen ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: INK_2, border: isSuggest ? `2px dashed ${GOLD}` : `1px solid ${HAIR}` }}>{label}</button>
                )
              })}
            </div>
            <p className="font-body text-[11px] mt-1.5" style={{ color: INK_3 }}>
              {suggested != null ? `Suggested ${suggested.toFixed(2)} in — ` : ''}uses the latest reading{latest ? ` (${formatDate(latest.startedAt, 'list')} · ${Number(latest.avg).toFixed(1)}%)` : ''}.
            </p>
            <div className="flex items-center gap-2 mt-2">
              <span className="font-body text-[11px]" style={{ color: INK_2 }}>Forecast ET</span>
              <input value={etDraft} onChange={(e) => setEtDraft(e.target.value)} onBlur={saveEt} disabled={!manage} className="w-16 font-body text-[12px] px-2 py-1 rounded-lg text-right" style={{ border: `1px solid ${HAIR}` }} />
              <span className="font-body text-[11px]" style={{ color: INK_3 }}>in {etIsAuto ? '· auto from forecast' : autoEt != null ? `· forecast ${autoEt}` : ''}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tonight's plan · all greens */}
      <div className="rounded-2xl border p-4 mt-4" style={{ borderColor: HAIR, backgroundColor: 'white' }}>
        <div className="flex items-center justify-between mb-2">
          <p className="font-body text-[11px] font-bold uppercase tracking-wide" style={{ color: INK_3 }}>Tonight's plan · all greens</p>
          {plan.day?.approved_at ? (
            <span className="font-body text-[12px] font-bold" style={{ color: GREEN_OK }}>Approved ✓ {canApprove(user?.role) && <button onClick={toggleApprove} className="ml-2 underline" style={{ color: INK_3 }}>undo</button>}</span>
          ) : canApprove(user?.role) ? (
            <button onClick={toggleApprove} disabled={busy} className="font-body text-[12px] font-bold px-3 py-1.5 rounded-lg text-white" style={{ backgroundColor: FOREST }}>Approve for Lynx</button>
          ) : null}
        </div>
        {planGroups.length === 0 ? <p className="font-body text-[12px]" style={{ color: INK_3 }}>No depths chosen yet.</p> : (
          <div className="space-y-1">
            {planGroups.map((g, i) => <p key={i} className="font-body text-[13px]" style={{ color: INK }}><b>{g.depth == null ? 'Skip' : `${g.depth.toFixed(2)} in`}</b> · greens {g.greens.join(', ')}</p>)}
          </div>
        )}
        <p className="font-body text-[10.5px] mt-2" style={{ color: INK_3 }}>Enter this in Lynx Drive — there's no automatic connection to Toro Lynx.</p>
      </div>

      {/* More */}
      {selRound && <MoreTable round={selRound} />}
    </div>
  )
}

function DriestSpot({ round }) {
  let lo = null
  for (const r of round.readings) if (r.vwcPct != null && (!lo || r.vwcPct < lo.vwcPct)) lo = r
  if (!lo) return null
  return <p className="font-body text-[12px] mt-1" style={{ color: INK_2 }}>Driest spot <b>{Number(lo.vwcPct).toFixed(1)}%</b>{lo.spot ? ` · spot ${lo.spot}` : ''}</p>
}

function MoreTable({ round }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-2xl border mt-4" style={{ borderColor: HAIR, backgroundColor: 'white' }}>
      <button onClick={() => setOpen((v) => !v)} className="w-full text-left px-4 py-2.5 font-body text-[12px] font-bold" style={{ color: FOREST }}>More · every reading on this green {open ? '▲' : '▾'}</button>
      {open && (
        <div className="overflow-x-auto px-4 pb-3">
          <table className="w-full" style={{ borderCollapse: 'collapse' }}>
            <thead><tr>{['Spot', 'Moisture', 'Soil °F', 'Salinity', 'Time'].map((h, i) => <th key={h} className={`font-body text-[10px] font-bold uppercase px-2 py-1.5 ${i === 0 ? 'text-left' : 'text-right'}`} style={{ color: INK_3 }}>{h}</th>)}</tr></thead>
            <tbody>
              {round.readings.map((r) => (
                <tr key={r.id} className="border-t" style={{ borderColor: HAIR }}>
                  <td className="px-2 py-1.5 font-body text-[12px]" style={{ color: INK }}>{r.spot || '—'}</td>
                  <td className="px-2 py-1.5 font-body text-[12px] text-right tabular-nums" style={{ color: INK }}>{Number(r.vwcPct).toFixed(1)}%</td>
                  <td className="px-2 py-1.5 font-body text-[12px] text-right tabular-nums" style={{ color: INK_2 }}>{r.soilTempF != null ? Number(r.soilTempF).toFixed(1) : '—'}</td>
                  <td className="px-2 py-1.5 font-body text-[12px] text-right tabular-nums" style={{ color: INK_2 }}>{r.salinityDsm != null ? Number(r.salinityDsm).toFixed(3) : '—'}</td>
                  <td className="px-2 py-1.5 font-body text-[12px] text-right tabular-nums" style={{ color: INK_3 }}>{r.takenAt ? formatDate(r.takenAt, 'list') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ColorBar({ mode, lo, hi, target }) {
  const stops = mode === 'change' ? changeStops() : moistureStops(lo, hi)
  const min = stops[0].v, max = stops[stops.length - 1].v
  const grad = `linear-gradient(to right, ${stops.map((s) => `${s.color} ${((s.v - min) / (max - min) * 100).toFixed(0)}%`).join(', ')})`
  return (
    <div className="mt-2">
      <div className="h-2.5 rounded-full" style={{ background: grad }} />
      <div className="flex justify-between font-body text-[10px] mt-0.5" style={{ color: INK_3 }}>
        {mode === 'change' ? <><span>Dried</span><span>No change</span></> : <><span>Dry</span><span>target {target}%</span><span>Wet</span></>}
      </div>
    </div>
  )
}

// ── The heatmap canvas ─────────────────────────────────────────────────────
function GreenHeat({ green, readings, mode, lo, hi, showSpots, aerial, georef }) {
  const canvasRef = useRef(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !green?.ring?.length) return
    const ring = green.ring
    const lons = ring.map((p) => p[0]), lats = ring.map((p) => p[1])
    const minLon = Math.min(...lons), maxLon = Math.max(...lons), minLat = Math.min(...lats), maxLat = Math.max(...lats)
    const pad = 0.08
    const padLon = (maxLon - minLon) * pad, padLat = (maxLat - minLat) * pad
    const bbox = { minLon: minLon - padLon, maxLon: maxLon + padLon, minLat: minLat - padLat, maxLat: maxLat + padLat }

    const haveGeoref = georef && georef.ulX != null
    // canvas size from the green's aspect
    const W = 540
    let aspect = (bbox.maxLat - bbox.minLat) / ((bbox.maxLon - bbox.minLon) * Math.cos((minLat + maxLat) / 2 * Math.PI / 180))
    if (!isFinite(aspect) || aspect <= 0) aspect = 0.7
    const H = Math.max(220, Math.min(560, Math.round(W * aspect)))
    canvas.width = W; canvas.height = H
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, W, H)

    // crop-pixel transform from the aerial if we have georef, else equirectangular
    let toC
    if (haveGeoref) {
      const corners = ring.concat([[bbox.minLon, bbox.minLat], [bbox.maxLon, bbox.maxLat]])
      const pix = [[bbox.minLon, bbox.maxLat], [bbox.maxLon, bbox.minLat]].map(([lo2, la2]) => lonLatToPixel(lo2, la2, georef))
      const col0 = Math.min(pix[0].col, pix[1].col), col1 = Math.max(pix[0].col, pix[1].col)
      const row0 = Math.min(pix[0].row, pix[1].row), row1 = Math.max(pix[0].row, pix[1].row)
      const cw = col1 - col0, ch = row1 - row0
      const sx = cw / W, sy = ch / H
      toC = (lon, lat) => { const p = lonLatToPixel(lon, lat, georef); return [(p.col - col0) / sx, (p.row - row0) / sy] }
      if (aerial) { try { ctx.drawImage(aerial, col0, row0, cw, ch, 0, 0, W, H) } catch { /* taint-safe */ } }
      else { ctx.fillStyle = '#1d3326'; ctx.fillRect(0, 0, W, H) }
    } else {
      toC = (lon, lat) => [(lon - bbox.minLon) / (bbox.maxLon - bbox.minLon) * W, (bbox.maxLat - lat) / (bbox.maxLat - bbox.minLat) * H]
      ctx.fillStyle = '#1d3326'; ctx.fillRect(0, 0, W, H)
    }

    // polygon path (canvas coords) for clipping + outline
    const path = new Path2D()
    ring.forEach((p, i) => { const [x, y] = toC(p[0], p[1]); if (i === 0) path.moveTo(x, y); else path.lineTo(x, y) })
    path.closePath()

    // heatmap, clipped to the green
    const stops = mode === 'change' ? changeStops() : moistureStops(lo, hi)
    ctx.save(); ctx.clip(path); ctx.globalAlpha = 0.62
    const stepLon = (bbox.maxLon - bbox.minLon) / 70, stepLat = (bbox.maxLat - bbox.minLat) / 70
    for (let la = bbox.minLat; la <= bbox.maxLat; la += stepLat) {
      for (let lo2 = bbox.minLon; lo2 <= bbox.maxLon; lo2 += stepLon) {
        const v = idwValue(lo2, la, readings)
        if (v == null) continue
        const col = colorAt(v, stops); if (!col) continue
        const [x, y] = toC(lo2, la)
        ctx.fillStyle = col
        ctx.fillRect(Math.floor(x) - 1, Math.floor(y) - 1, (W / 70) + 2, (H / 70) + 2)
      }
    }
    ctx.restore()

    // outline
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke(path)

    // reading dots
    let loR = null, hiR = null
    for (const r of readings) { if (r.vwcPct == null) continue; if (!loR || r.vwcPct < loR.vwcPct) loR = r; if (!hiR || r.vwcPct > hiR.vwcPct) hiR = r }
    for (const r of readings) {
      if (r.lat == null) continue
      const [x, y] = toC(r.lon, r.lat)
      ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 7); ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1; ctx.fill(); ctx.stroke()
      if (showSpots && r.vwcPct != null) {
        const txt = mode === 'change' ? `${r.vwcPct > 0 ? '+' : ''}${Number(r.vwcPct).toFixed(1)}` : `${Number(r.vwcPct).toFixed(1)}%`
        ctx.font = 'bold 11px sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.strokeText(txt, x + 5, y - 4)
        ctx.fillStyle = '#fff'; ctx.fillText(txt, x + 5, y - 4)
      }
    }
    // low/high pins
    const pin = (r, color, label) => {
      if (!r || r.lat == null) return
      const [x, y] = toC(r.lon, r.lat)
      ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fillStyle = color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.fill(); ctx.stroke()
      ctx.fillStyle = color; ctx.font = 'bold 10px sans-serif'; ctx.fillText(label, x + 8, y + 3)
    }
    if (mode === 'change') { pin(loR, '#9A3412', 'Most dried'); pin(hiR, '#F5A623', 'Least dried') }
    else { pin(loR, RED, 'Low'); pin(hiR, BLUE, 'High') }
  }, [green, readings, mode, lo, hi, showSpots, aerial, georef])

  return <canvas ref={canvasRef} style={{ width: '100%', height: 'auto', borderRadius: 12, display: 'block', backgroundColor: '#1d3326' }} />
}

// ── Readings import (moved here; used by Greens today) ─────────────────────────
const READING_FIELDS = [['time', 'Time', true], ['lat', 'Latitude', true], ['lon', 'Longitude', true], ['moisture', 'Moisture', true], ['temperature', 'Soil temp', false], ['salinity', 'Salinity', false], ['id', 'Spot / reading id', false]]
const Mini = ({ label, v, warn }) => (
  <div className="rounded-xl border p-2.5" style={{ borderColor: HAIR }}><p className="font-body text-[9.5px] font-bold uppercase tracking-wide" style={{ color: INK_3 }}>{label}</p><p className="font-display text-[15px] font-bold" style={{ color: warn ? '#B7791F' : FOREST }}>{v}</p></div>
)

// Manual moisture entry — the single hand-entry path for readings. Pick a green,
// type a %VWC for each test spot (temp/salinity optional), optionally capture the
// phone's GPS per spot, and it writes to the same moisture tables a DEACON import
// does — so both build the same heatmap.
function ManualReadings({ ctx, courseId, greens, onDone }) {
  const [greenId, setGreenId] = useState(greens[0]?.id || '')
  const [date, setDate] = useState(todayISO())
  const [time, setTime] = useState(() => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` })
  const [nSpots, setNSpots] = useState(12)
  const [showExtra, setShowExtra] = useState(false)
  const [spots, setSpots] = useState(() => Array.from({ length: 12 }, (_, i) => ({ label: `Spot ${i + 1}`, v: '', temp: '', sal: '', lat: null, lon: null })))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [geoMsg, setGeoMsg] = useState('')
  const [showMap, setShowMap] = useState(false)
  const [activeSpot, setActiveSpot] = useState(0) // which spot the next map tap places

  useEffect(() => {
    setSpots((prev) => {
      if (nSpots === prev.length) return prev
      const next = prev.slice(0, nSpots).map((x, i) => ({ ...x, label: `Spot ${i + 1}` }))
      for (let i = prev.length; i < nSpots; i++) next.push({ label: `Spot ${i + 1}`, v: '', temp: '', sal: '', lat: null, lon: null })
      return next
    })
    setActiveSpot((a) => Math.min(a, nSpots - 1))
  }, [nSpots])

  // Reuse the green's saved spots (label + GPS from its last round), so the crew
  // reads the same spots each day instead of re-placing them.
  useEffect(() => {
    let live = true
    ;(async () => {
      if (!greenId) return
      try {
        const saved = await cmdb.fetchLatestSpots(greenId)
        if (!live || !saved.length) return
        // Always renumber Spot 1…N in the order they were walked (taken_at),
        // ignoring whatever stray labels the last round carried (DEACON exports
        // come in jumbled like 3, 11, 8, 2, 6), so the crew walks a clean count.
        setSpots(saved.map((s, i) => ({ label: `Spot ${i + 1}`, v: '', temp: '', sal: '', lat: s.lat ?? null, lon: s.lon ?? null })))
        setNSpots(saved.length)
        setActiveSpot(0)
      } catch { /* ignore */ }
    })()
    return () => { live = false }
  }, [greenId])

  const green = greens.find((g) => g.id === greenId) || null
  const setSpot = (i, patch) => setSpots((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const captureGps = (i) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setGeoMsg('No GPS on this device — readings still save without it.'); return }
    navigator.geolocation.getCurrentPosition(
      (p) => setSpot(i, { lat: p.coords.latitude, lon: p.coords.longitude }),
      () => setGeoMsg('Location unavailable — readings still save without GPS.'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }
  // Tap-the-map placement: drop the active spot where the finger lands, then
  // auto-advance to the next spot so the crew taps around the green in order.
  const placeOnMap = (lat, lon) => {
    setSpot(activeSpot, { lat, lon })
    setActiveSpot((a) => Math.min(a + 1, spots.length - 1))
  }

  const entered = spots.filter((s) => s.v !== '' && !isNaN(Number(s.v)))
  const avg = entered.length ? Math.round((entered.reduce((a, s) => a + Number(s.v), 0) / entered.length) * 10) / 10 : null

  const save = async () => {
    if (!green || busy) return
    const takenAt = `${date}T${time || '12:00'}:00`
    const placed = entered.map((s) => ({
      areaId: green.id, vwcPct: Number(s.v), lat: s.lat, lon: s.lon,
      soilTempF: s.temp !== '' && !isNaN(Number(s.temp)) ? Number(s.temp) : null,
      salinityDsm: s.sal !== '' && !isNaN(Number(s.sal)) ? Number(s.sal) : null,
      spot: s.label, takenAt, source: 'manual',
    }))
    if (!placed.length) { setErr('Enter at least one reading.'); return }
    setBusy(true); setErr('')
    try {
      const res = await cmdb.importReadings({ clubId: ctx.club.id, courseId, placed, source: 'manual' })
      onDone(`Saved ${res.readingsInserted} reading${res.readingsInserted !== 1 ? 's' : ''} on ${green.name || 'the green'}.`)
    } catch (e) { setErr('Save failed — ' + (e.message || '')); setBusy(false) }
  }

  if (!greens.length) return <p className="font-body text-[13px] py-6 text-center" style={{ color: INK_3 }}>No greens on the course map yet. Draw your greens on the Course Map first, then enter readings here.</p>

  return (
    <div>
      {err && <div className="mb-3 rounded-xl px-3 py-2 font-body text-[12px]" style={{ backgroundColor: '#F6E5E2', color: RED }}>{err}</div>}
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <div className="flex-1 min-w-[140px]">
          <label className="block font-body text-[11px] font-semibold mb-1" style={{ color: INK_2 }}>Green</label>
          <select value={greenId} onChange={(e) => setGreenId(e.target.value)} className="w-full rounded-lg px-2.5 py-2 text-[13px] bg-white" style={{ border: `1px solid ${HAIR}`, color: INK }}>
            {greens.map((g) => <option key={g.id} value={g.id}>{g.name || `Green ${g.hole || ''}`}</option>)}
          </select>
        </div>
        <div>
          <label className="block font-body text-[11px] font-semibold mb-1" style={{ color: INK_2 }}>Date</label>
          <input type="date" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} className="rounded-lg px-2.5 py-2 text-[13px] bg-white" style={{ border: `1px solid ${HAIR}`, color: INK }} />
        </div>
        <div>
          <label className="block font-body text-[11px] font-semibold mb-1" style={{ color: INK_2 }}>Time</label>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="rounded-lg px-2.5 py-2 text-[13px] bg-white" style={{ border: `1px solid ${HAIR}`, color: INK }} />
        </div>
        <div>
          <label className="block font-body text-[11px] font-semibold mb-1" style={{ color: INK_2 }}>Spots</label>
          <div className="flex items-center gap-1">
            <button onClick={() => setNSpots((n) => Math.max(1, n - 1))} className="w-7 h-8 rounded-lg font-bold" style={{ border: `1px solid ${HAIR}`, color: INK_2 }}>−</button>
            <span className="w-7 text-center font-display font-bold tnum" style={{ color: INK }}>{nSpots}</span>
            <button onClick={() => setNSpots((n) => Math.min(24, n + 1))} className="w-7 h-8 rounded-lg font-bold" style={{ border: `1px solid ${HAIR}`, color: INK_2 }}>+</button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <p className="font-body text-[11px]" style={{ color: INK_3 }}>Type each spot's moisture %. Pin each spot with <b>GPS</b> or <b>tap the map</b> so it draws on the heatmap (optional).</p>
        <div className="flex items-center gap-3">
          {green?.ring?.length >= 3 && (
            <button type="button" onClick={() => setShowMap((v) => !v)} className="font-body text-[11px] font-semibold px-2.5 py-1.5 rounded-lg" style={showMap ? { backgroundColor: FOREST, color: 'white' } : { border: `1px solid ${HAIR}`, color: INK_2 }}>{showMap ? 'Hide map' : 'Tap the map'}</button>
          )}
          <label className="flex items-center gap-1.5 font-body text-[11px] font-semibold" style={{ color: INK_2 }}>
            <input type="checkbox" checked={showExtra} onChange={(e) => setShowExtra(e.target.checked)} /> Temp / salinity
          </label>
        </div>
      </div>
      {geoMsg && <p className="font-body text-[11px] mb-2" style={{ color: '#B7791F' }}>{geoMsg}</p>}
      {showMap && green?.ring?.length >= 3 && (
        <div className="mb-3">
          <p className="font-body text-[11px] mb-1.5" style={{ color: INK_2 }}>Tap the green to drop <b>Spot {activeSpot + 1}</b>. It moves to the next spot each tap.</p>
          <GreenTapMap green={green} spots={spots} activeSpot={activeSpot} onPlace={placeOnMap} />
          <div className="flex flex-wrap gap-1 mt-2">
            {spots.map((s, i) => (
              <button key={i} type="button" onClick={() => setActiveSpot(i)} className="font-body text-[11px] font-bold w-7 h-7 rounded-full flex items-center justify-center" style={i === activeSpot ? { backgroundColor: FOREST, color: 'white' } : s.lat != null ? { backgroundColor: FERN, color: 'white' } : { border: `1px solid ${HAIR}`, color: INK_2 }}>{i + 1}</button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1.5 max-h-[46vh] overflow-y-auto pr-1">
        {spots.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="font-body text-[13px] font-semibold w-16 shrink-0" style={{ color: INK }}>{s.label}</span>
            <input inputMode="decimal" value={s.v} onChange={(e) => setSpot(i, { v: e.target.value })} placeholder="%VWC" className="w-20 rounded-lg px-2 py-2 text-base text-right bg-white" style={{ border: `1px solid ${HAIR}`, color: INK }} />
            {showExtra && <input inputMode="decimal" value={s.temp} onChange={(e) => setSpot(i, { temp: e.target.value })} placeholder="°F" className="w-16 rounded-lg px-2 py-1.5 text-[13px] text-right bg-white" style={{ border: `1px solid ${HAIR}`, color: INK }} />}
            {showExtra && <input inputMode="decimal" value={s.sal} onChange={(e) => setSpot(i, { sal: e.target.value })} placeholder="dS/m" className="w-16 rounded-lg px-2 py-1.5 text-[13px] text-right bg-white" style={{ border: `1px solid ${HAIR}`, color: INK }} />}
            <button onClick={() => captureGps(i)} className="font-body text-[10.5px] font-bold px-2 py-1.5 rounded-full shrink-0" style={s.lat != null ? { backgroundColor: FERN, color: 'white' } : { border: `1px solid ${HAIR}`, color: INK_2 }}>{s.lat != null ? 'GPS ✓' : 'GPS'}</button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-4 mt-4 pt-3 flex-wrap sticky bottom-0 bg-white" style={{ borderTop: `1px solid ${HAIR}` }}>
        <div><span className="font-body text-[10px] font-bold uppercase tracking-widest block" style={{ color: INK_3 }}>Avg</span><span className="font-display text-lg font-semibold" style={{ color: INK }}>{avg != null ? `${avg}%` : '—'}</span></div>
        <div><span className="font-body text-[10px] font-bold uppercase tracking-widest block" style={{ color: INK_3 }}>Entered</span><span className="font-display text-lg font-semibold" style={{ color: INK }}>{entered.length}/{spots.length}</span></div>
        <button onClick={save} disabled={!entered.length || busy} className="ml-auto font-body text-sm font-bold px-5 py-3 rounded-full text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>{busy ? 'Saving…' : 'Save readings'}</button>
      </div>
    </div>
  )
}

// A plain outline of the green (no aerial) that the crew taps to drop a reading
// spot. The ring is projected to EPSG:3857 so the shape keeps its true aspect;
// a tap is inverted back to lon/lat. Placed spots draw as numbered dots.
function GreenTapMap({ green, spots, activeSpot, onPlace }) {
  const wrapRef = useRef(null)
  const W = 320
  const proj = useMemo(() => {
    const ring = green.ring.map(([lon, lat]) => lonLatTo3857(lon, lat))
    const xs = ring.map((p) => p[0]); const ys = ring.map((p) => p[1])
    const minX = Math.min(...xs); const maxX = Math.max(...xs)
    const minY = Math.min(...ys); const maxY = Math.max(...ys)
    const pad = 16
    const spanX = Math.max(maxX - minX, 1e-6); const spanY = Math.max(maxY - minY, 1e-6)
    const scale = (W - pad * 2) / spanX
    const H = Math.max(140, Math.min(360, spanY * scale + pad * 2))
    // project 3857 → svg px (y flips because 3857 north is up)
    const toPx = (x, y) => ({ x: pad + (x - minX) * scale, y: pad + (maxY - y) * scale })
    const toMerc = (px, py) => ({ x: minX + (px - pad) / scale, y: maxY - (py - pad) / scale })
    return { ring, toPx, toMerc, H, scale }
  }, [green.id])

  const pts = proj.ring.map((p) => proj.toPx(p[0], p[1]))
  const dPath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z'

  const handleTap = (e) => {
    const rect = wrapRef.current.getBoundingClientRect()
    const src = e.touches?.[0] || e.changedTouches?.[0] || e
    const px = ((src.clientX - rect.left) / rect.width) * W
    const py = ((src.clientY - rect.top) / rect.height) * proj.H
    const m = proj.toMerc(px, py)
    const [lon, lat] = m3857ToLonLat(m.x, m.y)
    onPlace(lat, lon)
  }

  return (
    <div ref={wrapRef} className="rounded-xl overflow-hidden select-none" style={{ border: `1px solid ${HAIR}`, backgroundColor: PAPER, touchAction: 'manipulation', maxWidth: W }}>
      <svg viewBox={`0 0 ${W} ${proj.H}`} width="100%" style={{ display: 'block', cursor: 'crosshair' }} onClick={handleTap}>
        <path d={dPath} fill="#E4EEE2" stroke={FOREST} strokeWidth="2" />
        {spots.map((s, i) => {
          if (s.lat == null || s.lon == null) return null
          const [mx, my] = lonLatTo3857(s.lon, s.lat)
          const p = proj.toPx(mx, my)
          const on = i === activeSpot
          return (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r={on ? 11 : 9} fill={on ? GOLD : FOREST} stroke="white" strokeWidth="2" />
              <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontSize="10" fontWeight="700" fill={on ? INK : 'white'}>{i + 1}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export function AddReadings({ ctx, courseId, greens, onClose, onDone }) {
  const [mode, setMode] = useState('manual')
  const [stage, setStage] = useState('file')
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState([])
  const [rows, setRows] = useState([])
  const [mapping, setMapping] = useState({})
  const [assign, setAssign] = useState({})
  const [keys, setKeys] = useState(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { cmdb.fetchMoistureMapping().then((m) => m && setMapping((cur) => ({ ...m, ...cur }))); cmdb.fetchReadingKeys().then(setKeys) }, [])

  async function onFile(file) {
    setError('')
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const arr = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' })
      const hr = arr.findIndex((r) => r.some((c) => String(c).trim()))
      if (hr < 0) { setError('That file looks empty.'); return }
      const hs = arr[hr].map((h) => String(h).trim())
      const objs = arr.slice(hr + 1).filter((r) => r.some((c) => String(c).trim())).map((r) => Object.fromEntries(hs.map((h, i) => [h, r[i] ?? ''])))
      setHeaders(hs); setRows(objs); setFileName(file.name)
      setMapping((m) => ({ ...guessReadingMapping(hs), ...m })); setStage('map')
    } catch (e) { setError('Could not read that file.'); console.error(e) }
  }

  const plan = useMemo(() => planReadingsImport({ rows, mapping, greens, existingKeys: keys }), [rows, mapping, greens, keys])

  async function doImport() {
    setBusy(true); setError('')
    try {
      await cmdb.saveMoistureMapping(mapping)
      const assigned = plan.unplaced.map((u, i) => ({ u, areaId: assign[i] })).filter((x) => x.areaId).map((x) => ({ ...x.u, areaId: x.areaId }))
      const placed = [...plan.placed, ...assigned]
      const res = await cmdb.importReadings({ clubId: ctx.club.id, courseId, placed })
      onDone(`Imported ${res.readingsInserted} readings in ${res.roundsInserted} round(s).`)
    } catch (e) { setError('Import failed — ' + (e.message || '')); setBusy(false) }
  }

  const colSel = (field, label, req) => (
    <label className="flex items-center justify-between gap-3 py-1.5"><span className="font-body text-[12px]" style={{ color: INK_2 }}>{label}{req ? ' *' : ''}</span>
      <select value={mapping[field] || ''} onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))} className="font-body text-[12px] px-2 py-1.5 rounded-lg bg-white" style={{ border: `1px solid ${HAIR}`, minWidth: 160 }}>
        <option value="">—</option>{headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </select></label>
  )

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center p-0 sm:p-4 sm:overflow-y-auto" style={{ backgroundColor: 'rgba(10,20,14,0.5)' }} onClick={onClose}>
      {/* Full-screen on phones (no wasted margins, big keypad), a centred card on
          wider screens. */}
      <div className="relative w-full max-w-2xl min-h-full sm:min-h-0 sm:my-8 rounded-none sm:rounded-2xl bg-white p-4 sm:p-5 shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3"><h3 className="font-display text-lg font-bold" style={{ color: FOREST }}>Add readings</h3><button onClick={onClose} className="font-body px-2 -mr-1 w-10 h-10 flex items-center justify-center" style={{ color: INK_3, fontSize: 24 }} aria-label="Close">×</button></div>
        <div className="flex gap-1.5 mb-4">
          {[['manual', 'Manual'], ['file', 'DEACON file']].map(([k, lab]) => (
            <button key={k} onClick={() => setMode(k)} className="font-body text-[12px] font-bold px-3.5 py-1.5 rounded-full transition"
              style={mode === k ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: INK_2, border: `1px solid ${HAIR}` }}>{lab}</button>
          ))}
        </div>
        {error && <div className="mb-3 rounded-xl px-3 py-2 font-body text-[12px]" style={{ backgroundColor: '#F6E5E2', color: RED }}>{error}</div>}
        {mode === 'manual' && <ManualReadings ctx={ctx} courseId={courseId} greens={greens} onDone={onDone} />}
        {mode === 'file' && stage === 'file' && (
          <label className="block rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer" style={{ borderColor: HAIR, color: FERN }}><Upload size={22} className="inline" /><p className="font-body text-[13px] font-bold mt-1">Choose a DEACON CSV or Excel file</p><input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} /></label>
        )}
        {mode === 'file' && stage === 'map' && (
          <div>
            <p className="font-body text-[12px] mb-2" style={{ color: INK_2 }}><b>{fileName}</b> · {rows.length} rows. Map the columns:</p>
            <div className="rounded-xl border p-3" style={{ borderColor: HAIR }}>{READING_FIELDS.map(([f, label, req]) => colSel(f, label, req))}</div>
            <div className="flex justify-between mt-4"><button onClick={() => setStage('file')} className="font-body text-[12px] font-bold px-3 py-2 rounded-xl" style={{ color: INK_2, border: `1px solid ${HAIR}` }}>Back</button><button onClick={() => setStage('review')} disabled={!mapping.time || !mapping.lat || !mapping.lon || !mapping.moisture} className="font-body text-[12px] font-bold px-4 py-2 rounded-xl text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>Preview →</button></div>
          </div>
        )}
        {mode === 'file' && stage === 'review' && (
          <div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3"><Mini label="Rows" v={plan.total} /><Mini label="Placed" v={plan.placedCount} /><Mini label="Unplaced" v={plan.unplacedCount} warn={plan.unplacedCount > 0} /><Mini label="Duplicates" v={plan.duplicates} /></div>
            <p className="font-body text-[12px] mb-2" style={{ color: INK_2 }}>{plan.rounds.length} round(s): {plan.rounds.map((r) => `${(greens.find((g) => g.id === r.areaId)?.name) || 'green'} ${r.slot} avg ${r.avg}%`).join(' · ') || '—'}</p>
            {plan.unplacedCount > 0 && (
              <div className="rounded-xl border p-3 mb-3 max-h-56 overflow-y-auto" style={{ borderColor: HAIR }}>
                <p className="font-body text-[11px] font-bold uppercase mb-2" style={{ color: '#B7791F' }}>Unplaced — assign or ignore</p>
                {plan.unplaced.map((u, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 py-0.5"><span className="font-body text-[12px]" style={{ color: INK }}>{u.spot ? `spot ${u.spot}` : `${u.lat?.toFixed?.(5)}, ${u.lon?.toFixed?.(5)}`} <span style={{ color: INK_3 }}>({u.reason})</span></span>
                    <select value={assign[i] || ''} onChange={(e) => setAssign((a) => ({ ...a, [i]: e.target.value }))} className="font-body text-[12px] px-2 py-1 rounded-lg bg-white" style={{ border: `1px solid ${HAIR}` }}><option value="">Ignore</option>{greens.map((g) => <option key={g.id} value={g.id}>{g.name || `Green ${g.hole || ''}`}</option>)}</select></div>
                ))}
              </div>
            )}
            <div className="flex justify-between"><button onClick={() => setStage('map')} className="font-body text-[12px] font-bold px-3 py-2 rounded-xl" style={{ color: INK_2, border: `1px solid ${HAIR}` }}>Back</button><button onClick={doImport} disabled={busy || (plan.placedCount === 0 && Object.values(assign).filter(Boolean).length === 0)} className="font-body text-[12px] font-bold px-4 py-2 rounded-xl text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>{busy ? 'Importing…' : 'Import'}</button></div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Targets page (Phase E) ──────────────────────────────────────────────────
const MONTH_LABEL = { '11': 'Nov', '12': 'Dec', '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Aug', '09': 'Sep', '10': 'Oct' }
const SEASON_COLORS = ['#2563EB', '#14B8A6', '#22C55E', '#F59E0B', '#9333EA', '#EF4444', '#0EA5E9']

export function MoistureTargets({ ctx, courseId, manage }) {
  const [targets, setTargets] = useState([])
  const [exceptions, setExceptions] = useState([])
  const [greens, setGreens] = useState([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState(null) // season being added/edited
  const [exDraft, setExDraft] = useState(null)

  const load = async () => {
    const [tg, ex, g] = await Promise.all([cmdb.fetchTargets(courseId), cmdb.fetchExceptions(), cmdb.fetchGreens(courseId)])
    setTargets(tg); setExceptions(ex); setGreens(g); setLoading(false)
  }
  useEffect(() => { if (courseId) load() /* eslint-disable-next-line */ }, [courseId])

  const colorOf = (id) => SEASON_COLORS[Math.max(0, targets.findIndex((t) => t.id === id)) % SEASON_COLORS.length]
  const issues = coverageIssues(targets)
  const months = timelineMonths(targets)

  const saveSeason = async (s) => {
    try { await cmdb.saveTarget({ ...s, ...targetFields(s.target), clubId: ctx.club.id, courseId }); setDraft(null); await load() } catch (e) { console.error(e); alert('Could not save — ' + (e.message || '')) }
  }
  const delSeason = async (id) => { if (!window.confirm('Delete this season?')) return; try { await cmdb.deleteTarget(id); await load() } catch (e) { console.error(e) } }
  const saveEx = async (e2) => { try { await cmdb.saveException({ areaId: e2.areaId, targetId: e2.targetId, reason: e2.reason, ...(e2.target !== '' && e2.target != null ? targetFields(e2.target) : {}), clubId: ctx.club.id }); setExDraft(null); await load() } catch (e) { console.error(e) } }
  const delEx = async (id) => { try { await cmdb.deleteException(id); await load() } catch (e) { console.error(e) } }

  if (loading) return <p className="font-body text-[13px]" style={{ color: INK_2 }}>Loading…</p>

  return (
    <div>
      {/* Year timeline */}
      <div className="rounded-2xl border p-4 mb-4" style={{ borderColor: HAIR, backgroundColor: 'white' }}>
        <p className="font-body text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: INK_3 }}>Year · Nov → Oct</p>
        <div className="flex rounded-lg overflow-hidden" style={{ height: 30 }}>
          {months.map((m, i) => (
            <div key={i} className="flex-1 flex items-center justify-center" style={{ backgroundColor: m.target ? colorOf(m.target.id) : '#E2E0DB' }} title={m.target ? `${m.target.name}: target ${m.target.aim}%` : 'No season'}>
              <span className="font-body text-[9px] font-bold" style={{ color: m.target ? 'white' : INK_3 }}>{MONTH_LABEL[m.month]}</span>
            </div>
          ))}
        </div>
        {issues.length > 0 && <p className="font-body text-[11.5px] mt-2" style={{ color: '#B7791F' }}>⚠ {issues.join(' ')}</p>}
      </div>

      {/* Seasons */}
      <div className="flex items-center justify-between mb-2">
        <p className="font-body text-[12px] font-bold" style={{ color: FOREST }}>Seasons</p>
        {manage && <button onClick={() => setDraft({ name: '', startMd: '', endMd: '', target: 25, salinityMax: '' })} className="font-body text-[12px] font-bold px-3 py-1.5 rounded-full text-white" style={{ backgroundColor: FOREST }}>+ Add season</button>}
      </div>
      <div className="rounded-2xl border overflow-x-auto mb-2" style={{ borderColor: HAIR, backgroundColor: 'white' }}>
        <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: 560 }}>
          <thead><tr style={{ backgroundColor: PAPER }}>{['Season', 'Start', 'End', 'Target %', 'Max salt', ''].map((h) => <th key={h} className="font-body text-[10px] font-bold uppercase px-2 py-2 text-left" style={{ color: INK_3 }}>{h}</th>)}</tr></thead>
          <tbody>
            {targets.map((t) => (
              <tr key={t.id} className="border-t" style={{ borderColor: HAIR }}>
                <td className="px-2 py-1.5 font-body text-[12px] font-semibold" style={{ color: INK }}><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5" style={{ backgroundColor: colorOf(t.id) }} />{t.name || '—'}</td>
                <td className="px-2 py-1.5 font-body text-[12px]" style={{ color: INK_2 }}>{t.startMd}</td>
                <td className="px-2 py-1.5 font-body text-[12px]" style={{ color: INK_2 }}>{t.endMd}</td>
                <td className="px-2 py-1.5 font-body text-[12px] font-bold" style={{ color: INK }}>{targetAvg(t)}%</td>
                <td className="px-2 py-1.5 font-body text-[12px]" style={{ color: INK_2 }}>{t.salinityMax ?? '—'}</td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap">{manage && <><button onClick={() => setDraft({ ...t, target: targetAvg(t) })} className="font-body text-[11px] font-bold px-2" style={{ color: FERN }}>Edit</button><button onClick={() => delSeason(t.id)} className="font-body text-[11px] font-bold px-2" style={{ color: '#B23A2E' }}>Delete</button></>}</td>
              </tr>
            ))}
            {targets.length === 0 && <tr><td colSpan={6} className="px-2 py-4 text-center font-body text-[12px]" style={{ color: INK_3 }}>No seasons yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {draft && <SeasonForm value={draft} onChange={setDraft} onSave={() => saveSeason(draft)} onCancel={() => setDraft(null)} />}

      {/* Green exceptions */}
      <div className="flex items-center justify-between mb-2 mt-5">
        <p className="font-body text-[12px] font-bold" style={{ color: FOREST }}>Green exceptions</p>
        {manage && greens.length > 0 && <button onClick={() => setExDraft({ areaId: greens[0].id, targetId: '', target: '', reason: '' })} className="font-body text-[12px] font-bold px-3 py-1.5 rounded-full" style={{ border: `1px solid ${HAIR}`, color: FOREST }}>+ Add exception</button>}
      </div>
      <div className="rounded-2xl border overflow-x-auto" style={{ borderColor: HAIR, backgroundColor: 'white' }}>
        <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: 520 }}>
          <thead><tr style={{ backgroundColor: PAPER }}>{['Green', 'Season', 'Target %', 'Reason', ''].map((h) => <th key={h} className="font-body text-[10px] font-bold uppercase px-2 py-2 text-left" style={{ color: INK_3 }}>{h}</th>)}</tr></thead>
          <tbody>
            {exceptions.map((e) => {
              const g = greens.find((x) => x.id === e.areaId)
              return (
                <tr key={e.id} className="border-t" style={{ borderColor: HAIR }}>
                  <td className="px-2 py-1.5 font-body text-[12px] font-semibold" style={{ color: INK }}>{g ? (g.name || `Green ${g.hole || ''}`) : '—'}</td>
                  <td className="px-2 py-1.5 font-body text-[12px]" style={{ color: INK_2 }}>{e.targetId ? (targets.find((t) => t.id === e.targetId)?.name || '—') : 'All'}</td>
                  <td className="px-2 py-1.5 font-body text-[12px] font-bold" style={{ color: INK }}>{targetAvg(e) ?? '—'}%</td>
                  <td className="px-2 py-1.5 font-body text-[12px]" style={{ color: INK_2 }}>{e.reason || '—'}</td>
                  <td className="px-2 py-1.5 text-right">{manage && <button onClick={() => delEx(e.id)} className="font-body text-[11px] font-bold px-2" style={{ color: '#B23A2E' }}>Delete</button>}</td>
                </tr>
              )
            })}
            {exceptions.length === 0 && <tr><td colSpan={5} className="px-2 py-4 text-center font-body text-[12px]" style={{ color: INK_3 }}>No exceptions. Greens follow the season target.</td></tr>}
          </tbody>
        </table>
      </div>
      {exDraft && <ExceptionForm value={exDraft} greens={greens} targets={targets} onChange={setExDraft} onSave={() => saveEx(exDraft)} onCancel={() => setExDraft(null)} />}
    </div>
  )
}

function SeasonForm({ value, onChange, onSave, onCancel }) {
  const set = (k, v) => onChange({ ...value, [k]: v })
  const field = (k, label, ph) => (
    <div><label className="font-body text-[10px] font-bold uppercase block" style={{ color: INK_3 }}>{label}</label>
      <input value={value[k] ?? ''} onChange={(e) => set(k, e.target.value)} placeholder={ph} className="w-full font-body text-[12px] px-2 py-1.5 rounded-lg mt-0.5" style={{ border: `1px solid ${HAIR}` }} /></div>
  )
  const valid = value.name && /^\d{2}-\d{2}$/.test(value.startMd) && /^\d{2}-\d{2}$/.test(value.endMd) && value.target !== '' && value.target != null
  return (
    <div className="rounded-2xl border p-3 mb-2" style={{ borderColor: HAIR, backgroundColor: PAPER }}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {field('name', 'Name', 'Winter')}{field('startMd', 'Start MM-DD', '11-01')}{field('endMd', 'End MM-DD', '03-31')}
        {field('target', 'Target %', '24')}{field('salinityMax', 'Max salt', 'optional')}
      </div>
      <div className="flex justify-end gap-2 mt-2"><button onClick={onCancel} className="font-body text-[12px] font-bold px-3 py-1.5 rounded-lg" style={{ color: INK_2 }}>Cancel</button><button onClick={onSave} disabled={!valid} className="font-body text-[12px] font-bold px-4 py-1.5 rounded-lg text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>Save season</button></div>
    </div>
  )
}

function ExceptionForm({ value, greens, targets, onChange, onSave, onCancel }) {
  const set = (k, v) => onChange({ ...value, [k]: v })
  return (
    <div className="rounded-2xl border p-3 mb-2" style={{ borderColor: HAIR, backgroundColor: PAPER }}>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <div><label className="font-body text-[10px] font-bold uppercase block" style={{ color: INK_3 }}>Green</label>
          <select value={value.areaId} onChange={(e) => set('areaId', e.target.value)} className="w-full font-body text-[12px] px-2 py-1.5 rounded-lg mt-0.5 bg-white" style={{ border: `1px solid ${HAIR}` }}>{greens.map((g) => <option key={g.id} value={g.id}>{g.name || `Green ${g.hole || ''}`}</option>)}</select></div>
        <div><label className="font-body text-[10px] font-bold uppercase block" style={{ color: INK_3 }}>Season</label>
          <select value={value.targetId} onChange={(e) => set('targetId', e.target.value)} className="w-full font-body text-[12px] px-2 py-1.5 rounded-lg mt-0.5 bg-white" style={{ border: `1px solid ${HAIR}` }}><option value="">All seasons</option>{targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <div><label className="font-body text-[10px] font-bold uppercase block" style={{ color: INK_3 }}>Target %</label><input value={value.target} onChange={(e) => set('target', e.target.value)} placeholder="e.g. 22" className="w-full font-body text-[12px] px-2 py-1.5 rounded-lg mt-0.5" style={{ border: `1px solid ${HAIR}` }} /></div>
        <div className="sm:col-span-2"><label className="font-body text-[10px] font-bold uppercase block" style={{ color: INK_3 }}>Reason</label><input value={value.reason} onChange={(e) => set('reason', e.target.value)} className="w-full font-body text-[12px] px-2 py-1.5 rounded-lg mt-0.5" style={{ border: `1px solid ${HAIR}` }} /></div>
      </div>
      <div className="flex justify-end gap-2 mt-2"><button onClick={onCancel} className="font-body text-[12px] font-bold px-3 py-1.5 rounded-lg" style={{ color: INK_2 }}>Cancel</button><button onClick={onSave} className="font-body text-[12px] font-bold px-4 py-1.5 rounded-lg text-white" style={{ backgroundColor: FOREST }}>Save</button></div>
    </div>
  )
}
