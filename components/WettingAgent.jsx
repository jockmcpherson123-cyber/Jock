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
      <div className="flex gap-1.5 mb-5 flex-wrap">
        {[['overview', 'Overview'], ['read', 'Take readings'], ['history', 'History'], ['setup', 'Setup']].map(([k, lab]) => (
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
      {view === 'history' && (
        <History greens={greens} wetting={wetting} onSave={save} />
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
        m?.current ? (
          <div className="px-4 py-3">
            <div className="flex items-end gap-6 flex-wrap">
              <div>
                <div className="font-body text-[10px] font-bold uppercase tracking-widest" style={{ color: INK_3 }}>Avg moisture</div>
                <div className="font-display text-[19px] font-semibold tnum" style={{ color: INK }}>{m.current.avg != null ? `${m.current.avg}` : '—'}<span className="font-body text-[11px] font-semibold" style={{ color: INK_2 }}>{m.current.avg != null ? ' %VWC' : ''}</span></div>
              </div>
              <div>
                <div className="font-body text-[10px] font-bold uppercase tracking-widest" style={{ color: INK_3 }}>Uniformity</div>
                <div className="font-display text-[19px] font-semibold tnum" style={{ color: INK }}>{m.current.cv != null ? `${m.current.cv}%` : '—'}<span className="font-body text-[11px] font-semibold" style={{ color: INK_3 }}> CV</span></div>
              </div>
            </div>
            <p className="font-body text-[11.5px] mt-1.5" style={{ color: INK_3 }}>Last reading {fmtShort(m.current.date)} · no wetting-agent application logged yet.</p>
          </div>
        ) : (
          <div className="px-4 py-5 font-body text-[12.5px]" style={{ color: INK_3 }}>No application logged yet.</div>
        )
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

// Project a cloud of lat/lng points into an SVG box (equirectangular, north-up).
function buildProjection(coordPts, W, H, pad) {
  const k = Math.cos((coordPts[0].lat * Math.PI) / 180)
  const xs = coordPts.map((p) => p.lng * k)
  const ys = coordPts.map((p) => -p.lat)
  let minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  let spanX = maxX - minX, spanY = maxY - minY
  const MIN = 1e-6
  if (spanX < MIN) { minX -= MIN; maxX += MIN; spanX = 2 * MIN }
  if (spanY < MIN) { minY -= MIN; maxY += MIN; spanY = 2 * MIN }
  const scale = Math.min((W - 2 * pad) / spanX, (H - 2 * pad) / spanY)
  const offX = (W - spanX * scale) / 2
  const offY = (H - spanY * scale) / 2
  return (p) => ({ x: offX + (p.lng * k - minX) * scale, y: offY + (-p.lat - minY) * scale })
}

// Moisture colour ramp: 0 = dry (red) · 0.5 = mid (green) · 1 = wet (blue).
function heatRGB(t) {
  const u = Math.max(0, Math.min(1, t))
  const lerp = (a, b, k) => a + (b - a) * k
  const red = [211, 63, 58], grn = [76, 175, 80], blu = [43, 108, 176]
  const [a, b, k] = u < 0.5 ? [red, grn, u / 0.5] : [grn, blu, (u - 0.5) / 0.5]
  return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]
}

// Top-down moisture map: the green's reading points on a soft heatmap of their
// %VWC (blue wet → red dry, IDW-interpolated), value markers coloured to match,
// the next point to walk to (gold ring), your live GPS dot, and a colour scale.
// Tap a point to jump to its input.
function GreenMap({ points, vals, pos, nextId, onPick, heatOn }) {
  const coordPts = points.filter((p) => p.lat != null && p.lng != null)
  const canvasRef = useRef(null)
  const W = 320, H = 210, pad = 30
  const toXY = coordPts.length ? buildProjection(coordPts, W, H, pad) : null
  const mapped = toXY ? coordPts.map((p) => ({ ...p, ...toXY(p), val: (vals[p.id] !== '' && vals[p.id] != null && Number.isFinite(Number(vals[p.id]))) ? Number(vals[p.id]) : null })) : []
  const valued = mapped.filter((m) => m.val != null)
  const lo = valued.length ? Math.min(...valued.map((m) => m.val)) : 0
  const hi = valued.length ? Math.max(...valued.map((m) => m.val)) : 1
  const span = hi - lo || 1
  const tOf = (v) => (v - lo) / span

  const xsM = mapped.map((m) => m.x), ysM = mapped.map((m) => m.y)
  const cx = mapped.length ? (Math.min(...xsM) + Math.max(...xsM)) / 2 : W / 2
  const cy = mapped.length ? (Math.min(...ysM) + Math.max(...ysM)) / 2 : H / 2
  const rx = mapped.length ? Math.min((Math.max(...xsM) - Math.min(...xsM)) / 2 + pad * 0.95, W / 2 - 2) : W / 2 - 8
  const ry = mapped.length ? Math.min((Math.max(...ysM) - Math.min(...ysM)) / 2 + pad * 0.95, H / 2 - 2) : H / 2 - 8
  const posXY = pos && toXY ? toXY(pos) : null
  const nextXY = nextId ? mapped.find((m) => m.id === nextId) : null
  const numOf = (p, i) => { const m = String(p.label || '').match(/\d+/); return m ? m[0] : String(i + 1) }

  // Paint the base green + IDW heatmap onto the canvas, clipped to the green.
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    ctx.clearRect(0, 0, W, H)
    ctx.save()
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.closePath()
    ctx.fillStyle = '#E3EEDF'; ctx.fill(); ctx.clip()
    if (heatOn && valued.length >= 3) {
      const step = 5
      for (let gy = 0; gy < H; gy += step) {
        for (let gx = 0; gx < W; gx += step) {
          let num = 0, den = 0
          for (const m of valued) { const dx = gx - m.x, dy = gy - m.y; const d2 = dx * dx + dy * dy + 4; const w = 1 / (d2 * d2); num += w * m.val; den += w }
          const [r, g, b] = heatRGB(tOf(num / den))
          ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},0.72)`
          ctx.fillRect(gx, gy, step, step)
        }
      }
    }
    ctx.restore()
  }, [heatOn, cx, cy, rx, ry, lo, hi, JSON.stringify(valued.map((m) => [m.x, m.y, m.val]))]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!coordPts.length) return null
  return (
    <div style={{ position: 'relative', maxWidth: 460, margin: '0 auto' }}>
      <canvas ref={canvasRef} width={W} height={H} style={{ width: '100%', display: 'block', borderRadius: 10, filter: 'blur(3px)' }} />
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, display: 'block' }}>
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke="#CFE0D2" strokeWidth="1.5" />
        {posXY && nextXY && <line x1={posXY.x} y1={posXY.y} x2={nextXY.x} y2={nextXY.y} stroke={GOLD} strokeWidth="1.5" strokeDasharray="4 3" />}
        {mapped.map((m, i) => {
          const isNext = m.id === nextId
          const has = m.val != null
          const [r, g, b] = has ? heatRGB(tOf(m.val)) : [255, 255, 255]
          const fill = has ? `rgb(${r | 0},${g | 0},${b | 0})` : 'white'
          const stroke = isNext ? GOLD : has ? 'white' : FOREST
          const label = has ? String(Math.round(m.val * 10) / 10) : numOf(m, i)
          return (
            <g key={m.id} onClick={() => onPick?.(m.id)} style={{ cursor: 'pointer' }}>
              <circle cx={m.x} cy={m.y} r={isNext ? 13 : 11} fill={fill} stroke={stroke} strokeWidth={isNext ? 3 : 1.5} />
              <text x={m.x} y={m.y + 3.4} textAnchor="middle" fontSize={has ? 9 : 10.5} fontWeight="700" fill={has ? 'white' : FOREST} fontFamily="Inter,system-ui,sans-serif" style={{ paintOrder: 'stroke', stroke: has ? 'rgba(0,0,0,0.25)' : 'none', strokeWidth: 0.5 }}>{label}</text>
            </g>
          )
        })}
        {posXY && (
          <>
            <circle cx={posXY.x} cy={posXY.y} r="11" fill="#2563EB" fillOpacity="0.15" />
            <circle cx={posXY.x} cy={posXY.y} r="5" fill="#2563EB" stroke="white" strokeWidth="2" />
          </>
        )}
        {/* colour scale (wet top → dry bottom) */}
        {heatOn && valued.length >= 2 && (
          <>
            <defs><linearGradient id="wa-scale" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="rgb(43,108,176)" /><stop offset="0.5" stopColor="rgb(76,175,80)" /><stop offset="1" stopColor="rgb(211,63,58)" />
            </linearGradient></defs>
            <rect x={W - 16} y="18" width="8" height={H - 46} rx="4" fill="url(#wa-scale)" />
            <text x={W - 12} y="14" textAnchor="middle" fontSize="8" fontWeight="700" fill={INK_3} fontFamily="Inter,system-ui,sans-serif">{Math.round(hi * 10) / 10}</text>
            <text x={W - 12} y={H - 22} textAnchor="middle" fontSize="8" fontWeight="700" fill={INK_3} fontFamily="Inter,system-ui,sans-serif">{Math.round(lo * 10) / 10}</text>
          </>
        )}
        <text x="10" y="15" fontSize="9" fontWeight="700" fill={INK_3} fontFamily="Inter,system-ui,sans-serif">N ↑</text>
      </svg>
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

  const inputRefs = useRef({})
  const setVal = (id, v) => setVals((prev) => ({ ...prev, [id]: v }))
  const capture = (id) => {
    if (!pos) return
    setPoints((prev) => prev.map((p) => (p.id === id ? { ...p, lat: pos.lat, lng: pos.lng } : p)))
  }
  const focusPoint = (id) => { const el = inputRefs.current[id]; if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus() } }
  // The next point to walk to = the NEAREST un-entered point (so the route stops
  // being random). Falls back to the first un-entered point without GPS.
  const unlogged = points.filter((p) => p.lat != null && (vals[p.id] === '' || vals[p.id] == null))
  const nextPoint = (() => {
    if (!unlogged.length) return null
    if (pos) { let best = null, bd = Infinity; for (const p of unlogged) { const d = distanceFt(pos, p) ?? Infinity; if (d < bd) { bd = d; best = p } } return best }
    return unlogged[0]
  })()
  const nextDist = nextPoint && pos ? distanceFt(pos, nextPoint) : null
  const mapReady = points.some((p) => p.lat != null)
  const [heatOn, setHeatOn] = useState(true)
  const valuedCount = points.filter((p) => vals[p.id] !== '' && vals[p.id] != null).length

  const s = stats(points.map((p) => vals[p.id]))
  const entered = points.filter((p) => vals[p.id] !== '' && vals[p.id] != null).length

  const commit = () => {
    if (!s.n) return
    // persist any newly-captured coordinates back onto the green
    const greens = (wetting.greens || []).map((g) => (g.id === green.id ? { ...g, points } : g))
    // Store per-point values (with coordinates) so History can redraw the map.
    const pointReads = points
      .filter((p) => vals[p.id] !== '' && vals[p.id] != null && Number.isFinite(Number(vals[p.id])))
      .map((p) => ({ label: p.label, lat: p.lat ?? null, lng: p.lng ?? null, value: Number(vals[p.id]) }))
    const reading = { id: uid(), greenId: green.id, date: localDateISO(), values: pointReads.map((pr) => pr.value), avg: s.avg, cv: s.cv, pointReads }
    onSave({ greens, readings: [...(wetting.readings || []), reading] })
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    setVals(Object.fromEntries(points.map((p) => [p.id, ''])))
  }

  return (
    <div className="paper-card p-4">
      {/* Top-down map of the green — where to walk next, at a glance */}
      {mapReady && (
        <div className="mb-3 rounded-xl p-2" style={{ backgroundColor: '#F6F8F5', border: `1px solid ${HAIR}` }}>
          <GreenMap points={points} vals={vals} pos={pos} nextId={nextPoint?.id} onPick={focusPoint} heatOn={heatOn} />
          <div className="flex items-center justify-center gap-3 mt-1.5 flex-wrap">
            <button onClick={() => setHeatOn((v) => !v)} className="font-body text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5" style={heatOn ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: INK_2, border: `1px solid ${HAIR}` }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: heatOn ? 'white' : INK_3, display: 'inline-block' }} /> {heatOn ? 'Heatmap on' : 'Show heatmap'}
            </button>
            <span className="font-body text-[10.5px]" style={{ color: INK_3 }}>
              {valuedCount >= 3 ? <><span style={{ color: '#2b6cb0', fontWeight: 700 }}>■</span> wet &nbsp; <span style={{ color: '#4CAF50', fontWeight: 700 }}>■</span> mid &nbsp; <span style={{ color: '#d33f3a', fontWeight: 700 }}>■</span> dry · tap a point to enter it</> : 'Log 3+ points to see the heatmap · tap a point to enter it'}
            </span>
          </div>
        </div>
      )}

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
                ref={(el) => { inputRefs.current[p.id] = el }}
                inputMode="decimal" value={vals[p.id] ?? ''} onChange={(e) => setVal(p.id, e.target.value)}
                placeholder="%VWC"
                className="ml-auto w-24 rounded-lg px-3 py-2 text-sm font-body tnum text-right" style={{ border: isNext ? `1px solid ${GOLD}` : `1px solid ${HAIR}`, backgroundColor: 'white', color: INK }} />
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

// ── HISTORY ─────────────────────────────────────────────────────────────────
// Every past collection, newest first, by green + date — tap one to see its
// moisture map (if points were GPS-set) and the per-point values.
function History({ greens, wetting, onSave }) {
  const nameOf = (id) => greens.find((g) => g.id === id)?.name || 'Green'
  const reads = [...(wetting.readings || [])].sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.id).localeCompare(String(a.id)))
  const [openId, setOpenId] = useState(reads[0]?.id || null)
  const [filter, setFilter] = useState('all')
  const shown = filter === 'all' ? reads : reads.filter((r) => r.greenId === filter)

  const del = (id) => onSave({ readings: (wetting.readings || []).filter((r) => r.id !== id) })

  if (!reads.length) return <div className="paper-card p-6 text-center font-body text-sm" style={{ color: INK_3 }}>No collections logged yet. Take a reading in <b>Take readings</b> and it'll show up here.</div>

  return (
    <div>
      {greens.length > 1 && (
        <div className="flex gap-1.5 mb-3 flex-wrap">
          <button onClick={() => setFilter('all')} className="font-body text-xs font-bold px-3 py-1.5 rounded-full" style={filter === 'all' ? { backgroundColor: FERN, color: 'white' } : { backgroundColor: 'white', color: INK_2, border: `1px solid ${HAIR}` }}>All greens</button>
          {greens.map((g) => (
            <button key={g.id} onClick={() => setFilter(g.id)} className="font-body text-xs font-bold px-3 py-1.5 rounded-full" style={filter === g.id ? { backgroundColor: FERN, color: 'white' } : { backgroundColor: 'white', color: INK_2, border: `1px solid ${HAIR}` }}>{g.name}</button>
          ))}
        </div>
      )}
      <div className="space-y-2">
        {shown.map((r) => {
          const open = openId === r.id
          const pr = (r.pointReads || []).filter((x) => x.lat != null && x.lng != null)
          const pts = pr.map((x, i) => ({ id: 'p' + i, label: x.label || `Point ${i + 1}`, lat: x.lat, lng: x.lng }))
          const vmap = Object.fromEntries(pr.map((x, i) => ['p' + i, x.value]))
          const list = (r.pointReads && r.pointReads.length) ? r.pointReads : (r.values || []).map((v, i) => ({ label: `Point ${i + 1}`, value: v }))
          return (
            <div key={r.id} className="paper-card overflow-hidden" style={{ padding: 0 }}>
              <button onClick={() => setOpenId(open ? null : r.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
                <Droplet size={15} style={{ color: FERN }} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-body text-sm font-semibold" style={{ color: INK }}>{nameOf(r.greenId)}</p>
                  <p className="font-body text-[11.5px]" style={{ color: INK_3 }}>{fmtShort(r.date)} · {(r.values || []).length} points</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-display text-base font-semibold tnum" style={{ color: INK }}>{r.avg != null ? `${r.avg}%` : '—'}</p>
                  <p className="font-body text-[10.5px]" style={{ color: INK_3 }}>{r.cv != null ? `${r.cv}% spread` : ''}</p>
                </div>
                <ChevronRight size={16} style={{ color: INK_3, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} className="shrink-0" />
              </button>
              {open && (
                <div className="px-4 pb-4" style={{ borderTop: `1px solid ${HAIR}` }}>
                  {pts.length >= 1 && (
                    <div className="mt-3 rounded-xl p-2" style={{ backgroundColor: '#F6F8F5', border: `1px solid ${HAIR}` }}>
                      <GreenMap points={pts} vals={vmap} pos={null} nextId={null} heatOn={true} />
                    </div>
                  )}
                  <div className="grid gap-x-4 gap-y-1 mt-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))' }}>
                    {list.map((x, i) => (
                      <div key={i} className="flex items-center justify-between font-body text-[12.5px] px-2 py-1 rounded" style={{ backgroundColor: PAPER }}>
                        <span style={{ color: INK_2 }}>{x.label}</span><span className="font-semibold tnum" style={{ color: INK }}>{x.value}%</span>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => { if (confirm('Delete this collection?')) del(r.id) }} className="mt-3 font-body text-[11.5px] font-bold flex items-center gap-1" style={{ color: RED }}><Trash2 size={13} /> Delete collection</button>
                </div>
              )}
            </div>
          )
        })}
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
