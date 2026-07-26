// ════════════════════════════════════════════════════════════════════════
//  License expiry email alerts — a scheduled check.
//
//  Vercel Cron hits this route once a day (see vercel.json). It reads the
//  applicator licenses, finds any that are expired or expiring within 30 days,
//  and emails a summary. It's a safe no-op until you set the env vars, so
//  nothing happens (and nothing errors) until you switch it on.
//
//  SETUP (once, all in Vercel → Settings → Environment Variables):
//    • RESEND_API_KEY          — from resend.com (free tier). Sends the email.
//    • LICENSE_ALERT_EMAIL     — who to notify (e.g. you). Comma-separate for many.
//    • LICENSE_ALERT_FROM      — optional. A verified Resend sender; defaults to
//                                onboarding@resend.dev (fine for testing).
//    • SUPABASE_SERVICE_ROLE_KEY — from Supabase → Project Settings → API.
//                                Lets this server job read your settings.
//    • CRON_SECRET             — optional. If set, the request must include it.
// ════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function statusFor(exp) {
  if (!exp) return null
  const days = Math.round((new Date(exp + 'T00:00:00').getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000)
  if (days < 0) return { level: 'expired', days, text: `expired ${-days} day(s) ago` }
  if (days <= 30) return { level: 'soon', days, text: `expires in ${days} day(s)` }
  return null
}

export async function GET(request) {
  // Optional shared-secret gate (Vercel Cron sends it as a Bearer token).
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization') || ''
    if (auth !== `Bearer ${secret}`) return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const resendKey = process.env.RESEND_API_KEY
  const to = (process.env.LICENSE_ALERT_EMAIL || '').split(',').map((s) => s.trim()).filter(Boolean)
  const from = process.env.LICENSE_ALERT_FROM || 'onboarding@resend.dev'

  if (!url || !serviceKey) return Response.json({ ok: true, skipped: 'Supabase not configured' })
  if (!resendKey || to.length === 0) return Response.json({ ok: true, skipped: 'Email not configured' })

  const supabase = createClient(url, serviceKey)
  const { data, error } = await supabase.from('app_settings').select('applicator_licenses').eq('id', 1).maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const licenses = data?.applicator_licenses || {}
  const alerts = []
  for (const [name, lic] of Object.entries(licenses)) {
    for (const type of ['pesticide', 'fertilizer']) {
      const st = statusFor(lic[`${type}Exp`])
      if (st) alerts.push({ name, type, ...st, date: lic[`${type}Exp`] })
    }
  }
  if (alerts.length === 0) return Response.json({ ok: true, alerts: 0 })

  alerts.sort((a, b) => a.days - b.days)
  const rows = alerts.map((a) => `<li><b>${a.name}</b> — ${a.type} license ${a.text} (${a.date})</li>`).join('')
  const html = `<div style="font-family:Arial,sans-serif"><h2>Applicator license reminder</h2><p>The following licenses need attention:</p><ul>${rows}</ul><p style="color:#888;font-size:12px">Automated reminder from your Grounds app.</p></div>`

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject: `⚠ ${alerts.length} applicator license(s) need attention`, html }),
  })
  if (!res.ok) {
    const body = await res.text()
    return Response.json({ error: 'email failed', detail: body }, { status: 502 })
  }
  return Response.json({ ok: true, alerts: alerts.length, emailed: to })
}
