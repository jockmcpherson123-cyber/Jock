'use client'

// Public, no-login phone view for ONE crew member — the target of their personal
// "My Jobs" QR. Shows only that person's jobs for today, in slot order, with the
// note and equipment, translated to their language. A Done tick per job updates
// the status only — no hours, ever. The club key + the person's name ride in the
// link (?k=...&p=Name).
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { loadTranslations, txGet } from '@/lib/translate'
import { toEs } from '@/lib/es'
import { localDateISO } from '@/lib/dates'
import { FOREST, FERN, GOLD } from '@/lib/theme'

const SLOT_LABELS = { '1': '1st Jobs', '2': '2nd Jobs', '3': '3rd Jobs', '4': '4th Jobs' }
const SLOT_ES = { '1': 'Trabajos 1', '2': 'Trabajos 2', '3': 'Trabajos 3', '4': 'Trabajos 4' }
const slotRank = (s) => ['1', '2', '3', '4'].indexOf(String(s || '1'))
const prettyDay = (d, es) => new Date(`${d}T00:00:00`).toLocaleDateString(es ? 'es-ES' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' })

function Me() {
  const sp = useSearchParams()
  const k = sp.get('k')
  const person = sp.get('p') || ''
  const [tasks, setTasks] = useState([])
  const [crew, setCrew] = useState({})
  const [club, setClub] = useState('')
  const [jobPpe, setJobPpe] = useState({})
  const [tx, setTx] = useState({})
  const [state, setState] = useState('loading') // loading | ok | denied | error
  const [lang, setLang] = useState('en')
  const [saving, setSaving] = useState({})
  const date = localDateISO()
  const es = lang === 'es'
  const T = (en, esT) => (es ? esT : en)
  const D = (x) => (x ? (txGet(tx, es ? 'es' : crew[person]?.lang, x) || (es ? toEs(x) : x)) : '')

  const load = useCallback(async () => {
    if (!k || !person) { setState('denied'); return }
    try {
      const r = await fetch(`/api/crew?view=board&k=${encodeURIComponent(k)}&date=${date}`, { cache: 'no-store' })
      if (r.status === 401) { setState('denied'); return }
      if (!r.ok) throw new Error()
      const j = await r.json()
      setTasks((j.tasks || []).filter((t) => t.assignee === person))
      setCrew(j.crew || {})
      setClub(j.club || '')
      setJobPpe((j.courseInfo && j.courseInfo.jobPpe) || {})
      setState('ok')
    } catch { setState('error') }
  }, [k, person, date])
  useEffect(() => { load() }, [load])

  // Default the page to the person's own language the first time we know it.
  useEffect(() => { if (crew[person]?.lang && crew[person].lang !== 'en') setLang('es') }, [crew, person])

  // Translate this person's jobs (AI, cached) — fall back to the built-in es dict.
  useEffect(() => {
    let cancelled = false
    const forced = { [person]: { ...(crew[person] || {}), lang: es ? 'es' : (crew[person]?.lang || 'en') } }
    loadTranslations(tasks, forced).then((m) => { if (!cancelled) setTx(m) }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, lang])

  const bySlot = useMemo(() => {
    const m = {}
    tasks.forEach((t) => { const s = t.slot || '1'; (m[s] = m[s] || []).push(t) })
    Object.values(m).forEach((l) => l.sort((a, b) => (a.sort || 0) - (b.sort || 0)))
    return m
  }, [tasks])
  const slots = Object.keys(bySlot).sort((a, b) => slotRank(a) - slotRank(b))
  const doneCount = tasks.filter((t) => t.status === 'done').length

  const toggleDone = async (t) => {
    const next = t.status === 'done' ? 'todo' : 'done'
    setSaving((s) => ({ ...s, [t.id]: true }))
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: next } : x)))
    try {
      await fetch('/api/crew', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'setstatus', k, taskId: t.id, status: next }) })
    } catch { /* keep optimistic; a reload will reconcile */ }
    finally { setSaving((s) => { const n = { ...s }; delete n[t.id]; return n }) }
  }

  if (state === 'loading') return <Center>Loading…</Center>
  if (state === 'denied') return <Center>This link is invalid or expired.<br />Ask for a fresh QR code.</Center>
  if (state === 'error') return <Center>Couldn’t load your jobs. Try again.</Center>

  return (
    <div style={{ minHeight: '100vh', background: '#EEF1EE' }}>
      <div style={{ background: FOREST }} className="text-white px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            {club && <p className="font-body text-[10px] tracking-[0.22em] uppercase truncate" style={{ color: GOLD }}>{club}</p>}
            <p className="font-display text-lg font-semibold truncate">{person || (es ? 'Mis Trabajos' : 'My Jobs')}</p>
            <p className="font-body text-[11px] capitalize" style={{ color: '#C7CFC2' }}>{prettyDay(date, es)}</p>
          </div>
          <div className="flex gap-1.5 shrink-0">
            {[['en', 'EN'], ['es', 'ES']].map(([code, label]) => (
              <button key={code} onClick={() => setLang(code)} className="font-body text-xs font-bold px-3 py-1.5 rounded-full" style={lang === code ? { backgroundColor: GOLD, color: FOREST } : { backgroundColor: 'rgba(255,255,255,0.12)', color: 'white' }}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-3 py-3">
        {tasks.length === 0 ? (
          <p className="font-body text-sm text-slate-400 text-center py-16">{T('No jobs posted for you today.', 'No tienes trabajos hoy.')}</p>
        ) : (
          <>
            <p className="font-body text-[12px] font-semibold text-slate-500 mb-2">{doneCount}/{tasks.length} {T('done', 'hechos')}</p>
            {slots.map((s) => (
              <div key={s} className="mb-4">
                {slots.length > 1 && <p className="font-body text-[11px] font-extrabold uppercase tracking-wider mb-1.5" style={{ color: FERN }}>{es ? SLOT_ES[s] : SLOT_LABELS[s]}</p>}
                <div className="space-y-2">
                  {bySlot[s].map((t) => {
                    const done = t.status === 'done'
                    const tools = (t.equipment || '').split(',').map((x) => x.trim()).filter(Boolean).map((tool) => D(tool))
                    const note = t.notes ? D(t.notes) : ''
                    const groupNote = t.groupNote ? D(t.groupNote) : ''
                    const ppe = jobPpe[t.job] || []
                    return (
                      <div key={t.id} className="bg-white rounded-2xl border shadow-sm overflow-hidden" style={{ borderColor: done ? '#CDE7D4' : 'rgba(0,0,0,0.06)', opacity: done ? 0.7 : 1 }}>
                        <div className="flex items-start gap-3 p-3">
                          <button onClick={() => toggleDone(t)} disabled={!!saving[t.id]} aria-label={done ? 'Mark not done' : 'Mark done'}
                            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-bold text-lg transition" style={done ? { backgroundColor: FERN, color: 'white' } : { backgroundColor: 'white', color: '#CBD5E1', border: '2px solid #CBD5E1' }}>✓</button>
                          <div className="min-w-0 flex-1">
                            <p className="font-body text-[15px] font-bold" style={{ color: '#1A2A1F', textDecoration: done ? 'line-through' : 'none' }}>{D(t.job)}</p>
                            {groupNote && <p className="font-body text-[12px] mt-0.5" style={{ color: '#8A5A12' }}>{groupNote}</p>}
                            {note && <p className="font-body text-[13px] font-semibold mt-0.5" style={{ color: FERN }}>{note}</p>}
                            {tools.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {tools.map((tool, i) => <span key={i} className="font-body text-[11px] px-2 py-0.5 rounded-full" style={{ backgroundColor: '#F1F5F3', color: '#57756A' }}>{tool}</span>)}
                              </div>
                            )}
                            {ppe.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1 mt-1.5">
                                <span className="font-body text-[10px] font-bold uppercase tracking-wide" style={{ color: '#B45309' }}>{T('PPE', 'EPP')}:</span>
                                {ppe.map((p, i) => <span key={i} className="font-body text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#FEF3C7', color: '#92660D' }}>{D(p)}</span>)}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function Center({ children }) {
  return <div style={{ minHeight: '100vh', background: '#EEF1EE' }} className="flex items-center justify-center text-center px-6"><p className="font-body text-sm text-slate-400">{children}</p></div>
}

export default function Page() {
  return <Suspense fallback={<Center>Loading…</Center>}><Me /></Suspense>
}
