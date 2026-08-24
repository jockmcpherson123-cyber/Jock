// ════════════════════════════════════════════════════════════════════════
//  Weekly report email — server route.
//
//  Emails the weekly turf & spray report (PDF attachment) to an assistant in
//  one click. Two ways to send, whichever is configured:
//
//  A) FREE — Gmail (no domain, no cost, sends to anyone):
//     Make a Gmail account, turn on 2-Step Verification, then create an
//     "App password" (Google Account → Security → App passwords). Set in
//     Vercel → Settings → Environment Variables, then redeploy:
//        • GMAIL_USER          — the full gmail address
//        • GMAIL_APP_PASSWORD  — the 16-char app password (not your login one)
//
//  B) Branded — Resend (own domain, ~$12/yr domain; the service is free):
//        • RESEND_API_KEY      — from resend.com
//        • REPORT_FROM_EMAIL   — a verified sender, e.g. "Turf App <turf@yourdomain>"
//
//  Gmail is used when its two vars are set; otherwise Resend. All secrets stay
//  server-side — never expose them with a NEXT_PUBLIC_ prefix.
// ════════════════════════════════════════════════════════════════════════
import nodemailer from 'nodemailer'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(request) {
  const gmailUser = process.env.GMAIL_USER
  const gmailPass = process.env.GMAIL_APP_PASSWORD
  const resendKey = process.env.RESEND_API_KEY
  const resendFrom = process.env.REPORT_FROM_EMAIL
  const useGmail = !!(gmailUser && gmailPass)
  const useResend = !useGmail && !!(resendKey && resendFrom)
  if (!useGmail && !useResend) {
    return Response.json({ ok: false, error: 'email_not_configured' }, { status: 501 })
  }

  let body
  try { body = await request.json() } catch { return Response.json({ ok: false, error: 'bad_request' }, { status: 400 }) }
  const { to, subject, text, filename, pdfBase64, fromName, replyTo } = body || {}
  if (!to) return Response.json({ ok: false, error: 'no_recipient' }, { status: 400 })

  const recipients = Array.isArray(to) ? to : [to]
  const subj = subject || 'Weekly Turf & Spray Report'
  const bodyText = text || 'The weekly report is attached.'
  const cleanName = fromName ? String(fromName).replace(/[<>"]/g, '').trim() : null

  // ── Gmail (free) ──────────────────────────────────────────────────────────
  if (useGmail) {
    try {
      const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } })
      await transporter.sendMail({
        from: cleanName ? `"${cleanName}" <${gmailUser}>` : gmailUser,
        to: recipients,
        subject: subj,
        text: bodyText,
        replyTo: replyTo || undefined,
        attachments: (pdfBase64 && filename) ? [{ filename, content: pdfBase64, encoding: 'base64', contentType: 'application/pdf' }] : [],
      })
      return Response.json({ ok: true, via: 'gmail' })
    } catch (e) {
      return Response.json({ ok: false, error: e?.message || 'gmail_send_failed' }, { status: 502 })
    }
  }

  // ── Resend (branded domain) ──────────────────────────────────────────────
  const addressMatch = String(resendFrom).match(/<([^>]+)>/)
  const address = addressMatch ? addressMatch[1] : String(resendFrom).trim()
  const fromField = cleanName ? `${cleanName} <${address}>` : resendFrom
  const payload = { from: fromField, to: recipients, subject: subj, text: bodyText }
  if (replyTo) payload.reply_to = replyTo
  if (pdfBase64 && filename) payload.attachments = [{ filename, content: pdfBase64 }]

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) return Response.json({ ok: false, error: j?.message || `send_failed_${res.status}` }, { status: res.status })
    return Response.json({ ok: true, id: j?.id, via: 'resend' })
  } catch (e) {
    return Response.json({ ok: false, error: 'network_error' }, { status: 502 })
  }
}
