'use client'

// Mowing Routes — split a course's greens across a team of mowers (1–8).
// Two parts:
//   1) Order (set once per course): the greens in the sequence that mows best
//      for that course. Saved in settings (courseInfo.mowingOrder).
//   2) Send-out (the daily bit): pick how many mowers are going and it slices
//      that saved order into that many even groups; optionally name a driver on
//      each, nudge a green to another mower. Saved as courseInfo.mowingRoutes.
// Greens = the course's holes (1..N) plus any practice/putting greens set in
// Settings. Crew see a read-only list; managers edit.
import { useState, useEffect } from 'react'
import { ChevronUp, ChevronDown, Scissors, X, Check, Info, ClipboardList, Loader2 } from 'lucide-react'
import * as db from '@/lib/db'
import { localDateISO } from '@/lib/dates'

// The job label used for mowing tasks pushed to the Workboard — matched on so a
// re-push replaces the previous set instead of duplicating.
const MOW_JOB = 'Greens Mowing'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#B9982F'
const PAPER = '#F9F8F5'
const PAPER_2 = '#E8E7E2'
const HAIR = '#E2E0DB'
const INK = '#1b2420'
const INK_2 = '#5B6160'
const INK_3 = '#8A8984'
// Up to 8 distinct mower colours (ties into a course map later).
const MOWER_COLORS = ['#3A6B4A', '#2B6C8F', '#9A6B12', '#6D4AC2', '#B23A2E', '#0E7C7B', '#8A5A2B', '#4B5563']

// A course's greens: holes 1..N, then any practice greens (id-prefixed so a
// practice green named "1" can't collide with hole 1).
function greensForCourse(course) {
  const holes = Number(course?.holes) || 0
  const out = []
  for (let i = 1; i <= holes; i++) out.push({ id: String(i), label: `#${i}` })
  ;(course?.practiceGreens || []).forEach((nm) => { const n = String(nm).trim(); if (n) out.push({ id: `p:${n}`, label: n }) })
  return out
}
// Keep a saved order valid as greens change: drop any that no longer exist,
// then append any new greens that aren't in the saved order yet.
function reconcileOrder(saved, allIds) {
  const s = (saved || []).filter((id) => allIds.includes(id))
  return [...s, ...allIds.filter((id) => !s.includes(id))]
}
// Slice an array into n contiguous groups as evenly as possible.
function splitEven(arr, n) {
  const out = []
  const base = Math.floor(arr.length / n)
  const rem = arr.length % n
  let i = 0
  for (let k = 0; k < n; k++) { const size = base + (k < rem ? 1 : 0); out.push(arr.slice(i, i + size)); i += size }
  return out
}

export default function MowingRoutes({ courses = [], courseInfo = {}, roster = [], manage, onSave }) {
  const courseNames = courses.map((c) => c.name).filter(Boolean)
  const [courseName, setCourseName] = useState(courseNames[0] || '')
  const course = courses.find((c) => c.name === courseName) || courses[0] || {}
  const greens = greensForCourse(course)
  const allIds = greens.map((g) => g.id)
  const labelOf = (id) => greens.find((g) => g.id === id)?.label || id

  const [order, setOrder] = useState(reconcileOrder(courseInfo.mowingOrder?.[courseName], allIds))
  const [showOrder, setShowOrder] = useState(false)
  const savedRoutes = courseInfo.mowingRoutes?.[courseName]
  const [mowers, setMowers] = useState(savedRoutes?.mowers || 4)
  const [groups, setGroups] = useState(savedRoutes?.groups || [])
  const [names, setNames] = useState(savedRoutes?.names || [])
  const [moveId, setMoveId] = useState(null)
  const [savedTick, setSavedTick] = useState('')
  const [touched, setTouched] = useState(false) // a user change the board should mirror
  const [syncing, setSyncing] = useState(false)
  const [synced, setSynced] = useState(false)

  // Re-seed everything when the course changes (and don't let that count as a
  // user change, so switching courses never pushes to the board on its own).
  useEffect(() => {
    const c = courses.find((x) => x.name === courseName) || {}
    const ids = greensForCourse(c).map((g) => g.id)
    setOrder(reconcileOrder(courseInfo.mowingOrder?.[courseName], ids))
    const sr = courseInfo.mowingRoutes?.[courseName]
    setMowers(sr?.mowers || 4); setGroups(sr?.groups || []); setNames(sr?.names || [])
    setMoveId(null); setShowOrder(false); setSavedTick(''); setTouched(false); setSynced(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseName])

  const moveInOrder = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= order.length) return
    const next = [...order]
    ;[next[i], next[j]] = [next[j], next[i]]
    setOrder(next)
  }
  const saveOrder = () => { onSave({ mowingOrder: { ...(courseInfo.mowingOrder || {}), [courseName]: order } }); flash('order') }
  const resetOrder = () => setOrder(allIds)

  // Pick a mower count → split immediately along the saved order (and mirror to
  // the board via the auto-sync effect below).
  const setCount = (n) => { setTouched(true); setMowers(n); setGroups(splitEven(order, n)); setNames((p) => p.slice(0, n)); setMoveId(null) }
  const moveTo = (gid, toIdx) => {
    setTouched(true)
    setGroups((prev) => prev.map((g, idx) => (idx === toIdx ? [...g.filter((x) => x !== gid), gid] : g.filter((x) => x !== gid))))
    setMoveId(null)
  }
  const setName = (idx, val) => { setTouched(true); setNames((prev) => { const n = [...prev]; n[idx] = val; return n }) }
  const flash = (what) => { setSavedTick(what); setTimeout(() => setSavedTick(''), 1800) }

  // Save the routes AND mirror them onto today's Job Board — one task per mower,
  // under the driver's name, greens in the note. Re-running replaces this
  // course's mowing tasks for today (no duplicates).
  const pushToBoard = async () => {
    setSyncing(true)
    try {
      onSave({ mowingRoutes: { ...(courseInfo.mowingRoutes || {}), [courseName]: { mowers, groups, names } } })
      const today = localDateISO()
      const existing = await db.fetchCrewTasks(today, today)
      for (const t of existing) {
        if (t.job === MOW_JOB && String(t.course || '') === String(courseName || '')) await db.deleteCrewTask(t.id)
      }
      const rows = groups
        .map((g, idx) => ({ date: today, job: MOW_JOB, assignee: names[idx] || '', equipment: `Mower ${idx + 1}`, course: courseName || '', status: 'todo', sort: idx, notes: g.map(labelOf).join(', ') }))
        .filter((r) => r.notes) // skip an empty mower
      if (rows.length) await db.addCrewTasks(rows)
      setSynced(true); setTimeout(() => setSynced(false), 2500)
    } catch (e) { console.error(e) }
    setSyncing(false)
  }
  // Auto-sync: any user change (count / driver / moved green) mirrors to the
  // board after a short debounce — no button to press. Never fires on load or a
  // course switch (touched stays false there).
  useEffect(() => {
    if (!manage || !touched) return
    const id = setTimeout(() => { pushToBoard() }, 700)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, names, touched])

  const assigned = new Set(groups.flat())
  const unassigned = order.filter((id) => !assigned.has(id))

  // No greens configured yet.
  if (allIds.length === 0) {
    return (
      <div className="paper-card p-8 text-center" style={{ backgroundColor: PAPER, border: `1px solid ${HAIR}`, borderRadius: 12 }}>
        <Scissors size={26} style={{ color: HAIR }} className="mx-auto mb-3" />
        <p className="font-body text-sm" style={{ color: INK_2 }}>Set this course's holes (and any practice greens) in <b>Settings → Course Info</b> first — then the greens show up here to route.</p>
      </div>
    )
  }

  return (
    <div>
      {/* Course tabs */}
      {courseNames.length > 1 && (
        <div className="flex gap-1.5 flex-wrap mb-4">
          {courseNames.map((n) => (
            <button key={n} onClick={() => setCourseName(n)} className="font-body text-xs font-bold px-3.5 py-2 rounded-full transition"
              style={n === courseName ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: PAPER, color: INK_2, border: `1px solid ${HAIR}` }}>{n}</button>
          ))}
        </div>
      )}

      {!manage && (!savedRoutes || !(savedRoutes.groups || []).length) ? (
        <div className="p-8 text-center" style={{ backgroundColor: PAPER, border: `1px solid ${HAIR}`, borderRadius: 12 }}>
          <p className="font-body text-sm" style={{ color: INK_3 }}>No mowing routes set for {courseName || 'this course'} yet.</p>
        </div>
      ) : (
        <>
          {/* ── Send-out: how many mowers ── */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Scissors size={15} style={{ color: FERN }} />
              <p className="font-body text-sm font-bold" style={{ color: FOREST }}>How many mowers on {courseName ? courseName + ' greens' : 'greens'}?</p>
            </div>
            {manage ? (
              <div className="flex gap-1.5 flex-wrap">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <button key={n} onClick={() => setCount(n)} className="font-body text-sm font-bold rounded-lg transition tnum"
                    style={{ width: 40, height: 40, backgroundColor: n === mowers && groups.length ? FOREST : PAPER, color: n === mowers && groups.length ? 'white' : INK_2, border: `1px solid ${n === mowers && groups.length ? FOREST : HAIR}` }}>{n}</button>
                ))}
              </div>
            ) : (
              <p className="font-body text-[13px]" style={{ color: INK_2 }}>{(savedRoutes?.groups || []).length} mower{(savedRoutes?.groups || []).length !== 1 ? 's' : ''} · {allIds.length} greens</p>
            )}
            {manage && <p className="font-body text-[11px] mt-1.5" style={{ color: INK_3 }}>Tap a number and it splits the {allIds.length} greens evenly, in your saved order. Tweak below, then Save.</p>}
          </div>

          {/* ── Mower cards ── */}
          {(manage ? groups : (savedRoutes?.groups || [])).length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-3">
              {(manage ? groups : (savedRoutes?.groups || [])).map((g, idx) => {
                const color = MOWER_COLORS[idx % MOWER_COLORS.length]
                const nm = (manage ? names : (savedRoutes?.names || []))[idx] || ''
                return (
                  <div key={idx} className="p-3 rounded-xl" style={{ backgroundColor: PAPER, border: `1px solid ${HAIR}`, borderLeft: `4px solid ${color}` }}>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="font-body text-[13px] font-bold" style={{ color }}>Mower {idx + 1}</span>
                      {manage ? (
                        <select value={nm} onChange={(e) => setName(idx, e.target.value)} className="font-body text-xs rounded-lg px-2 py-1 bg-white" style={{ border: `1px solid ${HAIR}`, color: INK_2, maxWidth: 150 }}>
                          <option value="">— driver —</option>
                          {roster.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      ) : (nm && <span className="font-body text-xs font-semibold" style={{ color: INK_2 }}>{nm}</span>)}
                    </div>
                    {g.length === 0 ? (
                      <p className="font-body text-[11px]" style={{ color: INK_3 }}>No greens</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {g.map((gid) => (
                          <button key={gid} type="button" disabled={!manage} onClick={() => manage && setMoveId(moveId === gid ? null : gid)}
                            className="font-body text-[12px] font-bold rounded-md px-2 py-1 tnum" style={{ backgroundColor: `${color}15`, color, border: moveId === gid ? `1px solid ${color}` : '1px solid transparent', cursor: manage ? 'pointer' : 'default' }}>
                            {labelOf(gid)}
                          </button>
                        ))}
                      </div>
                    )}
                    {/* move bar */}
                    {manage && moveId && g.includes(moveId) && (
                      <div className="mt-2 pt-2 flex items-center gap-1.5 flex-wrap" style={{ borderTop: `1px solid ${HAIR}` }}>
                        <span className="font-body text-[10px] font-bold uppercase tracking-wide" style={{ color: INK_3 }}>Move {labelOf(moveId)} →</span>
                        {groups.map((_, di) => di !== idx && (
                          <button key={di} onClick={() => moveTo(moveId, di)} className="font-body text-[11px] font-bold rounded px-2 py-0.5" style={{ backgroundColor: `${MOWER_COLORS[di % MOWER_COLORS.length]}18`, color: MOWER_COLORS[di % MOWER_COLORS.length] }}>M{di + 1}</button>
                        ))}
                        <button onClick={() => setMoveId(null)} style={{ color: INK_3 }}><X size={13} /></button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {manage && unassigned.length > 0 && groups.length > 0 && (
            <p className="font-body text-[11px] mb-3" style={{ color: '#B23A2E' }}>⚠ Not on any mower: {unassigned.map(labelOf).join(', ')} — tap a green to move it onto one.</p>
          )}

          {manage && groups.length > 0 && (
            <div className="flex items-center gap-1.5 font-body text-[12px] rounded-lg px-3 py-2" style={{ backgroundColor: PAPER, border: `1px solid ${HAIR}`, color: INK_2 }}>
              {syncing ? (
                <><Loader2 size={13} className="animate-spin" style={{ color: FERN }} /> Updating today’s Job Board…</>
              ) : synced ? (
                <span style={{ color: FERN }}><Check size={13} className="inline mr-1" />Live on today’s Job Board</span>
              ) : (
                <><ClipboardList size={13} style={{ color: INK_3 }} /> These routes show on today’s Job Board under each driver — they update as you change them.</>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Order editor (managers) ── */}
      {manage && (
        <div className="mt-5">
          <button onClick={() => setShowOrder((v) => !v)} className="font-body text-xs font-bold flex items-center gap-1.5" style={{ color: FERN }}>
            {showOrder ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Mowing order for {courseName || 'this course'}
          </button>
          {showOrder && (
            <div className="mt-2 p-3 rounded-xl" style={{ backgroundColor: PAPER, border: `1px solid ${HAIR}` }}>
              <p className="font-body text-[11px] mb-2 flex items-start gap-1" style={{ color: INK_3 }}><Info size={12} className="mt-0.5 shrink-0" /> Put the greens in the order that mows best for this course. Auto-split follows this order, so #1→#2→#3 groups the way you set here.</p>
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
              <div className="flex gap-2 mt-3">
                <button onClick={saveOrder} className="font-body text-xs font-bold px-4 py-2 rounded-full text-white inline-flex items-center gap-1.5" style={{ backgroundColor: FERN }}>
                  {savedTick === 'order' ? <><Check size={13} /> Saved</> : 'Save order'}
                </button>
                <button onClick={resetOrder} className="font-body text-xs font-bold px-4 py-2 rounded-full" style={{ color: INK_2, border: `1px solid ${HAIR}` }}>Reset to 1→{allIds.length}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
