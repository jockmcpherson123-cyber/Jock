'use client'

// Mowing Routes — lives in the Job Board module.
//
// TWO parts:
//  • Route sets — build and LOCK a greens layout for each mower-count (4–8).
//    You hand-assign which greens each mower gets; it's saved and stays put.
//  • Today — you pick the PEOPLE mowing greens. The number of people you pick
//    IS the number of mowers, so the app pulls the matching locked route and
//    drops each person's greens onto today's Job Board under their name. No
//    "how many" to choose — selecting people decides it.
//
// Greens = the course's holes (1..N) + any practice greens set in Settings.
// Everything saves in the courseInfo blob (no new table).
import { useState, useEffect } from 'react'
import { ChevronUp, ChevronDown, Scissors, X, Check, Info, Loader2, Lock, Plus } from 'lucide-react'
import * as db from '@/lib/db'
import { localDateISO } from '@/lib/dates'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#B9982F'
const PAPER = '#F9F8F5'
const HAIR = '#E2E0DB'
const INK = '#1b2420'
const INK_2 = '#5B6160'
const INK_3 = '#8A8984'
const MOWER_COLORS = ['#3A6B4A', '#2B6C8F', '#9A6B12', '#6D4AC2', '#B23A2E', '#0E7C7B', '#8A5A2B', '#4B5563']
const MOW_JOB = 'Greens Mowing'
const DEFAULT_MAX_SET = 8 // counts 1..this shown by default; "+" adds more

function greensForCourse(course) {
  const holes = Number(course?.holes) || 0
  const out = []
  for (let i = 1; i <= holes; i++) out.push({ id: String(i), label: `#${i}` })
  ;(course?.practiceGreens || []).forEach((nm) => { const n = String(nm).trim(); if (n) out.push({ id: `p:${n}`, label: n }) })
  return out
}
function reconcileOrder(saved, allIds) {
  const s = (saved || []).filter((id) => allIds.includes(id))
  return [...s, ...allIds.filter((id) => !s.includes(id))]
}
function splitEven(arr, n) {
  const out = []
  const base = Math.floor(arr.length / n)
  const rem = arr.length % n
  let i = 0
  for (let k = 0; k < n; k++) { const size = base + (k < rem ? 1 : 0); out.push(arr.slice(i, i + size)); i += size }
  return out
}
// Bring a saved layout up to date with the current greens: keep valid ids, drop
// any that vanished, and drop any greens on NO mower onto the last one so nothing
// is lost. A green may sit on more than one mower (e.g. 2 mowers on the practice
// greens), so we only de-dup WITHIN a mower, not across them. If the saved layout
// doesn't match the count, start from an even split.
function reconcileGroups(groups, count, allIds, order) {
  const fallback = () => splitEven(reconcileOrder(order, allIds), count)
  if (!Array.isArray(groups) || groups.length !== count) return fallback()
  const g = groups.map((arr) => [...new Set((arr || []).filter((id) => allIds.includes(id)))])
  const covered = new Set(g.flat())
  const missing = reconcileOrder(order, allIds).filter((id) => !covered.has(id))
  if (missing.length && g.length) g[g.length - 1] = [...g[g.length - 1], ...missing]
  return g
}

export default function MowingRoutes({ courses = [], courseInfo = {}, roster = [], manage, onSave }) {
  const courseNames = courses.map((c) => c.name).filter(Boolean)
  const [courseName, setCourseName] = useState(courseNames[0] || '')
  const course = courses.find((c) => c.name === courseName) || courses[0] || {}
  const greens = greensForCourse(course)
  const allIds = greens.map((g) => g.id)
  const labelOf = (id) => greens.find((g) => g.id === id)?.label || id
  const todayIso = localDateISO()

  const [mode, setMode] = useState('today') // 'today' | 'sets'
  const [order, setOrder] = useState(reconcileOrder(courseInfo.mowingOrder?.[courseName], allIds))
  const [showOrder, setShowOrder] = useState(false)

  // Look up (or fall back to) the layout for a given mower-count.
  const layoutFor = (count) => {
    if (count < 1) return []
    const saved = courseInfo.mowingSets?.[courseName]?.[count]?.groups
    return reconcileGroups(saved, count, allIds, order)
  }
  const hasLockedSet = (count) => {
    const saved = courseInfo.mowingSets?.[courseName]?.[count]?.groups
    return Array.isArray(saved) && saved.length === count
  }

  // ── Route sets (setup) ─────────────────────────────────────────────────────
  const savedCountsFor = (cn) => Object.keys(courseInfo.mowingSets?.[cn] || {}).map(Number).filter((n) => n > 0)
  const [setCnt, setSetCnt] = useState(5)
  const [maxSet, setMaxSet] = useState(Math.max(DEFAULT_MAX_SET, ...savedCountsFor(courseName)))
  const countButtons = Array.from({ length: maxSet }, (_, i) => i + 1)
  const [setGroups, setSetGroups] = useState([])
  const [setSaved, setSetSaved] = useState(false)
  useEffect(() => {
    setSetGroups(layoutFor(setCnt)); setSetSaved(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseName, setCnt])

  // Toggle a green on/off a given mower. A green can be on several mowers at once
  // (two mowers sharing the practice greens, say).
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
  const setAssigned = new Set(setGroups.flat())
  const setUnassigned = allIds.filter((id) => !setAssigned.has(id))

  // ── Today (pick people → auto to board) ────────────────────────────────────
  const savedToday = courseInfo.mowingToday?.[courseName]
  const [people, setPeople] = useState(savedToday && savedToday.date === todayIso ? (savedToday.people || []) : [])
  const [touched, setTouched] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [synced, setSynced] = useState(false)

  // Re-seed when the course changes.
  useEffect(() => {
    const c = courses.find((x) => x.name === courseName) || {}
    const ids = greensForCourse(c).map((g) => g.id)
    setOrder(reconcileOrder(courseInfo.mowingOrder?.[courseName], ids))
    const st = courseInfo.mowingToday?.[courseName]
    setPeople(st && st.date === todayIso ? (st.people || []) : [])
    setMaxSet(Math.max(DEFAULT_MAX_SET, ...savedCountsFor(courseName)))
    setTouched(false); setSynced(false); setShowOrder(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseName])

  const todayLayout = layoutFor(people.length)
  const addPerson = (name) => { if (name && !people.includes(name)) { setTouched(true); setPeople((p) => [...p, name]) } }
  const removePerson = (name) => { setTouched(true); setPeople((p) => p.filter((x) => x !== name)) }
  const movePerson = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= people.length) return
    setTouched(true)
    setPeople((p) => { const n = [...p]; [n[i], n[j]] = [n[j], n[i]]; return n })
  }

  const pushToBoard = async () => {
    setSyncing(true)
    try {
      // remember today's crew for this course
      const mt = { ...(courseInfo.mowingToday || {}) }
      mt[courseName] = { date: todayIso, people }
      onSave({ mowingToday: mt })
      const existing = await db.fetchCrewTasks(todayIso, todayIso)
      for (const t of existing) { if (t.job === MOW_JOB && String(t.course || '') === String(courseName || '')) await db.deleteCrewTask(t.id) }
      const lay = layoutFor(people.length)
      const rows = people.map((name, i) => ({ date: todayIso, job: MOW_JOB, assignee: name, equipment: `Mower ${i + 1}`, course: courseName || '', status: 'todo', sort: i, notes: (lay[i] || []).map(labelOf).join(', ') })).filter((r) => r.assignee)
      if (rows.length) await db.addCrewTasks(rows)
      setSynced(true); setTimeout(() => setSynced(false), 2500)
    } catch (e) { console.error(e) }
    setSyncing(false)
  }
  useEffect(() => {
    if (!manage || !touched) return
    const id = setTimeout(() => { pushToBoard() }, 700)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, touched])

  // ── Empty state ────────────────────────────────────────────────────────────
  if (allIds.length === 0) {
    return (
      <div className="p-8 text-center" style={{ backgroundColor: PAPER, border: `1px solid ${HAIR}`, borderRadius: 12 }}>
        <Scissors size={26} style={{ color: HAIR }} className="mx-auto mb-3" />
        <p className="font-body text-sm" style={{ color: INK_2 }}>Set this course's holes (and any practice greens) in <b>Settings → Course Info</b> first — then the greens show up here to route.</p>
      </div>
    )
  }

  const availableRoster = roster.filter((r) => !people.includes(r))

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

      {/* Today / Route sets toggle (managers) */}
      {manage && (
        <div className="flex gap-1.5 mb-4">
          {[['today', 'Today'], ['sets', 'Route sets']].map(([k, lbl]) => (
            <button key={k} onClick={() => setMode(k)} className="font-body text-xs font-bold px-3.5 py-2 rounded-lg transition"
              style={mode === k ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: PAPER, color: INK_2, border: `1px solid ${HAIR}` }}>{lbl}</button>
          ))}
        </div>
      )}

      {/* ══ TODAY ══ */}
      {(mode === 'today' || !manage) && (
        <div>
          {manage ? (
            <>
              <div className="flex items-center gap-2 mb-1.5">
                <Scissors size={15} style={{ color: FERN }} />
                <p className="font-body text-sm font-bold" style={{ color: FOREST }}>Who's mowing {courseName ? courseName + ' greens' : 'greens'} today?</p>
              </div>
              <p className="font-body text-[11px] mb-2.5" style={{ color: INK_3 }}>Pick the people going out — however many you pick is how many mowers, and it pulls that locked route. They land on the Job Board under their names automatically.</p>

              {/* selected people, in order → mower slots */}
              {people.length > 0 && (
                <div className="space-y-2 mb-3">
                  {people.map((name, i) => {
                    const color = MOWER_COLORS[i % MOWER_COLORS.length]
                    const gr = todayLayout[i] || []
                    return (
                      <div key={name} className="p-2.5 rounded-xl" style={{ backgroundColor: PAPER, border: `1px solid ${HAIR}`, borderLeft: `4px solid ${color}` }}>
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="font-body text-[13px] font-bold flex-1 truncate" style={{ color: INK }}>{name}</span>
                          <span className="font-body text-[10px] font-bold uppercase tracking-wide" style={{ color }}>Mower {i + 1}</span>
                          <button onClick={() => movePerson(i, -1)} disabled={i === 0} className="p-0.5 disabled:opacity-25" style={{ color: INK_2 }}><ChevronUp size={15} /></button>
                          <button onClick={() => movePerson(i, 1)} disabled={i === people.length - 1} className="p-0.5 disabled:opacity-25" style={{ color: INK_2 }}><ChevronDown size={15} /></button>
                          <button onClick={() => removePerson(name)} style={{ color: INK_3 }}><X size={15} /></button>
                        </div>
                        {gr.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {gr.map((gid) => <span key={gid} className="font-body text-[12px] font-bold rounded-md px-2 py-0.5 tnum" style={{ backgroundColor: `${color}15`, color }}>{labelOf(gid)}</span>)}
                          </div>
                        ) : <p className="font-body text-[11px]" style={{ color: INK_3 }}>No greens</p>}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* add a person */}
              {availableRoster.length > 0 && (
                <select value="" onChange={(e) => { if (e.target.value) addPerson(e.target.value) }} className="w-full sm:w-auto font-body text-sm rounded-lg px-3 py-2 bg-white mb-1" style={{ border: `1px solid ${HAIR}`, color: INK_2 }}>
                  <option value="">+ Add a mower operator…</option>
                  {availableRoster.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              )}
              {roster.length === 0 && <p className="font-body text-[11px]" style={{ color: INK_3 }}>Add crew in the <b>Crew</b> tab first.</p>}

              {/* status + which route is in use */}
              {people.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-body text-[12px] rounded-lg px-3 py-2" style={{ backgroundColor: PAPER, border: `1px solid ${HAIR}`, color: INK_2 }}>
                    {syncing ? <><Loader2 size={13} className="animate-spin" style={{ color: FERN }} /> Updating today’s Job Board…</>
                      : synced ? <span style={{ color: FERN }}><Check size={13} className="inline mr-1" />Live on today’s Job Board</span>
                        : <><Scissors size={13} style={{ color: INK_3 }} /> {people.length} mower{people.length !== 1 ? 's' : ''} · they update the Job Board as you change them.</>}
                  </div>
                  {!hasLockedSet(people.length) && (
                    <p className="font-body text-[11px]" style={{ color: '#92660D' }}>No locked {people.length}-mower route yet — using an even split for now. Build one under <b>Route sets</b> and it’ll lock in.</p>
                  )}
                </div>
              )}
            </>
          ) : (
            // Crew read-only view
            <div>
              <p className="font-body text-sm font-bold mb-2" style={{ color: FOREST }}>{courseName ? courseName + ' greens' : 'Greens'} mowing — today</p>
              {(savedToday && savedToday.date === todayIso && (savedToday.people || []).length) ? (
                <div className="space-y-2">
                  {savedToday.people.map((name, i) => {
                    const color = MOWER_COLORS[i % MOWER_COLORS.length]
                    const gr = layoutFor(savedToday.people.length)[i] || []
                    return (
                      <div key={name} className="p-2.5 rounded-xl" style={{ backgroundColor: PAPER, border: `1px solid ${HAIR}`, borderLeft: `4px solid ${color}` }}>
                        <p className="font-body text-[13px] font-bold mb-1" style={{ color: INK }}>{name}</p>
                        <div className="flex flex-wrap gap-1.5">{gr.map((gid) => <span key={gid} className="font-body text-[12px] font-bold rounded-md px-2 py-0.5 tnum" style={{ backgroundColor: `${color}15`, color }}>{labelOf(gid)}</span>)}</div>
                      </div>
                    )
                  })}
                </div>
              ) : <p className="font-body text-sm" style={{ color: INK_3 }}>No greens mowing set for today yet.</p>}
            </div>
          )}
        </div>
      )}

      {/* ══ ROUTE SETS (setup) ══ */}
      {manage && mode === 'sets' && (
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <Lock size={14} style={{ color: FERN }} />
            <p className="font-body text-sm font-bold" style={{ color: FOREST }}>Locked routes for {courseName || 'this course'}</p>
          </div>
          <p className="font-body text-[11px] mb-2.5" style={{ color: INK_3 }}>Build a route for each mower-count you run. Pick a count, arrange which greens each mower gets, then Save — it locks in and gets pulled automatically when that many people mow.</p>

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

          {/* Grid: greens down the side, mowers across the top. Tap a box to put
              that green on that mower. A green can be ticked under several. */}
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

          {setUnassigned.length > 0 && (
            <p className="font-body text-[11px] mb-2" style={{ color: '#B23A2E' }}>⚠ Not on any mower: {setUnassigned.map(labelOf).join(', ')} — tap a green to move it on.</p>
          )}

          <div className="flex items-center gap-2">
            <button onClick={saveSet} className="font-body text-xs font-bold px-4 py-2.5 rounded-full text-white inline-flex items-center gap-1.5" style={{ backgroundColor: FOREST }}>
              {setSaved ? <><Check size={14} /> Locked in</> : <><Lock size={13} /> Save &amp; lock this {setCnt}-mower route</>}
            </button>
          </div>

          {/* base order (seeds a fresh count before you tweak it) */}
          <div className="mt-5">
            <button onClick={() => setShowOrder((v) => !v)} className="font-body text-xs font-bold flex items-center gap-1.5" style={{ color: FERN }}>
              {showOrder ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Starting order (used before you tweak a new count)
            </button>
            {showOrder && (
              <div className="mt-2 p-3 rounded-xl" style={{ backgroundColor: PAPER, border: `1px solid ${HAIR}` }}>
                <p className="font-body text-[11px] mb-2 flex items-start gap-1" style={{ color: INK_3 }}><Info size={12} className="mt-0.5 shrink-0" /> When you first open a mower-count, greens are split evenly in this order — then you arrange &amp; lock. Editing the order only affects counts you haven't locked yet.</p>
                <div className="space-y-1">
                  {order.map((id, i) => (
                    <div key={id} className="flex items-center gap-2 py-1 px-2 rounded-lg" style={{ backgroundColor: 'white', border: `1px solid ${HAIR}` }}>
                      <span className="font-body text-[10px] font-bold tnum w-6" style={{ color: INK_3 }}>{i + 1}.</span>
                      <span className="font-body text-[13px] font-semibold flex-1 tnum" style={{ color: INK }}>{labelOf(id)}</span>
                      <button onClick={() => { const j = i - 1; if (j < 0) return; setOrder((o) => { const n = [...o]; [n[i], n[j]] = [n[j], n[i]]; return n }) }} disabled={i === 0} className="p-1 disabled:opacity-25" style={{ color: INK_2 }}><ChevronUp size={15} /></button>
                      <button onClick={() => { const j = i + 1; if (j >= order.length) return; setOrder((o) => { const n = [...o]; [n[i], n[j]] = [n[j], n[i]]; return n }) }} disabled={i === order.length - 1} className="p-1 disabled:opacity-25" style={{ color: INK_2 }}><ChevronDown size={15} /></button>
                    </div>
                  ))}
                </div>
                <button onClick={() => onSave({ mowingOrder: { ...(courseInfo.mowingOrder || {}), [courseName]: order } })} className="font-body text-xs font-bold px-4 py-2 rounded-full text-white mt-3 inline-flex items-center gap-1.5" style={{ backgroundColor: FERN }}>Save order</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
