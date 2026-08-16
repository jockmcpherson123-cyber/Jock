'use client'

// ── Irrigation Parts inventory ────────────────────────────────────────────────
// A stockroom for irrigation parts: part number, name, a photo, how many are on
// hand, and a low-stock level that flags reorders. Crew can bump the count up or
// down as they pull/return parts; managers add, edit and delete the parts.
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Plus, Search, Trash2, X, Check, Loader2, Image as ImageIcon, Package, AlertTriangle, Minus, Printer, FileDown, Copy, ClipboardList } from 'lucide-react'
import * as db from '@/lib/db'
import { SearchSelect } from '@/components/pickers'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#C9A84C'

const CATEGORIES = ['Head', 'Nozzle', 'Valve', 'Fitting', 'Pipe/PVC', 'Swing Joint', 'Wire/Splice', 'Controller', 'Sensor', 'Tool', 'Other']
const BRANDS = ['Toro', 'Rain Bird', 'Hunter', 'Nelson', 'Other']
const UNITS = ['each', 'box', 'ft', 'roll', 'case']

// Shrink a chosen photo before it's stored (keeps rows small + saves fast).
function compressPartPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new window.Image()
      img.onload = () => {
        const scale = Math.min(1, 1200 / img.width)
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale)
        const c = document.createElement('canvas'); c.width = w; c.height = h
        c.getContext('2d').drawImage(img, 0, 0, w, h)
        resolve(c.toDataURL('image/jpeg', 0.72))
      }
      img.onerror = reject
      img.src = reader.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

const isLow = (p) => p.lowStock > 0 && p.stock <= p.lowStock

export default function IrrigationParts({ manage = false }) {
  const [parts, setParts] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [lowOnly, setLowOnly] = useState(false)
  const [editing, setEditing] = useState(null) // part object or {} for new
  const [zoom, setZoom] = useState(null)        // photo data URL to show big
  const [ordering, setOrdering] = useState(false) // order-sheet builder open
  const [courseInfo, setCourseInfo] = useState({})

  const load = useCallback(async () => {
    try { setParts(await db.fetchParts()) } catch (e) { console.error(e) }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { db.fetchSettings().then((s) => setCourseInfo(s.courseInfo || {})).catch(() => {}) }, [])

  // Quick stock bump (crew pulling/returning a part) — optimistic + persisted.
  const bump = async (p, delta) => {
    const next = Math.max(0, (Number(p.stock) || 0) + delta)
    setParts((cur) => cur.map((x) => (x.id === p.id ? { ...x, stock: next } : x)))
    try { await db.updatePart(p.id, { stock: next }) } catch (e) { console.error(e); load() }
  }

  const lowCount = useMemo(() => parts.filter(isLow).length, [parts])
  const cats = useMemo(() => {
    const present = new Set(parts.map((p) => p.category).filter(Boolean))
    return CATEGORIES.filter((c) => present.has(c))
  }, [parts])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return parts.filter((p) => {
      if (cat !== 'all' && p.category !== cat) return false
      if (lowOnly && !isLow(p)) return false
      if (!needle) return true
      return [p.partNumber, p.name, p.brand, p.size, p.location, p.supplier, p.notes].some((f) => String(f || '').toLowerCase().includes(needle))
    })
  }, [parts, q, cat, lowOnly])

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">Irrigation Parts</h2>
          <p className="font-body text-sm text-slate-400">Your parts stockroom — what's on hand and what's running low</p>
        </div>
        <div className="flex items-center gap-2">
          {parts.length > 0 && (
            <button onClick={() => setOrdering(true)} className="font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5 border" style={{ color: FOREST, borderColor: FOREST, backgroundColor: 'white' }}>
              <ClipboardList size={14} /> Create order
            </button>
          )}
          {manage && (
            <button onClick={() => setEditing({})} className="font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5" style={{ backgroundColor: GOLD, color: FOREST }}>
              <Plus size={14} /> Add part
            </button>
          )}
        </div>
      </div>

      {/* Search + filters */}
      <div className="flex items-center gap-2 mt-3 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search part #, name, brand, location…" className="w-full border border-slate-200 rounded-full pl-9 pr-3 py-2 text-sm font-body bg-white" />
        </div>
        <button onClick={() => setLowOnly((v) => !v)} className="font-body text-xs font-bold px-3 py-2 rounded-full flex items-center gap-1.5 shrink-0" style={lowOnly ? { backgroundColor: '#DC2626', color: 'white' } : { backgroundColor: 'white', color: lowCount ? '#DC2626' : '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>
          <AlertTriangle size={13} /> Low stock{lowCount ? ` (${lowCount})` : ''}
        </button>
      </div>

      {/* Category chips */}
      {cats.length > 0 && (
        <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar [&>*]:shrink-0 pb-1">
          <Chip on={cat === 'all'} onClick={() => setCat('all')}>All ({parts.length})</Chip>
          {cats.map((c) => (
            <Chip key={c} on={cat === c} onClick={() => setCat(c)}>{c} ({parts.filter((p) => p.category === c).length})</Chip>
          ))}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-slate-300"><Loader2 className="animate-spin inline" size={26} /></div>
      ) : shown.length === 0 ? (
        <div className="bg-white rounded-2xl border border-black/5 p-10 text-center">
          <Package size={26} className="mx-auto text-slate-300 mb-2" />
          <p className="font-body text-sm text-slate-400">{parts.length === 0 ? 'No parts yet.' : 'Nothing matches your search.'}{manage && parts.length === 0 ? ' Tap “Add part” to start your stockroom.' : ''}</p>
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))' }}>
          {shown.map((p) => {
            const low = isLow(p)
            return (
              <div key={p.id} className="bg-white rounded-2xl border shadow-sm overflow-hidden flex flex-col" style={{ borderColor: low ? '#F3C6C6' : 'rgba(0,0,0,0.06)' }}>
                <div className="flex gap-3 p-3">
                  {p.photo ? (
                    <img src={p.photo} alt="" onClick={() => setZoom(p.photo)} className="w-20 h-20 object-cover rounded-xl bg-slate-50 shrink-0 cursor-zoom-in" />
                  ) : (
                    <div className="w-20 h-20 rounded-xl bg-slate-100 flex items-center justify-center shrink-0"><ImageIcon size={20} className="text-slate-300" /></div>
                  )}
                  <div className="min-w-0 flex-1" onClick={() => manage && setEditing(p)} style={{ cursor: manage ? 'pointer' : 'default' }}>
                    {p.partNumber && <p className="font-body text-[11px] font-bold tracking-wide" style={{ color: FERN }}>{p.partNumber}</p>}
                    <p className="font-body text-sm font-bold text-slate-800 leading-snug">{p.name || '(unnamed part)'}</p>
                    <p className="font-body text-[11px] text-slate-400 mt-0.5">{[p.brand, p.size, p.category].filter(Boolean).join(' · ')}</p>
                    {p.location && <p className="font-body text-[11px] text-slate-400 mt-0.5">📍 {p.location}</p>}
                  </div>
                </div>
                <div className="mt-auto flex items-center justify-between px-3 py-2 border-t" style={{ borderColor: 'rgba(0,0,0,0.05)', backgroundColor: low ? '#FEF2F2' : '#F8FAF8' }}>
                  <div>
                    <span className="font-display text-xl font-bold" style={{ color: low ? '#DC2626' : FOREST }}>{p.stock}</span>
                    <span className="font-body text-[11px] text-slate-400 ml-1">{p.unit}{low ? ` · low (≤${p.lowStock})` : p.lowStock > 0 ? ` · min ${p.lowStock}` : ''}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => bump(p, -1)} className="w-8 h-8 rounded-full flex items-center justify-center border border-slate-200 bg-white active:bg-slate-100" aria-label="Use one"><Minus size={15} style={{ color: FOREST }} /></button>
                    <button onClick={() => bump(p, 1)} className="w-8 h-8 rounded-full flex items-center justify-center text-white" style={{ backgroundColor: FERN }} aria-label="Add one"><Plus size={15} /></button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <PartEditor part={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }} />
      )}

      {ordering && (
        <OrderBuilder parts={parts} courseInfo={courseInfo} onClose={() => setOrdering(false)} />
      )}

      {zoom && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center p-3 bg-black/90" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" className="max-w-full max-h-full object-contain" />
          <button onClick={(e) => { e.stopPropagation(); setZoom(null) }} className="absolute top-4 right-4 text-white/80"><X size={26} /></button>
        </div>
      )}
    </div>
  )
}

function Chip({ on, onClick, children }) {
  return (
    <button onClick={onClick} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition" style={on ? { backgroundColor: FERN, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>{children}</button>
  )
}

const FieldLabel = ({ children }) => <p className="font-body text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">{children}</p>
const inp = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white'

// Add / edit one part — all fields, with a photo you can take or attach.
function PartEditor({ part, onClose, onSaved }) {
  const isNew = !part.id
  const [d, setD] = useState({
    partNumber: part.partNumber || '', name: part.name || '', category: part.category || '', brand: part.brand || '',
    size: part.size || '', photo: part.photo || '', stock: part.stock ?? '', lowStock: part.lowStock ?? '',
    unit: part.unit || 'each', location: part.location || '', supplier: part.supplier || '', price: part.price ?? '', notes: part.notes || '',
  })
  const [photoDirty, setPhotoDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const fileRef = useRef(null)
  const set = (patch) => setD((p) => ({ ...p, ...patch }))
  const setPhoto = (url) => { set({ photo: url }); setPhotoDirty(true) }

  const pickPhoto = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    try { setPhoto(await compressPartPhoto(file)) } catch (err) { console.error(err) }
  }

  const save = async () => {
    if (!d.name.trim() && !d.partNumber.trim()) return
    setSaving(true)
    try {
      if (isNew) {
        await db.addPart(d)
      } else {
        const patch = { partNumber: d.partNumber, name: d.name, category: d.category, brand: d.brand, size: d.size, stock: d.stock, lowStock: d.lowStock, unit: d.unit, location: d.location, supplier: d.supplier, price: d.price, notes: d.notes }
        if (photoDirty) patch.photo = d.photo
        await db.updatePart(part.id, patch)
      }
      onSaved()
    } catch (e) { console.error(e); setSaving(false) }
  }
  const del = async () => { try { await db.deletePart(part.id); onSaved() } catch (e) { console.error(e) } }

  return (
    <div className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center p-3 sm:p-4" style={{ backgroundColor: 'rgba(26,26,22,0.5)' }} onClick={onClose}>
      <div className="bg-white rounded-2xl w-full sm:max-w-lg shadow-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 sticky top-0 bg-white z-10" style={{ borderBottom: '1px solid #EEF0EC' }}>
          <p className="font-display text-base font-bold" style={{ color: FOREST }}>{isNew ? 'Add part' : 'Edit part'}</p>
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={saving || (!d.name.trim() && !d.partNumber.trim())} className="font-body text-xs font-bold px-3.5 py-1.5 rounded-full text-white flex items-center gap-1.5 disabled:opacity-40" style={{ backgroundColor: FOREST }}>{saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save</button>
            <button onClick={onClose} className="text-slate-400"><X size={18} /></button>
          </div>
        </div>
        <div className="p-4">
          {/* Photo */}
          {d.photo ? (
            <div className="relative mb-3">
              <img src={d.photo} alt="" className="w-full max-h-56 object-contain rounded-xl bg-slate-50" />
              <div className="absolute top-2 right-2 flex gap-1.5">
                <button onClick={() => fileRef.current?.click()} className="font-body text-[11px] font-bold px-2.5 py-1 rounded-full bg-white/90 shadow" style={{ color: FOREST }}>Replace</button>
                <button onClick={() => setPhoto('')} className="font-body text-[11px] font-bold px-2.5 py-1 rounded-full bg-white/90 shadow text-red-500">Remove</button>
              </div>
            </div>
          ) : (
            <button onClick={() => fileRef.current?.click()} className="w-full mb-3 py-7 rounded-xl border-2 border-dashed flex flex-col items-center gap-2" style={{ borderColor: '#E2E8F0', color: FERN }}><ImageIcon size={22} /> <span className="font-body text-sm font-bold">Add a photo</span><span className="font-body text-[11px] text-slate-400">Take one or attach from your library</span></button>
          )}
          <input ref={fileRef} type="file" accept="image/*" onChange={pickPhoto} className="hidden" />

          <div className="grid grid-cols-2 gap-3">
            <div><FieldLabel>Part number</FieldLabel><input value={d.partNumber} onChange={(e) => set({ partNumber: e.target.value })} className={inp} placeholder="e.g. 570Z-6P" /></div>
            <div><FieldLabel>Category</FieldLabel><SearchSelect value={d.category} options={CATEGORIES} onPick={(v) => set({ category: v })} sort={false} /></div>
          </div>
          <div className="mt-3"><FieldLabel>Part name</FieldLabel><input value={d.name} onChange={(e) => set({ name: e.target.value })} className={inp} placeholder="e.g. Rain Bird 5000 rotor" /></div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div><FieldLabel>Brand</FieldLabel><SearchSelect value={d.brand} options={BRANDS} onPick={(v) => set({ brand: v })} sort={false} /></div>
            <div><FieldLabel>Size</FieldLabel><input value={d.size} onChange={(e) => set({ size: e.target.value })} className={inp} placeholder='e.g. 3/4"' /></div>
          </div>

          <div className="rounded-xl p-3 mt-3" style={{ backgroundColor: '#F1F5F3' }}>
            <div className="grid grid-cols-3 gap-3">
              <div><FieldLabel>In stock</FieldLabel><input type="number" inputMode="decimal" value={d.stock} onChange={(e) => set({ stock: e.target.value })} className={inp} placeholder="0" /></div>
              <div><FieldLabel>Low at</FieldLabel><input type="number" inputMode="decimal" value={d.lowStock} onChange={(e) => set({ lowStock: e.target.value })} className={inp} placeholder="0" /></div>
              <div><FieldLabel>Unit</FieldLabel><SearchSelect value={d.unit} options={UNITS} onPick={(v) => set({ unit: v })} sort={false} /></div>
            </div>
            <p className="font-body text-[10px] text-slate-400 mt-2">“Low at” flags the part red on the shelf and in the Low-stock filter when you’re at or below it.</p>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-3">
            <div><FieldLabel>Shop location</FieldLabel><input value={d.location} onChange={(e) => set({ location: e.target.value })} className={inp} placeholder="e.g. Bin B-4" /></div>
            <div><FieldLabel>Unit cost ($)</FieldLabel><input type="number" inputMode="decimal" value={d.price} onChange={(e) => set({ price: e.target.value })} className={inp} placeholder="0.00" /></div>
          </div>
          <div className="mt-3"><FieldLabel>Supplier</FieldLabel><input value={d.supplier} onChange={(e) => set({ supplier: e.target.value })} className={inp} placeholder="e.g. SiteOne, Ewing" /></div>
          <div className="mt-3"><FieldLabel>Notes</FieldLabel><textarea value={d.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} className={inp} style={{ resize: 'vertical' }} placeholder="Anything worth remembering — fits which heads, spares, etc." /></div>

          {!isNew && (
            <div className="mt-4">
              {!confirmDel ? (
                <button onClick={() => setConfirmDel(true)} className="font-body text-xs font-bold px-3 py-2 rounded-full flex items-center gap-1.5" style={{ color: '#B91C1C', border: '1px solid #F3C6C6' }}><Trash2 size={13} /> Delete part</button>
              ) : (
                <div className="flex items-center gap-2"><span className="font-body text-[12px] text-slate-500">Delete this part?</span><button onClick={del} className="font-body text-xs font-bold px-3 py-2 rounded-full text-white" style={{ backgroundColor: '#DC2626' }}>Yes, delete</button><button onClick={() => setConfirmDel(false)} className="font-body text-xs font-bold px-3 py-2 rounded-full text-slate-500 border border-slate-200">Keep</button></div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Order sheet builder ───────────────────────────────────────────────────────
const money = (n) => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const suggestFor = (p) => (isLow(p) ? Math.max(1, Math.ceil((p.lowStock * 2) - p.stock)) : 0)

// Native (text) print via a hidden iframe — crisp, selectable, multi-page.
function printHtml(html) {
  const iframe = document.createElement('iframe')
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
  document.body.appendChild(iframe)
  const doc = iframe.contentWindow.document
  doc.open(); doc.write(html); doc.close()
  const go = () => { try { iframe.contentWindow.focus(); iframe.contentWindow.print() } finally { setTimeout(() => iframe.remove(), 1000) } }
  setTimeout(go, 300)
}

function OrderBuilder({ parts, courseInfo, onClose }) {
  const [qtys, setQtys] = useState(() => {
    const m = {}; parts.forEach((p) => { const s = suggestFor(p); if (s > 0) m[p.id] = String(s) }); return m
  })
  const [poNumber, setPoNumber] = useState('')
  const [orderedBy, setOrderedBy] = useState('')
  const [notes, setNotes] = useState('')
  const [onlyLow, setOnlyLow] = useState(true)
  const date = new Date().toLocaleDateString()

  const setQty = (id, v) => setQtys((m) => ({ ...m, [id]: v.replace(/[^\d.]/g, '') }))
  const visible = useMemo(() => parts.filter((p) => !onlyLow || isLow(p) || (Number(qtys[p.id]) || 0) > 0), [parts, onlyLow, qtys])

  // Lines being ordered (qty > 0), grouped by supplier.
  const groups = useMemo(() => {
    const bySup = {}
    parts.forEach((p) => {
      const qty = Number(qtys[p.id]) || 0
      if (qty <= 0) return
      const key = p.supplier?.trim() || 'Unspecified supplier'
      ;(bySup[key] ||= []).push({ ...p, qty, lineTotal: qty * (Number(p.price) || 0) })
    })
    return Object.keys(bySup).sort().map((sup) => ({
      supplier: sup,
      lines: bySup[sup].sort((a, b) => (a.name || '').localeCompare(b.name || '')),
      subtotal: bySup[sup].reduce((s, l) => s + l.lineTotal, 0),
    }))
  }, [parts, qtys])

  const grandTotal = groups.reduce((s, g) => s + g.subtotal, 0)
  const lineCount = groups.reduce((s, g) => s + g.lines.length, 0)
  const club = courseInfo?.clubName || 'Golf Course'

  const buildHtml = () => {
    const head = `<div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #16291F;padding-bottom:8px;margin-bottom:14px">
      <div><div style="font:700 20px Georgia,serif;color:#16291F">${esc(club)}</div>
      <div style="font:600 13px Arial;color:#3A6B4A;margin-top:2px">Irrigation Parts — Purchase Order</div></div>
      <div style="font:12px Arial;color:#444;text-align:right">Date: ${esc(date)}${poNumber ? `<br>PO #: ${esc(poNumber)}` : ''}${orderedBy ? `<br>Ordered by: ${esc(orderedBy)}` : ''}</div></div>`
    const anyPrice = groups.some((g) => g.lines.some((l) => l.price > 0))
    const sections = groups.map((g) => {
      const rows = g.lines.map((l) => `<tr>
        <td style="padding:5px 8px;border-bottom:1px solid #eee">${esc(l.partNumber)}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #eee">${esc(l.name)}${l.size ? ` <span style="color:#888">(${esc(l.size)})</span>` : ''}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:700">${l.qty} ${esc(l.unit)}</td>
        ${anyPrice ? `<td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right">${l.price > 0 ? '$' + money(l.price) : '—'}</td><td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right">${l.price > 0 ? '$' + money(l.lineTotal) : '—'}</td>` : ''}
      </tr>`).join('')
      return `<div style="margin-bottom:16px">
        <div style="font:700 13px Arial;color:#16291F;background:#F0F6F2;padding:5px 8px;border-radius:4px">${esc(g.supplier)}</div>
        <table style="width:100%;border-collapse:collapse;font:12px Arial;margin-top:4px">
          <thead><tr style="color:#888;font-size:10px;text-transform:uppercase">
            <th style="text-align:left;padding:4px 8px">Part #</th><th style="text-align:left;padding:4px 8px">Item</th><th style="text-align:right;padding:4px 8px">Qty</th>${anyPrice ? '<th style="text-align:right;padding:4px 8px">Unit</th><th style="text-align:right;padding:4px 8px">Total</th>' : ''}
          </tr></thead><tbody>${rows}</tbody>
          ${anyPrice && g.subtotal > 0 ? `<tfoot><tr><td colspan="4" style="text-align:right;padding:6px 8px;font-weight:700">Subtotal</td><td style="text-align:right;padding:6px 8px;font-weight:700">$${money(g.subtotal)}</td></tr></tfoot>` : ''}
        </table></div>`
    }).join('')
    const foot = `${anyPrice && grandTotal > 0 ? `<div style="text-align:right;font:700 15px Arial;color:#16291F;border-top:2px solid #16291F;padding-top:8px;margin-top:6px">Order total: $${money(grandTotal)}</div>` : ''}
      ${notes ? `<div style="margin-top:12px;font:12px Arial;color:#444"><b>Notes:</b> ${esc(notes)}</div>` : ''}`
    return `<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:0.5in}body{margin:0;font-family:Arial}</style></head><body>${head}${sections || '<p style="font:13px Arial;color:#888">No items on this order yet.</p>'}${foot}</body></html>`
  }

  const doPrint = () => printHtml(buildHtml())

  const doCsv = () => {
    const rows = [['Supplier', 'Part #', 'Item', 'Size', 'Order qty', 'Unit', 'Unit cost', 'Line total']]
    groups.forEach((g) => g.lines.forEach((l) => rows.push([g.supplier, l.partNumber, l.name, l.size, l.qty, l.unit, l.price || '', l.lineTotal ? l.lineTotal.toFixed(2) : ''])))
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = `Irrigation-Order_${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const doCopy = () => {
    const lines = [`${club} — Irrigation Parts Order`, `Date: ${date}${poNumber ? `   PO #: ${poNumber}` : ''}`, '']
    groups.forEach((g) => {
      lines.push(`${g.supplier}:`)
      g.lines.forEach((l) => lines.push(`  • ${l.qty} ${l.unit} — ${l.name}${l.partNumber ? ` (#${l.partNumber})` : ''}${l.size ? ` ${l.size}` : ''}`))
      lines.push('')
    })
    if (notes) lines.push(`Notes: ${notes}`)
    navigator.clipboard?.writeText(lines.join('\n')).catch(() => {})
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center p-2 sm:p-4" style={{ backgroundColor: 'rgba(26,26,22,0.5)' }} onClick={onClose}>
      <div className="bg-white rounded-2xl w-full sm:max-w-2xl shadow-2xl max-h-[94vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #EEF0EC' }}>
          <p className="font-display text-base font-bold" style={{ color: FOREST }}>Create order sheet</p>
          <button onClick={onClose} className="text-slate-400"><X size={18} /></button>
        </div>

        <div className="p-4 overflow-y-auto">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
            <div><FieldLabel>PO # (optional)</FieldLabel><input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} className={inp} placeholder="e.g. 2026-114" /></div>
            <div><FieldLabel>Ordered by</FieldLabel><input value={orderedBy} onChange={(e) => setOrderedBy(e.target.value)} className={inp} placeholder="Your name" /></div>
            <div className="col-span-2 sm:col-span-1 flex items-end">
              <button onClick={() => setOnlyLow((v) => !v)} className="font-body text-xs font-bold px-3 py-2.5 rounded-xl w-full flex items-center justify-center gap-1.5" style={onlyLow ? { backgroundColor: '#DC2626', color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.12)' }}>
                <AlertTriangle size={13} /> {onlyLow ? 'Low stock only' : 'Showing all'}
              </button>
            </div>
          </div>

          <p className="font-body text-[11px] text-slate-400 mb-2">Set the order quantity for each part. Low-stock items are pre-filled with a suggested amount; adjust as you like. Parts with a quantity of 0 are left off.</p>

          <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
            {visible.length === 0 ? (
              <p className="font-body text-sm text-slate-400 p-4 text-center">Nothing low right now. Switch to “Showing all” to add any part to an order.</p>
            ) : visible.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="font-body text-sm font-semibold text-slate-800 truncate">{p.name || p.partNumber || '(unnamed)'}</p>
                  <p className="font-body text-[11px] text-slate-400 truncate">{[p.partNumber && `#${p.partNumber}`, p.supplier, `${p.stock} ${p.unit} on hand`].filter(Boolean).join(' · ')}{isLow(p) ? ' · LOW' : ''}</p>
                </div>
                <input value={qtys[p.id] || ''} onChange={(e) => setQty(p.id, e.target.value)} inputMode="decimal" placeholder="0" className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-right tabular-nums" />
                <span className="font-body text-[11px] text-slate-400 w-8">{p.unit}</span>
              </div>
            ))}
          </div>

          <div className="mt-3"><FieldLabel>Notes to supplier (optional)</FieldLabel><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inp} style={{ resize: 'vertical' }} placeholder="Delivery instructions, account #, will-call, etc." /></div>
        </div>

        <div className="px-4 py-3 flex items-center justify-between gap-2 flex-wrap" style={{ borderTop: '1px solid #EEF0EC' }}>
          <p className="font-body text-[12px] text-slate-500">{lineCount} item{lineCount !== 1 ? 's' : ''} across {groups.length} supplier{groups.length !== 1 ? 's' : ''}{grandTotal > 0 ? ` · $${money(grandTotal)}` : ''}</p>
          <div className="flex items-center gap-2">
            <button onClick={doCopy} disabled={!lineCount} className="font-body text-xs font-bold px-3 py-2 rounded-full flex items-center gap-1.5 disabled:opacity-40 border border-slate-200 text-slate-600"><Copy size={13} /> Copy</button>
            <button onClick={doCsv} disabled={!lineCount} className="font-body text-xs font-bold px-3 py-2 rounded-full flex items-center gap-1.5 disabled:opacity-40 border" style={{ color: FOREST, borderColor: FOREST }}><FileDown size={13} /> CSV</button>
            <button onClick={doPrint} disabled={!lineCount} className="font-body text-xs font-bold px-3.5 py-2 rounded-full text-white flex items-center gap-1.5 disabled:opacity-40" style={{ backgroundColor: FOREST }}><Printer size={13} /> Print / PDF</button>
          </div>
        </div>
      </div>
    </div>
  )
}
