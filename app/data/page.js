'use client'

// Public, no-login Field Data page — the target of the crew "Field Data" QR.
// The crew records what they collect on morning rounds: moisture, clipping
// yields, greens speed and scouting. Nothing else is reachable from here. The
// club key rides in the link (?k=) and every write goes through /api/crew.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { localDateISO } from '@/lib/dates'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#C9A84C'
const HAIR = '#E2E0DB'
const INK = '#1b2420'
const INK_2 = '#5B6160'
const INK_3 = '#8A8984'
const BAND = '#EEF3EE'

// ── helpers ─────────────────────────────────────────────────────────────────
function stats(values) {
  const v = values.map(Number).filter((x) => Number.isFinite(x))
  if (!v.length) return { n: 0, avg: null, cv: null }
  const avg = v.reduce((s, x) => s + x, 0) / v.length
  if (v.length < 2 || avg === 0) return { n: v.length, avg: Math.round(avg * 10) / 10, cv: 0 }
  const variance = v.reduce((s, x) => s + (x - avg) ** 2, 0) / v.length
  return { n: v.length, avg: Math.round(avg * 10) / 10, cv: Math.round((Math.sqrt(variance) / avg) * 1000) / 10 }
}
function distanceFt(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null
  const R = 20925524.9, toRad = (x) => (x * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(s)))
}
const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))

// Course matching — a green/area belongs to a course if it starts with the
// course's first word (e.g. "Blue" → "Blue Greens", green.course "Blue Course").
const tok = (s) => String(s || '').trim().split(/\s+/)[0].toLowerCase()
const inCourse = (name, course) => !course || tok(name) === tok(course)

async function postCrew(k, payload) {
  const r = await fetch('/api/crew', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ k, ...payload }) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error || 'save_failed')
  return j
}

function FieldData() {
  const sp = useSearchParams()
  const k = sp.get('k')
  const lockedCourse = sp.get('course') || ''
  const [cfg, setCfg] = useState(null)
  const [state, setState] = useState('loading') // loading | ok | denied | error
  const [tab, setTab] = useState('moisture')
  const [course, setCourse] = useState(lockedCourse)
  const [toast, setToast] = useState(null)

  const load = useCallback(async () => {
    if (!k) { setState('denied'); return }
    try {
      const r = await fetch(`/api/crew?view=data&k=${encodeURIComponent(k)}`, { cache: 'no-store' })
      if (r.status === 401) { setState('denied'); return }
      if (!r.ok) throw new Error()
      setCfg(await r.json())
      setState('ok')
    } catch { setState('error') }
  }, [k])
  useEffect(() => { load() }, [load])

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2600) }

  if (state === 'loading') return <Center>Loading…</Center>
  if (state === 'denied') return <Center>This data link is invalid or expired.<br />Ask for a fresh QR code.</Center>
  if (state === 'error') return <Center>Couldn’t load. Try again.</Center>

  const tabs = [['moisture', 'Moisture'], ['clippings', 'Clippings'], ['speed', 'Greens Speed'], ['scouting', 'Scouting']]
  const courses = cfg.courses || []
  // Scope everything to the chosen course.
  const areas = (cfg.areas || []).filter((a) => inCourse(a, course))
  const wetting = { ...(cfg.wetting || {}), greens: (cfg.wetting?.greens || []).filter((g) => inCourse(g.course, course)) }

  return (
    <div style={{ minHeight: '100vh', background: '#EEF1EE' }}>
      <div style={{ background: FOREST }} className="text-white px-4 py-3 sticky top-0 z-10">
        {cfg.club && <p className="font-body text-[10px] tracking-[0.22em] uppercase" style={{ color: GOLD }}>{cfg.club}</p>}
        <p className="font-display text-lg font-semibold">Field Data{course ? ` — ${course}` : ''}</p>
      </div>
      <div className="max-w-xl mx-auto px-3 py-3">
        {/* Course picker — hidden when the QR already locked one in */}
        {!lockedCourse && courses.length > 1 && (
          <div className="flex gap-1.5 mb-3 overflow-x-auto no-scrollbar [&>*]:shrink-0 pb-1">
            <CourseChip on={course === ''} onClick={() => setCourse('')}>All</CourseChip>
            {courses.map((c) => <CourseChip key={c} on={course === c} onClick={() => setCourse(c)}>{c}</CourseChip>)}
          </div>
        )}
        <div className="flex gap-1.5 mb-3 overflow-x-auto no-scrollbar [&>*]:shrink-0 pb-1">
          {tabs.map(([key, lab]) => (
            <button key={key} onClick={() => setTab(key)} className="font-body text-xs font-bold px-3.5 py-2 rounded-full whitespace-nowrap"
              style={tab === key ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>{lab}</button>
          ))}
        </div>
        {tab === 'moisture' && <MoistureForm k={k} wetting={wetting} onSaved={flash} />}
        {tab === 'clippings' && <SimpleReading k={k} areas={areas} action="clipping" label="Clipping volume" unit="mL" onSaved={flash} />}
        {tab === 'speed' && <SimpleReading k={k} areas={areas} action="greenspeed" label="Stimp (ft)" onSaved={flash} />}
        {tab === 'scouting' && <ScoutForm k={k} areas={areas} onSaved={flash} />}
      </div>
      {toast && <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 text-white px-4 py-2.5 rounded-full shadow-xl text-sm font-body" style={{ backgroundColor: INK }}>{toast}</div>}
    </div>
  )
}

// ── Moisture: pick a green, walk the fixed points, enter %VWC ────────────────
function MoistureForm({ k, wetting, onSaved }) {
  const greens = wetting.greens || []
  const [greenId, setGreenId] = useState(greens[0]?.id || null)
  const green = greens.find((g) => g.id === greenId) || null

  if (!greens.length) return <Card><p className="font-body text-sm" style={{ color: INK_2 }}>No indicator greens set up yet. Ask a manager to add them.</p></Card>
  return (
    <div>
      <div className="flex gap-1.5 flex-wrap mb-3">
        {greens.map((g) => (
          <button key={g.id} onClick={() => setGreenId(g.id)} className="font-body text-xs font-bold px-3 py-2 rounded-full"
            style={g.id === greenId ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: INK_2, border: `1px solid ${HAIR}` }}>{g.name}</button>
        ))}
      </div>
      {green && <MoistureSheet key={green.id} k={k} green={green} onSaved={onSaved} />}
    </div>
  )
}

function MoistureSheet({ k, green, onSaved }) {
  const initialPoints = green.points && green.points.length
    ? green.points
    : Array.from({ length: green.nPoints || 12 }, (_, i) => ({ id: uid(), label: `Point ${i + 1}` }))
  const [points, setPoints] = useState(initialPoints)
  const [vals, setVals] = useState(() => Object.fromEntries(initialPoints.map((p) => [p.id, ''])))
  const [pos, setPos] = useState(null)
  const [geoErr, setGeoErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const watchRef = useRef(null)

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setGeoErr('no-geo'); return }
    watchRef.current = navigator.geolocation.watchPosition(
      (p) => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude }); setGeoErr(null) },
      () => setGeoErr('denied'),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    )
    return () => { if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current) }
  }, [])

  const setVal = (id, v) => setVals((prev) => ({ ...prev, [id]: v }))
  const capture = (id) => { if (pos) setPoints((prev) => prev.map((p) => (p.id === id ? { ...p, lat: pos.lat, lng: pos.lng } : p))) }
  const nextPoint = points.find((p) => p.lat != null && (vals[p.id] === '' || vals[p.id] == null))
  const s = stats(points.map((p) => vals[p.id]))

  const submit = async () => {
    if (!s.n || busy) return
    setBusy(true)
    try {
      const values = points.map((p) => Number(vals[p.id])).filter(Number.isFinite)
      await postCrew(k, { action: 'moisture', greenId: green.id, values, points })
      onSaved(`${green.name}: ${s.avg}% avg · ${s.cv}% spread saved`)
      setVals(Object.fromEntries(points.map((p) => [p.id, ''])))
    } catch (e) { onSaved(`Couldn’t save — ${e.message}`) }
    setBusy(false)
  }

  return (
    <Card>
      <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg" style={{ backgroundColor: BAND }}>
        {geoErr ? (
          <span className="font-body text-[12px]" style={{ color: INK_2 }}>{geoErr === 'denied' ? 'Location off — you can still type readings.' : 'No GPS — type readings by hand.'}</span>
        ) : nextPoint ? (
          <span className="font-body text-[12px] font-semibold" style={{ color: FOREST }}>Go to <b>{nextPoint.label}</b>{pos && distanceFt(pos, nextPoint) != null ? ` — ${distanceFt(pos, nextPoint)} ft` : ''}</span>
        ) : (
          <span className="font-body text-[12px]" style={{ color: INK_2 }}>{points.some((p) => p.lat != null) ? 'All points entered.' : 'Stand on each spot and tap “Set”.'}</span>
        )}
      </div>
      <div className="space-y-1.5">
        {points.map((p) => {
          const dist = p.lat != null && pos ? distanceFt(pos, p) : null
          const isNext = nextPoint && p.id === nextPoint.id
          return (
            <div key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={isNext ? { backgroundColor: '#FBF6E6', border: `1px solid ${GOLD}` } : {}}>
              <span className="font-body text-[12.5px] font-semibold w-20 shrink-0" style={{ color: INK }}>{p.label}</span>
              <button onClick={() => capture(p.id)} disabled={!pos} className="font-body text-[10.5px] font-bold px-2 py-1 rounded-full shrink-0 disabled:opacity-40"
                style={p.lat != null ? { backgroundColor: FERN, color: 'white' } : { border: `1px solid ${HAIR}`, color: INK_2 }}>Set</button>
              {p.lat != null && <span className="font-body text-[10px] shrink-0" style={{ color: INK_3 }}>{dist != null ? `${dist}ft` : 'GPS'}</span>}
              <input inputMode="decimal" value={vals[p.id] ?? ''} onChange={(e) => setVal(p.id, e.target.value)} placeholder="%VWC"
                className="ml-auto w-24 rounded-lg px-3 py-2 text-base text-right" style={{ border: `1px solid ${HAIR}`, background: 'white', color: INK }} />
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-4 mt-4 pt-3 flex-wrap" style={{ borderTop: `1px solid ${HAIR}` }}>
        <div><span className="font-body text-[10px] font-bold uppercase tracking-widest block" style={{ color: INK_3 }}>Avg</span><span className="font-display text-lg font-semibold" style={{ color: INK }}>{s.avg != null ? `${s.avg}%` : '—'}</span></div>
        <div><span className="font-body text-[10px] font-bold uppercase tracking-widest block" style={{ color: INK_3 }}>Spread</span><span className="font-display text-lg font-semibold" style={{ color: INK }}>{s.cv != null ? `${s.cv}%` : '—'}</span></div>
        <button onClick={submit} disabled={!s.n || busy} className="ml-auto font-body text-sm font-bold px-5 py-2.5 rounded-full text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>{busy ? 'Saving…' : 'Save reading'}</button>
      </div>
    </Card>
  )
}

// ── Clippings / Greens speed: pick a green, enter one number ─────────────────
function SimpleReading({ k, areas, action, label, unit, onSaved }) {
  const greenAreas = areas.filter((a) => /green/i.test(a))
  const list = greenAreas.length ? greenAreas : areas
  const [area, setArea] = useState(list[0] || '')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  if (!list.length) return <Card><p className="font-body text-sm" style={{ color: INK_2 }}>No areas set up yet.</p></Card>

  const submit = async () => {
    const num = Number(value)
    if (!area || !Number.isFinite(num) || busy) return
    setBusy(true)
    try {
      const row = action === 'clipping' ? { area, volume: num, unit } : { area, speed: num }
      await postCrew(k, { action, rows: [row] })
      onSaved(`${area}: ${value}${unit ? ' ' + unit : ''} saved`)
      setValue('')
    } catch (e) { onSaved(`Couldn’t save — ${e.message}`) }
    setBusy(false)
  }

  return (
    <Card>
      <label className="block font-body text-[12px] font-semibold mb-1" style={{ color: INK_2 }}>Green / area</label>
      <select value={area} onChange={(e) => setArea(e.target.value)} className="w-full rounded-lg px-3 py-2.5 text-base mb-3" style={{ border: `1px solid ${HAIR}`, background: 'white', color: INK }}>
        {list.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      <label className="block font-body text-[12px] font-semibold mb-1" style={{ color: INK_2 }}>{label}</label>
      <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={label}
        className="w-full rounded-lg px-3 py-2.5 text-base mb-4" style={{ border: `1px solid ${HAIR}`, background: 'white', color: INK }} />
      <button onClick={submit} disabled={busy} className="w-full py-3 rounded-xl text-base font-bold font-body text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>{busy ? 'Saving…' : 'Save'}</button>
    </Card>
  )
}

// ── Scouting: quick observation ──────────────────────────────────────────────
function ScoutForm({ k, areas, onSaved }) {
  const [area, setArea] = useState(areas[0] || '')
  const [kind, setKind] = useState('Disease')
  const [target, setTarget] = useState('')
  const [severity, setSeverity] = useState('Low')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (busy) return
    setBusy(true)
    try {
      await postCrew(k, { action: 'scouting', area, kind, target, severity, notes })
      onSaved('Observation saved')
      setTarget(''); setNotes('')
    } catch (e) { onSaved(`Couldn’t save — ${e.message}`) }
    setBusy(false)
  }

  const sel = (v, set, opts) => (
    <select value={v} onChange={(e) => set(e.target.value)} className="w-full rounded-lg px-3 py-2.5 text-base" style={{ border: `1px solid ${HAIR}`, background: 'white', color: INK }}>
      {opts.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )
  return (
    <Card>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div><label className="block font-body text-[12px] font-semibold mb-1" style={{ color: INK_2 }}>Area</label>{sel(area, setArea, areas.length ? areas : ['(none)'])}</div>
        <div><label className="block font-body text-[12px] font-semibold mb-1" style={{ color: INK_2 }}>Type</label>{sel(kind, setKind, ['Disease', 'Weeds', 'Insects', 'Wear', 'Other'])}</div>
      </div>
      <label className="block font-body text-[12px] font-semibold mb-1" style={{ color: INK_2 }}>What you saw</label>
      <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="e.g. dollar spot, crabgrass…" className="w-full rounded-lg px-3 py-2.5 text-base mb-3" style={{ border: `1px solid ${HAIR}`, background: 'white', color: INK }} />
      <label className="block font-body text-[12px] font-semibold mb-1" style={{ color: INK_2 }}>Severity</label>
      <div className="mb-3">{sel(severity, setSeverity, ['Low', 'Moderate', 'High'])}</div>
      <label className="block font-body text-[12px] font-semibold mb-1" style={{ color: INK_2 }}>Notes</label>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full rounded-lg px-3 py-2.5 text-base mb-4" style={{ border: `1px solid ${HAIR}`, background: 'white', color: INK }} />
      <button onClick={submit} disabled={busy} className="w-full py-3 rounded-xl text-base font-bold font-body text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>{busy ? 'Saving…' : 'Save observation'}</button>
    </Card>
  )
}

function CourseChip({ on, onClick, children }) {
  return <button onClick={onClick} className="font-body text-xs font-bold px-3.5 py-2 rounded-full whitespace-nowrap" style={on ? { backgroundColor: FERN, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>{children}</button>
}
function Card({ children }) {
  return <div className="bg-white rounded-2xl border shadow-sm p-4" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>{children}</div>
}
function Center({ children }) {
  return <div style={{ minHeight: '100vh', background: '#EEF1EE' }} className="flex items-center justify-center text-center px-6"><p className="font-body text-sm text-slate-400">{children}</p></div>
}

export default function Page() {
  return <Suspense fallback={<Center>Loading…</Center>}><FieldData /></Suspense>
}
