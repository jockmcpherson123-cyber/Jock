// Data access for the Course Map section. Same browser-client pattern as the
// rest of the app; RLS (phase36/37) keeps every row + file scoped to the user's
// club. The Nearmap key is never read here — it lives server-side only.
import { createClient } from '@/lib/supabase/client'
import { groupRounds, readingDedupeKey } from './greens.js'

let _client = null
const supabase = new Proxy({}, {
  get(_t, prop) {
    if (!_client) _client = createClient()
    const v = _client[prop]
    return typeof v === 'function' ? v.bind(_client) : v
  },
})

const BUCKET = 'imagery'

// The user's club, its courses, and (non-secret) settings.
export async function fetchCourseContext() {
  const [clubRes, coursesRes, settingsRes] = await Promise.all([
    supabase.from('clubs').select('id, name').maybeSingle(),
    supabase.from('courses').select('id, name, holes').order('name'),
    supabase.from('club_settings').select('default_imagery_id, inches_per_point, max_depth, settings').maybeSingle(),
  ])
  return {
    club: clubRes.data || null,
    courses: coursesRes.data || [],
    settings: settingsRes.data || { inches_per_point: 0.03, max_depth: 0.25, settings: {} },
  }
}

// Imagery for a course, newest first.
export async function fetchImagery(courseId) {
  let q = supabase.from('imagery').select('*').order('captured_on', { ascending: false, nullsFirst: false }).order('uploaded_at', { ascending: false })
  if (courseId) q = q.eq('course_id', courseId)
  const { data, error } = await q
  if (error) { console.error('fetchImagery', error); return [] }
  return (data || []).map(mapImagery)
}

function mapImagery(r) {
  return {
    id: r.id, clubId: r.club_id, courseId: r.course_id, capturedOn: r.captured_on, source: r.source,
    filePath: r.file_path, crs: r.crs, ulX: r.ul_x, ulY: r.ul_y, pxSizeX: r.px_size_x, pxSizeY: r.px_size_y,
    widthPx: r.width_px, heightPx: r.height_px, status: r.status, uploadedAt: r.uploaded_at,
  }
}

async function myId() { const { data } = await supabase.auth.getUser(); return data?.user?.id || null }

// Upload a photo to Storage (direct browser → Storage, so large files are fine)
// and record the imagery row with its world-file placement.
export async function uploadImagery({ file, clubId, courseId, georef, source = 'upload', capturedOn }) {
  const uid = await myId()
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${clubId}/${crypto.randomUUID()}_${safe}`
  const up = await supabase.storage.from(BUCKET).upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || 'image/jpeg' })
  if (up.error) { console.error('storage upload', up.error); throw up.error }

  const row = {
    club_id: clubId, course_id: courseId || null, source, file_path: path, crs: 'EPSG:3857',
    ul_x: georef.ul_x, ul_y: georef.ul_y, px_size_x: georef.px_size_x, px_size_y: georef.px_size_y,
    width_px: georef.width_px, height_px: georef.height_px, captured_on: capturedOn || null,
    uploaded_by: uid, status: 'ready',
  }
  const { data, error } = await supabase.from('imagery').insert(row).select('*').single()
  if (error) { console.error('insert imagery', error); throw error }
  return mapImagery(data)
}

// A temporary signed URL to display a private photo (the select policy checks the
// club), good for ~2 hours.
export async function signedUrl(path) {
  if (!path) return null
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 7200)
  if (error) { console.error('signedUrl', error); return null }
  return data?.signedUrl || null
}

export async function deleteImagery(img) {
  if (img.filePath) await supabase.storage.from(BUCKET).remove([img.filePath])
  await supabase.from('imagery').delete().eq('id', img.id)
}

// Set (or clear) the club's default aerial — the one every screen shows.
export async function setDefaultImagery(imageryId) {
  const { data } = await supabase.from('club_settings').select('club_id').maybeSingle()
  if (!data) return
  await supabase.from('club_settings').update({ default_imagery_id: imageryId || null, updated_at: new Date().toISOString() }).eq('club_id', data.club_id)
}

// ── Areas ──────────────────────────────────────────────────────────────────
// geom is stored as a GeoJSON Polygon; we hand the UI the outer ring as
// [[lon,lat],…] (open) in `ring`.
function mapArea(r) {
  const ring = r.geom?.coordinates?.[0] || []
  const open = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring
  return { id: r.id, clubId: r.club_id, courseId: r.course_id, hole: r.hole, type: r.type, name: r.name, ring: open, sqft: r.sqft, updatedAt: r.updated_at }
}

export async function fetchAreas(courseId) {
  let q = supabase.from('areas').select('*')
  if (courseId) q = q.eq('course_id', courseId)
  const { data, error } = await q
  if (error) { console.error('fetchAreas', error); return [] }
  return (data || []).map(mapArea)
}

function ringToGeoJSON(ring) {
  const r = [...ring]
  if (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) r.push(r[0]) // close
  return { type: 'Polygon', coordinates: [r] }
}

export async function saveArea({ id, clubId, courseId, hole, type, name, ring, sqft }) {
  const uid = await myId()
  const geom = ringToGeoJSON(ring)
  if (id) {
    // snapshot the current shape into history first
    const { data: old } = await supabase.from('areas').select('geom, sqft, club_id').eq('id', id).single()
    if (old) await supabase.from('area_history').insert({ area_id: id, club_id: old.club_id, geom: old.geom, sqft: old.sqft, changed_by: uid })
    const { data, error } = await supabase.from('areas').update({ hole, type, name, geom, sqft, updated_by: uid, updated_at: new Date().toISOString() }).eq('id', id).select('*').single()
    if (error) { console.error('saveArea update', error); throw error }
    return mapArea(data)
  }
  const { data, error } = await supabase.from('areas').insert({ club_id: clubId, course_id: courseId || null, hole, type, name, geom, sqft, updated_by: uid }).select('*').single()
  if (error) { console.error('saveArea insert', error); throw error }
  return mapArea(data)
}

export async function deleteArea(id) {
  const { error } = await supabase.from('areas').delete().eq('id', id)
  if (error) { console.error('deleteArea', error); throw error }
}

export async function fetchAreaHistory(areaId) {
  const { data } = await supabase.from('area_history').select('sqft, changed_at').eq('area_id', areaId).order('changed_at', { ascending: false })
  return (data || []).map((h) => ({ sqft: h.sqft, changedAt: h.changed_at }))
}

// ── Moisture readings ────────────────────────────────────────────────────────
// Greens (areas of type 'green') as [{ id, ring }] for point-in-polygon.
export async function fetchGreens(courseId) {
  const areas = await fetchAreas(courseId)
  return areas.filter((a) => a.type === 'green').map((a) => ({ id: a.id, ring: a.ring, name: a.name, hole: a.hole }))
}

// Saved column mapping lives in club_settings.settings.moistureMapping.
export async function fetchMoistureMapping() {
  const { data } = await supabase.from('club_settings').select('settings').maybeSingle()
  return data?.settings?.moistureMapping || null
}
export async function saveMoistureMapping(mapping) {
  const { data } = await supabase.from('club_settings').select('club_id, settings').maybeSingle()
  if (!data) return
  const settings = { ...(data.settings || {}), moistureMapping: mapping }
  await supabase.from('club_settings').update({ settings, updated_at: new Date().toISOString() }).eq('club_id', data.club_id)
}

// Dedupe keys already in the DB for this club (so re-importing adds nothing).
export async function fetchReadingKeys() {
  const { data } = await supabase.from('moisture_readings').select('taken_at, lat, lon, vwc_pct, external_id')
  const set = new Set()
  for (const r of (data || [])) set.add(readingDedupeKey({ takenAt: r.taken_at, lat: r.lat, lon: r.lon, vwcPct: r.vwc_pct, externalId: r.external_id }))
  return set
}

// Persist placed readings: build rounds per green, insert rounds then readings.
// `source` marks where the readings came from (deacon import, manual entry, or a
// migration of older history); it is stored on every reading row.
export async function importReadings({ clubId, courseId, placed, source = 'deacon' }) {
  const byGreen = {}
  for (const r of placed) (byGreen[r.areaId || '_none'] ||= []).push(r)
  let roundsInserted = 0, readingsInserted = 0
  for (const [areaKey, list] of Object.entries(byGreen)) {
    const areaId = areaKey === '_none' ? null : areaKey
    for (const rd of groupRounds(list)) {
      const { data: round, error: rErr } = await supabase.from('moisture_rounds').insert({
        club_id: clubId, area_id: areaId, started_at: rd.startedAt, ended_at: rd.endedAt,
        n_readings: rd.n, avg_vwc: rd.avg, min_vwc: rd.min, max_vwc: rd.max,
      }).select('id').single()
      if (rErr) { console.error('insert round', rErr); continue }
      roundsInserted++
      const rows = rd.readings.map((r) => ({
        club_id: clubId, course_id: courseId || null, taken_at: r.takenAt || null, lat: r.lat ?? null, lon: r.lon ?? null,
        vwc_pct: r.vwcPct, soil_temp_f: r.soilTempF ?? null, salinity_dsm: r.salinityDsm ?? null, source: r.source || source,
        device: r.device || null, spot: r.spot || null, external_id: r.externalId || null, area_id: areaId, round_id: round.id,
      }))
      const { error } = await supabase.from('moisture_readings').insert(rows)
      if (error) console.error('insert readings', error); else readingsInserted += rows.length
    }
  }
  return { roundsInserted, readingsInserted }
}

// Rounds for a set of greens WITH each round's individual reading values — what
// the Wetting Agents analysis needs (per-round average + uniformity CV). Returns
// [{ id, areaId, date, startedAt, values:[Number], n, avg, min, max }] newest last.
export async function fetchMoistureForGreens(areaIds) {
  if (!areaIds?.length) return []
  const { data: rounds } = await supabase.from('moisture_rounds').select('*').in('area_id', areaIds).order('started_at')
  const ids = (rounds || []).map((r) => r.id)
  let reads = []
  if (ids.length) {
    // Page through — a season of 12-point rounds can exceed the 1,000-row cap.
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from('moisture_readings').select('round_id, vwc_pct').in('round_id', ids).range(from, from + 999)
      reads.push(...(data || []))
      if (!data || data.length < 1000) break
    }
  }
  const valsByRound = {}
  for (const r of reads) { if (r.vwc_pct != null) (valsByRound[r.round_id] ||= []).push(Number(r.vwc_pct)) }
  return (rounds || []).map((r) => ({
    id: r.id, areaId: r.area_id, startedAt: r.started_at,
    date: r.started_at ? String(r.started_at).slice(0, 10) : null,
    values: valsByRound[r.id] || [], n: r.n_readings, avg: r.avg_vwc, min: r.min_vwc, max: r.max_vwc,
  }))
}

// How many migrated readings already exist for a green (so re-running the
// one-time import of old Wetting-Agents history doesn't duplicate it). Migrated
// rows are tagged device='migrated' — the `source` column has a CHECK that only
// allows deacon/manual/other, so the marker lives on the free-text device field.
export async function countMigratedRounds(areaId) {
  if (!areaId) return 0
  const { count } = await supabase.from('moisture_readings').select('id', { count: 'exact', head: true }).eq('area_id', areaId).eq('device', 'migrated')
  return count || 0
}

// Remove rounds for a green that have no readings — the empty shells a failed
// import left behind. Readings are never touched, so no real data is lost.
export async function deleteEmptyRounds(areaId) {
  if (!areaId) return 0
  const { data: rounds } = await supabase.from('moisture_rounds').select('id').eq('area_id', areaId)
  const ids = (rounds || []).map((r) => r.id)
  if (!ids.length) return 0
  const withReads = new Set()
  for (let from = 0; from < ids.length; from += 100) {
    const chunk = ids.slice(from, from + 100)
    const { data } = await supabase.from('moisture_readings').select('round_id').in('round_id', chunk)
    for (const r of (data || [])) withReads.add(r.round_id)
  }
  const empties = ids.filter((id) => !withReads.has(id))
  if (empties.length) await supabase.from('moisture_rounds').delete().in('id', empties)
  return empties.length
}

// Rounds for a course (newest first), with their green names.
export async function fetchRounds(courseId, areaIds) {
  let q = supabase.from('moisture_rounds').select('*').order('started_at', { ascending: false })
  if (areaIds?.length) q = q.in('area_id', areaIds)
  const { data } = await q
  return (data || []).map((r) => ({ id: r.id, areaId: r.area_id, startedAt: r.started_at, endedAt: r.ended_at, n: r.n_readings, avg: r.avg_vwc, min: r.min_vwc, max: r.max_vwc }))
}

// The spots (label + GPS) from a green's most recent round, so manual entry can
// reuse the same test spots each day instead of starting blank.
export async function fetchLatestSpots(areaId) {
  if (!areaId) return []
  const { data: rounds } = await supabase.from('moisture_rounds').select('id').eq('area_id', areaId).order('started_at', { ascending: false }).limit(1)
  const round = rounds?.[0]
  if (!round) return []
  const { data } = await supabase.from('moisture_readings').select('spot, lat, lon').eq('round_id', round.id).order('taken_at')
  return (data || []).map((r, i) => ({ label: r.spot || `Spot ${i + 1}`, lat: r.lat ?? null, lon: r.lon ?? null }))
}

// The local calendar date (YYYY-MM-DD) of the most recent round across these
// greens, so the page can fall back to the last day with readings when today
// has none. Returns null if there are no rounds at all.
export async function fetchLatestRoundDate(areaIds) {
  if (!areaIds?.length) return null
  const { data } = await supabase.from('moisture_rounds').select('started_at')
    .in('area_id', areaIds).order('started_at', { ascending: false }).limit(1)
  const started = data?.[0]?.started_at
  if (!started) return null
  const d = new Date(started)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function fetchReadingsForRound(roundId) {
  const { data } = await supabase.from('moisture_readings').select('*').eq('round_id', roundId).order('taken_at')
  return (data || []).map(mapReading)
}

function mapReading(r) {
  return { id: r.id, roundId: r.round_id, takenAt: r.taken_at, lat: r.lat, lon: r.lon, vwcPct: r.vwc_pct, soilTempF: r.soil_temp_f, salinityDsm: r.salinity_dsm, spot: r.spot, areaId: r.area_id }
}

// Everything the Greens-today page needs for a day: each green's rounds (with
// their readings) on that date. `dayStartIso`/`dayEndIso` bound the local day.
export async function fetchDayRounds(courseId, areaIds, dayStartIso, dayEndIso) {
  if (!areaIds?.length) return []
  const { data: rounds } = await supabase.from('moisture_rounds').select('*')
    .in('area_id', areaIds).gte('started_at', dayStartIso).lt('started_at', dayEndIso).order('started_at')
  const roundIds = (rounds || []).map((r) => r.id)
  let readings = []
  if (roundIds.length) {
    const { data } = await supabase.from('moisture_readings').select('*').in('round_id', roundIds)
    readings = (data || []).map(mapReading)
  }
  const byRound = {}
  for (const rd of readings) (byRound[rd.roundId] ||= []).push(rd)
  return (rounds || []).map((r) => ({
    id: r.id, areaId: r.area_id, startedAt: r.started_at, endedAt: r.ended_at,
    n: r.n_readings, avg: r.avg_vwc, min: r.min_vwc, max: r.max_vwc,
    slot: new Date(r.started_at).getHours() < 12 ? 'morning' : 'afternoon',
    readings: byRound[r.id] || [],
  }))
}

// Tonight's plan for a course + date.
export async function fetchWateringPlan(courseId, date) {
  const [planRes, dayRes] = await Promise.all([
    supabase.from('watering_plan').select('area_id, depth_in, chosen_by, chosen_at').eq('plan_date', date),
    supabase.from('watering_day').select('forecast_et, approved_by, approved_at').eq('course_id', courseId).eq('plan_date', date).maybeSingle(),
  ])
  const depths = {}
  for (const p of (planRes.data || [])) depths[p.area_id] = { depth: p.depth_in, chosenBy: p.chosen_by, chosenAt: p.chosen_at }
  return { depths, day: dayRes.data || { forecast_et: null, approved_by: null, approved_at: null } }
}

export async function setWateringDepth({ clubId, courseId, areaId, date, depthIn }) {
  const uid = await myId()
  const { error } = await supabase.from('watering_plan').upsert(
    { club_id: clubId, course_id: courseId || null, area_id: areaId, plan_date: date, depth_in: depthIn, chosen_by: uid, chosen_at: new Date().toISOString() },
    { onConflict: 'area_id,plan_date' },
  )
  if (error) { console.error('setWateringDepth', error); throw error }
}

async function upsertWateringDay(clubId, courseId, date, patch) {
  const { data: existing } = await supabase.from('watering_day').select('id').eq('course_id', courseId).eq('plan_date', date).maybeSingle()
  if (existing) { await supabase.from('watering_day').update(patch).eq('id', existing.id) }
  else { await supabase.from('watering_day').insert({ club_id: clubId, course_id: courseId || null, plan_date: date, ...patch }) }
}

export async function saveForecastEt({ clubId, courseId, date, et }) {
  await upsertWateringDay(clubId, courseId, date, { forecast_et: et })
}

export async function approveWateringDay({ clubId, courseId, date, approve }) {
  const uid = await myId()
  await upsertWateringDay(clubId, courseId, date, approve ? { approved_by: uid, approved_at: new Date().toISOString() } : { approved_by: null, approved_at: null })
}

// ── Targets (seasonal moisture ranges) ─────────────────────────────────────────
const mapTarget = (t) => ({ id: t.id, courseId: t.course_id, surface: t.surface, name: t.name, startMd: t.start_md, endMd: t.end_md, vwcLo: t.vwc_lo, vwcHi: t.vwc_hi, aim: t.aim, salinityMax: t.salinity_max })

export async function fetchTargets(courseId) {
  let q = supabase.from('moisture_targets').select('*')
  if (courseId) q = q.eq('course_id', courseId)
  const { data } = await q.order('start_md')
  return (data || []).map(mapTarget)
}

export async function saveTarget(t) {
  const row = { course_id: t.courseId || null, surface: t.surface || 'green', name: t.name, start_md: t.startMd, end_md: t.endMd, vwc_lo: t.vwcLo, vwc_hi: t.vwcHi, aim: t.aim ?? null, salinity_max: t.salinityMax ?? null }
  if (t.id) { const { error } = await supabase.from('moisture_targets').update(row).eq('id', t.id); if (error) throw error; return }
  const { error } = await supabase.from('moisture_targets').insert({ ...row, club_id: t.clubId }); if (error) throw error
}
export async function deleteTarget(id) { const { error } = await supabase.from('moisture_targets').delete().eq('id', id); if (error) throw error }

const mapException = (e) => ({ id: e.id, areaId: e.area_id, targetId: e.target_id, vwcLo: e.vwc_lo, vwcHi: e.vwc_hi, aim: e.aim, reason: e.reason })
export async function fetchExceptions() {
  const { data } = await supabase.from('target_exceptions').select('*')
  return (data || []).map(mapException)
}
export async function saveException(e) {
  const row = { area_id: e.areaId, target_id: e.targetId || null, vwc_lo: e.vwcLo ?? null, vwc_hi: e.vwcHi ?? null, aim: e.aim ?? null, reason: e.reason || null }
  if (e.id) { const { error } = await supabase.from('target_exceptions').update(row).eq('id', e.id); if (error) throw error; return }
  const { error } = await supabase.from('target_exceptions').insert({ ...row, club_id: e.clubId }); if (error) throw error
}
export async function deleteException(id) { const { error } = await supabase.from('target_exceptions').delete().eq('id', id); if (error) throw error }
