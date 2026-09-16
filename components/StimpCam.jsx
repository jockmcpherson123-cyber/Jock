'use client'

// ── Green-speed by camera (BETA) ─────────────────────────────────────────────
// Keeps the Stimpmeter for the standard release; the phone films the roll and
// auto-measures the roll-OUT distance, which is the Stimp reading in feet.
//
// How it works, honestly: this is not magic. You calibrate the scale by sizing a
// ring over the ball at rest (a golf ball is 1.68"/42.67 mm, so its pixel size
// gives us millimetres-per-pixel). Then it tracks the white ball across the green
// frame by frame and measures how far it travelled before stopping. It needs a
// SIDE-ON view (phone low, a couple of feet to the side, square to the roll line)
// so the ball stays the same distance from the lens and the scale holds. Bright,
// even light and a clean green help. Always sanity-check the number against a
// hand-measured roll until you trust it on your greens — hence "beta".
import { useEffect, useRef, useState, useCallback } from 'react'
import { X, Camera, RotateCcw, Check, Ruler } from 'lucide-react'
import { FOREST, FERN, GOLD, INK, INK_3, HAIR, RED } from '@/lib/theme'
import { fmtStimp, stimpToFeet } from '@/lib/greenspeed'

const BALL_MM = 42.67          // golf ball diameter
const PROC_W = 480             // processing canvas width (downscaled for speed)
const MM_PER_FT = 304.8

export default function StimpCam({ onClose, onResult }) {
  const videoRef = useRef(null)
  const procRef = useRef(null)      // offscreen processing canvas
  const rafRef = useRef(null)
  const trackRef = useRef(null)     // mutable tracking state (avoids re-render churn)

  const [step, setStep] = useState('init')   // init | calibrate | ready | measuring | result | error | manual
  const [errMsg, setErrMsg] = useState('')
  const [ringR, setRingR] = useState(26)      // calibration ring radius, CSS px
  const [seed, setSeed] = useState(null)      // {xDisp,yDisp} tapped ball start, CSS px
  const [liveFt, setLiveFt] = useState(null)  // running distance while measuring
  const [dot, setDot] = useState(null)        // tracked ball position, CSS px
  const [result, setResultFt] = useState(null)
  const [manFt, setManFt] = useState(''); const [manIn, setManIn] = useState('')
  const mmPerPxRef = useRef(null)             // scale (in PROCESSING px)

  // ── camera lifecycle ──
  useEffect(() => {
    let stream
    ;(async () => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) { setStep('error'); setErrMsg('This device or browser won\'t give the app camera access. Use manual entry.'); return }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
        const v = videoRef.current
        if (!v) return
        v.srcObject = stream
        v.setAttribute('playsinline', 'true'); v.muted = true
        await v.play().catch(() => {})
        setStep('calibrate')
      } catch (e) {
        setStep('error')
        setErrMsg(e?.name === 'NotAllowedError' ? 'Camera permission was blocked. Allow it in your browser settings, or use manual entry.' : 'Couldn\'t start the camera. Use manual entry.')
      }
    })()
    return () => { try { (stream || videoRef.current?.srcObject)?.getTracks?.().forEach((t) => t.stop()) } catch {} ; if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [])

  // Map processing-canvas coords → on-screen CSS coords over the <video>.
  const dispFromProc = useCallback((px, py) => {
    const v = videoRef.current; if (!v) return { x: 0, y: 0 }
    const r = v.getBoundingClientRect()
    const proc = procRef.current
    const sx = r.width / (proc?.width || PROC_W)
    const sy = r.height / (proc?.height || 1)
    return { x: px * sx, y: py * sy }
  }, [])
  // Map on-screen CSS coords (relative to video box) → processing coords.
  const procFromDisp = useCallback((cx, cy) => {
    const v = videoRef.current; if (!v) return { x: 0, y: 0 }
    const r = v.getBoundingClientRect()
    const proc = procRef.current
    const sx = (proc?.width || PROC_W) / r.width
    const sy = (proc?.height || 1) / r.height
    return { x: cx * sx, y: cy * sy }
  }, [])

  // Grab a downscaled frame into the processing canvas; returns its ImageData.
  function grabFrame() {
    const v = videoRef.current, c = procRef.current
    if (!v || !c || !v.videoWidth) return null
    const scale = PROC_W / v.videoWidth
    c.width = PROC_W; c.height = Math.round(v.videoHeight * scale)
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(v, 0, 0, c.width, c.height)
    return ctx.getImageData(0, 0, c.width, c.height)
  }

  // Find the white ball's centroid within a search box. Returns {x,y,n} or null.
  function findBall(img, box) {
    const { data, width, height } = img
    const x0 = Math.max(0, Math.floor(box.x0)), y0 = Math.max(0, Math.floor(box.y0))
    const x1 = Math.min(width, Math.ceil(box.x1)), y1 = Math.min(height, Math.ceil(box.y1))
    let sumX = 0, sumY = 0, n = 0
    for (let y = y0; y < y1; y++) {
      let row = (y * width + x0) * 4
      for (let x = x0; x < x1; x++, row += 4) {
        const r = data[row], g = data[row + 1], b = data[row + 2]
        // White = all channels bright and not strongly green-dominant.
        if (r > 188 && g > 188 && b > 178 && Math.abs(r - g) < 46 && g - b < 60) { sumX += x; sumY += y; n++ }
      }
    }
    if (n < 4) return null
    return { x: sumX / n, y: sumY / n, n }
  }

  // ── calibration: user sizes the ring over the ball, then confirms ──
  function confirmCalibrate() {
    const v = videoRef.current; if (!v) return
    const rect = v.getBoundingClientRect()
    const proc = grabFrame(); if (!proc) { setStep('error'); setErrMsg('No video frame yet — give it a second and retry.'); return }
    // ring diameter (CSS px) → processing px → mm/px
    const procDiaPx = (ringR * 2) * (proc.width / rect.width)
    if (procDiaPx < 4) { setErrMsg('Make the ring a bit bigger over the ball.'); return }
    mmPerPxRef.current = BALL_MM / procDiaPx
    setErrMsg('')
    setStep('ready')
  }

  // Tap the ball at rest to seed where the roll begins.
  function onVideoTap(e) {
    if (step !== 'ready') return
    const v = videoRef.current; const rect = v.getBoundingClientRect()
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top
    setSeed({ xDisp: cx, yDisp: cy })
  }

  // ── measuring loop ──
  function startMeasure() {
    if (!seed) { setErrMsg('Tap the ball first so it knows where the roll starts.'); return }
    setErrMsg(''); setResultFt(null); setLiveFt(0)
    const proc = grabFrame(); if (!proc) return
    const start = procFromDisp(seed.xDisp, seed.yDisp)
    const box = 40 // half-size of the search window (proc px), grows if lost
    trackRef.current = { start, last: start, path: [], lostFrames: 0, box, moved: false, stableSince: null, t0: null }
    setStep('measuring')
    loop()
  }

  function finish() {
    const tr = trackRef.current
    if (tr) tr.stopped = true
    try { const v = videoRef.current; if (rafRef.current != null) { if (v?.cancelVideoFrameCallback) v.cancelVideoFrameCallback(rafRef.current); cancelAnimationFrame(rafRef.current) } } catch {}
    const mmPerPx = mmPerPxRef.current
    if (!tr || !mmPerPx || !tr.moved) { setStep('ready'); setErrMsg('Didn\'t catch a clean roll — line the ball up and try again, or enter it by hand.'); return }
    const dx = tr.last.x - tr.start.x, dy = tr.last.y - tr.start.y
    const mm = Math.hypot(dx, dy) * mmPerPx
    const feet = Math.round((mm / MM_PER_FT) * 100) / 100
    setResultFt(feet); setStep('result')
  }

  const loop = useCallback(function loop() {
    const v = videoRef.current, tr = trackRef.current
    if (!v || !tr || tr.stopped) return
    const img = grabFrame()
    if (img) {
      const cx = tr.last.x, cy = tr.last.y
      const b = tr.box
      const found = findBall(img, { x0: cx - b, y0: cy - b, x1: cx + b, y1: cy + b })
      const now = performance.now() / 1000
      if (tr.t0 == null) tr.t0 = now
      if (found) {
        tr.lostFrames = 0; tr.box = 40
        const moveDist = Math.hypot(found.x - tr.last.x, found.y - tr.last.y)
        const totalFromStart = Math.hypot(found.x - tr.start.x, found.y - tr.start.y)
        if (totalFromStart * (mmPerPxRef.current || 0) > 60) tr.moved = true // >6cm = a real roll
        tr.last = { x: found.x, y: found.y }
        tr.path.push({ x: found.x, y: found.y, t: now })
        const d = dispFromProc(found.x, found.y); setDot(d)
        const mm = totalFromStart * (mmPerPxRef.current || 0)
        setLiveFt(Math.round((mm / MM_PER_FT) * 100) / 100)
        // stop = has moved, then near-still for ~0.5 s
        if (tr.moved) {
          if (moveDist < 2.2) { if (tr.stableSince == null) tr.stableSince = now; else if (now - tr.stableSince > 0.5) { finish(); return } }
          else tr.stableSince = null
        }
      } else {
        tr.lostFrames++; tr.box = Math.min(160, tr.box + 8) // widen the hunt
        if (tr.moved && tr.lostFrames > 18) { finish(); return } // rolled out of view / stopped
      }
      // hard timeout ~12 s
      if (now - tr.t0 > 12) { finish(); return }
    }
    // schedule next frame
    if (v.requestVideoFrameCallback) rafRef.current = v.requestVideoFrameCallback(() => loop())
    else rafRef.current = requestAnimationFrame(() => loop())
  }, [dispFromProc])

  function acceptResult() { if (result != null && onResult) onResult(result); onClose?.() }
  function saveManual() { const f = stimpToFeet(manFt, manIn); if (f > 0 && onResult) onResult(f); onClose?.() }

  // ── UI ──
  const overlay = { position: 'absolute', inset: 0, pointerEvents: 'none' }
  const btn = (bg, extra = {}) => ({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontSize: 14, fontWeight: 700, color: '#fff', background: bg, border: 0, borderRadius: 12, padding: '12px 16px', cursor: 'pointer', ...extra })

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 90, background: '#0B0B0A', display: 'flex', flexDirection: 'column' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', color: '#fff', background: FOREST }}>
        <Camera size={18} style={{ color: GOLD }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Measure green speed <span style={{ fontSize: 10, fontWeight: 700, color: GOLD, border: `1px solid ${GOLD}`, borderRadius: 6, padding: '1px 5px', marginLeft: 4 }}>BETA</span></div>
          <div style={{ fontSize: 10.5, opacity: .7 }}>Side-on · phone low · square to the roll</div>
        </div>
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,.12)', border: 0, borderRadius: 10, padding: 8, color: '#fff', cursor: 'pointer' }}><X size={18} /></button>
      </div>

      {/* video stage */}
      <div style={{ position: 'relative', flex: 1, background: '#000', overflow: 'hidden' }} onClick={onVideoTap}>
        <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'contain', display: step === 'error' || step === 'manual' ? 'none' : 'block' }} />
        <canvas ref={procRef} style={{ display: 'none' }} />

        {/* calibration ring */}
        {step === 'calibrate' && (
          <div style={overlay}>
            <div style={{ position: 'absolute', left: '50%', top: '50%', width: ringR * 2, height: ringR * 2, marginLeft: -ringR, marginTop: -ringR, border: `2px solid ${GOLD}`, borderRadius: '50%', boxShadow: '0 0 0 9999px rgba(0,0,0,0.28)' }} />
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 0 }} />
          </div>
        )}
        {/* seed marker */}
        {step === 'ready' && seed && (
          <div style={{ ...overlay }}>
            <div style={{ position: 'absolute', left: seed.xDisp - 9, top: seed.yDisp - 9, width: 18, height: 18, border: `2px solid ${FERN}`, borderRadius: '50%', background: 'rgba(58,107,74,.25)' }} />
          </div>
        )}
        {/* live tracked dot */}
        {step === 'measuring' && dot && (
          <div style={overlay}><div style={{ position: 'absolute', left: dot.x - 7, top: dot.y - 7, width: 14, height: 14, border: '2px solid #fff', borderRadius: '50%', boxShadow: '0 0 8px rgba(255,255,255,.8)' }} /></div>
        )}
        {/* live distance readout */}
        {step === 'measuring' && (
          <div style={{ position: 'absolute', left: 0, right: 0, top: 12, textAlign: 'center', color: '#fff', pointerEvents: 'none' }}>
            <div style={{ display: 'inline-block', background: 'rgba(0,0,0,.5)', borderRadius: 12, padding: '6px 14px', fontSize: 26, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmtStimp(liveFt)}</div>
            <div style={{ fontSize: 11, opacity: .8, marginTop: 4 }}>tracking the roll…</div>
          </div>
        )}
      </div>

      {/* controls / copy */}
      <div style={{ background: '#141412', color: '#fff', padding: '14px 16px 22px' }}>
        {errMsg && <p style={{ color: '#FCA5A5', fontSize: 12.5, margin: '0 0 10px' }}>{errMsg}</p>}

        {step === 'init' && <p style={{ fontSize: 13, opacity: .8, margin: 0 }}>Starting camera…</p>}

        {step === 'calibrate' && (
          <>
            <p style={{ fontSize: 12.5, opacity: .85, margin: '0 0 10px', lineHeight: 1.5 }}><Ruler size={13} style={{ verticalAlign: -2, color: GOLD }} /> Line the phone up <b>side-on</b> to the roll, low to the ground. Put a ball where the release lands and size the ring to match it exactly.</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <span style={{ fontSize: 11, opacity: .7, width: 64 }}>Ring size</span>
              <input type="range" min="10" max="70" value={ringR} onChange={(e) => setRingR(Number(e.target.value))} style={{ flex: 1, accentColor: GOLD }} />
            </div>
            <button onClick={confirmCalibrate} style={btn(GOLD, { width: '100%', color: INK })}><Check size={16} /> Ball fits the ring</button>
          </>
        )}

        {step === 'ready' && (
          <>
            <p style={{ fontSize: 12.5, opacity: .85, margin: '0 0 10px', lineHeight: 1.5 }}>Tap the ball at rest to mark the start, then release it off the Stimpmeter and hit <b>Start</b>. Keep the whole roll in frame.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setStep('calibrate')} style={btn('#2A2A26', { flex: 'none' })}><RotateCcw size={15} /> Re-scale</button>
              <button onClick={startMeasure} style={btn(FERN, { flex: 1, opacity: seed ? 1 : .5 })}><Camera size={16} /> Start</button>
            </div>
          </>
        )}

        {step === 'measuring' && (
          <button onClick={finish} style={btn('#2A2A26', { width: '100%' })}>Stop &amp; read</button>
        )}

        {step === 'result' && (
          <>
            <div style={{ textAlign: 'center', margin: '2px 0 14px' }}>
              <div style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', opacity: .6 }}>Measured roll-out</div>
              <div style={{ fontSize: 46, fontWeight: 800, color: GOLD, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{fmtStimp(result)}</div>
              <div style={{ fontSize: 11, opacity: .6 }}>Sanity-check against a hand roll before you trust it.</div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setStep('ready'); setResultFt(null); setDot(null) }} style={btn('#2A2A26', { flex: 'none' })}><RotateCcw size={15} /> Redo</button>
              <button onClick={acceptResult} style={btn(FERN, { flex: 1 })}><Check size={16} /> Use {fmtStimp(result)}</button>
            </div>
          </>
        )}

        {(step === 'error' || step === 'manual') && (
          <>
            <p style={{ fontSize: 13, margin: '0 0 12px', opacity: .85 }}>{step === 'error' ? errMsg : 'Enter the reading you measured by hand.'}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <input type="number" inputMode="numeric" value={manFt} onChange={(e) => setManFt(e.target.value)} placeholder="9" style={{ width: 70, textAlign: 'center', fontSize: 20, fontWeight: 700, padding: '10px', borderRadius: 10, border: 0 }} />
              <span style={{ opacity: .6 }}>′</span>
              <input type="number" inputMode="numeric" min="0" max="11" value={manIn} onChange={(e) => setManIn(e.target.value)} placeholder="10" style={{ width: 70, textAlign: 'center', fontSize: 20, fontWeight: 700, padding: '10px', borderRadius: 10, border: 0 }} />
              <span style={{ opacity: .6 }}>″</span>
            </div>
            <button onClick={saveManual} style={btn(FERN, { width: '100%' })}><Check size={16} /> Use this reading</button>
          </>
        )}

        {/* manual entry escape hatch always available (except while measuring) */}
        {step !== 'measuring' && step !== 'manual' && step !== 'error' && (
          <button onClick={() => setStep('manual')} style={{ width: '100%', marginTop: 10, background: 'none', border: 0, color: INK_3, fontSize: 12, textDecoration: 'underline', cursor: 'pointer' }}>Enter by hand instead</button>
        )}
      </div>
    </div>
  )
}
