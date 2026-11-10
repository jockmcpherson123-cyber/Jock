// Shared server-side email sender. Uses Gmail when GMAIL_USER + GMAIL_APP_PASSWORD
// are set, otherwise Resend (RESEND_API_KEY + REPORT_FROM_EMAIL). Secrets stay on
// the server. Returns { ok: true, via } or { ok: false, error }.
//
// Used by the weekly-report sender and by user-login invites.
import nodemailer from 'nodemailer'

export function emailConfigured() {
  const useGmail = !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)
  const useResend = !useGmail && !!(process.env.RESEND_API_KEY && process.env.REPORT_FROM_EMAIL)
  return useGmail || useResend
}

export async function sendEmail({ to, subject, text, html, fromName, replyTo, pdfBase64, filename }) {
  const gmailUser = process.env.GMAIL_USER
  const gmailPass = process.env.GMAIL_APP_PASSWORD
  const resendKey = process.env.RESEND_API_KEY
  const resendFrom = process.env.REPORT_FROM_EMAIL
  const useGmail = !!(gmailUser && gmailPass)
  const useResend = !useGmail && !!(resendKey && resendFrom)
  if (!useGmail && !useResend) return { ok: false, error: 'email_not_configured' }
  if (!to) return { ok: false, error: 'no_recipient' }

  const recipients = Array.isArray(to) ? to : [to]
  const subj = subject || 'Grounds Ops'
  const bodyText = text || ''
  const cleanName = fromName ? String(fromName).replace(/[<>"]/g, '').trim() : null
  const attachments = (pdfBase64 && filename) ? [{ filename, content: pdfBase64, encoding: 'base64', contentType: 'application/pdf' }] : []

  if (useGmail) {
    try {
      const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } })
      await transporter.sendMail({
        from: cleanName ? `"${cleanName}" <${gmailUser}>` : gmailUser,
        to: recipients, subject: subj, text: bodyText, html: html || undefined, replyTo: replyTo || undefined, attachments,
      })
      return { ok: true, via: 'gmail' }
    } catch (e) {
      return { ok: false, error: e?.message || 'gmail_send_failed' }
    }
  }

  // Resend
  const addressMatch = String(resendFrom).match(/<([^>]+)>/)
  const address = addressMatch ? addressMatch[1] : String(resendFrom).trim()
  const fromField = cleanName ? `${cleanName} <${address}>` : resendFrom
  const payload = { from: fromField, to: recipients, subject: subj, text: bodyText }
  if (html) payload.html = html
  if (replyTo) payload.reply_to = replyTo
  if (pdfBase64 && filename) payload.attachments = [{ filename, content: pdfBase64 }]
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: j?.message || `send_failed_${res.status}` }
    return { ok: true, id: j?.id, via: 'resend' }
  } catch {
    return { ok: false, error: 'network_error' }
  }
}
