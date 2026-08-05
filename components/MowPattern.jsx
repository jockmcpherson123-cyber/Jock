'use client'

// A little illustrated turf tile showing the day's mow direction the way it
// looks on the course:
//   - axis   → a GREEN with a collar, a bunker and a pin/flag, striped light/
//              dark along the clock axis (12–6 up/down, 3–9 across, 2–8 diag…)
//   - circle → a FAIRWAY cut "half & half": split clean up the middle, one side
//              dark, the other light, with arrows for clockwise / anti-clockwise.
// Drawn in a fixed 100×72 viewBox so it scales cleanly to any size.
import { useId } from 'react'

// Turf palette
const ROUGH = '#2C6A3D'
const COLLAR = '#4A8B58'
const G_DARK = '#3C9A57'   // green stripe — mowed toward you
const G_LIGHT = '#69C283'  // green stripe — mowed away
const EDGE = '#20502F'
// fairway stripe sets — one half clearly dark, the other clearly light, so the
// split reads at a glance (only a faint stripe texture within each half).
const F_DARK1 = '#297040', F_DARK2 = '#2F7D47'
const F_LIGHT1 = '#6AC384', F_LIGHT2 = '#77CE90'
// features
const SAND = '#EADEB4', SAND_EDGE = '#C9B47C'
const FLAG = '#D6452F', STICK = '#F4F4F0', HOLE = '#16261C'
const SEAM = 'rgba(255,255,255,0.55)'
const ARROW = 'rgba(255,255,255,0.96)'
const ARROW_EDGE = 'rgba(18,40,26,0.4)'

// A field of parallel light/dark bands, rotated to the mow angle, centered on
// the tile so it fills whatever shape clips it.
function Bands({ angle, cA, cB, band = 11, off = 0 }) {
  const cx = 50, cy = 36, diag = 132
  const n = Math.ceil((diag * 2) / band)
  const rects = []
  for (let i = 0; i < n; i++) rects.push(<rect key={i} x={cx - diag + i * band} y={cy - diag} width={band + 0.6} height={diag * 2} fill={(i + off) % 2 ? cB : cA} />)
  return <g transform={`rotate(${angle} ${cx} ${cy})`}>{rects}</g>
}

// A straight mow arrow (points up or down), white with a soft dark edge so it
// reads on any stripe.
function VArrow({ x, top, bottom, dir }) {
  const headY = dir === 'up' ? top : bottom
  const head = dir === 'up'
    ? `${x},${headY} ${x - 4.2},${headY + 6.5} ${x + 4.2},${headY + 6.5}`
    : `${x},${headY} ${x - 4.2},${headY - 6.5} ${x + 4.2},${headY - 6.5}`
  return (
    <g>
      <line x1={x} y1={top} x2={x} y2={bottom} stroke={ARROW_EDGE} strokeWidth={4} strokeLinecap="round" />
      <line x1={x} y1={top} x2={x} y2={bottom} stroke={ARROW} strokeWidth={2.4} strokeLinecap="round" />
      <polygon points={head} fill={ARROW} stroke={ARROW_EDGE} strokeWidth={0.6} />
    </g>
  )
}

export default function MowPattern({ step, size = 72 }) {
  const rid = useId().replace(/[:]/g, '')
  const W = size
  const H = Math.round(size * 0.72)
  const svg = { width: W, height: H, viewBox: '0 0 100 72', style: { display: 'block' } }

  if (!step) {
    return <svg {...svg} aria-hidden="true"><rect x="1" y="1" width="98" height="70" rx="14" fill="#EDEFEA" stroke="#D8D6D0" /></svg>
  }

  // ── GREEN ─────────────────────────────────────────────────────────────────
  if (step.type === 'axis') {
    const angle = (step.a % 12) * 30
    const clip = `g${rid}`
    return (
      <svg {...svg} aria-hidden="true">
        <defs><clipPath id={clip}><ellipse cx="49" cy="37" rx="37" ry="24" /></clipPath></defs>
        {/* rough */}
        <rect x="1" y="1" width="98" height="70" rx="14" fill={ROUGH} />
        {/* collar */}
        <ellipse cx="49" cy="37" rx="40" ry="26.5" fill={COLLAR} />
        {/* striped putting surface */}
        <g clipPath={`url(#${clip})`}><Bands angle={angle} cA={G_DARK} cB={G_LIGHT} /></g>
        <ellipse cx="49" cy="37" rx="37" ry="24" fill="none" stroke={EDGE} strokeWidth="1" />
        {/* bunker, lower-left */}
        <g transform="rotate(-14 27 58)">
          <ellipse cx="27" cy="58" rx="15" ry="7.5" fill={SAND} stroke={SAND_EDGE} strokeWidth="1" />
          <ellipse cx="27" cy="57" rx="10" ry="4.2" fill="#F1E8C9" opacity="0.6" />
        </g>
        {/* hole + pin, upper-right */}
        <ellipse cx="69" cy="28" rx="2.6" ry="1.7" fill={HOLE} />
        <line x1="69" y1="27" x2="69" y2="7" stroke={ARROW_EDGE} strokeWidth="2.4" strokeLinecap="round" />
        <line x1="69" y1="27" x2="69" y2="7" stroke={STICK} strokeWidth="1.5" strokeLinecap="round" />
        <polygon points="69,7 83,10.5 69,14.5" fill={FLAG} />
      </svg>
    )
  }

  // ── FAIRWAY: half & half, split up the middle ─────────────────────────────
  const cw = step.dir !== 'acw'
  const fair = `f${rid}`, lClip = `fl${rid}`, rClip = `fr${rid}`
  const leftSet = cw ? [F_DARK1, F_DARK2] : [F_LIGHT1, F_LIGHT2]
  const rightSet = cw ? [F_LIGHT1, F_LIGHT2] : [F_DARK1, F_DARK2]
  return (
    <svg {...svg} aria-hidden="true">
      <defs>
        <clipPath id={fair}><rect x="7" y="8" width="86" height="56" rx="13" /></clipPath>
        <clipPath id={lClip}><rect x="0" y="0" width="50" height="72" /></clipPath>
        <clipPath id={rClip}><rect x="50" y="0" width="50" height="72" /></clipPath>
      </defs>
      {/* rough */}
      <rect x="1" y="1" width="98" height="70" rx="14" fill={ROUGH} />
      {/* fairway, two halves striped down its length */}
      <g clipPath={`url(#${fair})`}>
        <g clipPath={`url(#${lClip})`}><Bands angle={0} cA={leftSet[0]} cB={leftSet[1]} band={9} /></g>
        <g clipPath={`url(#${rClip})`}><Bands angle={0} cA={rightSet[0]} cB={rightSet[1]} band={9} off={1} /></g>
      </g>
      <rect x="7" y="8" width="86" height="56" rx="13" fill="none" stroke={EDGE} strokeWidth="1" />
      {/* clean seam up the middle */}
      <line x1="50" y1="9" x2="50" y2="63" stroke="rgba(18,40,26,0.35)" strokeWidth="2.2" />
      <line x1="50" y1="9" x2="50" y2="63" stroke={SEAM} strokeWidth="1" />
      {/* mow-loop arrows: up one half, down the other (cw vs acw flips them) */}
      <VArrow x={29} top={18} bottom={54} dir={cw ? 'up' : 'down'} />
      <VArrow x={71} top={18} bottom={54} dir={cw ? 'down' : 'up'} />
    </svg>
  )
}
