'use client'

// Height-of-cut editor — one maintained list of surfaces + heights, stored in
// club settings (courseInfo.hocList). Shared by the Turf Performance section
// and the Weekly Report so editing in either place keeps both in sync.
import { useState, useEffect, useMemo } from 'react'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const MOWED_SURFACE = /green|collar|tee|approach|fairway|surround|rough/i
const mowRe = /mow|height|hoc|cut/i
const surfRank = (n) => { const i = ['green', 'collar', 'tee', 'approach', 'fairway', 'surround', 'rough'].findIndex((x) => String(n).toLowerCase().includes(x)); return i < 0 ? 99 : i }

export default function HocEditor({ courseInfo = {}, areas = {}, practices = [], onSaveCourse, title = 'Height of cut — by surface', className = '' }) {
  const [rows, setRows] = useState(Array.isArray(courseInfo.hocList) ? courseInfo.hocList : [])
  // Re-sync if the stored list changes elsewhere (e.g. edited on the other screen).
  const extKey = JSON.stringify(courseInfo.hocList || [])
  useEffect(() => { setRows(Array.isArray(courseInfo.hocList) ? courseInfo.hocList : []) }, [extKey])

  const persist = (next) => { if (onSaveCourse) onSaveCourse({ hocList: next }) }
  const setRow = (id, patch) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const addRow = (surface = '', height = '') => { const next = [...rows, { id: `h${Date.now()}`, surface, height }]; setRows(next); persist(next) }
  const removeRow = (id) => { const next = rows.filter((r) => r.id !== id); setRows(next); persist(next) }
  const persistNow = () => persist(rows)

  const allMowed = useMemo(() => Object.keys(areas || {}).filter((a) => MOWED_SURFACE.test(a)).sort((a, b) => surfRank(a) - surfRank(b) || a.localeCompare(b)), [areas])
  const hocByArea = useMemo(() => {
    const m = {}
    practices.forEach((p) => { if (mowRe.test(p.practice || '') && p.value != null && p.value !== '' && !m[p.area]) m[p.area] = `${p.value}${/["']|in|mm/i.test(String(p.unit)) ? p.unit : (p.unit ? ' ' + p.unit : '"')}` })
    return m
  }, [practices])
  const seed = () => { const next = allMowed.map((a, i) => ({ id: `h${Date.now()}_${i}`, surface: a, height: hocByArea[a] || '' })); setRows(next); persist(next) }

  return (
    <div className={`rounded-xl border border-slate-200 p-3 ${className}`}>
      <div className="flex items-center justify-between mb-1.5">
        <label className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400">{title}</label>
        <div className="flex gap-2">
          {rows.length === 0 && allMowed.length > 0 && <button onClick={seed} className="font-body text-[11px] font-bold" style={{ color: FERN }}>Add my surfaces</button>}
          <button onClick={() => addRow()} className="font-body text-[11px] font-bold" style={{ color: FOREST }}>+ Add surface</button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="font-body text-[11px] text-slate-400">Add each mowed surface and its height of cut — e.g. Blue Greens · 0.105″.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-1.5">
              <input value={r.surface} onChange={(e) => setRow(r.id, { surface: e.target.value })} onBlur={persistNow} placeholder="Surface" className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm font-body" />
              <input value={r.height} onChange={(e) => setRow(r.id, { height: e.target.value })} onBlur={persistNow} placeholder="0.105″" className="w-20 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm font-body text-right" />
              <button onClick={() => removeRow(r.id)} className="text-slate-300 hover:text-red-500 shrink-0 px-1 font-bold" aria-label="Remove surface">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
