'use client'

// ── Green-speed by camera · down-the-line (BETA) ─────────────────────────────
// Matches the Ball Roll Pro setup: phone flat on the green, BEHIND the
// Stimpmeter, aimed straight down the intended roll line. Lift the meter, the
// ball rolls AWAY from the camera, and we measure the roll-out.
//
// Because the ball rolls away (it doesn't cross the frame), we can't use sideways
// pixel travel. Instead we range it by SIZE: a golf ball is always 42.67 mm, so
// the smaller it looks, the further away it is (distance ∝ 1 / apparent size).
// The roll-out is how much further away it ended up than where it started.
//
// The lens field-of-view and the phone's tilt turn that size-change into feet by
// a single multiplier that differs per phone/setup — so you CALIBRATE ONCE: do a
// roll, measure it by hand, tell the app, and it remembers the multiplier. After
// that it converts automatically. Re-calibrate any time the setup changes.
import { useEffect, useRef, useState, useCallback } from 'react'
import { X, Camera, RotateCcw, Check, Crosshair, SlidersHorizontal } from 'lucide-react'
import { FOREST, FERN, GOLD, INK, INK_3 } from '@/lib/theme'
import { fmtStimp, stimpToFeet } from '@/lib/greenspeed'

const PROC_W = 640            // processing width (higher = the far, tiny ball survives)
const BALL_MM = 42.67
const CAL_KEY = 'stimp_cam_cal_v1'
// Fallback multiplier from an assumed ~66° horizontal field of view, so an
// un-calibrated reading is at least a ballpark. C = f_px · BALL_MM / 304.8 (ft).
const F_PX = (PROC_W / 2) / Math.tan((66 * Math.PI / 180) / 2)
const DEFAULT_C = (F_PX * BALL_MM) / 304.8

function loadCal() { try { const v = Number(localStorage.getItem(CAL_KEY)); return v > 0 ? v : null } catch { return null } }
function saveCal(c) { try { localStorage.setItem(CAL_KEY, String(c)) } catch {} }
const LINE_KEY = 'stimp_cam_line_v1'  // release line = grass-contact point, as a fraction of frame height
function loadLine() { try { const v = Number(localStorage.getItem(LINE_KEY)); return v > 0 && v < 1 ? v : 0.6 } catch { return 0.6 } }
function saveLine(v) { try { localStorage.setItem(LINE_KEY, String(v)) } catch {} }

export default function StimpCam({ onClose, onResult }) {
  const videoRef = useRef(null)
  const procRef = useRef(null)
  const rafRef = useRef(null)
  const trackRef = useRef(null)

  const [step, setStep] = useState('init')  // init|aim|measuring|result|calibrateAsk|error|manual
  const [errMsg, setErrMsg] = useState('')
  const [seed, setSeed] = useState(null)     // tapped ball start (CSS px)
  const [dot, setDot] = useState(null)       // live tracked pos (CSS px)
  const [liveFt, setLiveFt] = useState(null)
  const [result, setResultFt] = useState(null)
  const [rawResult, setRawResult] = useState(null) // 1/dStop - 1/dStart (for calibration)
  const [calibrating, setCalibrating] = useState(false)
  const [calFt, setCalFt] = useState(''); const [calIn, setCalIn] = useState('')
  const [manFt, setManFt] = useState(''); const [manIn, setManIn] = useState('')
  const [cal, setCal] = useState(null)       // stored multiplier
  const calRef = useRef(null)
  const [lineY, setLineY] = useState(0.6)    // release line (grass contact), fraction of height
  const lineRef = useRef(0.6)
  const draggingRef = useRef(false)
  const dragEndRef = useRef(0)

  useEffect(() => { const c = loadCal(); setCal(c); calRef.current = c; const l = loadLine(); setLineY(l); lineRef.current = l }, [])

  // ── camera ──
  useEffect(() => {
    let stream
    ;(async () => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) { setStep('error'); setErrMsg("This device won't give the app camera access. Use manual entry."); return }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
        const v = videoRef.current; if (!v) return
        v.srcObject = stream; v.setAttribute('playsinline', 'true'); v.muted = true
        await v.play().catch(() => {})
        setStep('aim')
      } catch (e) {
        setStep('error')
        setErrMsg(e?.name === 'NotAllowedError' ? 'Camera permission was blocked. Allow it in your browser settings, or use manual entry.' : "Couldn't start the camera. Use manual entry.")
      }
    })()
    return () => { try { (stream || videoRef.current?.srcObject)?.getTracks?.().forEach((t) => t.stop()) } catch {}; stopLoop() }
  }, [])

  function stopLoop() { try { const v = videoRef.current; if (rafRef.current != null) { if (v?.cancelVideoFrameCallback) v.cancelVideoFrameCallback(rafRef.current); cancelAnimationFrame(rafRef.current) } } catch {} rafRef.current = null }

  const dispFromProc = useCallback((px, py) => {
    const v = videoRef.current; if (!v) return { x: 0, y: 0 }
    const r = v.getBoundingClientRect(); const proc = procRef.current
    return { x: px * (r.width / (proc?.width || PROC_W)), y: py * (r.height / (proc?.height || 1)) }
  }, [])
  const procFromDisp = useCallback((cx, cy) => {
    const v = videoRef.current; if (!v) return { x: 0, y: 0 }
    const r = v.getBoundingClientRect(); const proc = procRef.current
    return { x: cx * ((proc?.width || PROC_W) / r.width), y: cy * ((proc?.height || 1) / r.height) }
  }, [])

  function grabFrame() {
    const v = videoRef.current, c = procRef.current
    if (!v || !c || !v.videoWidth) return null
    const scale = PROC_W / v.videoWidth
    c.width = PROC_W; c.height = Math.round(v.videoHeight * scale)
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(v, 0, 0, c.width, c.height)
    return ctx.getImageData(0, 0, c.width, c.height)
  }

  // Find the BALL blob in a search box: label connected white shapes, keep only
  // compact round ones of a plausible size, and pick the one closest to where the
  // ball is predicted — so glare, sky, ball-marks and the meter don't grab it.
  function findBall(img, box, expectedD, predicted) {
    const { data, width, height } = img
    const x0 = Math.max(0, Math.floor(box.x0)), y0 = Math.max(0, Math.floor(box.y0))
    const x1 = Math.min(width, Math.ceil(box.x1)), y1 = Math.min(height, Math.ceil(box.y1))
    const bw = x1 - x0, bh = y1 - y0
    if (bw < 2 || bh < 2) return null
    const mask = new Uint8Array(bw * bh)
    for (let y = 0; y < bh; y++) {
      let row = ((y + y0) * width + x0) * 4
      for (let x = 0; x < bw; x++, row += 4) {
        const r = data[row], g = data[row + 1], b = data[row + 2]
        if (r > 186 && g > 186 && b > 176 && Math.abs(r - g) < 48 && g - b < 62) mask[y * bw + x] = 1
      }
    }
    const seen = new Uint8Array(bw * bh)
    const stack = []
    const maxN = expectedD ? Math.PI * (expectedD * 1.9 / 2) ** 2 : bw * bh * 0.4
    const minN = 3
    let best = null
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] || seen[i]) continue
      stack.length = 0; stack.push(i); seen[i] = 1
      let sx = 0, sy = 0, n = 0, minx = bw, maxx = 0, miny = bh, maxy = 0
      while (stack.length) {
        const p = stack.pop(), px = p % bw, py = (p / bw) | 0
        sx += px; sy += py; n++
        if (px < minx) minx = px; if (px > maxx) maxx = px; if (py < miny) miny = py; if (py > maxy) maxy = py
        if (px > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1) }
        if (px < bw - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1) }
        if (py > 0 && mask[p - bw] && !seen[p - bw]) { seen[p - bw] = 1; stack.push(p - bw) }
        if (py < bh - 1 && mask[p + bw] && !seen[p + bw]) { seen[p + bw] = 1; stack.push(p + bw) }
      }
      if (n < minN || n > maxN) continue
      const cw = maxx - minx + 1, ch = maxy - miny + 1
      const fill = n / (cw * ch)                     // compactness (a disc ≈ .78)
      const aspect = Math.max(cw, ch) / Math.max(1, Math.min(cw, ch))
      if (fill < 0.45 || aspect > 2.3) continue      // reject streaks/glare/sky edges
      const cx = x0 + sx / n, cy = y0 + sy / n
      const d = 2 * Math.sqrt(n / Math.PI)
      if (expectedD && (d > expectedD * 1.8 || d < expectedD * 0.35)) continue // can't jump size
      let score = 0
      if (predicted) score += Math.hypot(cx - predicted.x, cy - predicted.y)
      if (expectedD) score += Math.abs(d - expectedD) * 1.5
      if (!best || score < best.score) best = { x: cx, y: cy, n, d, score }
    }
    return best
  }
  const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }

  function onVideoTap(e) {
    if (step !== 'aim') return
    if (draggingRef.current || performance.now() - dragEndRef.current < 300) return // that was a line drag
    const v = videoRef.current, rect = v.getBoundingClientRect()
    setSeed({ xDisp: e.clientX - rect.left, yDisp: e.clientY - rect.top })
  }
  // Drag the release line to the meter's base (grass-contact point).
  function onLineDown(e) { e.stopPropagation(); draggingRef.current = true }
  function onStageMove(e) { if (!draggingRef.current) return; const v = videoRef.current, rect = v.getBoundingClientRect(); let f = (e.clientY - rect.top) / rect.height; f = Math.max(0.2, Math.min(0.88, f)); setLineY(f); lineRef.current = f }
  function onStageUp() { if (draggingRef.current) { draggingRef.current = false; dragEndRef.current = performance.now(); saveLine(lineRef.current) } }

  function startMeasure(isCal) {
    setErrMsg(''); setResultFt(null); setLiveFt(0); setCalibrating(!!isCal)
    // Mounted on the meter, the ball always leaves from the same near spot, so we
    // auto-catch it: seed from a tap if given, else the lower-centre start zone
    // with a wide search box that narrows once it locks on.
    const proc = procRef.current
    const start = seed ? procFromDisp(seed.xDisp, seed.yDisp) : { x: (proc?.width || PROC_W) * 0.5, y: (proc?.height || Math.round(PROC_W * 0.56)) * 0.72 }
    // crossed=false until the ball passes the release line (grass contact); only
    // then does the roll-out start counting, with dRef = the ball's size there.
    trackRef.current = { start, last: start, crossed: false, initSide: null, preD: null, dRef: null, dStop: [], moved: false, ftRef: 0, plateauSince: null, t0: null, box: seed ? 60 : 150, lost: 0, stopped: false }
    setStep('measuring')
    loop()
  }

  function finish() {
    const tr = trackRef.current
    if (tr) tr.stopped = true
    stopLoop()
    const dStart = tr?.dRef, dStop = median(tr?.dStop?.length ? tr.dStop : (tr?.lastGoodD ? [tr.lastGoodD] : []))
    if (!tr || !tr.crossed) {
      setStep('aim'); setErrMsg("The ball didn't cross the release line — set the line to the bottom of the meter (grass contact) and try again.")
      return
    }
    if (!tr.moved || !dStart || !dStop || dStop >= dStart) {
      setStep('aim'); setErrMsg("Didn't catch a clean roll away from the camera — re-aim straight down the line and try again (or enter by hand).")
      return
    }
    const raw = (1 / dStop) - (1 / dStart)  // grows as the ball recedes past the line
    setRawResult(raw)
    if (calibrating) { setStep('calibrateAsk'); return }
    const C = calRef.current || DEFAULT_C
    setResultFt(Math.round(C * raw * 100) / 100)
    setStep('result')
  }

  const loop = useCallback(function loop() {
    const v = videoRef.current, tr = trackRef.current
    if (!v || !tr || tr.stopped) return
    const img = grabFrame()
    if (img) {
      const b = tr.box
      const pred = tr.pred || tr.last
      const found = findBall(img, { x0: pred.x - b, y0: pred.y - b, x1: pred.x + b, y1: pred.y + b }, tr.lastGoodD, pred)
      const now = performance.now() / 1000
      if (tr.t0 == null) tr.t0 = now
      const C = calRef.current || DEFAULT_C
      if (found) {
        // velocity-smoothed prediction so the search box rides ahead of the ball
        const vx = tr.lastPos ? found.x - tr.lastPos.x : 0, vy = tr.lastPos ? found.y - tr.lastPos.y : 0
        tr.vel = { x: 0.6 * (tr.vel?.x || 0) + 0.4 * vx, y: 0.6 * (tr.vel?.y || 0) + 0.4 * vy }
        tr.lastPos = { x: found.x, y: found.y }
        tr.pred = { x: found.x + tr.vel.x, y: found.y + tr.vel.y }
        tr.lost = 0; tr.last = { x: found.x, y: found.y }; tr.lastGoodD = found.d
        tr.box = Math.max(20, Math.min(90, found.d * 3.4)) // ROI shrinks as ball recedes
        setDot(dispFromProc(found.x, found.y))
        const lineYpx = lineRef.current * img.height
        const side = Math.sign(found.y - lineYpx) || 1
        if (tr.initSide == null) tr.initSide = side
        if (!tr.crossed) {
          // On the ramp / near side — hold the size at the line; no roll counted yet.
          tr.preD = found.d; setLiveFt(0)
          if (side !== tr.initSide) {                        // ball crossed onto the grass → zero here
            tr.crossed = true
            tr.dRef = (tr.preD + found.d) / 2
            tr.dStop = [found.d]; tr.ftRef = 0; tr.plateauSince = now
          }
        } else {
          const rawNow = (1 / found.d) - (1 / tr.dRef)
          const ftNow = Math.max(0, C * rawNow)
          setLiveFt(Math.round(ftNow * 100) / 100)
          if (ftNow > 0.6) tr.moved = true                  // real roll started (past the line)
          if (tr.moved) {
            // Stop = the DISTANCE estimate stops climbing (scale-independent, so a
            // slow far-away ball isn't mistaken for stopped).
            if (ftNow > tr.ftRef + 0.15) { tr.ftRef = ftNow; tr.plateauSince = now; tr.dStop = [found.d] }
            else { tr.dStop.push(found.d); if (tr.dStop.length > 10) tr.dStop.shift(); if (now - tr.plateauSince > 0.7) { finish(); return } }
          }
        }
      } else {
        tr.lost++; tr.box = Math.min(150, tr.box + 12)
        tr.pred = tr.last; tr.vel = { x: 0, y: 0 }           // stop chasing a ghost
        if (tr.moved && tr.lost > 22) { finish(); return }   // rolled out of view / lost
      }
      if (now - tr.t0 > 16) { finish(); return }
    }
    rafRef.current = v.requestVideoFrameCallback ? v.requestVideoFrameCallback(() => loop()) : requestAnimationFrame(() => loop())
  }, [dispFromProc])

  function saveCalibration() {
    const feet = stimpToFeet(calFt, calIn)
    if (!(feet > 0) || !(rawResult > 0)) { setErrMsg('Enter the hand-measured distance.'); return }
    const C = feet / rawResult
    saveCal(C); setCal(C); calRef.current = C
    setCalibrating(false); setErrMsg(''); setCalFt(''); setCalIn('')
    setResultFt(Math.round(C * rawResult * 100) / 100); setStep('result')
  }

  function acceptResult() { if (result != null && onResult) onResult(result); onClose?.() }
  function saveManual() { const f = stimpToFeet(manFt, manIn); if (f > 0 && onResult) onResult(f); onClose?.() }

  const overlay = { position: 'absolute', inset: 0, pointerEvents: 'none' }
  const btn = (bg, extra = {}) => ({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontSize: 14, fontWeight: 700, color: '#fff', background: bg, border: 0, borderRadius: 12, padding: '12px 16px', cursor: 'pointer', ...extra })

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 90, background: '#0B0B0A', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', color: '#fff', background: FOREST }}>
        <Camera size={18} style={{ color: GOLD }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Measure green speed <span style={{ fontSize: 10, fontWeight: 700, color: GOLD, border: `1px solid ${GOLD}`, borderRadius: 6, padding: '1px 5px', marginLeft: 4 }}>BETA</span></div>
          <div style={{ fontSize: 10.5, opacity: .7 }}>Phone on the meter end · aim down the line{cal ? ' · calibrated' : ' · not calibrated'}</div>
        </div>
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,.12)', border: 0, borderRadius: 10, padding: 8, color: '#fff', cursor: 'pointer' }}><X size={18} /></button>
      </div>

      <div style={{ position: 'relative', flex: 1, background: '#000', overflow: 'hidden' }} onClick={onVideoTap} onPointerMove={onStageMove} onPointerUp={onStageUp} onPointerLeave={onStageUp}>
        <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'contain', display: step === 'error' || step === 'manual' || step === 'calibrateAsk' ? 'none' : 'block' }} />
        <canvas ref={procRef} style={{ display: 'none' }} />

        {/* down-the-line guide + draggable release line */}
        {step === 'aim' && (
          <div style={overlay}>
            <div style={{ position: 'absolute', left: '50%', top: '35%', bottom: 0, width: 2, marginLeft: -1, background: 'linear-gradient(to bottom, rgba(201,168,76,0), rgba(201,168,76,.7))' }} />
            {seed && <div style={{ position: 'absolute', left: seed.xDisp - 10, top: seed.yDisp - 10, width: 20, height: 20, border: `2px solid ${FERN}`, borderRadius: '50%', background: 'rgba(58,107,74,.25)' }} />}
            {/* release line — drag to the bottom of the meter */}
            <div onPointerDown={onLineDown} style={{ position: 'absolute', left: 0, right: 0, top: `${lineY * 100}%`, transform: 'translateY(-50%)', height: 30, display: 'flex', alignItems: 'center', pointerEvents: 'auto', cursor: 'ns-resize', touchAction: 'none' }}>
              <div style={{ position: 'absolute', left: 0, right: 0, height: 2, background: GOLD, boxShadow: '0 0 6px rgba(0,0,0,.6)' }} />
              <span style={{ position: 'absolute', left: 8, top: -16, fontSize: 10, fontWeight: 700, color: GOLD, textShadow: '0 1px 3px rgba(0,0,0,.8)', letterSpacing: '.06em' }}>RELEASE LINE — drag to meter base</span>
              <div style={{ position: 'absolute', right: 10, width: 18, height: 18, borderRadius: '50%', background: GOLD, border: '2px solid #fff' }} />
            </div>
          </div>
        )}
        {/* static release line while measuring */}
        {step === 'measuring' && <div style={overlay}><div style={{ position: 'absolute', left: 0, right: 0, top: `${lineY * 100}%`, height: 1.5, background: 'rgba(201,168,76,.6)' }} /></div>}
        {step === 'measuring' && dot && <div style={overlay}><div style={{ position: 'absolute', left: dot.x - 7, top: dot.y - 7, width: 14, height: 14, border: '2px solid #fff', borderRadius: '50%', boxShadow: '0 0 8px rgba(255,255,255,.85)' }} /></div>}
        {step === 'measuring' && (
          <div style={{ position: 'absolute', left: 0, right: 0, top: 12, textAlign: 'center', color: '#fff', pointerEvents: 'none' }}>
            <div style={{ display: 'inline-block', background: 'rgba(0,0,0,.5)', borderRadius: 12, padding: '6px 14px', fontSize: 26, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmtStimp(liveFt)}</div>
            <div style={{ fontSize: 11, opacity: .8, marginTop: 4 }}>tracking the ball away…</div>
          </div>
        )}
      </div>

      <div style={{ background: '#141412', color: '#fff', padding: '14px 16px 22px' }}>
        {errMsg && <p style={{ color: '#FCA5A5', fontSize: 12.5, margin: '0 0 10px' }}>{errMsg}</p>}

        {step === 'init' && <p style={{ fontSize: 13, opacity: .8, margin: 0 }}>Starting camera…</p>}

        {step === 'aim' && (
          <>
            <p style={{ fontSize: 12.5, opacity: .85, margin: '0 0 10px', lineHeight: 1.5 }}><Crosshair size={13} style={{ verticalAlign: -2, color: GOLD }} /> Clamp the phone to the <b>end of the Stimpmeter</b>, lens down the line. Drag the <b style={{ color: GOLD }}>gold release line</b> to where the ball meets the grass at the meter's base — the roll-out is counted from there. Hit <b>Start</b>, then lift to release.</p>
            {!cal && <p style={{ fontSize: 11.5, color: GOLD, margin: '0 0 10px' }}>Not calibrated yet — do one <b>Calibrate roll</b> against a hand measurement first for a real number.</p>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => startMeasure(true)} style={btn('#2A2A26', { flex: 'none' })}><SlidersHorizontal size={15} /> Calibrate roll</button>
              <button onClick={() => startMeasure(false)} style={btn(FERN, { flex: 1 })}><Camera size={16} /> Start</button>
            </div>
          </>
        )}

        {step === 'measuring' && <button onClick={finish} style={btn('#2A2A26', { width: '100%' })}>Stop &amp; read</button>}

        {step === 'calibrateAsk' && (
          <>
            <p style={{ fontSize: 13, margin: '0 0 12px', opacity: .9 }}>Good roll. Now measure that same roll-out <b>by hand</b> and enter it — the app will learn the multiplier for this phone &amp; setup.</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <input type="number" inputMode="numeric" value={calFt} onChange={(e) => setCalFt(e.target.value)} placeholder="9" style={{ width: 70, textAlign: 'center', fontSize: 20, fontWeight: 700, padding: 10, borderRadius: 10, border: 0 }} />
              <span style={{ opacity: .6 }}>′</span>
              <input type="number" inputMode="numeric" min="0" max="11" value={calIn} onChange={(e) => setCalIn(e.target.value)} placeholder="10" style={{ width: 70, textAlign: 'center', fontSize: 20, fontWeight: 700, padding: 10, borderRadius: 10, border: 0 }} />
              <span style={{ opacity: .6 }}>″</span>
            </div>
            <button onClick={saveCalibration} style={btn(GOLD, { width: '100%', color: INK })}><Check size={16} /> Save calibration</button>
          </>
        )}

        {step === 'result' && (
          <>
            <div style={{ textAlign: 'center', margin: '2px 0 14px' }}>
              <div style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', opacity: .6 }}>Measured roll-out</div>
              <div style={{ fontSize: 46, fontWeight: 800, color: GOLD, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{fmtStimp(result)}</div>
              <div style={{ fontSize: 11, opacity: .6 }}>{cal ? 'Sanity-check against a hand roll now and then.' : 'Rough estimate — calibrate for an accurate number.'}</div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setStep('aim'); setResultFt(null); setDot(null) }} style={btn('#2A2A26', { flex: 'none' })}><RotateCcw size={15} /> Redo</button>
              <button onClick={acceptResult} style={btn(FERN, { flex: 1 })}><Check size={16} /> Use {fmtStimp(result)}</button>
            </div>
          </>
        )}

        {(step === 'error' || step === 'manual') && (
          <>
            <p style={{ fontSize: 13, margin: '0 0 12px', opacity: .85 }}>{step === 'error' ? errMsg : 'Enter the reading you measured by hand.'}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <input type="number" inputMode="numeric" value={manFt} onChange={(e) => setManFt(e.target.value)} placeholder="9" style={{ width: 70, textAlign: 'center', fontSize: 20, fontWeight: 700, padding: 10, borderRadius: 10, border: 0 }} />
              <span style={{ opacity: .6 }}>′</span>
              <input type="number" inputMode="numeric" min="0" max="11" value={manIn} onChange={(e) => setManIn(e.target.value)} placeholder="10" style={{ width: 70, textAlign: 'center', fontSize: 20, fontWeight: 700, padding: 10, borderRadius: 10, border: 0 }} />
              <span style={{ opacity: .6 }}>″</span>
            </div>
            <button onClick={saveManual} style={btn(FERN, { width: '100%' })}><Check size={16} /> Use this reading</button>
          </>
        )}

        {step !== 'measuring' && step !== 'manual' && step !== 'error' && step !== 'calibrateAsk' && (
          <button onClick={() => setStep('manual')} style={{ width: '100%', marginTop: 10, background: 'none', border: 0, color: INK_3, fontSize: 12, textDecoration: 'underline', cursor: 'pointer' }}>Enter by hand instead</button>
        )}
      </div>
    </div>
  )
}
