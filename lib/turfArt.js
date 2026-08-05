// Turf artwork for the mowing-direction tiles — pure functions that return an
// <svg> string, so the exact same drawing renders in the app (via
// dangerouslySetInnerHTML) and in offline previews.
//
// Every tile is drawn in a fixed 100×72 viewBox (then scaled to any size) and
// shows a real golf surface seen from above, striped in the day's mow direction:
//   green · tee · fairway · approach · rough
// Realism comes from: fine soft-edged stripes, a grass grain texture, a warm
// sun sheen, a soft vignette, organic (hand-drawn) shapes, and real features
// like a sand bunker with a highlight and a pin in the cup.

const C = {
  roughA: '#2C6236', roughB: '#234F2C', roughC: '#38714119',
  collar: '#4C8A59', collarEdge: '#3C6F49',
  greenA: '#3F9E5D', greenB: '#60BF7C',
  fairA: '#347E48', fairB: '#59B070',
  fairDark: '#2C7241', fairDark2: '#327D48', fairLight: '#64C080', fairLight2: '#71CB8C',
  teeA: '#3C9455', teeB: '#5EB877',
  apprA: '#3E8E54', apprB: '#5DB374',
  sandHi: '#F2E9CC', sand: '#E3D4AB', sandEdge: '#C6B180', sandSh: '#00000022',
  flag: '#D8402E', stick: '#F5F4EF',
  hole: '#12241A', marker: '#2E6FB0',
}

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h).toString(36) }

// Defs shared by a tile: soft-blur for stripe edges, grass grain, sun, vignette.
function defs(id) {
  return `<defs>
    <filter id="b${id}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="0.55"/></filter>
    <filter id="s${id}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.6"/></filter>
    <filter id="g${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="11" stitchTiles="stitch" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.9 0"/></filter>
    <filter id="gr${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.55 0.85" numOctaves="3" seed="5" stitchTiles="stitch" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"/></filter>
    <radialGradient id="sun${id}" cx="0.3" cy="0.24" r="0.95"><stop offset="0" stop-color="#fffce8" stop-opacity="0.38"/><stop offset="0.5" stop-color="#fffce8" stop-opacity="0.07"/><stop offset="1" stop-color="#fffce8" stop-opacity="0"/></radialGradient>
    <radialGradient id="vig${id}" cx="0.5" cy="0.52" r="0.72"><stop offset="0.55" stop-color="#0a2012" stop-opacity="0"/><stop offset="1" stop-color="#0a2012" stop-opacity="0.34"/></radialGradient>
    <radialGradient id="sand${id}" cx="0.4" cy="0.35" r="0.9"><stop offset="0" stop-color="${C.sandHi}"/><stop offset="1" stop-color="${C.sand}"/></radialGradient>
  </defs>`
}

// A field of parallel light/dark mowing stripes, softened and rotated to angle.
function stripes(angle, cA, cB, band, off, id) {
  const cx = 50, cy = 36, diag = 132, n = Math.ceil((diag * 2) / band)
  let r = ''
  for (let i = 0; i < n; i++) r += `<rect x="${(cx - diag + i * band).toFixed(1)}" y="${cy - diag}" width="${(band + 0.8).toFixed(1)}" height="${diag * 2}" fill="${(i + off) % 2 ? cB : cA}"/>`
  return `<g filter="url(#b${id})" transform="rotate(${angle} ${cx} ${cy})">${r}</g>`
}

// A soft drop shadow of a surface shape, so it sits into the rough with depth.
function shadowShape(d, transform, id) {
  return `<g transform="translate(1,2.4)" filter="url(#s${id})" opacity="0.42"><path d="${d}"${transform ? ` transform="${transform}"` : ''} fill="#0e2616"/></g>`
}

// Sun + grain + vignette, clipped to a surface shape.
function finish(clip, id, grainOpacity = 0.4) {
  return `<g clip-path="url(#${clip})">
    <rect x="0" y="0" width="100" height="72" fill="url(#sun${id})"/>
    <rect x="0" y="0" width="100" height="72" filter="url(#g${id})" opacity="${grainOpacity}" style="mix-blend-mode:soft-light"/>
    <rect x="0" y="0" width="100" height="72" fill="url(#vig${id})"/>
  </g>`
}

// The rough frame every surface sits in: a mottled, tufty darker green.
function roughBg(id, heavy = false) {
  const clumps = heavy
    ? `<g filter="url(#b${id})">
        <ellipse cx="20" cy="18" rx="13" ry="8" fill="${C.roughB}" opacity="0.5"/>
        <ellipse cx="78" cy="20" rx="15" ry="9" fill="#3a7644" opacity="0.45"/>
        <ellipse cx="30" cy="56" rx="16" ry="9" fill="#3a7644" opacity="0.4"/>
        <ellipse cx="74" cy="54" rx="14" ry="8" fill="${C.roughB}" opacity="0.5"/>
        <ellipse cx="52" cy="36" rx="20" ry="12" fill="#356e3f" opacity="0.35"/>
      </g>` : ''
  return `<rect x="1" y="1" width="98" height="70" rx="14" fill="${C.roughA}"/>${clumps}
    <rect x="1" y="1" width="98" height="70" rx="14" filter="url(#gr${id})" opacity="${heavy ? 0.55 : 0.4}" style="mix-blend-mode:soft-light"/>`
}

const stripeAngle = (step) => (step && step.type === 'axis' ? (step.a % 12) * 30 : 0)

// ── GREEN ────────────────────────────────────────────────────────────────────
function green(step, id) {
  const angle = stripeAngle(step)
  const gp = 'M18,37 C17,25 29,17 46,16 C64,15 83,20 85,33 C87,45 75,57 57,58 C40,59 27,54 21,47 C19,44 18,41 18,37 Z'
  const clip = `cg${id}`
  const outer = 'translate(50,37) scale(1.14) translate(-50,-37)'
  return `${roughBg(id)}
    ${shadowShape(gp, outer, id)}
    <path d="${gp}" transform="${outer}" fill="${C.collar}"/>
    <path d="${gp}" transform="translate(50,37) scale(1.14) translate(-50,-37)" fill="none" stroke="${C.collarEdge}" stroke-width="0.8" opacity="0.6"/>
    <clipPath id="${clip}"><path d="${gp}"/></clipPath>
    <g clip-path="url(#${clip})">${stripes(angle, C.greenA, C.greenB, 6, 0, id)}</g>
    ${finish(clip, id, 0.32)}
    <path d="${gp}" fill="none" stroke="#2c6b40" stroke-width="0.8" opacity="0.7"/>
    <!-- bunker -->
    <g filter="url(#b${id})"><path d="M6,50 C4,44 11,41 17,43 C21,40 29,41 31,46 C36,47 35,55 29,57 C25,62 13,62 9,57 C6,55 6,53 6,50 Z" fill="${C.sandSh}" transform="translate(0.8,1.2)"/></g>
    <path d="M6,50 C4,44 11,41 17,43 C21,40 29,41 31,46 C36,47 35,55 29,57 C25,62 13,62 9,57 C6,55 6,53 6,50 Z" fill="url(#sand${id})" stroke="${C.sandEdge}" stroke-width="0.7"/>
    <g clip-path="url(#cb${id})" opacity="0.4"><clipPath id="cb${id}"><path d="M6,50 C4,44 11,41 17,43 C21,40 29,41 31,46 C36,47 35,55 29,57 C25,62 13,62 9,57 C6,55 6,53 6,50 Z"/></clipPath>
      <path d="M6,48 Q19,45 32,48" fill="none" stroke="${C.sandEdge}" stroke-width="0.5"/>
      <path d="M6,52 Q19,49 32,52" fill="none" stroke="${C.sandEdge}" stroke-width="0.5"/>
      <path d="M7,55 Q19,52.5 31,55" fill="none" stroke="${C.sandEdge}" stroke-width="0.5"/></g>
    <path d="M11,50 C12,47 18,46 22,48 C26,49 27,53 24,54 C19,56 13,55 11,52 Z" fill="#fbf5df" opacity="0.5"/>
    <!-- pin + cup -->
    <ellipse cx="67" cy="27" rx="2.5" ry="1.6" fill="${C.hole}"/>
    <ellipse cx="67" cy="26.2" rx="2.5" ry="1.3" fill="#0c1c13"/>
    <line x1="67" y1="26" x2="67" y2="6.5" stroke="rgba(0,0,0,0.28)" stroke-width="2.2" stroke-linecap="round"/>
    <line x1="67" y1="26" x2="67" y2="6.5" stroke="${C.stick}" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M67,6.5 L81,9.5 Q76,11 81,13.5 L67,14 Z" fill="${C.flag}"/>`
}

// ── TEE ──────────────────────────────────────────────────────────────────────
function tee(step, id) {
  const angle = stripeAngle(step)
  const rx = 'M26,20 Q24,18 28,18 L72,18 Q76,18 74,20 L77,52 Q77,55 73,55 L27,55 Q23,55 23,52 Z'
  const clip = `ct${id}`
  const outer = 'translate(50,36.5) scale(1.1) translate(-50,-36.5)'
  return `${roughBg(id)}
    ${shadowShape(rx, outer, id)}
    <path d="${rx}" transform="${outer}" fill="${C.collar}"/>
    <clipPath id="${clip}"><path d="${rx}"/></clipPath>
    <g clip-path="url(#${clip})">${stripes(angle, C.teeA, C.teeB, 8, 0, id)}</g>
    ${finish(clip, id, 0.34)}
    <path d="${rx}" fill="none" stroke="#2c6b40" stroke-width="0.8" opacity="0.7"/>
    <!-- tee markers at the front -->
    <ellipse cx="39" cy="49" rx="2.4" ry="1.8" fill="${C.marker}" stroke="#fff" stroke-width="0.6"/>
    <ellipse cx="61" cy="49" rx="2.4" ry="1.8" fill="${C.marker}" stroke="#fff" stroke-width="0.6"/>`
}

// ── APPROACH (apron in front of a green) ─────────────────────────────────────
function approach(step, id) {
  const angle = stripeAngle(step)
  // a fan/apron: broad at the front, tucking up toward a sliver of green at top
  const ap = 'M20,26 C26,20 40,18 50,18 C60,18 74,20 80,26 C86,34 84,50 68,57 C58,61 42,61 32,57 C16,50 14,34 20,26 Z'
  const clip = `ca${id}`
  return `${roughBg(id)}
    ${shadowShape(ap, '', id)}
    <!-- hint of the green being approached, along the top -->
    <path d="M30,14 C40,9 60,9 70,14 C74,17 74,23 68,25 C58,28 42,28 32,25 C26,23 26,17 30,14 Z" fill="${C.greenA}"/>
    <path d="M30,14 C40,9 60,9 70,14 C74,17 74,23 68,25 C58,28 42,28 32,25 C26,23 26,17 30,14 Z" fill="none" stroke="#2c6b40" stroke-width="0.7" opacity="0.6"/>
    <clipPath id="${clip}"><path d="${ap}"/></clipPath>
    <g clip-path="url(#${clip})">${stripes(angle, C.apprA, C.apprB, 7, 0, id)}</g>
    ${finish(clip, id, 0.34)}
    <path d="${ap}" fill="none" stroke="#2c6b40" stroke-width="0.8" opacity="0.7"/>`
}

// ── FAIRWAY ──────────────────────────────────────────────────────────────────
function fairway(step, id) {
  const fp = 'M14,16 C24,11 40,12 50,12 C60,12 76,11 86,16 C92,26 92,46 86,56 C76,61 60,60 50,60 C40,60 24,61 14,56 C8,46 8,26 14,16 Z'
  const clip = `cf${id}`, lclip = `lf${id}`, rclip = `rf${id}`
  const shadow = shadowShape(fp, '', id)
  let body, extra = ''
  if (step && step.type === 'circle') {
    const cw = step.dir !== 'acw'
    const L = cw ? [C.fairDark, C.fairDark2] : [C.fairLight, C.fairLight2]
    const R = cw ? [C.fairLight, C.fairLight2] : [C.fairDark, C.fairDark2]
    body = `<clipPath id="${lclip}"><rect x="0" y="0" width="50" height="72"/></clipPath><clipPath id="${rclip}"><rect x="50" y="0" width="50" height="72"/></clipPath>
      <g clip-path="url(#${lclip})">${stripes(0, L[0], L[1], 9, 0, id)}</g>
      <g clip-path="url(#${rclip})">${stripes(0, R[0], R[1], 9, 1, id)}</g>`
    const va = (x, dir) => `<line x1="${x}" y1="20" x2="${x}" y2="52" stroke="rgba(15,35,22,0.4)" stroke-width="4" stroke-linecap="round"/><line x1="${x}" y1="20" x2="${x}" y2="52" stroke="rgba(255,255,255,0.95)" stroke-width="2.2" stroke-linecap="round"/><polygon points="${dir === 'up' ? `${x},18 ${x - 4},24 ${x + 4},24` : `${x},54 ${x - 4},48 ${x + 4},48`}" fill="rgba(255,255,255,0.95)"/>`
    extra = `<line x1="50" y1="13" x2="50" y2="59" stroke="rgba(15,35,22,0.35)" stroke-width="2.2"/><line x1="50" y1="13" x2="50" y2="59" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>${va(30, cw ? 'up' : 'down')}${va(70, cw ? 'down' : 'up')}`
  } else {
    body = `<g>${stripes(stripeAngle(step), C.fairA, C.fairB, 9, 0, id)}</g>`
  }
  return `${roughBg(id)}
    ${shadow}
    <clipPath id="${clip}"><path d="${fp}"/></clipPath>
    <g clip-path="url(#${clip})">${body}</g>
    ${finish(clip, id, 0.34)}
    <path d="${fp}" fill="none" stroke="#2c6b40" stroke-width="0.8" opacity="0.7"/>
    ${extra}`
}

// ── ROUGH (long, tufty grass — no clean stripes) ─────────────────────────────
function rough(step, id) {
  // scattered tufts of longer grass for a shaggy look
  let tufts = ''
  const seedRand = (i) => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x) }
  for (let i = 0; i < 26; i++) {
    const x = 6 + seedRand(i) * 88, y = 6 + seedRand(i + 50) * 60
    const dark = seedRand(i + 99) > 0.5
    const h = 2.4 + seedRand(i + 7) * 2.2
    tufts += `<path d="M${x.toFixed(1)},${(y + h).toFixed(1)} q0.6,-${h.toFixed(1)} 1.4,-${(h * 0.4).toFixed(1)} q0.8,-${(h * 0.6).toFixed(1)} 1.6,0" fill="none" stroke="${dark ? '#20502c' : '#4d8f58'}" stroke-width="0.7" stroke-linecap="round" opacity="0.7"/>`
  }
  return `${roughBg(id, true)}
    <g filter="url(#b${id})">${tufts}</g>
    <rect x="1" y="1" width="98" height="70" rx="14" fill="url(#sun${id})"/>
    <rect x="1" y="1" width="98" height="70" rx="14" fill="url(#vig${id})"/>`
}

const RENDERERS = { green, tee, fairway, approach, rough }

export function turfSVG({ kind = 'green', step, size = 72 } = {}) {
  const W = size, H = Math.round(size * 0.72)
  const id = hash([kind, step && step.type, step && step.a, step && step.b, step && step.dir, size].join('-'))
  const render = RENDERERS[kind] || green
  return `<svg width="${W}" height="${H}" viewBox="0 0 100 72" xmlns="http://www.w3.org/2000/svg" style="display:block">${defs(id)}${render(step, id)}</svg>`
}

export default turfSVG
