// ============================================================================
//  Course Map — placing readings on greens + grouping them into rounds.
// ============================================================================
import { distanceFt } from './geo.js'
import { hourInTZ } from '../dates.js'

// Ray-casting point-in-polygon. point [lon,lat], ring [[lon,lat],…].
export function pointInPolygon(point, ring) {
  const [x, y] = point
  let inside = false
  const n = ring.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]
    const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

// Distance from a point to the nearest edge of a ring, in FEET.
export function distanceToEdgeFt(point, ring) {
  const [px, py] = point
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]
    best = Math.min(best, distToSegmentFt(px, py, a[0], a[1], b[0], b[1]))
  }
  return best
}

function distToSegmentFt(px, py, ax, ay, bx, by) {
  // Work in a local equirectangular plane (feet) so projection distortion is tiny.
  const latRef = (ay + by) / 2
  const mPerDegLat = 364000 // feet per degree latitude (~)
  const mPerDegLon = 364000 * Math.cos(latRef * Math.PI / 180)
  const P = [(px - ax) * mPerDegLon, (py - ay) * mPerDegLat]
  const B = [(bx - ax) * mPerDegLon, (by - ay) * mPerDegLat]
  const len2 = B[0] * B[0] + B[1] * B[1]
  let t = len2 === 0 ? 0 : (P[0] * B[0] + P[1] * B[1]) / len2
  t = Math.max(0, Math.min(1, t))
  const dx = P[0] - t * B[0], dy = P[1] - t * B[1]
  return Math.sqrt(dx * dx + dy * dy)
}

// Which green a reading belongs to. Ignores any device label — geometry decides.
// Inside a green's outline → that green. Within `edgeFt` of a green's edge →
// that green (nearest). Otherwise null (→ "Unplaced").
export function assignGreen(point, greens, edgeFt = 5) {
  for (const g of greens) if (pointInPolygon(point, g.ring)) return g.id
  let best = null, bestD = Infinity
  for (const g of greens) {
    const d = distanceToEdgeFt(point, g.ring)
    if (d <= edgeFt && d < bestD) { best = g.id; bestD = d }
  }
  return best
}

// Group readings on one green into rounds: readings within `gapMin` minutes of
// each other form a round. A round starting before 12:00 local is Morning.
export function groupRounds(readings, gapMin = 60) {
  const sorted = [...readings].sort((a, b) => new Date(a.takenAt) - new Date(b.takenAt))
  const rounds = []
  let cur = null
  for (const r of sorted) {
    const t = new Date(r.takenAt)
    if (cur && (t - cur.lastT) / 60000 <= gapMin) {
      cur.readings.push(r); cur.lastT = t
    } else {
      cur = { startedAt: r.takenAt, lastT: t, readings: [r] }
      rounds.push(cur)
    }
  }
  return rounds.map((rd) => {
    const vals = rd.readings.map((x) => x.vwcPct).filter((v) => v != null)
    const startLocalHour = hourInTZ(rd.startedAt) // club wall-clock (America/New_York)
    return {
      startedAt: rd.startedAt,
      endedAt: rd.readings[rd.readings.length - 1].takenAt,
      readings: rd.readings,
      n: rd.readings.length,
      avg: vals.length ? round2(vals.reduce((s, v) => s + v, 0) / vals.length) : null,
      min: vals.length ? Math.min(...vals) : null,
      max: vals.length ? Math.max(...vals) : null,
      slot: (startLocalHour == null ? 0 : startLocalHour) < 12 ? 'morning' : 'afternoon',
    }
  })
}

// Low/high readings of a round, with their spot labels.
export function roundExtremes(round) {
  let lo = null, hi = null
  for (const r of round.readings) {
    if (r.vwcPct == null) continue
    if (!lo || r.vwcPct < lo.vwcPct) lo = r
    if (!hi || r.vwcPct > hi.vwcPct) hi = r
  }
  return { low: lo, high: hi }
}

// Dedupe key for an import row: external id, else time+gps+value.
export function readingDedupeKey(r) {
  if (r.externalId) return `ext:${r.externalId}`
  return ['k', r.takenAt, r.lat, r.lon, r.vwcPct].join('|')
}

// Moisture may arrive 0–1 or 0–100; normalize to a percent (0–100).
export function normalizeMoisturePct(v) {
  const n = Number(v)
  if (!isFinite(n)) return null
  return n > 0 && n <= 1 ? round2(n * 100) : round2(n)
}

function round2(n) { return Math.round(n * 100) / 100 }
