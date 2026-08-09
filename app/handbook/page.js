'use client'

// Public volunteer handbook — a phone-friendly read-only view. Volunteers open
// it from the link/QR in Setup. Reads the tournament id from the URL (?t=…) and
// pulls the handbook via the public API (no login required).
import { useEffect, useState } from 'react'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#C9A84C'

export default function HandbookPage() {
  const [info, setInfo] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('t')
    if (!t) { setErr('This handbook link is missing its tournament.'); return }
    fetch(`/api/tournament-public?t=${encodeURIComponent(t)}&handbook=1`)
      .then((r) => r.json())
      .then((d) => { if (d.error) setErr(d.error); else setInfo(d) })
      .catch(() => setErr('Could not load the handbook.'))
  }, [])

  const hb = info?.handbook || {}
  const sections = hb.sections || []
  const logo = hb.logo || ''
  const accent = hb.theme?.color || FOREST
  const sponsors = (hb.sponsors || []).filter((s) => s && s.src)
  const schedule = (hb.schedule || []).filter((d) => d && (d.day || (d.rows || []).length))
  const bc = hb.backCover || {}

  const TIERS = ['Platinum', 'Gold', 'Silver', 'Bronze', 'Industry Partner']
  const groups = [...TIERS.map((t) => ({ tier: t, list: sponsors.filter((s) => s.tier === t) })), { tier: 'Sponsors', list: sponsors.filter((s) => !TIERS.includes(s.tier)) }].filter((g) => g.list.length)

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F1F5F3' }} className="py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-6">
          {logo && <img src={logo} alt="" className="mx-auto mb-3 max-h-24 object-contain" />}
          <p className="text-[11px] tracking-[0.25em] uppercase font-bold" style={{ color: GOLD }}>Volunteer Handbook</p>
          <h1 className="text-2xl font-bold mt-1" style={{ color: accent }}>{info?.name || 'Tournament'}</h1>
        </div>

        {err && <div className="bg-white rounded-2xl p-6 text-center text-slate-600 shadow-sm">{err}</div>}
        {!err && info && sections.length === 0 && <div className="bg-white rounded-2xl p-6 text-center text-slate-500 shadow-sm">The handbook hasn't been published yet. Check back soon.</div>}

        <div className="space-y-4">
          {sections.map((s, i) => {
            const imgs = s.images || []
            if (s.fullPage) {
              return (
                <div key={i} className="relative rounded-2xl overflow-hidden shadow-sm" style={{ minHeight: 220, backgroundColor: accent }}>
                  {imgs[0] && <img src={imgs[0].src} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                  <div className="relative p-5 pt-24" style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.6))', color: '#fff' }}>
                    <h2 className="text-xl font-bold">{s.title}</h2>
                    {s.body && <p className="text-sm mt-1 opacity-90">{s.body}</p>}
                  </div>
                </div>
              )
            }
            return (
              <div key={i} className="bg-white rounded-2xl p-5 shadow-sm">
                <h2 className="text-lg font-bold mb-3" style={{ color: accent, borderBottom: `2px solid ${GOLD}`, paddingBottom: 4 }}>{s.title}</h2>
                {imgs[0] && (
                  <figure className="mb-3">
                    <img src={imgs[0].src} alt="" className="w-full rounded-xl" />
                    {imgs[0].caption && <figcaption className="text-xs italic mt-1" style={{ color: FERN }}>{imgs[0].caption}</figcaption>}
                  </figure>
                )}
                <p className="text-[15px] leading-relaxed text-slate-700 whitespace-pre-wrap">{s.body}</p>
                {imgs.length > 1 && (
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    {imgs.slice(1).map((im, k) => (
                      <figure key={k}>
                        <img src={im.src} alt="" className="w-full rounded-lg" />
                        {im.caption && <figcaption className="text-[11px] italic mt-1" style={{ color: FERN }}>{im.caption}</figcaption>}
                      </figure>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {schedule.length > 0 && (
          <div className="bg-white rounded-2xl p-5 shadow-sm mt-4">
            <h2 className="text-lg font-bold mb-3 text-center" style={{ color: accent }}>Schedule</h2>
            {schedule.map((d, di) => (
              <div key={di} className="mb-4">
                <p className="font-bold text-center mb-1" style={{ color: accent }}>{d.day}</p>
                {(d.rows || []).filter((r) => r && (r.time || r.activity)).map((r, ri) => (
                  <div key={ri} className="flex gap-3 py-1 border-b border-dashed border-slate-200 last:border-0">
                    <span className="w-28 shrink-0 text-right text-[13px] font-bold text-slate-600">{r.time}</span>
                    <span className="text-[13px] text-slate-700">{r.activity}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {groups.length > 0 && (
          <div className="bg-white rounded-2xl p-5 shadow-sm mt-4">
            <h2 className="text-lg font-bold mb-4 text-center" style={{ color: accent }}>With Thanks to Our Sponsors</h2>
            {groups.map((g, gi) => (
              <div key={gi} className="mb-4">
                <p className="text-[11px] font-bold uppercase tracking-[2px] text-center mb-2" style={{ color: accent }}>{g.tier}</p>
                <div className="grid grid-cols-3 gap-3">
                  {g.list.map((sp, k) => (
                    <div key={k} className="text-center">
                      <div className="rounded-lg border border-slate-200 bg-white p-2 flex items-center justify-center" style={{ height: 72 }}>
                        <img src={sp.src} alt={sp.name || ''} className="max-h-full max-w-full object-contain" />
                      </div>
                      {sp.name && <div className="text-[11px] text-slate-500 mt-1">{sp.name}</div>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {(bc.message || bc.presentedByLogo || bc.presentedByText) && sections.length > 0 && (
          <div className="rounded-2xl p-6 mt-4 text-center" style={{ backgroundColor: accent, color: '#fff' }}>
            <p className="text-lg font-bold">{bc.message || 'Thank you for volunteering.'}</p>
            {(bc.presentedByLogo || bc.presentedByText) && (
              <div className="mt-4">
                <p className="text-[10px] font-bold uppercase tracking-[3px]" style={{ color: GOLD }}>Presented by</p>
                {bc.presentedByLogo
                  ? <img src={bc.presentedByLogo} alt="" className="mx-auto mt-2 max-h-14 object-contain bg-white rounded p-1.5" />
                  : <p className="text-base font-bold mt-1">{bc.presentedByText}</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
