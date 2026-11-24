// ============================================================================
//  Course Map — geo math (one module for all map math; see also greens/heat/depth).
//
//  Web Mercator (EPSG:3857) ↔ WGS84, world-file → image corners, great-circle
//  distance in feet, and geodesic polygon area. Pure functions, no map library.
// ============================================================================

export const R_MERC = 6378137 // EPSG:3857 sphere radius (metres)
const D2R = Math.PI / 180
const R2D = 180 / Math.PI

// WGS84 lon/lat (degrees) → EPSG:3857 metres.
export function lonLatTo3857(lon, lat) {
  const x = R_MERC * lon * D2R
  const y = R_MERC * Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2))
  return [x, y]
}

// EPSG:3857 metres → WGS84 lon/lat (degrees).
export function m3857ToLonLat(x, y) {
  const lon = (x / R_MERC) * R2D
  const lat = (2 * Math.atan(Math.exp(y / R_MERC)) - Math.PI / 2) * R2D
  return [lon, lat]
}

// Parse a world file (.jgw/.pgw/.wld): six lines.
//   A = x pixel size, D = row rotation, B = column rotation, E = y pixel size
//   (negative), C = x of the UPPER-LEFT pixel CENTER, F = y of that center.
export function parseWorldFile(text) {
  const n = String(text).trim().split(/\r?\n/).map((s) => parseFloat(s.trim()))
  if (n.length < 6 || n.some((v) => !isFinite(v))) return null
  return { A: n[0], D: n[1], B: n[2], E: n[3], C: n[4], F: n[5] }
}

// The four OUTER corners of an image placed by a world file, as {lat, lon}.
// crs 'EPSG:3857' (default) converts; anything else is treated as already lon/lat.
// Corners use half-pixel offsets so they are the image edge, not pixel centres.
export function worldFileCorners(params, widthPx, heightPx, crs = 'EPSG:3857') {
  const { A, D, B, E, C, F } = params
  const toLL = crs === 'EPSG:3857' ? m3857ToLonLat : (x, y) => [x, y]
  const corner = (col, row) => {
    const x = C + A * col + B * row
    const y = F + D * col + E * row
    const [lon, lat] = toLL(x, y)
    return { lat, lon }
  }
  return {
    topLeft: corner(-0.5, -0.5),
    topRight: corner(widthPx - 0.5, -0.5),
    bottomLeft: corner(-0.5, heightPx - 0.5),
    bottomRight: corner(widthPx - 0.5, heightPx - 0.5),
  }
}

// Great-circle distance between two lon/lat points, in FEET.
const R_EARTH_M = 6371008.8 // mean Earth radius
export function distanceFt(aLon, aLat, bLon, bLat) {
  const dLat = (bLat - aLat) * D2R
  const dLon = (bLon - aLon) * D2R
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * D2R) * Math.cos(bLat * D2R) * Math.sin(dLon / 2) ** 2
  return 2 * R_EARTH_M * Math.asin(Math.sqrt(s)) * 3.280839895
}

// Geodesic area of a polygon ring [[lon,lat],…] in square metres (spherical
// excess — the formula Leaflet's GeometryUtil uses). Ring may be open or closed.
export function geodesicAreaM2(ring) {
  const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring
  const n = pts.length
  if (n < 3) return 0
  let area = 0
  for (let i = 0; i < n; i++) {
    const [lon1, lat1] = pts[i]
    const [lon2, lat2] = pts[(i + 1) % n]
    area += (lon2 - lon1) * D2R * (2 + Math.sin(lat1 * D2R) + Math.sin(lat2 * D2R))
  }
  return Math.abs((area * R_MERC * R_MERC) / 2)
}

export const M2_TO_SQFT = 10.7639
export function geodesicAreaSqft(ring) { return geodesicAreaM2(ring) * M2_TO_SQFT }

// Perimeter of a ring, in feet.
export function perimeterFt(ring) {
  let t = 0
  for (let i = 0; i < ring.length - 1; i++) t += distanceFt(ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1])
  // close it if open
  const a = ring[0], b = ring[ring.length - 1]
  if (a[0] !== b[0] || a[1] !== b[1]) t += distanceFt(b[0], b[1], a[0], a[1])
  return t
}
