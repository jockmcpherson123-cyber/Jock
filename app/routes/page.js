'use client'

// Public, no-login phone view of the locked mowing routes — the target of the
// "Mowing Routes" QR. Reads the route config from /api/crew?view=routes and
// shows each mower's greens in mow order, so the crew can check their route on
// their phone instead of the printed cards. The club key rides in the link.
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { labelledLayout } from '@/lib/mowing'
import { localDateISO } from '@/lib/dates'
import { toEs } from '@/lib/es'

// Pick the route layout that best matches today's actual mower count: the exact
// locked set if there is one, otherwise the biggest locked set that isn't over.
function nearestCount(counts, target) {
  if (!counts.length) return null
  if (counts.includes(target)) return target
  const below = counts.filter((c) => c <= target)
  return below.length ? Math.max(...below) : Math.min(...counts)
}

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#C9A84C'
// Per-route accent colours so each mower's card is easy to tell apart.
const ACCENTS = ['#3A6B4A', '#2563EB', '#B45309', '#7C3AED', '#0E7490', '#B91C1C', '#0F766E', '#9333EA']

function Routes() {
  const sp = useSearchParams()
  const k = sp.get('k')
  const [data, setData] = useState(null) // { courses, courseInfo }
  const [state, setState] = useState('loading') // loading | ok | denied | error
  const [courseName, setCourseName] = useState('')
  const [count, setCount] = useState(null)
  const [lang, setLang] = useState('en')
  const es = lang === 'es'

  const load = useCallback(async () => {
    if (!k) { setState('denied'); return }
    try {
      const r = await fetch(`/api/crew?view=routes&k=${encodeURIComponent(k)}&date=${localDateISO()}`, { cache: 'no-store' })
      if (r.status === 401) { setState('denied'); return }
      if (!r.ok) throw new Error()
      const d = await r.json()
      setData(d)
      const first = (d.courses || [])[0]?.name || ''
      setCourseName(sp.get('course') || first)
      setState('ok')
    } catch { setState('error') }
  }, [k, sp])
  useEffect(() => { load() }, [load])

  const courses = data?.courses || []
  const courseInfo = data?.courseInfo || {}
  const course = courses.find((c) => c.name === courseName) || courses[0] || {}
  const counts = useMemo(() => Object.keys(courseInfo?.mowingSets?.[courseName] || {}).map(Number).filter((n) => n > 0).sort((a, b) => a - b), [courseInfo, courseName])
  // How many greens mowers are actually on the board today for this course.
  const autoCount = useMemo(() => {
    const rows = (data?.greensMowToday || []).filter((t) => !courseName || t.course === courseName || !t.course)
    const people = new Set(rows.map((t) => t.assignee).filter(Boolean))
    return people.size || rows.length
  }, [data, courseName])
  // Honor a manual pick; otherwise auto-match today's mower count.
  const activeCount = (count && counts.includes(count)) ? count : (autoCount > 0 ? nearestCount(counts, autoCount) : (counts[0] || null))
  const routes = useMemo(() => (activeCount ? labelledLayout(courseInfo, courseName, course, activeCount) : []), [courseInfo, courseName, course, activeCount])

  if (state === 'loading') return <Center>Loading…</Center>
  if (state === 'denied') return <Center>This routes link is invalid or expired.<br />Ask for a fresh QR code.</Center>
  if (state === 'error') return <Center>Couldn’t load the routes. Try again.</Center>

  return (
    <div style={{ minHeight: '100vh', background: '#EEF1EE' }}>
      <div style={{ background: FOREST }} className="text-white px-4 py-3 sticky top-0 z-10 flex items-center justify-between gap-2">
        <div className="min-w-0">
          {courseInfo.clubName && <p className="font-body text-[10px] tracking-[0.22em] uppercase truncate" style={{ color: GOLD }}>{courseInfo.clubName}</p>}
          <p className="font-display text-lg font-semibold">{es ? 'Rutas de Corte' : 'Mowing Routes'}</p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {[['en', 'EN'], ['es', 'ES']].map(([code, label]) => (
            <button key={code} onClick={() => setLang(code)} className="font-body text-xs font-bold px-3 py-1.5 rounded-full" style={lang === code ? { backgroundColor: GOLD, color: FOREST } : { backgroundColor: 'rgba(255,255,255,0.12)', color: 'white' }}>{label}</button>
          ))}
        </div>
      </div>
      <div className="max-w-2xl mx-auto px-3 py-3">
        {/* Course picker */}
        {courses.length > 1 && (
          <div className="flex gap-2 mb-2 overflow-x-auto no-scrollbar [&>*]:shrink-0 pb-1">
            {courses.map((c) => <Chip key={c.name} on={c.name === courseName} onClick={() => { setCourseName(c.name); setCount(null) }}>{c.name}</Chip>)}
          </div>
        )}
        {/* Mower-count picker */}
        {counts.length > 0 ? (
          <>
            <div className="flex items-center gap-2 mb-1 overflow-x-auto no-scrollbar [&>*]:shrink-0 pb-1">
              <span className="font-body text-[11px] font-bold uppercase tracking-wide text-slate-400">{es ? 'Máquinas:' : 'Mowers:'}</span>
              {counts.map((n) => <Chip key={n} on={n === activeCount} onClick={() => setCount(n)}>{n}</Chip>)}
            </div>
            {autoCount > 0 && (
              <p className="font-body text-[11px] mb-3" style={{ color: FERN }}>
                {counts.includes(autoCount)
                  ? (es ? `Ajustado al tablero de hoy — ${autoCount} en greens.` : `Auto-set to today's board — ${autoCount} greens mower${autoCount === 1 ? '' : 's'} on.`)
                  : (es ? `${autoCount} en greens hoy — mostrando la ruta guardada más cercana (${activeCount}).` : `${autoCount} greens mower${autoCount === 1 ? '' : 's'} on the board today — showing the closest saved route (${activeCount}).`)}
              </p>
            )}
            <div className="space-y-3">
              {routes.map((greens, i) => {
                const accent = ACCENTS[i % ACCENTS.length]
                return (
                  <div key={i} className="bg-white rounded-2xl border shadow-sm overflow-hidden" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                    <div className="px-4 py-2 flex items-center justify-between" style={{ backgroundColor: accent }}>
                      <span className="font-body text-sm font-bold text-white">{es ? 'Ruta' : 'Route'} {i + 1}</span>
                      <span className="font-body text-[11px] text-white/80">{greens.length} green{greens.length === 1 ? '' : 's'}</span>
                    </div>
                    <div className="px-4 py-3 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                      {greens.map((g, j) => (
                        <span key={j} className="inline-flex items-center gap-1.5">
                          <span className="font-body text-base font-bold" style={{ color: FOREST }}>{es ? toEs(g) : g}</span>
                          {j < greens.length - 1 && <span style={{ color: accent }} className="font-bold">–</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <p className="font-body text-sm text-slate-400 text-center py-10">{es ? `Aún no hay rutas guardadas para ${courseName || 'este campo'}.` : `No locked mowing routes for ${courseName || 'this course'} yet.`}</p>
        )}
      </div>
    </div>
  )
}

function Chip({ on, onClick, children }) {
  return <button onClick={onClick} className="font-body text-xs font-bold px-3.5 py-1.5 rounded-full whitespace-nowrap" style={on ? { backgroundColor: FERN, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>{children}</button>
}
function Center({ children }) {
  return <div style={{ minHeight: '100vh', background: '#EEF1EE' }} className="flex items-center justify-center text-center px-6"><p className="font-body text-sm text-slate-400">{children}</p></div>
}

export default function Page() {
  return <Suspense fallback={<Center>Loading…</Center>}><Routes /></Suspense>
}
