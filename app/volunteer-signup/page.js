'use client'

// Public volunteer sign-up form. No login required — it posts to the
// /api/tournament-public endpoint, which stages the entry for staff to review.
// Reads the tournament id from the URL query (?t=…) on the client so the page
// never needs a Suspense boundary at build time.
import { useEffect, useState } from 'react'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#C9A84C'
const inputCls = 'w-full border border-slate-300 rounded-xl px-3 py-2.5 text-base bg-white'

export default function VolunteerSignup() {
  const [tid, setTid] = useState(null)
  const [info, setInfo] = useState(null)
  const [loadErr, setLoadErr] = useState(null)
  const [form, setForm] = useState({ name: '', email: '', phone: '', org: '', committee: '', shift: '', shirt: '', availability: '', notes: '' })
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('t')
    setTid(t)
    if (!t) { setLoadErr('This sign-up link is missing its tournament.'); return }
    fetch(`/api/tournament-public?t=${encodeURIComponent(t)}`)
      .then((r) => r.json())
      .then((d) => { if (d.error) setLoadErr(d.error); else setInfo(d) })
      .catch(() => setLoadErr('Could not load this tournament.'))
  }, [])

  const submit = async () => {
    if (!form.name.trim()) { setErr('Please enter your name.'); return }
    setSubmitting(true); setErr(null)
    try {
      const res = await fetch('/api/tournament-public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId: tid, ...form }),
      })
      const d = await res.json()
      if (!res.ok) { setErr(d.error || 'Could not submit. Try again.') }
      else setDone(true)
    } catch { setErr('Could not submit. Check your connection and try again.') }
    setSubmitting(false)
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F1F5F3' }} className="py-8 px-4">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-5">
          <p className="text-[11px] tracking-[0.25em] uppercase font-bold" style={{ color: GOLD }}>Volunteer Sign-Up</p>
          <h1 className="text-2xl font-bold mt-1" style={{ color: FOREST }}>{info?.name || 'Tournament'}</h1>
          {info?.location && <p className="text-sm text-slate-500 mt-0.5">{info.location}</p>}
        </div>

        {loadErr && <div className="bg-white rounded-2xl p-6 text-center text-slate-600 shadow-sm">{loadErr}</div>}

        {!loadErr && info && !info.signupOpen && (
          <div className="bg-white rounded-2xl p-6 text-center text-slate-600 shadow-sm">Sign-ups for this tournament are currently closed. Please check back later or contact the grounds team.</div>
        )}

        {!loadErr && info && info.signupOpen && !done && (
          <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
            <p className="text-sm text-slate-500 mb-1">Fill this out and the grounds team will follow up with your assignment and details.</p>
            {[['name', 'Full name *', 'text'], ['email', 'Email', 'email'], ['phone', 'Phone', 'tel'], ['org', 'Club / organization', 'text']].map(([k, label, type]) => (
              <div key={k}>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1">{label}</label>
                <input type={type} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className={inputCls} />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1">Preferred shift</label>
                <input value={form.shift} onChange={(e) => setForm({ ...form, shift: e.target.value })} className={inputCls} placeholder="AM / PM / either" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1">Shirt size</label>
                <input value={form.shirt} onChange={(e) => setForm({ ...form, shirt: e.target.value })} className={inputCls} placeholder="M / L / XL" />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1">What would you like to help with?</label>
              <input value={form.committee} onChange={(e) => setForm({ ...form, committee: e.target.value })} className={inputCls} placeholder="Bunkers, hand watering, anything…" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1">Days available</label>
              <input value={form.availability} onChange={(e) => setForm({ ...form, availability: e.target.value })} className={inputCls} placeholder="Mon–Sun, or specific days" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1">Anything else?</label>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className={inputCls} style={{ resize: 'vertical' }} />
            </div>
            {err && <p className="text-sm text-red-600">{err}</p>}
            <button onClick={submit} disabled={submitting} className="w-full py-3 rounded-full text-white font-bold disabled:opacity-50" style={{ backgroundColor: FOREST }}>{submitting ? 'Submitting…' : 'Submit sign-up'}</button>
          </div>
        )}

        {done && (
          <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
            <div className="w-14 h-14 rounded-full mx-auto flex items-center justify-center mb-3" style={{ backgroundColor: '#E8F3EC' }}>
              <span style={{ color: FERN, fontSize: 30 }}>✓</span>
            </div>
            <p className="text-lg font-bold" style={{ color: FOREST }}>Thanks, {form.name.split(' ')[0]}!</p>
            <p className="text-sm text-slate-500 mt-1">Your sign-up is in. The grounds team will be in touch with your assignment and check-in details.</p>
          </div>
        )}
      </div>
    </div>
  )
}
