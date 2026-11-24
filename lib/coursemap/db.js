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
export async function importReadings({ clubId, courseId, placed }) {
  const byGreen = {}
  for (const r of placed) (byGreen[r.areaId] ||= []).push(r)
  let roundsInserted = 0, readingsInserted = 0
  for (const [areaId, list] of Object.entries(byGreen)) {
    for (const rd of groupRounds(list)) {
      const { data: round, error: rErr } = await supabase.from('moisture_rounds').insert({
        club_id: clubId, area_id: areaId, started_at: rd.startedAt, ended_at: rd.endedAt,
        n_readings: rd.n, avg_vwc: rd.avg, min_vwc: rd.min, max_vwc: rd.max,
      }).select('id').single()
      if (rErr) { console.error('insert round', rErr); continue }
      roundsInserted++
      const rows = rd.readings.map((r) => ({
        club_id: clubId, course_id: courseId || null, taken_at: r.takenAt || null, lat: r.lat, lon: r.lon,
        vwc_pct: r.vwcPct, soil_temp_f: r.soilTempF, salinity_dsm: r.salinityDsm, source: 'deacon',
        device: r.device, spot: r.spot, external_id: r.externalId, area_id: areaId, round_id: round.id,
      }))
      const { error } = await supabase.from('moisture_readings').insert(rows)
      if (error) console.error('insert readings', error); else readingsInserted += rows.length
    }
  }
  return { roundsInserted, readingsInserted }
}

// Rounds for a course (newest first), with their green names.
export async function fetchRounds(courseId, areaIds) {
  let q = supabase.from('moisture_rounds').select('*').order('started_at', { ascending: false })
  if (areaIds?.length) q = q.in('area_id', areaIds)
  const { data } = await q
  return (data || []).map((r) => ({ id: r.id, areaId: r.area_id, startedAt: r.started_at, endedAt: r.ended_at, n: r.n_readings, avg: r.avg_vwc, min: r.min_vwc, max: r.max_vwc }))
}

export async function fetchReadingsForRound(roundId) {
  const { data } = await supabase.from('moisture_readings').select('*').eq('round_id', roundId).order('taken_at')
  return (data || []).map((r) => ({ id: r.id, takenAt: r.taken_at, lat: r.lat, lon: r.lon, vwcPct: r.vwc_pct, soilTempF: r.soil_temp_f, salinityDsm: r.salinity_dsm, spot: r.spot, areaId: r.area_id }))
}
