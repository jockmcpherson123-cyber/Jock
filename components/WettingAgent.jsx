'use client'

// ── WETTING AGENT TIMING ────────────────────────────────────────────────────
// Tracks how a wetting agent wears off across indicator greens. The schedule is
// GDD-driven (base 50°F, resets to 100% on each application) and shown next to a
// plain calendar interval. Daily moisture readings — 9–12 fixed points per green
// — give an average VWC and, more importantly, a uniformity spread (%CV). Rising
// spread past the fresh baseline is the "it's wearing off" signal that confirms
// (and can pull in) the GDD projection.
//
// Everything persists inside courseInfo.wetting (no new DB table), so it deploys
// with no schema step. A dedicated table is the production upgrade.
import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Plus, Trash2, Droplet, MapPin, Crosshair, Check, X, Pencil, ChevronRight,
  Navigation, Loader2, AlertTriangle,
} from 'lucide-react'
import { uid } from '@/lib/calc'
import { localDateISO } from '@/lib/dates'
import { gddSince, projectGddReachDate } from '@/lib/weather'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#B9982F'
const RED = '#B23A2E'
const AMBER = '#B7791F'
const PAPER = '#F9F8F5'
const HAIR = '#E2E0DB'
const INK = '#1b2420'
const INK_2 = '#5B6160'
const INK_3 = '#8A8984'
const BAND = '#EEF3EE'

const WA_BASE = 50 // GDD base temperature (°F) for surfactant breakdown

const MICRO = ['High / exposed', 'Low / holds water', 'Shade / wind-protected', 'Standard']

// Common soil surfactants with editable, defensible starting points. gddLife is
// the degree-days (base 50°F) a fresh application is expected to hold; calDays is
// a plain calendar interval to show alongside it. Tune these to your course.
const DEFAULT_PRODUCTS = {
  'Revolution': { gddLife: 400, calDays: 21 },
  'Dispatch': { gddLife: 350, calDays: 21 },
  'Cascade Plus': { gddLife: 400, calDays: 28 },
  'OARS PS': { gddLife: 300, calDays: 14 },
  'Fifty90': { gddLife: 350, calDays: 21 },
}
const FALLBACK_PROD = { gddLife: 375, calDays: 21 }

// Moisture thresholds (percentage-points of CV). Anchored to each green's own
// fresh baseline, with an absolute floor so a green with a tiny baseline still
// trips sensibly. Tunable later.
const CV_FADE_OVER = 3      // CV this far above baseline → fading
const CV_REAPPLY_OVER = 6   // CV this far above baseline → moisture says reapply
const CV_FADE_ABS = 9       // …or this absolute CV → fading
const CV_REAPPLY_ABS = 12   // …or this absolute CV → reapply

// ── small math helpers ──────────────────────────────────────────────────────
const round1 = (n) => Math.round(n * 10) / 10
function stats(values) {
  const v = values.map(Number).filter((x) => Number.isFinite(x))
  if (!v.length) return { n: 0, avg: null, cv: null }
  const avg = v.reduce((s, x) => s + x, 0) / v.length
  if (v.length < 2 || avg === 0) return { n: v.length, avg: round1(avg), cv: 0 }
  const variance = v.reduce((s, x) => s + (x - avg) ** 2, 0) / v.length
  const cv = (Math.sqrt(variance) / avg) * 100
  return { n: v.length, avg: round1(avg), cv: round1(cv) }
}
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000)
}
function addDaysISO(iso, days) {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
function fmtShort(iso) {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
// Distance in feet between two lat/lng points (haversine).
function distanceFt(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null
  const R = 20925524.9 // earth radius in feet
  const toRad = (x) => (x * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(s)))
}
function bearing(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null
  const toRad = (x) => (x * Math.PI) / 180
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat))
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng))
  const deg = (Math.atan2(y, x) * 180) / Math.PI
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return dirs[Math.round(((deg + 360) % 360) / 45) % 8]
}

// ── per-green model ─────────────────────────────────────────────────────────
// Pull the timing + moisture state for one green out of the stored data.
function greenModel(green, wetting, daily) {
  const apps = (wetting.applications || [])
    .filter((a) => (a.scope === 'all' || a.scope === green.id) && a.date && a.date <= localDateISO())
    .sort((a, b) => b.date.localeCompare(a.date))
  const app = apps[0] || null
  const prod = app ? ((wetting.products || {})[app.product] || DEFAULT_PRODUCTS[app.product] || FALLBACK_PROD) : null

  const reads = (wetting.readings || [])
    .filter((r) => r.greenId === green.id)
    .sort((a, b) => a.date.localeCompare(b.date))
  const sinceApp = app ? reads.filter((r) => r.date >= app.date) : reads
  const baseline = sinceApp[0] || null            // first read after the application = "fresh"
  const current = reads[reads.length - 1] || null

  let calDays = null, calDue = null, gdd = null, gddPct = null, reapplyDate = null
  if (app && prod) {
    calDays = daysBetween(app.date, localDateISO())
    calDue = addDaysISO(app.date, prod.calDays)
    gdd = gddSince(daily || [], app.date, WA_BASE) || 0
    gddPct = prod.gddLife > 0 ? gdd / prod.gddLife : null
    const remaining = prod.gddLife - gdd
    reapplyDate = remaining <= 0 ? localDateISO() : (projectGddReachDate(remaining, daily || [], WA_BASE)?.date || null)
  }

  // moisture signal from the current reading vs the fresh baseline
  let moist = 'none'
  if (current && current.cv != null) {
    const base = baseline && baseline.cv != null ? baseline.cv : null
    const overBase = base != null ? current.cv - base : null
    const reapply = current.cv >= CV_REAPPLY_ABS || (overBase != null && overBase >= CV_REAPPLY_OVER)
    const fade = current.cv >= CV_FADE_ABS || (overBase != null && overBase >= CV_FADE_OVER)
    moist = reapply ? 'reapply' : fade ? 'fade' : 'ok'
  }

  // GDD leads, moisture confirms/pulls-in
  let status = 'none'
  if (app) {
    if (moist === 'reapply') status = 'reapply'
    else if (gddPct != null && gddPct >= 1) status = 'reapply'
    else if (moist === 'fade' || (gddPct != null && gddPct >= 0.8)) status = 'fading'
    else status = 'fresh'
  }

  return { app, prod, baseline, current, reads, calDays, calDue, gdd, gddPct, reapplyDate, moist, status }
}

const STATUS_STYLE = {
  fresh: { label: 'Fresh', color: FERN },
  fading: { label: 'Fading', color: AMBER },
  reapply: { label: 'Reapply', color: RED },
  none: { label: 'No application', color: INK_3 },
}

export default function WettingAgent({ daily = [], areas = {}, courseInfo = {}, location = {}, onSaveCourse, initialView, courseFilter }) {
  const wetting = courseInfo.wetting || {}
  const cTok = (s) => String(s || '').trim().split(/\s+/)[0].toLowerCase()
  const greens = (wetting.greens || []).filter((g) => !courseFilter || cTok(g.course) === cTok(courseFilter))
  const courses = (Array.isArray(courseInfo.courses) ? courseInfo.courses : []).filter((c) => c && c.name)
  const products = { ...DEFAULT_PRODUCTS, ...(wetting.products || {}) }

  const [view, setView] = useState(initialView || 'overview')
  const [logOpen, setLogOpen] = useState(false)

  // Persist a patch onto courseInfo.wetting.
  const save = (patch) => {
    const next = { ...wetting, ...patch }
    onSaveCourse && onSaveCourse({ wetting: next })
  }

  const models = useMemo(() => {
    const m = {}
    for (const g of greens) m[g.id] = greenModel(g, wetting, daily)
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [greens, wetting, daily])

  // Calibrate: lock a product's GDD lifespan to what it actually reached when a
  // green started fading — turns the guess into your course's real number.
  const setLifespan = (product, gdd) => {
    const cur = (wetting.products || {})[product] || products[product] || FALLBACK_PROD
    save({ products: { ...(wetting.products || {}), [product]: { ...cur, gddLife: Math.round(gdd) } } })
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div>
          <h2 className="font-display text-lg font-semibold" style={{ color: INK }}>Wetting Agent Timing</h2>
          <p className="font-body text-xs mb-3" style={{ color: INK_3 }}>
            Degree-day wear-off on your indicator greens, confirmed by moisture uniformity.
          </p>
        </div>
      </div>

      {/* sub-nav */}
      <div className="flex gap-1.5 mb-5">
        {[['overview', 'Overview'], ['read', 'Take readings'], ['setup', 'Setup']].map(([k, lab]) => (
          <button key={k} onClick={() => setView(k)} className="font-body text-sm font-bold px-4 py-2 rounded-full transition"
            style={view === k ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: INK_2, border: `1px solid ${HAIR}` }}>{lab}</button>
        ))}
      </div>

      {view === 'overview' && (
        <Overview greens={greens} models={models} courses={courses} onLog={() => setLogOpen(true)} onSetup={() => setView('setup')} onRead={() => setView('read')} onCalibrate={setLifespan} />
      )}
      {view === 'read' && (
        <TakeReadings greens={greens} models={models} products={products} location={location} onSave={save} wetting={wetting} />
      )}
      {view === 'setup' && (
        <Setup greens={greens} products={products} courses={courses} onSave={save} wetting={wetting} />
      )}

      {logOpen && (
        <LogApplication greens={greens} products={Object.keys(products)} onClose={() => setLogOpen(false)}
          onSave={(app) => { save({ applications: [...(wetting.applications || []), { id: uid(), ...app }] }); setLogOpen(false) }} />
      )}
    </div>
  )
}

// ── OVERVIEW ────────────────────────────────────────────────────────────────
function Overview({ greens, models, courses, onLog, onSetup, onRead, onCalibrate }) {
  if (!greens.length) {
    return (
      <div className="paper-card p-6 text-center" style={{ borderLeft: `3px solid ${GOLD}` }}>
        <Droplet size={22} style={{ color: GOLD }} className="mx-auto mb-2" />
        <h3 className="font-display text-base font-semibold" style={{ color: INK }}>Pick your indicator greens first</h3>
        <p className="font-body text-[13.5px] mt-1.5 max-w-md mx-auto" style={{ color: INK_2 }}>
          Choose 3–4 greens per nine — a couple exposed, a couple low, a couple shaded — and set the reading points. The app reads the rest of the nine off these.
        </p>
        <button onClick={onSetup} className="mt-4 font-body text-xs font-bold px-4 py-2.5 rounded-full text-white inline-flex items-center gap-1.5" style={{ backgroundColor: FOREST }}>
          <Plus size={14} /> Set up indicator greens
        </button>
      </div>
    )
  }

  // group greens by course for the per-course roll-up
  const byCourse = {}
  for (const g of greens) { const c = g.course || 'Course'; (byCourse[c] = byCourse[c] || []).push(g) }
  const worst = (list) => {
    const order = { reapply: 3, fading: 2, fresh: 1, none: 0 }
    return list.map((g) => models[g.id]?.status || 'none').reduce((a, b) => (order[b] > order[a] ? b : a), 'none')
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <button onClick={onLog} className="font-body text-xs font-bold px-3.5 py-2 rounded-full text-white flex items-center gap-1.5" style={{ backgroundColor: FOREST }}>
          <Plus size={13} /> Log application
        </button>
        <button onClick={onRead} className="font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5" style={{ backgroundColor: 'white', color: INK_2, border: `1px solid ${HAIR}` }}>
          <Droplet size={13} /> Take readings
        </button>
      </div>

      {/* per-course roll-up */}
      <div className="grid gap-2 mb-5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
        {Object.entries(byCourse).map(([c, list]) => {
          const st = worst(list)
          const s = STATUS_STYLE[st]
          const soonest = list.map((g) => models[g.id]?.reapplyDate).filter(Boolean).sort()[0]
          return (
            <div key={c} className="paper-card p-4" style={{ borderLeft: `3px solid ${s.color}` }}>
              <div className="font-body text-[11px] font-bold uppercase tracking-wide" style={{ color: INK_3 }}>{c}</div>
              <div className="font-display text-lg font-semibold mt-0.5" style={{ color: s.color }}>{s.label === 'Reapply' ? 'Reapply due' : s.label}</div>
              <div className="font-body text-[12px] mt-0.5" style={{ color: INK_2 }}>
                {st === 'none' ? 'No application logged' : `Projected reapply ~${fmtShort(soonest)}`}
              </div>
            </div>
          )
        })}
      </div>

      {/* per-green cards */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))' }}>
        {greens.map((g) => <GreenCard key={g.id} green={g} m={models[g.id]} onCalibrate={onCalibrate} />)}
      </div>
    </div>
  )
}

function GreenCard({ green, m, onCalibrate }) {
  const s = STATUS_STYLE[m?.status || 'none']
  const calPct = m?.prod ? Math.min(100, Math.round((m.calDays / m.prod.calDays) * 100)) : 0
  const gddPct = m?.gddPct != null ? Math.min(100, Math.round(m.gddPct * 100)) : 0
  const baseCv = m?.baseline?.cv
  const curCv = m?.current?.cv
  const cvRising = baseCv != null && curCv != null && curCv > baseCv
  const trend = (m?.reads || []).slice(-8).map((r) => r.cv).filter((x) => x != null)

  return (
    <div className="paper-card overflow-hidden" style={{ padding: 0 }}>
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${HAIR}` }}>
        <span className="font-display text-base font-semibold" style={{ color: INK }}>{green.name}</span>
        {green.micro && <span className="font-body text-[10.5px] font-semibold px-2 py-0.5 rounded-full" style={{ color: INK_2, backgroundColor: BAND, border: `1px solid ${HAIR}` }}>{green.micro}</span>}
        <span className="ml-auto font-body text-[11px] font-extrabold uppercase tracking-wide px-2.5 py-1 rounded-full text-white" style={{ backgroundColor: s.color }}>{s.label}</span>
      </div>

      {!m?.app ? (
        <div className="px-4 py-5 font-body text-[12.5px]" style={{ color: INK_3 }}>No application logged yet.</div>
      ) : (
        <>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 1, backgroundColor: HAIR }}>
            <div className="px-4 py-3" style={{ backgroundColor: PAPER }}>
              <div className="font-body text-[10px] font-bold uppercase tracking-widest" style={{ color: INK_3 }}>Calendar</div>
              <div className="font-display text-[20px] font-semibold tnum" style={{ color: INK }}>Day {m.calDays}<span className="text-[13px]" style={{ color: INK_3 }}> / {m.prod.calDays}</span></div>
              <div className="font-body text-[11.5px]" style={{ color: INK_2 }}>Due {fmtShort(m.calDue)}</div>
              <Bar pct={calPct} color={calPct >= 100 ? RED : FERN} />
            </div>
            <div className="px-4 py-3" style={{ backgroundColor: PAPER }}>
              <div className="font-body text-[10px] font-bold uppercase tracking-widest" style={{ color: INK_3 }}>GDD projection</div>
              <div className="font-display text-[20px] font-semibold tnum" style={{ color: INK }}>{m.gdd}<span className="text-[13px]" style={{ color: INK_3 }}> / {m.prod.gddLife}</span></div>
              <div className="font-body text-[11.5px]" style={{ color: gddPct >= 80 ? RED : INK_2 }}>Reapply ~{fmtShort(m.reapplyDate)}</div>
              <Bar pct={gddPct} color={gddPct >= 100 ? RED : gddPct >= 80 ? AMBER : FERN} />
            </div>
          </div>

          <div className="px-4 py-3 flex items-end gap-5 flex-wrap" style={{ borderTop: `1px solid ${HAIR}` }}>
            <div>
              <div className="font-body text-[10px] font-bold uppercase tracking-widest" style={{ color: INK_3 }}>Avg moisture</div>
              <div className="font-display text-[19px] font-semibold tnum" style={{ color: INK }}>{m.current?.avg != null ? `${m.current.avg}` : '—'}<span className="font-body text-[11px] font-semibold" style={{ color: INK_2 }}>{m.current?.avg != null ? ' %VWC' : ''}</span></div>
            </div>
            <div>
              <div className="font-body text-[10px] font-bold uppercase tracking-widest" style={{ color: INK_3 }}>Uniformity</div>
              <div className="font-display text-[19px] font-semibold tnum" style={{ color: cvRising ? AMBER : INK }}>
                {curCv != null ? `${curCv}%` : '—'}
                {baseCv != null && <span className="font-body text-[11px] font-semibold" style={{ color: INK_3 }}> CV · base {baseCv}%</span>}
              </div>
            </div>
            {trend.length > 1 && <Spark values={trend} className="ml-auto" />}
          </div>

          {/* Calibrate — when it's fading, lock the lifespan to the GDD it actually reached */}
          {onCalibrate && (m.status === 'fading' || m.status === 'reapply') && m.gdd > 0 && m.gdd !== m.prod.gddLife && (
            <button onClick={() => onCalibrate(m.app.product, m.gdd)} className="w-full px-4 py-2.5 flex items-center justify-center gap-1.5 font-body text-[12px] font-bold" style={{ borderTop: `1px solid ${HAIR}`, color: FOREST, backgroundColor: '#FBF6E6' }}>
              <Crosshair size={13} style={{ color: GOLD }} /> Set {m.app.product} lifespan to {m.gdd} GDD
            </button>
          )}
        </>
      )}
    </div>
  )
}

function Bar({ pct, color }) {
  return (
    <div style={{ height: 5, borderRadius: 5, backgroundColor: BAND, marginTop: 8, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.max(2, pct)}%`, borderRadius: 5, backgroundColor: color }} />
    </div>
  )
}

// CV trend sparkline — higher = worse (spread widening), so we don't invert.
function Spark({ values, className = '' }) {
  const w = 120, h = 34, pad = 3
  const max = Math.max(...values, 1), min = Math.min(...values, 0)
  const span = max - min || 1
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2)
    const y = h - pad - ((v - min) / span) * (h - pad * 2)
    return `${round1(x)},${round1(y)}`
  }).join(' ')
  const last = values[values.length - 1]
  const lx = w - pad, ly = h - pad - ((last - min) / span) * (h - pad * 2)
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={AMBER} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="3" fill={AMBER} />
    </svg>
  )
}

// ── LOG APPLICATION ─────────────────────────────────────────────────────────
function LogApplication({ greens, products, onClose, onSave }) {
  const [product, setProduct] = useState(products[0] || 'Revolution')
  const [scope, setScope] = useState('all')
  const [date, setDate] = useState(localDateISO())
  return (
    <Modal onClose={onClose} title="Log wetting agent application">
      <label className="block font-body text-[12px] font-semibold mb-1" style={{ color: INK_2 }}>Product</label>
      <select value={product} onChange={(e) => setProduct(e.target.value)} className="w-full rounded-lg px-3 py-2.5 text-sm font-body mb-3" style={{ border: `1px solid ${HAIR}`, backgroundColor: 'white', color: INK }}>
        {products.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <label className="block font-body text-[12px] font-semibold mb-1" style={{ color: INK_2 }}>Applied to</label>
      <select value={scope} onChange={(e) => setScope(e.target.value)} className="w-full rounded-lg px-3 py-2.5 text-sm font-body mb-3" style={{ border: `1px solid ${HAIR}`, backgroundColor: 'white', color: INK }}>
        <option value="all">All greens</option>
        {greens.map((g) => <option key={g.id} value={g.id}>{g.name} only</option>)}
      </select>
      <label className="block font-body text-[12px] font-semibold mb-1" style={{ color: INK_2 }}>Date applied</label>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg px-3 py-2.5 text-sm font-body mb-4" style={{ border: `1px solid ${HAIR}`, backgroundColor: 'white', color: INK }} />
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body" style={{ border: `1px solid ${HAIR}`, color: INK_2 }}>Cancel</button>
        <button onClick={() => date && product && onSave({ product, scope, date })} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body text-white" style={{ backgroundColor: FOREST }}>Save — resets the clock</button>
      </div>
    </Modal>
  )
}

// ── TAKE READINGS ───────────────────────────────────────────────────────────
function TakeReadings({ greens, models, location, onSave, wetting }) {
  const [greenId, setGreenId] = useState(greens[0]?.id || null)
  const green = greens.find((g) => g.id === greenId) || null

  if (!greens.length) return <div className="paper-card p-5 font-body text-sm" style={{ color: INK_2 }}>Add indicator greens in <b>Setup</b> first.</div>

  return (
    <div>
      <div className="flex gap-1.5 flex-wrap mb-4">
        {greens.map((g) => (
          <button key={g.id} onClick={() => setGreenId(g.id)} className="font-body text-xs font-bold px-3 py-2 rounded-full transition"
            style={g.id === greenId ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: INK_2, border: `1px solid ${HAIR}` }}>
            {g.name}
          </button>
        ))}
      </div>
      {green && <ReadingSheet key={green.id} green={green} model={models[green.id]} location={location} wetting={wetting} onSave={onSave} />}
    </div>
  )
}

function ReadingSheet({ green, model, location, wetting, onSave }) {
  // Build the point rows from the green's saved points (or a default count).
  const initialPoints = green.points && green.points.length
    ? green.points
    : Array.from({ length: green.nPoints || 12 }, (_, i) => ({ id: uid(), label: `Point ${i + 1}` }))
  const [points, setPoints] = useState(initialPoints)
  const [vals, setVals] = useState(() => Object.fromEntries(initialPoints.map((p) => [p.id, ''])))
  const [pos, setPos] = useState(null)         // live GPS position
  const [geoErr, setGeoErr] = useState(null)
  const [saved, setSaved] = useState(false)
  const watchRef = useRef(null)

  // Live GPS for walk-to-spot + point capture (works on iPhone/iPad over HTTPS).
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setGeoErr('no-geo'); return }
    watchRef.current = navigator.geolocation.watchPosition(
      (p) => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); setGeoErr(null) },
      () => setGeoErr('denied'),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    )
    return () => { if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current) }
  }, [])

  const setVal = (id, v) => setVals((prev) => ({ ...prev, [id]: v }))
  const capture = (id) => {
    if (!pos) return
    setPoints((prev) => prev.map((p) => (p.id === id ? { ...p, lat: pos.lat, lng: pos.lng } : p)))
  }
  // next un-entered point that has coordinates → the one to walk to
  const nextPoint = points.find((p) => p.lat != null && (vals[p.id] === '' || vals[p.id] == null))
  const nextDist = nextPoint && pos ? distanceFt(pos, nextPoint) : null

  const s = stats(points.map((p) => vals[p.id]))
  const entered = points.filter((p) => vals[p.id] !== '' && vals[p.id] != null).length

  const commit = () => {
    if (!s.n) return
    // persist any newly-captured coordinates back onto the green
    const greens = (wetting.greens || []).map((g) => (g.id === green.id ? { ...g, points } : g))
    const reading = { id: uid(), greenId: green.id, date: localDateISO(), values: points.map((p) => Number(vals[p.id])).filter(Number.isFinite), avg: s.avg, cv: s.cv }
    onSave({ greens, readings: [...(wetting.readings || []), reading] })
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    setVals(Object.fromEntries(points.map((p) => [p.id, ''])))
  }

  return (
    <div className="paper-card p-4">
      {/* GPS guidance strip */}
      <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg" style={{ backgroundColor: BAND }}>
        {geoErr ? (
          <span className="font-body text-[12px]" style={{ color: INK_2 }}>
            <MapPin size={13} className="inline -mt-0.5 mr-1" style={{ color: INK_3 }} />
            {geoErr === 'denied' ? 'Location off — you can still type readings. Turn on location to walk to the fixed points.' : 'This device has no GPS — type readings by hand.'}
          </span>
        ) : nextPoint ? (
          <span className="font-body text-[12px] font-semibold flex items-center gap-1.5" style={{ color: FOREST }}>
            <Navigation size={13} style={{ color: GOLD }} />
            Go to <b>{nextPoint.label}</b>{nextDist != null && <> — {nextDist} ft {bearing(pos, nextPoint) || ''}</>}
          </span>
        ) : (
          <span className="font-body text-[12px]" style={{ color: INK_2 }}>
            <Crosshair size={13} className="inline -mt-0.5 mr-1" style={{ color: FERN }} />
            {points.some((p) => p.lat != null) ? 'All points entered.' : 'Stand on each spot and tap “Set” to save it, then it will guide you next time.'}
          </span>
        )}
        <span className="ml-auto font-body text-[11px] tnum" style={{ color: INK_3 }}>{entered} / {points.length} logged</span>
      </div>

      {/* point rows */}
      <div className="space-y-1.5">
        {points.map((p) => {
          const dist = p.lat != null && pos ? distanceFt(pos, p) : null
          const isNext = nextPoint && p.id === nextPoint.id
          return (
            <div key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={isNext ? { backgroundColor: '#FBF6E6', border: `1px solid ${GOLD}` } : {}}>
              <span className="font-body text-[12.5px] font-semibold w-20 shrink-0" style={{ color: INK }}>{p.label}</span>
              <button onClick={() => capture(p.id)} disabled={!pos} className="font-body text-[10.5px] font-bold px-2 py-1 rounded-full shrink-0 disabled:opacity-40 flex items-center gap-1"
                style={p.lat != null ? { backgroundColor: FERN, color: 'white' } : { border: `1px solid ${HAIR}`, color: INK_2 }} title="Save this point at my current GPS location">
                <Crosshair size={11} /> {p.lat != null ? 'Set' : 'Set'}
              </button>
              {p.lat != null && <span className="font-body text-[10px] tnum shrink-0" style={{ color: INK_3 }}>{dist != null ? `${dist}ft` : 'GPS'}</span>}
              <input
                inputMode="decimal" value={vals[p.id] ?? ''} onChange={(e) => setVal(p.id, e.target.value)}
                placeholder="%VWC"
                className="ml-auto w-24 rounded-lg px-3 py-2 text-sm font-body tnum text-right" style={{ border: `1px solid ${HAIR}`, backgroundColor: 'white', color: INK }} />
            </div>
          )
        })}
      </div>

      {/* live summary + save */}
      <div className="flex items-center gap-4 mt-4 pt-3 flex-wrap" style={{ borderTop: `1px solid ${HAIR}` }}>
        <div><span className="font-body text-[10px] font-bold uppercase tracking-widest block" style={{ color: INK_3 }}>Avg</span><span className="font-display text-lg font-semibold tnum" style={{ color: INK }}>{s.avg != null ? `${s.avg}%` : '—'}</span></div>
        <div><span className="font-body text-[10px] font-bold uppercase tracking-widest block" style={{ color: INK_3 }}>Spread (CV)</span><span className="font-display text-lg font-semibold tnum" style={{ color: INK }}>{s.cv != null ? `${s.cv}%` : '—'}</span></div>
        <button onClick={commit} disabled={!s.n} className="ml-auto font-body text-xs font-bold px-4 py-2.5 rounded-full text-white disabled:opacity-40 flex items-center gap-1.5" style={{ backgroundColor: FOREST }}>
          {saved ? <><Check size={14} /> Saved</> : <>Save reading</>}
        </button>
      </div>
      {model?.baseline && model.current && model.current.cv != null && model.baseline.cv != null && (
        <p className="font-body text-[11.5px] mt-2" style={{ color: INK_3 }}>
          Fresh baseline was {model.baseline.avg}% VWC · {model.baseline.cv}% spread on {fmtShort(model.baseline.date)}.
        </p>
      )}
    </div>
  )
}

// ── SETUP ───────────────────────────────────────────────────────────────────
function Setup({ greens, products, courses, onSave, wetting }) {
  const [name, setName] = useState('')
  const [course, setCourse] = useState(courses[0]?.name || '')
  const [micro, setMicro] = useState(MICRO[0])
  const [nPoints, setNPoints] = useState(12)

  const addGreen = () => {
    if (!name.trim()) return
    const g = { id: uid(), name: name.trim(), course, micro, nPoints: Number(nPoints) || 12, points: [] }
    onSave({ greens: [...(wetting.greens || []), g] })
    setName('')
  }
  const delGreen = (id) => onSave({
    greens: (wetting.greens || []).filter((g) => g.id !== id),
    readings: (wetting.readings || []).filter((r) => r.greenId !== id),
  })
  const setProd = (pname, key, value) => {
    const cur = (wetting.products || {})[pname] || products[pname] || FALLBACK_PROD
    onSave({ products: { ...(wetting.products || {}), [pname]: { ...cur, [key]: Number(value) || 0 } } })
  }
  const [newProd, setNewProd] = useState('')
  const addProd = () => {
    if (!newProd.trim()) return
    onSave({ products: { ...(wetting.products || {}), [newProd.trim()]: { ...FALLBACK_PROD } } })
    setNewProd('')
  }

  return (
    <div className="space-y-6">
      {/* Indicator greens */}
      <div className="paper-card p-4">
        <h3 className="font-display text-base font-semibold mb-1" style={{ color: INK }}>Indicator greens</h3>
        <p className="font-body text-[12.5px] mb-3" style={{ color: INK_3 }}>3–4 per nine — a spread of microclimates. The rest of the nine is read off these.</p>

        <div className="space-y-1.5 mb-4">
          {(greens || []).map((g) => (
            <div key={g.id} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: PAPER, border: `1px solid ${HAIR}` }}>
              <span className="font-body text-sm font-semibold" style={{ color: INK }}>{g.name}</span>
              {g.course && <span className="font-body text-[11px]" style={{ color: INK_3 }}>· {g.course}</span>}
              <span className="font-body text-[10.5px] font-semibold px-2 py-0.5 rounded-full" style={{ color: INK_2, backgroundColor: BAND }}>{g.micro}</span>
              <span className="font-body text-[11px] tnum" style={{ color: INK_3 }}>{(g.points?.length || g.nPoints || 12)} pts</span>
              <button onClick={() => delGreen(g.id)} className="ml-auto" title="Remove"><Trash2 size={15} style={{ color: INK_3 }} /></button>
            </div>
          ))}
          {!greens.length && <p className="font-body text-[12.5px]" style={{ color: INK_3 }}>None yet.</p>}
        </div>

        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Green name (e.g. #4)" className="rounded-lg px-3 py-2.5 text-sm font-body" style={{ border: `1px solid ${HAIR}`, backgroundColor: 'white', color: INK }} />
          <select value={course} onChange={(e) => setCourse(e.target.value)} className="rounded-lg px-3 py-2.5 text-sm font-body" style={{ border: `1px solid ${HAIR}`, backgroundColor: 'white', color: INK }}>
            {courses.length ? courses.map((c) => <option key={c.name} value={c.name}>{c.name}</option>) : <option value="">Course</option>}
          </select>
          <select value={micro} onChange={(e) => setMicro(e.target.value)} className="rounded-lg px-3 py-2.5 text-sm font-body" style={{ border: `1px solid ${HAIR}`, backgroundColor: 'white', color: INK }}>
            {MICRO.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <input type="number" min="3" max="20" value={nPoints} onChange={(e) => setNPoints(e.target.value)} placeholder="Points" className="rounded-lg px-3 py-2.5 text-sm font-body tnum" style={{ border: `1px solid ${HAIR}`, backgroundColor: 'white', color: INK }} />
          <button onClick={addGreen} className="font-body text-xs font-bold px-4 py-2.5 rounded-lg text-white flex items-center justify-center gap-1.5" style={{ backgroundColor: FOREST }}><Plus size={14} /> Add</button>
        </div>
        <p className="font-body text-[11.5px] mt-2" style={{ color: INK_3 }}>Set the actual GPS spots on the green from <b>Take readings</b> — stand on each point and tap “Set”.</p>
      </div>

      {/* Products */}
      <div className="paper-card p-4">
        <h3 className="font-display text-base font-semibold mb-1" style={{ color: INK }}>Wetting agents</h3>
        <p className="font-body text-[12.5px] mb-3" style={{ color: INK_3 }}>Tune each product's degree-day lifespan (base 50°F) and its plain calendar interval. Starting values are estimates — adjust to your course.</p>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 px-1 font-body text-[10px] font-bold uppercase tracking-wide" style={{ color: INK_3 }}>
            <span className="flex-1">Product</span><span className="w-28 text-right">GDD life</span><span className="w-28 text-right">Cal. days</span>
          </div>
          {Object.keys(products).map((p) => {
            const cur = (wetting.products || {})[p] || products[p]
            return (
              <div key={p} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: PAPER, border: `1px solid ${HAIR}` }}>
                <span className="flex-1 font-body text-sm font-semibold" style={{ color: INK }}>{p}</span>
                <input type="number" defaultValue={cur.gddLife} onBlur={(e) => setProd(p, 'gddLife', e.target.value)} className="w-28 rounded-lg px-2 py-1.5 text-sm font-body tnum text-right" style={{ border: `1px solid ${HAIR}`, backgroundColor: 'white', color: INK }} />
                <input type="number" defaultValue={cur.calDays} onBlur={(e) => setProd(p, 'calDays', e.target.value)} className="w-28 rounded-lg px-2 py-1.5 text-sm font-body tnum text-right" style={{ border: `1px solid ${HAIR}`, backgroundColor: 'white', color: INK }} />
              </div>
            )
          })}
        </div>
        <div className="flex gap-2 mt-3">
          <input value={newProd} onChange={(e) => setNewProd(e.target.value)} placeholder="Add another product…" className="flex-1 rounded-lg px-3 py-2.5 text-sm font-body" style={{ border: `1px solid ${HAIR}`, backgroundColor: 'white', color: INK }} />
          <button onClick={addProd} className="font-body text-xs font-bold px-4 py-2.5 rounded-lg text-white flex items-center gap-1.5" style={{ backgroundColor: FERN }}><Plus size={14} /> Add</button>
        </div>
      </div>
    </div>
  )
}

// ── shared modal ────────────────────────────────────────────────────────────
function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 flex items-end sm:items-center justify-center p-3 sm:p-4" style={{ zIndex: 1000, backgroundColor: 'rgba(26,26,22,0.45)' }} onClick={onClose}>
      <div className="w-full sm:max-w-md rounded-2xl p-5" style={{ backgroundColor: 'white' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-base font-semibold" style={{ color: INK }}>{title}</h3>
          <button onClick={onClose} aria-label="Close"><X size={18} style={{ color: INK_3 }} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
