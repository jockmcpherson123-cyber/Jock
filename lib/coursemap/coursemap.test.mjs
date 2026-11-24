// Tests for lib/coursemap. Run: node lib/coursemap/coursemap.test.mjs
import { lonLatTo3857, m3857ToLonLat, parseWorldFile, worldFileCorners, distanceFt, geodesicAreaSqft } from './geo.js'
import { pointInPolygon, distanceToEdgeFt, assignGreen, groupRounds, roundExtremes, readingDedupeKey, normalizeMoisturePct } from './greens.js'
import { idwValue, moistureStops, colorAt } from './heat.js'
import { suggestDepth, roundTo05, planByDepth } from './depth.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error(`✗ ${m}`) } }
const near = (a, b, tol, m) => ok(Math.abs(a - b) <= tol, `${m} (got ${a}, want ${b}±${tol})`)

// ── DEACON fixture: 12 readings, Blue green 1, May 13 2026 ───────────────────
const FIX = [
  [1, '2026-05-13T11:46:29Z', 22.40, 38.9998741, -77.1803289],
  [2, '2026-05-13T11:45:49Z', 24.96, 38.9996511, -77.1801465],
  [3, '2026-05-13T11:45:22Z', 17.61, 38.9996765, -77.1804357],
  [4, '2026-05-13T11:45:41Z', 22.77, 38.9995618, -77.1802322],
  [5, '2026-05-13T11:46:16Z', 24.51, 38.9998373, -77.1802093],
  [6, '2026-05-13T11:45:55Z', 24.06, 38.9997088, -77.1801983],
  [7, '2026-05-13T11:46:01Z', 23.20, 38.9997689, -77.1802224],
  [8, '2026-05-13T11:45:34Z', 26.56, 38.9995723, -77.1803146],
  [9, '2026-05-13T11:46:37Z', 20.30, 38.9997893, -77.1803913],
  [10, '2026-05-13T11:46:08Z', 22.10, 38.9997766, -77.1803116],
  [11, '2026-05-13T11:45:28Z', 23.57, 38.9995987, -77.1804050],
  [12, '2026-05-13T11:46:23Z', 20.25, 38.9998877, -77.1802310],
].map(([point, takenAt, vwcPct, lat, lon]) => ({ point, takenAt, vwcPct, lat, lon }))

// ── Mercator round-trip ───────────────────────────────────────────────────────
{
  const [x, y] = lonLatTo3857(-77.18, 39.0)
  const [lon, lat] = m3857ToLonLat(x, y)
  near(lon, -77.18, 1e-9, 'mercator round-trip lon')
  near(lat, 39.0, 1e-9, 'mercator round-trip lat')
}

// ── World file → corners (attached web .jgw, 6320×11134) ──────────────────────
{
  const p = parseWorldFile('0.3\n0.0\n0.0\n-0.3\n-8592386.412\n4721991.159')
  const c = worldFileCorners(p, 6320, 11134)
  near(c.topLeft.lon, -77.186720, 0.0005, 'NW corner lon matches spec')
  near(c.bottomRight.lon, -77.169688, 0.0005, 'SE corner lon matches spec')
  ok(c.topLeft.lat > c.bottomRight.lat, 'north corner is above south corner')
  console.log(`  [info] web .jgw corners: NW ${c.topLeft.lat.toFixed(6)}, ${c.topLeft.lon.toFixed(6)} · SE ${c.bottomRight.lat.toFixed(6)}, ${c.bottomRight.lon.toFixed(6)}`)
}

// ── distance + geodesic area ──────────────────────────────────────────────────
near(distanceFt(-77.18, 39.0, -77.18, 39.0 + 100 / 364000), 100, 1, '100 ft north ≈ 100 ft')
{
  const dLat = 100 / 364000, dLon = 100 / (364000 * Math.cos(39 * Math.PI / 180))
  const rect = [[-77.18, 39.0], [-77.18 + dLon, 39.0], [-77.18 + dLon, 39.0 + dLat], [-77.18, 39.0 + dLat]]
  near(geodesicAreaSqft(rect), 10000, 100, '100×100 ft rectangle ≈ 10,000 sqft (±1%)')
}

// ── point-in-polygon + green assignment ───────────────────────────────────────
{
  const square = [[0, 0], [0, 10], [10, 10], [10, 0]]
  ok(pointInPolygon([5, 5], square), 'point inside square')
  ok(!pointInPolygon([15, 5], square), 'point outside square')
  // a green outline that encloses all 12 fixture points (bbox + margin)
  const lons = FIX.map((r) => r.lon), lats = FIX.map((r) => r.lat)
  const m = 0.00003
  const green = { id: 'g1', ring: [[Math.min(...lons) - m, Math.min(...lats) - m], [Math.min(...lons) - m, Math.max(...lats) + m], [Math.max(...lons) + m, Math.max(...lats) + m], [Math.max(...lons) + m, Math.min(...lats) - m]] }
  ok(FIX.every((r) => assignGreen([r.lon, r.lat], [green]) === 'g1'), 'all 12 readings assign to green 1')
  ok(assignGreen([-77.0, 39.5], [green]) === null, 'a far-away point is unplaced')
  ok(distanceToEdgeFt([5, 5], square) > 0, 'edge distance is positive inside')
}

// ── rounds + stats ────────────────────────────────────────────────────────────
{
  const readings = FIX.map((r) => ({ takenAt: r.takenAt, vwcPct: r.vwcPct, lat: r.lat, lon: r.lon, point: r.point }))
  const rounds = groupRounds(readings)
  ok(rounds.length === 1, 'the 12 readings form one round')
  near(rounds[0].avg, 22.69, 0.01, 'round average 22.69%')
  near(rounds[0].min, 17.61, 0.001, 'round low 17.61%')
  near(rounds[0].max, 26.56, 0.001, 'round high 26.56%')
  ok(rounds[0].slot === 'morning', 'round is a Morning round')
  const ext = roundExtremes(rounds[0])
  ok(ext.low.point === 3, 'driest spot is point 3')
  ok(ext.high.point === 8, 'wettest spot is point 8')
}

// ── dedupe + moisture normalization ───────────────────────────────────────────
ok(readingDedupeKey({ externalId: 'X' }) === 'ext:X', 'dedupe uses external id')
{
  const a = readingDedupeKey(FIX[0]); const b = readingDedupeKey(FIX[0])
  ok(a === b, 'dedupe key is stable for the same reading')
}
near(normalizeMoisturePct(0.226), 22.6, 0.001, '0–1 moisture scaled to %')
near(normalizeMoisturePct(22.6), 22.6, 0.001, '0–100 moisture kept as %')

// ── IDW + colors ──────────────────────────────────────────────────────────────
{
  const rs = FIX.map((r) => ({ vwcPct: r.vwcPct, lat: r.lat, lon: r.lon }))
  near(idwValue(FIX[0].lon, FIX[0].lat, rs), 22.40, 0.001, 'IDW at a reading returns its value')
  const stops = moistureStops(20, 30)
  ok(colorAt(25, stops) === '#22c55e', 'midpoint color is green')
  ok(colorAt(10, stops) === '#DC2626', 'well below low is red')
  ok(colorAt(40, stops) === '#2563EB', 'well above high is blue')
}

// ── depth suggestion (Phase D worked example) ─────────────────────────────────
ok(roundTo05(0.139) === 0.15, 'round 0.139 → 0.15')
near(suggestDepth({ et: 0.10, aim: 24, latestAvg: 22.69, inchesPerPoint: 0.03 }), 0.15, 1e-9, 'suggested depth = .15')
near(suggestDepth({ et: 0.5, aim: 30, latestAvg: 10, inchesPerPoint: 0.03 }), 0.25, 1e-9, 'suggestion capped at 0.25')
near(suggestDepth({ et: 0, aim: 20, latestAvg: 40, inchesPerPoint: 0.03 }), 0, 1e-9, 'never negative')
{
  const plan = planByDepth([{ green: 7, depth: 0.15 }, { green: 4, depth: 0.15 }, { green: 1, depth: 0.1 }])
  ok(plan[0].depth === 0.1 && plan[0].greens[0] === 1, 'plan groups by depth, ascending')
  ok(plan[1].greens.join(',') === '4,7', 'greens sorted within a depth')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
