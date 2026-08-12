'use client'

// ── Course Map ───────────────────────────────────────────────────────────────
// A satellite map of the course with the irrigation as-built laid over it, your
// live GPS location, and a field-calibration flow: walk to known heads, tap the
// head on the drawing, stand your phone on it and capture GPS. A handful of
// those pairs pins the whole drawing onto the ground (see lib/geocalib.js).
//
// Leaflet is loaded in the browser only (it needs `window`). The overlay image
// is served behind the login via /api/course-overlay.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import { MapPin, Crosshair, Navigation, Layers, Check, X, Trash2, Loader2, Plus, Camera, Eye, EyeOff, Droplet, Compass, Zap, List, Stamp } from 'lucide-react'
import * as db from '@/lib/db'
import ArcTool from '@/components/ArcTool'
import { fitSimilarity, fitResiduals, imageCornerLatLngs, metresToFeet, pixelToLatLng } from '@/lib/geocalib'
import { SYMBOL_GROUPS, PIPE_ITEMS, symbolById, symbolColor, symbolSvg, isPartCircle } from '@/lib/irrigationSymbols'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#C9A84C'

// The overlay image's pixel size (from the rasterised PDF) and where to fetch it.
const IMAGE_W = 5017
const IMAGE_H = 7047
const OVERLAY_URL = '/api/course-overlay'
// Fallback map centre if the club location isn't set — Congressional CC.
const FALLBACK = { lat: 38.9803, lng: -77.1636 }
const SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const SAT_ATTR = 'Imagery © Esri, Maxar, Earthstar Geographics'

// Editable irrigation objects — kinds + status colours (crisp vector markers).
const KINDS = [['head', 'Head'], ['valve', 'Valve'], ['quick_coupler', 'Quick coupler'], ['controller', 'Controller'], ['other', 'Other']]
const KIND_LABEL = Object.fromEntries(KINDS)
const STATUS = { ok: { label: 'Working', color: '#2563EB' }, repair: { label: 'Needs repair', color: '#DC2626' }, replaced: { label: 'Replaced', color: '#6B7280' } }
const featureColor = (f) => (STATUS[f.status]?.color || '#2563EB')

// Pipe size classes (from the as-built legend) → draw order (thin first, mains
// on top) and line weight. Bigger pipe = heavier line, so the mainline reads
// clearly over the dense laterals.
const PIPE_RANK = { '1.5" poly': 0, '2" HDPE': 1, '3" HDPE': 2, '4" HDPE': 3, '6" HDPE': 4, '8" HDPE': 5, '10"+ HDPE': 6, '14"+ HDPE': 7, '16" HDPE': 8 }
const pipeWeight = (cls) => [1.6, 1.8, 2.4, 3.0, 3.8, 4.6, 5.4, 6.2, 7.0][PIPE_RANK[cls] ?? 1]
const pipeOpacity = (cls) => ((PIPE_RANK[cls] ?? 1) >= 4 ? 0.95 : 0.6)
// Legend rows for the on-map key (only the classes that actually appear are shown).
const PIPE_LEGEND = [
  ['1.5" poly', '#e83bd0'], ['2" HDPE', '#1e1e1e'], ['3" HDPE', '#12b2c6'], ['4" HDPE', '#57a0ea'],
  ['6" HDPE', '#2170e0'], ['8" HDPE', '#1a3fd0'], ['10"+ HDPE', '#0e2aa8'], ['14"+ HDPE', '#3d13a2'], ['16" HDPE', '#5a12c4'],
]
// Control-wire loops — one colour per satellite/controller (from the blue as-built).
const WIRE_LEGEND = [
  ['#e11d1d', 'Wire loop A'], ['#1a8cff', 'Wire loop B'], ['#b0a800', 'Wire loop C'], ['#c824ff', 'Wire loop D'], ['#ff00bf', 'Wire loop E'],
]

// Compress a photo to a small data URL (same idea as the scouting log) so it
// stores inline without a separate file service.
function compressPhoto(file, max = 1100, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      resolve(c.toDataURL('image/jpeg', quality))
    }
    img.onerror = reject
    const r = new FileReader()
    r.onload = () => { img.src = r.result }
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

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
  const [opacity, setOpacity] = useState(0) // PDF raster overlay off by default — the vectors are the map now
  const [mode, setMode] = useState('map')        // 'map' | 'calibrate'
  const [gps, setGps] = useState(null)           // live location
  const [heading, setHeading] = useState(null)   // phone compass heading (deg)
  const [headingOn, setHeadingOn] = useState(false)
  const headingRef = useRef(null)
  const [onTarget, setOnTarget] = useState(false) // standing on the selected object
  const targetRingRef = useRef(null)
  const [pending, setPending] = useState(null)   // {px,py} tapped on drawing
  const [capturing, setCapturing] = useState(null) // {n, acc} while averaging
  const [msg, setMsg] = useState(null)
  const [saving, setSaving] = useState(false)

  // Editable irrigation objects
  const [features, setFeatures] = useState([])
  const [showFeatures, setShowFeatures] = useState(true)
  const [labelsOn, setLabelsOn] = useState(true) // show head numbers when zoomed in
  const labelLayerRef = useRef(null)
  const shapeLayerRef = useRef(null)
  const [addMode, setAddMode] = useState(false)
  const [moveMode, setMoveMode] = useState(false) // relocate the selected head by tapping
  const [selected, setSelected] = useState(null) // feature being edited
  const [confirmDel, setConfirmDel] = useState(false)
  const [arcOpen, setArcOpen] = useState(false)
  const [navMode, setNavMode] = useState(false) // walking to the selected object (modal hidden)
  const [importing, setImporting] = useState(null) // {done,total} while bulk-importing
  const moveRef = useRef(false)
  useEffect(() => { moveRef.current = moveMode }, [moveMode])
  // Symbol "stamp" palette: pick a legend symbol, then tap the map to drop it.
  const [stampSym, setStampSym] = useState(null) // symbol id being stamped
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteMode, setPaletteMode] = useState('stamp') // 'stamp' new, or 'assign' to selected
  const [legendFull, setLegendFull] = useState(false) // full PDF-style legend modal
  const stampRef = useRef(null)
  useEffect(() => { stampRef.current = stampSym }, [stampSym])

  // Vector pipe network (our own crisp overlay, pulled from the PDF)
  const [pipes, setPipes] = useState(null)
  const [showPipes, setShowPipes] = useState(true)
  // Control-wire loops (dotted colour paths from the blue as-built)
  const [wires, setWires] = useState(null)
  const [showWires, setShowWires] = useState(false)
  // Calibration method: 'photo' = line the drawing up on the satellite photo
  // (inch-accurate, no GPS); 'gps' = stand on each head and capture GPS.
  const [calMode, setCalMode] = useState('photo')

  // On-screen diagnostics (no console needed): container size + tile status
  const [diag, setDiag] = useState({ w: 0, h: 0, tiles: 'waiting', err: 0 })
  // Definite pixel height for the map (calc(100vh) wasn't resolving in the layout).
  const [vh, setVh] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 800))
  useEffect(() => {
    const onR = () => setVh(window.innerHeight)
    window.addEventListener('resize', onR)
    return () => window.removeEventListener('resize', onR)
  }, [])
  const mapPxH = Math.max(460, vh - 140)

  // Callback ref: fires with the real DOM node whenever the map div mounts (or
  // remounts). Drives map creation off the actually-attached node, so Leaflet is
  // never bound to a stale/detached element (the 0x0 blank-map cause).
  const [mapNode, setMapNode] = useState(null)
  const mapCbRef = useCallback((n) => setMapNode(n), [])

  const LRef = useRef(null)
  const pipeLayerRef = useRef(null)
  const wireLayerRef = useRef(null)
  const featLayerRef = useRef(null)
  const placeRef = useRef(null)
  const addModeRef = useRef(false)
  useEffect(() => { addModeRef.current = addMode }, [addMode])
  const mainRef = useRef(null), mainMap = useRef(null), overlayRef = useRef(null), locRef = useRef(null), accRef = useRef(null)
  const drawRef = useRef(null), drawMap = useRef(null), drawPinRef = useRef(null), drawGcpRef = useRef(null)
  // Satellite pairing map (photo calibration) + a ref so its click handler reads
  // the live pending pixel without re-creating the map.
  const pairRef = useRef(null), pairMap = useRef(null), pairGcpRef = useRef(null)
  const pendingRef = useRef(null)

  // Fitted transform + how good the fit is — recomputed whenever points change.
  const transform = useMemo(() => fitSimilarity(points, IMAGE_H), [points])
  const fit = useMemo(() => fitResiduals(points, transform, IMAGE_H), [points, transform])

  // ── Load Leaflet (browser only) + the rotated-overlay plugin ────────────────
  // The plugin is loaded best-effort: if it fails, the base map, pipes and heads
  // still work (only the rotated raster overlay would be missing), and we never
  // get stuck on the loading screen.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const mod = await import('leaflet')
        const L = mod.default || mod
        window.L = L // the rotated plugin augments the global L
        try { await import('leaflet-imageoverlay-rotated') } catch (e) { console.error('rotated-overlay plugin failed to load', e) }
        if (!cancelled) { LRef.current = L; setReady(true) }
      } catch (e) { console.error('Leaflet failed to load', e) }
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

  // ── Phone compass heading (for the direction arrow on the you-are-here dot) ──
  useEffect(() => {
    if (!headingOn || typeof window === 'undefined') return
    const onOrient = (e) => {
      let h = null
      if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) h = e.webkitCompassHeading
      else if (typeof e.alpha === 'number') h = (360 - e.alpha) % 360
      if (h == null) return
      // Only push a state change on a meaningful move, so we don't re-render 60×/s.
      if (headingRef.current == null || Math.abs(((h - headingRef.current + 540) % 360) - 180) > 2) { headingRef.current = h; setHeading(h) }
    }
    window.addEventListener('deviceorientationabsolute', onOrient, true)
    window.addEventListener('deviceorientation', onOrient, true)
    return () => { window.removeEventListener('deviceorientationabsolute', onOrient, true); window.removeEventListener('deviceorientation', onOrient, true) }
  }, [headingOn])

  const enableHeading = async () => {
    if (headingOn) return
    try {
      const DOE = typeof window !== 'undefined' ? window.DeviceOrientationEvent : null
      if (DOE && typeof DOE.requestPermission === 'function') {
        const r = await DOE.requestPermission()
        if (r !== 'granted') return
      }
      setHeadingOn(true)
    } catch { /* no compass */ }
  }

  // Load the editable irrigation objects
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try { const f = await db.fetchIrrigation(); if (!cancelled) setFeatures(f) } catch (e) { console.error(e) }
    })()
    return () => { cancelled = true }
  }, [])

  // Load the vector pipe network (behind the login)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try { const res = await fetch('/api/course-pipes', { cache: 'no-store' }); if (res.ok) { const j = await res.json(); if (!cancelled) setPipes(j) } } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [])

  // Load the control-wire loops (behind the login)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try { const res = await fetch('/api/course-wires', { cache: 'no-store' }); if (res.ok) { const j = await res.json(); if (!cancelled) setWires(j) } } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [])

  const center = location?.lat != null ? [location.lat, location.lng] : [FALLBACK.lat, FALLBACK.lng]

  // ── Main satellite map (created once per entry into map mode) ───────────────
  const [mapTick, setMapTick] = useState(0)
  const [mapZoom, setMapZoom] = useState(17)   // drives marker size + when labels show
  const [viewTick, setViewTick] = useState(0)  // bumps on pan/zoom so labels re-fit to view
  useEffect(() => {
    if (!ready || mode !== 'map' || !mapNode) return
    const L = LRef.current
    const el = mapNode
    let ro = null, cancelled = false
    const c0 = (Number.isFinite(center[0]) && Number.isFinite(center[1])) ? center : [FALLBACK.lat, FALLBACK.lng]
    const map = L.map(el, { center: c0, zoom: 17, zoomControl: true, attributionControl: true, preferCanvas: true })
    map.attributionControl.setPrefix('')
    map.on('zoomend', () => setMapZoom(map.getZoom()))
    map.on('moveend', () => setViewTick((t) => t + 1))
    const tl = L.tileLayer(SAT_URL, { maxZoom: 22, maxNativeZoom: 19, attribution: SAT_ATTR, crossOrigin: true })
    let errs = 0, loaded = false
    tl.on('load', () => { loaded = true; setDiag((d) => ({ ...d, tiles: 'ok' })) })
    tl.on('tileerror', () => { errs += 1; setDiag((d) => ({ ...d, err: errs, tiles: 'error' }))
      if (errs === 6 && !loaded) { try { map.removeLayer(tl); L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map); setDiag((d) => ({ ...d, tiles: 'osm-fallback' })) } catch { /* ignore */ } } })
    tl.addTo(map)
    mainMap.current = map
    // Repeatedly re-measure the container and resize the map — and report the live
    // size in the diagnostic badge so we can see it settle.
    const inval = () => { try { map.invalidateSize(false); setDiag((d) => ({ ...d, w: el.clientWidth, h: el.clientHeight })) } catch { /* ignore */ } }
    map.whenReady(() => { inval(); setMapTick((t) => t + 1) })
    ;[0, 100, 300, 700, 1400, 2500].forEach((t) => setTimeout(() => { if (!cancelled) inval() }, t))
    try { ro = new ResizeObserver(inval); ro.observe(el) } catch { /* ignore */ }

    return () => { cancelled = true; if (ro) ro.disconnect(); map.remove(); mainMap.current = null; overlayRef.current = null; locRef.current = null; accRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, mode, mapNode])

  // Overlay layer — added/updated whenever the calibration is available (also
  // re-runs once the saved calibration loads after the map is built).
  useEffect(() => {
    const L = LRef.current, map = mainMap.current
    if (!L || !map || mode !== 'map') return
    if (overlayRef.current) { overlayRef.current.remove(); overlayRef.current = null }
    if (!transform) return
    const c = imageCornerLatLngs(transform, IMAGE_W, IMAGE_H)
    const bottomRight = [c.topRight[0] + (c.bottomLeft[0] - c.topLeft[0]), c.topRight[1] + (c.bottomLeft[1] - c.topLeft[1])]
    // The rotated overlay needs the plugin; if it didn't load, skip it (pipes
    // still give a crisp layer) but still frame the map on the course.
    if (typeof L.imageOverlay?.rotated === 'function') {
      try {
        const ov = L.imageOverlay.rotated(OVERLAY_URL, c.topLeft, c.topRight, c.bottomLeft, { opacity, interactive: false })
        ov.addTo(map)
        overlayRef.current = ov
      } catch (e) { console.error('overlay place failed', e) }
    }
    try { map.fitBounds([c.topLeft, c.topRight, c.bottomLeft, bottomRight], { padding: [20, 20] }) } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transform, mode, mapTick])

  // Keep overlay opacity live
  useEffect(() => { if (overlayRef.current) overlayRef.current.setOpacity(opacity) }, [opacity])

  // Live location marker — a blue dot with a direction arrow (phone compass) so
  // you can tell which way you're facing and walk the right way.
  const locIcon = (h) => {
    const arrow = h == null ? '' : `<div style="position:absolute;inset:0;transform:rotate(${Math.round(h)}deg)"><div style="position:absolute;top:-3px;left:50%;margin-left:-8px;width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:14px solid #2563EB;filter:drop-shadow(0 0 1px #fff)"></div></div>`
    return LRef.current.divIcon({ className: '', iconSize: [44, 44], iconAnchor: [22, 22], html: `<div style="position:relative;width:44px;height:44px">${arrow}<div style="position:absolute;top:22px;left:22px;transform:translate(-50%,-50%);width:18px;height:18px;border-radius:50%;background:#2563EB;border:3px solid #fff;box-shadow:0 0 5px rgba(0,0,0,.45)"></div></div>` })
  }
  useEffect(() => {
    const L = LRef.current, map = mainMap.current
    if (!L || !map || !gps) return
    const ll = [gps.lat, gps.lng]
    if (!locRef.current) {
      accRef.current = L.circle(ll, { radius: gps.acc || 8, color: '#2563EB', weight: 1, fillColor: '#2563EB', fillOpacity: 0.12 }).addTo(map)
      locRef.current = L.marker(ll, { icon: locIcon(heading), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map)
    } else {
      locRef.current.setLatLng(ll).setIcon(locIcon(heading)); accRef.current.setLatLng(ll).setRadius(gps.acc || 8)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gps, heading, mode, mapTick])

  // "On target" — when you're standing on the selected object, ring it green so
  // you know you've arrived. Uses the live GPS distance to the selected feature.
  useEffect(() => {
    const L = LRef.current, map = mainMap.current
    if (!L || !map) return
    if (targetRingRef.current) { targetRingRef.current.remove(); targetRingRef.current = null }
    if (!gps || !selected || !Number.isFinite(selected.lat)) { if (onTarget) setOnTarget(false); return }
    let dist = Infinity
    try { dist = map.distance([gps.lat, gps.lng], [selected.lat, selected.lng]) } catch { /* ignore */ }
    const near = dist <= 3 // metres (~10 ft)
    if (near !== onTarget) setOnTarget(near)
    if (near) {
      targetRingRef.current = L.circleMarker([selected.lat, selected.lng], { radius: Math.max(12, (mapZoom - 13) * 2.4), color: '#16A34A', weight: 4, fillColor: '#22C55E', fillOpacity: 0.25 }).addTo(map)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gps, selected, mode, mapTick, mapZoom])

  // Tap-to-place a new head when in Add mode (reads a ref to avoid stale state)
  useEffect(() => {
    const map = mainMap.current
    if (!map) return
    const handler = (e) => {
      if (moveRef.current) { placeRef.current?.(e.latlng, 'relocate'); return }
      if (stampRef.current) { placeRef.current?.(e.latlng, 'manual', stampRef.current); return }
      if (addModeRef.current) placeRef.current?.(e.latlng)
    }
    map.on('click', handler)
    return () => { map.off('click', handler) }
  }, [mapTick])

  // Draw the vector pipe network — crisp at any zoom, coloured by pipe size,
  // placed with the same calibration transform as the raster overlay.
  useEffect(() => {
    const L = LRef.current, map = mainMap.current
    if (!L || !map || mode !== 'map') return
    if (pipeLayerRef.current) { pipeLayerRef.current.remove(); pipeLayerRef.current = null }
    if (!transform || !pipes?.lines?.length || !showPipes) return
    const H = pipes.imageH || IMAGE_H
    const group = L.layerGroup()
    try {
      // Group every run by pipe size and draw each size as ONE multi-polyline.
      // ~9 layers instead of ~19k keeps the map fast (thousands of separate
      // layers choke Leaflet, which also stalled the heads drawn afterwards).
      const byClass = new Map()
      pipes.lines.forEach((ln) => {
        const latlngs = ln.p
          .map(([px, py]) => { const { lat, lng } = pixelToLatLng(px, py, transform, H); return [lat, lng] })
          .filter(([la, lo]) => Number.isFinite(la) && Number.isFinite(lo))
        if (latlngs.length < 2) return
        const key = ln.cls || '2" HDPE'
        if (!byClass.has(key)) byClass.set(key, { color: ln.c, segs: [] })
        byClass.get(key).segs.push(latlngs)
      })
      // Smallest pipe first so the bigger mains sit crisply on top.
      const keys = Array.from(byClass.keys()).sort((a, b) => (PIPE_RANK[a] ?? 1) - (PIPE_RANK[b] ?? 1))
      keys.forEach((key) => {
        const { color, segs } = byClass.get(key)
        L.polyline(segs, { color, weight: pipeWeight(key), opacity: pipeOpacity(key), interactive: false }).addTo(group)
      })
      group.addTo(map)
      pipeLayerRef.current = group
    } catch (e) { console.error('pipe render failed', e) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipes, transform, mode, mapTick, showPipes])

  // Draw the control-wire loops as small colour dots (reproduces the dotted
  // wire paths), one colour per satellite/controller. Canvas keeps ~19k dots fast.
  useEffect(() => {
    const L = LRef.current, map = mainMap.current
    if (!L || !map || mode !== 'map') return
    if (wireLayerRef.current) { wireLayerRef.current.remove(); wireLayerRef.current = null }
    if (!transform || !wires?.colors || !showWires) return
    const H = wires.imageH || IMAGE_H
    const group = L.layerGroup()
    try {
      Object.entries(wires.colors).forEach(([color, pts]) => {
        pts.forEach(([px, py]) => {
          const { lat, lng } = pixelToLatLng(px, py, transform, H)
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
          L.circleMarker([lat, lng], { radius: 2.4, color, weight: 0, fillColor: color, fillOpacity: 0.9, interactive: false }).addTo(group)
        })
      })
      group.addTo(map)
      wireLayerRef.current = group
    } catch (e) { console.error('wire render failed', e) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wires, transform, mode, mapTick, showWires])

  // Draw the editable irrigation markers as fast canvas circles (handles the
  // thousands of heads smoothly). Tap one to edit; move via the edit panel.
  useEffect(() => {
    const L = LRef.current, map = mainMap.current
    if (!L || !map || mode !== 'map') return
    if (featLayerRef.current) { featLayerRef.current.remove(); featLayerRef.current = null }
    if (!showFeatures) return
    const group = L.layerGroup().addTo(map)
    const sel = selected?.id
    try {
      // Grow the dots as you zoom in so they read like the as-built (but stay
      // visible at the course-overview zoom too).
      const headR = Math.max(3.5, (mapZoom - 13) * 1.7)
      features.forEach((f) => {
        if (!Number.isFinite(f.lat) || !Number.isFinite(f.lng)) return
        const sym = f.symbol ? symbolById(f.symbol) : null
        const fill = sym ? sym.fill : featureColor(f)
        // Repair/replaced get a coloured ring so status still reads at a glance.
        const statusRing = f.status === 'repair' ? '#DC2626' : f.status === 'replaced' ? '#6B7280' : null
        const isValve = f.kind !== 'head'
        const cm = L.circleMarker([f.lat, f.lng], {
          radius: isValve ? headR * 1.35 : headR,
          color: f.id === sel ? GOLD : (statusRing || (sym ? sym.stroke : '#ffffff')),
          weight: f.id === sel ? 3 : (statusRing ? 2.4 : 1.4),
          fillColor: fill,
          fillOpacity: 0.95,
        })
        cm.on('click', (e) => { if (e.originalEvent) e.originalEvent.stopPropagation?.(); setSelected(f) })
        cm.addTo(group)
      })
    } catch (e) { console.error('feature render failed', e) }
    featLayerRef.current = group
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, showFeatures, mode, mapTick, selected, mapZoom])

  // Exact as-built shapes (triangles for quick couplers, squares/half-circles,
  // etc.) drawn over the dots — but only for what's on screen when zoomed in, so
  // the thousands of markers stay fast. Uses the assigned symbol, else a sensible
  // default per kind so couplers/valves still read as their real shape.
  useEffect(() => {
    const L = LRef.current, map = mainMap.current
    if (!L || !map || mode !== 'map') return
    if (shapeLayerRef.current) { shapeLayerRef.current.remove(); shapeLayerRef.current = null }
    if (!showFeatures || mapZoom < 18) return
    const featSym = (f) => {
      if (f.symbol) return symbolById(f.symbol)
      if (f.kind === 'quick_coupler') return symbolById('qc-1')
      if (f.kind === 'valve') return symbolById('ev-2')
      if (f.kind === 'controller') return symbolById('ground-assy')
      return null // plain heads already read as coloured circles
    }
    let bounds
    try { bounds = map.getBounds().pad(0.1) } catch { return }
    const inView = features.filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lng) && bounds.contains([f.lat, f.lng]) && featSym(f))
    if (inView.length === 0 || inView.length > 600) return
    const px = Math.round(Math.max(14, (mapZoom - 13) * 4.4))
    const group = L.layerGroup()
    inView.forEach((f) => {
      const s = featSym(f)
      const m = L.marker([f.lat, f.lng], {
        icon: L.divIcon({ className: '', html: symbolSvg(s, px, f.arcStart || 0), iconSize: [px, px], iconAnchor: [px / 2, px / 2] }),
        interactive: true, keyboard: false,
      })
      m.on('click', (e) => { if (e.originalEvent) e.originalEvent.stopPropagation?.(); setSelected(f) })
      m.addTo(group)
    })
    group.addTo(map)
    shapeLayerRef.current = group
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, showFeatures, mode, mapTick, mapZoom, viewTick])

  // Head-number labels (R25, G3…). Only when zoomed in and only for what's on
  // screen, so 2,000+ labels never bog the map down. Rendered as light divIcons.
  useEffect(() => {
    const L = LRef.current, map = mainMap.current
    if (!L || !map || mode !== 'map') return
    if (labelLayerRef.current) { labelLayerRef.current.remove(); labelLayerRef.current = null }
    if (!labelsOn || !showFeatures || mapZoom < 18) return
    let bounds
    try { bounds = map.getBounds().pad(0.1) } catch { return }
    const inView = features.filter((f) => f.label && Number.isFinite(f.lat) && Number.isFinite(f.lng) && bounds.contains([f.lat, f.lng]))
    if (inView.length === 0 || inView.length > 600) return // too many = zoom in more
    const group = L.layerGroup()
    const fs = Math.round(Math.max(9, (mapZoom - 15) * 4))
    inView.forEach((f) => {
      const m = L.marker([f.lat, f.lng], {
        interactive: false, keyboard: false,
        icon: L.divIcon({ className: '', html: `<div style="white-space:nowrap;font:700 ${fs}px Arial,sans-serif;color:#fff;text-shadow:0 0 2px #000,0 0 2px #000,1px 1px 2px #000">${f.label}</div>`, iconSize: [0, 0], iconAnchor: [-4, fs / 2] }),
      })
      m.addTo(group)
    })
    group.addTo(map)
    labelLayerRef.current = group
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, showFeatures, labelsOn, mode, mapTick, mapZoom, viewTick])

  // Place a new feature — or, in move mode, relocate the selected one — from a
  // map tap or from GPS.
  placeRef.current = async (latlng, source = 'manual', symId = null) => {
    if (!manage) return
    if (source === 'relocate' && selected) {
      try { const up = await db.updateIrrigationFeature(selected.id, { lat: latlng.lat, lng: latlng.lng, source: 'manual' }); setFeatures((prev) => prev.map((x) => (x.id === up.id ? up : x))); setSelected(up); setMoveMode(false) }
      catch (e) { console.error(e); setMsg('Could not move that — try again.') }
      return
    }
    try {
      const sym = symId ? symbolById(symId) : null
      const f = await db.addIrrigationFeature({ kind: sym?.kind || 'head', symbol: symId || '', lat: latlng.lat, lng: latlng.lng, status: 'ok', source })
      setFeatures((prev) => [...prev, f])
      if (symId) {
        // Stamping: keep the tool armed so several of the same can be dropped fast.
        setMsg(`Placed ${sym?.label || 'symbol'} — tap again to place another, or Done to stop.`)
      } else {
        setSelected(f)
        setAddMode(false)
      }
    } catch (e) { console.error(e); setMsg('Could not add that — is the phase21 table set up?') }
  }
  const addAtGps = () => { if (gps) placeRef.current({ lat: gps.lat, lng: gps.lng }, 'gps'); else setMsg('No GPS fix yet.') }

  // One-time: import every head/valve from the as-built, placed with the
  // calibration transform. Turns the 2,600+ symbols into editable objects.
  async function importFromAsBuilt() {
    if (!manage) return
    if (!transform) { setMsg('Calibrate the map first, then import.'); return }
    try {
      const res = await fetch('/api/course-heads', { cache: 'no-store' })
      if (!res.ok) throw new Error('no heads file')
      const j = await res.json()
      const H = j.imageH || IMAGE_H
      const rows = (j.heads || []).map((h) => {
        const { lat, lng } = pixelToLatLng(h.x, h.y, transform, H)
        return { kind: h.k || 'head', lat, lng, status: 'ok', source: 'import', label: h.label || '', symbol: h.symbol || '' }
      }).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng))
      if (rows.length === 0) { setMsg('No heads found to import.'); return }
      setImporting({ done: 0, total: rows.length })
      // Refresh cleanly: drop the previously auto-imported points (keeps any you
      // placed or hand-edited, which are marked 'manual'), then insert fresh.
      await db.clearImportedIrrigation()
      let done = 0
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500)
        await db.addIrrigationFeatures(chunk)
        done += chunk.length; setImporting({ done, total: rows.length })
      }
      const fresh = await db.fetchIrrigation(); setFeatures(fresh)
      setMsg(`Imported ${rows.length} objects from the as-built (${(j.heads || []).filter((h) => h.k === 'valve').length} valves). Nudge any that are off, and re-type as needed.`)
    } catch (e) { console.error(e); setMsg('Import failed — make sure phase21.sql is run and the map is calibrated.') }
    finally { setImporting(null) }
  }

  async function saveSelected(patch) {
    if (!selected) return
    try {
      const up = await db.updateIrrigationFeature(selected.id, { ...patch, source: 'manual' })
      setFeatures((prev) => prev.map((x) => (x.id === up.id ? up : x)))
      setSelected(up)
    } catch (e) { console.error(e); setMsg('Could not save changes.') }
  }
  async function deleteSelected() {
    if (!selected) return
    try { await db.deleteIrrigationFeature(selected.id); setFeatures((prev) => prev.filter((x) => x.id !== selected.id)); setSelected(null) }
    catch (e) { console.error(e); setMsg('Could not delete.') }
  }
  async function onPhoto(file) {
    if (!file) return
    try { const dataUrl = await compressPhoto(file); await saveSelected({ photo: dataUrl }) } catch { setMsg('Could not read that photo.') }
  }
  // Move the selected object onto where you're standing — the calibration-style
  // capture: stand on the head, tap, it averages GPS for a few seconds and moves.
  const [movingGps, setMovingGps] = useState(null)
  async function moveSelectedToGps() {
    if (!selected) return
    setMovingGps({ n: 0, acc: null })
    try {
      const g = await captureAveragedGps({ seconds: 6, onTick: (n, acc) => setMovingGps({ n, acc: Math.round(acc || 0) }) })
      await saveSelected({ lat: g.lat, lng: g.lng })
      setMsg(`Moved onto your spot (±${g.acc} ft-ish, ${g.n} reads).`)
    } catch (e) { setMsg(e.message || 'GPS capture failed.') }
    finally { setMovingGps(null) }
  }
  // Aim a part-circle head — rotate which way it faces (stored in arcStart).
  const rotateSelected = (delta) => { if (selected) saveSelected({ arcStart: (((selected.arcStart || 0) + delta) % 360 + 360) % 360 }) }

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
    ;[60, 200, 500].forEach((t) => setTimeout(() => { try { map.invalidateSize() } catch { /* ignore */ } }, t))
    return () => { map.remove(); drawMap.current = null; drawPinRef.current = null; drawGcpRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, mode, calMode])

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

  // ── Satellite pairing map (photo calibration) ───────────────────────────────
  // A live satellite map you tap to say "the head I just marked on the drawing
  // is HERE on the ground." No GPS — registers the drawing to the aerial photo.
  useEffect(() => {
    if (!ready || mode !== 'calibrate' || calMode !== 'photo' || !pairRef.current) return
    const L = LRef.current
    // Start centred on the course: use the current fit if we have one, else the club.
    let center = [FALLBACK.lat, FALLBACK.lng]
    if (transform) { const c = imageCornerLatLngs(transform, IMAGE_W, IMAGE_H); center = [(c.topLeft[0] + c.bottomLeft[0]) / 2, (c.topLeft[1] + c.topRight[1]) / 2] }
    const map = L.map(pairRef.current, { center, zoom: 18, zoomControl: true, attributionControl: false, preferCanvas: true })
    L.tileLayer(SAT_URL, { maxZoom: 22, maxNativeZoom: 19, crossOrigin: true }).addTo(map)
    map.on('click', (e) => addPhotoPoint(e.latlng))
    pairMap.current = map
    ;[60, 200, 500, 1000].forEach((t) => setTimeout(() => { try { map.invalidateSize() } catch { /* ignore */ } }, t))
    return () => { map.remove(); pairMap.current = null; pairGcpRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, mode, calMode])

  // Show the placed points on the satellite map (numbered), so you can see the
  // pairs building up and spot any that landed in the wrong place.
  useEffect(() => {
    const L = LRef.current, map = pairMap.current
    if (!L || !map) return
    if (pairGcpRef.current) pairGcpRef.current.forEach((m) => m.remove())
    pairGcpRef.current = points.filter((p) => p.lat != null).map((p, i) => L.marker([p.lat, p.lng], {
      icon: L.divIcon({ className: '', html: `<div style="background:${FERN};color:#fff;border:2px solid #fff;border-radius:9999px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font:700 11px sans-serif;box-shadow:0 1px 3px rgba(0,0,0,.4)">${i + 1}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
    }).addTo(map))
  }, [points, mode, calMode])

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

  // Keep a ref of the pending pixel so the satellite map's click handler (bound
  // once) always sees the latest tapped head.
  useEffect(() => { pendingRef.current = pending }, [pending])

  // Photo pairing: the head is already marked on the drawing (pending px,py);
  // this records where the same head sits on the satellite photo (lat,lng).
  const addPhotoPoint = (latlng) => {
    const pend = pendingRef.current
    if (!pend) { setMsg('First tap the head on the drawing (left), then tap the same head on the photo.'); return }
    setPoints((prev) => [...prev, { px: pend.px, py: pend.py, lat: latlng.lat, lng: latlng.lng }])
    setPending(null)
    setMsg(`Point ${points.length + 1} placed on the photo.`)
  }

  const removePoint = (i) => setPoints((prev) => prev.filter((_, k) => k !== i))
  const clearPoints = () => { if (typeof window === 'undefined' || window.confirm('Remove all calibration points and start fresh?')) { setPoints([]); setPending(null) } }

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
  // Straight-line distance (ft) from you to the object you're walking to.
  const navDistFt = (gps && selected && Number.isFinite(selected.lat)) ? (() => {
    const Rft = 20925524.9, toRad = (d) => d * Math.PI / 180
    const dLat = toRad(selected.lat - gps.lat), dLng = toRad(selected.lng - gps.lng)
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(gps.lat)) * Math.cos(toRad(selected.lat)) * Math.sin(dLng / 2) ** 2
    return Math.round(2 * Rft * Math.asin(Math.min(1, Math.sqrt(a))))
  })() : null
  const recenter = () => { enableHeading(); if (mainMap.current && gps) mainMap.current.setView([gps.lat, gps.lng], 19) }

  // ── UI ──────────────────────────────────────────────────────────────────────
  return (
    <div className="w-full px-3 sm:px-4 pt-3 pb-4">
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
          {/* Banners live in one always-present container so the map wrapper below
              is never remounted (a remount detaches Leaflet → blank 0x0 map). */}
          <div className="space-y-3 empty:hidden">
          {navMode && selected && (
            <div className="rounded-xl px-4 py-2.5 font-body text-[13px] flex items-center justify-between gap-2" style={onTarget ? { backgroundColor: '#DCFCE7', border: '1px solid #86EFAC', color: '#166534' } : { backgroundColor: '#EAF2FB', border: '1px solid #BBD3F0', color: '#1E3A5F' }}>
              <span className="flex items-center gap-2 min-w-0">
                <Navigation size={15} className="shrink-0" />
                <span className="truncate">{onTarget
                  ? <><b>You&apos;re on {selected.label || KIND_LABEL[selected.kind]}!</b> Green ring = you&apos;re within ~10 ft.</>
                  : <><b>Walking to {selected.label || KIND_LABEL[selected.kind]}</b>{navDistFt != null ? ` · ${navDistFt} ft away` : ''} — follow the blue arrow.</>}</span>
              </span>
              <span className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => setNavMode(false)} className="font-body text-[11px] font-bold px-2 py-1 rounded-full" style={{ backgroundColor: '#fff', color: FOREST }}>Details</button>
                <button onClick={() => { setNavMode(false); setSelected(null) }} className="font-body text-[11px] font-bold px-2 py-1 rounded-full text-white" style={{ backgroundColor: FERN }}>Done</button>
              </span>
            </div>
          )}
          {!transform && (
            <div className="rounded-xl px-4 py-3 font-body text-[13px]" style={{ backgroundColor: '#FFFDF6', border: `1px solid ${GOLD}`, color: '#7A5B12' }}>
              The irrigation overlay isn&apos;t placed on the map yet. {manage ? <>Tap <b>Calibrate</b>, then walk the course dropping points on known heads to lock it in.</> : 'Ask the superintendent to calibrate it.'}
            </div>
          )}
          {manage && transform && (
            <div className="rounded-xl px-4 py-3 font-body text-[13px] flex items-center justify-between gap-3 flex-wrap" style={{ backgroundColor: '#EEF4EF', border: '1px solid #CFE0D5', color: FERN }}>
              <span>{features.length === 0
                ? <><b>Jump-start it:</b> auto-place every head &amp; valve from the as-built (~3,100) — then just nudge and re-type. Beats mapping it by hand.</>
                : <><b>Refresh from as-built:</b> re-imports ~3,100 heads/valves, keeping anything you&apos;ve placed or hand-edited.</>}
              </span>
              <button onClick={importFromAsBuilt} disabled={!!importing} className="font-body text-[12px] font-bold px-3.5 py-2 rounded-full text-white shrink-0 disabled:opacity-60" style={{ backgroundColor: FOREST }}>
                {importing ? `Importing ${importing.done}/${importing.total}…` : features.length === 0 ? 'Import from as-built' : 'Refresh from as-built'}
              </button>
            </div>
          )}
          {addMode && (
            <div className="rounded-xl px-4 py-2.5 font-body text-[13px] flex items-center justify-between gap-2" style={{ backgroundColor: '#EAF2FB', border: '1px solid #BBD3F0', color: '#1E3A5F' }}>
              <span><b>Adding a head:</b> tap the map where it is, or use <b>At my GPS</b> while standing on it.</span>
              <button onClick={() => setAddMode(false)} className="font-body text-[11px] font-bold shrink-0">Cancel</button>
            </div>
          )}
          {moveMode && selected && (
            <div className="rounded-xl px-4 py-2.5 font-body text-[13px] flex items-center justify-between gap-2" style={{ backgroundColor: '#FBF6E7', border: '1px solid #EFE0B0', color: '#7A5B12' }}>
              <span><b>Moving this {KIND_LABEL[selected.kind] || 'object'}:</b> tap the map where it should be.</span>
              <button onClick={() => setMoveMode(false)} className="font-body text-[11px] font-bold shrink-0">Cancel</button>
            </div>
          )}
          {stampSym && (
            <div className="rounded-xl px-4 py-2.5 font-body text-[13px] flex items-center justify-between gap-2" style={{ backgroundColor: '#F3EEFB', border: '1px solid #D9C9F0', color: '#4A2C7A' }}>
              <span className="flex items-center gap-2"><span dangerouslySetInnerHTML={{ __html: symbolSvg(symbolById(stampSym), 18) }} /><b>Stamping {symbolById(stampSym)?.label}:</b> tap the map to drop it — as many as you like.</span>
              <button onClick={() => setStampSym(null)} className="font-body text-[11px] font-bold shrink-0 px-2.5 py-1 rounded-full text-white" style={{ backgroundColor: '#6D28D9' }}>Done</button>
            </div>
          )}
          </div>

          <div className="relative" key="map-wrap">
            <div ref={mapCbRef} className="w-full rounded-xl overflow-hidden border border-black/10" style={{ height: mapPxH, minHeight: 460, backgroundColor: '#0b1e12', cursor: addMode || moveMode ? 'crosshair' : '' }} />
            {/* Floating controls */}
            <div className="absolute z-[500] top-3 right-3 flex flex-col gap-2">
              <button onClick={recenter} title="Center on me" className="w-10 h-10 rounded-full bg-white shadow flex items-center justify-center" style={{ color: FOREST }}><Navigation size={17} /></button>
              <button onClick={() => setShowFeatures((v) => !v)} title={showFeatures ? 'Hide heads' : 'Show heads'} className="w-10 h-10 rounded-full bg-white shadow flex items-center justify-center" style={{ color: showFeatures ? FERN : '#94A3B8' }}>{showFeatures ? <Eye size={17} /> : <EyeOff size={17} />}</button>
              <button onClick={() => setLabelsOn((v) => !v)} title={labelsOn ? 'Hide head numbers' : 'Show head numbers'} className="w-10 h-10 rounded-full bg-white shadow flex items-center justify-center font-body text-[11px] font-bold" style={{ color: labelsOn ? FERN : '#94A3B8' }}>R#</button>
              {pipes?.lines?.length > 0 && (
                <button onClick={() => setShowPipes((v) => !v)} title={showPipes ? 'Hide pipes' : 'Show pipes'} className="w-10 h-10 rounded-full bg-white shadow flex items-center justify-center" style={{ color: showPipes ? '#2563EB' : '#94A3B8' }}><Layers size={17} /></button>
              )}
              {wires?.colors && Object.keys(wires.colors).length > 0 && (
                <button onClick={() => setShowWires((v) => !v)} title={showWires ? 'Hide wire loops' : 'Show wire loops'} className="w-10 h-10 rounded-full bg-white shadow flex items-center justify-center" style={{ color: showWires ? '#C724FF' : '#94A3B8' }}><Zap size={17} /></button>
              )}
              {manage && (
                <button onClick={() => { setPaletteMode('stamp'); setPaletteOpen(true) }} title="Symbol palette — stamp heads, valves, couplers" className="w-10 h-10 rounded-full bg-white shadow flex items-center justify-center" style={{ color: stampSym ? '#6D28D9' : FOREST }}><Stamp size={17} /></button>
              )}
              <button onClick={() => setLegendFull(true)} title="Legend" className="w-10 h-10 rounded-full bg-white shadow flex items-center justify-center" style={{ color: FOREST }}><List size={17} /></button>
            </div>
            {/* Status readout — shows what actually loaded onto the map. */}
            <div className="absolute z-[600] top-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-md font-body text-[11px] font-bold tabular-nums whitespace-nowrap shadow" style={{ backgroundColor: 'rgba(255,255,255,0.95)', color: '#334155', border: '1px solid #E2E8E4' }}>
              Pipes {pipes?.lines?.length ?? '—'} · Heads {features.length} · Wires {wires?.colors ? Object.values(wires.colors).reduce((n, a) => n + a.length, 0) : '—'} · Map {transform ? 'set' : 'not set'}
            </div>
            {/* Add-head controls (managers) */}
            {manage && (
              <div className="absolute z-[500] top-3 left-3 flex flex-col gap-2">
                <button onClick={() => setAddMode((v) => !v)} className="font-body text-[12px] font-bold px-3 h-10 rounded-full shadow flex items-center gap-1.5" style={addMode ? { backgroundColor: '#2563EB', color: '#fff' } : { backgroundColor: '#fff', color: FOREST }}><Plus size={15} /> Add head</button>
                <button onClick={addAtGps} disabled={!gps} title="Add at my location" className="font-body text-[12px] font-bold px-3 h-10 rounded-full shadow flex items-center gap-1.5 bg-white disabled:opacity-50" style={{ color: FOREST }}><Crosshair size={14} /> At my GPS</button>
              </div>
            )}
            {/* Count chip */}
            <div className="absolute z-[500] bottom-3 right-3 bg-white/95 rounded-full shadow px-3 py-1.5 font-body text-[11px] font-bold flex items-center gap-1.5" style={{ color: FOREST }}>
              <Droplet size={12} style={{ color: '#2563EB' }} /> {features.length} object{features.length !== 1 ? 's' : ''}
            </div>
            {transform && (
              <div className="absolute z-[500] bottom-3 left-3 right-3 sm:right-auto sm:w-72 bg-white/95 backdrop-blur rounded-xl shadow p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <Layers size={14} style={{ color: FERN }} />
                  <span className="font-body text-[12px] font-bold" style={{ color: FOREST }}>PDF overlay <span className="font-normal text-slate-400">(reference)</span></span>
                  <span className="font-body text-[11px] ml-auto tabular-nums text-slate-500">{Math.round(opacity * 100)}%</span>
                </div>
                <input type="range" min="0" max="1" step="0.05" value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="w-full" />
                <p className="font-body text-[10px] text-slate-400 mt-1">Off by default — the digital lines &amp; heads are the map. Slide up to check against the original.{avgFt != null ? ` · Fit ~${avgFt} ft` : ''}</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        // ── Calibrate mode ──────────────────────────────────────────────────────
        <div className="space-y-3">
          {/* Method: line up on the photo (inch-accurate, no GPS) vs walk with GPS */}
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => { setCalMode('photo'); setPending(null) }} className="font-body text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1.5" style={calMode === 'photo' ? { backgroundColor: FOREST, color: '#fff' } : { color: FOREST, border: '1px solid #E2E8F0' }}><MapPin size={13} /> Line up on photo</button>
            <button onClick={() => { setCalMode('gps'); setPending(null) }} className="font-body text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1.5" style={calMode === 'gps' ? { backgroundColor: FOREST, color: '#fff' } : { color: FOREST, border: '1px solid #E2E8F0' }}><Crosshair size={13} /> Walk with GPS</button>
            <span className="font-body text-[11px] text-slate-400">{calMode === 'photo' ? 'Most accurate — line the drawing up on the aerial, no GPS needed.' : 'Stand on each head and capture GPS (±10–15 ft on an iPad).'}</span>
          </div>

          {calMode === 'photo' ? (
            <>
              <div className="rounded-xl px-4 py-3 font-body text-[13px]" style={{ backgroundColor: '#EEF4EF', border: '1px solid #CFE0D5', color: FERN }}>
                <b>1.</b> Pinch-zoom and tap a head on the <b>drawing</b> (left). <b>2.</b> Tap the <b>same head</b> on the <b>satellite photo</b> (right). Repeat at 6–10 spread to the far corners, then <b>Save</b>. Pick things you can spot on the photo — green edges, isolated heads, yardage plates.
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
                <div>
                  <p className="font-body text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Drawing — tap a head</p>
                  <div ref={drawRef} className="w-full rounded-xl overflow-hidden border border-black/10" style={{ height: 'calc(100vh - 330px)', minHeight: 340, backgroundColor: '#20302a' }} />
                </div>
                <div>
                  <p className="font-body text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: pending ? '#92660D' : '#94A3B8' }}>Photo — {pending ? 'now tap the SAME head' : 'tap the head here next'}</p>
                  <div ref={pairRef} className="w-full rounded-xl overflow-hidden border border-black/10" style={{ height: 'calc(100vh - 330px)', minHeight: 340, backgroundColor: '#0b1e12' }} />
                </div>
              </div>
              <div className="paper-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-body text-[11px] font-bold uppercase tracking-wide text-slate-400">Points ({points.length})</p>
                  <div className="flex items-center gap-2">
                    {avgFt != null && <span className="font-body text-[11px] font-bold" style={{ color: avgFt <= 15 ? FERN : avgFt <= 30 ? '#92660D' : '#B91C1C' }}>fit ~{avgFt} ft</span>}
                    {points.length > 0 && <button onClick={clearPoints} className="font-body text-[10px] font-bold text-slate-400 hover:text-red-500">Clear all</button>}
                  </div>
                </div>
                {points.length === 0 ? (
                  <p className="font-body text-[12px] text-slate-400">No points yet. You need at least 2; 6–10 spread out is best.</p>
                ) : (
                  <div className="space-y-1.5 max-h-56 overflow-y-auto">
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
                <p className="font-body text-[10px] text-slate-400 mt-2">A point with a big red number landed in the wrong spot — delete it and redo. Spread points to the far corners for the best fit.</p>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
              <div className="lg:col-span-2 space-y-2">
                <div className="rounded-xl px-4 py-3 font-body text-[13px]" style={{ backgroundColor: '#EEF4EF', border: '1px solid #CFE0D5', color: FERN }}>
                  <b>1.</b> Pinch-zoom and tap the exact head on the drawing. <b>2.</b> Walk to it, stand your phone on it, and press <b>Capture GPS</b>. Repeat at 8–12 heads spread around the course.
                </div>
                <div ref={drawRef} className="w-full rounded-xl overflow-hidden border border-black/10" style={{ height: 'calc(100vh - 210px)', minHeight: 420, backgroundColor: '#20302a' }} />
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
      )}

      {/* Edit an irrigation object (hidden while relocating or navigating to it) */}
      {selected && !moveMode && !navMode && (
        <div className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center p-3 sm:p-4" style={{ backgroundColor: 'rgba(26,26,22,0.45)' }} onClick={() => { setSelected(null); setConfirmDel(false) }}>
          <div className="bg-white rounded-2xl w-full sm:max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #EEF0EC' }}>
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: selected.symbol ? symbolColor(selected.symbol) : featureColor(selected) }} />
                <p className="font-display text-base font-bold" style={{ color: FOREST }}>{selected.label ? selected.label : (manage ? 'Edit ' : '') + (KIND_LABEL[selected.kind] || 'Object')}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => { setNavMode(true); enableHeading(); if (mainMap.current) mainMap.current.setView([selected.lat, selected.lng], Math.max(19, mapZoom)) }} className="font-body text-[12px] font-bold px-2.5 py-1.5 rounded-full text-white flex items-center gap-1" style={{ backgroundColor: FERN }}><Navigation size={13} /> Walk to it</button>
                <button onClick={() => { setSelected(null); setConfirmDel(false) }} className="text-slate-400"><X size={18} /></button>
              </div>
            </div>
            <div className="p-4 space-y-3">
              {!manage ? (
                <div className="space-y-2 font-body text-sm" style={{ color: FOREST }}>
                  {selected.label && <p><b>{selected.label}</b></p>}
                  <p className="text-slate-500 text-[13px]">{KIND_LABEL[selected.kind]} · {STATUS[selected.status]?.label}</p>
                  {(selected.zone || selected.size) && <p className="text-slate-500 text-[13px]">{selected.zone && `Zone ${selected.zone}`}{selected.zone && selected.size ? ' · ' : ''}{selected.size}</p>}
                  {selected.notes && <p className="text-slate-600 text-[13px] whitespace-pre-wrap">{selected.notes}</p>}
                  {selected.photo && <img src={selected.photo} alt="" className="rounded-lg w-full" />}
                </div>
              ) : (
                <>
                  <div>
                    <label className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400">Symbol (from legend)</label>
                    <button onClick={() => { setPaletteMode('assign'); setPaletteOpen(true) }} className="w-full mt-1 flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left" style={{ backgroundColor: '#F6F8F6', border: '1px solid #E2E8F0' }}>
                      {selected.symbol && symbolById(selected.symbol)
                        ? <><span dangerouslySetInnerHTML={{ __html: symbolSvg(symbolById(selected.symbol), 24) }} /><span className="font-body text-[13px] font-bold" style={{ color: FOREST }}>{symbolById(selected.symbol).label}</span></>
                        : <span className="font-body text-[13px] text-slate-500">Choose the exact symbol…</span>}
                      <span className="ml-auto font-body text-[11px] font-bold" style={{ color: FERN }}>Change</span>
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400">Category</label>
                      <select defaultValue={selected.kind} onChange={(e) => saveSelected({ kind: e.target.value })} className="w-full border border-slate-200 rounded-xl px-2.5 py-2 text-sm font-body bg-white">
                        {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400">Status</label>
                      <select defaultValue={selected.status} onChange={(e) => saveSelected({ status: e.target.value })} className="w-full border border-slate-200 rounded-xl px-2.5 py-2 text-sm font-body bg-white">
                        {Object.entries(STATUS).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400">Label / station #</label>
                    <input defaultValue={selected.label} onBlur={(e) => e.target.value !== selected.label && saveSelected({ label: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-body" placeholder="e.g. 7-3" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400">Zone / station</label>
                      <input defaultValue={selected.zone} onBlur={(e) => e.target.value !== selected.zone && saveSelected({ zone: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-body" />
                    </div>
                    <div>
                      <label className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400">Size</label>
                      <input defaultValue={selected.size} onBlur={(e) => e.target.value !== selected.size && saveSelected({ size: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-body" placeholder='e.g. 1"' />
                    </div>
                  </div>
                  <div>
                    <label className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400">Notes</label>
                    <textarea defaultValue={selected.notes} onBlur={(e) => e.target.value !== selected.notes && saveSelected({ notes: e.target.value })} rows={2} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-body" />
                  </div>
                  <div>
                    <label className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400 flex items-center gap-1.5"><Camera size={12} /> Photo</label>
                    {selected.photo && <img src={selected.photo} alt="" className="rounded-lg w-full mt-1 mb-1" />}
                    <input type="file" accept="image/*" capture="environment" onChange={(e) => onPhoto(e.target.files?.[0])} className="font-body text-[12px] mt-1" />
                  </div>
                  {/* Arc + radius readout, and the on-head compass tool */}
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: '#F6F8F6' }}>
                    <Compass size={15} style={{ color: FERN }} />
                    <span className="font-body text-[12px]" style={{ color: FOREST }}>
                      {selected.arc != null ? <><b>{Math.round(selected.arc)}°</b> arc</> : <span className="text-slate-400">No arc set</span>}
                      {selected.radius != null ? ` · ${selected.radius} ft` : ''}
                    </span>
                    <button onClick={() => setArcOpen(true)} className="ml-auto font-body text-[11px] font-bold px-2.5 py-1.5 rounded-full text-white" style={{ backgroundColor: FERN }}>Measure arc</button>
                  </div>
                  {/* Aim a part-circle head (which way it faces) */}
                  {isPartCircle(selected.symbol) && (
                    <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: '#F6F8F6' }}>
                      <span dangerouslySetInnerHTML={{ __html: symbolSvg(symbolById(selected.symbol), 22, selected.arcStart || 0) }} />
                      <span className="font-body text-[12px]" style={{ color: FOREST }}>Facing <b>{Math.round(selected.arcStart || 0)}°</b></span>
                      <div className="ml-auto flex items-center gap-1">
                        <button onClick={() => rotateSelected(-15)} className="w-8 h-8 rounded-full border border-slate-200 font-body font-bold" style={{ color: FOREST }}>↺</button>
                        <button onClick={() => rotateSelected(15)} className="w-8 h-8 rounded-full border border-slate-200 font-body font-bold" style={{ color: FOREST }}>↻</button>
                      </div>
                    </div>
                  )}
                  <p className="font-body text-[10px] text-slate-400">Changes save automatically.</p>
                  <div className="pt-1 flex items-center gap-2 flex-wrap">
                    <button onClick={moveSelectedToGps} disabled={!!movingGps} className="font-body text-xs font-bold px-3 py-2 rounded-full flex items-center gap-1.5 text-white disabled:opacity-60" style={{ backgroundColor: FOREST }}>
                      {movingGps ? <><Loader2 size={13} className="animate-spin" /> Averaging… {movingGps.n}</> : <><Crosshair size={13} /> Move to my GPS</>}
                    </button>
                    <button onClick={() => setMoveMode(true)} className="font-body text-xs font-bold px-3 py-2 rounded-full flex items-center gap-1.5" style={{ color: FOREST, border: '1px solid #E2E8F0' }}><Navigation size={13} /> Move on map</button>
                    {!confirmDel ? (
                      <button onClick={() => setConfirmDel(true)} className="font-body text-xs font-bold px-3 py-2 rounded-full flex items-center gap-1.5" style={{ color: '#B91C1C', border: '1px solid #F3C6C6' }}><Trash2 size={13} /> Delete</button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="font-body text-[12px] text-slate-500">Delete?</span>
                        <button onClick={deleteSelected} className="font-body text-xs font-bold px-3 py-2 rounded-full text-white" style={{ backgroundColor: '#DC2626' }}>Yes, delete</button>
                        <button onClick={() => setConfirmDel(false)} className="font-body text-xs font-bold px-3 py-2 rounded-full text-slate-500 border border-slate-200">Keep</button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {arcOpen && selected && (
        <ArcTool feature={selected} onClose={() => setArcOpen(false)} onSave={async (vals) => { await saveSelected(vals); setArcOpen(false) }} />
      )}

      {/* Symbol stamp palette — pick a symbol, then tap the map to drop it. */}
      {paletteOpen && (
        <div className="fixed inset-0 z-[1100] flex items-end sm:items-center justify-center p-3 sm:p-4" style={{ backgroundColor: 'rgba(26,26,22,0.45)' }} onClick={() => setPaletteOpen(false)}>
          <div className="bg-white rounded-2xl w-full sm:max-w-lg shadow-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 sticky top-0 bg-white" style={{ borderBottom: '1px solid #EEF0EC' }}>
              <div className="flex items-center gap-2"><Stamp size={18} style={{ color: FERN }} /><p className="font-display text-base font-bold" style={{ color: FOREST }}>Symbol palette</p></div>
              <button onClick={() => setPaletteOpen(false)} className="text-slate-400"><X size={18} /></button>
            </div>
            <div className="p-4">
              <p className="font-body text-[12px] text-slate-500 mb-3">{paletteMode === 'assign'
                ? <>Pick what this object is — it&apos;ll take that icon&apos;s colour and label on the map.</>
                : <>Tap a symbol, then tap the map to drop it. It keeps that symbol armed so you can place a whole run, then hit <b>Done</b>.</>}</p>
              {SYMBOL_GROUPS.map((g) => (
                <div key={g.key} className="mb-4">
                  <p className="font-body text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">{g.label}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {g.items.map((it) => (
                      <button key={it.id} onClick={() => { if (paletteMode === 'assign' && selected) { saveSelected({ symbol: it.id, kind: it.kind }); setPaletteOpen(false) } else { setStampSym(it.id); setPaletteOpen(false); setAddMode(false); setMoveMode(false) } }} className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors" style={{ backgroundColor: stampSym === it.id ? '#F3EEFB' : '#F6F8F6', border: `1px solid ${stampSym === it.id ? '#C9B3EC' : 'transparent'}` }}>
                        <span className="shrink-0" dangerouslySetInnerHTML={{ __html: symbolSvg(it, 26) }} />
                        <span className="min-w-0">
                          <span className="font-body text-[12px] font-bold block truncate" style={{ color: FOREST }}>{it.label}</span>
                          {it.spec && <span className="font-body text-[10px] text-slate-400 block truncate">{it.spec}</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Full legend — the same list as the as-built drawing. */}
      {legendFull && (
        <div className="fixed inset-0 z-[1100] flex items-end sm:items-center justify-center p-3 sm:p-4" style={{ backgroundColor: 'rgba(26,26,22,0.45)' }} onClick={() => setLegendFull(false)}>
          <div className="bg-white rounded-2xl w-full sm:max-w-lg shadow-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 sticky top-0 bg-white" style={{ borderBottom: '1px solid #EEF0EC' }}>
              <div className="flex items-center gap-2"><List size={18} style={{ color: FERN }} /><p className="font-display text-base font-bold" style={{ color: FOREST }}>Legend</p></div>
              <button onClick={() => setLegendFull(false)} className="text-slate-400"><X size={18} /></button>
            </div>
            <div className="p-4">
              {SYMBOL_GROUPS.map((g) => (
                <div key={g.key} className="mb-4">
                  <p className="font-body text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">{g.label}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                    {g.items.map((it) => (
                      <div key={it.id} className="flex items-center gap-2.5 py-0.5">
                        <span className="shrink-0" dangerouslySetInnerHTML={{ __html: symbolSvg(it, 22) }} />
                        <span className="min-w-0">
                          <span className="font-body text-[12px] block truncate" style={{ color: FOREST }}>{it.label}</span>
                          {it.spec && <span className="font-body text-[10px] text-slate-400 block truncate">{it.spec}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <div className="mb-3">
                <p className="font-body text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Pipe</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {PIPE_ITEMS.map((p) => (
                    <div key={p.cls} className="flex items-center gap-2.5 py-0.5">
                      <span style={{ display: 'inline-block', width: 22, borderTop: `3px solid ${p.color}` }} />
                      <span className="font-body text-[12px]" style={{ color: FOREST }}>{p.cls}</span>
                    </div>
                  ))}
                </div>
              </div>
              {wires?.colors && (
                <div>
                  <p className="font-body text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Control wire</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {WIRE_LEGEND.filter(([col]) => wires.colors[col]?.length).map(([col, label]) => (
                      <div key={col} className="flex items-center gap-2.5 py-0.5">
                        <span style={{ display: 'inline-block', width: 22, borderTop: `2px dotted ${col}` }} />
                        <span className="font-body text-[12px]" style={{ color: FOREST }}>{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
