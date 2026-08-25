// Public, unauthenticated read-only endpoint for the crew's phone views — the
// live job board and the mowing routes — reached from QR codes. Uses the
// Supabase service role (server-side only) and requires the club parts key
// (courseInfo.partsKey) so the fixed URLs aren't readable by just anyone.
//
//   GET ?view=board&k=KEY&date=YYYY-MM-DD[&course=Blue] → { tasks, club, crew,
//                                                           boardMessage, location }
//   GET ?view=routes&k=KEY → { courses, courseInfo }  (mowing route config)
import { createClient } from '@supabase/supabase-js'

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

async function settings(supabase) {
  const { data } = await supabase.from('app_settings').select('course_info, location').eq('id', 1).maybeSingle()
  return { courseInfo: data?.course_info || {}, location: data?.location || null }
}
function keyOk(courseInfo, k) {
  return !!k && !!courseInfo?.partsKey && courseInfo.partsKey === k
}

// Never expose the key or any config that isn't needed by the crew views.
function safeCourseInfo(ci) {
  const { partsKey, directorPins, ...rest } = ci || {}
  return rest
}

function rowToTask(r) {
  return {
    id: r.id, date: r.task_date, job: r.job, area: r.area || '', assignee: r.assignee || '',
    equipment: r.equipment || '', course: r.course || '', status: r.status || 'todo',
    minutes: r.minutes ?? null, sort: r.sort ?? 0, notes: r.notes || '', groupNote: r.group_note || '', slot: r.slot || '1',
  }
}
const noStore = { 'Cache-Control': 'no-store' }

export async function GET(request) {
  const supabase = admin()
  if (!supabase) return Response.json({ error: 'Not configured' }, { status: 500 })
  const sp = new URL(request.url).searchParams
  const { courseInfo, location } = await settings(supabase)
  if (!keyOk(courseInfo, sp.get('k'))) return Response.json({ error: 'Not authorized' }, { status: 401 })

  const view = sp.get('view')
  if (view === 'data') {
    // Config the crew's Field Data page needs: indicator greens + wetting
    // products (for moisture), and the area list (for clippings/speed/scouting).
    const { data } = await supabase.from('app_settings').select('areas').eq('id', 1).maybeSingle()
    return Response.json({
      club: courseInfo.clubName || '',
      wetting: courseInfo.wetting || {},
      areas: Object.keys(data?.areas || {}),
      location,
    }, { headers: noStore })
  }
  if (view === 'routes') {
    // Also report who's mowing greens today so the phone view can auto-pick the
    // matching mower-count route layout. A greens-mowing job is any job whose
    // name mentions both "mow" and "green".
    let greensMowToday = []
    const date = sp.get('date')
    if (date) {
      const { data } = await supabase.from('crew_tasks').select('job, course, assignee').eq('task_date', date)
      const isGreensMow = (j) => { const s = String(j || '').toLowerCase(); return s.includes('mow') && s.includes('green') }
      greensMowToday = (data || []).filter((t) => isGreensMow(t.job)).map((t) => ({ course: t.course || '', assignee: t.assignee || '' }))
    }
    return Response.json({ courses: courseInfo.courses || [], courseInfo: safeCourseInfo(courseInfo), greensMowToday }, { headers: noStore })
  }

  // Default: the job board for one day.
  const date = sp.get('date')
  let q = supabase.from('crew_tasks').select('*')
  if (date) q = q.gte('task_date', date).lte('task_date', date)
  q = q.order('sort', { ascending: true })
  const { data, error } = await q
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({
    tasks: (data || []).map(rowToTask),
    club: courseInfo.clubName || '',
    crew: courseInfo.crew || {},
    boardMessage: courseInfo.boardMessage || '',
    courseInfo: safeCourseInfo(courseInfo),
    location,
  }, { headers: noStore })
}

// ── crew data submission (no login, club key required) ──────────────────────
// The crew's Field Data QR page posts here to record what they collect on
// morning rounds: moisture, clipping yields, greens speed, scouting.
const today = () => new Date().toISOString().slice(0, 10)
function stats(values) {
  const v = (values || []).map(Number).filter((x) => Number.isFinite(x))
  if (!v.length) return { avg: null, cv: null }
  const avg = v.reduce((s, x) => s + x, 0) / v.length
  if (v.length < 2 || avg === 0) return { avg: Math.round(avg * 10) / 10, cv: 0 }
  const variance = v.reduce((s, x) => s + (x - avg) ** 2, 0) / v.length
  const cv = (Math.sqrt(variance) / avg) * 100
  return { avg: Math.round(avg * 10) / 10, cv: Math.round(cv * 10) / 10 }
}
const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))

export async function POST(request) {
  const supabase = admin()
  if (!supabase) return Response.json({ error: 'Not configured' }, { status: 500 })
  let body
  try { body = await request.json() } catch { return Response.json({ error: 'bad_request' }, { status: 400 }) }
  const { courseInfo } = await settings(supabase)
  if (!keyOk(courseInfo, body?.k)) return Response.json({ error: 'Not authorized' }, { status: 401 })

  const action = body.action
  const date = body.date || today()
  try {
    if (action === 'clipping') {
      const rows = (body.rows || []).filter((r) => r.area).map((r) => ({
        area: r.area, clip_date: date, volume: r.volume ?? null, unit: r.unit || 'mL', notes: r.notes || '',
      }))
      if (!rows.length) return Response.json({ error: 'no_rows' }, { status: 400 })
      const { error } = await supabase.from('clippings').insert(rows)
      if (error) throw error
      return Response.json({ ok: true, n: rows.length })
    }
    if (action === 'greenspeed') {
      const rows = (body.rows || []).filter((r) => r.area).map((r) => ({
        area: r.area, reading_date: date, speed: r.speed ?? null, notes: r.notes || '',
      }))
      if (!rows.length) return Response.json({ error: 'no_rows' }, { status: 400 })
      const { error } = await supabase.from('greens_speeds').insert(rows)
      if (error) throw error
      return Response.json({ ok: true, n: rows.length })
    }
    if (action === 'scouting') {
      const row = {
        area: body.area || '', observed_date: date, kind: body.kind || 'Other',
        target: body.target || '', severity: body.severity || '', notes: body.notes || '', photo: body.photo || '',
      }
      const { error } = await supabase.from('scouting').insert(row)
      if (error) throw error
      return Response.json({ ok: true })
    }
    if (action === 'moisture') {
      const greenId = body.greenId
      const values = (body.values || []).map(Number).filter(Number.isFinite)
      if (!greenId || !values.length) return Response.json({ error: 'no_values' }, { status: 400 })
      const { avg, cv } = stats(values)
      // read-modify-write the settings JSON (no dedicated table)
      const { data } = await supabase.from('app_settings').select('course_info').eq('id', 1).maybeSingle()
      const ci = data?.course_info || {}
      const wetting = ci.wetting || {}
      const reading = { id: newId(), greenId, date, values, avg, cv }
      let greens = wetting.greens || []
      if (Array.isArray(body.points)) {
        greens = greens.map((g) => (g.id === greenId ? { ...g, points: body.points } : g))
      }
      const nextCi = { ...ci, wetting: { ...wetting, greens, readings: [...(wetting.readings || []), reading] } }
      const { error } = await supabase.from('app_settings').update({ course_info: nextCi }).eq('id', 1)
      if (error) throw error
      return Response.json({ ok: true, avg, cv })
    }
    return Response.json({ error: 'unknown_action' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e?.message || 'save_failed' }, { status: 500 })
  }
}
