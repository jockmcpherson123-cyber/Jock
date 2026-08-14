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
import { Scissors, Check, Lock, Plus, GripVertical, Printer } from 'lucide-react'
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

  // Print one palm-size card per mower for this route — the greens each guy mows
  // as a route (arrows to the next green), in the mower's colour. Cut and hand out.
  const printCards = () => {
    const esc = (x) => String(x ?? '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]))
    const tint = (hex, a) => { const h = hex.replace('#', ''); const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); return `rgba(${r},${g},${b},${a})` }
    const cards = setGroups.map((grp, mi) => {
      const c = MOWER_COLORS[mi % MOWER_COLORS.length]
      const mine = order.filter((id) => grp.includes(id)).map(labelOf) // greens in mow order
      const items = mine.length
        ? mine.map((lb) => `<span class="g">${esc(lb)}</span>`).join(`<span class="arw" style="color:${c}">→</span>`)
        : '<span class="none">No greens on this mower</span>'
      return `<div class="card" style="border-color:${c};background:${tint(c, 0.06)}">
          <div class="band" style="background:${c}">
            <div class="m">Mower ${mi + 1}</div>
            <div class="sub">${esc(courseName)} · Greens · ${mine.length} green${mine.length === 1 ? '' : 's'}</div>
          </div>
          <div class="greens">${items}</div>
        </div>`
    }).join('')
    const w = window.open('', '_blank'); if (!w) return
    w.document.write(`<html><head><title>${esc(courseName)} Mowing Cards — ${setCnt} mowers</title><style>
      @page { margin: 0.4in; }
      * { box-sizing: border-box; }
      html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body { font-family: -apple-system, Helvetica, Arial, sans-serif; margin: 0; padding: 0; }
      .wrap { font-size: 0; }  /* kills inline-block whitespace gaps */
      .card { display: inline-block; vertical-align: top; width: 3.4in; min-height: 2.05in; margin: 0 0.16in 0.16in 0; border: 2px solid #ccc; border-radius: 10px; overflow: hidden; break-inside: avoid; page-break-inside: avoid; -webkit-column-break-inside: avoid; }
      .band { color: #fff; padding: 7px 11px; }
      .band .m { font-size: 19px; font-weight: 800; line-height: 1.1; }
      .band .sub { font-size: 10px; opacity: .92; margin-top: 1px; }
      .greens { padding: 9px 12px; line-height: 1.9; }
      .g { font-size: 17px; font-weight: 800; color: #16291F; }
      .arw { font-size: 15px; font-weight: 800; margin: 0 6px; }
      .none { font-size: 12px; color: #999; }
    </style></head><body><div class="wrap">${cards}</div></body></html>`)
    w.document.close(); w.focus(); setTimeout(() => { try { w.print() } catch { /* ignore */ } }, 350)
  }
  // Drag to reorder greens (grab the handle, slide up/down). Uses Pointer Events
  // so it works with touch on the iPad; elementFromPoint finds the row you're
  // over, and we live-shuffle the order as you drag. We stop text-selection on
  // the whole page while dragging so nothing highlights as your finger passes
  // over the rows, and only reorder once you're past a row's midpoint so it
  // doesn't jitter back and forth.
  const [dragId, setDragId] = useState(null)
  const stopSelect = (on) => {
    const v = on ? 'none' : ''
    document.body.style.userSelect = v
    document.body.style.webkitUserSelect = v
  }
  const onDragStart = (e, id) => {
    e.preventDefault()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    stopSelect(true); setDragId(id)
  }
  const onDragMove = (e) => {
    if (!dragId) return
    e.preventDefault()
    const el = document.elementFromPoint(e.clientX, e.clientY)
    const rowEl = el && el.closest ? el.closest('[data-green-id]') : null
    const overId = rowEl && rowEl.getAttribute('data-green-id')
    if (!overId || overId === dragId) return
    // Only move once you've crossed the middle of the row you're over — keeps
    // the reorder from flickering while you hover on a boundary.
    const r = rowEl.getBoundingClientRect()
    const past = e.clientY > r.top + r.height / 2
    setOrder((o) => {
      const from = o.indexOf(dragId); let to = o.indexOf(overId)
      if (from < 0 || to < 0) return o
      if (from < to && !past) to -= 1
      if (from > to && past) to += 1
      if (from === to) return o
      const n = [...o]; n.splice(from, 1); n.splice(to, 0, dragId); return n
    })
    setSetSaved(false)
  }
  const onDragEnd = () => { stopSelect(false); setDragId(null) }
  useEffect(() => () => stopSelect(false), [])

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
          <table style={{ borderCollapse: 'collapse', width: '100%', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}>
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
                  <tr key={green.id} data-green-id={green.id} style={{ borderTop: `1px solid ${HAIR}`, opacity: dragId === green.id ? 0.5 : 1 }}>
                    <td className="px-1.5 py-1 whitespace-nowrap" style={{ position: 'sticky', left: 0, backgroundColor: dragId === green.id ? '#EAF2EC' : rowBg, zIndex: 1 }}>
                      <div className="flex items-center gap-1.5">
                        <span onPointerDown={(e) => onDragStart(e, green.id)} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}
                          className="flex items-center justify-center shrink-0 rounded-md" style={{ touchAction: 'none', cursor: dragId === green.id ? 'grabbing' : 'grab', color: dragId === green.id ? FERN : INK_3, backgroundColor: dragId === green.id ? '#EAF2EC' : '#F1F1EE', width: 34, height: 32, border: `1px solid ${HAIR}` }} aria-label="Drag to reorder">
                          <GripVertical size={18} />
                        </span>
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
      <p className="font-body text-[11px] mb-2" style={{ color: INK_3 }}><b>Drag the ⣿ handle</b> to set the mow order (practice greens first, nursery last, etc.). Tap a box to put a green on a mower — tick <b>more than one</b> to share it. A <span style={{ color: '#B23A2E' }}>red row</span> means a green isn't on any mower yet.</p>

      {unassigned.length > 0 && (
        <p className="font-body text-[11px] mb-2" style={{ color: '#B23A2E' }}>⚠ Not on any mower: {unassigned.map(labelOf).join(', ')}</p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={saveSet} className="font-body text-xs font-bold px-4 py-2.5 rounded-full text-white inline-flex items-center gap-1.5" style={{ backgroundColor: FOREST }}>
          {setSaved ? <><Check size={14} /> Locked in</> : <><Lock size={13} /> Save &amp; lock this {setCnt}-mower route</>}
        </button>
        <button onClick={printCards} disabled={unassigned.length === allIds.length} className="font-body text-xs font-bold px-4 py-2.5 rounded-full inline-flex items-center gap-1.5 disabled:opacity-40" style={{ color: FOREST, border: `1px solid ${HAIR}`, backgroundColor: PAPER }}>
          <Printer size={13} /> Print cards ({setCnt})
        </button>
      </div>
      <p className="font-body text-[10px] mt-2" style={{ color: INK_3 }}>Saves this route <b>and</b> the mow order for {courseName || 'this course'}. <b>Print cards</b> makes one palm-size card per mower — the greens they mow, in order — to hand out.</p>
    </div>
  )
}
