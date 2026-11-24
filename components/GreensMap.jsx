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
import { parseWorldFile, parseNearmapName, upperLeftFromCenter, worldFileCorners } from '@/lib/coursemap/geo'
import { formatDate } from '@/lib/format'

const PAGE = 'max-w-[1200px] mx-auto px-4 sm:px-6'
const SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const SAT_ATTR = 'Imagery © Esri, Maxar, Earthstar Geographics'
const CONGRESSIONAL = [38.9966, -77.1803]

const canManage = (role) => role === 'assistant' || role === 'superintendent' || role === 'director'

export default function GreensMap({ user }) {
  const manage = canManage(user?.role)
  const [tab, setTab] = useState('map') // Phase A ships the Map tab
  const [ctx, setCtx] = useState(null)
  const [courseId, setCourseId] = useState('')
  const [imagery, setImagery] = useState([])
  const [selId, setSelId] = useState('')
  const [opacity, setOpacity] = useState(1)
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [notice, setNotice] = useState('')

  const LRef = useRef(null)
  const mapRef = useRef(null)
  const elRef = useRef(null)
  const overlayRef = useRef(null)
  const basemapRef = useRef(null)

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
      if (!L || !elRef.current || mapRef.current) { if (++tries > 50) clearInterval(t); return }
      clearInterval(t)
      const map = L.map(elRef.current, { center: CONGRESSIONAL, zoom: 16, zoomControl: true, preferCanvas: true, maxBoundsViscosity: 1.0, attributionControl: false })
      mapRef.current = map
      setTimeout(() => map.invalidateSize(), 150)
    }, 60)
    return () => clearInterval(t)
  }, [tab])

  // Draw / update the selected photo overlay.
  useEffect(() => {
    const L = LRef.current, map = mapRef.current
    if (!L || !map || tab !== 'map') return
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
        // Show ONLY the photo: fit to it and lock pan/zoom to its bounds.
        const bounds = L.latLngBounds([[c.topLeft.lat, c.topLeft.lon], [c.topRight.lat, c.topRight.lon], [c.bottomLeft.lat, c.bottomLeft.lon], [c.bottomRight.lat, c.bottomRight.lon]])
        map.fitBounds(bounds, { padding: [8, 8] })
        map.setMaxBounds(bounds.pad(0.02))
        map.setMinZoom(map.getBoundsZoom(bounds))
      }
    })()
    return () => { live = false }
  }, [selId, imagery, tab])

  // Keep overlay opacity live.
  useEffect(() => { if (overlayRef.current?.setOpacity) overlayRef.current.setOpacity(opacity) }, [opacity])

  const reloadImagery = async () => {
    const imgs = await cmdb.fetchImagery(courseId)
    setImagery(imgs)
    if (imgs[0]) setSelId(imgs[0].id)
  }

  // ---- hooks done ----
  if (loading) return <div className={`${PAGE} py-16`}><p className="font-body text-[13px] text-center" style={{ color: INK_2 }}>Loading the course map…</p></div>

  const targetTxt = '20–30%' // Phase E will make this the active season's range

  return (
    <div className={`${PAGE} py-5`}>
      <div className="mb-3">
        <h1 className="font-display text-2xl font-bold" style={{ color: FOREST }}>Course Map</h1>
        <div className="mt-1 h-px" style={{ width: 30, backgroundColor: GOLD }} />
        <p className="font-body text-[13px] mt-1.5" style={{ color: INK_2 }}>{ctx?.club?.name || 'Your club'} · {ctx?.courses?.[0]?.name || 'Blue'} · target {targetTxt}</p>
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

          <div ref={elRef} style={{ height: '62vh', minHeight: 420, borderRadius: 16, overflow: 'hidden', border: `1px solid ${HAIR}`, backgroundColor: '#0e1f16' }} />
          {imagery.length === 0 && (
            <p className="font-body text-[12px] mt-2" style={{ color: INK_3 }}>No photo yet — the satellite basemap is shown. {manage ? 'Tap “Add photo” to place your aerial.' : ''}</p>
          )}
        </div>
      )}

      {tab === 'greens' && <Placeholder title="Greens today" note="Moisture heatmaps per green, morning/afternoon/change, and tonight's watering depth." phase="C–D" />}
      {tab === 'targets' && <Placeholder title="Targets" note="Seasonal moisture ranges, judged per round against the target active that day." phase="E" />}
    </div>
  )
}

// ── Add photo ──────────────────────────────────────────────────────────────
function AddPhoto({ courses, clubId, defaultCourseId, onClose, onDone }) {
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

function Placeholder({ title, note, phase }) {
  return (
    <div className="rounded-2xl border border-dashed p-10 text-center" style={{ borderColor: HAIR }}>
      <p className="font-display text-[15px] font-semibold" style={{ color: FOREST }}>{title}</p>
      <p className="font-body text-[12px] mt-1" style={{ color: INK_2 }}>{note}</p>
      <p className="font-body text-[11px] mt-2 inline-block px-2.5 py-1 rounded-full" style={{ backgroundColor: '#E8E7E2', color: INK_3 }}>Phase {phase}</p>
    </div>
  )
}
