'use client'

// ── Arc tool ─────────────────────────────────────────────────────────────────
// Lay the phone flat on a sprinkler head. Tap "Set start" with the top of the
// phone aimed at one edge of the throw (0°), then rotate the phone to the other
// edge — the dial fills and the number shows the arc in degrees (e.g. 192°).
//
// It measures the SWEEP (end heading − start heading), so a constant compass
// bias from nearby metal cancels out, which makes it reliable on a metal head.

import { useEffect, useRef, useState } from 'react'
import { Compass, X, Check, RotateCcw } from 'lucide-react'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#C9A84C'

function wedgePath(cx, cy, r, sweepDeg) {
  let s = Math.max(0, Math.min(359.9, sweepDeg))
  if (s <= 0.01) return ''
  const a0 = (-90) * Math.PI / 180
  const a1 = (-90 + s) * Math.PI / 180
  const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0)
  const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1)
  const large = s > 180 ? 1 : 0
  return `M${cx},${cy} L${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)} Z`
}

export default function ArcTool({ feature, onSave, onClose }) {
  const [supported, setSupported] = useState(true)
  const [enabled, setEnabled] = useState(false)
  const [heading, setHeading] = useState(null)   // live compass heading (deg)
  const [start, setStart] = useState(null)       // recorded start heading
  const [captured, setCaptured] = useState(feature?.arc ?? null)
  const [radius, setRadius] = useState(feature?.radius != null ? String(feature.radius) : (feature?.size || '').replace(/[^\d.]/g, ''))
  const [msg, setMsg] = useState(null)
  const headingRef = useRef(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('DeviceOrientationEvent' in window)) setSupported(false)
  }, [])

  const onOrient = (e) => {
    let h = null
    if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) h = e.webkitCompassHeading
    else if (e.absolute && typeof e.alpha === 'number') h = (360 - e.alpha) % 360
    else if (typeof e.alpha === 'number') h = (360 - e.alpha) % 360
    if (h != null) { headingRef.current = h; setHeading(h) }
  }

  async function enable() {
    try {
      const DOE = window.DeviceOrientationEvent
      if (DOE && typeof DOE.requestPermission === 'function') {
        const r = await DOE.requestPermission()
        if (r !== 'granted') { setMsg('Compass permission denied. Enable Motion & Orientation Access in Safari settings.'); return }
      }
      window.addEventListener('deviceorientationabsolute', onOrient, true)
      window.addEventListener('deviceorientation', onOrient, true)
      setEnabled(true)
    } catch { setMsg('Could not start the compass on this device.') }
  }

  useEffect(() => () => {
    window.removeEventListener('deviceorientationabsolute', onOrient, true)
    window.removeEventListener('deviceorientation', onOrient, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const liveArc = (start != null && heading != null) ? ((heading - start + 360) % 360) : null
  const shown = liveArc != null ? liveArc : (captured != null ? captured : 0)
  const bigNum = liveArc != null ? Math.round(liveArc) : (captured != null ? Math.round(captured) : '—')

  const setStartHere = () => { if (heading != null) { setStart(heading); setCaptured(null); setMsg('0° set — now rotate the phone to the other edge of the throw.') } }
  const capture = () => { if (liveArc != null) { setCaptured(liveArc); setMsg(`Captured ${Math.round(liveArc)}°.`) } }
  const reset = () => { setStart(null); setCaptured(null); setMsg(null) }
  const save = () => {
    const arcVal = captured != null ? Math.round(captured) : (liveArc != null ? Math.round(liveArc) : null)
    onSave({ arc: arcVal, arcStart: start != null ? Math.round(start) : null, radius: radius === '' ? null : Number(radius) })
  }

  const S = 240, C = S / 2, R = C - 16
  return (
    <div className="fixed inset-0 z-[1200] flex items-end sm:items-center justify-center p-3 sm:p-4" style={{ backgroundColor: 'rgba(26,26,22,0.55)' }} onClick={onClose}>
      <div className="bg-white rounded-2xl w-full sm:max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #EEF0EC' }}>
          <div className="flex items-center gap-2"><Compass size={18} style={{ color: FERN }} /><p className="font-display text-base font-bold" style={{ color: FOREST }}>Arc tool{feature?.label ? ` · ${feature.label}` : ''}</p></div>
          <button onClick={onClose} className="text-slate-400"><X size={18} /></button>
        </div>

        <div className="p-4">
          {!supported ? (
            <p className="font-body text-sm text-slate-500 text-center py-6">This needs a phone/tablet with a compass. Open the map on your iPhone or iPad to use the arc tool.</p>
          ) : !enabled ? (
            <div className="text-center py-4">
              <p className="font-body text-[13px] text-slate-600 mb-3">Lay the phone flat on the head, then turn on the compass.</p>
              <button onClick={enable} className="font-body text-sm font-bold px-4 py-2.5 rounded-full text-white inline-flex items-center gap-2" style={{ backgroundColor: FOREST }}><Compass size={16} /> Turn on compass</button>
              <p className="font-body text-[10px] text-slate-400 mt-3">iPhone/iPad will ask for Motion &amp; Orientation access — tap Allow.</p>
            </div>
          ) : (
            <>
              <div className="relative mx-auto" style={{ width: S, height: S }}>
                <svg width={S} height={S}>
                  <circle cx={C} cy={C} r={R} fill="#F6F8F6" stroke="#E2E8E4" strokeWidth="2" />
                  {start != null && <path d={wedgePath(C, C, R, shown)} fill={GOLD} fillOpacity="0.35" stroke={GOLD} strokeWidth="1.5" />}
                  {/* start marker at top */}
                  <line x1={C} y1={C} x2={C} y2={C - R} stroke={FERN} strokeWidth="3" />
                  {/* current pointer */}
                  {start != null && (() => { const a = (-90 + shown) * Math.PI / 180; return <line x1={C} y1={C} x2={(C + R * Math.cos(a)).toFixed(1)} y2={(C + R * Math.sin(a)).toFixed(1)} stroke="#DC2626" strokeWidth="3" /> })()}
                  <circle cx={C} cy={C} r="4" fill={FOREST} />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="font-display font-bold tabular-nums" style={{ fontSize: 40, color: FOREST }}>{bigNum}{typeof bigNum === 'number' ? '°' : ''}</span>
                  <span className="font-body text-[10px] text-slate-400">{start == null ? 'set 0° to begin' : 'arc to the right'}</span>
                </div>
              </div>

              <div className="flex items-center justify-center gap-2 mt-3">
                <button onClick={setStartHere} className="font-body text-xs font-bold px-3 py-2 rounded-full text-white" style={{ backgroundColor: FERN }}>Set start (0°)</button>
                <button onClick={capture} disabled={liveArc == null} className="font-body text-xs font-bold px-3 py-2 rounded-full text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>Capture</button>
                <button onClick={reset} className="font-body text-xs font-bold px-3 py-2 rounded-full text-slate-500 border border-slate-200 flex items-center gap-1"><RotateCcw size={12} /> Reset</button>
              </div>

              <div className="flex items-center gap-2 mt-3">
                <label className="font-body text-[11px] font-bold uppercase tracking-wide text-slate-400 shrink-0">Radius (ft)</label>
                <input value={radius} onChange={(e) => setRadius(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="e.g. 72" className="w-24 border border-slate-200 rounded-xl px-3 py-2 text-sm font-body" />
                <button onClick={save} className="ml-auto font-body text-sm font-bold px-4 py-2 rounded-full text-white flex items-center gap-1.5" style={{ backgroundColor: FOREST }}><Check size={15} /> Save to head</button>
              </div>

              <p className="font-body text-[10px] text-slate-400 mt-3 leading-snug">It measures the turn from start to end, so a metal head won&apos;t throw it off. If the number drifts, wave the phone in a figure-8 to recalibrate the compass, and keep it flat.</p>
            </>
          )}
          {msg && <p className="font-body text-[11px] mt-2" style={{ color: FERN }}>{msg}</p>}
        </div>
      </div>
    </div>
  )
}
