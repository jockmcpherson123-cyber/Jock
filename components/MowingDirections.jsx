'use client'

// Mowing DIRECTIONS setup — lives beside Mowing Routes in the Job Board module.
// Build a rotation of directions for each surface. Each surface picks its own
// driver: "Auto — day by day" rotates on its own by the calendar (greens), or
// "Next when logged" only moves when you tap Apply next (fairways). On the day
// you add a Mow job on the Workboard it auto-dumps today's direction with a
// little clock picture. Saved in the courseInfo blob (no new table).
import { useState, useEffect } from 'react'
import { Plus, X, Check, ArrowRight, Trash2, Compass } from 'lucide-react'
import MowPattern from '@/components/MowPattern'
import { mowDirConfig, stepIndexFor, stepLabel, stepShort, sameStep, axisStep, circleStep, CLOCK_AXES } from '@/lib/mowdir'
import { localDateISO } from '@/lib/dates'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const PAPER = '#F9F8F5'
const HAIR = '#E2E0DB'
const INK = '#1b2420'
const INK_2 = '#5B6160'
const INK_3 = '#8A8984'

export default function MowingDirections({ courses = [], courseInfo = {}, manage, onSave }) {
  const courseNames = courses.map((c) => c.name).filter(Boolean)
  const [courseName, setCourseName] = useState(courseNames[0] || '')
  const [surfaces, setSurfaces] = useState([])
  const [state, setState] = useState({})
  const [saved, setSaved] = useState(false)
  const [newSurface, setNewSurface] = useState('')

  // Load / re-load the config for the picked course.
  useEffect(() => {
    const cfg = mowDirConfig(courseInfo, courseName)
    setSurfaces(cfg.surfaces); setState(cfg.state); setSaved(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseName])

  const dirty = () => setSaved(false)
  const persist = (nextSurfaces, nextState) => {
    const s = nextSurfaces ?? surfaces
    const st = nextState ?? state
    const mowDirs = { ...(courseInfo.mowDirs || {}), [courseName]: { surfaces: s, state: st } }
    onSave({ mowDirs })
  }

  const updateSurface = (i, patch) => { setSurfaces((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s))); dirty() }
  const removeSurface = (i) => { setSurfaces((prev) => prev.filter((_, idx) => idx !== i)); dirty() }
  const addStep = (i, step) => updateSurface(i, { steps: [...(surfaces[i].steps || []), step] })
  const removeStep = (i, si) => updateSurface(i, { steps: (surfaces[i].steps || []).filter((_, x) => x !== si) })

  const addSurface = () => {
    const label = newSurface.trim()
    if (!label) return
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `s${surfaces.length}`
    if (surfaces.some((s) => s.key === key)) { setNewSurface(''); return }
    setSurfaces((prev) => [...prev, { key, label, driver: 'day', steps: [axisStep(12, 6)] }])
    setNewSurface(''); dirty()
  }

  // "Apply next" for a history-driven surface: bump its pointer and save now.
  const applyNext = (surface) => {
    const n = (surface.steps || []).length
    if (!n) return
    const cur = Number(state?.[surface.key]?.index) || 0
    const nextState = { ...state, [surface.key]: { index: (cur + 1) % n, date: localDateISO() } }
    setState(nextState)
    persist(surfaces, nextState)
  }

  const save = () => { persist(); setSaved(true); setTimeout(() => setSaved(false), 2200) }

  if (!manage) {
    return (
      <div className="p-6 text-center" style={{ backgroundColor: PAPER, border: `1px solid ${HAIR}`, borderRadius: 12 }}>
        <Compass size={22} style={{ color: HAIR }} className="mx-auto mb-2" />
        <p className="font-body text-sm" style={{ color: INK_2 }}>Mow directions are set up by the team. Today's direction shows on each Mow job on the <b>Workboard</b>.</p>
      </div>
    )
  }

  return (
    <div>
      {/* Course tabs */}
      {courseNames.length > 1 && (
        <div className="flex gap-1.5 flex-wrap mb-3">
          {courseNames.map((n) => (
            <button key={n} onClick={() => setCourseName(n)} className="font-body text-xs font-bold px-3.5 py-2 rounded-full transition"
              style={n === courseName ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: PAPER, color: INK_2, border: `1px solid ${HAIR}` }}>{n}</button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mb-1.5">
        <Compass size={14} style={{ color: FERN }} />
        <p className="font-body text-sm font-bold" style={{ color: FOREST }}>Mow directions for {courseName || 'this course'}</p>
      </div>
      <p className="font-body text-[11px] mb-3" style={{ color: INK_3 }}>Build a rotation of directions for each surface. On the day you add a <b>Mow</b> job on the Workboard it auto-dumps today's direction with a clock picture. <b>Auto</b> surfaces rotate on their own each day; <b>Next when logged</b> surfaces only move when you tap <b>Apply next</b>.</p>

      <div className="space-y-3">
        {surfaces.map((surface, i) => {
          const steps = surface.steps || []
          const curIdx = stepIndexFor(surface, state, localDateISO())
          const cur = curIdx >= 0 ? steps[curIdx] : null
          const isHistory = surface.driver === 'history'
          return (
            <div key={surface.key} className="rounded-xl p-3" style={{ backgroundColor: 'white', border: `1px solid ${HAIR}` }}>
              {/* Header: name + driver + remove */}
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <input value={surface.label} onChange={(e) => updateSurface(i, { label: e.target.value })}
                  className="font-body text-sm font-bold px-1 py-0.5 rounded" style={{ color: FOREST, border: `1px solid transparent`, minWidth: 90, maxWidth: 160 }}
                  onFocus={(e) => (e.target.style.border = `1px solid ${HAIR}`)} onBlur={(e) => (e.target.style.border = '1px solid transparent')} />
                <div className="flex rounded-lg overflow-hidden" style={{ border: `1px solid ${HAIR}` }}>
                  {[['day', 'Auto — day by day'], ['history', 'Next when logged']].map(([val, lab]) => (
                    <button key={val} onClick={() => updateSurface(i, { driver: val })} className="font-body text-[10px] font-bold px-2.5 py-1.5"
                      style={{ backgroundColor: surface.driver === val ? FOREST : 'white', color: surface.driver === val ? 'white' : INK_2 }}>{lab}</button>
                  ))}
                </div>
                <button onClick={() => removeSurface(i)} className="ml-auto p-1 rounded" aria-label="Remove surface" style={{ color: INK_3 }}><Trash2 size={15} /></button>
              </div>

              {/* Today / next line */}
              <div className="mb-2 flex items-center gap-2">
                {cur ? (
                  <>
                    <MowPattern step={cur} size={56} />
                    <div>
                      <p className="font-body text-[10px] uppercase tracking-wide font-bold" style={{ color: FERN }}>{isHistory ? 'Up next' : 'Today'}</p>
                      <p className="font-body text-[13px] font-bold" style={{ color: INK }}>{stepLabel(cur)}</p>
                    </div>
                    {isHistory && steps.length > 1 && (
                      <button onClick={() => applyNext(surface)} className="ml-auto font-body text-[11px] font-bold px-3 py-2 rounded-full inline-flex items-center gap-1" style={{ backgroundColor: PAPER, color: FOREST, border: `1px solid ${HAIR}` }}>
                        Apply next <ArrowRight size={13} />
                      </button>
                    )}
                  </>
                ) : (
                  <p className="font-body text-[11px]" style={{ color: INK_3 }}>Add a direction below.</p>
                )}
              </div>

              {/* The rotation */}
              {steps.length > 0 && (
                <div className="flex gap-2 flex-wrap mb-2">
                  {steps.map((st, si) => {
                    const isCur = si === curIdx
                    return (
                      <div key={si} className="rounded-lg p-1.5 relative" style={{ border: `1.5px solid ${isCur ? FERN : HAIR}`, backgroundColor: isCur ? '#EAF2EC' : PAPER, width: 66 }}>
                        <button onClick={() => removeStep(i, si)} className="absolute -top-1.5 -right-1.5 rounded-full flex items-center justify-center" style={{ width: 17, height: 17, backgroundColor: 'white', border: `1px solid ${HAIR}`, color: '#B23A2E' }} aria-label="Remove"><X size={11} /></button>
                        <MowPattern step={st} size={54} />
                        <p className="font-body text-[9px] font-bold text-center mt-0.5 leading-tight" style={{ color: INK_2 }}>{stepShort(st)}</p>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Add a direction */}
              <details>
                <summary className="font-body text-[11px] font-bold cursor-pointer inline-flex items-center gap-1" style={{ color: FERN }}><Plus size={12} /> Add a direction</summary>
                <div className="mt-2 p-2 rounded-lg" style={{ backgroundColor: PAPER, border: `1px solid ${HAIR}` }}>
                  <p className="font-body text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: INK_3 }}>Straight (clock)</p>
                  <div className="flex gap-1.5 flex-wrap mb-2">
                    {CLOCK_AXES.map((ax) => {
                      const st = axisStep(ax.a, ax.b)
                      const has = steps.some((x) => sameStep(x, st))
                      return (
                        <button key={`${ax.a}-${ax.b}`} onClick={() => addStep(i, st)} disabled={has} className="rounded-lg p-1 flex flex-col items-center" style={{ border: `1px solid ${HAIR}`, backgroundColor: 'white', opacity: has ? 0.35 : 1 }}>
                          <MowPattern step={st} size={44} />
                          <span className="font-body text-[9px] font-bold" style={{ color: INK_2 }}>{ax.a}–{ax.b}</span>
                        </button>
                      )
                    })}
                  </div>
                  <p className="font-body text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: INK_3 }}>Half &amp; half (round the outside)</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {[['cw', 'Clockwise ↻'], ['acw', 'Anti-clockwise ↺']].map(([dir, lab]) => {
                      const st = circleStep(dir)
                      const has = steps.some((x) => sameStep(x, st))
                      return (
                        <button key={dir} onClick={() => addStep(i, st)} disabled={has} className="rounded-lg p-1.5 flex items-center gap-1.5" style={{ border: `1px solid ${HAIR}`, backgroundColor: 'white', opacity: has ? 0.35 : 1 }}>
                          <MowPattern step={st} size={44} />
                          <span className="font-body text-[10px] font-bold" style={{ color: INK_2 }}>{lab}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </details>
            </div>
          )
        })}
      </div>

      {/* Add a surface */}
      <div className="flex gap-2 mt-3 mb-4 items-center">
        <input value={newSurface} onChange={(e) => setNewSurface(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSurface()} placeholder="Add a surface (e.g. Intermediate, Collars)"
          className="font-body text-sm px-3 py-2 rounded-lg flex-1 min-w-0" style={{ border: `1px solid ${HAIR}`, color: INK }} />
        <button onClick={addSurface} className="font-body text-xs font-bold px-3.5 py-2.5 rounded-full inline-flex items-center gap-1 shrink-0" style={{ backgroundColor: PAPER, color: FOREST, border: `1px solid ${HAIR}` }}><Plus size={14} /> Add</button>
      </div>

      <button onClick={save} className="font-body text-xs font-bold px-4 py-2.5 rounded-full text-white inline-flex items-center gap-1.5" style={{ backgroundColor: FOREST }}>
        {saved ? <><Check size={14} /> Saved</> : 'Save directions'}
      </button>
      <p className="font-body text-[10px] mt-2" style={{ color: INK_3 }}>Auto surfaces rotate by the calendar; “Apply next” saves on its own straight away.</p>
    </div>
  )
}
