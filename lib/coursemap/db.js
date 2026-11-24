// Data access for the Course Map section. Same browser-client pattern as the
// rest of the app; RLS (phase36/37) keeps every row + file scoped to the user's
// club. The Nearmap key is never read here — it lives server-side only.
import { createClient } from '@/lib/supabase/client'

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
