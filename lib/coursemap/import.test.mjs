// Tests for the readings import. Run: node lib/coursemap/import.test.mjs
import { mapReadingRows, guessReadingMapping, planReadingsImport } from './import.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error(`✗ ${m}`) } }
const near = (a, b, t, m) => ok(Math.abs(a - b) <= t, `${m} (got ${a})`)

const FIX = [
  { point: '1', time_utc: '2026-05-13T11:46:29Z', moisture_pct: '22.40', temp_f: '58.4', salinity_dsm: '0.295', lat: '38.9998741', lon: '-77.1803289' },
  { point: '2', time_utc: '2026-05-13T11:45:49Z', moisture_pct: '24.96', temp_f: '59.7', salinity_dsm: '0.299', lat: '38.9996511', lon: '-77.1801465' },
  { point: '3', time_utc: '2026-05-13T11:45:22Z', moisture_pct: '17.61', temp_f: '63.0', salinity_dsm: '0.223', lat: '38.9996765', lon: '-77.1804357' },
  { point: '4', time_utc: '2026-05-13T11:45:41Z', moisture_pct: '22.77', temp_f: '60.4', salinity_dsm: '0.283', lat: '38.9995618', lon: '-77.1802322' },
  { point: '5', time_utc: '2026-05-13T11:46:16Z', moisture_pct: '24.51', temp_f: '58.5', salinity_dsm: '0.315', lat: '38.9998373', lon: '-77.1802093' },
  { point: '6', time_utc: '2026-05-13T11:45:55Z', moisture_pct: '24.06', temp_f: '59.2', salinity_dsm: '0.312', lat: '38.9997088', lon: '-77.1801983' },
  { point: '7', time_utc: '2026-05-13T11:46:01Z', moisture_pct: '23.20', temp_f: '59.1', salinity_dsm: '0.279', lat: '38.9997689', lon: '-77.1802224' },
  { point: '8', time_utc: '2026-05-13T11:45:34Z', moisture_pct: '26.56', temp_f: '61.5', salinity_dsm: '0.320', lat: '38.9995723', lon: '-77.1803146' },
  { point: '9', time_utc: '2026-05-13T11:46:37Z', moisture_pct: '20.30', temp_f: '58.0', salinity_dsm: '0.266', lat: '38.9997893', lon: '-77.1803913' },
  { point: '10', time_utc: '2026-05-13T11:46:08Z', moisture_pct: '22.10', temp_f: '58.8', salinity_dsm: '0.274', lat: '38.9997766', lon: '-77.1803116' },
  { point: '11', time_utc: '2026-05-13T11:45:28Z', moisture_pct: '23.57', temp_f: '62.3', salinity_dsm: '0.288', lat: '38.9995987', lon: '-77.1804050' },
  { point: '12', time_utc: '2026-05-13T11:46:23Z', moisture_pct: '20.25', temp_f: '58.4', salinity_dsm: '0.290', lat: '38.9998877', lon: '-77.1802310' },
]

const headers = ['point', 'time_utc', 'moisture_pct', 'temp_f', 'salinity_dsm', 'lat', 'lon']
const mapping = guessReadingMapping(headers)
ok(mapping.time === 'time_utc', 'guess time column')
ok(mapping.lat === 'lat' && mapping.lon === 'lon', 'guess lat/lon')
ok(mapping.moisture === 'moisture_pct', 'guess moisture column')
ok(mapping.id === 'point', 'guess spot/id column')

const mapped = mapReadingRows(FIX, mapping)
ok(mapped.length === 12, 'maps 12 rows')
near(mapped[0].vwcPct, 22.40, 0.001, 'moisture parsed')
ok(mapped[2].spot === '3', 'spot label from point')
ok(mapped[0].externalId === null, 'no external id (point is not globally unique)')

// a green outline enclosing all 12 points
const lons = FIX.map((r) => +r.lon), lats = FIX.map((r) => +r.lat)
const m = 0.00003
const green1 = { id: 'g1', ring: [[Math.min(...lons) - m, Math.min(...lats) - m], [Math.min(...lons) - m, Math.max(...lats) + m], [Math.max(...lons) + m, Math.max(...lats) + m], [Math.max(...lons) + m, Math.min(...lats) - m]] }

const plan = planReadingsImport({ rows: FIX, mapping, greens: [green1] })
ok(plan.placedCount === 12, 'all 12 readings placed on green 1')
ok(plan.unplacedCount === 0, 'nothing unplaced')
ok(plan.rounds.length === 1, 'one round')
near(plan.rounds[0].avg, 22.69, 0.01, 'round avg 22.69%')
near(plan.rounds[0].min, 17.61, 0.001, 'round low 17.61%')
near(plan.rounds[0].max, 26.56, 0.001, 'round high 26.56%')
ok(plan.rounds[0].slot === 'morning', 'morning round')

// re-import with those keys already present → all duplicates
const keys = new Set(plan.placed.map((p) => p.dedupeKey))
const plan2 = planReadingsImport({ rows: FIX, mapping, greens: [green1], existingKeys: keys })
ok(plan2.placedCount === 0 && plan2.duplicates === 12, 're-import adds nothing (12 duplicates)')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
