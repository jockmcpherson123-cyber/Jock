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
import GreensToday, { MoistureTargets } from '@/components/GreensToday'
import { resolveTarget } from '@/lib/coursemap/targets'
import { parseWorldFile, parseNearmapName, upperLeftFromCenter, worldFileCorners, geodesicAreaSqft, perimeterFt } from '@/lib/coursemap/geo'
import { formatDate, formatNumber } from '@/lib/format'

const AREA_TYPES = [['green', 'Green', '#22C55E'], ['approach', 'Approach', '#A3E635'], ['fairway', 'Fairway', '#4AD07D'], ['tee', 'Tee', '#14B8A6'], ['bunker', 'Bunker', '#E8D8A0'], ['other', 'Other', '#9AA6B2']]
const typeColor = (t) => (AREA_TYPES.find((x) => x[0] === t) || [])[2] || '#9AA6B2'
const typeLabel = (t) => (AREA_TYPES.find((x) => x[0] === t) || [, t])[1]

const PAGE = 'max-w-[1200px] mx-auto px-4 sm:px-6'
const SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const SAT_ATTR = 'Imagery © Esri, Maxar, Earthstar Geographics'
const CONGRESSIONAL = [38.9966, -77.1803]

const canManage = (role) => role === 'assistant' || role === 'superintendent' || role === 'director'

export default function GreensMap({ user }) {
  const manage = canManage(user?.role)
  const [tab, setTab] = useState('map') // Phase A ships the Map tab
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
  const [liveSqft, setLiveSqft] = useState(null)  // sqft while dragging vertices
  const [showTotals, setShowTotals] = useState(false)
  const [savingArea, setSavingArea] = useState(false)
  const [newArea, setNewArea] = useState(null) // {hole,type,name} while naming a freshly drawn shape

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
      const poly = L.polygon(a.ring.map(([lon, lat]) => [lat, lon]), { color: typeColor(a.type), weight: sel ? 3 : 1.5, opacity: 0.95, fillOpacity: sel ? 0.35 : 0.15 })
      poly.on('click', (e) => { L.DomEvent.stop(e); if (!drawing) { setSelAreaId(a.id); setEditing(false) } })
      poly.addTo(grp)
    }
    areasLayerRef.current = grp
  }, [mapReady, tab, areas, selAreaId, showAreas, editing, drawing])

  // Draw mode: collect taps as polygon corners.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !drawing) return
    const onClick = (e) => setDrawPts((p) => [...p, [e.latlng.lat, e.latlng.lng]])
    map.on('click', onClick)
    const el = map.getContainer(); const prev = el.style.cursor; el.style.cursor = 'crosshair'
    return () => { map.off('click', onClick); el.style.cursor = prev }
  }, [drawing])

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
  }, [editing, selAreaId])

  const reloadImagery = async () => {
    const imgs = await cmdb.fetchImagery(courseId)
    setImagery(imgs)
    if (imgs[0]) setSelId(imgs[0].id)
  }

  const selArea = areas.find((a) => a.id === selAreaId) || null

  const startDraw = () => { setSelAreaId(null); setEditing(false); setNewArea(null); setDrawPts([]); setDrawing(true) }
  const finishDraw = () => { if (drawPts.length >= 3) setNewArea({ hole: '', type: 'green', name: '' }) }
  const cancelDraw = () => { setDrawing(false); setDrawPts([]); setNewArea(null) }
  const saveNew = async () => {
    if (!ctx?.club?.id || drawPts.length < 3) return
    setSavingArea(true)
    try {
      const ring = drawPts.map(([lat, lon]) => [lon, lat])
      await cmdb.saveArea({
        clubId: ctx.club.id, courseId, hole: newArea.hole ? Number(newArea.hole) : null, type: newArea.type,
        name: newArea.name || `${typeLabel(newArea.type)}${newArea.hole ? ' ' + newArea.hole : ''}`, ring, sqft: geodesicAreaSqft(ring),
      })
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

  // ---- hooks done ----
  if (loading) return <div className={`${PAGE} py-16`}><p className="font-body text-[13px] text-center" style={{ color: INK_2 }}>Loading the course map…</p></div>


  return (
    <div className={`${PAGE} py-5`}>
      <div className="mb-3">
        <h1 className="font-display text-2xl font-bold" style={{ color: FOREST }}>Course Map</h1>
        <div className="mt-1 h-px" style={{ width: 30, backgroundColor: GOLD }} />
        <p className="font-body text-[13px] mt-1.5" style={{ color: INK_2 }}>{ctx?.club?.name || 'Your club'} · {ctx?.courses?.[0]?.name || 'Blue'} · from DEACON · target {targetTxt}</p>
      </div>

      <div className="flex gap-1.5 border-b mb-4" style={{ borderColor: HAIR }}>
        {[['greens', 'Greens today'], ['map', 'Map'], ['targets', 'Targets']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className="font-body text-[13px] font-bold px-3.5 py-2 transition"
            style={tab === k ? { color: FOREST, borderBottom: `2.5px solid ${GOLD}` } : { color: INK_3, borderBottom: '2.5px solid transparent' }}>{label}</button>
        ))}
      </div>

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
            {drawing && (
              <div className="flex items-center gap-2 ml-1">
                <span className="font-body text-[12px]" style={{ color: FERN }}>Tap the map to drop corners ({drawPts.length})</span>
                <button onClick={() => setDrawPts((p) => p.slice(0, -1))} disabled={!drawPts.length} className="font-body text-[12px] font-bold px-2.5 py-1.5 rounded-lg disabled:opacity-40" style={{ border: `1px solid ${HAIR}`, color: INK_2 }}>Undo</button>
                <button onClick={finishDraw} disabled={drawPts.length < 3} className="font-body text-[12px] font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>Finish</button>
                <button onClick={cancelDraw} className="font-body text-[12px] font-bold px-2.5 py-1.5 rounded-lg" style={{ color: INK_2 }}>Cancel</button>
              </div>
            )}
          </div>

          {newArea && (
            <NewAreaForm value={newArea} onChange={setNewArea} sqft={geodesicAreaSqft(drawPts.map(([lat, lon]) => [lon, lat]))} busy={savingArea} onSave={saveNew} onCancel={cancelDraw} />
          )}

          <div ref={elRef} style={{ height: '80vh', minHeight: 520, borderRadius: 16, overflow: 'hidden', border: `1px solid ${HAIR}`, backgroundColor: '#0e1f16' }} />
          {imagery.length === 0 && (
            <p className="font-body text-[12px] mt-2" style={{ color: INK_3 }}>No photo yet — the satellite basemap is shown. {manage ? 'Tap “Add photo” to place your aerial.' : ''}</p>
          )}

          {selArea && (
            <AreaPanel
              area={selArea} editing={editing} liveSqft={liveSqft} manage={manage} busy={savingArea}
              onEdit={startEdit} onSave={saveEdit} onCancelEdit={cancelEdit} onDelete={removeArea} onClose={() => { setSelAreaId(null); cancelEdit() }}
            />
          )}

          {showTotals && <CourseTotals areas={areas} />}
        </div>
      )}

      {tab === 'greens' && <GreensToday ctx={ctx} courseId={courseId} manage={manage} user={user} activeImagery={imagery.find((i) => i.id === selId) || null} />}
      {tab === 'targets' && <MoistureTargets ctx={ctx} courseId={courseId} manage={manage} />}
    </div>
  )
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

function NewAreaForm({ value, onChange, sqft, busy, onSave, onCancel }) {
  return (
    <div className="rounded-2xl border p-3 mb-2" style={{ borderColor: HAIR, backgroundColor: PAPER }}>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="font-body text-[10px] font-bold uppercase block" style={{ color: INK_3 }}>Type</label>
          <select value={value.type} onChange={(e) => onChange({ ...value, type: e.target.value })} className="font-body text-[12px] px-2 py-1.5 rounded-lg bg-white mt-0.5" style={{ border: `1px solid ${HAIR}` }}>
            {AREA_TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>
        <div>
          <label className="font-body text-[10px] font-bold uppercase block" style={{ color: INK_3 }}>Hole</label>
          <input value={value.hole} onChange={(e) => onChange({ ...value, hole: e.target.value.replace(/[^0-9]/g, '') })} placeholder="—" className="w-16 font-body text-[12px] px-2 py-1.5 rounded-lg mt-0.5" style={{ border: `1px solid ${HAIR}` }} />
        </div>
        <div className="flex-1 min-w-[140px]">
          <label className="font-body text-[10px] font-bold uppercase block" style={{ color: INK_3 }}>Name</label>
          <input value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} placeholder={`${typeLabel(value.type)}${value.hole ? ' ' + value.hole : ''}`} className="w-full font-body text-[12px] px-2 py-1.5 rounded-lg mt-0.5" style={{ border: `1px solid ${HAIR}` }} />
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

function AreaPanel({ area, editing, liveSqft, manage, busy, onEdit, onSave, onCancelEdit, onDelete, onClose }) {
  const [hist, setHist] = useState([])
  useEffect(() => { let live = true; cmdb.fetchAreaHistory(area.id).then((h) => { if (live) setHist(h) }); return () => { live = false } }, [area.id])
  const sqft = editing && liveSqft != null ? liveSqft : (area.sqft ?? geodesicAreaSqft(area.ring))
  const acres = sqft / 43560
  const perim = perimeterFt(area.ring)
  const prev = hist[0]
  return (
    <div className="rounded-2xl border p-4 mt-3" style={{ borderColor: HAIR, backgroundColor: 'white' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: typeColor(area.type) }} />
          <div>
            <p className="font-display text-[15px] font-semibold" style={{ color: FOREST }}>{area.name || `${typeLabel(area.type)}${area.hole ? ' ' + area.hole : ''}`}</p>
            <p className="font-body text-[11px]" style={{ color: INK_3 }}>{typeLabel(area.type)}{area.hole ? ` · hole ${area.hole}` : ''}</p>
          </div>
        </div>
        <button onClick={onClose} className="font-body text-xl px-2" style={{ color: INK_3 }} aria-label="Close">×</button>
      </div>
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
              <button onClick={onDelete} disabled={busy} className="font-body text-[12px] font-bold px-3 py-1.5 rounded-lg" style={{ color: '#B23A2E', border: `1px solid ${HAIR}` }}>Delete</button>
            </>
          ) : (
            <>
              <span className="font-body text-[11.5px] self-center" style={{ color: FERN }}>Drag the dots to reshape</span>
              <button onClick={onSave} disabled={busy} className="font-body text-[12px] font-bold px-4 py-1.5 rounded-lg text-white disabled:opacity-40 ml-auto" style={{ backgroundColor: FOREST }}>{busy ? 'Saving…' : 'Save'}</button>
              <button onClick={onCancelEdit} className="font-body text-[12px] font-bold px-3 py-1.5 rounded-lg" style={{ color: INK_2 }}>Cancel</button>
            </>
          )}
        </div>
      )}
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
