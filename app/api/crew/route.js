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
