// Public, unauthenticated endpoint for the volunteer sign-up form and the
// public handbook. It uses the Supabase service role (server-side only) so we
// never have to loosen row-level security for anonymous visitors.
//
//   GET  ?t=<tournamentId>[&handbook=1]  → { name, startDate, endDate,
//                                            location, signupOpen, form, handbook? }
//   POST { tournamentId, values } → adds the volunteer straight to the roster
//                                   (one-stop sign-up; answers mapped by field)
import { createClient } from '@supabase/supabase-js'
import { uniqueCode, signupFieldsOf, SIGNUP_MAPS } from '@/lib/tournament'

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

export async function GET(request) {
  const supabase = admin()
  if (!supabase) return Response.json({ error: 'Not configured' }, { status: 500 })
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('t')
  if (!id) return Response.json({ error: 'Missing tournament' }, { status: 400 })

  const { data, error } = await supabase.from('tournaments').select('name, start_date, end_date, location, signup_open, data').eq('id', id).maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'Tournament not found' }, { status: 404 })

  const out = {
    name: data.name,
    startDate: data.start_date || '',
    endDate: data.end_date || '',
    location: data.location || '',
    signupOpen: !!data.signup_open,
    form: signupFieldsOf({ data: data.data }),
  }
  if (searchParams.get('handbook')) {
    const hb = data.data?.handbook || {}
    out.handbook = { sections: hb.sections || [], logo: hb.logo || '', sponsors: hb.sponsors || [], backCover: hb.backCover || {} }
  }
  return Response.json(out)
}

export async function POST(request) {
  const supabase = admin()
  if (!supabase) return Response.json({ error: 'Not configured' }, { status: 500 })

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Bad request' }, { status: 400 }) }

  const tournamentId = String(body.tournamentId || '')
  const values = body.values && typeof body.values === 'object' ? body.values : {}
  if (!tournamentId) return Response.json({ error: 'Missing tournament' }, { status: 400 })

  // Load the tournament (its sign-up form defines how answers are handled).
  const { data: t, error: te } = await supabase.from('tournaments').select('signup_open, data').eq('id', tournamentId).maybeSingle()
  if (te) return Response.json({ error: te.message }, { status: 500 })
  if (!t) return Response.json({ error: 'Tournament not found' }, { status: 404 })
  if (!t.signup_open) return Response.json({ error: 'Sign-ups are closed for this tournament.' }, { status: 403 })

  const fields = signupFieldsOf({ data: t.data })
  const clip = (v, n = 300) => String(v ?? '').trim().slice(0, n)
  const valOf = (f) => clip(values[f.id], f.type === 'textarea' ? 600 : 200)

  // Server-side required check (client checks too).
  for (const f of fields) {
    if ((f.required || f.map === 'name') && !valOf(f)) return Response.json({ error: `${f.label} is required` }, { status: 400 })
  }

  // Route answers: mapped questions become roster fields; the rest are kept as
  // Q&A on the person so staff can read them.
  const mapped = {}
  const answers = []
  let name = ''
  for (const f of fields) {
    const v = valOf(f)
    if (f.map === 'name') { name = v; continue }
    if (SIGNUP_MAPS.includes(f.map)) { if (v) mapped[f.map] = v }
    else if (v) answers.push({ label: f.label, value: v })
  }
  if (!name) return Response.json({ error: 'Name is required' }, { status: 400 })
  name = name.slice(0, 120)
  const email = (mapped.email || '').slice(0, 160)

  // Existing roster: unique badge code + de-dupe by email.
  const { data: existing, error: ee } = await supabase.from('tournament_people').select('code, data').eq('tournament_id', tournamentId)
  if (ee) return Response.json({ error: ee.message }, { status: 500 })
  if (email && (existing || []).some((r) => String(r.data?.email || '').toLowerCase() === email.toLowerCase())) {
    return Response.json({ ok: true, duplicate: true })
  }

  const code = uniqueCode((existing || []).map((r) => r.code))
  const row = {
    tournament_id: tournamentId,
    name,
    code,
    data: { role: 'Volunteer', ...mapped, answers, source: 'signup' },
  }
  const { error } = await supabase.from('tournament_people').insert(row)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
