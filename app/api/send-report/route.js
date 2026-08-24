// ════════════════════════════════════════════════════════════════════════
//  Weekly report email — server route.
//
//  Emails the weekly turf & spray report (PDF attachment) to an assistant in
//  one click, using Resend (https://resend.com) over its REST API — no npm
//  package required, just a fetch.
//
//  Setup (one time), all in Vercel → Project → Settings → Environment
//  Variables, then redeploy:
//    • RESEND_API_KEY   — from resend.com (free tier is plenty)
//    • REPORT_FROM_EMAIL — a verified sender, e.g. "Turf App <turf@yourclub.org>".
//        Resend requires the domain to be verified before it will send to
//        outside addresses. For a first test you can use "onboarding@resend.dev",
//        but that only delivers to the email on your own Resend account.
//
//  Keys stay server-side. Never expose them with a NEXT_PUBLIC_ prefix.
// ════════════════════════════════════════════════════════════════════════
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(request) {
  const key = process.env.RESEND_API_KEY
  const from = process.env.REPORT_FROM_EMAIL
  if (!key || !from) {
    return Response.json({ ok: false, error: 'email_not_configured' }, { status: 501 })
  }

  let body
  try { body = await request.json() } catch { return Response.json({ ok: false, error: 'bad_request' }, { status: 400 }) }
  const { to, subject, text, filename, pdfBase64 } = body || {}
  if (!to) return Response.json({ ok: false, error: 'no_recipient' }, { status: 400 })

  const payload = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject: subject || 'Weekly Turf & Spray Report',
    text: text || 'The weekly report is attached.',
  }
  if (pdfBase64 && filename) {
    payload.attachments = [{ filename, content: pdfBase64 }]
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) {
      return Response.json({ ok: false, error: j?.message || `send_failed_${res.status}` }, { status: res.status })
    }
    return Response.json({ ok: true, id: j?.id })
  } catch (e) {
    return Response.json({ ok: false, error: 'network_error' }, { status: 502 })
  }
}
