'use client'

// Program read — asks the AI agronomist for a decisive take on the club's own
// data (clip trend + growth-reg GDD + forecast). One cheap call, no web search.
// Lives in GDD & Growth; can be echoed onto the Weekly Report via a toggle.
import { useState } from 'react'
import { Sparkles, Loader2, RotateCcw } from 'lucide-react'
import { FOREST, FERN, GOLD, INK, INK_2, INK_3, HAIR, RED } from '@/lib/theme'

export default function ProgramAdvice({ getContext, courseInfo = {}, onSaveCourse }) {
  const saved = courseInfo?.programAdvice && courseInfo.programAdvice.advice ? courseInfo.programAdvice : null
  const [advice, setAdvice] = useState(saved?.advice || null)
  const [at, setAt] = useState(saved?.generatedAt || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const inReport = !!courseInfo?.adviceInReport

  async function run() {
    setBusy(true); setErr('')
    try {
      const context = getContext?.()
      const res = await fetch('/api/turf-advice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Could not get a read.')
      setAdvice(data.advice); setAt(data.generatedAt)
      onSaveCourse?.({ programAdvice: { advice: data.advice, generatedAt: data.generatedAt } })
    } catch (e) { setErr(e.message || 'Something went wrong.') }
    setBusy(false)
  }

  const when = at ? new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''

  return (
    <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <span style={{ width: 26, height: 26, borderRadius: 8, background: FOREST, color: GOLD, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Sparkles size={14} /></span>
          <div>
            <p className="font-display text-base font-semibold" style={{ color: INK }}>Program read <span className="font-body text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: GOLD, border: `1px solid ${GOLD}` }}>AI</span></p>
            <p className="font-body text-[11px]" style={{ color: INK_3 }}>{advice ? `Updated ${when}` : 'A read on your program from the last 3 weeks of data + the forecast'}</p>
          </div>
        </div>
        <button onClick={run} disabled={busy} className="inline-flex items-center gap-1.5 font-body text-[12px] font-bold text-white rounded-lg px-3 py-2 shrink-0" style={{ background: FOREST, opacity: busy ? 0.6 : 1 }}>
          {busy ? <><Loader2 size={13} className="animate-spin" /> Reading…</> : advice ? <><RotateCcw size={12} /> Refresh</> : <><Sparkles size={13} /> Ask AI</>}
        </button>
      </div>

      {err && <p className="font-body text-[12px] mt-2" style={{ color: RED }}>{err}</p>}

      {advice ? (
        <div className="mt-3">
          <p className="font-display text-[17px] font-semibold leading-snug" style={{ color: FOREST }}>{advice.headline}</p>
          {advice.read && <p className="font-body text-[13.5px] leading-relaxed mt-1.5" style={{ color: '#2a302c' }}>{advice.read}</p>}
          {Array.isArray(advice.actions) && advice.actions.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {advice.actions.map((a, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="font-body text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 shrink-0 mt-0.5" style={{ background: '#EEF3EF', color: FERN, minWidth: 62, textAlign: 'center' }}>{a.when || 'Do'}</span>
                  <span className="font-body text-[13px] leading-snug" style={{ color: INK_2 }}>{a.do}</span>
                </div>
              ))}
            </div>
          )}
          {Array.isArray(advice.watch) && advice.watch.length > 0 && (
            <p className="font-body text-[11.5px] mt-3 pt-2 border-t border-black/5" style={{ color: INK_3 }}><b style={{ color: INK_2 }}>Watch:</b> {advice.watch.join(' · ')}</p>
          )}
          <div className="mt-3 flex items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={inReport} onChange={(e) => onSaveCourse?.({ adviceInReport: e.target.checked })} style={{ accentColor: FERN }} />
              <span className="font-body text-[11.5px]" style={{ color: INK_2 }}>Also show this on the Weekly Report</span>
            </label>
            <span className="font-body text-[10px]" style={{ color: INK_3 }}>Decision-support — verify against the label.</span>
          </div>
        </div>
      ) : !busy && (
        <p className="font-body text-[12.5px] mt-2" style={{ color: INK_3 }}>Tap <b style={{ color: INK }}>Ask AI</b> for a plain-English read: is growth getting away, should you tighten the program, and how to time the next spray around the weather.</p>
      )}
    </div>
  )
}
