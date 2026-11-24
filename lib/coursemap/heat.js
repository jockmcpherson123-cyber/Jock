// ============================================================================
//  Course Map — moisture heatmap: inverse-distance weighting + color stops.
// ============================================================================
import { distanceFt } from './geo.js'

// Interpolated value at a point from scattered readings. Inverse-distance
// weighting w = 1 / (d² + k), d in feet, k smooths it (default 25 ft²).
export function idwValue(lon, lat, readings, k = 25) {
  let num = 0, den = 0
  for (const r of readings) {
    if (r.vwcPct == null) continue
    const d = distanceFt(lon, lat, r.lon, r.lat)
    if (d < 0.01) return r.vwcPct // sitting on a reading
    const w = 1 / (d * d + k)
    num += w * r.vwcPct
    den += w
  }
  return den === 0 ? null : num / den
}

// Color stops for the absolute moisture heatmap, relative to the round's target
// (lo, hi). Returns [{v, color}] sorted by value.
export function moistureStops(lo, hi) {
  const mid = (lo + hi) / 2
  return [
    { v: lo - 5, color: '#DC2626' }, // red
    { v: lo - 2, color: '#F97316' }, // orange
    { v: lo + 1, color: '#A3E635' }, // yellow-green
    { v: mid, color: '#22C55E' },    // green
    { v: hi - 1, color: '#14B8A6' }, // teal
    { v: hi + 3, color: '#2563EB' }, // blue
  ].sort((a, b) => a.v - b.v)
}

// Color stops for the "Change" view (afternoon − morning). 0 → pale; more drying
// (negative) → deepening orange/brown.
export function changeStops() {
  return [
    { v: 0, color: '#F5F5F4' },
    { v: -2, color: '#FDE68A' },
    { v: -4, color: '#F97316' },
    { v: -6, color: '#9A3412' },
  ].sort((a, b) => a.v - b.v)
}

// Interpolate a hex color from stops at value v (clamped to the ends).
export function colorAt(v, stops) {
  if (v == null) return null
  if (v <= stops[0].v) return stops[0].color
  if (v >= stops[stops.length - 1].v) return stops[stops.length - 1].color
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1]
    if (v >= a.v && v <= b.v) {
      const t = (v - a.v) / (b.v - a.v)
      return lerpHex(a.color, b.color, t)
    }
  }
  return stops[stops.length - 1].color
}

function lerpHex(h1, h2, t) {
  const c1 = hexToRgb(h1), c2 = hexToRgb(h2)
  const r = Math.round(c1[0] + (c2[0] - c1[0]) * t)
  const g = Math.round(c1[1] + (c2[1] - c1[1]) * t)
  const b = Math.round(c1[2] + (c2[2] - c1[2]) * t)
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`
}
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }

// "Change" view: each afternoon reading's value becomes (afternoon − morning),
// where the morning value is the nearest morning reading within 10 ft, else the
// interpolated morning surface at that point. Returns readings whose vwcPct IS
// the change (negative = dried), for feeding the same IDW/heat path.
export function changeReadings(afternoon, morning) {
  return afternoon.map((a) => {
    let nearest = null, nd = Infinity
    for (const mr of morning) { const d = distanceFt(a.lon, a.lat, mr.lon, mr.lat); if (d < nd) { nd = d; nearest = mr } }
    const mv = nearest && nd <= 10 ? nearest.vwcPct : idwValue(a.lon, a.lat, morning)
    return { ...a, vwcPct: mv == null ? null : round1(a.vwcPct - mv) }
  }).filter((r) => r.vwcPct != null)
}
function round1(n) { return Math.round(n * 10) / 10 }

// Build a grid of cells (~cellFt across) over a ring's bounding box, keeping only
// cells inside the ring (caller passes an `inside` test). Returns cell centers +
// their IDW value + color. Used to paint the clipped heatmap.
export function heatGrid({ ring, readings, lo, hi, cellFt = 1, inside }) {
  const lons = ring.map((p) => p[0]); const lats = ring.map((p) => p[1])
  const minLon = Math.min(...lons), maxLon = Math.max(...lons)
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  // crude degrees-per-foot at this latitude
  const latRef = (minLat + maxLat) / 2
  const dLat = cellFt / 364000
  const dLon = cellFt / (364000 * Math.cos(latRef * Math.PI / 180))
  const stops = moistureStops(lo, hi)
  const cells = []
  for (let lat = minLat; lat <= maxLat; lat += dLat) {
    for (let lon = minLon; lon <= maxLon; lon += dLon) {
      if (inside && !inside([lon, lat])) continue
      const v = idwValue(lon, lat, readings)
      if (v == null) continue
      cells.push({ lon, lat, v, color: colorAt(v, stops) })
    }
  }
  return cells
}
