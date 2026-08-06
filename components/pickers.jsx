'use client'

// Shared searchable pickers used on the spray sheet and the Annual Program.
import { useState, useEffect, useRef } from 'react'
import { Check } from 'lucide-react'

const FERN = '#3A6B4A'

// Normalise an option to { value, label }. Plain strings map to themselves;
// objects may carry a separate value and display label (e.g. 9 → "9 holes").
const normOpt = (o) => (o && typeof o === 'object' ? { value: o.value, label: o.label ?? String(o.value) } : { value: o, label: String(o) })

// Searchable single-select restricted to the given options — type to filter
// (A–Z), tap a match to pick. Shows the chosen value when closed. Options may be
// plain strings, or { value, label } when the stored value differs from the
// text shown (holes count, language code, a blank "none" choice).
export function SearchSelect({ value, options = [], onPick, placeholder = 'Search…', sort = true }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const wrapRef = useRef(null)
  useEffect(() => {
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  const norm = options.map(normOpt)
  const ordered = sort ? [...norm].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })) : norm
  const query = q.trim().toLowerCase()
  const matches = query ? ordered.filter((o) => o.label.toLowerCase().includes(query)) : ordered
  const current = norm.find((o) => o.value === value)
  // Prefer the option's label; fall back to the raw value so a stored choice that
  // is no longer in the list (e.g. a removed crew member on an old sheet) still shows.
  const shown = current ? current.label : (value != null && value !== '' ? String(value) : '')
  const pick = (v) => { onPick(v); setQ(''); setOpen(false) }
  return (
    <div ref={wrapRef} className="relative w-full min-w-0">
      <input value={open ? q : shown} onChange={(e) => { setQ(e.target.value); setOpen(true) }} onFocus={() => { setQ(''); setOpen(true) }}
        placeholder={shown || placeholder} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" />
      {open && (
        <div className="absolute z-40 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto overscroll-contain">
          {matches.length === 0 && <div className="px-3 py-2 text-sm text-slate-400 font-body">No matches</div>}
          {matches.map((o) => (
            <button key={String(o.value)} type="button" onMouseDown={(e) => { e.preventDefault(); pick(o.value) }}
              className="w-full text-left px-3 py-2 text-sm font-body hover:bg-slate-50" style={o.value === value ? { backgroundColor: '#EAF2EC', fontWeight: 700 } : {}}>{o.label === '' ? <span className="text-slate-400">— None —</span> : o.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

// Searchable multi-select that stays open — chips above, tap options to toggle
// several at once without re-opening.
export function MultiSelect({ selected = [], options = [], onToggle, placeholder = 'Search…', accent = FERN, hideChips = false }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const wrapRef = useRef(null)
  useEffect(() => {
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  const sorted = [...options].sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }))
  const query = q.trim().toLowerCase()
  const matches = query ? sorted.filter((o) => String(o).toLowerCase().includes(query)) : sorted
  return (
    <div ref={wrapRef} className="relative">
      {!hideChips && selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {selected.map((tg) => (
            <span key={tg} className="font-body text-[11px] font-semibold px-2.5 py-1 rounded-full flex items-center gap-1" style={{ backgroundColor: '#EAF2EC', color: accent, border: '1px solid #D5E5DA' }}>
              {tg}<button type="button" onClick={() => onToggle(tg)} className="opacity-60 hover:opacity-100">×</button>
            </span>
          ))}
        </div>
      )}
      <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} placeholder={placeholder}
        className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-body bg-white" />
      {open && (
        <div className="absolute z-40 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {matches.length === 0 && <div className="px-3 py-2 text-sm text-slate-400 font-body">No matches</div>}
          {matches.map((o) => {
            const on = selected.includes(o)
            return (
              <button key={o} type="button" onMouseDown={(e) => { e.preventDefault(); onToggle(o) }} className="w-full text-left px-3 py-2 text-sm font-body hover:bg-slate-50 flex items-center gap-2">
                <span className="inline-flex items-center justify-center rounded shrink-0" style={{ width: 16, height: 16, border: `1.5px solid ${on ? accent : '#CBD5E1'}`, backgroundColor: on ? accent : 'white' }}>{on && <Check size={11} color="white" />}</span>
                <span className="flex-1">{o}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
