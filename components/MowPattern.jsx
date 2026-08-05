'use client'

// A little striped-turf tile that shows the day's mow direction the way it
// actually looks on the course — light/dark mowing stripes running in the
// direction of cut:
//   - axis   → a GREEN (oval) with straight stripes along the clock axis
//              (12–6 = up/down, 3–9 = across, 2–8 = diagonal, …)
//   - circle → a FAIRWAY (rounded rectangle) cut "half & half": the two halves
//              striped opposite ways, with a curved arrow for clockwise /
//              anti-clockwise.
import { useId } from 'react'

const DARK = '#2F7D46'   // stripe mowed toward you
const LIGHT = '#63B77C'  // stripe mowed away
const EDGE = '#245F37'
const ARROW = 'rgba(255,255,255,0.92)'
const ARROW_LINE = 'rgba(20,45,28,0.55)'

// A field of parallel light/dark bands, rotated to the mow angle, big enough to
// cover the tile once clipped. angle is degrees from vertical (0 = up/down).
function Bands({ angle, W, H, band, cx, cy, keyOffset = 0 }) {
  const diag = Math.ceil(Math.sqrt(W * W + H * H)) + band * 2
  const n = Math.ceil((diag * 2) / band)
  const rects = []
  for (let i = 0; i < n; i++) {
    rects.push(<rect key={i} x={cx - diag + i * band} y={cy - diag} width={band + 0.5} height={diag * 2} fill={(i + keyOffset) % 2 ? LIGHT : DARK} />)
  }
  return <g transform={`rotate(${angle} ${cx} ${cy})`}>{rects}</g>
}

function CurvedArrow({ cx, cy, r, cw }) {
  const p = (deg) => [cx + r * Math.sin((deg * Math.PI) / 180), cy - r * Math.cos((deg * Math.PI) / 180)]
  const start = cw ? -120 : 120
  const end = cw ? 120 : -120
  const [sx, sy] = p(start)
  const [ex, ey] = p(end)
  const sweep = cw ? 1 : 0
  const endRad = (end * Math.PI) / 180
  const tang = endRad + (cw ? Math.PI / 2 : -Math.PI / 2) + Math.PI / 2 * 0 // tangent at end
  const s = r * 0.5
  const back = tang + Math.PI
  const spread = 0.5
  const a1 = [ex + s * Math.cos(back - spread), ey + s * Math.sin(back - spread)]
  const a2 = [ex + s * Math.cos(back + spread), ey + s * Math.sin(back + spread)]
  return (
    <g>
      <path d={`M ${sx} ${sy} A ${r} ${r} 0 1 ${sweep} ${ex} ${ey}`} fill="none" stroke={ARROW} strokeWidth={Math.max(2, r * 0.28)} strokeLinecap="round" />
      <polygon points={`${ex},${ey} ${a1[0]},${a1[1]} ${a2[0]},${a2[1]}`} fill={ARROW} />
    </g>
  )
}

export default function MowPattern({ step, size = 72 }) {
  const rid = useId().replace(/[:]/g, '')
  const W = size
  const H = Math.round(size * 0.72)
  const cx = W / 2
  const cy = H / 2
  const band = Math.max(5, Math.round(size / 6))

  if (!step) {
    return <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }} aria-hidden="true"><rect x="1" y="1" width={W - 2} height={H - 2} rx={H * 0.28} fill="#EDEFEA" stroke="#D8D6D0" /></svg>
  }

  // ── GREEN: straight stripes along the clock axis ──────────────────────────
  if (step.type === 'axis') {
    // angle from vertical: 12–6 = 0°, 1–7 = 30°, … 3–9 = 90°, 5–11 = 150°.
    const angle = ((step.a % 12) * 30)
    const clip = `g${rid}`
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }} aria-hidden="true">
        <defs><clipPath id={clip}><ellipse cx={cx} cy={cy} rx={W / 2 - 1.5} ry={H / 2 - 1.5} /></clipPath></defs>
        <g clipPath={`url(#${clip})`}><Bands angle={angle} W={W} H={H} band={band} cx={cx} cy={cy} /></g>
        <ellipse cx={cx} cy={cy} rx={W / 2 - 1.5} ry={H / 2 - 1.5} fill="none" stroke={EDGE} strokeWidth={1.5} />
      </svg>
    )
  }

  // ── FAIRWAY: half & half, two halves cut opposite ways + loop arrow ────────
  const cw = step.dir !== 'acw'
  const clip = `f${rid}`
  const lClip = `fl${rid}`
  const rClip = `fr${rid}`
  const rx = H * 0.26
  const leftAngle = cw ? 40 : 140
  const rightAngle = cw ? 140 : 40
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }} aria-hidden="true">
      <defs>
        <clipPath id={clip}><rect x="1.5" y="1.5" width={W - 3} height={H - 3} rx={rx} /></clipPath>
        <clipPath id={lClip}><rect x="0" y="0" width={cx} height={H} /></clipPath>
        <clipPath id={rClip}><rect x={cx} y="0" width={cx} height={H} /></clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <g clipPath={`url(#${lClip})`}><Bands angle={leftAngle} W={W} H={H} band={band} cx={cx} cy={cy} /></g>
        <g clipPath={`url(#${rClip})`}><Bands angle={rightAngle} W={W} H={H} band={band} cx={cx} cy={cy} keyOffset={1} /></g>
      </g>
      <line x1={cx} y1={2} x2={cx} y2={H - 2} stroke="rgba(255,255,255,0.35)" strokeWidth={1} strokeDasharray="2 2" />
      <CurvedArrow cx={cx} cy={cy} r={Math.min(W, H) * 0.26} cw={cw} />
      <rect x="1.5" y="1.5" width={W - 3} height={H - 3} rx={rx} fill="none" stroke={EDGE} strokeWidth={1.5} />
    </svg>
  )
}
