'use client'

// Public whole-inventory page — the target of the shop-shelf QR. No login: it
// lists every irrigation part and lets the crew bump each count up or down. It
// requires the club parts key (?k=) in the link, so the fixed URL alone isn't
// enough to reach it. View + adjust stock only — no editing, deleting, costs,
// suppliers, or anything else in the app.
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Search, AlertTriangle, Minus, Plus, Loader2, Image as ImageIcon } from 'lucide-react'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const isLow = (p) => p.lowStock > 0 && p.stock <= p.lowStock

function Inventory() {
  const k = useSearchParams().get('k')
  const [parts, setParts] = useState([])
  const [state, setState] = useState('loading') // loading | ok | denied | error
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [lowOnly, setLowOnly] = useState(false)
  const [busy, setBusy] = useState({})
  const [errMsg, setErrMsg] = useState('')

  const load = useCallback(async () => {
    if (!k) { setState('denied'); return }
    try {
      const r = await fetch(`/api/part?k=${encodeURIComponent(k)}`, { cache: 'no-store' })
      if (r.status === 401) { setState('denied'); return }
      const d = await r.json().catch(() => null)
      if (!r.ok) { setErrMsg(d?.error || `Server error ${r.status}`); setState('error'); return }
      setParts(d.parts || []); setState('ok')
    } catch (e) { setErrMsg(String(e?.message || e)); setState('error') }
  }, [k])
  useEffect(() => { load() }, [load])

  const bump = async (p, delta) => {
    const next = Math.max(0, (Number(p.stock) || 0) + delta)
    setParts((cur) => cur.map((x) => (x.id === p.id ? { ...x, stock: next } : x)))
    setBusy((b) => ({ ...b, [p.id]: true }))
    try {
      const r = await fetch('/api/part', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, delta }) })
      if (r.ok) { const u = await r.json(); setParts((cur) => cur.map((x) => (x.id === p.id ? { ...x, stock: u.stock } : x))) }
    } catch { /* ignore */ }
    setBusy((b) => ({ ...b, [p.id]: false }))
  }

  const cats = useMemo(() => [...new Set(parts.map((p) => p.category).filter(Boolean))].sort(), [parts])
  const lowCount = useMemo(() => parts.filter(isLow).length, [parts])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return parts.filter((p) => {
      if (cat !== 'all' && p.category !== cat) return false
      if (lowOnly && !isLow(p)) return false
      if (!needle) return true
      return [p.partNumber, p.name, p.brand, p.size, p.location].some((f) => String(f || '').toLowerCase().includes(needle))
    })
  }, [parts, q, cat, lowOnly])

  if (state === 'loading') return <Center><Loader2 className="animate-spin" size={26} style={{ color: '#cbd5e1' }} /></Center>
  if (state === 'denied') return <Center><p className="font-body text-sm text-slate-400 text-center px-6">This inventory link is invalid or expired. Ask for a fresh QR code.</p></Center>
  if (state === 'error') return <Center><div className="text-center px-6"><p className="font-body text-sm text-slate-500">Couldn’t load the inventory.</p>{errMsg && <p className="font-body text-[12px] text-slate-400 mt-2">Reason: {errMsg}</p>}<button onClick={() => { setState('loading'); load() }} className="mt-3 font-body text-xs font-bold px-4 py-2 rounded-full text-white" style={{ backgroundColor: FOREST }}>Try again</button></div></Center>

  return (
    <div style={{ minHeight: '100vh', background: '#EEF1EE' }}>
      <div style={{ background: FOREST }} className="text-white px-4 py-3 sticky top-0 z-10">
        <p className="font-display text-lg font-semibold">Parts Inventory</p>
        <p className="font-body text-[11px] text-white/60">Tap −/+ to update counts as you pull or return parts</p>
      </div>
      <div className="max-w-2xl mx-auto px-3 py-3">
        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search parts…" className="w-full border border-slate-200 rounded-full pl-9 pr-3 py-2 text-sm font-body bg-white" />
          </div>
          <button onClick={() => setLowOnly((v) => !v)} className="font-body text-xs font-bold px-3 py-2 rounded-full flex items-center gap-1.5 shrink-0" style={lowOnly ? { backgroundColor: '#DC2626', color: 'white' } : { backgroundColor: 'white', color: lowCount ? '#DC2626' : '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>
            <AlertTriangle size={13} /> Low{lowCount ? ` (${lowCount})` : ''}
          </button>
        </div>
        {cats.length > 0 && (
          <div className="flex gap-2 mb-3 overflow-x-auto no-scrollbar [&>*]:shrink-0 pb-1">
            <Chip on={cat === 'all'} onClick={() => setCat('all')}>All</Chip>
            {cats.map((c) => <Chip key={c} on={cat === c} onClick={() => setCat(c)}>{c}</Chip>)}
          </div>
        )}
        <div className="space-y-2">
          {shown.map((p) => {
            const low = isLow(p)
            return (
              <div key={p.id} className="bg-white rounded-2xl border shadow-sm flex items-center gap-3 p-2.5" style={{ borderColor: low ? '#F3C6C6' : 'rgba(0,0,0,0.06)' }}>
                {p.photo ? <img src={p.photo} alt="" className="w-14 h-14 object-cover rounded-xl bg-slate-50 shrink-0" /> : <div className="w-14 h-14 rounded-xl bg-slate-100 flex items-center justify-center shrink-0"><ImageIcon size={16} className="text-slate-300" /></div>}
                <div className="min-w-0 flex-1">
                  <p className="font-body text-sm font-bold text-slate-800 leading-tight truncate">{p.name || p.partNumber || '(part)'}</p>
                  <p className="font-body text-[11px] text-slate-400 truncate">{[p.partNumber && `#${p.partNumber}`, p.location].filter(Boolean).join(' · ')}</p>
                  <p className="font-body text-sm font-bold mt-0.5" style={{ color: low ? '#DC2626' : FOREST }}>{p.stock} <span className="text-[11px] font-normal text-slate-400">{p.unit}{low ? ' · low' : ''}</span></p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => bump(p, -1)} disabled={busy[p.id]} className="w-9 h-9 rounded-full flex items-center justify-center border border-slate-200 bg-white active:bg-slate-100"><Minus size={16} style={{ color: FOREST }} /></button>
                  <button onClick={() => bump(p, 1)} disabled={busy[p.id]} className="w-9 h-9 rounded-full flex items-center justify-center text-white" style={{ backgroundColor: FERN }}><Plus size={16} /></button>
                </div>
              </div>
            )
          })}
          {shown.length === 0 && <p className="font-body text-sm text-slate-400 text-center py-10">No parts match.</p>}
        </div>
      </div>
    </div>
  )
}

function Chip({ on, onClick, children }) {
  return <button onClick={onClick} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap" style={on ? { backgroundColor: FERN, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>{children}</button>
}
function Center({ children }) {
  return <div style={{ minHeight: '100vh', background: '#EEF1EE' }} className="flex items-center justify-center">{children}</div>
}

export default function Page() {
  return <Suspense fallback={<Center><Loader2 className="animate-spin" size={26} style={{ color: '#cbd5e1' }} /></Center>}><Inventory /></Suspense>
}
