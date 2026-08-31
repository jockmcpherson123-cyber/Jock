'use client'

// ════════════════════════════════════════════════════════════════════════
//  Chemistry Guide — the in-app version of the printed booklet
//  "How Our Chemistry Works". A plain-language reference to every product
//  class in the program: what it is, how it works, and why it's on the sheet.
//
//  The built-in cards live in lib/chemistry.js. On top of those, the team can
//  ADD their own products — typed by hand or drafted from a label photo by the
//  AI label reader — which persist in courseInfo.chemGuide. Educational only;
//  the label is the law.
// ════════════════════════════════════════════════════════════════════════

import React, { useMemo, useState, useRef } from 'react'
import { Search, X, AlertTriangle, Info, ShieldCheck, Plus, Sparkles, Loader2, CloudUpload, Pencil, Trash2, Check, Library } from 'lucide-react'
import { CHEM_HUES, CHEM_JOBS, CHEM_SECTIONS, CHEM_ROTATION, CHEM_CATEGORIES, CHEM_EXTRA_SECTIONS } from '@/lib/chemistry'

const FOREST = '#16291F'
const GOLD = '#C9A84C'

// section id -> hue key, drawn from the built-in sections + the extra categories.
const SECTION_HUE = (() => {
  const m = {}
  CHEM_SECTIONS.forEach((s) => { m[s.id] = s.hue })
  CHEM_CATEGORIES.forEach((c) => { m[c.sectionId] = c.hue })
  return m
})()
const catToSection = (label) => CHEM_CATEGORIES.find((c) => c.label === label) || CHEM_CATEGORIES[CHEM_CATEGORIES.length - 1]

// soft tint of a hue for chips / accents
function tint(hex, alpha) {
  const h = hex.replace('#', '')
  return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${alpha})`
}

// Downscale a chosen photo and return { media_type, data } base64 for the API.
function fileToImagePart(file, maxDim = 1400, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        let { width, height } = img
        if (Math.max(width, height) > maxDim) {
          const k = maxDim / Math.max(width, height)
          width = Math.round(width * k); height = Math.round(height * k)
        }
        const cv = document.createElement('canvas')
        cv.width = width; cv.height = height
        cv.getContext('2d').drawImage(img, 0, 0, width, height)
        const dataUrl = cv.toDataURL('image/jpeg', quality)
        resolve({ media_type: 'image/jpeg', data: dataUrl.split(',')[1] })
      }
      img.onerror = reject
      img.src = reader.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function ProductCard({ card, hue, onEdit, onDelete, onConfirm }) {
  return (
    <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden flex">
      <div className="w-1.5 shrink-0" style={{ backgroundColor: hue }} />
      <div className="p-4 min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <span className="font-display text-base font-semibold text-slate-900">{card.name}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            {card.draft && <span className="font-body text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#FBF1DA', color: '#92660D' }}>Draft — review</span>}
            {card.added && !card.draft && <span className="font-body text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#EEF2FF', color: '#4F46E5' }}>Added</span>}
            {card.chip && <span className="font-body text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: tint(hue, 0.12), color: hue }}>{card.chip}</span>}
          </div>
        </div>
        {card.ai && <p className="font-body text-[12px] text-slate-500 mb-0.5"><span className="font-mono text-[11px] text-slate-700">{card.ai}</span></p>}
        {card.group && <p className="font-body text-[10px] font-bold uppercase tracking-wide mb-2.5" style={{ color: hue }}>{card.group}</p>}

        <div className="space-y-2">
          {card.how && (
            <div>
              <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-0.5">How it works</p>
              <p className="font-body text-[12.5px] leading-relaxed text-slate-700">{card.how}</p>
            </div>
          )}
          {card.why && (
            <div>
              <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-0.5">Why we use it</p>
              <p className="font-body text-[12.5px] leading-relaxed text-slate-700">{card.why}</p>
            </div>
          )}
        </div>

        {card.note && (
          <div className="mt-2.5 rounded-xl px-3 py-2 flex gap-2 items-start" style={{ backgroundColor: card.verify ? '#FEF6E7' : card.risk === 'hi' ? '#FDECEA' : '#F4F6F5' }}>
            {card.verify
              ? <AlertTriangle size={13} className="mt-0.5 shrink-0" style={{ color: '#B9821A' }} />
              : card.risk === 'hi'
              ? <AlertTriangle size={13} className="mt-0.5 shrink-0" style={{ color: '#C0392B' }} />
              : <Info size={13} className="mt-0.5 shrink-0 text-slate-400" />}
            <p className="font-body text-[11.5px] leading-snug" style={{ color: card.verify ? '#8A6212' : card.risk === 'hi' ? '#98271B' : '#556' }}>{card.note}</p>
          </div>
        )}

        {card.added && (
          <div className="flex items-center gap-3 mt-3 pt-2.5" style={{ borderTop: '1px solid #F1F1EE' }}>
            {card.draft && <button onClick={onConfirm} className="font-body text-[11px] font-bold flex items-center gap-1" style={{ color: '#2E7D46' }}><Check size={13} /> Confirm</button>}
            <button onClick={onEdit} className="font-body text-[11px] font-bold flex items-center gap-1 text-slate-500"><Pencil size={12} /> Edit</button>
            <button onClick={onDelete} className="font-body text-[11px] font-bold flex items-center gap-1" style={{ color: '#C0392B' }}><Trash2 size={12} /> Remove</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Add / edit form (with AI label drafting) ─────────────────────────────────
const EMPTY = { name: '', category: 'Fungicide', chip: '', ai: '', group: '', how: '', why: '', note: '', verify: false }

function AddProductForm({ initial, grassTypes, onSave, onCancel }) {
  const [f, setF] = useState(initial || EMPTY)
  const [images, setImages] = useState([])
  const [imgCount, setImgCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }))

  const onPick = async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 3)
    if (!files.length) return
    try {
      const parts = await Promise.all(files.map((file) => fileToImagePart(file)))
      setImages(parts); setImgCount(parts.length); setErr('')
    } catch { setErr('Could not read that photo. Try another.') }
  }

  const draft = async () => {
    setErr('')
    if (!f.name.trim() && images.length === 0) { setErr('Type the product name or add a label photo first.'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/analyze-label', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.name || '', grassTypes, images, guide: true }),
      })
      const json = await res.json()
      if (!res.ok) { setErr(json.error || 'The AI could not read this. Fill it in by hand.'); return }
      const r = json.result
      if (!r?.found) { setErr('The AI could not confidently identify this product. Add a clearer photo, or fill it in by hand.'); return }
      setF((p) => ({
        ...p,
        name: r.productName || p.name,
        category: CHEM_CATEGORIES.some((c) => c.label === r.category) ? r.category : p.category,
        chip: r.chip || p.chip,
        ai: r.activeIngredient || p.ai,
        group: r.moaGroup || p.group,
        how: r.howItWorks || p.how,
        why: r.whyUseIt || p.why,
        epaReg: r.epaReg || p.epaReg,
        _drafted: true,
      }))
      setImages([]); setImgCount(0)
    } catch { setErr('Could not reach the AI service. Check your connection and try again.') }
    finally { setBusy(false) }
  }

  const save = () => {
    if (!f.name.trim()) { setErr('Give the product a name.'); return }
    const { sectionId, hue } = catToSection(f.category)
    onSave({
      id: f.id || ('cg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
      sectionId, hueKey: hue,
      name: f.name.trim(), chip: f.chip.trim(), ai: f.ai.trim(), group: f.group.trim(),
      how: f.how.trim(), why: f.why.trim(), note: f.note.trim(), verify: !!f.verify,
      epaReg: f.epaReg || '',
      added: true,
      draft: f.draft != null ? f.draft : !!f._drafted,   // AI drafts start as "review"
    })
  }

  const inp = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white'
  const lab = 'font-body text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1 block'

  return (
    <div className="bg-white rounded-2xl border shadow-sm p-4 sm:p-5 space-y-3.5" style={{ borderColor: '#DDD6FE' }}>
      <div className="flex items-center justify-between">
        <p className="font-display text-base font-semibold text-slate-900">{f.id ? 'Edit product' : 'Add a product'}</p>
        <button onClick={onCancel} className="text-slate-300 hover:text-slate-500"><X size={18} /></button>
      </div>

      {/* AI drafting */}
      <div className="rounded-xl p-3 border" style={{ backgroundColor: '#F5F3FF', borderColor: '#DDD6FE' }}>
        <div className="flex items-center gap-1.5 mb-1">
          <Sparkles size={14} style={{ color: '#7C3AED' }} />
          <p className="font-body text-[11px] font-bold uppercase tracking-wide" style={{ color: '#7C3AED' }}>Draft from the label with AI</p>
        </div>
        <p className="font-body text-[10.5px] text-slate-500 mb-2">Type the name above (or snap the label) and the AI drafts the class, active ingredient, group and a plain-English write-up. <b>Always double-check against the physical label before you spray.</b></p>
        <div className="flex flex-wrap gap-2">
          <label className="font-body text-xs font-semibold px-3 py-1.5 rounded-full border cursor-pointer flex items-center gap-1.5" style={{ backgroundColor: 'white', color: '#7C3AED', borderColor: '#DDD6FE' }}>
            <CloudUpload size={13} /> {imgCount > 0 ? `${imgCount} photo${imgCount > 1 ? 's' : ''} ready` : 'Add label photo'}
            <input type="file" accept="image/*" multiple onChange={onPick} className="hidden" />
          </label>
          <button type="button" onClick={draft} disabled={busy} className="font-body text-xs font-bold px-3.5 py-1.5 rounded-full text-white flex items-center gap-1.5 disabled:opacity-60" style={{ backgroundColor: '#7C3AED' }}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {busy ? 'Drafting…' : (imgCount > 0 ? 'Draft from photo' : 'Draft by name')}
          </button>
        </div>
        {err && <p className="font-body text-[11px] mt-2 font-semibold" style={{ color: '#DC2626' }}>{err}</p>}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div><label className={lab}>Product name</label><input value={f.name} onChange={(e) => set('name', e.target.value)} className={inp} placeholder="e.g. Daconil Action" /></div>
        <div><label className={lab}>Class</label>
          <select value={f.category} onChange={(e) => set('category', e.target.value)} className={inp}>
            {CHEM_CATEGORIES.map((c) => <option key={c.label} value={c.label}>{c.label}</option>)}
          </select>
        </div>
        <div><label className={lab}>Active ingredient</label><input value={f.ai} onChange={(e) => set('ai', e.target.value)} className={inp} placeholder="e.g. chlorothalonil" /></div>
        <div><label className={lab}>Group / behaviour</label><input value={f.group} onChange={(e) => set('group', e.target.value)} className={inp} placeholder="e.g. FRAC M05 · multi-site" /></div>
      </div>
      <div><label className={lab}>Chip (short tag)</label><input value={f.chip} onChange={(e) => set('chip', e.target.value)} className={inp} placeholder="e.g. Contact · Systemic · Nitrogen" /></div>
      <div><label className={lab}>How it works</label><textarea value={f.how} onChange={(e) => set('how', e.target.value)} rows={3} className={inp} placeholder="Plain-English mode of action…" /></div>
      <div><label className={lab}>Why we use it</label><textarea value={f.why} onChange={(e) => set('why', e.target.value)} rows={2} className={inp} placeholder="What it controls / where it fits…" /></div>
      <div><label className={lab}>Note (optional)</label><input value={f.note} onChange={(e) => set('note', e.target.value)} className={inp} placeholder="e.g. High resistance risk — rotate." /></div>
      <label className="flex items-center gap-2 font-body text-[12px] text-slate-600">
        <input type="checkbox" checked={!!f.verify} onChange={(e) => set('verify', e.target.checked)} /> Flag “verify the label” on this card
      </label>

      <div className="flex gap-2 pt-1">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl text-sm font-semibold font-body text-slate-500 border border-slate-200">Cancel</button>
        <button onClick={save} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body text-white" style={{ backgroundColor: FOREST }}>{f.id ? 'Save changes' : 'Add to guide'}</button>
      </div>
    </div>
  )
}

// Map a Chemical Library product type to a guide category label.
const TYPE_TO_CATEGORY = { Fungicide: 'Fungicide', Herbicide: 'Herbicide', Insecticide: 'Insecticide', 'Growth Reg': 'Growth regulator', Biological: 'Biological', 'Wetting Agent': 'Wetting agent', Fertilizer: 'Fertility' }

export default function ChemistryGuide({ courseInfo = {}, products = [], grassTypes = [], manage = false, onSave }) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)   // user card being edited
  const [bulk, setBulk] = useState(null)          // { total, done, running, error }
  const bulkStop = useRef(false)
  const term = q.trim().toLowerCase()

  const userCards = Array.isArray(courseInfo?.chemGuide) ? courseInfo.chemGuide : []

  const persist = async (next) => { if (onSave) await onSave(next) }

  // Products in the Chemical Library that don't yet have a guide card (by name).
  const haveNames = new Set([
    ...CHEM_SECTIONS.flatMap((s) => s.cards.map((c) => c.name.toLowerCase())),
    ...userCards.map((c) => String(c.name || '').toLowerCase()),
  ])
  const missing = (products || []).filter((p) => p.name && !haveNames.has(String(p.name).toLowerCase()))

  // Draft a card for every library product not already in the guide, via the AI
  // label reader (guide mode). Runs a few at a time, saving as it goes.
  const buildFromLibrary = async () => {
    if (!missing.length) return
    if (!confirm(`Draft Chemistry Guide entries for ${missing.length} product${missing.length !== 1 ? 's' : ''} from your Chemical Library? Each is a quick AI look-up (about a penny each) and lands as “Draft — review”.`)) return
    bulkStop.current = false
    setBulk({ total: missing.length, done: 0, running: true, error: null })
    let added = [...userCards]
    let done = 0
    const queue = [...missing]
    const worker = async () => {
      while (queue.length && !bulkStop.current) {
        const p = queue.shift()
        try {
          const res = await fetch('/api/analyze-label', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: p.name, grassTypes, guide: true }),
          })
          const json = await res.json()
          const r = json.result
          if (res.ok && r?.found) {
            const catLabel = CHEM_CATEGORIES.some((c) => c.label === r.category) ? r.category : (TYPE_TO_CATEGORY[p.type] || 'Other')
            const { sectionId, hue } = catToSection(catLabel)
            added = added.filter((c) => c.name.toLowerCase() !== String(p.name).toLowerCase())
            added.push({
              id: 'cg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
              sectionId, hueKey: hue, name: p.name, chip: r.chip || '', ai: r.activeIngredient || p.activeIngredient || '',
              group: r.moaGroup || p.moaGroup || '', how: r.howItWorks || '', why: r.whyUseIt || '', note: '', verify: false,
              epaReg: r.epaReg || p.epaReg || '', added: true, draft: true,
            })
          }
        } catch { /* skip this one */ }
        done += 1
        setBulk((b) => (b ? { ...b, done } : b))
      }
    }
    // limited concurrency
    await Promise.all([worker(), worker(), worker()])
    await persist(added)
    setBulk((b) => (b ? { ...b, running: false } : b))
    setTimeout(() => setBulk(null), 4000)
  }
  const addCard = (card) => { persist([...userCards.filter((c) => c.id !== card.id), card]); setAdding(false); setEditing(null) }
  const removeCard = (id) => { if (confirm('Remove this product from the guide?')) persist(userCards.filter((c) => c.id !== id)) }
  const confirmCard = (id) => persist(userCards.map((c) => (c.id === id ? { ...c, draft: false } : c)))

  const matches = (c) => !term || `${c.name} ${c.chip || ''} ${c.ai || ''} ${c.group || ''} ${c.how || ''} ${c.why || ''} ${c.note || ''}`.toLowerCase().includes(term)

  // Build the ordered sections, merging built-in cards with team-added ones.
  const sections = useMemo(() => {
    const meta = {}
    CHEM_SECTIONS.forEach((s) => { meta[s.id] = { id: s.id, hue: s.hue, tag: s.tag, heading: s.heading, intro: s.intro, cards: [...s.cards] } })
    Object.values(CHEM_EXTRA_SECTIONS).forEach((s) => { if (!meta[s.id]) meta[s.id] = { ...s, cards: [] } })
    userCards.forEach((c) => {
      const sid = meta[c.sectionId] ? c.sectionId : 'other'
      if (!meta[sid]) meta[sid] = { ...CHEM_EXTRA_SECTIONS.other, cards: [] }
      meta[sid].cards.push(c)
    })
    const order = [...CHEM_SECTIONS.map((s) => s.id), 'insecticides', 'other']
    return order
      .map((id) => meta[id])
      .filter(Boolean)
      .filter((s) => cat === 'all' || s.id === cat)
      .map((s) => ({ ...s, cards: s.cards.filter(matches) }))
      .filter((s) => s.cards.length > 0)
  }, [userCards, term, cat]) // eslint-disable-line react-hooks/exhaustive-deps

  // chips: built-in categories always shown; extra ones only if the team added to them.
  const chipSections = useMemo(() => {
    const base = CHEM_SECTIONS.map((s) => ({ id: s.id, title: s.title, hue: s.hue }))
    for (const extraId of ['insecticides', 'other']) {
      if (userCards.some((c) => (c.sectionId === extraId) || (extraId === 'other' && !SECTION_HUE[c.sectionId]))) {
        const ex = CHEM_EXTRA_SECTIONS[extraId]
        base.push({ id: ex.id, title: ex.title, hue: ex.hue })
      }
    }
    return base
  }, [userCards])

  return (
    <div className="max-w-5xl space-y-5 pb-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-body text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Congressional Country Club · Grounds</p>
          <h2 className="font-display text-2xl font-semibold text-slate-900 mt-0.5">Chemistry Guide</h2>
          <p className="font-body text-[13px] text-slate-500 mt-1 max-w-2xl">How every product in the program actually works — on the plant or in the soil — and why it’s on the sheet. For the crew, the interns, and anyone who wants the <em>why</em> behind the tank.</p>
        </div>
        {manage && !adding && !editing && (
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <button onClick={() => setAdding(true)} className="font-body text-xs font-bold px-3.5 py-2 rounded-full text-white flex items-center gap-1.5" style={{ backgroundColor: FOREST }}><Plus size={14} /> Add a product</button>
            {missing.length > 0 && !bulk && (
              <button onClick={buildFromLibrary} className="font-body text-[11px] font-bold px-3 py-1.5 rounded-full flex items-center gap-1.5 border" style={{ color: '#7C3AED', borderColor: '#D6C9F2', backgroundColor: '#F7F4FD' }}><Library size={13} /> Build {missing.length} from library</button>
            )}
          </div>
        )}
      </div>

      {bulk && (
        <div className="rounded-2xl p-4" style={{ backgroundColor: '#F7F4FD', border: '1px solid #D6C9F2' }}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="font-body text-[13px] font-bold" style={{ color: '#6D28D9' }}>
              {bulk.running ? <>Drafting from your library… {bulk.done} of {bulk.total}</> : <>Done — drafted {bulk.done} of {bulk.total}. Review each below and Confirm.</>}
            </p>
            {bulk.running && <button onClick={() => { bulkStop.current = true }} className="font-body text-[11px] font-bold text-slate-500 underline">Stop</button>}
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: '#E4DBF5' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${bulk.total ? Math.round((bulk.done / bulk.total) * 100) : 0}%`, backgroundColor: '#7C3AED' }} />
          </div>
        </div>
      )}

      {(adding || editing) && manage && (
        <AddProductForm
          initial={editing ? { ...editing, category: (CHEM_CATEGORIES.find((c) => c.sectionId === editing.sectionId) || {}).label || 'Other' } : null}
          grassTypes={grassTypes}
          onSave={addCard}
          onCancel={() => { setAdding(false); setEditing(null) }}
        />
      )}

      {/* The big idea */}
      <div className="rounded-2xl p-4 sm:p-5" style={{ backgroundColor: FOREST }}>
        <p className="font-display text-[15px] font-medium text-white/95 leading-snug mb-3.5">Every product in the tank is doing one of a few jobs. Once you know which job a product does, you know why it’s there — and what it can and can’t do.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {CHEM_JOBS.map((j) => (
            <div key={j.job} className="rounded-xl px-3 py-2.5" style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderLeft: `3px solid ${CHEM_HUES[j.hue]}` }}>
              <p className="font-body text-[13px] font-bold text-white">{j.job}</p>
              <p className="font-body text-[11px] text-white/60 leading-snug mt-0.5">{j.blurb}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products, active ingredients, FRAC/HRAC groups…" className="w-full border border-slate-200 rounded-xl pl-9 pr-9 py-2.5 text-sm font-body" />
        {q && <button onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"><X size={15} /></button>}
      </div>

      {/* Category chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mt-1">
        <button onClick={() => setCat('all')} className="font-body text-[11px] font-bold px-3 py-1.5 rounded-full whitespace-nowrap transition" style={cat === 'all' ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>All</button>
        {chipSections.map((s) => {
          const on = cat === s.id
          const hue = CHEM_HUES[s.hue]
          return (
            <button key={s.id} onClick={() => setCat(s.id)} className="font-body text-[11px] font-bold px-3 py-1.5 rounded-full whitespace-nowrap transition inline-flex items-center gap-1.5" style={on ? { backgroundColor: hue, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: on ? 'white' : hue }} />{s.title}
            </button>
          )
        })}
      </div>

      {/* Sections */}
      {sections.length === 0 && (
        <p className="font-body text-sm text-slate-400 py-8 text-center">No products match “{q}”.</p>
      )}
      {sections.map((s) => {
        const hue = CHEM_HUES[s.hue]
        return (
          <section key={s.id} className="space-y-3">
            <div className="flex items-center gap-2.5 pt-1">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: hue }} />
              <h3 className="font-display text-lg font-semibold text-slate-900">{s.heading}</h3>
              {s.tag && <span className="font-body text-[10px] font-bold px-2 py-0.5 rounded-full text-white shrink-0" style={{ backgroundColor: hue }}>{s.tag}</span>}
            </div>
            {s.intro && <p className="font-body text-[12.5px] leading-relaxed text-slate-500 max-w-3xl">{s.intro}</p>}
            <div className="grid md:grid-cols-2 gap-3">
              {s.cards.map((c) => (
                <ProductCard
                  key={c.id || c.name}
                  card={{ ...c, hue: CHEM_HUES[c.hueKey || s.hue] }}
                  hue={CHEM_HUES[c.hueKey || s.hue]}
                  onEdit={() => { setEditing(c); setAdding(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                  onDelete={() => removeCard(c.id)}
                  onConfirm={() => confirmCard(c.id)}
                />
              ))}
            </div>
          </section>
        )
      })}

      {/* Rotation primer */}
      {cat === 'all' && !term && (
        <section className="space-y-3 pt-2">
          <div className="flex items-center gap-2.5">
            <ShieldCheck size={18} style={{ color: GOLD }} />
            <h3 className="font-display text-lg font-semibold text-slate-900">{CHEM_ROTATION.heading}</h3>
          </div>
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4 sm:p-5 space-y-3">
            <p className="font-display text-[15px] font-semibold text-slate-900">{CHEM_ROTATION.title}</p>
            {CHEM_ROTATION.body.map((p, i) => (
              <p key={i} className="font-body text-[12.5px] leading-relaxed text-slate-600">{p}</p>
            ))}
            <div className="grid sm:grid-cols-2 gap-2.5 pt-1">
              <div className="rounded-xl p-3" style={{ backgroundColor: '#F1F7F2' }}>
                <p className="font-body text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: '#2E7D46' }}>Low resistance risk — multi-site</p>
                <p className="font-body text-[12px] leading-snug text-slate-600">{CHEM_ROTATION.low}</p>
              </div>
              <div className="rounded-xl p-3" style={{ backgroundColor: '#FDECEA' }}>
                <p className="font-body text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: '#C0392B' }}>Higher resistance risk — single-site</p>
                <p className="font-body text-[12px] leading-snug text-slate-600">{CHEM_ROTATION.high}</p>
              </div>
            </div>
            <p className="font-body text-[12.5px] leading-relaxed text-slate-700 pt-1">{CHEM_ROTATION.golden}</p>
          </div>
        </section>
      )}

      {/* Footer disclaimer */}
      <div className="rounded-xl px-4 py-3" style={{ backgroundColor: '#F4F6F5', border: '1px solid rgba(0,0,0,0.05)' }}>
        <p className="font-body text-[11px] leading-relaxed text-slate-500">
          <span className="font-bold text-slate-600">About this guide.</span> An educational summary of the products on our spray sheets, compiled from the labels and standard turf references (FRAC/HRAC classifications, university extension). It explains how each chemistry works in plain terms — it is <b>not</b> a substitute for the label, a recommendation, or a rate guide. Anywhere it says “verify the label,” confirm the active ingredient before acting. Team-added products drafted by AI start marked <b>Draft — review</b> until you confirm them.
        </p>
      </div>
    </div>
  )
}
