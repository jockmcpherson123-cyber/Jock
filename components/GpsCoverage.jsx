'use client'

// ── GPS Coverage ─────────────────────────────────────────────────────────────
// The GreenTrack concept, for real. A clean, lightweight schematic field (no map
// tiles, so it's fast) that paints your passes as you drive, with the A–B
// lightbar, a flagged missed strip, and the four job stats.
//
// How it works: your first pass sets the line (origin + direction). Every GPS fix
// is projected onto that line — distance ALONG it places the pass vertically,
// distance ACROSS it picks the lane (one lane = one implement width). We draw the
// field as columns, so a covered lane is green, a skipped lane between two driven
// ones flags red, and the lightbar shows how far off the nearest line you are.
//
// Phone GPS is ~3–5 m, so this is coverage awareness, not sub-inch guidance.

import { useEffect, useRef, useState, useCallback } from 'react'
import { Play, Pause, Square, Trash2, Ruler, Minus, Plus, RotateCcw } from 'lucide-react'
import * as db from '@/lib/db'
import { FOREST, FERN, GOLD, PAPER, HAIR, INK_2, INK_3, RED } from '@/lib/theme'

const FT_PER_M = 3.28084
const SQM_PER_ACRE = 4046.8564
const OPS = ['Aerating', 'Mowing', 'Topdressing', 'Spraying', 'Rolling', 'Verticutting', 'Seeding']
const LOCK_M = 10 // lock the line after this much of the first pass

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
// Project a fix into field metres (along the A–B line, across it) from an origin.
function project(origin, dirDeg, p) {
  const toR = Math.PI / 180
  const cos0 = Math.cos(origin.lat * toR)
  const dx = (p.lng - origin.lng) * 111320 * cos0
  const dy = (p.lat - origin.lat) * 111320
  const th = dirDeg * toR, fx = Math.sin(th), fy = Math.cos(th), rx = Math.cos(th), ry = -Math.sin(th)
  return { along: dx * fx + dy * fy, cross: dx * rx + dy * ry }
}

function Chevron({ hot, right }) {
  return (
    <svg width="12" height="18" viewBox="0 0 11 17" style={{ opacity: hot ? 1 : 0.26, transform: right ? 'scaleX(-1)' : 'none', transition: 'opacity .15s' }}>
      <path d="M9 1 2 8.5 9 16" fill="none" stroke="#EFEFE7" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function GpsCoverage() {
  const [running, setRunning] = useState(false)
  const [widthFt, setWidthFt] = useState(20)
  const [widthOpen, setWidthOpen] = useState(false)
  const [gpsErr, setGpsErr] = useState('')
  const [stats, setStats] = useState({ acres: 0, mph: 0, acc: null, secs: 0 })
  const [lb, setLb] = useState({ active: false, off: 0 })
  const [locked, setLocked] = useState(false)
  const [areas, setAreas] = useState({})
  const [areaName, setAreaName] = useState('')
  const [op, setOp] = useState('Aerating')

  const canvasRef = useRef(null)
  const trackRef = useRef([])
  const distRef = useRef(0)
  const frameRef = useRef({ origin: null, dirDeg: 0, locked: false })
  const dataRef = useRef({ lanes: {}, alongMax: 8, cur: null })
  const watchRef = useRef(null)
  const wakeRef = useRef(null)
  const startRef = useRef(0)
  const tickRef = useRef(null)
  const widthRef = useRef(widthFt)
  useEffect(() => { widthRef.current = widthFt }, [widthFt])

  const areaObj = areas[areaName] || null
  const totalAc = areaObj ? (Number(areaObj.acres) || (Number(areaObj.sqft) || 0) / 43560) : 0
  const coveragePct = totalAc > 0 ? Math.min(100, Math.round((stats.acres / totalAc) * 100)) : null

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try { const s = await db.fetchSettings(); if (cancelled) return; const a = s?.areas || {}; setAreas(a); const f = Object.keys(a)[0]; if (f) setAreaName(f) } catch { /* fine */ }
    })()
    return () => { cancelled = true }
  }, [])

  // ── Canvas sizing + render ────────────────────────────────────────────────
  const render = useCallback(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    const W = cv.clientWidth, H = cv.clientHeight
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1))
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr) }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    const m = 14, fl = m, fr = W - m, ft = m, fb = H - m, rad = 26
    const field = () => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(fl, ft, fr - fl, fb - ft, rad); else ctx.rect(fl, ft, fr - fl, fb - ft) }
    const widthM = widthRef.current / FT_PER_M
    const { lanes, alongMax, cur } = dataRef.current
    const ks = Object.keys(lanes).map(Number)
    const haveLanes = ks.length > 0
    const drivenLo = haveLanes ? Math.min(...ks) : 0
    const drivenHi = haveLanes ? Math.max(...ks) : 0
    const curLane = cur ? Math.round(cur.cross / widthM) : 0
    let lo = Math.min(drivenLo, curLane) - 1, hi = Math.max(drivenHi, curLane) + 1
    while (hi - lo + 1 < 5) { lo -= 1; hi += 1 } // always show a few columns
    const nCols = hi - lo + 1
    const colW = (fr - fl) / nCols
    const aMax = Math.max(alongMax, cur ? cur.along : 0, 8)
    const yOf = (a) => ft + (Math.max(0, a) / aMax) * (fb - ft)
    const colLeft = (k) => fl + (k - lo) * colW

    // field base + mow stripes
    ctx.save(); field(); ctx.clip()
    ctx.fillStyle = '#AEC8AB'; ctx.fillRect(0, 0, W, H)
    for (let k = lo; k <= hi; k++) { ctx.fillStyle = ((k - lo) % 2 === 0) ? 'rgba(255,255,255,.25)' : 'rgba(0,0,0,.02)'; ctx.fillRect(colLeft(k), ft, colW, fb - ft) }
    // covered lanes
    ctx.fillStyle = 'rgba(47,90,60,.5)'
    ks.forEach((k) => { const L = lanes[k]; ctx.fillRect(colLeft(k), yOf(L.min), colW, Math.max(2, yOf(L.max) - yOf(L.min))) })
    // missed strips (un-driven lane between driven ones)
    for (let k = drivenLo + 1; k < drivenHi; k++) {
      if (lanes[k]) continue
      const x = colLeft(k)
      ctx.fillStyle = '#F6E3E0'; ctx.fillRect(x, ft, colW, fb - ft)
      ctx.save(); ctx.beginPath(); ctx.rect(x, ft, colW, fb - ft); ctx.clip()
      ctx.strokeStyle = 'rgba(178,58,46,.5)'; ctx.lineWidth = 1.5
      for (let d = -(fb - ft); d < colW; d += 8) { ctx.beginPath(); ctx.moveTo(x + d, fb); ctx.lineTo(x + d + (fb - ft), ft); ctx.stroke() }
      ctx.restore()
    }
    ctx.restore() // end field clip

    // field outline
    field(); ctx.strokeStyle = '#8FB08C'; ctx.lineWidth = 2; ctx.stroke()

    // guidance lines (gold, dashed) at each lane centre once the line is locked
    if (frameRef.current.locked) {
      ctx.save(); ctx.setLineDash([6, 7]); ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.6
      for (let k = lo; k <= hi; k++) { const cx = colLeft(k) + colW / 2; ctx.beginPath(); ctx.moveTo(cx, ft + 4); ctx.lineTo(cx, fb - 4); ctx.stroke() }
      ctx.restore()
    }

    // missed-strip pill(s)
    ctx.font = '700 11px Archivo, system-ui, sans-serif'; ctx.textBaseline = 'middle'
    for (let k = drivenLo + 1; k < drivenHi; k++) {
      if (lanes[k]) continue
      const cx = colLeft(k) + colW / 2, txt = 'Missed strip', tw = ctx.measureText(txt).width + 16
      const px = Math.max(fl + 2, Math.min(cx - tw / 2, fr - tw - 2))
      ctx.fillStyle = RED; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(px, ft + 8, tw, 20, 10); else ctx.rect(px, ft + 8, tw, 20); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(txt, px + 8, ft + 18.5)
    }

    // tractor marker
    if (cur) {
      const tx = Math.max(fl + 10, Math.min(fl + (cur.cross / widthM - lo + 0.5) * colW, fr - 10))
      const ty = Math.max(ft + 12, Math.min(yOf(cur.along), fb - 12))
      ctx.fillStyle = 'rgba(201,168,76,.3)'; ctx.beginPath(); ctx.arc(tx, ty, 15, 0, 7); ctx.fill()
      ctx.fillStyle = GOLD; ctx.beginPath(); ctx.moveTo(tx, ty + 14); ctx.lineTo(tx - 6, ty + 4); ctx.lineTo(tx + 6, ty + 4); ctx.closePath(); ctx.fill()
      ctx.fillStyle = FOREST; ctx.beginPath(); ctx.arc(tx, ty, 8, 0, 7); ctx.fill()
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke()
    } else if (!haveLanes) {
      ctx.fillStyle = 'rgba(22,41,31,.45)'; ctx.font = '600 13px Archivo, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(running ? 'Drive straight to set your line…' : 'Hit Start and drive your first pass', W / 2, H / 2)
    }
  }, [running])

  useEffect(() => {
    render()
    const onResize = () => render()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [render])

  useEffect(() => () => {
    if (watchRef.current != null && navigator.geolocation) navigator.geolocation.clearWatch(watchRef.current)
    if (tickRef.current) clearInterval(tickRef.current)
    releaseWake()
  }, [])

  async function requestWake() { try { if ('wakeLock' in navigator) wakeRef.current = await navigator.wakeLock.request('screen') } catch { /* optional */ } }
  function releaseWake() { try { wakeRef.current?.release?.(); wakeRef.current = null } catch { /* ignore */ } }

  const recompute = useCallback(() => {
    const fr = frameRef.current
    const widthM = widthRef.current / FT_PER_M
    if (!fr.origin) { dataRef.current = { lanes: {}, alongMax: 8, cur: null }; return }
    const lanes = {}; let alongMax = 8; let cur = null
    for (const p of trackRef.current) {
      const q = project(fr.origin, fr.dirDeg, p)
      const k = Math.round(q.cross / widthM)
      const L = lanes[k] || { min: Infinity, max: -Infinity }
      L.min = Math.min(L.min, q.along); L.max = Math.max(L.max, q.along); lanes[k] = L
      if (q.along > alongMax) alongMax = q.along
      cur = q
    }
    dataRef.current = { lanes, alongMax, cur }
  }, [])

  const onFix = useCallback((pos) => {
    const c = pos.coords
    const fix = { lat: c.latitude, lng: c.longitude, t: pos.timestamp, acc: c.accuracy || null }
    const track = trackRef.current
    const prev = track[track.length - 1]
    if (prev && haversine(prev, fix) < 0.4) { setStats((s) => ({ ...s, acc: fix.acc })); return }
    if (prev) distRef.current += haversine(prev, fix)
    track.push(fix)

    const fr = frameRef.current
    if (!fr.origin) fr.origin = fix
    if (!fr.locked) {
      const run = haversine(fr.origin, fix)
      if (run >= 0.5) fr.dirDeg = bearing(fr.origin, fix)
      if (run >= LOCK_M) { fr.locked = true; setLocked(true) }
    }
    recompute()

    const widthM = widthRef.current / FT_PER_M
    const cur = dataRef.current.cur
    if (cur && (fr.locked || track.length > 2)) {
      const off = (cur.cross - Math.round(cur.cross / widthM) * widthM) * FT_PER_M
      setLb({ active: true, off })
    }
    // acres covered = sum of each lane's driven length × width
    let covSqm = 0
    Object.values(dataRef.current.lanes).forEach((L) => { if (L.max > L.min) covSqm += (L.max - L.min) * widthM })
    let mph = 0
    if (c.speed != null && !Number.isNaN(c.speed)) mph = c.speed * 2.23694
    else if (prev) { const dt = (fix.t - prev.t) / 1000; if (dt > 0) mph = (haversine(prev, fix) / dt) * 2.23694 }
    setStats({ acres: covSqm / SQM_PER_ACRE, mph: Math.max(0, mph), acc: fix.acc, secs: Math.round((Date.now() - startRef.current) / 1000) })
    render()
  }, [recompute, render])

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
  function clearAll() {
    pause()
    trackRef.current = []; distRef.current = 0; startRef.current = 0
    frameRef.current = { origin: null, dirDeg: 0, locked: false }; setLocked(false)
    dataRef.current = { lanes: {}, alongMax: 8, cur: null }
    setLb({ active: false, off: 0 }); setStats({ acres: 0, mph: 0, acc: null, secs: 0 })
    render()
  }
  function resetLine() {
    frameRef.current = { origin: null, dirDeg: 0, locked: false }; setLocked(false)
    recompute(); setLb({ active: false, off: 0 }); render()
  }

  const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const gpsWord = stats.acc == null ? '—' : stats.acc <= 6 ? 'good' : stats.acc <= 12 ? 'fair' : 'weak'
  const gpsColor = stats.acc == null ? INK_3 : stats.acc <= 6 ? '#2E7D46' : stats.acc <= 12 ? GOLD : RED
  const halfW = Math.max(0.5, widthFt / 2)
  const lbMag = Math.abs(lb.off)
  const lbOn = lbMag < 0.3
  const lbPos = Math.max(5, Math.min(95, 50 + (lb.off / halfW) * 45))
  const lbStatus = lbOn ? 'On line' : lb.off > 0 ? 'Nudge left' : 'Nudge right'
  const lineSub = locked ? 'line locked' : running ? 'drive straight to set' : 'start to set'
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
      {/* Header */}
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
        <div className="flex items-center gap-1.5 font-body text-xs font-bold px-2.5 py-1.5 rounded-full shrink-0" style={{ backgroundColor: '#EAF1EB', border: '1px solid #CFE3D6', color: gpsColor }}>
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
        {lb.active ? (
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
            Hit <b style={{ color: '#fff' }}>Start</b> and drive your first pass — it sets the guidance line, then the lightbar goes live.
          </p>
        )}
      </div>

      {/* Field (schematic canvas) */}
      <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${HAIR}` }}>
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '52vh', minHeight: 360, background: '#AEC8AB' }} />
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
        <button onClick={resetLine} className="rounded-xl py-2.5 px-2 text-center" style={locked ? { backgroundColor: GOLD, color: FOREST } : { backgroundColor: PAPER, color: FOREST, border: `1px solid ${HAIR}` }}>
          <div className="font-body text-sm font-bold flex items-center justify-center gap-1"><RotateCcw size={13} /> A–B line</div>
          <div className="font-body text-[10px] mt-0.5" style={{ opacity: 0.75 }}>{lineSub}</div>
        </button>
        <div className="relative">
          <button onClick={() => setWidthOpen((o) => !o)} className="w-full rounded-xl py-2.5 px-2 text-center" style={{ backgroundColor: PAPER, color: FOREST, border: `1px solid ${HAIR}` }}>
            <div className="font-body text-sm font-bold flex items-center justify-center gap-1"><Ruler size={13} style={{ color: FERN }} /> Width</div>
            <div className="font-body text-[10px] mt-0.5" style={{ color: INK_2 }}>{widthFt} ft</div>
          </button>
          {widthOpen && (
            <div className="absolute left-0 right-0 bottom-full mb-2 z-[60] rounded-xl p-2 flex items-center gap-2 justify-center" style={{ backgroundColor: PAPER, border: `1px solid ${HAIR}`, boxShadow: '0 8px 24px -8px rgba(21,29,20,.4)' }}>
              <button onClick={() => { setWidthFt((w) => Math.max(1, w - 1)); recompute(); render() }} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ border: `1px solid ${HAIR}`, color: FOREST }}><Minus size={15} /></button>
              <input type="number" min="1" value={widthFt} onChange={(e) => { setWidthFt(Math.max(1, Number(e.target.value) || 1)); recompute(); render() }} className="w-14 text-center font-display text-lg font-bold bg-transparent outline-none" style={{ color: FOREST }} />
              <button onClick={() => { setWidthFt((w) => w + 1); recompute(); render() }} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ border: `1px solid ${HAIR}`, color: FOREST }}><Plus size={15} /></button>
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
            <div className="font-body text-[10px] mt-0.5" style={{ opacity: 0.75 }}>tracking · {mmss(stats.secs)}</div>
          </button>
        )}
      </div>

      {/* Secondary */}
      <div className="flex items-center gap-2 mt-2">
        <button onClick={pause} disabled={!running} className="flex-1 font-body text-xs font-bold py-2 rounded-lg flex items-center justify-center gap-1.5 disabled:opacity-40" style={{ backgroundColor: PAPER, color: FOREST, border: `1px solid ${HAIR}` }}><Square size={13} /> Stop</button>
        <button onClick={clearAll} disabled={!trackRef.current.length} className="flex-1 font-body text-xs font-bold py-2 rounded-lg flex items-center justify-center gap-1.5 disabled:opacity-40" style={{ backgroundColor: PAPER, color: RED, border: `1px solid ${HAIR}` }}><Trash2 size={13} /> Clear</button>
      </div>

      {/* Legend + note */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 justify-center">
        <span className="flex items-center gap-1.5 font-body text-[11px] font-semibold" style={{ color: INK_2 }}><span style={{ width: 16, height: 11, borderRadius: 3, background: 'rgba(47,90,60,.5)' }} /> Covered</span>
        <span className="flex items-center gap-1.5 font-body text-[11px] font-semibold" style={{ color: INK_2 }}><span style={{ width: 16, height: 11, borderRadius: 3, background: '#F6E3E0', outline: `1px dashed ${RED}` }} /> Missed strip</span>
        <span className="flex items-center gap-1.5 font-body text-[11px] font-semibold" style={{ color: INK_2 }}><span style={{ width: 16, height: 0, borderTop: `3px dashed ${GOLD}` }} /> Guidance line</span>
      </div>
      <p className="font-body text-[11px] mt-2 text-center leading-relaxed" style={{ color: INK_3 }}>
        Your first pass sets the line; lanes are one width apart. Phone GPS is ~10–15 ft, so this is coverage awareness, not sub-inch guidance. Keep the phone mounted with a clear view of the sky and on cab power.
      </p>
    </div>
  )
}
