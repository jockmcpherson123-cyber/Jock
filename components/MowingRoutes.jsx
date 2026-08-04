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
import { ChevronUp, ChevronDown, Scissors, Check, Lock, Plus } from 'lucide-react'
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
  const greenById = Object.fromEntries(greens.map((g) => [g.id, g]))
  const orderedGreens = order.map((id) => greenById[id]).filter(Boolean)

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseName])

  const toggleGreenOnMower = (gid, mowerIdx) => {
    setSetGroups((prev) => prev.map((g, idx) => (idx !== mowerIdx ? g : (g.includes(gid) ? g.filter((x) => x !== gid) : [...g, gid]))))
    setSetSaved(false)
  }
  const saveSet = () => {
    const sets = { ...(courseInfo.mowingSets || {}) }
    sets[courseName] = { ...(sets[courseName] || {}), [setCnt]: { groups: setGroups } }
    const orders = { ...(courseInfo.mowingOrder || {}), [courseName]: order }
    onSave({ mowingSets: sets, mowingOrder: orders })
    setSetSaved(true); setTimeout(() => setSetSaved(false), 2200)
  }
  const moveInOrder = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= order.length) return
    setOrder((o) => { const n = [...o]; [n[i], n[j]] = [n[j], n[i]]; return n }); setSetSaved(false)
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
              {orderedGreens.map((green, ri) => {
                const onCount = setGroups.filter((g) => g.includes(green.id)).length
                const rowBg = onCount === 0 ? '#FBEEEC' : 'white'
                return (
                  <tr key={green.id} style={{ borderTop: `1px solid ${HAIR}` }}>
                    <td className="px-1.5 py-1 whitespace-nowrap" style={{ position: 'sticky', left: 0, backgroundColor: rowBg, zIndex: 1 }}>
                      <div className="flex items-center gap-1">
                        <div className="flex flex-col">
                          <button onClick={() => moveInOrder(ri, -1)} disabled={ri === 0} className="disabled:opacity-20" style={{ color: INK_3, lineHeight: 0.6 }} aria-label="Move up"><ChevronUp size={14} /></button>
                          <button onClick={() => moveInOrder(ri, 1)} disabled={ri === orderedGreens.length - 1} className="disabled:opacity-20" style={{ color: INK_3, lineHeight: 0.6 }} aria-label="Move down"><ChevronDown size={14} /></button>
                        </div>
                        <span className="font-body text-[12px] font-semibold tnum" style={{ color: onCount === 0 ? '#B23A2E' : INK }}>{green.label}</span>
                      </div>
                    </td>
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
      <p className="font-body text-[11px] mb-2" style={{ color: INK_3 }}>Use the <b>▲▼</b> to set the mow order (practice greens first, nursery last, etc.). Tap a box to put a green on a mower — tick <b>more than one</b> to share it. A <span style={{ color: '#B23A2E' }}>red row</span> means a green isn't on any mower yet.</p>

      {unassigned.length > 0 && (
        <p className="font-body text-[11px] mb-2" style={{ color: '#B23A2E' }}>⚠ Not on any mower: {unassigned.map(labelOf).join(', ')}</p>
      )}

      <button onClick={saveSet} className="font-body text-xs font-bold px-4 py-2.5 rounded-full text-white inline-flex items-center gap-1.5" style={{ backgroundColor: FOREST }}>
        {setSaved ? <><Check size={14} /> Locked in</> : <><Lock size={13} /> Save &amp; lock this {setCnt}-mower route</>}
      </button>
      <p className="font-body text-[10px] mt-2" style={{ color: INK_3 }}>Saves this route <b>and</b> the mow order for {courseName || 'this course'}.</p>
    </div>
  )
}
