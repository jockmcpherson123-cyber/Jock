'use client'

// ── GPS Coverage ─────────────────────────────────────────────────────────────
// Live pass-guidance on the phone, styled like the GreenTrack concept: a clean
// turf field you paint as you drive, an A–B lightbar to hold your line, a
// flagged missed strip, and the four job stats. Satellite is a tap away when you
// want real course context.
//
// Phone GPS is ~3–5 m (worse than the RTK on the Deere sprayers), so this is for
// coverage awareness, not sub-inch guidance — the UI says so.

import { useEffect, useRef, useState, useCallback } from 'react'
import 'leaflet/dist/leaflet.css'
import { Play, Pause, Square, Crosshair, Trash2, Loader2, Ruler, Layers, Satellite, Minus, Plus } from 'lucide-react'
import * as db from '@/lib/db'
import { FOREST, FERN, GOLD, PAPER, HAIR, INK, INK_2, INK_3, RED } from '@/lib/theme'

const SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const SAT_ATTR = 'Imagery © Esri, Maxar, Earthstar Geographics'
const FALLBACK = { lat: 38.9803, lng: -77.1636 } // Congressional CC
const FT_PER_M = 3.28084
const SQM_PER_ACRE = 4046.8564
const TURF = '#AEC8AB'          // clean field base
const COVER = 'rgba(47,90,60,0.42)' // painted swath — overlaps darken
const OPS = ['Aerating', 'Mowing', 'Topdressing', 'Spraying', 'Rolling', 'Verticutting', 'Seeding']

function haversine(a, b) {
  const R = 6371000, toR = Math.PI / 180
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR
  const la1 = a.lat * toR, la2 = b.lat * toR
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}
function bearing(a, b) {
  const toR = Math.PI / 180, toD = 180 / Math.PI
  const la1 = a.lat * toR, la2 = b.lat * toR, dLng = (b.lng - a.lng) * toR
  const y = Math.sin(dLng) * Math.cos(la2)
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng)
  return (Math.atan2(y, x) * toD + 360) % 360
}
function destination(lat, lng, brgDeg, distM) {
  const R = 6371000, toR = Math.PI / 180, toD = 180 / Math.PI
  const d = distM / R, brg = brgDeg * toR, la1 = lat * toR, lo1 = lng * toR
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(brg))
  const lo2 = lo1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2))
  return { lat: la2 * toD, lng: lo2 * toD }
}
function crossTrack(A, B, P) {
  const R = 6371000, toR = Math.PI / 180
  const d13 = haversine(A, P) / R
  const th13 = bearing(A, P) * toR
  const th12 = bearing(A, B) * toR
  return Math.asin(Math.sin(d13) * Math.sin(th13 - th12)) * R
}

function headingIcon(L, deg) {
  const html = `<div style="width:30px;height:30px;transform:rotate(${deg}deg);transition:transform .2s">
    <svg width="30" height="30" viewBox="0 0 30 30">
      <circle cx="15" cy="15" r="13" fill="rgba(201,168,76,.3)"/>
      <circle cx="15" cy="15" r="8" fill="${FOREST}" stroke="#fff" stroke-width="2"/>
      <path d="M15 2 L20 11 L15 8.5 L10 11 Z" fill="${GOLD}" stroke="#fff" stroke-width="1"/>
    </svg></div>`
  return L.divIcon({ className: 'gps-pos', html, iconSize: [30, 30], iconAnchor: [15, 15] })
}
function missedPill(L) {
  return L.divIcon({ className: '', html: `<div style="background:${RED};color:#fff;font:700 10px Archivo,sans-serif;padding:3px 9px;border-radius:10px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.35)">Missed strip</div>`, iconSize: [90, 18], iconAnchor: [45, 9] })
}
function Chevron({ hot, right }) {
  return (
    <svg width="12" height="18" viewBox="0 0 11 17" style={{ opacity: hot ? 1 : 0.26, transform: right ? 'scaleX(-1)' : 'none', transition: 'opacity .15s' }}>
      <path d="M9 1 2 8.5 9 16" fill="none" stroke="#EFEFE7" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function GpsCoverage() {
  const [ready, setReady] = useState(false)
  const [running, setRunning] = useState(false)
  const [widthFt, setWidthFt] = useState(20)
  const [widthOpen, setWidthOpen] = useState(false)
  const [follow, setFollow] = useState(true)
  const [sat, setSat] = useState(false)
  const [gpsErr, setGpsErr] = useState('')
  const [stats, setStats] = useState({ acres: 0, mph: 0, acc: null, secs: 0 })
  const [abStage, setAbStage] = useState('none')
  const [lb, setLb] = useState({ active: false, off: 0 })
  const [areas, setAreas] = useState({})
  const [areaName, setAreaName] = useState('')
  const [op, setOp] = useState('Aerating')

  const containerRef = useRef(null)
  const LRef = useRef(null)
  const mapRef = useRef(null)
  const tileRef = useRef(null)
  const rendererRef = useRef(null)
  const coverRef = useRef(null)
  const pathRef = useRef(null)
  const markerRef = useRef(null)
  const lineRef = useRef(null)
  const guideRef = useRef(null)
  const missRef = useRef(null)
  const trackRef = useRef([])
  const distRef = useRef(0)
  const watchRef = useRef(null)
  const wakeRef = useRef(null)
  const startRef = useRef(0)
  const tickRef = useRef(null)
  const widthRef = useRef(widthFt)
  const followRef = useRef(follow)
  useEffect(() => { widthRef.current = widthFt }, [widthFt])
  useEffect(() => { followRef.current = follow }, [follow])

  const areaObj = areas[areaName] || null
  const totalAc = areaObj ? (Number(areaObj.acres) || (Number(areaObj.sqft) || 0) / 43560) : 0
  const courseName = areaObj?.course || ''
  const coveragePct = totalAc > 0 ? Math.min(100, Math.round((stats.acres / totalAc) * 100)) : null

  // Load Leaflet (browser only).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try { const mod = await import('leaflet'); if (!cancelled) { LRef.current = mod.default || mod; setReady(true) } } catch (e) { console.error('Leaflet failed to load', e) }
    })()
    return () => { cancelled = true }
  }, [])

  // Load course settings (areas for the header + coverage %).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const s = await db.fetchSettings()
        if (cancelled) return
        const a = s?.areas || {}
        setAreas(a)
        const first = Object.keys(a)[0]
        if (first) setAreaName(first)
      } catch { /* fine without areas */ }
    })()
    return () => { cancelled = true }
  }, [])

  // Init the map.
  useEffect(() => {
    if (!ready || !containerRef.current || mapRef.current) return
    const L = LRef.current
    let cancelled = false
    ;(async () => {
      let center = FALLBACK
      try { const s = await db.fetchSettings(); if (s?.location?.lat != null) center = { lat: s.location.lat, lng: s.location.lng } } catch { /* fallback */ }
      if (cancelled || mapRef.current || !containerRef.current) return
      const map = L.map(containerRef.current, { center: [center.lat, center.lng], zoom: 18, zoomControl: true, attributionControl: true, preferCanvas: true })
      map.zoomControl.setPosition('bottomright')
      rendererRef.current = L.canvas({ padding: 0.5 })
      coverRef.current = L.layerGroup().addTo(map)
      guideRef.current = L.layerGroup().addTo(map)
      missRef.current = L.layerGroup().addTo(map)
      pathRef.current = L.polyline([], { color: FOREST, weight: 2, opacity: 0.7, renderer: rendererRef.current }).addTo(map)
      mapRef.current = map
      setTimeout(() => map.invalidateSize(), 150)
    })()
    return () => { cancelled = true }
  }, [ready])

  // Satellite tiles on/off.
  useEffect(() => {
    const L = LRef.current, map = mapRef.current
    if (!L || !map) return
    if (sat && !tileRef.current) tileRef.current = L.tileLayer(SAT_URL, { maxZoom: 22, maxNativeZoom: 19, attribution: SAT_ATTR, crossOrigin: true }).addTo(map)
    else if (!sat && tileRef.current) { map.removeLayer(tileRef.current); tileRef.current = null }
  }, [sat, ready])

  useEffect(() => () => {
    if (watchRef.current != null && navigator.geolocation) navigator.geolocation.clearWatch(watchRef.current)
    if (tickRef.current) clearInterval(tickRef.current)
    releaseWake()
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
  }, [])

  async function requestWake() { try { if ('wakeLock' in navigator) wakeRef.current = await navigator.wakeLock.request('screen') } catch { /* optional */ } }
  function releaseWake() { try { wakeRef.current?.release?.(); wakeRef.current = null } catch { /* ignore */ } }

  const paint = useCallback((fix) => {
    const L = LRef.current, map = mapRef.current
    if (!L || !map) return
    const widthM = widthRef.current / FT_PER_M
    const prev = trackRef.current[trackRef.current.length - 1]
    const disc = (lat, lng) => L.circle([lat, lng], { radius: widthM / 2, stroke: false, fillColor: FERN, fillOpacity: 0.42, renderer: rendererRef.current }).addTo(coverRef.current)
    disc(fix.lat, fix.lng)
    if (prev) {
      const d = haversine(prev, fix)
      if (d > widthM / 2) { const steps = Math.min(10, Math.ceil(d / (widthM / 2))); for (let i = 1; i < steps; i++) { const f = i / steps; disc(prev.lat + (fix.lat - prev.lat) * f, prev.lng + (fix.lng - prev.lng) * f) } }
    }
    pathRef.current.addLatLng([fix.lat, fix.lng])
    const deg = fix.heading != null ? fix.heading : (prev ? bearing(prev, fix) : 0)
    if (!markerRef.current) markerRef.current = L.marker([fix.lat, fix.lng], { icon: headingIcon(L, deg), interactive: false, zIndexOffset: 1000 }).addTo(map)
    else { markerRef.current.setLatLng([fix.lat, fix.lng]); markerRef.current.setIcon(headingIcon(L, deg)) }
    if (followRef.current) map.panTo([fix.lat, fix.lng], { animate: true, duration: 0.4 })
  }, [])

  // Flag any un-driven lane that sits between driven ones (a real skip).
  const checkMissed = useCallback(() => {
    const L = LRef.current, line = lineRef.current
    if (!L || !line?.a || !line?.b || !missRef.current) return
    const W = widthRef.current / FT_PER_M
    const driven = new Set()
    trackRef.current.forEach((f) => driven.add(Math.round(crossTrack(line.a, line.b, f) / W)))
    if (driven.size < 2) { missRef.current.clearLayers(); return }
    const ks = [...driven].sort((a, b) => a - b)
    const lo = ks[0], hi = ks[ks.length - 1]
    missRef.current.clearLayers()
    const th = bearing(line.a, line.b)
    const aExt = destination(line.a.lat, line.a.lng, th + 180, 120)
    const bExt = destination(line.b.lat, line.b.lng, th, 120)
    for (let k = lo + 1; k < hi; k++) {
      if (driven.has(k)) continue
      const c1 = destination(aExt.lat, aExt.lng, th + 90, k * W)
      const c2 = destination(bExt.lat, bExt.lng, th + 90, k * W)
      const p1 = destination(c1.lat, c1.lng, th + 90, -W / 2), p2 = destination(c1.lat, c1.lng, th + 90, W / 2)
      const p3 = destination(c2.lat, c2.lng, th + 90, W / 2), p4 = destination(c2.lat, c2.lng, th + 90, -W / 2)
      L.polygon([[p1.lat, p1.lng], [p2.lat, p2.lng], [p3.lat, p3.lng], [p4.lat, p4.lng]], { color: RED, weight: 1.5, dashArray: '5 5', fillColor: RED, fillOpacity: 0.2, renderer: rendererRef.current }).addTo(missRef.current)
      const mid = { lat: (c1.lat + c2.lat) / 2, lng: (c1.lng + c2.lng) / 2 }
      L.marker([mid.lat, mid.lng], { icon: missedPill(L), interactive: false }).addTo(missRef.current)
    }
  }, [])

  const onFix = useCallback((pos) => {
    const c = pos.coords
    const fix = { lat: c.latitude, lng: c.longitude, t: pos.timestamp, acc: c.accuracy || null, heading: (c.heading != null && !Number.isNaN(c.heading)) ? c.heading : null }
    const track = trackRef.current
    const prev = track[track.length - 1]
    if (prev && haversine(prev, fix) < 0.4) { setStats((s) => ({ ...s, acc: fix.acc })); return }
    if (prev) distRef.current += haversine(prev, fix)
    track.push(fix)
    paint(fix)
    const line = lineRef.current
    if (line && line.a && line.b) {
      const xt = crossTrack(line.a, line.b, fix)
      const W = widthRef.current / FT_PER_M
      setLb({ active: true, off: (xt - Math.round(xt / W) * W) * FT_PER_M })
      if (track.length % 6 === 0) checkMissed()
    }
    const widthM = widthRef.current / FT_PER_M
    let mph = 0
    if (c.speed != null && !Number.isNaN(c.speed)) mph = c.speed * 2.23694
    else if (prev) { const dt = (fix.t - prev.t) / 1000; if (dt > 0) mph = (haversine(prev, fix) / dt) * 2.23694 }
    setStats({ acres: (distRef.current * widthM) / SQM_PER_ACRE, mph: Math.max(0, mph), acc: fix.acc, secs: Math.round((Date.now() - startRef.current) / 1000) })
  }, [paint, checkMissed])

  function start() {
    if (!navigator.geolocation) { setGpsErr('no-gps'); return }
    setGpsErr(''); setRunning(true)
    if (!startRef.current) startRef.current = Date.now()
    requestWake()
    watchRef.current = navigator.geolocation.watchPosition(onFix, (e) => setGpsErr(e.code === 1 ? 'denied' : 'unavailable'), { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 })
    tickRef.current = setInterval(() => setStats((s) => ({ ...s, secs: Math.round((Date.now() - startRef.current) / 1000) })), 1000)
  }
  function pause() {
    setRunning(false)
    if (watchRef.current != null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null }
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
    releaseWake()
  }
  function stop() { pause(); checkMissed() }
  function clearAll() {
    coverRef.current?.clearLayers(); guideRef.current?.clearLayers(); missRef.current?.clearLayers()
    pathRef.current?.setLatLngs([])
    if (markerRef.current && mapRef.current) { mapRef.current.removeLayer(markerRef.current); markerRef.current = null }
    trackRef.current = []; distRef.current = 0; startRef.current = 0
    lineRef.current = null; setAbStage('none'); setLb({ active: false, off: 0 })
    setStats({ acres: 0, mph: 0, acc: null, secs: 0 })
  }
  function recenter() {
    const last = trackRef.current[trackRef.current.length - 1]
    if (last && mapRef.current) mapRef.current.setView([last.lat, last.lng], Math.max(18, mapRef.current.getZoom()))
  }

  const drawGuides = useCallback(() => {
    const L = LRef.current, map = mapRef.current, line = lineRef.current
    if (!L || !map || !line?.a || !line?.b || !guideRef.current) return
    guideRef.current.clearLayers()
    const th = bearing(line.a, line.b)
    const W = widthRef.current / FT_PER_M
    const aExt = destination(line.a.lat, line.a.lng, th + 180, 120)
    const bExt = destination(line.b.lat, line.b.lng, th, 120)
    for (let k = -5; k <= 5; k++) {
      const p1 = k === 0 ? aExt : destination(aExt.lat, aExt.lng, th + 90, k * W)
      const p2 = k === 0 ? bExt : destination(bExt.lat, bExt.lng, th + 90, k * W)
      L.polyline([[p1.lat, p1.lng], [p2.lat, p2.lng]], { color: GOLD, weight: k === 0 ? 2.5 : 1.75, opacity: k === 0 ? 0.95 : 0.6, dashArray: k === 0 ? null : '6 7', renderer: rendererRef.current }).addTo(guideRef.current)
    }
    ;[line.a, line.b].forEach((pt) => L.circleMarker([pt.lat, pt.lng], { radius: 5, color: '#fff', weight: 2, fillColor: FERN, fillOpacity: 1, renderer: rendererRef.current }).addTo(guideRef.current))
  }, [])

  function captureHere(cb) {
    if (!navigator.geolocation) { setGpsErr('no-gps'); return }
    const last = trackRef.current[trackRef.current.length - 1]
    if (last) { cb({ lat: last.lat, lng: last.lng }); return }
    navigator.geolocation.getCurrentPosition((p) => cb({ lat: p.coords.latitude, lng: p.coords.longitude }), () => setGpsErr('unavailable'), { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 })
  }
  function abTap() {
    if (abStage === 'none') captureHere((pt) => { lineRef.current = { a: pt, b: null }; setAbStage('a') })
    else if (abStage === 'a') captureHere((pt) => { lineRef.current = { ...lineRef.current, b: pt }; setAbStage('ab'); setLb({ active: true, off: 0 }); drawGuides(); checkMissed() })
    else { lineRef.current = null; guideRef.current?.clearLayers(); missRef.current?.clearLayers(); setAbStage('none'); setLb({ active: false, off: 0 }) }
  }
  useEffect(() => { if (abStage === 'ab') { drawGuides(); checkMissed() } }, [widthFt, abStage, drawGuides, checkMissed])

  const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const gpsWord = stats.acc == null ? '—' : stats.acc <= 6 ? 'good' : stats.acc <= 12 ? 'fair' : 'weak'
  const gpsColor = stats.acc == null ? INK_3 : stats.acc <= 6 ? '#2E7D46' : stats.acc <= 12 ? GOLD : RED
  const halfW = Math.max(0.5, widthFt / 2)
  const lbMag = Math.abs(lb.off)
  const lbOn = lbMag < 0.3
  const lbPos = Math.max(5, Math.min(95, 50 + (lb.off / halfW) * 45))
  const lbStatus = lbOn ? 'On line' : lb.off > 0 ? 'Nudge left' : 'Nudge right'
  const abSub = abStage === 'none' ? 'tap at pass start' : abStage === 'a' ? 'now tap at pass end' : 'line locked'
  const abLabel = abStage === 'none' ? 'Set A' : abStage === 'a' ? 'Set B' : 'A–B set'
  const selStyle = { appearance: 'none', WebkitAppearance: 'none', background: 'transparent', border: 'none', outline: 'none', cursor: 'pointer', font: 'inherit', color: 'inherit', padding: 0 }

  const Tile = ({ k, v, u, sub, color }) => (
    <div className="px-2 py-2 text-center" style={{ backgroundColor: PAPER }}>
      <div className="font-body text-[9.5px] font-bold uppercase tracking-wide" style={{ color: INK_3 }}>{k}</div>
      <div className="font-display font-bold tabular-nums leading-none mt-1" style={{ color: color || FOREST, fontSize: 21 }}>{v}{u && <span className="font-body text-[11px] font-semibold" style={{ color: INK_2 }}>{u}</span>}</div>
      {sub && <div className="font-body text-[10px] mt-0.5" style={{ color: INK_2 }}>{sub}</div>}
    </div>
  )

  return (
    <div className="max-w-xl mx-auto px-4 py-4">
      {/* Header — course · area + operation + GPS pill, like the preview */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="font-body text-[11px] font-bold uppercase tracking-[0.12em] flex items-center gap-1" style={{ color: GOLD }}>
            {Object.keys(areas).length ? (
              <select value={areaName} onChange={(e) => setAreaName(e.target.value)} style={selStyle} aria-label="Area">
                {Object.keys(areas).map((n) => <option key={n} value={n}>{(areas[n]?.course ? areas[n].course + ' · ' : '') + n}</option>)}
              </select>
            ) : 'GPS Coverage'}
            <span style={{ color: INK_3 }}>▾</span>
          </div>
          <div className="font-display font-bold leading-tight" style={{ color: FOREST, fontSize: 22 }}>
            <select value={op} onChange={(e) => setOp(e.target.value)} style={selStyle} aria-label="Operation">
              {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-1.5 font-body text-xs font-bold px-2.5 py-1.5 rounded-full shrink-0" style={{ backgroundColor: '#EAF1EB', border: `1px solid #CFE3D6`, color: gpsColor }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: gpsColor, boxShadow: `0 0 0 3px ${gpsColor}22` }} /> GPS · {gpsWord}
        </div>
      </div>

      {gpsErr && (
        <div className="font-body text-sm rounded-xl px-3 py-2 mb-3" style={{ backgroundColor: '#FBEEEC', color: RED, border: '1px solid #EBC9C4' }}>
          {gpsErr === 'no-gps' ? 'This device has no GPS.' : gpsErr === 'denied' ? 'Location is blocked — allow location for this site, then hit Start again.' : 'Lost the GPS signal — move into the open and try again.'}
        </div>
      )}

      {/* Lightbar */}
      <div className="rounded-xl px-3 py-2.5 mb-2" style={{ backgroundColor: FOREST }}>
        {abStage === 'ab' ? (
          <>
            <div className="flex items-center gap-2.5">
              <div className="flex gap-0.5"><Chevron hot={lb.off > 0.3} /><Chevron hot={lb.off > 0.3} /></div>
              <div className="relative flex-1 h-6 rounded-md" style={{ background: 'linear-gradient(90deg, rgba(255,255,255,.12) 1px, transparent 1px) 0 0 / 10% 100%, rgba(255,255,255,.06)' }}>
                <div style={{ position: 'absolute', left: '50%', top: -3, bottom: -3, width: 2, marginLeft: -1, background: GOLD, borderRadius: 2 }} />
                <div style={{ position: 'absolute', top: 3, bottom: 3, width: 18, marginLeft: -9, left: lbPos + '%', borderRadius: 5, background: lbOn ? '#EFEFE7' : GOLD, boxShadow: '0 1px 3px rgba(0,0,0,.45)', transition: 'left .12s linear, background .15s' }} />
              </div>
              <div className="flex gap-0.5"><Chevron right hot={lb.off < -0.3} /><Chevron right hot={lb.off < -0.3} /></div>
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="font-body text-sm font-bold" style={{ color: lbOn ? '#9FD9B0' : '#EFE7CF' }}>{lbStatus}</span>
              <span className="font-body text-sm tabular-nums" style={{ color: '#C9CFC2' }}>{lbMag.toFixed(1)} ft</span>
            </div>
          </>
        ) : (
          <p className="font-body text-xs text-center py-1" style={{ color: '#D7DBD1' }}>
            For the guidance line: tap <b style={{ color: '#fff' }}>Set A</b> at the start of your first pass, drive it, then <b style={{ color: '#fff' }}>Set B</b> at the end.
          </p>
        )}
      </div>

      {/* Field */}
      <div className="relative rounded-2xl overflow-hidden" style={{ border: `1px solid ${HAIR}` }}>
        <div ref={containerRef} style={{ height: '52vh', minHeight: 360, width: '100%', background: TURF }} />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: TURF }}>
            <span className="flex items-center gap-2 font-body text-sm" style={{ color: FOREST }}><Loader2 size={16} className="animate-spin" /> Loading…</span>
          </div>
        )}
        <button onClick={() => setSat((s) => !s)} className="absolute top-2 right-2 z-[500] font-body text-[11px] font-bold px-2.5 py-1.5 rounded-full flex items-center gap-1.5" style={{ backgroundColor: sat ? FOREST : 'rgba(249,248,245,0.94)', color: sat ? '#fff' : FOREST, border: `1px solid ${HAIR}` }} title="Toggle satellite">
          {sat ? <Layers size={13} /> : <Satellite size={13} />} {sat ? 'Clean' : 'Satellite'}
        </button>
        <button onClick={() => setFollow((f) => !f)} className="absolute top-2 left-2 z-[500] font-body text-[11px] font-bold px-2.5 py-1.5 rounded-full flex items-center gap-1.5" style={{ backgroundColor: follow ? FERN : 'rgba(249,248,245,0.94)', color: follow ? '#fff' : FOREST, border: `1px solid ${HAIR}` }}>
          <Crosshair size={13} /> Follow
        </button>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-4 gap-px mt-3 rounded-xl overflow-hidden" style={{ backgroundColor: HAIR, border: `1px solid ${HAIR}` }}>
        <Tile k="Coverage" v={coveragePct == null ? '—' : coveragePct} u={coveragePct == null ? '' : '%'} />
        <Tile k="Acres" v={stats.acres.toFixed(2)} sub={totalAc > 0 ? `of ${totalAc.toFixed(1)}` : 'covered'} />
        <Tile k="Width" v={widthFt} u=" ft" />
        <Tile k="Speed" v={stats.mph.toFixed(1)} sub="mph" />
      </div>

      {/* Primary controls */}
      <div className="grid grid-cols-3 gap-2 mt-3">
        <button onClick={abTap} className="rounded-xl py-2.5 px-2 text-center" style={abStage === 'ab' ? { backgroundColor: GOLD, color: FOREST } : { backgroundColor: PAPER, color: FOREST, border: `1px solid ${HAIR}` }}>
          <div className="font-body text-sm font-bold">{abLabel}</div>
          <div className="font-body text-[10px] mt-0.5" style={{ opacity: 0.75 }}>{abSub}</div>
        </button>
        <div className="relative">
          <button onClick={() => setWidthOpen((o) => !o)} className="w-full rounded-xl py-2.5 px-2 text-center" style={{ backgroundColor: PAPER, color: FOREST, border: `1px solid ${HAIR}` }}>
            <div className="font-body text-sm font-bold flex items-center justify-center gap-1"><Ruler size={13} style={{ color: FERN }} /> Width</div>
            <div className="font-body text-[10px] mt-0.5" style={{ color: INK_2 }}>{widthFt} ft</div>
          </button>
          {widthOpen && (
            <div className="absolute left-0 right-0 bottom-full mb-2 z-[600] rounded-xl p-2 flex items-center gap-2 justify-center" style={{ backgroundColor: PAPER, border: `1px solid ${HAIR}`, boxShadow: '0 8px 24px -8px rgba(21,29,20,.4)' }}>
              <button onClick={() => setWidthFt((w) => Math.max(1, w - 1))} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ border: `1px solid ${HAIR}`, color: FOREST }}><Minus size={15} /></button>
              <input type="number" min="1" value={widthFt} onChange={(e) => setWidthFt(Math.max(1, Number(e.target.value) || 1))} className="w-14 text-center font-display text-lg font-bold bg-transparent outline-none" style={{ color: FOREST }} />
              <button onClick={() => setWidthFt((w) => w + 1)} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ border: `1px solid ${HAIR}`, color: FOREST }}><Plus size={15} /></button>
            </div>
          )}
        </div>
        {!running ? (
          <button onClick={start} className="rounded-xl py-2.5 px-2 text-center text-white" style={{ backgroundColor: FERN }}>
            <div className="font-body text-sm font-bold flex items-center justify-center gap-1"><Play size={14} /> {trackRef.current.length ? 'Resume' : 'Start'}</div>
            <div className="font-body text-[10px] mt-0.5" style={{ opacity: 0.8 }}>{trackRef.current.length ? 'paused' : 'ready'}</div>
          </button>
        ) : (
          <button onClick={pause} className="rounded-xl py-2.5 px-2 text-center" style={{ backgroundColor: GOLD, color: FOREST }}>
            <div className="font-body text-sm font-bold flex items-center justify-center gap-1"><Pause size={14} /> Pause</div>
            <div className="font-body text-[10px] mt-0.5" style={{ opacity: 0.75 }}>tracking live · {mmss(stats.secs)}</div>
          </button>
        )}
      </div>

      {/* Secondary controls */}
      <div className="flex items-center gap-2 mt-2">
        <button onClick={stop} disabled={!running && !trackRef.current.length} className="flex-1 font-body text-xs font-bold py-2 rounded-lg flex items-center justify-center gap-1.5 disabled:opacity-40" style={{ backgroundColor: PAPER, color: FOREST, border: `1px solid ${HAIR}` }}><Square size={13} /> Stop</button>
        <button onClick={recenter} className="flex-1 font-body text-xs font-bold py-2 rounded-lg flex items-center justify-center gap-1.5" style={{ backgroundColor: PAPER, color: FOREST, border: `1px solid ${HAIR}` }}><Crosshair size={13} /> Recenter</button>
        <button onClick={clearAll} disabled={!trackRef.current.length} className="flex-1 font-body text-xs font-bold py-2 rounded-lg flex items-center justify-center gap-1.5 disabled:opacity-40" style={{ backgroundColor: PAPER, color: RED, border: `1px solid ${HAIR}` }}><Trash2 size={13} /> Clear</button>
      </div>

      {/* Legend + honest note */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 justify-center">
        <span className="flex items-center gap-1.5 font-body text-[11px] font-semibold" style={{ color: INK_2 }}><span style={{ width: 16, height: 11, borderRadius: 3, background: COVER, outline: `1px solid ${FERN}55` }} /> Covered</span>
        <span className="flex items-center gap-1.5 font-body text-[11px] font-semibold" style={{ color: INK_2 }}><span style={{ width: 16, height: 11, borderRadius: 3, background: '#F6E3E0', outline: `1px dashed ${RED}` }} /> Missed strip</span>
        <span className="flex items-center gap-1.5 font-body text-[11px] font-semibold" style={{ color: INK_2 }}><span style={{ width: 16, height: 0, borderTop: `3px dashed ${GOLD}` }} /> Guidance line</span>
      </div>
      <p className="font-body text-[11px] mt-2 text-center leading-relaxed" style={{ color: INK_3 }}>
        Phone GPS is ~10–15 ft, so the painted band shows where you’ve been, not sub-inch guidance. Keep the phone mounted with a clear view of the sky and on cab power.
      </p>
    </div>
  )
}
