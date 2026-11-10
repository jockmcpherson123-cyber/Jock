// ════════════════════════════════════════════════════════════════════════
//  User management — server route (Directors only).
//
//  Lets a Director create logins, change roles, reset passwords and remove
//  users from inside the app, instead of the Supabase dashboard. Account
//  creation needs admin rights, so it runs here with the service-role key
//  (server-side only, never the browser). Every handler verifies the CALLER is
//  a director first, so an operator/superintendent can't make accounts or
//  promote themselves.
// ════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js'
import { getUser } from '@/lib/getUser'

export const dynamic = 'force-dynamic'

const ROLES = ['operator', 'superintendent', 'director']

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

// Only a signed-in Director may manage users. Returns { me, db } or an error.
async function gate() {
  const me = await getUser()
  if (!me) return { error: 'Please sign in.', status: 401 }
  if (me.role !== 'director') return { error: 'Only a Director can manage users.', status: 403 }
  const db = admin()
  if (!db) return { error: 'User management is not set up (missing SUPABASE_SERVICE_ROLE_KEY).', status: 503 }
  return { me, db }
}

function randomPassword() {
  return 'Grounds-' + Math.random().toString(36).slice(2, 8) + Math.floor(10 + Math.random() * 90)
}

// How many directors exist — so we never strand the club with none.
async function directorCount(db) {
  const { count } = await db.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'director')
  return count || 0
}

// Add a person's name to the People lists so they show in the sheet pickers.
async function addToPeople(db, name, role) {
  if (!name) return
  const { data } = await db.from('app_settings').select('operators, directors').eq('id', 1).maybeSingle()
  const ops = Array.isArray(data?.operators) ? data.operators : []
  const dirs = Array.isArray(data?.directors) ? data.directors : []
  const patch = {}
  if (!ops.includes(name)) patch.operators = [...ops, name]
  if (role === 'director' && !dirs.includes(name)) patch.directors = [...dirs, name]
  if (Object.keys(patch).length) await db.from('app_settings').update(patch).eq('id', 1)
}

export async function GET() {
  const g = await gate()
  if (g.error) return Response.json({ error: g.error }, { status: g.status })
  const { db } = g
  const { data: list, error } = await db.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (error) return Response.json({ error: 'Could not load users.' }, { status: 502 })
  const { data: profiles } = await db.from('profiles').select('id, full_name, role')
  const byId = {}
  ;(profiles || []).forEach((p) => { byId[p.id] = p })
  const users = (list?.users || []).map((u) => ({
    id: u.id,
    email: u.email,
    fullName: byId[u.id]?.full_name || u.user_metadata?.full_name || u.email,
    role: byId[u.id]?.role || 'operator',
    lastSignIn: u.last_sign_in_at || null,
    createdAt: u.created_at || null,
  })).sort((a, b) => a.fullName.localeCompare(b.fullName))
  return Response.json({ users })
}

export async function POST(request) {
  const g = await gate()
  if (g.error) return Response.json({ error: g.error }, { status: g.status })
  const { db } = g
  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Bad request.' }, { status: 400 }) }
  const email = String(body.email || '').trim().toLowerCase()
  const fullName = String(body.fullName || '').trim()
  const role = ROLES.includes(body.role) ? body.role : 'operator'
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Response.json({ error: 'Enter a valid email.' }, { status: 400 })
  const password = String(body.password || '').trim() || randomPassword()

  const { data: created, error } = await db.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: fullName || email },
  })
  if (error) {
    const msg = /already/i.test(error.message || '') ? 'A user with that email already exists.' : 'Could not create the user.'
    return Response.json({ error: msg }, { status: 400 })
  }
  const id = created?.user?.id
  // The signup trigger makes the profile row; set the chosen role + name.
  if (id) await db.from('profiles').update({ role, full_name: fullName || email }).eq('id', id)
  await addToPeople(db, fullName, role)
  return Response.json({ ok: true, id, email, tempPassword: password })
}

export async function PATCH(request) {
  const g = await gate()
  if (g.error) return Response.json({ error: g.error }, { status: g.status })
  const { me, db } = g
  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Bad request.' }, { status: 400 }) }
  const id = String(body.id || '')
  if (!id) return Response.json({ error: 'Missing user.' }, { status: 400 })

  if (body.role !== undefined) {
    if (!ROLES.includes(body.role)) return Response.json({ error: 'Unknown role.' }, { status: 400 })
    // Don't let the last director (or yourself) drop out of the director role
    // and strand the club with nobody who can approve.
    if (body.role !== 'director') {
      const { data: cur } = await db.from('profiles').select('role').eq('id', id).maybeSingle()
      if (cur?.role === 'director' && (await directorCount(db)) <= 1) {
        return Response.json({ error: 'Add another Director before removing the last one.' }, { status: 400 })
      }
    }
    const { error } = await db.from('profiles').update({ role: body.role }).eq('id', id)
    if (error) return Response.json({ error: 'Could not change the role.' }, { status: 502 })
  }
  if (body.password !== undefined) {
    const pw = String(body.password || '').trim() || randomPassword()
    const { error } = await db.auth.admin.updateUserById(id, { password: pw })
    if (error) return Response.json({ error: 'Could not reset the password.' }, { status: 502 })
    return Response.json({ ok: true, tempPassword: pw })
  }
  return Response.json({ ok: true })
}

export async function DELETE(request) {
  const g = await gate()
  if (g.error) return Response.json({ error: g.error }, { status: g.status })
  const { me, db } = g
  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Bad request.' }, { status: 400 }) }
  const id = String(body.id || '')
  if (!id) return Response.json({ error: 'Missing user.' }, { status: 400 })
  if (id === me.id) return Response.json({ error: "You can't remove your own account." }, { status: 400 })
  const { data: cur } = await db.from('profiles').select('role').eq('id', id).maybeSingle()
  if (cur?.role === 'director' && (await directorCount(db)) <= 1) {
    return Response.json({ error: 'Add another Director before removing the last one.' }, { status: 400 })
  }
  const { error } = await db.auth.admin.deleteUser(id) // profile cascades
  if (error) return Response.json({ error: 'Could not remove the user.' }, { status: 502 })
  return Response.json({ ok: true })
}
