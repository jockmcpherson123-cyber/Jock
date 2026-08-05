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
  greenA: '#3F9E5D', greenB: '#61C07D', collar: '#57986A',
  fairA: '#379150', fairB: '#5DBA76',
  // half & half: one side clearly dark, the other clearly light (stripes kept
  // within each half for clubs that stripe their fairways)
  fairDark1: '#2E7D46', fairDark2: '#357F4A', fairLight1: '#63C081', fairLight2: '#71CB8C',
  sandA: '#E4D5AC', sandB: '#F0E4C2', sandEdge: '#C6B180',
  turfEdge: '#255C36',
  gold: '#F6C445', goldHi: '#FFD866', arrowOut: '#173A22',
  orange: '#F2932E',
}

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h).toString(36) }
// A point on a clock face (12 at top, going clockwise).
function cp(cx, cy, r, hour) { const d = (hour * 30 * Math.PI) / 180; return [cx + r * Math.sin(d), cy - r * Math.cos(d)] }
// Arrowhead points. `s` is the half-angle at the tip — smaller = sharper/more
// pointed. Keep it tight so the direction reads clearly.
function headPts(x, y, ang, size, s = 0.34) { const b = ang + Math.PI; return `${x.toFixed(2)},${y.toFixed(2)} ${(x + size * Math.cos(b - s)).toFixed(2)},${(y + size * Math.sin(b - s)).toFixed(2)} ${(x + size * Math.cos(b + s)).toFixed(2)},${(y + size * Math.sin(b + s)).toFixed(2)}` }

function defs(id) {
  return `<defs>
    <filter id="b${id}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="0.5"/></filter>
    <filter id="sh${id}" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="1.4" stdDeviation="1.6" flood-color="#0c2113" flood-opacity="0.34"/></filter>
    <filter id="g${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="11" stitchTiles="stitch" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.9 0"/></filter>
    <radialGradient id="sun${id}" cx="0.34" cy="0.28" r="0.9"><stop offset="0" stop-color="#fffce8" stop-opacity="0.4"/><stop offset="0.55" stop-color="#fffce8" stop-opacity="0.06"/><stop offset="1" stop-color="#fffce8" stop-opacity="0"/></radialGradient>
    <radialGradient id="vig${id}" cx="0.5" cy="0.5" r="0.62"><stop offset="0.55" stop-color="#0a2012" stop-opacity="0"/><stop offset="1" stop-color="#0a2012" stop-opacity="0.36"/></radialGradient>
    <radialGradient id="ring${id}" cx="0.5" cy="0.4" r="0.7"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="${C.ring}"/></radialGradient>
    <radialGradient id="sand${id}" cx="0.4" cy="0.35" r="0.9"><stop offset="0" stop-color="${C.sandB}"/><stop offset="1" stop-color="${C.sandA}"/></radialGradient>
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

// The fairway "half & half" disc: split down the middle, one side dark and the
// other light, with mowing stripes kept within each half. cw/acw flips sides.
function splitDisc(cx, cy, r, cw, band, id) {
  const clip = `d${id}`, lc = `dl${id}`, rc = `dr${id}`
  const dark = [C.fairDark1, C.fairDark2], light = [C.fairLight1, C.fairLight2]
  const L = cw ? dark : light, R = cw ? light : dark
  return `<clipPath id="${clip}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
    <clipPath id="${lc}"><rect x="0" y="0" width="${cx}" height="100"/></clipPath>
    <clipPath id="${rc}"><rect x="${cx}" y="0" width="${100 - cx}" height="100"/></clipPath>
    <g clip-path="url(#${clip})">
      <g clip-path="url(#${lc})">${stripes(0, L[0], L[1], band, 0, id)}</g>
      <g clip-path="url(#${rc})">${stripes(0, R[0], R[1], band, 1, id)}</g>
      <rect x="0" y="0" width="100" height="100" fill="url(#sun${id})"/>
      <rect x="0" y="0" width="100" height="100" filter="url(#g${id})" opacity="0.32" style="mix-blend-mode:soft-light"/>
      <rect x="0" y="0" width="100" height="100" fill="url(#vig${id})"/>
      <line x1="${cx}" y1="${cy - r}" x2="${cx}" y2="${cy + r}" stroke="rgba(12,30,18,0.4)" stroke-width="2"/>
      <line x1="${cx}" y1="${cy - r}" x2="${cx}" y2="${cy + r}" stroke="rgba(255,255,255,0.45)" stroke-width="0.9"/>
    </g>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.turfEdge}" stroke-width="1.4" opacity="0.85"/>`
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
  const hs = 13
  // pull the shaft ends back under the heads so the points sit proud
  const off = hs * 0.7
  const sx1 = ax + Math.cos(ang) * off, sy1 = ay + Math.sin(ang) * off
  const sx2 = bx - Math.cos(ang) * off, sy2 = by - Math.sin(ang) * off
  const line = (col, w) => `<line x1="${sx1.toFixed(2)}" y1="${sy1.toFixed(2)}" x2="${sx2.toFixed(2)}" y2="${sy2.toFixed(2)}" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>`
  return `${line(C.arrowOut, 8)}<polygon points="${headPts(bx, by, ang, hs + 2)}" fill="${C.arrowOut}"/><polygon points="${headPts(ax, ay, ang + Math.PI, hs + 2)}" fill="${C.arrowOut}"/>
    ${line(C.gold, 4.4)}<polygon points="${headPts(bx, by, ang, hs)}" fill="${C.gold}"/><polygon points="${headPts(ax, ay, ang + Math.PI, hs)}" fill="${C.gold}"/>`
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
    const head = heads ? `<polygon points="${headPts(ex, ey, ang, w * 2.9)}" fill="${col}"/>` : ''
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

  // Half & half fairways get the split disc; everything else is a striped disc.
  const body = (kind === 'fairway' && isCircle)
    ? splitDisc(cx, cy, discR, step.dir !== 'acw', band, id)
    : disc(cx, cy, discR, stripeAngle(step), cA, cB, band, id, sand)

  return `<svg width="${S}" height="${S}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="display:block">${defs(id)}
    <g filter="url(#sh${id})">${ringFace(cx, cy, showNumbers, id)}</g>
    ${body}
    ${arrow}
  </svg>`
}

// ── WHOLE-HOLE MAP ───────────────────────────────────────────────────────────
// A stylised golf hole seen from above (green on the left, tees on the right),
// with each surface striped to TODAY'S direction. Reuses the same striping,
// grain, sun and vignette so it matches the badges.

// Stripes filling a region, centred on (cx,cy) reaching `reach` in all
// directions, then clipped by the caller to a surface shape.
function stripeFill(angle, cA, cB, band, off, cx, cy, reach, id) {
  const n = Math.ceil((reach * 2) / band)
  let r = ''
  for (let i = 0; i < n; i++) r += `<rect x="${(cx - reach + i * band).toFixed(1)}" y="${(cy - reach).toFixed(1)}" width="${(band + 0.8).toFixed(1)}" height="${(reach * 2).toFixed(1)}" fill="${(i + off) % 2 ? cB : cA}"/>`
  return `<g filter="url(#b${id})" transform="rotate(${angle} ${cx} ${cy})">${r}</g>`
}
const angleOf = (step) => (step && step.type === 'axis' ? (step.a % 12) * 30 : 0)

// A striped surface region: define a clip path then fill it with stripes + the
// grain/sun/vignette finish. For a half & half fairway, split it top/bottom.
function region(pathD, step, cA, cB, band, cx, cy, reach, id, sub, kind) {
  const clip = `r${sub}${id}`
  let fill
  if (kind === 'fairway' && step && step.type === 'circle') {
    const cw = step.dir !== 'acw'
    const dark = [C.fairDark1, C.fairDark2], light = [C.fairLight1, C.fairLight2]
    const T = cw ? dark : light, B = cw ? light : dark
    const tc = `rt${sub}${id}`, bc = `rb${sub}${id}`
    fill = `<clipPath id="${tc}"><rect x="0" y="0" width="340" height="${cy}"/></clipPath><clipPath id="${bc}"><rect x="0" y="${cy}" width="340" height="${260 - cy}"/></clipPath>
      <g clip-path="url(#${tc})">${stripeFill(0, T[0], T[1], band, 0, cx, cy, reach, id)}</g>
      <g clip-path="url(#${bc})">${stripeFill(0, B[0], B[1], band, 1, cx, cy, reach, id)}</g>`
  } else {
    fill = stripeFill(angleOf(step), cA, cB, band, 0, cx, cy, reach, id)
  }
  return `<clipPath id="${clip}"><path d="${pathD}"/></clipPath>
    <g clip-path="url(#${clip})">${fill}
      <rect x="0" y="0" width="340" height="200" fill="url(#sun${id})"/>
      <rect x="0" y="0" width="340" height="200" filter="url(#g${id})" opacity="0.3" style="mix-blend-mode:soft-light"/>
    </g>
    <path d="${pathD}" fill="none" stroke="${C.turfEdge}" stroke-width="1.4" opacity="0.55"/>`
}

function bunker(cx, cy, rx, ry, id, sub) {
  const p = `M${cx - rx},${cy} Q${cx - rx * 0.7},${cy - ry} ${cx},${cy - ry} Q${cx + rx * 0.8},${cy - ry * 0.9} ${cx + rx},${cy} Q${cx + rx * 0.7},${cy + ry} ${cx},${cy + ry} Q${cx - rx * 0.8},${cy + ry * 0.9} ${cx - rx},${cy} Z`
  return `<path d="${p}" transform="translate(0.8,1.4)" fill="#0c2113" opacity="0.28" filter="url(#s${id})"/>
    <path d="${p}" fill="url(#sand${id})" stroke="${C.sandEdge}" stroke-width="0.8"/>`
}

export function holeSVG({ greenStep, fairStep, apprStep, teeStep, width = 340 } = {}) {
  const id = hash(['hole', greenStep && greenStep.a, greenStep && greenStep.dir, fairStep && fairStep.dir, fairStep && fairStep.a, apprStep && apprStep.a, teeStep && teeStep.a].join('-'))
  const H = Math.round(width * (200 / 340))
  // corridor: green (left) → approach → fairway ribbon → tees (right)
  const fairway = 'M126,58 C150,50 175,52 200,60 C230,70 255,60 285,66 L300,66 C305,66 306,74 306,86 C306,120 306,140 300,150 L285,150 C255,156 230,146 200,140 C175,132 150,150 126,142 C112,138 108,120 108,100 C108,80 112,64 126,58 Z'
  const green = 'M34,74 C30,60 44,50 64,50 C86,49 108,56 110,80 C112,104 96,128 70,130 C48,132 34,118 30,100 C28,90 30,82 34,74 Z'
  const collar = 'M31,74 C27,58 42,46 64,46 C88,45 112,53 114,80 C116,107 98,133 70,135 C46,137 30,121 26,101 C24,90 27,82 31,74 Z'
  const approach = 'M104,72 C116,66 132,66 140,74 C147,82 147,120 138,128 C130,135 116,135 106,128 C99,122 98,80 104,72 Z'
  const tee1 = 'M300,84 Q298,80 303,80 L322,80 Q327,80 325,84 L327,104 Q327,108 322,108 L303,108 Q298,108 300,104 Z'
  const tee2 = 'M302,116 Q300,113 304,113 L321,113 Q325,113 324,116 L325,132 Q325,135 321,135 L304,135 Q300,135 302,132 Z'
  return `<svg width="${width}" height="${H}" viewBox="0 0 340 200" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:auto">${defs(id)}
    <rect x="0" y="0" width="340" height="200" rx="18" fill="${C.fairA}"/>
    <rect x="0" y="0" width="340" height="200" rx="18" fill="#2b6a3c"/>
    <rect x="0" y="0" width="340" height="200" filter="url(#g${id})" opacity="0.5" style="mix-blend-mode:soft-light"/>
    <!-- cart path -->
    <path d="M332,150 C300,168 250,150 210,166 C170,182 120,168 70,176" fill="none" stroke="#c9b98f" stroke-width="6" stroke-linecap="round" opacity="0.9"/>
    <path d="M332,150 C300,168 250,150 210,166 C170,182 120,168 70,176" fill="none" stroke="#e6dcc0" stroke-width="2.4" stroke-linecap="round" opacity="0.7"/>
    <!-- surfaces -->
    ${region(fairway, fairStep, C.fairA, C.fairB, 11, 210, 104, 200, id, 'f', 'fairway')}
    ${region(tee1, teeStep, C.greenA, C.greenB, 7, 313, 94, 40, id, 't1', 'tee')}
    ${region(tee2, teeStep, C.greenA, C.greenB, 7, 313, 124, 40, id, 't2', 'tee')}
    ${region(approach, apprStep, C.greenA, C.greenB, 7, 122, 100, 60, id, 'a', 'approach')}
    <path d="${collar}" fill="${C.collar}"/>
    ${region(green, greenStep, C.greenA, C.greenB, 6, 70, 90, 60, id, 'g', 'green')}
    <!-- bunkers -->
    ${bunker(96, 52, 15, 9, id, 'b1')}
    ${bunker(30, 118, 13, 9, id, 'b2')}
    ${bunker(180, 150, 17, 8, id, 'b3')}
    <!-- pin -->
    <ellipse cx="66" cy="86" rx="3" ry="2" fill="${C.arrowOut}"/>
    <line x1="66" y1="85" x2="66" y2="62" stroke="rgba(0,0,0,0.3)" stroke-width="2.6" stroke-linecap="round"/>
    <line x1="66" y1="85" x2="66" y2="62" stroke="#F5F4EF" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M66,62 L82,65.5 Q76,68 82,71 L66,71 Z" fill="#D8402E"/>
    <rect x="0.5" y="0.5" width="339" height="199" rx="18" fill="none" stroke="#1c4a2b" stroke-width="1"/>
  </svg>`
}

export default turfSVG
