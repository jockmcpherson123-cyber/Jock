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
  const [values, setValues] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [doneName, setDoneName] = useState('')
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

  const fields = info?.form || []
  const setVal = (id, v) => setValues((prev) => ({ ...prev, [id]: v }))

  const submit = async () => {
    // Required-field check.
    for (const f of fields) {
      if ((f.required || f.map === 'name') && !String(values[f.id] || '').trim()) { setErr(`Please fill in “${f.label}”.`); return }
    }
    setSubmitting(true); setErr(null)
    try {
      const res = await fetch('/api/tournament-public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId: tid, values }),
      })
      const d = await res.json()
      if (!res.ok) { setErr(d.error || 'Could not submit. Try again.') }
      else {
        const nameField = fields.find((f) => f.map === 'name')
        setDoneName(String(values[nameField?.id] || '').trim().split(' ')[0] || 'there')
        setDone(true)
      }
    } catch { setErr('Could not submit. Check your connection and try again.') }
    setSubmitting(false)
  }

  const renderField = (f) => {
    const v = values[f.id] || ''
    const label = <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1">{f.label}{(f.required || f.map === 'name') && <span style={{ color: '#B91C1C' }}> *</span>}</label>
    if (f.type === 'textarea') return <div key={f.id}>{label}<textarea value={v} onChange={(e) => setVal(f.id, e.target.value)} rows={3} className={inputCls} style={{ resize: 'vertical' }} /></div>
    if (f.type === 'select') return <div key={f.id}>{label}<select value={v} onChange={(e) => setVal(f.id, e.target.value)} className={inputCls}><option value="">Choose…</option>{(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}</select></div>
    if (f.type === 'yesno') return (
      <div key={f.id}>{label}
        <div className="flex gap-2">
          {['Yes', 'No'].map((o) => (
            <button key={o} type="button" onClick={() => setVal(f.id, o)} className="flex-1 py-2.5 rounded-xl font-semibold border" style={v === o ? { backgroundColor: FERN, color: 'white', borderColor: FERN } : { backgroundColor: 'white', color: '#64748B', borderColor: '#CBD5E1' }}>{o}</button>
          ))}
        </div>
      </div>
    )
    const inputType = f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text'
    return <div key={f.id}>{label}<input type={inputType} value={v} onChange={(e) => setVal(f.id, e.target.value)} className={inputCls} /></div>
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
            {fields.map(renderField)}
            {err && <p className="text-sm text-red-600">{err}</p>}
            <button onClick={submit} disabled={submitting} className="w-full py-3 rounded-full text-white font-bold disabled:opacity-50" style={{ backgroundColor: FOREST }}>{submitting ? 'Submitting…' : 'Submit sign-up'}</button>
          </div>
        )}

        {done && (
          <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
            <div className="w-14 h-14 rounded-full mx-auto flex items-center justify-center mb-3" style={{ backgroundColor: '#E8F3EC' }}>
              <span style={{ color: FERN, fontSize: 30 }}>✓</span>
            </div>
            <p className="text-lg font-bold" style={{ color: FOREST }}>Thanks, {doneName}!</p>
            <p className="text-sm text-slate-500 mt-1">You're signed up. The grounds team will be in touch with your assignment and check-in details.</p>
          </div>
        )}
      </div>
    </div>
  )
}
