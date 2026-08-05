// Turf artwork for the mowing-direction tiles — pure functions returning an
// <svg> string, so the exact same drawing renders in the app (via
// dangerouslySetInnerHTML) and in offline previews.
//
// Style: a clock-face BADGE per surface (inspired by the shop board, but nicer)
// — a white ring with clock numbers, a disc of real striped turf inside, and a
// bold outlined arrow showing the mow direction:
//   - axis   → a double-headed arrow along the clock axis (12–6, 2–8, …)
//   - circle → a rotation swirl, clockwise or anti-clockwise (half & half)
// Grass surfaces get green turf; bunkers get raked sand.

const C = {
  ring: '#F7F6F1', ringEdge: '#E4E2DC', num: '#5B6160',
  greenA: '#3F9E5D', greenB: '#61C07D',
  fairA: '#379150', fairB: '#5DBA76',
  sandA: '#E4D5AC', sandB: '#F0E4C2', sandEdge: '#C6B180',
  turfEdge: '#255C36',
  gold: '#F6C445', goldHi: '#FFD866', arrowOut: '#173A22',
  orange: '#F2932E',
}

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h).toString(36) }
// A point on a clock face (12 at top, going clockwise).
function cp(cx, cy, r, hour) { const d = (hour * 30 * Math.PI) / 180; return [cx + r * Math.sin(d), cy - r * Math.cos(d)] }
function headPts(x, y, ang, size) { const b = ang + Math.PI, s = 0.44; return `${x.toFixed(2)},${y.toFixed(2)} ${(x + size * Math.cos(b - s)).toFixed(2)},${(y + size * Math.sin(b - s)).toFixed(2)} ${(x + size * Math.cos(b + s)).toFixed(2)},${(y + size * Math.sin(b + s)).toFixed(2)}` }

function defs(id) {
  return `<defs>
    <filter id="b${id}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="0.5"/></filter>
    <filter id="sh${id}" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="1.4" stdDeviation="1.6" flood-color="#0c2113" flood-opacity="0.34"/></filter>
    <filter id="g${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="11" stitchTiles="stitch" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.9 0"/></filter>
    <radialGradient id="sun${id}" cx="0.34" cy="0.28" r="0.9"><stop offset="0" stop-color="#fffce8" stop-opacity="0.4"/><stop offset="0.55" stop-color="#fffce8" stop-opacity="0.06"/><stop offset="1" stop-color="#fffce8" stop-opacity="0"/></radialGradient>
    <radialGradient id="vig${id}" cx="0.5" cy="0.5" r="0.62"><stop offset="0.55" stop-color="#0a2012" stop-opacity="0"/><stop offset="1" stop-color="#0a2012" stop-opacity="0.36"/></radialGradient>
    <radialGradient id="ring${id}" cx="0.5" cy="0.4" r="0.7"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="${C.ring}"/></radialGradient>
  </defs>`
}

// Parallel soft-edged mowing stripes, rotated to the mow angle.
function stripes(angle, cA, cB, band, off, id) {
  const cx = 50, cy = 50, diag = 80, n = Math.ceil((diag * 2) / band)
  let r = ''
  for (let i = 0; i < n; i++) r += `<rect x="${(cx - diag + i * band).toFixed(1)}" y="${cy - diag}" width="${(band + 0.8).toFixed(1)}" height="${diag * 2}" fill="${(i + off) % 2 ? cB : cA}"/>`
  return `<g filter="url(#b${id})" transform="rotate(${angle} ${cx} ${cy})">${r}</g>`
}

// The turf (or sand) disc: striped fill + grain + sun + vignette, clipped round.
function disc(cx, cy, r, angle, cA, cB, band, id, sand = false) {
  const clip = `d${id}`
  let rake = ''
  if (sand) {
    rake = `<g clip-path="url(#${clip})" opacity="0.5">` +
      [0.32, 0.5, 0.68].map((f) => `<path d="M${cx - r},${cy - r + 2 * r * f} Q${cx},${cy - r + 2 * r * f - 3} ${cx + r},${cy - r + 2 * r * f}" fill="none" stroke="${C.sandEdge}" stroke-width="0.7"/>`).join('') + `</g>`
  }
  return `<clipPath id="${clip}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${cA}"/>
    <g clip-path="url(#${clip})">${stripes(angle, cA, cB, band, 0, id)}</g>
    ${rake}
    <g clip-path="url(#${clip})">
      <rect x="0" y="0" width="100" height="100" fill="url(#sun${id})"/>
      <rect x="0" y="0" width="100" height="100" filter="url(#g${id})" opacity="${sand ? 0.5 : 0.34}" style="mix-blend-mode:soft-light"/>
      <rect x="0" y="0" width="100" height="100" fill="url(#vig${id})"/>
    </g>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${sand ? C.sandEdge : C.turfEdge}" stroke-width="1.4" opacity="0.85"/>`
}

// The white clock ring with numbers 1–12.
function ringFace(cx, cy, numbers, id) {
  const nums = numbers ? Array.from({ length: 12 }, (_, i) => {
    const h = i + 1
    const [x, y] = cp(cx, cy, 43.5, h)
    return `<text x="${x.toFixed(2)}" y="${(y + 3).toFixed(2)}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="8.4" font-weight="700" fill="${C.num}">${h}</text>`
  }).join('') : ''
  return `<circle cx="${cx}" cy="${cy}" r="49" fill="url(#ring${id})" stroke="${C.ringEdge}" stroke-width="1"/>${nums}`
}

// A bold, outlined double-headed arrow between two clock hours.
function doubleArrow(cx, cy, r, a, b, id) {
  const [ax, ay] = cp(cx, cy, r, a), [bx, by] = cp(cx, cy, r, b)
  const ang = Math.atan2(by - ay, bx - ax)
  const hs = 10
  const line = (col, w) => `<line x1="${ax.toFixed(2)}" y1="${ay.toFixed(2)}" x2="${bx.toFixed(2)}" y2="${by.toFixed(2)}" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>`
  return `${line(C.arrowOut, 8.5)}<polygon points="${headPts(bx, by, ang, hs + 1.6)}" fill="${C.arrowOut}"/><polygon points="${headPts(ax, ay, ang + Math.PI, hs + 1.6)}" fill="${C.arrowOut}"/>
    ${line(C.gold, 4.6)}<polygon points="${headPts(bx, by, ang, hs)}" fill="${C.gold}"/><polygon points="${headPts(ax, ay, ang + Math.PI, hs)}" fill="${C.gold}"/>`
}

// A rotation swirl (two curved arrows) — clockwise or anti-clockwise.
function rotArrows(cx, cy, r, cw, id) {
  const segs = cw ? [[35, 165], [215, 345]] : [[165, 35], [345, 215]]
  const sweep = cw ? 1 : 0
  let out = ''
  const arc = (col, w, heads) => segs.map(([s, e]) => {
    const [sx, sy] = cp(cx, cy, r, s / 30), [ex, ey] = cp(cx, cy, r, e / 30)
    const rad = (e * Math.PI) / 180
    const ang = cw ? rad : rad + Math.PI
    const head = heads ? `<polygon points="${headPts(ex, ey, ang, w * 2.1)}" fill="${col}"/>` : ''
    return `<path d="M${sx.toFixed(2)},${sy.toFixed(2)} A${r} ${r} 0 0 ${sweep} ${ex.toFixed(2)},${ey.toFixed(2)}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>${head}`
  }).join('')
  out += arc(C.arrowOut, 8.5, true)
  out += arc(C.gold, 4.6, true)
  // little outer accent arrows, like the shop board
  const acc = cw ? [80, 260] : [100, 280]
  out += acc.map((deg) => { const [x, y] = cp(cx, cy, 45, deg / 30); const ang = cw ? (deg * Math.PI / 180) : (deg * Math.PI / 180 + Math.PI); return `<polygon points="${headPts(x, y, ang, 5)}" fill="${C.orange}"/>` }).join('')
  return out
}

const stripeAngle = (step) => (step && step.type === 'axis' ? (step.a % 12) * 30 : 0)

export function turfSVG({ kind = 'green', step, size = 72 } = {}) {
  const S = size
  const id = hash([kind, step && step.type, step && step.a, step && step.b, step && step.dir, size].join('-'))
  const cx = 50, cy = 50
  const sand = kind === 'bunker'
  const [cA, cB, band] = sand ? [C.sandA, C.sandB, 9]
    : kind === 'fairway' ? [C.fairA, C.fairB, 10]
      : kind === 'green' ? [C.greenA, C.greenB, 7]
        : [C.greenA, C.greenB, 8]
  const isCircle = step && step.type === 'circle'
  const showNumbers = !isCircle && S >= 52
  const discR = showNumbers ? 34.5 : (isCircle ? 39 : 37)
  const arrowR = discR * 0.82

  let arrow = ''
  if (isCircle) arrow = rotArrows(cx, cy, arrowR, step.dir !== 'acw', id)
  else if (step && step.type === 'axis') arrow = doubleArrow(cx, cy, arrowR, step.a, step.b, id)

  return `<svg width="${S}" height="${S}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="display:block">${defs(id)}
    <g filter="url(#sh${id})">${ringFace(cx, cy, showNumbers, id)}</g>
    ${disc(cx, cy, discR, stripeAngle(step), cA, cB, band, id, sand)}
    ${arrow}
  </svg>`
}

export default turfSVG
