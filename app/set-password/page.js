'use client'

// "Create your password" — where an invited user lands after clicking the link
// in their email. The link already signed them in (via /auth/confirm), so here
// they just choose a password. If there's no session (expired or reused link),
// we say so instead of silently failing.
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function SetPasswordPage() {
  const router = useRouter()
  // Create the browser client lazily (only in the browser), so the page can be
  // prerendered at build time without the Supabase env vars being present.
  const supabaseRef = useRef(null)
  const getSupabase = () => {
    if (!supabaseRef.current) supabaseRef.current = createClient()
    return supabaseRef.current
  }
  const [ready, setReady] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    getSupabase().auth.getUser().then(({ data }) => { setHasSession(!!data?.user); setReady(true) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    if (pw.length < 8) { setErr('Use at least 8 characters.'); return }
    if (pw !== pw2) { setErr('The two passwords don’t match.'); return }
    setBusy(true)
    const { error } = await getSupabase().auth.updateUser({ password: pw })
    setBusy(false)
    if (error) { setErr('Could not set the password — the link may have expired. Ask for a new one.'); return }
    setDone(true)
    setTimeout(() => router.replace('/'), 1200)
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 font-body" style={{ backgroundColor: 'var(--forest)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <p className="font-display text-[11px] tracking-[0.28em] uppercase" style={{ color: 'var(--gold)' }}>Congressional Country Club</p>
          <h1 className="font-display text-3xl font-semibold text-white mt-1">Grounds Operations</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6">
          {!ready ? (
            <p className="font-body text-sm text-slate-400 text-center py-4">Loading…</p>
          ) : done ? (
            <p className="font-body text-sm text-slate-700 text-center py-4">Password set — signing you in…</p>
          ) : !hasSession ? (
            <div className="text-center">
              <p className="font-display text-base font-semibold text-slate-900 mb-1">This link isn’t active</p>
              <p className="font-body text-sm text-slate-500 mb-4">It may have expired or already been used. Ask your supervisor to resend your invite.</p>
              <a href="/login" className="inline-block font-body text-sm font-bold py-2.5 px-5 rounded-xl text-white" style={{ backgroundColor: 'var(--forest)' }}>Go to sign in</a>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <p className="font-display text-base font-semibold text-slate-900">Create your password</p>
              <div>
                <label htmlFor="pw" className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">New password</label>
                <input id="pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body focus:outline-none focus:ring-2" style={{ '--tw-ring-color': 'var(--fern)' }} placeholder="At least 8 characters" />
              </div>
              <div>
                <label htmlFor="pw2" className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Confirm password</label>
                <input id="pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body focus:outline-none focus:ring-2" style={{ '--tw-ring-color': 'var(--fern)' }} placeholder="••••••••" />
              </div>
              {err && <p className="font-body text-sm text-red-600">{err}</p>}
              <button type="submit" disabled={busy} className="w-full font-body text-sm font-bold py-2.5 rounded-xl text-white transition disabled:opacity-50" style={{ backgroundColor: 'var(--forest)' }}>{busy ? 'Saving…' : 'Set password & sign in'}</button>
            </form>
          )}
        </div>
      </div>
    </main>
  )
}
