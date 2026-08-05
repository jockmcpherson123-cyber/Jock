'use client'

// A little clock face that shows a day's mow direction:
//   - axis   → a double-headed arrow across the face (e.g. 12–6, 2–8)
//   - circle → a curved half-and-half arrow, clockwise or anti-clockwise
// Pure SVG so it prints and shows crisp on the shop TV.

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const HAIR = '#D8D6D0'
const INK_3 = '#8A8984'

// A point on the clock face for a given hour (12 at top, going clockwise).
function pt(cx, cy, r, hour) {
  const rad = (hour * 30 * Math.PI) / 180
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)]
}

// A little arrowhead (triangle) whose tip is at (x,y), pointing along `ang`.
function Arrow({ x, y, ang, size, color }) {
  const back = ang + Math.PI
  const spread = 0.42
  const p1 = [x + size * Math.cos(back - spread), y + size * Math.sin(back - spread)]
  const p2 = [x + size * Math.cos(back + spread), y + size * Math.sin(back + spread)]
  return <polygon points={`${x},${y} ${p1[0]},${p1[1]} ${p2[0]},${p2[1]}`} fill={color} />
}

export default function MowClock({ step, size = 68, color = FOREST, numbers }) {
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 1.5
  const showAll = numbers != null ? numbers : size >= 96
  const hours = showAll ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : [12, 3, 6, 9]
  const numR = r - Math.max(7, size * 0.12)
  const fs = Math.max(6, size * 0.13)

  const marks = []
  const ah = Math.max(5, size * 0.13) // arrowhead size

  if (step && step.type === 'axis') {
    const inset = size * 0.16
    const [ax, ay] = pt(cx, cy, r - inset, step.a)
    const [bx, by] = pt(cx, cy, r - inset, step.b)
    const ang = Math.atan2(by - ay, bx - ax)
    marks.push(<line key="ln" x1={ax} y1={ay} x2={bx} y2={by} stroke={color} strokeWidth={Math.max(2, size * 0.045)} strokeLinecap="round" />)
    marks.push(<Arrow key="a1" x={bx} y={by} ang={ang} size={ah} color={color} />)
    marks.push(<Arrow key="a2" x={ax} y={ay} ang={ang + Math.PI} size={ah} color={color} />)
  } else if (step && step.type === 'circle') {
    const cw = step.dir !== 'acw'
    const ar = r - size * 0.2
    // A ~300° arc so it clearly reads as "going round". Sweep direction = cw/acw.
    const start = cw ? 210 : 330
    const end = cw ? 510 : 30
    const [sx, sy] = pt(cx, cy, ar, start / 30)
    const [ex, ey] = pt(cx, cy, ar, end / 30)
    const sweep = cw ? 1 : 0
    marks.push(<path key="arc" d={`M ${sx} ${sy} A ${ar} ${ar} 0 1 ${sweep} ${ex} ${ey}`} fill="none" stroke={color} strokeWidth={Math.max(2, size * 0.045)} strokeLinecap="round" />)
    // Tangent direction at the end point for the arrowhead.
    const endRad = (end * Math.PI) / 180
    const tang = endRad + (cw ? Math.PI / 2 : -Math.PI / 2)
    marks.push(<Arrow key="ah" x={ex} y={ey} ang={tang} size={ah} color={color} />)
    // A faint down-the-middle split line to hint "half and half".
    const [tx, ty] = pt(cx, cy, ar, 0)
    const [bx2, by2] = pt(cx, cy, ar, 6)
    marks.push(<line key="split" x1={tx} y1={ty} x2={bx2} y2={by2} stroke={color} strokeWidth={1} strokeDasharray="2 3" opacity={0.4} />)
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }} aria-hidden="true">
      <circle cx={cx} cy={cy} r={r} fill="#FFFFFF" stroke={HAIR} strokeWidth={1.5} />
      {hours.map((h) => {
        const [x, y] = pt(cx, cy, numR, h)
        return <text key={h} x={x} y={y + fs * 0.35} textAnchor="middle" fontSize={fs} fontFamily="Inter, system-ui, sans-serif" fontWeight="700" fill={INK_3}>{h}</text>
      })}
      {marks}
      <circle cx={cx} cy={cy} r={Math.max(1.5, size * 0.03)} fill={color} />
    </svg>
  )
}

export { FOREST as CLOCK_FOREST, FERN as CLOCK_FERN }
