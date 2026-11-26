'use client'

// ============================================================================
//  Course Map — Greens today · Map · Targets.
//
//  Stage 1, Phase A: the Map page. Upload an aerial photo (JPG/PNG + world file,
//  or a Nearmap-named file), which is georeferenced by lib/coursemap and placed
//  on the club's map with the existing Leaflet rotated-overlay — no tiler. The
//  photo lives in a private, club-scoped Storage bucket. Greens today + Targets
//  are the next phases; their tabs are present as sign-posts.
//
//  No React hook is placed after an early return.
// ============================================================================
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import { Upload, Layers } from 'lucide-react'
import { FOREST, FERN, GOLD, HAIR, INK, INK_2, INK_3, PAPER } from '@/lib/theme'
import * as cmdb from '@/lib/coursemap/db'
import * as db from '@/lib/db'
import GreensToday, { MoistureTargets } from '@/components/GreensToday'
import WettingAgent from '@/components/WettingAgent'
import { fetchWeather, fetchSeasonDaily, dailyFromForecastBlock, mergeDaily } from '@/lib/weather'
import { resolveTarget } from '@/lib/coursemap/targets'
import { parseWorldFile, parseNearmapName, upperLeftFromCenter, worldFileCorners, geodesicAreaSqft, perimeterFt } from '@/lib/coursemap/geo'
import { formatDate, formatNumber } from '@/lib/format'

const AREA_TYPES = [['green', 'Green', '#22C55E'], ['approach', 'Approach', '#A3E635'], ['fairway', 'Fairway', '#4AD07D'], ['tee', 'Tee', '#14B8A6'], ['rough', 'Rough', '#5E8C4E'], ['native', 'Natives', '#B59A6B'], ['bunker', 'Bunker', '#E8D8A0'], ['water', 'Water', '#3B82C4'], ['other', 'Other', '#9AA6B2']]
const typeColor = (t) => (AREA_TYPES.find((x) => x[0] === t) || [])[2] || '#9AA6B2'
// Unknown (custom) types show their own text as the label.
const typeLabel = (t) => { const f = AREA_TYPES.find((x) => x[0] === t); return f ? f[1] : (t || 'Area') }
// A palette for recolouring any shape.
const SWATCHES = ['#22C55E', '#4AD07D', '#5E8C4E', '#A3E635', '#14B8A6', '#B59A6B', '#E8D8A0', '#3B82C4', '#C9A84C', '#E0714E', '#9333EA', '#9AA6B2']

const PAGE = 'max-w-[1200px] mx-auto px-4 sm:px-6'
const SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const SAT_ATTR = 'Imagery © Esri, Maxar, Earthstar Geographics'
const CONGRESSIONAL = [38.9966, -77.1803]

const canManage = (role) => role === 'assistant' || role === 'superintendent' || role === 'director'

export default function GreensMap({ user, nav }) {
  // Driven by the menu: Resources → Course Map opens the map; Irrigation → Greens
  // Today opens the greens view (with a Targets sub-tab). One loader, two homes.
  const view = nav?.route === 'map' ? 'map' : 'today'
  const manage = canManage(user?.role)
  const initialTab = nav?.route === 'map' ? 'map' : nav?.route === 'moisture' ? 'wetting' : 'greens'
  const [tab, setTab] = useState(initialTab)
  const [ctx, setCtx] = useState(null)
  const [targetTxt, setTargetTxt] = useState('—')
  const [courseId, setCourseId] = useState('')
  const [imagery, setImagery] = useState([])
  const [selId, setSelId] = useState('')
  const [opacity, setOpacity] = useState(1)
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [mapReady, setMapReady] = useState(false)

  // Phase B — areas
  const [areas, setAreas] = useState([])
  const [showAreas, setShowAreas] = useState(true)
  const [selAreaId, setSelAreaId] = useState(null)
  const [drawing, setDrawing] = useState(false)
  const [drawPts, setDrawPts] = useState([]) // [[lat,lon],…]
  const [editing, setEditing] = useState(false)
  const [editRing, setEditRing] = useState(null) // committed edit ring [[lon,lat],…]
  const [editEpoch, setEditEpoch] = useState(0) // bump to rebuild edit vertices after a programmatic change
  const [liveSqft, setLiveSqft] = useState(null)  // sqft while dragging vertices
  const [showTotals, setShowTotals] = useState(false)
  const [savingArea, setSavingArea] = useState(false)
  const [newArea, setNewArea] = useState(null) // {hole,type,name} while naming a freshly drawn shape
  const [snapOn, setSnapOn] = useState(true) // snap new corners onto existing areas' lines
  const [penOn, setPenOn] = useState(false) // freehand pen: hold & drag to draw instead of tapping corners
  const [areaColors, setAreaColors] = useState({}) // per-area colour overrides (by area id)
  const [typeColors, setTypeColors] = useState({}) // per-TYPE default colour overrides
  const [showColors, setShowColors] = useState(false)

  const LRef = useRef(null)
  const mapRef = useRef(null)
  const elRef = useRef(null)
  const overlayRef = useRef(null)
  const basemapRef = useRef(null)
  const areasLayerRef = useRef(null)
  const drawLayerRef = useRef(null)
  const editLayerRef = useRef(null)
  const editRingRef = useRef(null)
  const editPolyRef = useRef(null)
  const snapRef = useRef(true)
  const areasRef = useRef([])
  const drawPtsRef = useRef([])
  useEffect(() => { snapRef.current = snapOn }, [snapOn])
  useEffect(() => { areasRef.current = areas }, [areas])
  useEffect(() => { drawPtsRef.current = drawPts }, [drawPts])
  // Snap a tapped corner onto the nearest existing area vertex (preferred) or
  // edge within ~16px, so neighbouring areas share the exact same boundary.
  const snapLatLng = (latlng) => {
    const map = mapRef.current, L = LRef.current
    if (!map || !L) return latlng
    const THRESH = 16
    const cp = map.latLngToContainerPoint(latlng)
    const px = (ll) => map.latLngToContainerPoint(ll)
    let bestV = null, bestVd = THRESH
    const areasList = areasRef.current || []
    const ownPts = (drawPtsRef.current || []).map(([lat, lon]) => ({ lat, lng: lon }))
    const tryVertex = (ll) => { const p = px(ll); const d = Math.hypot(p.x - cp.x, p.y - cp.y); if (d < bestVd) { bestVd = d; bestV = ll } }
    for (const a of areasList) { if (!a.ring?.length) continue; for (const [lon, lat] of a.ring) tryVertex({ lat, lng: lon }) }
    ownPts.forEach(tryVertex)
    if (bestV) return bestV
    let bestE = null, bestEd = THRESH
    for (const a of areasList) {
      if (!a.ring || a.ring.length < 2) continue
      const pts = a.ring.map(([lon, lat]) => px({ lat, lng: lon }))
      for (let i = 0; i < pts.length; i++) {
        const A = pts[i], B = pts[(i + 1) % pts.length]
        const dx = B.x - A.x, dy = B.y - A.y, len2 = dx * dx + dy * dy
        let t = len2 ? ((cp.x - A.x) * dx + (cp.y - A.y) * dy) / len2 : 0
        t = Math.max(0, Math.min(1, t))
        const qx = A.x + t * dx, qy = A.y + t * dy
        const d = Math.hypot(qx - cp.x, qy - cp.y)
        if (d < bestEd) { bestEd = d; bestE = map.containerPointToLatLng(L.point(qx, qy)) }
      }
    }
    return bestE || latlng
  }
  // Per-shape colours live in the course settings (no DB change). colorOf falls
  // back to the type's default colour.
  useEffect(() => { db.fetchSettings().then((s) => { setAreaColors(s.courseInfo?.areaColors || {}); setTypeColors(s.courseInfo?.typeColors || {}) }).catch(() => {}) }, [])
  const saveAreaColor = async (areaId, color) => {
    if (!areaId) return
    setAreaColors((prev) => ({ ...prev, [areaId]: color }))
    try { const s = await db.fetchSettings(); const ci = { ...(s.courseInfo || {}), areaColors: { ...(s.courseInfo?.areaColors || {}), [areaId]: color } }; await db.saveSettings({ courseInfo: ci }) } catch (e) { console.error(e) }
  }
  const saveTypeColor = async (type, color) => {
    if (!type) return
    setTypeColors((prev) => { const n = { ...prev }; if (color) n[type] = color; else delete n[type]; return n })
    try {
      const s = await db.fetchSettings()
      const tc = { ...(s.courseInfo?.typeColors || {}) }
      if (color) tc[type] = color; else delete tc[type]
      await db.saveSettings({ courseInfo: { ...(s.courseInfo || {}), typeColors: tc } })
    } catch (e) { console.error(e) }
  }
  // Effective default colour for a type: the user's saved default, else the built-in.
  const defColor = (t) => typeColors[t] || typeColor(t)
  // A shape's colour: its own override, else its type's (possibly customised) default.
  const colorOf = (a) => areaColors[a?.id] || defColor(a?.type)

  // When the menu switches between Irrigation → Greens Today and Resources →
  // Course Map, re-sync the active tab (this component stays mounted across both).
  useEffect(() => { setTab(nav?.route === 'map' ? 'map' : nav?.route === 'moisture' ? 'wetting' : 'greens') }, [nav])

  // Load club context + imagery.
  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const c = await cmdb.fetchCourseContext()
        if (!live) return
        setCtx(c)
        const cid = c.courses[0]?.id || ''
        setCourseId(cid)
        cmdb.fetchTargets(cid).then((tg) => {
          const t = resolveTarget(tg, new Date().toISOString().slice(0, 10))
          if (live && t) setTargetTxt(`${t.aim}%`)
        }).catch(() => {})
        const imgs = await cmdb.fetchImagery(cid)
        if (!live) return
        setImagery(imgs)
        setSelId(c.settings?.default_imagery_id || imgs[0]?.id || '')
      } catch (e) { console.error(e) } finally { if (live) setLoading(false) }
    })()
    return () => { live = false }
  }, [])

  // Load Leaflet once.
  useEffect(() => {
    let live = true
    ;(async () => {
      const mod = await import('leaflet')
      const L = mod.default || mod
      window.L = L
      try { await import('leaflet-imageoverlay-rotated') } catch (e) { console.error('rotated overlay plugin', e) }
      if (live) LRef.current = L
    })()
    return () => { live = false }
  }, [])

  // Build the map when the Map tab is visible and Leaflet is ready.
  useEffect(() => {
    if (tab !== 'map') return
    let tries = 0
    const t = setInterval(() => {
      const L = LRef.current
      if (!L || !elRef.current || mapRef.current) { if (++tries > 100) clearInterval(t); return }
      clearInterval(t)
      const map = L.map(elRef.current, { center: CONGRESSIONAL, zoom: 16, zoomControl: true, preferCanvas: true, maxBoundsViscosity: 1.0, attributionControl: false })
      mapRef.current = map
      setTimeout(() => map.invalidateSize(), 150)
      setMapReady(true) // tell the overlay effect the map exists now
    }, 60)
    // Tear the map down when leaving the Map tab or unmounting, so returning
    // rebuilds it cleanly (otherwise the box points at a dead map → blank).
    return () => {
      clearInterval(t)
      if (mapRef.current) { try { mapRef.current.remove() } catch { /* ignore */ } mapRef.current = null }
      overlayRef.current = null; basemapRef.current = null
      setMapReady(false)
    }
  }, [tab])

  // Draw / update the selected photo overlay.
  useEffect(() => {
    const L = LRef.current, map = mapRef.current
    if (!L || !map || !mapReady || tab !== 'map') return
    let live = true
    ;(async () => {
      // clear layers + any previous lock
      if (overlayRef.current) { map.removeLayer(overlayRef.current); overlayRef.current = null }
      if (basemapRef.current) { map.removeLayer(basemapRef.current); basemapRef.current = null }
      map.setMaxBounds(null); map.setMinZoom(0)

      const img = imagery.find((i) => i.id === selId)
      if (!img || !img.filePath) {
        // No photo yet → satellite basemap so the box isn't empty.
        basemapRef.current = L.tileLayer(SAT_URL, { maxZoom: 22, maxNativeZoom: 19, attribution: SAT_ATTR, crossOrigin: true }).addTo(map)
        return
      }
      const url = await cmdb.signedUrl(img.filePath)
      if (!live || !url) return
      const c = worldFileCorners(
        { A: img.pxSizeX, D: 0, B: 0, E: img.pxSizeY, C: img.ulX, F: img.ulY },
        img.widthPx, img.heightPx, img.crs || 'EPSG:3857',
      )
      if (typeof L.imageOverlay?.rotated === 'function') {
        const ov = L.imageOverlay.rotated(
          url, L.latLng(c.topLeft.lat, c.topLeft.lon), L.latLng(c.topRight.lat, c.topRight.lon), L.latLng(c.bottomLeft.lat, c.bottomLeft.lon),
          { opacity, interactive: false },
        )
        ov.addTo(map); overlayRef.current = ov
        // Show ONLY the photo: re-measure the box (it may have just been laid
        // out), fit tightly to the photo, and lock pan/zoom to its bounds.
        const bounds = L.latLngBounds([[c.topLeft.lat, c.topLeft.lon], [c.topRight.lat, c.topRight.lon], [c.bottomLeft.lat, c.bottomLeft.lon], [c.bottomRight.lat, c.bottomRight.lon]])
        const fit = () => {
          map.invalidateSize()
          map.setMinZoom(0); map.setMaxBounds(null)
          // COVER: fill the box edge-to-edge (crop), centered on the photo.
          const z = map.getBoundsZoom(bounds, true)
          map.setView(bounds.getCenter(), z, { animate: false })
          map.setMinZoom(z)            // can't zoom out past a full box
          map.setMaxBounds(bounds)     // can't pan off the photo
        }
        fit()
        setTimeout(fit, 200) // once more after layout settles
      }
    })()
    return () => { live = false }
  }, [selId, imagery, tab, mapReady])

  // Keep overlay opacity live.
  useEffect(() => { if (overlayRef.current?.setOpacity) overlayRef.current.setOpacity(opacity) }, [opacity])

  // Load areas for the course.
  useEffect(() => {
    if (!courseId) return
    let live = true
    cmdb.fetchAreas(courseId).then((a) => { if (live) setAreas(a) })
    return () => { live = false }
  }, [courseId])
  const reloadAreas = async () => { if (courseId) setAreas(await cmdb.fetchAreas(courseId)) }

  // Render existing area polygons.
  useEffect(() => {
    const L = LRef.current, map = mapRef.current
    if (!L || !map || !mapReady || tab !== 'map') return
    if (areasLayerRef.current) { map.removeLayer(areasLayerRef.current); areasLayerRef.current = null }
    if (!showAreas) return
    const grp = L.layerGroup().addTo(map)
    for (const a of areas) {
      if (editing && a.id === selAreaId) continue // edit overlay draws this one
      const sel = a.id === selAreaId
      const col = colorOf(a)
      const poly = L.polygon(a.ring.map(([lon, lat]) => [lat, lon]), { color: col, fillColor: col, weight: sel ? 3 : 1.5, opacity: 0.95, fillOpacity: sel ? 0.35 : 0.15 })
      poly.on('click', (e) => { L.DomEvent.stop(e); if (!drawing) { setSelAreaId(a.id); setEditing(false) } })
      poly.addTo(grp)
    }
    areasLayerRef.current = grp
  }, [mapReady, tab, areas, selAreaId, showAreas, editing, drawing, areaColors, typeColors])

  // Draw mode (tap): each tap drops one corner. Off while the pen is active.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !drawing || penOn) return
    const onClick = (e) => { const ll = snapRef.current ? snapLatLng(e.latlng) : e.latlng; setDrawPts((p) => [...p, [ll.lat, ll.lng]]) }
    map.on('click', onClick)
    const el = map.getContainer(); const prev = el.style.cursor; el.style.cursor = 'crosshair'
    return () => { map.off('click', onClick); el.style.cursor = prev }
  }, [drawing, penOn])

  // Draw mode (pen): hold & drag to trace a freehand outline. Panning is paused
  // so the drag draws; points are sampled every few pixels along the stroke.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !drawing || !penOn) return
    const el = map.getContainer()
    map.dragging.disable()
    const prevCursor = el.style.cursor; el.style.cursor = 'crosshair'
    let stroke = false, last = null
    const addFrom = (ev) => { const ll = map.mouseEventToLatLng(ev); setDrawPts((p) => [...p, [ll.lat, ll.lng]]) }
    const start = (ev) => {
      if (ev.target?.closest?.('.leaflet-control')) return
      if (ev.button != null && ev.button > 0) return
      stroke = true; last = { x: ev.clientX, y: ev.clientY }
      try { el.setPointerCapture?.(ev.pointerId) } catch {}
      addFrom(ev); ev.preventDefault()
    }
    const move = (ev) => {
      if (!stroke) return
      const dx = ev.clientX - last.x, dy = ev.clientY - last.y
      if (dx * dx + dy * dy < 16) return // ~4px sampling
      last = { x: ev.clientX, y: ev.clientY }; addFrom(ev)
    }
    const end = (ev) => { if (!stroke) return; stroke = false; try { el.releasePointerCapture?.(ev.pointerId) } catch {} }
    el.addEventListener('pointerdown', start)
    el.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      el.removeEventListener('pointerdown', start)
      el.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      map.dragging.enable(); el.style.cursor = prevCursor
    }
  }, [drawing, penOn])

  // Draw preview (polygon + corner dots).
  useEffect(() => {
    const L = LRef.current, map = mapRef.current
    if (!L || !map) return
    if (drawLayerRef.current) { map.removeLayer(drawLayerRef.current); drawLayerRef.current = null }
    if (!drawing || drawPts.length === 0) return
    const grp = L.layerGroup().addTo(map)
    if (drawPts.length >= 3) L.polygon(drawPts, { color: GOLD, weight: 2, fillOpacity: 0.2, dashArray: '4' }).addTo(grp)
    else if (drawPts.length === 2) L.polyline(drawPts, { color: GOLD, weight: 2, dashArray: '4' }).addTo(grp)
    drawPts.forEach((pt) => L.circleMarker(pt, { radius: 4, color: GOLD, fillColor: '#fff', fillOpacity: 1, weight: 2 }).addTo(grp))
    drawLayerRef.current = grp
  }, [drawing, drawPts])

  // Edit mode: draggable vertices + a live polygon (built once per selection).
  useEffect(() => {
    const L = LRef.current, map = mapRef.current
    if (!L || !map) return
    if (editLayerRef.current) { map.removeLayer(editLayerRef.current); editLayerRef.current = null; editPolyRef.current = null }
    if (!editing || !editRingRef.current) return
    const grp = L.layerGroup().addTo(map)
    const toLL = (ring) => ring.map(([lon, lat]) => [lat, lon])
    const poly = L.polygon(toLL(editRingRef.current), { color: GOLD, weight: 2, fillOpacity: 0.25 }).addTo(grp)
    editPolyRef.current = poly
    editRingRef.current.forEach((pt, i) => {
      const m = L.marker([pt[1], pt[0]], { draggable: true, icon: L.divIcon({ className: '', html: `<div style="width:12px;height:12px;border-radius:50%;background:#fff;border:2px solid ${GOLD};box-shadow:0 0 0 1px rgba(0,0,0,.3)"></div>`, iconSize: [12, 12], iconAnchor: [6, 6] }) }).addTo(grp)
      m.on('drag', (e) => {
        const ll = e.target.getLatLng()
        editRingRef.current[i] = [ll.lng, ll.lat]
        poly.setLatLngs(toLL(editRingRef.current))
        setLiveSqft(geodesicAreaSqft(editRingRef.current))
      })
      m.on('dragend', () => setEditRing(editRingRef.current.map((p) => [...p])))
    })
    editLayerRef.current = grp
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, selAreaId, editEpoch])

  const reloadImagery = async () => {
    const imgs = await cmdb.fetchImagery(courseId)
    setImagery(imgs)
    if (imgs[0]) setSelId(imgs[0].id)
  }

  const selArea = areas.find((a) => a.id === selAreaId) || null

  const startDraw = () => { setSelAreaId(null); setEditing(false); setNewArea(null); setDrawPts([]); setDrawing(true) }
  const finishDraw = () => { if (drawPts.length >= 3) setNewArea({ hole: '', type: 'green', name: '' }) }
  // Round the drawn outline into curves (Chaikin corner-cutting) instead of
  // straight segments. Endpoints stay put so a "Follow line" close still lines up.
  const smoothDraw = () => {
    setDrawPts((pts) => {
      if (pts.length < 3) return pts
      let p = pts
      for (let k = 0; k < 2; k++) {
        if (p.length > 400) break
        const out = [p[0]]
        for (let i = 0; i < p.length - 1; i++) {
          const a = p[i], b = p[i + 1]
          out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25])
          out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75])
        }
        out.push(p[p.length - 1])
        p = out
      }
      return p
    })
  }
  // While editing a saved shape: pull any vertex that sits close to another
  // area's line exactly onto it, so shared borders zip together.
  const snapNeighbours = () => {
    const map = mapRef.current, L = LRef.current
    if (!map || !L || !editRingRef.current) return
    const THRESH_V = 22, THRESH_E = 18
    const others = (areasRef.current || []).filter((a) => a.id !== selAreaId && a.ring?.length >= 2)
    let moved = 0
    const newRing = editRingRef.current.map(([lon, lat]) => {
      const cp = map.latLngToContainerPoint({ lat, lng: lon })
      let bestV = null, bestVd = THRESH_V
      for (const a of others) for (const [olon, olat] of a.ring) { const p = map.latLngToContainerPoint({ lat: olat, lng: olon }); const d = Math.hypot(p.x - cp.x, p.y - cp.y); if (d < bestVd) { bestVd = d; bestV = [olon, olat] } }
      if (bestV) { moved++; return bestV }
      let bestE = null, bestEd = THRESH_E
      for (const a of others) {
        const pts = a.ring.map(([ol, oa]) => map.latLngToContainerPoint({ lat: oa, lng: ol }))
        for (let i = 0; i < pts.length; i++) {
          const A = pts[i], B = pts[(i + 1) % pts.length]
          const dx = B.x - A.x, dy = B.y - A.y, len2 = dx * dx + dy * dy
          let t = len2 ? ((cp.x - A.x) * dx + (cp.y - A.y) * dy) / len2 : 0
          t = Math.max(0, Math.min(1, t))
          const qx = A.x + t * dx, qy = A.y + t * dy
          const d = Math.hypot(qx - cp.x, qy - cp.y)
          if (d < bestEd) { bestEd = d; const ll = map.containerPointToLatLng(L.point(qx, qy)); bestE = [ll.lng, ll.lat] }
        }
      }
      if (bestE) { moved++; return bestE }
      return [lon, lat]
    })
    editRingRef.current = newRing
    setEditRing(newRing.map((p) => [...p]))
    setLiveSqft(geodesicAreaSqft(newRing))
    setEditEpoch((e) => e + 1)
    setNotice(moved ? `Snapped ${moved} point${moved > 1 ? 's' : ''} onto neighbouring lines.` : 'No neighbouring lines were close enough to snap.')
  }
  // Close the open side of the shape by tracing the existing area lines between
  // its two ends — even when that boundary is stitched from SEVERAL neighbouring
  // areas. Builds a graph of every area edge (shared corners + T-junctions
  // merged) and walks the shortest route along it from one end to the other.
  const followLine = () => {
    const map = mapRef.current, L = LRef.current
    const pts = drawPts
    if (!map || !L || pts.length < 2) return
    const areasList = (areasRef.current || []).filter((a) => a.ring && a.ring.length >= 3)
    if (!areasList.length) { setNotice('No existing areas to follow yet.'); return }
    const toPx = (lon, lat) => map.latLngToContainerPoint({ lat, lng: lon })
    const cpOf = ([lat, lon]) => map.latLngToContainerPoint({ lat, lng: lon })

    // 1) Nodes = every area vertex (in pixels). Merge coincident corners.
    const nodes = []        // {x,y,lat,lon}
    const ringIdx = []      // per area: node index for each ring vertex
    for (const a of areasList) {
      const idxs = []
      for (const [lon, lat] of a.ring) { const p = toPx(lon, lat); idxs.push(nodes.push({ x: p.x, y: p.y, lat, lon }) - 1) }
      ringIdx.push(idxs)
    }
    const MERGE = 12
    const parent = nodes.map((_, i) => i)
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
    const union = (i, j) => { const a = find(i), b = find(j); if (a !== b) parent[a] = b }
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      if (Math.abs(nodes[i].x - nodes[j].x) <= MERGE && Math.abs(nodes[i].y - nodes[j].y) <= MERGE && Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y) <= MERGE) union(i, j)
    }
    // 2) Graph edges: ring edges, plus bridges where one area's corner sits on another's edge.
    const adj = new Map()
    const addEdge = (i, j) => {
      const ri = find(i), rj = find(j); if (ri === rj) return
      const w = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y)
      if (!adj.has(ri)) adj.set(ri, new Map()); if (!adj.has(rj)) adj.set(rj, new Map())
      const mi = adj.get(ri); if (!mi.has(rj) || mi.get(rj) > w) mi.set(rj, w)
      const mj = adj.get(rj); if (!mj.has(ri) || mj.get(ri) > w) mj.set(ri, w)
    }
    for (let a = 0; a < areasList.length; a++) { const idxs = ringIdx[a], m = idxs.length; for (let k = 0; k < m; k++) addEdge(idxs[k], idxs[(k + 1) % m]) }
    // project a container point onto one area's ring → nearest edge + foot point
    const projectRing = (areaI, cp) => {
      const idxs = ringIdx[areaI], m = idxs.length; let best = null
      for (let k = 0; k < m; k++) {
        const I = idxs[k], J = idxs[(k + 1) % m], A = nodes[I], B = nodes[J]
        const dx = B.x - A.x, dy = B.y - A.y, len2 = dx * dx + dy * dy
        let t = len2 ? ((cp.x - A.x) * dx + (cp.y - A.y) * dy) / len2 : 0; t = Math.max(0, Math.min(1, t))
        const qx = A.x + t * dx, qy = A.y + t * dy, d = Math.hypot(qx - cp.x, qy - cp.y)
        if (!best || d < best.d) best = { d, I, J, qx, qy, t }
      }
      return best
    }
    // bridge T-junctions: a corner of one area lying mid-edge of another
    for (let i = 0; i < nodes.length; i++) {
      for (let a = 0; a < areasList.length; a++) {
        if (ringIdx[a].includes(i)) continue
        const pr = projectRing(a, nodes[i])
        if (pr && pr.d <= MERGE && pr.t > 0.001 && pr.t < 0.999) { addEdge(i, pr.I); addEdge(i, pr.J) }
      }
    }
    // 3) Attach the two drawn ends to their nearest area edge (across ALL areas).
    const nearestEdge = (cp) => { let best = null; for (let a = 0; a < areasList.length; a++) { const pr = projectRing(a, cp); if (pr && (!best || pr.d < best.d)) best = pr } return best }
    const cp0 = cpOf(pts[0]), cpn = cpOf(pts[pts.length - 1])
    const prn = nearestEdge(cpn), pr0 = nearestEdge(cp0)
    const TOL = 50
    if (!prn || !pr0 || prn.d > TOL || pr0.d > TOL) { setNotice('Couldn’t find an existing line near both ends. Drop your first and last corners right on a neighbouring edge, then tap Follow line.'); return }
    // 4) Shortest path from the LAST end (prn) to the FIRST end (pr0) along the graph.
    const SKEY = 'S', TKEY = 'T'
    const sLinks = [[find(prn.I), Math.hypot(nodes[prn.I].x - prn.qx, nodes[prn.I].y - prn.qy)], [find(prn.J), Math.hypot(nodes[prn.J].x - prn.qx, nodes[prn.J].y - prn.qy)]]
    const tByRoot = new Map(); tByRoot.set(find(pr0.I), Math.hypot(nodes[pr0.I].x - pr0.qx, nodes[pr0.I].y - pr0.qy)); { const rj = find(pr0.J), w = Math.hypot(nodes[pr0.J].x - pr0.qx, nodes[pr0.J].y - pr0.qy); if (!tByRoot.has(rj) || tByRoot.get(rj) > w) tByRoot.set(rj, w) }
    const neighbors = (x) => {
      if (x === SKEY) return sLinks
      if (x === TKEY) return []
      const out = []; const m = adj.get(x); if (m) for (const [r, w] of m) out.push([r, w]); if (tByRoot.has(x)) out.push([TKEY, tByRoot.get(x)]); return out
    }
    const dist = new Map([[SKEY, 0]]), prev = new Map(), done = new Set()
    while (true) {
      let cur = null, cd = Infinity
      for (const [k, d] of dist) { if (!done.has(k) && d < cd) { cd = d; cur = k } }
      if (cur === null || cur === TKEY) break
      done.add(cur)
      for (const [nb, w] of neighbors(cur)) { const nd = cd + w; if (nd < (dist.has(nb) ? dist.get(nb) : Infinity)) { dist.set(nb, nd); prev.set(nb, cur) } }
    }
    if (!prev.has(TKEY)) { setNotice('The lines between your two ends don’t connect. Drop a corner where they meet, or trace that stretch by hand.'); return }
    const chain = []; let c = TKEY; while (c !== undefined) { chain.push(c); c = prev.get(c) }
    chain.reverse() // S … T
    const midRoots = chain.filter((k) => k !== SKEY && k !== TKEY)
    // 5) Append: foot at last end → chained area corners → foot at first end.
    const add = []
    const pushLL = (ll) => { const last = add[add.length - 1]; if (last) { const a = map.latLngToContainerPoint(last), b = map.latLngToContainerPoint(ll); if (Math.hypot(a.x - b.x, a.y - b.y) < 1.5) return } add.push(ll) }
    pushLL(map.containerPointToLatLng(L.point(prn.qx, prn.qy)))
    for (const r of midRoots) pushLL({ lat: nodes[r].lat, lng: nodes[r].lon })
    pushLL(map.containerPointToLatLng(L.point(pr0.qx, pr0.qy)))
    setDrawPts((p) => [...p, ...add.map((ll) => [ll.lat, ll.lng])])
    setNotice('')
  }
  const cancelDraw = () => { setDrawing(false); setDrawPts([]); setNewArea(null) }
  const saveNew = async () => {
    if (!ctx?.club?.id || drawPts.length < 3) return
    setSavingArea(true)
    try {
      const ring = drawPts.map(([lat, lon]) => [lon, lat])
      const type = newArea.type || 'other'
      const saved = await cmdb.saveArea({
        clubId: ctx.club.id, courseId, hole: newArea.hole ? Number(newArea.hole) : null, type,
        name: newArea.name || `${typeLabel(type)}${newArea.hole ? ' ' + newArea.hole : ''}`, ring, sqft: geodesicAreaSqft(ring),
      })
      if (newArea.color && saved?.id) await saveAreaColor(saved.id, newArea.color)
      await reloadAreas()
    } catch (e) { console.error(e) }
    setSavingArea(false); setDrawing(false); setDrawPts([]); setNewArea(null)
  }

  const startEdit = () => { if (!selArea) return; editRingRef.current = selArea.ring.map((p) => [...p]); setEditRing(selArea.ring.map((p) => [...p])); setLiveSqft(geodesicAreaSqft(selArea.ring)); setEditing(true) }
  const cancelEdit = () => { setEditing(false); setEditRing(null); setLiveSqft(null); editRingRef.current = null }
  const saveEdit = async () => {
    if (!selArea || !editRingRef.current) return
    setSavingArea(true)
    try {
      const ring = editRingRef.current
      await cmdb.saveArea({ id: selArea.id, hole: selArea.hole, type: selArea.type, name: selArea.name, ring, sqft: geodesicAreaSqft(ring) })
      await reloadAreas()
    } catch (e) { console.error(e) }
    setSavingArea(false); setEditing(false); setEditRing(null); setLiveSqft(null); editRingRef.current = null
  }
  const removeArea = async () => {
    if (!selArea || !window.confirm(`Delete ${selArea.name || typeLabel(selArea.type)}? This can't be undone.`)) return
    setSavingArea(true)
    try { await cmdb.deleteArea(selArea.id); setSelAreaId(null); setEditing(false); await reloadAreas() } catch (e) { console.error(e) }
    setSavingArea(false)
  }
  // Rename / re-type / recolour an existing shape (keeps its outline).
  const saveAreaDetails = async (patch) => {
    if (!selArea) return
    setSavingArea(true)
    try {
      const type = patch.type || selArea.type || 'other'
      await cmdb.saveArea({ id: selArea.id, clubId: ctx.club.id, courseId, hole: selArea.hole, type, name: patch.name || `${typeLabel(type)}${selArea.hole ? ' ' + selArea.hole : ''}`, ring: selArea.ring, sqft: selArea.sqft ?? geodesicAreaSqft(selArea.ring) })
      if (patch.color) await saveAreaColor(selArea.id, patch.color)
      await reloadAreas()
    } catch (e) { console.error(e) }
    setSavingArea(false)
  }

  // ---- hooks done ----
  if (loading) return <div className={`${PAGE} py-16`}><p className="font-body text-[13px] text-center" style={{ color: INK_2 }}>Loading the course map…</p></div>


  return (
    <div className={`${PAGE} py-5`}>
      <div className="mb-3">
        <h1 className="font-display text-2xl font-bold" style={{ color: FOREST }}>{view === 'map' ? 'Course Map' : nav?.route === 'moisture' ? 'Moisture & Wetting Agents' : 'Greens Today'}</h1>
        <div className="mt-1 h-px" style={{ width: 30, backgroundColor: GOLD }} />
        <p className="font-body text-[13px] mt-1.5" style={{ color: INK_2 }}>
          {view === 'map'
            ? `${ctx?.club?.name || 'Your club'} · ${ctx?.courses?.[0]?.name || 'Blue'} · aerial, areas & square footage`
            : `${ctx?.club?.name || 'Your club'} · ${ctx?.courses?.[0]?.name || 'Blue'} · moisture, targets & wetting-agent wear-off · target ${targetTxt}`}
        </p>
      </div>

      {view === 'today' && (
        <div className="flex gap-1.5 border-b mb-4" style={{ borderColor: HAIR }}>
          {[['greens', 'Greens today'], ['targets', 'Targets'], ['wetting', 'Wetting agents']].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className="font-body text-[13px] font-bold px-3.5 py-2 transition"
              style={tab === k ? { color: FOREST, borderBottom: `2.5px solid ${GOLD}` } : { color: INK_3, borderBottom: '2.5px solid transparent' }}>{label}</button>
          ))}
        </div>
      )}

      {notice && <div className="mb-3 rounded-xl px-3 py-2 font-body text-[12px] flex items-center justify-between" style={{ backgroundColor: '#FBF2E0', color: '#B7791F' }}><span>{notice}</span><button onClick={() => setNotice('')} className="font-bold px-2">×</button></div>}

      {tab === 'map' && (
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {imagery.length > 0 && (
              <select value={selId} onChange={(e) => setSelId(e.target.value)} className="font-body text-[12px] font-bold px-2.5 py-2 rounded-xl bg-white" style={{ border: `1px solid ${HAIR}`, color: FOREST }}>
                {imagery.map((i) => <option key={i.id} value={i.id}>{i.capturedOn ? formatDate(i.capturedOn, 'header') : 'Photo'} · {i.source}</option>)}
              </select>
            )}
            <label className="flex items-center gap-1.5 font-body text-[12px]" style={{ color: INK_2 }}>
              <Layers size={14} /> Opacity
              <input type="range" min="0.2" max="1" step="0.05" value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
            </label>
            {manage && (
              <button onClick={() => setAddOpen((v) => !v)} className="ml-auto inline-flex items-center gap-1.5 font-body text-[12px] font-bold px-3 py-2 rounded-xl text-white" style={{ backgroundColor: FOREST }}>
                <Upload size={14} /> Add photo
              </button>
            )}
          </div>

          {addOpen && manage && (
            <AddPhoto
              courses={ctx?.courses || []} clubId={ctx?.club?.id} defaultCourseId={courseId}
              onClose={() => setAddOpen(false)}
              onDone={(msg) => { setAddOpen(false); setNotice(msg); reloadImagery() }}
            />
          )}

          {/* Area toolbar */}
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <button onClick={() => setShowAreas((v) => !v)} className="font-body text-[12px] font-bold px-3 py-1.5 rounded-full" style={showAreas ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: INK_2, border: `1px solid ${HAIR}` }}>Areas</button>
            {manage && !drawing && <button onClick={startDraw} className="font-body text-[12px] font-bold px-3 py-1.5 rounded-full text-white" style={{ backgroundColor: FERN }}>+ Draw area</button>}
            <button onClick={() => setShowTotals((v) => !v)} className="font-body text-[12px] font-bold px-3 py-1.5 rounded-full" style={{ backgroundColor: 'white', color: INK_2, border: `1px solid ${HAIR}` }}>{ctx?.courses?.[0]?.name || 'Course'} totals</button>
            {manage && <button onClick={() => setShowColors((v) => !v)} className="font-body text-[12px] font-bold px-3 py-1.5 rounded-full" style={showColors ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: INK_2, border: `1px solid ${HAIR}` }}>Default colours</button>}
            {drawing && (
              <div className="flex items-center gap-2 ml-1">
                <span className="font-body text-[12px]" style={{ color: FERN }}>{penOn ? 'Hold & drag to draw' : 'Tap the map to drop corners'} ({drawPts.length})</span>
                <button onClick={() => setPenOn((v) => !v)} title="Freehand pen — hold and drag to trace the outline instead of tapping corners" className="font-body text-[12px] font-bold px-2.5 py-1.5 rounded-lg" style={penOn ? { backgroundColor: FOREST, color: '#fff' } : { border: `1px solid ${HAIR}`, color: INK_2 }}>Pen {penOn ? 'on' : 'off'}</button>
                <button onClick={() => setSnapOn((v) => !v)} title="Snap new corners onto the lines of areas you've already drawn" className="font-body text-[12px] font-bold px-2.5 py-1.5 rounded-lg" style={snapOn ? { backgroundColor: FOREST, color: '#fff' } : { border: `1px solid ${HAIR}`, color: INK_2 }}>Snap {snapOn ? 'on' : 'off'}</button>
                <button onClick={followLine} disabled={drawPts.length < 2} title="Trace the rest of the shape along a neighbouring area's line so they share the exact border" className="font-body text-[12px] font-bold px-2.5 py-1.5 rounded-lg disabled:opacity-40" style={{ border: `1px solid ${HAIR}`, color: FOREST }}>Follow line</button>
                <button onClick={smoothDraw} disabled={drawPts.length < 3} title="Round the corners into smooth curves instead of straight lines (tap again for more)" className="font-body text-[12px] font-bold px-2.5 py-1.5 rounded-lg disabled:opacity-40" style={{ border: `1px solid ${HAIR}`, color: FOREST }}>Smooth</button>
                <button onClick={() => setDrawPts((p) => p.slice(0, -1))} disabled={!drawPts.length} className="font-body text-[12px] font-bold px-2.5 py-1.5 rounded-lg disabled:opacity-40" style={{ border: `1px solid ${HAIR}`, color: INK_2 }}>Undo</button>
                <button onClick={finishDraw} disabled={drawPts.length < 3} className="font-body text-[12px] font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>Finish</button>
                <button onClick={cancelDraw} className="font-body text-[12px] font-bold px-2.5 py-1.5 rounded-lg" style={{ color: INK_2 }}>Cancel</button>
              </div>
            )}
          </div>

          {showColors && manage && (
            <TypeDefaults typeColors={typeColors} onPick={saveTypeColor} onClose={() => setShowColors(false)} />
          )}

          {newArea && (
            <NewAreaForm value={newArea} onChange={setNewArea} sqft={geodesicAreaSqft(drawPts.map(([lat, lon]) => [lon, lat]))} busy={savingArea} onSave={saveNew} onCancel={cancelDraw} defColor={defColor} />
          )}

          <div ref={elRef} style={{ height: '80vh', minHeight: 520, borderRadius: 16, overflow: 'hidden', border: `1px solid ${HAIR}`, backgroundColor: '#0e1f16' }} />
          {imagery.length === 0 && (
            <p className="font-body text-[12px] mt-2" style={{ color: INK_3 }}>No photo yet — the satellite basemap is shown. {manage ? 'Tap “Add photo” to place your aerial.' : ''}</p>
          )}

          {selArea && (
            <AreaPanel
              area={selArea} editing={editing} liveSqft={liveSqft} manage={manage} busy={savingArea} color={colorOf(selArea)}
              onEdit={startEdit} onSave={saveEdit} onCancelEdit={cancelEdit} onDelete={removeArea} onClose={() => { setSelAreaId(null); cancelEdit() }} onSaveDetails={saveAreaDetails} onSnapNeighbours={snapNeighbours} defColor={defColor}
            />
          )}

          {showTotals && <CourseTotals areas={areas} />}
        </div>
      )}

      {tab === 'greens' && <GreensToday ctx={ctx} courseId={courseId} manage={manage} user={user} activeImagery={imagery.find((i) => i.id === selId) || null} />}
      {tab === 'targets' && <MoistureTargets ctx={ctx} courseId={courseId} manage={manage} />}
      {tab === 'wetting' && <WettingAgentPane onGoGreens={() => setTab('greens')} />}
    </div>
  )
}

// The wetting-agent wear-off tracker, now a tab of the moisture screen. It loads
// its own settings + weather so it stands alone here. "Add readings" sends the
// user to the Greens today tab, where readings are entered.
function WettingAgentPane({ onGoGreens }) {
  const [state, setState] = useState(null)
  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const s = await db.fetchSettings()
        let daily = []
        if (s.location?.lat != null) {
          try {
            const [season, wxData] = await Promise.all([
              fetchSeasonDaily(s.location.lat, s.location.lng).catch(() => []),
              fetchWeather(s.location.lat, s.location.lng).catch(() => null),
            ])
            daily = mergeDaily(season || [], wxData ? dailyFromForecastBlock(wxData) : [])
          } catch { /* ignore */ }
        }
        if (live) setState({ courseInfo: s.courseInfo || {}, areas: s.areas || {}, location: s.location, daily })
      } catch { if (live) setState({ courseInfo: {}, areas: {}, location: null, daily: [] }) }
    })()
    return () => { live = false }
  }, [])
  const saveCourse = async (patch) => {
    setState((st) => (st ? { ...st, courseInfo: { ...(st.courseInfo || {}), ...patch } } : st))
    try { const s = await db.fetchSettings(); await db.saveSettings({ courseInfo: { ...(s.courseInfo || {}), ...patch } }) } catch (e) { console.error(e) }
  }
  if (!state) return <p className="font-body text-[13px] py-10 text-center" style={{ color: INK_3 }}>Loading…</p>
  return <WettingAgent daily={state.daily} areas={state.areas} courseInfo={state.courseInfo} location={state.location} onSaveCourse={saveCourse} onAppNav={() => onGoGreens && onGoGreens()} />
}

// ── Add photo ──────────────────────────────────────────────────────────────
export function AddPhoto({ courses, clubId, defaultCourseId, onClose, onDone }) {
  const [file, setFile] = useState(null)
  const [worldFile, setWorldFile] = useState(null)
  const [courseId, setCourseId] = useState(defaultCourseId || courses[0]?.id || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [preview, setPreview] = useState('')

  const nm = file ? parseNearmapName(file.name) : null

  async function imageDims(f) {
    return new Promise((res, rej) => {
      const img = new Image()
      img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = () => rej(new Error('Could not read that image.'))
      img.src = URL.createObjectURL(f)
    })
  }

  async function go() {
    if (!file || !clubId) return
    setBusy(true); setErr('')
    try {
      const dims = await imageDims(file)
      let georef, capturedOn = null
      if (worldFile) {
        const p = parseWorldFile(await worldFile.text())
        if (!p) throw new Error('Could not read that world file.')
        georef = { ul_x: p.C, ul_y: p.F, px_size_x: p.A, px_size_y: p.E, width_px: dims.w, height_px: dims.h }
      } else if (nm) {
        const ul = upperLeftFromCenter(nm.lon, nm.lat, nm.mpp, dims.w, dims.h)
        georef = { ...ul, width_px: dims.w, height_px: dims.h }
        capturedOn = nm.capturedOn
      } else {
        throw new Error('This photo has no position. Add its world file (.jgw/.pgw/.wld) alongside it, or use a Nearmap-named file. (Tap-to-align comes next.)')
      }
      await cmdb.uploadImagery({ file, clubId, courseId, georef, source: 'upload', capturedOn })
      onDone(`Placed ${file.name}.`)
    } catch (e) { setErr(e.message || 'Upload failed.'); setBusy(false) }
  }

  return (
    <div className="rounded-2xl border p-4 mb-3" style={{ borderColor: HAIR, backgroundColor: PAPER }}>
      <p className="font-body text-[12.5px] mb-2" style={{ color: INK_2 }}>Upload a GeoTIFF or a JPG/PNG. If it's a plain JPG/PNG, also add its world file (<code>.jgw</code>), or use a Nearmap file whose name has the position.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="font-body text-[11px] font-bold uppercase" style={{ color: INK_3 }}>Photo</label>
          <input type="file" accept=".jpg,.jpeg,.png,.tif,.tiff" onChange={(e) => { setFile(e.target.files?.[0] || null); setErr('') }} className="block mt-1 font-body text-[12px]" />
        </div>
        <div>
          <label className="font-body text-[11px] font-bold uppercase" style={{ color: INK_3 }}>World file (optional)</label>
          <input type="file" accept=".jgw,.pgw,.wld,.tfw" onChange={(e) => setWorldFile(e.target.files?.[0] || null)} className="block mt-1 font-body text-[12px]" />
        </div>
      </div>
      {file && (
        <p className="font-body text-[11.5px] mt-2" style={{ color: nm ? FERN : INK_3 }}>
          {nm ? `Position read from the file name: ${nm.lat.toFixed(5)}, ${nm.lon.toFixed(5)} · ${nm.mpp} m/px${nm.capturedOn ? ` · ${nm.capturedOn}` : ''}` : worldFile ? 'Will place it from the world file.' : 'No position yet — add a world file or use a Nearmap-named file.'}
        </p>
      )}
      {courses.length > 1 && (
        <div className="mt-2">
          <label className="font-body text-[11px] font-bold uppercase mr-2" style={{ color: INK_3 }}>Course</label>
          <select value={courseId} onChange={(e) => setCourseId(e.target.value)} className="font-body text-[12px] px-2 py-1.5 rounded-lg bg-white" style={{ border: `1px solid ${HAIR}` }}>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      {err && <p className="font-body text-[12px] mt-2" style={{ color: '#B23A2E' }}>{err}</p>}
      <div className="flex justify-end gap-2 mt-3">
        <button onClick={onClose} className="font-body text-[12px] font-bold px-3 py-1.5 rounded-lg" style={{ color: INK_2 }}>Cancel</button>
        <button onClick={go} disabled={busy || !file || (!worldFile && !nm)} className="font-body text-[12px] font-bold px-4 py-1.5 rounded-lg text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>{busy ? 'Uploading…' : 'Place & upload'}</button>
      </div>
    </div>
  )
}

// A type dropdown that also lets you type your own type, plus a colour picker.
function TypeColorRow({ value, onChange, defColor }) {
  const dc = defColor || typeColor
  const isCustom = !AREA_TYPES.some((x) => x[0] === value.type)
  const curColor = value.color || dc(value.type)
  const pickType = (t) => {
    if (t === '__custom__') { onChange({ ...value, type: '' }); return }
    // follow the new type's default colour unless the user set a custom one
    onChange({ ...value, type: t, color: value.color && value.colorManual ? value.color : undefined })
  }
  return (
    <>
      <div>
        <label className="font-body text-[10px] font-bold uppercase block" style={{ color: INK_3 }}>Type</label>
        <select value={isCustom ? '__custom__' : value.type} onChange={(e) => pickType(e.target.value)} className="font-body text-[12px] px-2 py-1.5 rounded-lg bg-white mt-0.5" style={{ border: `1px solid ${HAIR}` }}>
          {AREA_TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          <option value="__custom__">+ Custom…</option>
        </select>
      </div>
      {isCustom && (
        <div>
          <label className="font-body text-[10px] font-bold uppercase block" style={{ color: INK_3 }}>Custom type</label>
          <input value={value.type} onChange={(e) => onChange({ ...value, type: e.target.value })} placeholder="e.g. Wetland" className="w-28 font-body text-[12px] px-2 py-1.5 rounded-lg mt-0.5" style={{ border: `1px solid ${HAIR}` }} />
        </div>
      )}
      <div>
        <label className="font-body text-[10px] font-bold uppercase block" style={{ color: INK_3 }}>Colour</label>
        <div className="flex items-center gap-1 mt-1">
          {SWATCHES.map((c) => (
            <button key={c} type="button" onClick={() => onChange({ ...value, color: c, colorManual: true })} aria-label={c} className="w-5 h-5 rounded" style={{ backgroundColor: c, outline: curColor.toLowerCase() === c.toLowerCase() ? `2px solid ${FOREST}` : 'none', outlineOffset: 1 }} />
          ))}
          <input type="color" value={/^#([0-9a-f]{6})$/i.test(curColor) ? curColor : '#4AD07D'} onChange={(e) => onChange({ ...value, color: e.target.value, colorManual: true })} className="w-6 h-6 p-0 border-0 bg-transparent" title="Custom colour" />
        </div>
      </div>
    </>
  )
}

function NewAreaForm({ value, onChange, sqft, busy, onSave, onCancel, defColor }) {
  return (
    <div className="rounded-2xl border p-3 mb-2" style={{ borderColor: HAIR, backgroundColor: PAPER }}>
      <div className="flex flex-wrap items-end gap-3">
        <TypeColorRow value={value} onChange={onChange} defColor={defColor} />
        <div>
          <label className="font-body text-[10px] font-bold uppercase block" style={{ color: INK_3 }}>Hole</label>
          <input value={value.hole} onChange={(e) => onChange({ ...value, hole: e.target.value.replace(/[^0-9]/g, '') })} placeholder="—" className="w-16 font-body text-[12px] px-2 py-1.5 rounded-lg mt-0.5" style={{ border: `1px solid ${HAIR}` }} />
        </div>
        <div className="flex-1 min-w-[140px]">
          <label className="font-body text-[10px] font-bold uppercase block" style={{ color: INK_3 }}>Name</label>
          <input value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} placeholder={`${typeLabel(value.type) || 'Area'}${value.hole ? ' ' + value.hole : ''}`} className="w-full font-body text-[12px] px-2 py-1.5 rounded-lg mt-0.5" style={{ border: `1px solid ${HAIR}` }} />
        </div>
        <div className="font-body text-[13px]" style={{ color: INK }}><b>{formatNumber(Math.round(sqft))}</b> sqft</div>
        <div className="flex gap-2">
          <button onClick={onCancel} className="font-body text-[12px] font-bold px-3 py-1.5 rounded-lg" style={{ color: INK_2 }}>Cancel</button>
          <button onClick={onSave} disabled={busy} className="font-body text-[12px] font-bold px-4 py-1.5 rounded-lg text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>{busy ? 'Saving…' : 'Save area'}</button>
        </div>
      </div>
    </div>
  )
}

function AreaPanel({ area, editing, liveSqft, manage, busy, color, onEdit, onSave, onCancelEdit, onDelete, onClose, onSaveDetails, onSnapNeighbours, defColor }) {
  const dc = defColor || typeColor
  const [hist, setHist] = useState([])
  const [details, setDetails] = useState(null) // {type,name,color} while renaming/recolouring
  useEffect(() => { setDetails(null) }, [area.id])
  useEffect(() => { let live = true; cmdb.fetchAreaHistory(area.id).then((h) => { if (live) setHist(h) }); return () => { live = false } }, [area.id])
  const sqft = editing && liveSqft != null ? liveSqft : (area.sqft ?? geodesicAreaSqft(area.ring))
  const acres = sqft / 43560
  const perim = perimeterFt(area.ring)
  const prev = hist[0]
  return (
    <div className="rounded-2xl border p-4 mt-3" style={{ borderColor: HAIR, backgroundColor: 'white' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: color || dc(area.type) }} />
          <div>
            <p className="font-display text-[15px] font-semibold" style={{ color: FOREST }}>{area.name || `${typeLabel(area.type)}${area.hole ? ' ' + area.hole : ''}`}</p>
            <p className="font-body text-[11px]" style={{ color: INK_3 }}>{typeLabel(area.type)}{area.hole ? ` · hole ${area.hole}` : ''}</p>
          </div>
        </div>
        <button onClick={onClose} className="font-body text-xl px-2" style={{ color: INK_3 }} aria-label="Close">×</button>
      </div>
      {details && (
        <div className="rounded-xl border p-2.5 mt-3" style={{ borderColor: HAIR, backgroundColor: PAPER }}>
          <div className="flex flex-wrap items-end gap-3">
            <TypeColorRow value={details} onChange={setDetails} defColor={dc} />
            <div className="flex-1 min-w-[120px]">
              <label className="font-body text-[10px] font-bold uppercase block" style={{ color: INK_3 }}>Name</label>
              <input value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} placeholder={typeLabel(details.type) || 'Area'} className="w-full font-body text-[12px] px-2 py-1.5 rounded-lg mt-0.5" style={{ border: `1px solid ${HAIR}` }} />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setDetails(null)} className="font-body text-[12px] font-bold px-3 py-1.5 rounded-lg" style={{ color: INK_2 }}>Cancel</button>
              <button onClick={() => { onSaveDetails && onSaveDetails(details); setDetails(null) }} disabled={busy} className="font-body text-[12px] font-bold px-4 py-1.5 rounded-lg text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
      <div className="flex items-end gap-4 mt-2">
        <div>
          <p className="font-display text-2xl font-bold" style={{ color: INK }}>{formatNumber(Math.round(sqft))}<span className="font-body text-[13px] font-normal" style={{ color: INK_3 }}> sqft</span></p>
          <p className="font-body text-[11.5px]" style={{ color: INK_2 }}>{acres.toFixed(2)} acres · {formatNumber(Math.round(perim))} ft perimeter</p>
        </div>
      </div>
      {prev && prev.sqft != null && (
        <p className="font-body text-[11.5px] mt-1" style={{ color: INK_3 }}>
          Was {formatNumber(Math.round(prev.sqft))} sqft (traced {formatDate(prev.changedAt, 'header')}) · {sqft - prev.sqft >= 0 ? '+' : '−'}{formatNumber(Math.abs(Math.round(sqft - prev.sqft)))}
        </p>
      )}
      {manage && (
        <div className="flex gap-2 mt-3">
          {!editing ? (
            <>
              <button onClick={onEdit} className="font-body text-[12px] font-bold px-3 py-1.5 rounded-lg text-white" style={{ backgroundColor: FOREST }}>Edit shape</button>
              <button onClick={() => setDetails({ type: area.type, name: area.name || '', color: color || dc(area.type), colorManual: !!color })} className="font-body text-[12px] font-bold px-3 py-1.5 rounded-lg" style={{ color: FOREST, border: `1px solid ${HAIR}` }}>Rename / colour</button>
              <button onClick={onDelete} disabled={busy} className="font-body text-[12px] font-bold px-3 py-1.5 rounded-lg" style={{ color: '#B23A2E', border: `1px solid ${HAIR}` }}>Delete</button>
            </>
          ) : (
            <>
              <span className="font-body text-[11.5px] self-center" style={{ color: FERN }}>Drag the dots to reshape</span>
              {onSnapNeighbours && <button onClick={onSnapNeighbours} title="Pull any point sitting close to another area's line exactly onto it" className="font-body text-[12px] font-bold px-3 py-1.5 rounded-lg" style={{ color: FOREST, border: `1px solid ${HAIR}` }}>Snap to lines</button>}
              <button onClick={onSave} disabled={busy} className="font-body text-[12px] font-bold px-4 py-1.5 rounded-lg text-white disabled:opacity-40 ml-auto" style={{ backgroundColor: FOREST }}>{busy ? 'Saving…' : 'Save'}</button>
              <button onClick={onCancelEdit} className="font-body text-[12px] font-bold px-3 py-1.5 rounded-lg" style={{ color: INK_2 }}>Cancel</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// Set a saved default colour per type. New shapes of a type take its default
// automatically — no need to pick a colour each time. Shapes keep any colour
// set on them individually; everything else follows the type default live.
function TypeDefaults({ typeColors, onPick, onClose }) {
  const [custom, setCustom] = useState('')
  const rows = [...AREA_TYPES, ...Object.keys(typeColors).filter((t) => !AREA_TYPES.some((x) => x[0] === t)).map((t) => [t, t, '#9AA6B2'])]
  return (
    <div className="rounded-2xl border p-3 mb-2" style={{ borderColor: HAIR, backgroundColor: PAPER }}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="font-display text-[14px] font-semibold" style={{ color: FOREST }}>Default colours</p>
          <p className="font-body text-[11px]" style={{ color: INK_3 }}>New shapes use their type’s colour automatically. Change one here and it applies everywhere.</p>
        </div>
        <button onClick={onClose} className="font-body text-xl px-2" style={{ color: INK_3 }} aria-label="Close">×</button>
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
        {rows.map(([k, label, builtin]) => {
          const cur = typeColors[k] || builtin
          const overridden = !!typeColors[k]
          return (
            <div key={k} className="rounded-xl border p-2" style={{ borderColor: HAIR, backgroundColor: 'white' }}>
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded" style={{ backgroundColor: cur }} />
                <span className="font-body text-[12px] font-semibold flex-1" style={{ color: INK }}>{label}</span>
                {overridden && <button onClick={() => onPick(k, null)} className="font-body text-[10px] font-bold" style={{ color: INK_3 }} title="Back to built-in colour">reset</button>}
              </div>
              <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                {SWATCHES.map((c) => (
                  <button key={c} type="button" onClick={() => onPick(k, c)} aria-label={c} className="w-5 h-5 rounded" style={{ backgroundColor: c, outline: cur.toLowerCase() === c.toLowerCase() ? `2px solid ${FOREST}` : 'none', outlineOffset: 1 }} />
                ))}
                <input type="color" value={/^#([0-9a-f]{6})$/i.test(cur) ? cur : '#4AD07D'} onChange={(e) => onPick(k, e.target.value)} className="w-6 h-6 p-0 border-0 bg-transparent" title="Custom colour" />
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-2 mt-2">
        <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Add a type (e.g. Wetland)" className="font-body text-[12px] px-2 py-1.5 rounded-lg bg-white" style={{ border: `1px solid ${HAIR}` }} />
        <button onClick={() => { const t = custom.trim(); if (t && !typeColors[t]) { onPick(t, '#9AA6B2'); setCustom('') } }} disabled={!custom.trim()} className="font-body text-[12px] font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-40" style={{ backgroundColor: FERN }}>Add type</button>
      </div>
    </div>
  )
}

function CourseTotals({ areas }) {
  const rows = AREA_TYPES.map(([k, label, color]) => {
    const list = areas.filter((a) => a.type === k)
    const sqft = list.reduce((s, a) => s + (a.sqft ?? geodesicAreaSqft(a.ring)), 0)
    return { k, label, color, count: list.length, sqft, acres: sqft / 43560, avg: list.length ? sqft / list.length : 0 }
  }).filter((r) => r.count > 0)
  const total = rows.reduce((a, r) => ({ count: a.count + r.count, sqft: a.sqft + r.sqft }), { count: 0, sqft: 0 })
  return (
    <div className="rounded-2xl border mt-3 overflow-x-auto" style={{ borderColor: HAIR, backgroundColor: 'white' }}>
      <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: 520 }}>
        <thead><tr style={{ backgroundColor: PAPER }}>{['Type', 'Count', 'Sqft', 'Acres', 'Avg sqft'].map((h, i) => <th key={h} className={`font-body text-[10px] font-bold uppercase px-3 py-2 ${i === 0 ? 'text-left' : 'text-right'}`} style={{ color: INK_3 }}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.k} className="border-t" style={{ borderColor: HAIR }}>
              <td className="px-3 py-1.5 font-body text-[12px] font-semibold" style={{ color: INK }}><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5 align-middle" style={{ backgroundColor: r.color }} />{r.label}</td>
              <td className="px-3 py-1.5 font-body text-[12px] text-right tabular-nums" style={{ color: INK }}>{r.count}</td>
              <td className="px-3 py-1.5 font-body text-[12px] text-right tabular-nums" style={{ color: INK }}>{formatNumber(Math.round(r.sqft))}</td>
              <td className="px-3 py-1.5 font-body text-[12px] text-right tabular-nums" style={{ color: INK }}>{r.acres.toFixed(2)}</td>
              <td className="px-3 py-1.5 font-body text-[12px] text-right tabular-nums" style={{ color: INK }}>{formatNumber(Math.round(r.avg))}</td>
            </tr>
          ))}
          <tr className="border-t" style={{ borderColor: HAIR, backgroundColor: '#EFF3EF' }}>
            <td className="px-3 py-1.5 font-body text-[12px] font-bold" style={{ color: FOREST }}>Total</td>
            <td className="px-3 py-1.5 font-body text-[12px] text-right tabular-nums font-bold" style={{ color: INK }}>{total.count}</td>
            <td className="px-3 py-1.5 font-body text-[12px] text-right tabular-nums font-bold" style={{ color: INK }}>{formatNumber(Math.round(total.sqft))}</td>
            <td className="px-3 py-1.5 font-body text-[12px] text-right tabular-nums font-bold" style={{ color: INK }}>{(total.sqft / 43560).toFixed(2)}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  )
}


function Placeholder({ title, note, phase }) {
  return (
    <div className="rounded-2xl border border-dashed p-10 text-center" style={{ borderColor: HAIR }}>
      <p className="font-display text-[15px] font-semibold" style={{ color: FOREST }}>{title}</p>
      <p className="font-body text-[12px] mt-1" style={{ color: INK_2 }}>{note}</p>
      <p className="font-body text-[11px] mt-2 inline-block px-2.5 py-1 rounded-full" style={{ backgroundColor: '#E8E7E2', color: INK_3 }}>Phase {phase}</p>
    </div>
  )
}
