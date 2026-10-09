'use client'

// ── GPS Coverage ─────────────────────────────────────────────────────────────
// Live pass-guidance on the phone. Mount your phone, pick the implement width,
// hit Start, and drive: the app paints a swath of that width behind you on the
// satellite map so you can see what's covered, catch a skipped strip, and avoid
// re-covering ground. Overlaps read darker; gaps read as bare turf.
//
// A phone's GPS is ~3–5 m (worse than the RTK on the Deere sprayers), so this is
// for coverage awareness, not sub-inch guidance. Honest about that in the UI.
//
// Leaflet loads in the browser only (needs `window`). Satellite tiles + the saved
// club location mirror the Course Map.

import { useEffect, useRef, useState, useCallback } from 'react'
import 'leaflet/dist/leaflet.css'
import { Play, Pause, Square, Crosshair, Trash2, Loader2, Ruler, Navigation2, TriangleAlert } from 'lucide-react'
import * as db from '@/lib/db'
import { FOREST, FERN, GOLD, PAPER, HAIR, INK, INK_2, INK_3, RED } from '@/lib/theme'

const SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const SAT_ATTR = 'Imagery © Esri, Maxar, Earthstar Geographics'
const FALLBACK = { lat: 38.9803, lng: -77.1636 } // Congressional CC
const FT_PER_M = 3.28084
const SQM_PER_ACRE = 4046.8564

// Great-circle distance between two fixes, in metres.
function haversine(a, b) {
  const R = 6371000, toR = Math.PI / 180
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR
  const la1 = a.lat * toR, la2 = b.lat * toR
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}
// Compass bearing a→b in degrees (0 = north).
function bearing(a, b) {
  const toR = Math.PI / 180, toD = 180 / Math.PI
  const la1 = a.lat * toR, la2 = b.lat * toR, dLng = (b.lng - a.lng) * toR
  const y = Math.sin(dLng) * Math.cos(la2)
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng)
  return (Math.atan2(y, x) * toD + 360) % 360
}

function headingIcon(L, deg) {
  const html = `<div style="width:30px;height:30px;transform:rotate(${deg}deg);transition:transform .2s">
    <svg width="30" height="30" viewBox="0 0 30 30">
      <circle cx="15" cy="15" r="13" fill="rgba(201,168,76,.25)"/>
      <circle cx="15" cy="15" r="8" fill="${FOREST}" stroke="#fff" stroke-width="2"/>
      <path d="M15 2 L20 11 L15 8.5 L10 11 Z" fill="${GOLD}" stroke="#fff" stroke-width="1"/>
    </svg></div>`
  return L.divIcon({ className: 'gps-pos', html, iconSize: [30, 30], iconAnchor: [15, 15] })
}

export default function GpsCoverage({ user }) {
  const [ready, setReady] = useState(false)       // leaflet loaded
  const [running, setRunning] = useState(false)
  const [paused, setPaused] = useState(false)
  const [widthFt, setWidthFt] = useState(20)
  const [follow, setFollow] = useState(true)
  const [gpsErr, setGpsErr] = useState('')
  const [stats, setStats] = useState({ acres: 0, dist: 0, mph: 0, acc: null, secs: 0 })

  const containerRef = useRef(null)
  const LRef = useRef(null)
  const mapRef = useRef(null)
  const rendererRef = useRef(null)
  const coverRef = useRef(null)   // layer group of painted swath
  const pathRef = useRef(null)    // centre breadcrumb line
  const markerRef = useRef(null)
  const trackRef = useRef([])     // [{lat,lng,t,acc}]
  const distRef = useRef(0)       // running track length in metres
  const watchRef = useRef(null)
  const wakeRef = useRef(null)
  const startRef = useRef(0)
  const tickRef = useRef(null)
  const widthRef = useRef(widthFt)
  const followRef = useRef(follow)
  useEffect(() => { widthRef.current = widthFt }, [widthFt])
  useEffect(() => { followRef.current = follow }, [follow])

  // Load Leaflet (browser only).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const mod = await import('leaflet')
        const L = mod.default || mod
        if (!cancelled) { LRef.current = L; setReady(true) }
      } catch (e) { console.error('Leaflet failed to load', e) }
    })()
    return () => { cancelled = true }
  }, [])

  // Init the map once Leaflet + the container are ready.
  useEffect(() => {
    if (!ready || !containerRef.current || mapRef.current) return
    const L = LRef.current
    let cancelled = false
    ;(async () => {
      let center = FALLBACK
      try { const s = await db.fetchSettings(); if (s?.location?.lat != null) center = { lat: s.location.lat, lng: s.location.lng } } catch { /* use fallback */ }
      if (cancelled || mapRef.current || !containerRef.current) return
      const map = L.map(containerRef.current, { center: [center.lat, center.lng], zoom: 18, zoomControl: true, attributionControl: true, preferCanvas: true })
      L.tileLayer(SAT_URL, { maxZoom: 22, maxNativeZoom: 19, attribution: SAT_ATTR, crossOrigin: true }).addTo(map)
      rendererRef.current = L.canvas({ padding: 0.5 })
      coverRef.current = L.layerGroup().addTo(map)
      pathRef.current = L.polyline([], { color: FOREST, weight: 2, opacity: 0.8, renderer: rendererRef.current }).addTo(map)
      mapRef.current = map
      setTimeout(() => map.invalidateSize(), 150)
    })()
    return () => { cancelled = true }
  }, [ready])

  // Tidy up on unmount.
  useEffect(() => () => {
    if (watchRef.current != null && navigator.geolocation) navigator.geolocation.clearWatch(watchRef.current)
    if (tickRef.current) clearInterval(tickRef.current)
    releaseWake()
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
  }, [])

  async function requestWake() {
    try { if ('wakeLock' in navigator) wakeRef.current = await navigator.wakeLock.request('screen') } catch { /* optional */ }
  }
  function releaseWake() { try { wakeRef.current?.release?.(); wakeRef.current = null } catch { /* ignore */ } }

  const paint = useCallback((fix) => {
    const L = LRef.current, map = mapRef.current
    if (!L || !map) return
    const widthM = widthRef.current / FT_PER_M
    const track = trackRef.current
    const prev = track[track.length - 1]
    // Paint a disc of the implement width at this fix; overlaps darken, so a
    // double pass reads heavier and a gap stays bare turf.
    L.circle([fix.lat, fix.lng], { radius: widthM / 2, stroke: false, fillColor: FERN, fillOpacity: 0.3, renderer: rendererRef.current }).addTo(coverRef.current)
    if (prev) {
      const d = haversine(prev, fix)
      // Fill the gap between fixes at speed with a couple of in-between discs.
      if (d > widthM / 2) {
        const steps = Math.min(8, Math.ceil(d / (widthM / 2)))
        for (let i = 1; i < steps; i++) {
          const f = i / steps
          L.circle([prev.lat + (fix.lat - prev.lat) * f, prev.lng + (fix.lng - prev.lng) * f], { radius: widthM / 2, stroke: false, fillColor: FERN, fillOpacity: 0.3, renderer: rendererRef.current }).addTo(coverRef.current)
        }
      }
    }
    pathRef.current.addLatLng([fix.lat, fix.lng])
    const deg = fix.heading != null ? fix.heading : (prev ? bearing(prev, fix) : 0)
    if (!markerRef.current) markerRef.current = L.marker([fix.lat, fix.lng], { icon: headingIcon(L, deg), interactive: false }).addTo(map)
    else { markerRef.current.setLatLng([fix.lat, fix.lng]); markerRef.current.setIcon(headingIcon(L, deg)) }
    if (followRef.current) map.panTo([fix.lat, fix.lng], { animate: true, duration: 0.4 })
  }, [])

  const onFix = useCallback((pos) => {
    const c = pos.coords
    const fix = { lat: c.latitude, lng: c.longitude, t: pos.timestamp, acc: c.accuracy || null, heading: (c.heading != null && !Number.isNaN(c.heading)) ? c.heading : null }
    const track = trackRef.current
    const prev = track[track.length - 1]
    // Drop a fix that barely moved (GPS jitter while parked) so we don't pile up.
    if (prev && haversine(prev, fix) < 0.4) { setStats((s) => ({ ...s, acc: fix.acc })); return }
    if (prev) distRef.current += haversine(prev, fix)
    track.push(fix)
    paint(fix)
    // Running stats.
    const dist = distRef.current
    const widthM = widthRef.current / FT_PER_M
    const acres = (dist * widthM) / SQM_PER_ACRE
    let mph = 0
    if (c.speed != null && !Number.isNaN(c.speed)) mph = c.speed * 2.23694
    else if (prev) { const dt = (fix.t - prev.t) / 1000; if (dt > 0) mph = (haversine(prev, fix) / dt) * 2.23694 }
    setStats({ acres, dist, mph: Math.max(0, mph), acc: fix.acc, secs: Math.round((Date.now() - startRef.current) / 1000) })
  }, [paint])

  function start() {
    if (!navigator.geolocation) { setGpsErr('no-gps'); return }
    setGpsErr('')
    setRunning(true); setPaused(false)
    if (!startRef.current) startRef.current = Date.now()
    requestWake()
    watchRef.current = navigator.geolocation.watchPosition(onFix, (e) => {
      setGpsErr(e.code === 1 ? 'denied' : 'unavailable')
    }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 })
    tickRef.current = setInterval(() => setStats((s) => ({ ...s, secs: Math.round((Date.now() - startRef.current) / 1000) })), 1000)
  }
  function pause() {
    setPaused(true)
    if (watchRef.current != null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null }
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
    releaseWake()
  }
  function stop() {
    pause(); setRunning(false)
    // Coverage stays painted so the crew can review the job before clearing.
  }
  function clearAll() {
    coverRef.current?.clearLayers()
    pathRef.current?.setLatLngs([])
    if (markerRef.current && mapRef.current) { mapRef.current.removeLayer(markerRef.current); markerRef.current = null }
    trackRef.current = []
    distRef.current = 0
    startRef.current = 0
    setStats({ acres: 0, dist: 0, mph: 0, acc: null, secs: 0 })
  }
  function recenter() {
    const t = trackRef.current
    const last = t[t.length - 1]
    if (last && mapRef.current) mapRef.current.setView([last.lat, last.lng], Math.max(18, mapRef.current.getZoom()))
  }

  const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const accLabel = stats.acc == null ? '—' : `±${Math.round(stats.acc)} m`
  const accColor = stats.acc == null ? INK_3 : stats.acc <= 6 ? FERN : stats.acc <= 12 ? GOLD : RED

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <h1 className="font-display text-xl font-bold" style={{ color: FOREST }}>GPS Coverage</h1>
          <p className="font-body text-xs" style={{ color: INK_2 }}>Paint your passes as you drive — catch skips, avoid re-covering. For tractors, aerators, topdressers.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 font-body text-xs font-semibold px-2.5 py-1.5 rounded-full" style={{ backgroundColor: PAPER, border: `1px solid ${HAIR}`, color: INK }}>
            <Ruler size={13} style={{ color: FERN }} />
            <input type="number" min="1" step="1" value={widthFt} onChange={(e) => setWidthFt(Math.max(1, Number(e.target.value) || 1))} className="w-12 text-center bg-transparent outline-none" style={{ color: FOREST }} />
            ft wide
          </label>
          <button onClick={() => setFollow((f) => !f)} className="font-body text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1.5" style={follow ? { backgroundColor: FERN, color: '#fff' } : { backgroundColor: PAPER, color: INK_2, border: `1px solid ${HAIR}` }}>
            <Navigation2 size={13} /> Follow
          </button>
        </div>
      </div>

      {gpsErr && (
        <div className="flex items-start gap-2 font-body text-sm rounded-xl px-3 py-2 mb-3" style={{ backgroundColor: '#FBEEEC', color: RED, border: `1px solid #EBC9C4` }}>
          <TriangleAlert size={16} className="shrink-0 mt-0.5" />
          <span>{gpsErr === 'no-gps' ? 'This device has no GPS.' : gpsErr === 'denied' ? 'Location is blocked — allow location for this site in your browser settings, then hit Start again.' : 'Lost the GPS signal — move into the open and try again.'}</span>
        </div>
      )}

      <div className="relative rounded-2xl overflow-hidden" style={{ border: `1px solid ${HAIR}`, backgroundColor: PAPER }}>
        <div ref={containerRef} style={{ height: '72vh', minHeight: 440, width: '100%' }} />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: PAPER }}>
            <span className="flex items-center gap-2 font-body text-sm" style={{ color: INK_2 }}><Loader2 size={16} className="animate-spin" /> Loading map…</span>
          </div>
        )}

        {/* Live stats strip */}
        <div className="absolute left-2 right-2 bottom-2 z-[500] rounded-xl px-1 py-1.5" style={{ backgroundColor: 'rgba(249,248,245,0.94)', border: `1px solid ${HAIR}`, backdropFilter: 'blur(4px)' }}>
          <div className="grid grid-cols-5 gap-1">
            {[
              ['Covered', stats.acres.toFixed(2), 'ac'],
              ['Distance', Math.round(stats.dist * FT_PER_M).toLocaleString(), 'ft'],
              ['Speed', stats.mph.toFixed(1), 'mph'],
              ['Time', mmss(stats.secs), ''],
              ['GPS', accLabel, ''],
            ].map(([k, v, u], i) => (
              <div key={k} className="text-center px-1">
                <div className="font-body text-[9px] font-bold uppercase tracking-wide" style={{ color: INK_3 }}>{k}</div>
                <div className="font-display font-bold tabular-nums leading-tight" style={{ color: i === 4 ? accColor : FOREST, fontSize: 17 }}>{v}<span className="text-[10px] font-body font-semibold" style={{ color: INK_2 }}>{u ? ' ' + u : ''}</span></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 mt-3">
        {!running ? (
          <button onClick={start} className="flex-1 font-body text-sm font-bold py-3 rounded-xl text-white flex items-center justify-center gap-2" style={{ backgroundColor: FERN }}>
            <Play size={16} /> {trackRef.current.length ? 'Resume' : 'Start'}
          </button>
        ) : (
          <button onClick={pause} className="flex-1 font-body text-sm font-bold py-3 rounded-xl flex items-center justify-center gap-2" style={{ backgroundColor: GOLD, color: FOREST }}>
            <Pause size={16} /> Pause
          </button>
        )}
        <button onClick={stop} disabled={!running && !trackRef.current.length} className="font-body text-sm font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 disabled:opacity-40" style={{ backgroundColor: PAPER, color: FOREST, border: `1px solid ${HAIR}` }}>
          <Square size={15} /> Stop
        </button>
        <button onClick={recenter} className="font-body text-sm font-bold py-3 px-4 rounded-xl flex items-center justify-center disabled:opacity-40" style={{ backgroundColor: PAPER, color: FOREST, border: `1px solid ${HAIR}` }} aria-label="Recenter">
          <Crosshair size={16} />
        </button>
        <button onClick={clearAll} disabled={!trackRef.current.length} className="font-body text-sm font-bold py-3 px-4 rounded-xl flex items-center justify-center disabled:opacity-40" style={{ backgroundColor: PAPER, color: RED, border: `1px solid ${HAIR}` }} aria-label="Clear">
          <Trash2 size={16} />
        </button>
      </div>

      <p className="font-body text-[11px] mt-3 leading-relaxed" style={{ color: INK_3 }}>
        Phone GPS is roughly 10–15 ft accurate, so the painted band shows where you’ve been, not sub-inch guidance. Overlaps paint darker; bare turf is a missed strip. Keep the phone mounted with a clear view of the sky, and leave it on cab power — tracking keeps the screen awake.
      </p>
    </div>
  )
}
