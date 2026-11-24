// ============================================================================
//  Course Map — moisture readings import (pure logic).
//
//  Turns mapped file rows into readings, places each on the green its GPS falls
//  in (never trusting the device's own label), and groups them into rounds. The
//  DB layer (lib/coursemap/db.importReadings) persists what this returns; a
//  future USGA feed can call the same path with its own rows.
// ============================================================================
import { assignGreen, groupRounds, readingDedupeKey, normalizeMoisturePct } from './greens.js'

// Map file rows (objects keyed by column header) through the saved column
// mapping into normalized readings.
export function mapReadingRows(rows, mapping) {
  const num = (v) => { const n = Number(v); return isFinite(n) ? n : null }
  return (rows || []).map((r) => ({
    takenAt: mapping.time ? String(r[mapping.time] || '').trim() : null,
    lat: num(r[mapping.lat]),
    lon: num(r[mapping.lon]),
    vwcPct: normalizeMoisturePct(r[mapping.moisture]),
    soilTempF: mapping.temperature ? num(r[mapping.temperature]) : null,
    salinityDsm: mapping.salinity ? num(r[mapping.salinity]) : null,
    spot: mapping.id ? String(r[mapping.id] ?? '').trim() || null : null, // DEACON "point" — a per-round label, not unique
    externalId: mapping.externalId ? String(r[mapping.externalId] ?? '').trim() || null : null,
    device: mapping.device ? String(r[mapping.device] || '').trim() || null : null,
  }))
}

// Guess a column mapping from the header names (DEACON fixture + common variants).
export function guessReadingMapping(headers) {
  const find = (re) => headers.find((h) => re.test(h.toLowerCase())) || ''
  return {
    time: find(/time|date|taken|timestamp/),
    lat: find(/^lat|latitude/),
    lon: find(/^lon|^lng|longitude/),
    moisture: find(/moist|vwc|wfv|%|percent/),
    temperature: find(/temp/),
    salinity: find(/salin|dsm|ec\b/),
    id: find(/\bid\b|point|reading|test|sample/),
    device: find(/device|unit|serial/),
  }
}

// Plan an import: place readings, drop duplicates, and build rounds.
//   greens: [{ id, ring:[[lon,lat],…] }]  (areas of type 'green')
//   existingKeys: Set of dedupe keys already in the DB (for re-import safety)
export function planReadingsImport({ rows, mapping, greens, existingKeys = new Set(), edgeFt = 5 }) {
  const mapped = mapReadingRows(rows, mapping)
  const placed = []
  const unplaced = []
  let duplicates = 0

  for (const r of mapped) {
    if (r.lat == null || r.lon == null || r.vwcPct == null) { unplaced.push({ ...r, reason: 'missing GPS or moisture' }); continue }
    const key = readingDedupeKey(r)
    if (existingKeys.has(key)) { duplicates++; continue }
    const areaId = assignGreen([r.lon, r.lat], greens, edgeFt)
    if (areaId) placed.push({ ...r, areaId, dedupeKey: key })
    else unplaced.push({ ...r, reason: 'outside every green' })
  }

  // group placed readings into rounds, per green
  const byGreen = {}
  for (const r of placed) (byGreen[r.areaId] ||= []).push(r)
  const rounds = []
  for (const [areaId, list] of Object.entries(byGreen)) {
    for (const rd of groupRounds(list)) rounds.push({ ...rd, areaId })
  }

  return { placed, unplaced, rounds, duplicates, total: mapped.length, placedCount: placed.length, unplacedCount: unplaced.length }
}
