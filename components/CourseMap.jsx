'use client'

// ── Course Map ───────────────────────────────────────────────────────────────
// A satellite map of the course with the irrigation as-built laid over it, your
// live GPS location, and a field-calibration flow: walk to known heads, tap the
// head on the drawing, stand your phone on it and capture GPS. A handful of
// those pairs pins the whole drawing onto the ground (see lib/geocalib.js).
//
// Leaflet is loaded in the browser only (it needs `window`). The overlay image
// is served behind the login via /api/course-overlay.

import { useEffect, useMemo, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import { MapPin, Crosshair, Navigation, Layers, Check, X, Trash2, Loader2, Target as TargetIcon, Plus } from 'lucide-react'
import * as db from '@/lib/db'
import { fitSimilarity, fitResiduals, imageCornerLatLngs, metresToFeet } from '@/lib/geocalib'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#C9A84C'

// The overlay image's pixel size (from the rasterised PDF) and where to fetch it.
const IMAGE_W = 3345
const IMAGE_H = 4698
const OVERLAY_URL = '/api/course-overlay'
// Fallback map centre if the club location isn't set — Congressional CC.
const FALLBACK = { lat: 38.9803, lng: -77.1636 }
const SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const SAT_ATTR = 'Imagery © Esri, Maxar, Earthstar Geographics'

// Average GPS for a few seconds so a single noisy reading doesn't set a point.
// Weights each fix by 1/accuracy² and reports the count + spread.
function captureAveragedGps({ seconds = 6, onTick } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('No GPS on this device'))
    const fixes = []
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords
        fixes.push({ lat: latitude, lng: longitude, acc: accuracy || 20 })
        onTick?.(fixes.length, accuracy)
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    )
    setTimeout(() => {
      navigator.geolocation.clearWatch(id)
      if (fixes.length === 0) return reject(new Error('Could not get a GPS fix — try again in the open'))
      let sw = 0, slat = 0, slng = 0
      fixes.forEach((f) => { const w = 1 / (f.acc * f.acc || 1); sw += w; slat += f.lat * w; slng += f.lng * w })
      const lat = slat / sw, lng = slng / sw
      const acc = fixes.reduce((a, f) => a + f.acc, 0) / fixes.length
      resolve({ lat, lng, acc: Math.round(acc), n: fixes.length })
    }, seconds * 1000)
  })
}

export default function CourseMap({ user, manage }) {
  const [ready, setReady] = useState(false)     // leaflet loaded
  const [loading, setLoading] = useState(true)  // settings loaded
  const [courseInfo, setCourseInfo] = useState({})
  const [location, setLocation] = useState(null)
  const [points, setPoints] = useState([])      // GCP pairs
  const [opacity, setOpacity] = useState(0.7)
  const [mode, setMode] = useState('map')        // 'map' | 'calibrate'
  const [gps, setGps] = useState(null)           // live location
  const [pending, setPending] = useState(null)   // {px,py} tapped on drawing
  const [capturing, setCapturing] = useState(null) // {n, acc} while averaging
  const [msg, setMsg] = useState(null)
  const [saving, setSaving] = useState(false)

  const LRef = useRef(null)
  const mainRef = useRef(null), mainMap = useRef(null), overlayRef = useRef(null), locRef = useRef(null), accRef = useRef(null)
  const drawRef = useRef(null), drawMap = useRef(null), drawPinRef = useRef(null), drawGcpRef = useRef(null)

  // Fitted transform + how good the fit is — recomputed whenever points change.
  const transform = useMemo(() => fitSimilarity(points, IMAGE_H), [points])
  const fit = useMemo(() => fitResiduals(points, transform, IMAGE_H), [points, transform])

  // ── Load Leaflet (browser only) + the rotated-overlay plugin ────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const mod = await import('leaflet')
      const L = mod.default || mod
      window.L = L // the rotated plugin augments the global L
      await import('leaflet-imageoverlay-rotated')
      if (!cancelled) { LRef.current = L; setReady(true) }
    })()
    return () => { cancelled = true }
  }, [])

  // ── Load saved settings + any existing calibration ──────────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const s = await db.fetchSettings()
        if (cancelled) return
        setCourseInfo(s.courseInfo || {})
        setLocation(s.location || null)
        const cal = s.courseInfo?.mapCalibration
        if (cal?.points?.length) setPoints(cal.points)
      } catch (e) { console.error(e) } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [])

  // ── One live-location watch for the whole screen ────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      (pos) => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy || null }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  const center = location?.lat != null ? [location.lat, location.lng] : [FALLBACK.lat, FALLBACK.lng]

  // ── Main satellite map (created once per entry into map mode) ───────────────
  const [mapTick, setMapTick] = useState(0)
  useEffect(() => {
    if (!ready || mode !== 'map' || !mainRef.current) return
    const L = LRef.current
    const map = L.map(mainRef.current, { center, zoom: 17, zoomControl: true, attributionControl: true })
    map.attributionControl.setPrefix('')
    L.tileLayer(SAT_URL, { maxZoom: 22, maxNativeZoom: 19, attribution: SAT_ATTR }).addTo(map)
    mainMap.current = map
    setTimeout(() => map.invalidateSize(), 100)
    setMapTick((t) => t + 1) // signal the overlay/location effects that the map exists
    return () => { map.remove(); mainMap.current = null; overlayRef.current = null; locRef.current = null; accRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, mode])

  // Overlay layer — added/updated whenever the calibration is available (also
  // re-runs once the saved calibration loads after the map is built).
  useEffect(() => {
    const L = LRef.current, map = mainMap.current
    if (!L || !map || mode !== 'map') return
    if (overlayRef.current) { overlayRef.current.remove(); overlayRef.current = null }
    if (!transform) return
    const c = imageCornerLatLngs(transform, IMAGE_W, IMAGE_H)
    const ov = L.imageOverlay.rotated(OVERLAY_URL, c.topLeft, c.topRight, c.bottomLeft, { opacity, interactive: false })
    ov.addTo(map)
    overlayRef.current = ov
    const bottomRight = [c.topRight[0] + (c.bottomLeft[0] - c.topLeft[0]), c.topRight[1] + (c.bottomLeft[1] - c.topLeft[1])]
    map.fitBounds([c.topLeft, c.topRight, c.bottomLeft, bottomRight], { padding: [20, 20] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transform, mode, mapTick])

  // Keep overlay opacity live
  useEffect(() => { if (overlayRef.current) overlayRef.current.setOpacity(opacity) }, [opacity])

  // Live location marker on the main map
  useEffect(() => {
    const L = LRef.current, map = mainMap.current
    if (!L || !map || !gps) return
    const ll = [gps.lat, gps.lng]
    if (!locRef.current) {
      accRef.current = L.circle(ll, { radius: gps.acc || 8, color: '#2563EB', weight: 1, fillColor: '#2563EB', fillOpacity: 0.12 }).addTo(map)
      locRef.current = L.circleMarker(ll, { radius: 7, color: '#fff', weight: 2, fillColor: '#2563EB', fillOpacity: 1 }).addTo(map)
    } else {
      locRef.current.setLatLng(ll); accRef.current.setLatLng(ll).setRadius(gps.acc || 8)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gps, mode, mapTick])

  // ── Calibration drawing pane (image in its own pixel space) ─────────────────
  useEffect(() => {
    if (!ready || mode !== 'calibrate' || !drawRef.current) return
    const L = LRef.current
    const bounds = [[0, 0], [IMAGE_H, IMAGE_W]]
    const map = L.map(drawRef.current, { crs: L.CRS.Simple, minZoom: -5, maxZoom: 4, zoomControl: true, attributionControl: false })
    L.imageOverlay(OVERLAY_URL, bounds).addTo(map)
    map.fitBounds(bounds)
    map.on('click', (e) => {
      const px = e.latlng.lng, py = IMAGE_H - e.latlng.lat
      if (px < 0 || py < 0 || px > IMAGE_W || py > IMAGE_H) return
      setPending({ px, py })
    })
    drawMap.current = map
    setTimeout(() => map.invalidateSize(), 100)
    return () => { map.remove(); drawMap.current = null; drawPinRef.current = null; drawGcpRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, mode])

  // Draw existing GCP markers + the pending pin on the calibration pane
  useEffect(() => {
    const L = LRef.current, map = drawMap.current
    if (!L || !map) return
    if (drawGcpRef.current) { drawGcpRef.current.forEach((m) => m.remove()); }
    drawGcpRef.current = points.map((p, i) => L.marker([IMAGE_H - p.py, p.px], {
      icon: L.divIcon({ className: '', html: `<div style="background:${FERN};color:#fff;border:2px solid #fff;border-radius:9999px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font:700 11px sans-serif;box-shadow:0 1px 3px rgba(0,0,0,.4)">${i + 1}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
    }).addTo(map))
    if (drawPinRef.current) { drawPinRef.current.remove(); drawPinRef.current = null }
    if (pending) {
      drawPinRef.current = L.marker([IMAGE_H - pending.py, pending.px], {
        icon: L.divIcon({ className: '', html: `<div style="background:${GOLD};border:2px solid #fff;border-radius:9999px;width:20px;height:20px;box-shadow:0 1px 3px rgba(0,0,0,.5)"></div>`, iconSize: [20, 20], iconAnchor: [10, 10] }),
      }).addTo(map)
    }
  }, [points, pending, mode])

  // ── Capture the GPS for the pending drawing point ───────────────────────────
  async function doCapture() {
    if (!pending) { setMsg('First tap the head on the drawing above.'); return }
    setCapturing({ n: 0, acc: null })
    try {
      const g = await captureAveragedGps({ seconds: 6, onTick: (n, acc) => setCapturing({ n, acc: Math.round(acc || 0) }) })
      setPoints((prev) => [...prev, { px: pending.px, py: pending.py, lat: g.lat, lng: g.lng, acc: g.acc }])
      setPending(null)
      setMsg(`Point ${points.length + 1} captured (±${g.acc} ft-ish, ${g.n} reads).`)
    } catch (e) {
      setMsg(e.message || 'GPS capture failed')
    } finally {
      setCapturing(null)
    }
  }

  const removePoint = (i) => setPoints((prev) => prev.filter((_, k) => k !== i))

  async function saveCalibration() {
    setSaving(true)
    try {
      const tf = fitSimilarity(points, IMAGE_H)
      const r = fitResiduals(points, tf, IMAGE_H)
      const cal = { imageW: IMAGE_W, imageH: IMAGE_H, points, transform: tf, avgErrorM: r.avgErrorM, updatedAt: new Date().toISOString() }
      const nextCourse = { ...courseInfo, mapCalibration: cal }
      await db.saveSettings({ courseInfo: nextCourse })
      setCourseInfo(nextCourse)
      setMsg('Calibration saved — the overlay is now placed on the map.')
      setMode('map')
    } catch (e) { console.error(e); setMsg('Could not save — try again.') } finally { setSaving(false) }
  }

  const avgFt = fit.avgErrorM != null ? Math.round(metresToFeet(fit.avgErrorM)) : null
  const recenter = () => { if (mainMap.current && gps) mainMap.current.setView([gps.lat, gps.lng], 19) }

  // ── UI ──────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-5 pb-24">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <MapPin size={20} style={{ color: FERN }} />
          <h1 className="font-display text-xl font-semibold" style={{ color: FOREST }}>Irrigation</h1>
          {!transform && <span className="font-body text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#FEF3DD', color: '#92660D' }}>Not calibrated yet</span>}
        </div>
        {manage && (
          <div className="flex items-center gap-1.5">
            <button onClick={() => { setMode('map'); setMsg(null) }} className="font-body text-xs font-bold px-3 py-1.5 rounded-full" style={mode === 'map' ? { backgroundColor: FOREST, color: '#fff' } : { color: FOREST, border: '1px solid #E2E8F0' }}>Map</button>
            <button onClick={() => { setMode('calibrate'); setMsg(null) }} className="font-body text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1.5" style={mode === 'calibrate' ? { backgroundColor: FOREST, color: '#fff' } : { color: FOREST, border: '1px solid #E2E8F0' }}><Crosshair size={13} /> Calibrate</button>
          </div>
        )}
      </div>

      {msg && (
        <div className="mb-3 rounded-xl px-3 py-2 font-body text-[12px] flex items-center justify-between gap-2" style={{ backgroundColor: '#EEF4EF', border: '1px solid #CFE0D5', color: FERN }}>
          <span>{msg}</span>
          <button onClick={() => setMsg(null)} className="shrink-0"><X size={14} /></button>
        </div>
      )}

      {!ready || loading ? (
        <div className="paper-card p-10 text-center font-body text-sm text-slate-400 flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading map…</div>
      ) : mode === 'map' ? (
        <div className="space-y-3">
          {!transform && (
            <div className="rounded-xl px-4 py-3 font-body text-[13px]" style={{ backgroundColor: '#FFFDF6', border: `1px solid ${GOLD}`, color: '#7A5B12' }}>
              The irrigation overlay isn&apos;t placed on the map yet. {manage ? <>Tap <b>Calibrate</b>, then walk the course dropping points on known heads to lock it in.</> : 'Ask the superintendent to calibrate it.'}
            </div>
          )}
          <div className="relative">
            <div ref={mainRef} className="w-full rounded-2xl overflow-hidden border border-black/10" style={{ height: '70vh', minHeight: 420, backgroundColor: '#0b1e12' }} />
            {/* Floating controls */}
            <div className="absolute z-[500] top-3 right-3 flex flex-col gap-2">
              <button onClick={recenter} title="Center on me" className="w-10 h-10 rounded-full bg-white shadow flex items-center justify-center" style={{ color: FOREST }}><Navigation size={17} /></button>
            </div>
            {transform && (
              <div className="absolute z-[500] bottom-3 left-3 right-3 sm:right-auto sm:w-72 bg-white/95 backdrop-blur rounded-xl shadow p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <Layers size={14} style={{ color: FERN }} />
                  <span className="font-body text-[12px] font-bold" style={{ color: FOREST }}>Irrigation overlay</span>
                  <span className="font-body text-[11px] ml-auto tabular-nums text-slate-500">{Math.round(opacity * 100)}%</span>
                </div>
                <input type="range" min="0" max="1" step="0.05" value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="w-full" />
                {avgFt != null && <p className="font-body text-[10px] text-slate-400 mt-1">Fit: ~{avgFt} ft average from {points.length} points{gps?.acc ? ` · GPS ±${Math.round(gps.acc)} m` : ''}</p>}
              </div>
            )}
          </div>
        </div>
      ) : (
        // ── Calibrate mode ──────────────────────────────────────────────────────
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          <div className="lg:col-span-2 space-y-2">
            <div className="rounded-xl px-4 py-3 font-body text-[13px]" style={{ backgroundColor: '#EEF4EF', border: '1px solid #CFE0D5', color: FERN }}>
              <b>1.</b> Pinch-zoom and tap the exact head on the drawing. <b>2.</b> Walk to it, stand your phone on it, and press <b>Capture GPS</b>. Repeat at 8–12 heads spread around the course.
            </div>
            <div ref={drawRef} className="w-full rounded-2xl overflow-hidden border border-black/10" style={{ height: '62vh', minHeight: 380, backgroundColor: '#20302a' }} />
          </div>

          <div className="space-y-3">
            <div className="paper-card p-4">
              <p className="font-body text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Capture a point</p>
              <div className="rounded-lg px-3 py-2 mb-2 font-body text-[12px]" style={{ backgroundColor: pending ? '#FBF6E7' : '#F1F5F9', color: pending ? '#92660D' : '#64748B' }}>
                {pending ? <>Head marked on drawing at ({Math.round(pending.px)}, {Math.round(pending.py)}). Now stand on it.</> : 'Tap the head on the drawing to mark it.'}
              </div>
              <button onClick={doCapture} disabled={!pending || !!capturing} className="w-full py-2.5 rounded-xl font-body text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40" style={{ backgroundColor: FOREST }}>
                {capturing ? <><Loader2 size={15} className="animate-spin" /> Averaging… {capturing.n} reads{capturing.acc ? ` (±${capturing.acc} m)` : ''}</> : <><Crosshair size={15} /> Capture GPS here</>}
              </button>
              {gps && <p className="font-body text-[10px] text-slate-400 mt-1.5">Live GPS: {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}{gps.acc ? ` · ±${Math.round(gps.acc)} m` : ''}</p>}
            </div>

            <div className="paper-card p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="font-body text-[11px] font-bold uppercase tracking-wide text-slate-400">Points ({points.length})</p>
                {avgFt != null && <span className="font-body text-[11px] font-bold" style={{ color: avgFt <= 15 ? FERN : avgFt <= 30 ? '#92660D' : '#B91C1C' }}>avg ~{avgFt} ft</span>}
              </div>
              {points.length === 0 ? (
                <p className="font-body text-[12px] text-slate-400">No points yet. You need at least 2 to place the overlay; 8–12 spread out is best.</p>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {fit.residuals.map((p, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5" style={{ backgroundColor: '#F6F8F6' }}>
                      <span className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center font-body text-[10px] font-bold text-white" style={{ backgroundColor: FERN }}>{i + 1}</span>
                      <span className="font-body text-[11px] text-slate-500 flex-1 truncate tabular-nums">{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</span>
                      {p.errorM != null && <span className="font-body text-[10px] font-bold tabular-nums" style={{ color: metresToFeet(p.errorM) <= 20 ? FERN : '#B91C1C' }}>{Math.round(metresToFeet(p.errorM))}ft</span>}
                      <button onClick={() => removePoint(i)} className="text-slate-300 hover:text-red-500 shrink-0"><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={saveCalibration} disabled={points.length < 2 || saving} className="w-full mt-3 py-2.5 rounded-xl font-body text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40" style={{ backgroundColor: points.length < 2 ? '#94A3B8' : FERN }}>
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Save &amp; place overlay
              </button>
              <p className="font-body text-[10px] text-slate-400 mt-2">Points that show a big error (red) usually had a bad GPS moment — delete and recapture. Spread points to the far corners for the best fit.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
