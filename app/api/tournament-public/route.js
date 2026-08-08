// Public, unauthenticated endpoint for the volunteer sign-up form and the
// public handbook. It uses the Supabase service role (server-side only) so we
// never have to loosen row-level security for anonymous visitors.
//
//   GET  ?t=<tournamentId>[&handbook=1]  → { name, startDate, endDate,
//                                            location, signupOpen, handbook? }
//   POST { tournamentId, name, email, phone, ... } → inserts a pending sign-up
//
// Sign-ups land in the `tournament_signups` staging table for staff to review —
// they never touch the live roster directly.
import { createClient } from '@supabase/supabase-js'

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
  }
  if (searchParams.get('handbook')) {
    const hb = data.data?.handbook || {}
    out.handbook = { sections: hb.sections || [], logo: hb.logo || '', sponsors: hb.sponsors || [] }
  }
  return Response.json(out)
}

export async function POST(request) {
  const supabase = admin()
  if (!supabase) return Response.json({ error: 'Not configured' }, { status: 500 })

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Bad request' }, { status: 400 }) }

  const tournamentId = String(body.tournamentId || '')
  const name = String(body.name || '').trim().slice(0, 120)
  if (!tournamentId || !name) return Response.json({ error: 'Name is required' }, { status: 400 })

  // Only accept a sign-up when the form is open for that tournament.
  const { data: t, error: te } = await supabase.from('tournaments').select('signup_open').eq('id', tournamentId).maybeSingle()
  if (te) return Response.json({ error: te.message }, { status: 500 })
  if (!t) return Response.json({ error: 'Tournament not found' }, { status: 404 })
  if (!t.signup_open) return Response.json({ error: 'Sign-ups are closed for this tournament.' }, { status: 403 })

  const clip = (v, n = 200) => String(v || '').trim().slice(0, n)
  const row = {
    tournament_id: tournamentId,
    name,
    email: clip(body.email, 160),
    phone: clip(body.phone, 40),
    status: 'pending',
    data: {
      org: clip(body.org),
      committee: clip(body.committee),
      shift: clip(body.shift, 40),
      shirt: clip(body.shirt, 8),
      availability: clip(body.availability, 300),
      notes: clip(body.notes, 600),
    },
  }
  const { error } = await supabase.from('tournament_signups').insert(row)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
