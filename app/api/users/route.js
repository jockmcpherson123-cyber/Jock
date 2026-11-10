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
import { sendEmail, emailConfigured } from '@/lib/email'

// Best-effort login URL for the invite email.
function siteUrl(request) {
  const env = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
  if (env) return env.replace(/\/$/, '')
  try { return new URL(request.url).origin } catch { return '' }
}

export const dynamic = 'force-dynamic'

const ROLES = ['operator', 'assistant', 'superintendent', 'director']
// Roles that can manage the app and its logins (everyone but plain operators).
const MANAGE_ROLES = ['assistant', 'superintendent', 'director']

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

// A signed-in manager (assistant/superintendent/director) may manage users.
// Returns { me, db } or an error.
async function gate() {
  const me = await getUser()
  if (!me) return { error: 'Please sign in.', status: 401 }
  if (!MANAGE_ROLES.includes(me.role)) return { error: 'You need a management role to manage users.', status: 403 }
  const db = admin()
  if (!db) return { error: 'User management is not set up (missing SUPABASE_SERVICE_ROLE_KEY).', status: 503 }
  return { me, db }
}

function randomPassword() {
  return 'Grounds-' + Math.random().toString(36).slice(2, 8) + Math.floor(10 + Math.random() * 90)
}

// How many users can still manage logins — so we never lock everyone out.
async function managerCount(db) {
  const { count } = await db.from('profiles').select('id', { count: 'exact', head: true }).in('role', MANAGE_ROLES)
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
  // Create the account and a one-time link the person uses to set their OWN
  // password — no password is ever created or emailed in the clear.
  const { data: gen, error } = await db.auth.admin.generateLink({
    type: 'invite', email, options: { data: { full_name: fullName || email } },
  })
  if (error) {
    const msg = /already|registered|exists/i.test(error.message || '') ? 'A user with that email already exists.' : 'Could not create the user.'
    return Response.json({ error: msg }, { status: 400 })
  }
  const id = gen?.user?.id
  const hash = gen?.properties?.hashed_token
  if (id) await db.from('profiles').update({ role, full_name: fullName || email }).eq('id', id)
  await addToPeople(db, fullName, role)

  const base = siteUrl(request)
  const inviteLink = hash && base ? `${base}/auth/confirm?token_hash=${encodeURIComponent(hash)}&type=invite&next=/set-password` : null

  // Email the link through the club's own email (Gmail/Resend), if configured.
  let emailed = false, emailError = null
  if (body.notify !== false && emailConfigured() && inviteLink) {
    const who = fullName || 'there'
    const text = `Hi ${who},\n\nYou've been given access to the Congressional Grounds Ops app.\n\n` +
      `Click this link to set your password and sign in:\n${inviteLink}\n\n` +
      `The link is one-time and expires. If you weren't expecting this, let your supervisor know.`
    const r = await sendEmail({ to: email, subject: 'Set up your Congressional Grounds Ops login', text, fromName: 'Congressional Grounds Ops' })
    emailed = !!r.ok
    if (!r.ok) emailError = r.error
  }
  return Response.json({ ok: true, id, email, emailed, emailError, emailConfigured: emailConfigured(), inviteLink })
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
    // Don't let the last manager drop to operator and strand the club with
    // nobody who can manage logins. (Switching between manager roles is fine.)
    if (!MANAGE_ROLES.includes(body.role)) {
      const { data: cur } = await db.from('profiles').select('role').eq('id', id).maybeSingle()
      if (MANAGE_ROLES.includes(cur?.role) && (await managerCount(db)) <= 1) {
        return Response.json({ error: 'Make someone else a manager before removing the last one.' }, { status: 400 })
      }
    }
    const { error } = await db.from('profiles').update({ role: body.role }).eq('id', id)
    if (error) return Response.json({ error: 'Could not change the role.' }, { status: 502 })
  }
  if (body.password !== undefined) {
    const pw = String(body.password || '').trim() || randomPassword()
    const { error } = await db.auth.admin.updateUserById(id, { password: pw })
    if (error) return Response.json({ error: 'Could not reset the password.' }, { status: 502 })
    let emailed = false
    if (body.notify !== false && emailConfigured()) {
      const { data: u } = await db.auth.admin.getUserById(id)
      const addr = u?.user?.email
      if (addr) {
        const link = siteUrl(request)
        const text = `Your password for the Congressional Grounds Ops app was reset.\n\n` +
          `Sign in at: ${link || '(ask your supervisor for the link)'}\nEmail: ${addr}\nNew temporary password: ${pw}\n\nPlease sign in and change it.`
        const r = await sendEmail({ to: addr, subject: 'Your Grounds Ops password was reset', text, fromName: 'Congressional Grounds Ops' })
        emailed = !!r.ok
      }
    }
    return Response.json({ ok: true, tempPassword: pw, emailed })
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
  if (MANAGE_ROLES.includes(cur?.role) && (await managerCount(db)) <= 1) {
    return Response.json({ error: 'Make someone else a manager before removing the last one.' }, { status: 400 })
  }
  const { error } = await db.auth.admin.deleteUser(id) // profile cascades
  if (error) return Response.json({ error: 'Could not remove the user.' }, { status: 502 })
  return Response.json({ ok: true })
}
