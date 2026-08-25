'use client'

// The Playbook — one dedicated place for the crew to look things up fast:
//   • SOPs / how-to procedures (with the manufacturer's manual attached)
//   • Emergency procedures (red-flagged, pinned first)
//   • Contacts & phone numbers (tap-to-call)
//   • Supplies — "this product for that job", and where to buy it
// Managers add/edit; everyone can read, search, call, and open the manuals.
// One box searches across all four sections at once.
import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Plus, Trash2, Pencil, Search, X, Loader2, Phone, Mail, BookOpen, Package,
  AlertTriangle, FileText, Image as ImageIcon, Paperclip, Upload,
} from 'lucide-react'
import * as db from '@/lib/db'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#B9982F'
const RED = '#B23A2E'
const PAPER = '#F9F8F5'
const PAPER_2 = '#E8E7E2'
const HAIR = '#E2E0DB'
const INK = '#1b2420'
const INK_2 = '#5B6160'
const INK_3 = '#8A8984'
const CREAM = '#F1F0EC'

const TABS = [
  { key: 'emergency', label: 'Emergency', icon: AlertTriangle },
  { key: 'sop', label: 'SOPs', icon: BookOpen },
  { key: 'contacts', label: 'Contacts', icon: Phone },
  { key: 'supplies', label: 'Supplies', icon: Package },
]

// Which stored items belong to a given tab.
function inTab(item, tab) {
  if (tab === 'emergency') return item.kind === 'sop' && item.emergency
  if (tab === 'sop') return item.kind === 'sop' && !item.emergency
  if (tab === 'contacts') return item.kind === 'contact'
  if (tab === 'supplies') return item.kind === 'supply'
  return false
}

const telHref = (p) => 'tel:' + String(p || '').replace(/[^\d+]/g, '')
const norm = (s) => String(s || '').toLowerCase()

// Everything about an item as one searchable string.
function haystack(i) {
  const d = i.data || {}
  return norm([i.title, i.category, i.notes, d.company, d.phone, d.email, d.product, d.supplier,
    ...(i.attachments || []).map((a) => a.name)].join(' '))
}

// A ready-made starter set — genuinely useful procedures plus templates with a
// few blanks (marked ___) for the club to fill in. Loaded on demand from the
// empty state; everything is editable or deletable afterwards.
const STARTER_ITEMS = [
  // ── Emergency ──
  { kind: 'sop', emergency: true, sort: 1, category: 'Irrigation · Emergency', title: 'Pump station loses power',
    notes: [
      'Confirm the outage — check the main panel and the utility status.',
      'Switch the pump station to the backup generator (breaker location: ___).',
      'If the generator won’t start, call the irrigation tech and the electrician (see Contacts).',
      'Hand-water greens and new seed if downtime will pass ~4 hours in summer heat.',
      'Log the event and note the generator run-hours.',
    ].join('\n'), data: {}, attachments: [] },
  { kind: 'sop', emergency: true, sort: 2, category: 'Chemical · Emergency', title: 'Chemical spill',
    notes: [
      'Put on PPE. Keep people back and upwind.',
      'Contain it — the spill kit is at: ___.',
      'Stop the source; dam and absorb. Do not hose into a drain.',
      'Call the distributor rep; if it’s large, the state hotline (see Contacts).',
      'Record what spilled, how much, and how it was cleaned up.',
    ].join('\n'), data: {}, attachments: [] },
  { kind: 'sop', emergency: true, sort: 3, category: 'Weather · Emergency', title: 'Severe storm / lightning',
    notes: [
      'Sound the horn and clear the course and crew to shelter.',
      'Don’t resume until 30 minutes after the last thunder or strike.',
    ].join('\n'), data: {}, attachments: [] },
  // ── SOPs ──
  { kind: 'sop', emergency: false, sort: 10, category: 'Equipment', title: 'Fill & calibrate the sprayer',
    notes: [
      'Check nozzles and screens; rinse from the last load.',
      'Half-fill with water, start agitation, add products in order (dry → flowable → liquid).',
      'Verify gpm against the area’s saved sprayer setting; catch-test if unsure.',
      'Triple-rinse and log the load.',
    ].join('\n'), data: {}, attachments: [] },
  { kind: 'sop', emergency: false, sort: 11, category: 'Equipment', title: 'Set greens-mower height of cut',
    notes: [
      'Bench-set to the target height of cut.',
      'Check reel-to-bedknife with a strip test.',
      'Record the setting per mower. (Attach the maker’s SOP with the button below.)',
    ].join('\n'), data: {}, attachments: [] },
  { kind: 'sop', emergency: false, sort: 12, category: 'Irrigation', title: 'Winterize the irrigation system',
    notes: [
      'Blow out zone-by-zone at safe pressure with the compressor.',
      'Open the drains.',
      'Document the sequence and note any repairs for spring.',
    ].join('\n'), data: {}, attachments: [] },
  { kind: 'sop', emergency: false, sort: 13, category: 'Clubhouse & grounds', title: 'Seal the teak patio furniture',
    notes: 'Clean and let dry a day, then reseal each spring — the exact product is under Supplies.', data: {}, attachments: [] },
  // ── Contacts (add the real numbers) ──
  { kind: 'contact', sort: 20, category: 'Irrigation', title: 'Irrigation Service', notes: 'Pump station & controllers. Add the phone number.', data: { company: '', phone: '', email: '' }, attachments: [] },
  { kind: 'contact', sort: 21, category: 'Chemical supplier', title: 'Chemical Distributor Rep', notes: 'Fungicides, fertilizer, PGRs. Add the phone number.', data: { company: '', phone: '', email: '' }, attachments: [] },
  { kind: 'contact', sort: 22, category: 'Services', title: 'Electrician', notes: 'Pump house & shop panels. Add the phone number.', data: { company: '', phone: '', email: '' }, attachments: [] },
  { kind: 'contact', sort: 23, category: 'Equipment', title: 'Equipment Dealer', notes: 'Parts & mower service. Add the phone number.', data: { company: '', phone: '', email: '' }, attachments: [] },
  { kind: 'contact', sort: 24, category: 'Utilities', title: 'Power Company (outages)', notes: '24-hour outage line. Add the phone number.', data: { company: '', phone: '', email: '' }, attachments: [] },
  // ── Supplies ──
  { kind: 'supply', sort: 30, category: '', title: 'Teak patio furniture', notes: 'Reseal each spring; 2 thin coats.', data: { product: 'Australian Timber Oil — Natural', supplier: 'Hardware supplier' }, attachments: [] },
  { kind: 'supply', sort: 31, category: '', title: 'Bunker sand', notes: 'Match the existing spec sheet.', data: { product: 'Angular white bunker sand', supplier: 'Aggregate supplier' }, attachments: [] },
  { kind: 'supply', sort: 32, category: '', title: 'Line marking', notes: 'Case kept in the paint shop.', data: { product: 'White marking paint', supplier: 'Golf supply' }, attachments: [] },
]

function saveErr(e) {
  const m = String(e?.message || e || '')
  if (/relation|does not exist|schema cache|bucket|column/i.test(m)) {
    return 'Could not save — it looks like the Playbook tables aren’t set up yet. Run supabase/phase15.sql in Supabase, then try again.'
  }
  return 'Could not save. Please try again.'
}

export default function PlaybookModule({ user, manage, hideChrome }) {
  const [items, setItems] = useState([])
  const [clubName, setClubName] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [tab, setTab] = useState('emergency')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null) // draft item or null
  const [confirmDel, setConfirmDel] = useState(null)
  const [seeding, setSeeding] = useState(false)

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const [list, settings] = await Promise.all([
          db.fetchPlaybookItems(),
          db.fetchSettings().catch(() => null),
        ])
        setItems(list)
        setClubName(settings?.courseInfo?.clubName || '')
        setLoadError(null)
      } catch (e) {
        setLoadError(saveErr(e))
      }
      setLoading(false)
    })()
  }, [])

  const query = q.trim().toLowerCase()
  const searching = query.length > 0
  const matches = useMemo(() => (searching ? items.filter((i) => haystack(i).includes(query)) : []), [items, query, searching])

  const startAdd = (tabKey) => {
    const base = { title: '', category: '', notes: '', data: {}, attachments: [] }
    if (tabKey === 'contacts') setEditing({ ...base, kind: 'contact' })
    else if (tabKey === 'supplies') setEditing({ ...base, kind: 'supply' })
    else setEditing({ ...base, kind: 'sop', emergency: tabKey === 'emergency' })
  }

  const onSaved = (saved, isNew) => {
    setItems((prev) => (isNew ? [...prev, saved] : prev.map((i) => (i.id === saved.id ? saved : i))))
    setEditing(null)
  }
  const loadStarters = async () => {
    setSeeding(true)
    try {
      for (const s of STARTER_ITEMS) await db.addPlaybookItem(s)
      setItems(await db.fetchPlaybookItems())
    } catch (e) { setLoadError(saveErr(e)) }
    setSeeding(false)
  }
  const doDelete = async (item) => {
    setConfirmDel(null)
    setItems((prev) => prev.filter((i) => i.id !== item.id))
    try {
      await db.deletePlaybookItem(item.id)
      for (const a of item.attachments || []) db.deletePlaybookFile(a.path)
    } catch { /* optimistic; a reload will reconcile */ }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: CREAM }}>
      {/* Header band — club identity + tabs */}
      {!hideChrome && (
        <div style={{ backgroundColor: FOREST, borderBottom: `2px solid ${GOLD}` }} className="text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-5 pb-4">
            <div className="mb-4">
              <p className="font-display text-[10px] tracking-[0.25em] uppercase" style={{ color: '#C9A84C' }}>{clubName || 'Golf Maintenance'}</p>
              <h1 className="font-display text-2xl font-semibold mt-0.5">Playbook</h1>
              <p className="font-body text-[12px] opacity-75 mt-0.5">Procedures, people &amp; supplies — everything in one place.</p>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-5 pb-16">
        {/* Search — spans all four sections */}
        <div className="relative mb-4">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: INK_3 }} />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search everything — a procedure, a person, a supply…"
            className="w-full rounded-[10px] pl-9 pr-9 py-3 text-sm font-body"
            style={{ backgroundColor: PAPER, border: `1px solid ${HAIR}`, color: INK }}
          />
          {q && <button onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: INK_3 }}><X size={15} /></button>}
        </div>

        {/* Tabs (hidden while searching) */}
        {!searching && (
          <div className="flex gap-1.5 flex-wrap mb-5">
            {TABS.map((t) => {
              const on = tab === t.key
              const Icon = t.icon
              const count = items.filter((i) => inTab(i, t.key)).length
              return (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className="font-body text-xs font-bold px-3.5 py-2 rounded-lg transition flex items-center gap-1.5"
                  style={on ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: PAPER, color: INK_2, border: `1px solid ${HAIR}` }}>
                  <Icon size={13} style={t.key === 'emergency' && !on ? { color: RED } : undefined} /> {t.label}
                  {count > 0 && <span className="tnum" style={{ opacity: on ? 0.7 : 0.5 }}>{count}</span>}
                </button>
              )
            })}
          </div>
        )}

        {/* First-run: offer a ready-made starter set */}
        {!loading && !loadError && !searching && items.length === 0 && manage && (
          <div className="paper-card p-5 mb-5" style={{ borderLeft: `3px solid ${GOLD}` }}>
            <h3 className="font-display text-base font-semibold" style={{ color: FOREST }}>Start with a few examples?</h3>
            <p className="font-body text-[13.5px] mt-1.5" style={{ color: INK_2 }}>
              I’ll drop in some ready-made procedures (like <b>“Pump station loses power”</b>), a few contact templates, and supply examples — with a couple of blanks for you to fill in. Edit or delete any of them; they’re just a starting point.
            </p>
            <button onClick={loadStarters} disabled={seeding} className="mt-3 font-body text-xs font-bold px-4 py-2.5 rounded-full text-white inline-flex items-center gap-1.5 disabled:opacity-50" style={{ backgroundColor: FOREST }}>
              {seeding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {seeding ? 'Adding…' : 'Add starter examples'}
            </button>
          </div>
        )}

        {loading ? (
          <div className="pt-16 flex justify-center"><Loader2 className="animate-spin" size={26} style={{ color: HAIR }} /></div>
        ) : loadError ? (
          <div className="paper-card p-6 flex items-start gap-3" style={{ borderColor: '#E9C9C2' }}>
            <AlertTriangle size={18} style={{ color: RED }} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-body text-sm font-semibold" style={{ color: INK }}>Couldn’t load the Playbook</p>
              <p className="font-body text-xs mt-0.5" style={{ color: INK_2 }}>{loadError}</p>
            </div>
          </div>
        ) : searching ? (
          <SearchResults matches={matches} manage={manage} onEdit={setEditing} onDelete={setConfirmDel} />
        ) : (
          <TabView tab={tab} items={items.filter((i) => inTab(i, tab))} manage={manage}
            onAdd={() => startAdd(tab)} onEdit={setEditing} onDelete={setConfirmDel} />
        )}
      </div>

      {editing && (
        <EditModal draft={editing} onClose={() => setEditing(null)} onSaved={onSaved} />
      )}
      {confirmDel && (
        <ConfirmModal item={confirmDel} onCancel={() => setConfirmDel(null)} onConfirm={() => doDelete(confirmDel)} />
      )}
    </div>
  )
}

// ── Views ────────────────────────────────────────────────────────────────────
function TabView({ tab, items, manage, onAdd, onEdit, onDelete }) {
  const label = TABS.find((t) => t.key === tab)?.label || ''
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="font-display text-lg font-semibold" style={{ color: FOREST }}>{label}</h2>
          <div className="mt-1 h-px" style={{ width: 26, backgroundColor: GOLD }} />
        </div>
        {manage && (
          <button onClick={onAdd} className="font-body text-xs font-bold px-3.5 py-2 rounded-full text-white flex items-center gap-1.5" style={{ backgroundColor: FOREST }}>
            <Plus size={14} /> Add
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <div className="paper-card p-10 text-center">
          <p className="font-body text-sm" style={{ color: INK_3 }}>Nothing here yet.</p>
          {manage && <button onClick={onAdd} className="mt-3 font-body text-xs font-semibold px-4 py-2 rounded-full text-white" style={{ backgroundColor: FOREST }}>Add the first one</button>}
        </div>
      ) : (
        <div className="space-y-2.5">
          {items.map((it) => <ItemCard key={it.id} item={it} manage={manage} onEdit={onEdit} onDelete={onDelete} />)}
        </div>
      )}
    </div>
  )
}

function SearchResults({ matches, manage, onEdit, onDelete }) {
  if (matches.length === 0) {
    return <div className="paper-card p-10 text-center"><p className="font-body text-sm" style={{ color: INK_3 }}>No matches. Try another word.</p></div>
  }
  const groups = [
    ['emergency', 'Emergency'], ['sop', 'SOPs'], ['contacts', 'Contacts'], ['supplies', 'Supplies'],
  ].map(([key, label]) => [label, matches.filter((m) => inTab(m, key))]).filter(([, list]) => list.length)
  return (
    <div className="space-y-5">
      {groups.map(([label, list]) => (
        <div key={label}>
          <p className="eyebrow mb-2">{label}</p>
          <div className="space-y-2.5">
            {list.map((it) => <ItemCard key={it.id} item={it} manage={manage} onEdit={onEdit} onDelete={onDelete} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── One card, rendered per kind ──────────────────────────────────────────────
function AttChips({ attachments }) {
  if (!attachments?.length) return null
  return (
    <div className="flex flex-wrap gap-2 mt-3 pt-3" style={{ borderTop: `1px solid ${HAIR}` }}>
      {attachments.map((a, i) => {
        const tag = a.kind === 'pdf' ? 'PDF' : a.kind === 'image' ? 'PHOTO' : 'FILE'
        const tagBg = a.kind === 'pdf' ? RED : a.kind === 'image' ? GOLD : FERN
        const Icon = a.kind === 'image' ? ImageIcon : FileText
        return (
          <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 font-body text-xs font-semibold rounded-lg px-2.5 py-1.5"
            style={{ backgroundColor: PAPER_2, border: `1px solid ${HAIR}`, color: INK_2 }}>
            <Icon size={13} style={{ color: INK_3 }} />
            <span className="max-w-[180px] truncate">{a.name}</span>
            <span className="text-[9px] font-extrabold tracking-wide text-white rounded px-1.5 py-0.5" style={{ backgroundColor: tagBg }}>{tag}</span>
          </a>
        )
      })}
    </div>
  )
}

function stepsFrom(notes) {
  return String(notes || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
}

function ItemCard({ item, manage, onEdit, onDelete }) {
  const emg = item.kind === 'sop' && item.emergency
  const d = item.data || {}
  return (
    <div className="paper-card p-4" style={emg ? { borderLeft: `3px solid ${RED}` } : undefined}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {item.category && <p className="font-body text-[10.5px] font-bold uppercase tracking-wide mb-0.5" style={{ color: emg ? RED : FERN }}>{item.category}</p>}
          <h3 className="font-body text-[15px] font-bold" style={{ color: INK }}>{item.title}</h3>
        </div>
        {manage && (
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => onEdit(item)} className="p-1.5 rounded-md" style={{ color: INK_3 }} aria-label="Edit"><Pencil size={15} /></button>
            <button onClick={() => onDelete(item)} className="p-1.5 rounded-md" style={{ color: INK_3 }} aria-label="Delete"><Trash2 size={15} /></button>
          </div>
        )}
      </div>

      {/* Kind-specific body */}
      {item.kind === 'contact' ? (
        <div className="mt-1.5">
          {d.company && <p className="font-body text-[12.5px]" style={{ color: INK_3 }}>{d.company}</p>}
          {item.notes && <p className="font-body text-[13.5px] mt-1" style={{ color: INK_2 }}>{item.notes}</p>}
          <div className="flex flex-wrap gap-2 mt-2.5">
            {d.phone && (
              <a href={telHref(d.phone)} className="inline-flex items-center gap-1.5 font-body text-[13px] font-bold rounded-full px-3.5 py-2" style={{ backgroundColor: PAPER_2, border: `1px solid ${HAIR}`, color: FERN }}>
                <Phone size={13} /> {d.phone}
              </a>
            )}
            {d.email && (
              <a href={`mailto:${d.email}`} className="inline-flex items-center gap-1.5 font-body text-[13px] font-semibold rounded-full px-3.5 py-2" style={{ backgroundColor: PAPER_2, border: `1px solid ${HAIR}`, color: INK_2 }}>
                <Mail size={13} /> Email
              </a>
            )}
          </div>
        </div>
      ) : item.kind === 'supply' ? (
        <div className="mt-1.5 font-body text-[13.5px]" style={{ color: INK_2 }}>
          {d.product && <p><span style={{ color: INK_3 }}>We use:</span> <b style={{ color: INK }}>{d.product}</b></p>}
          {d.supplier && <p className="mt-0.5"><span style={{ color: INK_3 }}>Where:</span> {d.supplier}</p>}
          {item.notes && <p className="mt-1" style={{ color: INK_2 }}>{item.notes}</p>}
          <AttChips attachments={item.attachments} />
        </div>
      ) : (
        <div className="mt-1.5">
          {(() => {
            const steps = stepsFrom(item.notes)
            if (steps.length > 1) {
              return <ol className="list-decimal pl-5 space-y-1 font-body text-[13.5px]" style={{ color: INK_2 }}>{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            }
            return item.notes ? <p className="font-body text-[13.5px]" style={{ color: INK_2 }}>{item.notes}</p> : null
          })()}
          <AttChips attachments={item.attachments} />
        </div>
      )}
    </div>
  )
}

// ── Add / edit modal ─────────────────────────────────────────────────────────
function EditModal({ draft: initial, onClose, onSaved }) {
  const [draft, setDraft] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef(null)
  const isNew = !initial.id
  const kind = draft.kind
  const isSop = kind === 'sop'
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const setData = (patch) => setDraft((d) => ({ ...d, data: { ...(d.data || {}), ...patch } }))

  const title = { contact: isNew ? 'Add contact' : 'Edit contact', supply: isNew ? 'Add supply' : 'Edit supply' }[kind]
    || (draft.emergency ? (isNew ? 'Add emergency procedure' : 'Edit emergency procedure') : (isNew ? 'Add SOP' : 'Edit SOP'))

  const onPick = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setUploading(true); setErr('')
    try {
      const added = []
      for (const f of files) added.push(await db.uploadPlaybookFile(f))
      setDraft((d) => ({ ...d, attachments: [...(d.attachments || []), ...added] }))
    } catch (e2) {
      setErr(/bucket/i.test(String(e2?.message)) ? 'File storage isn’t set up yet — run supabase/phase15.sql.' : 'Could not upload that file.')
    }
    setUploading(false)
  }
  const removeAtt = (att) => setDraft((d) => ({ ...d, attachments: (d.attachments || []).filter((a) => a !== att) }))

  const save = async () => {
    if (!String(draft.title || '').trim()) { setErr('Add a title.'); return }
    setSaving(true); setErr('')
    try {
      const payload = { ...draft, title: draft.title.trim() }
      const saved = isNew ? await db.addPlaybookItem(payload) : await db.updatePlaybookItem(payload)
      onSaved(saved, isNew)
    } catch (e) { setErr(saveErr(e)); setSaving(false) }
  }

  const field = 'w-full rounded-xl px-3 py-2.5 text-sm font-body'
  const fieldStyle = { border: `1px solid ${HAIR}`, backgroundColor: 'white', color: INK }
  const Label = ({ children }) => <label className="font-body text-[11px] font-bold uppercase tracking-wide block mb-1.5" style={{ color: INK_3 }}>{children}</label>

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ backgroundColor: 'rgba(26,26,22,0.45)' }} onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl p-5 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} style={{ border: `1px solid ${HAIR}` }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-lg font-semibold" style={{ color: FOREST }}>{title}</h3>
          <button onClick={onClose} style={{ color: INK_3 }}><X size={18} /></button>
        </div>

        {kind === 'contact' ? (
          <div className="space-y-3">
            <div><Label>Name</Label><input className={field} style={fieldStyle} value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Irrigation Service — Toro/Lynx" /></div>
            <div><Label>What they’re for</Label><input className={field} style={fieldStyle} value={draft.category} onChange={(e) => set({ category: e.target.value })} placeholder="e.g. Irrigation · Chemical supplier · Staff" /></div>
            <div><Label>Company</Label><input className={field} style={fieldStyle} value={draft.data?.company || ''} onChange={(e) => setData({ company: e.target.value })} placeholder="Company / person" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Phone</Label><input className={field} style={fieldStyle} inputMode="tel" value={draft.data?.phone || ''} onChange={(e) => setData({ phone: e.target.value })} placeholder="(301) 555‑0142" /></div>
              <div><Label>Email</Label><input className={field} style={fieldStyle} inputMode="email" value={draft.data?.email || ''} onChange={(e) => setData({ email: e.target.value })} placeholder="name@company.com" /></div>
            </div>
            <div><Label>Notes — what we buy from them</Label><textarea className={field} style={fieldStyle} rows={2} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} /></div>
          </div>
        ) : kind === 'supply' ? (
          <div className="space-y-3">
            <div><Label>Job / item</Label><input className={field} style={fieldStyle} value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Teak patio furniture" /></div>
            <div><Label>What we use</Label><input className={field} style={fieldStyle} value={draft.data?.product || ''} onChange={(e) => setData({ product: e.target.value })} placeholder="Product / brand" /></div>
            <div><Label>Where to buy</Label><input className={field} style={fieldStyle} value={draft.data?.supplier || ''} onChange={(e) => setData({ supplier: e.target.value })} placeholder="Supplier" /></div>
            <div><Label>Notes</Label><textarea className={field} style={fieldStyle} rows={2} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="e.g. reseal each spring, 2 thin coats" /></div>
            <AttEditor draft={draft} onPick={onPick} onRemove={removeAtt} uploading={uploading} fileRef={fileRef} label="Spec sheet or photo (optional)" />
          </div>
        ) : (
          <div className="space-y-3">
            <div><Label>Procedure title</Label><input className={field} style={fieldStyle} value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Pump station loses power" /></div>
            <div><Label>Category</Label><input className={field} style={fieldStyle} value={draft.category} onChange={(e) => set({ category: e.target.value })} placeholder="e.g. Equipment · Irrigation · Clubhouse" /></div>
            <label className="flex items-center gap-2.5 py-1 cursor-pointer">
              <input type="checkbox" checked={!!draft.emergency} onChange={(e) => set({ emergency: e.target.checked })} className="w-4 h-4" style={{ accentColor: RED }} />
              <span className="font-body text-sm" style={{ color: INK }}>Emergency — pin to the top and red-flag it</span>
            </label>
            <div><Label>Steps</Label><textarea className={field} style={fieldStyle} rows={5} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} placeholder={'One step per line — they’ll show as a numbered list.'} /></div>
            <AttEditor draft={draft} onPick={onPick} onRemove={removeAtt} uploading={uploading} fileRef={fileRef} label="Attach the manufacturer’s manual (PDF) or photos" />
          </div>
        )}

        {err && <p className="font-body text-[12px] mt-3" style={{ color: RED }}>{err}</p>}
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold font-body" style={{ color: INK_2, border: `1px solid ${HAIR}` }}>Cancel</button>
          <button onClick={save} disabled={saving || uploading} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body text-white disabled:opacity-50" style={{ backgroundColor: FOREST }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

function AttEditor({ draft, onPick, onRemove, uploading, fileRef, label }) {
  return (
    <div>
      <label className="font-body text-[11px] font-bold uppercase tracking-wide block mb-1.5" style={{ color: INK_3 }}>{label}</label>
      <input ref={fileRef} type="file" accept=".pdf,image/*" multiple onChange={onPick} className="hidden" />
      <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
        className="font-body text-xs font-bold px-3.5 py-2 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
        style={{ color: FOREST, border: `1px dashed ${HAIR}`, backgroundColor: PAPER }}>
        {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {uploading ? 'Uploading…' : 'Attach file'}
      </button>
      {(draft.attachments || []).length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2.5">
          {draft.attachments.map((a, i) => {
            const tag = a.kind === 'pdf' ? 'PDF' : a.kind === 'image' ? 'PHOTO' : 'FILE'
            const tagBg = a.kind === 'pdf' ? RED : a.kind === 'image' ? GOLD : FERN
            return (
              <span key={i} className="inline-flex items-center gap-2 font-body text-xs font-semibold rounded-lg px-2.5 py-1.5" style={{ backgroundColor: PAPER_2, border: `1px solid ${HAIR}`, color: INK_2 }}>
                <Paperclip size={12} style={{ color: INK_3 }} />
                <span className="max-w-[150px] truncate">{a.name}</span>
                <span className="text-[9px] font-extrabold tracking-wide text-white rounded px-1.5 py-0.5" style={{ backgroundColor: tagBg }}>{tag}</span>
                <button type="button" onClick={() => onRemove(a)} style={{ color: INK_3 }}><X size={13} /></button>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ConfirmModal({ item, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(26,26,22,0.45)' }} onClick={onCancel}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-xs" onClick={(e) => e.stopPropagation()} style={{ border: `1px solid ${HAIR}` }}>
        <p className="font-display text-base font-semibold mb-1" style={{ color: FOREST }}>Delete this?</p>
        <p className="font-body text-[13px] mb-4" style={{ color: INK_2 }}>“{item.title}” will be removed for everyone.</p>
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl text-sm font-semibold font-body" style={{ color: INK_2, border: `1px solid ${HAIR}` }}>Cancel</button>
          <button onClick={onConfirm} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body text-white" style={{ backgroundColor: RED }}>Delete</button>
        </div>
      </div>
    </div>
  )
}
