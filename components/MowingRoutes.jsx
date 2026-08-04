'use client'

// Mowing Routes — the SETUP screen (lives in the Job Board module).
//
// Build and LOCK a greens layout for each mower-count you run (a grid: greens
// down the side, mowers across the top; tap a box to put a green on a mower — a
// green can be on more than one). The daily assignment happens on the Workboard:
// add a "Mow Greens" job, pick the people, and it pulls the matching locked
// route and gives each person their greens. Greens = practice greens first, then
// holes 1..N. Everything saves in the courseInfo blob (no new table).
import { useState, useEffect } from 'react'
import { ChevronUp, ChevronDown, Scissors, Check, Info, Lock, Plus } from 'lucide-react'
import { greensForCourse, reconcileOrder, layoutForCount } from '@/lib/mowing'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const PAPER = '#F9F8F5'
const HAIR = '#E2E0DB'
const INK = '#1b2420'
const INK_2 = '#5B6160'
const INK_3 = '#8A8984'
const MOWER_COLORS = ['#3A6B4A', '#2B6C8F', '#9A6B12', '#6D4AC2', '#B23A2E', '#0E7C7B', '#8A5A2B', '#4B5563']
const DEFAULT_MAX_SET = 8

export default function MowingRoutes({ courses = [], courseInfo = {}, manage, onSave }) {
  const courseNames = courses.map((c) => c.name).filter(Boolean)
  const [courseName, setCourseName] = useState(courseNames[0] || '')
  const course = courses.find((c) => c.name === courseName) || courses[0] || {}
  const greens = greensForCourse(course)
  const allIds = greens.map((g) => g.id)
  const labelOf = (id) => greens.find((g) => g.id === id)?.label || id

  const savedCountsFor = (cn) => Object.keys(courseInfo.mowingSets?.[cn] || {}).map(Number).filter((n) => n > 0)
  const [setCnt, setSetCnt] = useState(5)
  const [maxSet, setMaxSet] = useState(Math.max(DEFAULT_MAX_SET, ...savedCountsFor(courseName)))
  const countButtons = Array.from({ length: maxSet }, (_, i) => i + 1)
  const [setGroups, setSetGroups] = useState([])
  const [setSaved, setSetSaved] = useState(false)
  const [order, setOrder] = useState(reconcileOrder(courseInfo.mowingOrder?.[courseName], allIds))
  const [showOrder, setShowOrder] = useState(false)

  const hasLockedSet = (count) => {
    const saved = courseInfo.mowingSets?.[courseName]?.[count]?.groups
    return Array.isArray(saved) && saved.length === count
  }

  // Load the layout for the picked count.
  useEffect(() => {
    setSetGroups(layoutForCount(courseInfo, courseName, course, setCnt)); setSetSaved(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseName, setCnt])

  // Re-seed on course change.
  useEffect(() => {
    const c = courses.find((x) => x.name === courseName) || {}
    const ids = greensForCourse(c).map((g) => g.id)
    setOrder(reconcileOrder(courseInfo.mowingOrder?.[courseName], ids))
    setMaxSet(Math.max(DEFAULT_MAX_SET, ...savedCountsFor(courseName)))
    setShowOrder(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseName])

  const toggleGreenOnMower = (gid, mowerIdx) => {
    setSetGroups((prev) => prev.map((g, idx) => (idx !== mowerIdx ? g : (g.includes(gid) ? g.filter((x) => x !== gid) : [...g, gid]))))
    setSetSaved(false)
  }
  const saveSet = () => {
    const sets = { ...(courseInfo.mowingSets || {}) }
    sets[courseName] = { ...(sets[courseName] || {}), [setCnt]: { groups: setGroups } }
    onSave({ mowingSets: sets })
    setSetSaved(true); setTimeout(() => setSetSaved(false), 2200)
  }
  const moveInOrder = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= order.length) return
    setOrder((o) => { const n = [...o]; [n[i], n[j]] = [n[j], n[i]]; return n })
  }

  // No greens configured yet.
  if (allIds.length === 0) {
    return (
      <div className="p-8 text-center" style={{ backgroundColor: PAPER, border: `1px solid ${HAIR}`, borderRadius: 12 }}>
        <Scissors size={26} style={{ color: HAIR }} className="mx-auto mb-3" />
        <p className="font-body text-sm" style={{ color: INK_2 }}>Set this course's holes (and any practice greens) in <b>Settings → Course Info</b> first — then the greens show up here to route.</p>
      </div>
    )
  }

  // Crew read-only — daily mowing is on the Workboard, not here.
  if (!manage) {
    return (
      <div className="p-6 text-center" style={{ backgroundColor: PAPER, border: `1px solid ${HAIR}`, borderRadius: 12 }}>
        <Scissors size={22} style={{ color: HAIR }} className="mx-auto mb-2" />
        <p className="font-body text-sm" style={{ color: INK_2 }}>Mowing routes are set up by the team. Today's greens mowing shows on the <b>Workboard</b> under each person's name.</p>
      </div>
    )
  }

  const assignedIds = new Set(setGroups.flat())
  const unassigned = allIds.filter((id) => !assignedIds.has(id))

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
        <Lock size={14} style={{ color: FERN }} />
        <p className="font-body text-sm font-bold" style={{ color: FOREST }}>Locked routes for {courseName || 'this course'}</p>
      </div>
      <p className="font-body text-[11px] mb-2.5" style={{ color: INK_3 }}>Build a route for each mower-count you run. On the day you just add a <b>Mow Greens</b> job on the Workboard and pick the people — it pulls the matching route and gives each person their greens.</p>

      {/* Count picker */}
      <div className="flex gap-1.5 mb-1 flex-wrap items-center">
        {countButtons.map((n) => (
          <button key={n} onClick={() => setSetCnt(n)} className="font-body text-sm font-bold rounded-lg tnum flex items-center justify-center gap-1"
            style={{ minWidth: 44, height: 40, backgroundColor: n === setCnt ? FOREST : PAPER, color: n === setCnt ? 'white' : INK_2, border: `1px solid ${n === setCnt ? FOREST : HAIR}` }}>
            {n}{hasLockedSet(n) && <Lock size={10} style={{ opacity: 0.7 }} />}
          </button>
        ))}
        <button onClick={() => { const n = maxSet + 1; setMaxSet(n); setSetCnt(n) }} className="font-body text-sm font-bold rounded-lg flex items-center justify-center" title="Add a bigger route"
          style={{ minWidth: 44, height: 40, backgroundColor: PAPER, color: FERN, border: `1px dashed ${HAIR}` }}><Plus size={16} /></button>
      </div>
      <p className="font-body text-[10px] mb-3" style={{ color: INK_3 }}>Numbers = how many mowers. 🔒 = a route is locked for that count. Tap ＋ for more.</p>

      {/* Grid: greens × mowers */}
      <div className="rounded-xl overflow-hidden mb-2" style={{ border: `1px solid ${HAIR}` }}>
        <div className="overflow-x-auto">
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr style={{ backgroundColor: PAPER }}>
                <th className="font-body text-[10px] font-bold uppercase tracking-wide text-left px-2.5 py-2" style={{ color: INK_3, position: 'sticky', left: 0, backgroundColor: PAPER, zIndex: 1 }}>Green</th>
                {setGroups.map((g, mi) => {
                  const c = MOWER_COLORS[mi % MOWER_COLORS.length]
                  return (
                    <th key={mi} className="px-1 py-1.5 text-center" style={{ minWidth: 42 }}>
                      <div className="font-body text-[11px] font-bold" style={{ color: c }}>M{mi + 1}</div>
                      <div className="font-body text-[9px] tnum" style={{ color: INK_3 }}>{g.length}</div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {greens.map((green) => {
                const onCount = setGroups.filter((g) => g.includes(green.id)).length
                const rowBg = onCount === 0 ? '#FBEEEC' : 'white'
                return (
                  <tr key={green.id} style={{ borderTop: `1px solid ${HAIR}` }}>
                    <td className="font-body text-[12px] font-semibold px-2.5 py-1 tnum whitespace-nowrap" style={{ color: onCount === 0 ? '#B23A2E' : INK, position: 'sticky', left: 0, backgroundColor: rowBg, zIndex: 1 }}>{green.label}</td>
                    {setGroups.map((g, mi) => {
                      const on = g.includes(green.id)
                      const c = MOWER_COLORS[mi % MOWER_COLORS.length]
                      return (
                        <td key={mi} className="text-center px-1 py-1" style={{ backgroundColor: rowBg }}>
                          <button onClick={() => toggleGreenOnMower(green.id, mi)} className="rounded-md mx-auto flex items-center justify-center" style={{ width: 32, height: 28, backgroundColor: on ? c : '#F1F1EE', border: `1px solid ${on ? c : HAIR}` }} aria-label={`${green.label} on Mower ${mi + 1}`}>
                            {on && <Check size={14} className="text-white" />}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="font-body text-[11px] mb-2" style={{ color: INK_3 }}>Tap a box to put that green on that mower. Tick it under <b>more than one</b> to share it (two mowers on the practice greens). A <span style={{ color: '#B23A2E' }}>red row</span> means that green isn't on any mower yet.</p>

      {unassigned.length > 0 && (
        <p className="font-body text-[11px] mb-2" style={{ color: '#B23A2E' }}>⚠ Not on any mower: {unassigned.map(labelOf).join(', ')}</p>
      )}

      <button onClick={saveSet} className="font-body text-xs font-bold px-4 py-2.5 rounded-full text-white inline-flex items-center gap-1.5" style={{ backgroundColor: FOREST }}>
        {setSaved ? <><Check size={14} /> Locked in</> : <><Lock size={13} /> Save &amp; lock this {setCnt}-mower route</>}
      </button>

      {/* Starting order — seeds a fresh count before you tweak it */}
      <div className="mt-5">
        <button onClick={() => setShowOrder((v) => !v)} className="font-body text-xs font-bold flex items-center gap-1.5" style={{ color: FERN }}>
          {showOrder ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Starting order (used before you tweak a new count)
        </button>
        {showOrder && (
          <div className="mt-2 p-3 rounded-xl" style={{ backgroundColor: PAPER, border: `1px solid ${HAIR}` }}>
            <p className="font-body text-[11px] mb-2 flex items-start gap-1" style={{ color: INK_3 }}><Info size={12} className="mt-0.5 shrink-0" /> When you first open a mower-count, greens are split evenly in this order (practice greens first). Editing it only affects counts you haven't locked yet.</p>
            <div className="space-y-1">
              {order.map((id, i) => (
                <div key={id} className="flex items-center gap-2 py-1 px-2 rounded-lg" style={{ backgroundColor: 'white', border: `1px solid ${HAIR}` }}>
                  <span className="font-body text-[10px] font-bold tnum w-6" style={{ color: INK_3 }}>{i + 1}.</span>
                  <span className="font-body text-[13px] font-semibold flex-1 tnum" style={{ color: INK }}>{labelOf(id)}</span>
                  <button onClick={() => moveInOrder(i, -1)} disabled={i === 0} className="p-1 disabled:opacity-25" style={{ color: INK_2 }}><ChevronUp size={15} /></button>
                  <button onClick={() => moveInOrder(i, 1)} disabled={i === order.length - 1} className="p-1 disabled:opacity-25" style={{ color: INK_2 }}><ChevronDown size={15} /></button>
                </div>
              ))}
            </div>
            <button onClick={() => onSave({ mowingOrder: { ...(courseInfo.mowingOrder || {}), [courseName]: order } })} className="font-body text-xs font-bold px-4 py-2 rounded-full text-white mt-3 inline-flex items-center gap-1.5" style={{ backgroundColor: FERN }}>Save order</button>
          </div>
        )}
      </div>
    </div>
  )
}
