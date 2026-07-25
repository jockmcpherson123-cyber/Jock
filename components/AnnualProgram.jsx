'use client'

// ── Annual Program ──────────────────────────────────────────────────────────
// The season-long spray plan: import it from the existing Excel pesticide plan,
// then browse it by area. (Editing individual applications, the early-order
// calculator and auto-populating spray sheets come in the next phase.)
import { useState, useEffect, useRef } from 'react'
import { Upload, Calendar, Trash2, Loader2, AlertTriangle, Check, FileSpreadsheet, Plus, CalendarPlus, ChevronDown, ChevronRight, CalendarDays, MapPin } from 'lucide-react'
import * as db from '@/lib/db'
import { parseWorkbook } from '@/lib/importXlsx'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#C9A84C'

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// A fuller date heading for the grouped view, e.g. "Mon · Mar 30, 2021".
function fmtDateHeading(d) {
  if (!d) return 'No date set'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
}

// Group a list of applications by planned date, preserving date order.
function groupByDate(list) {
  const groups = []
  const index = {}
  list.forEach((a) => {
    const key = a.plannedDate || 'none'
    if (index[key] == null) {
      index[key] = groups.length
      groups.push({ date: a.plannedDate || null, items: [] })
    }
    groups[index[key]].items.push(a)
  })
  return groups
}

// Sort key that pushes undated applications to the very end.
const dateKey = (a) => a.plannedDate || '9999-99-99'

// The 'YYYY-MM' month bucket for an application.
function monthKey(d) {
  return d ? d.slice(0, 7) : 'none'
}
function fmtMonth(key) {
  if (key === 'none') return 'No date set'
  const [y, m] = key.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}
function fmtMonthShort(key) {
  if (key === 'none') return 'No date'
  const [y, m] = key.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short' })
}

// Group by month (date-ordered), each month carrying its date sub-groups.
function groupByMonth(list) {
  const sorted = [...list].sort((a, b) => dateKey(a).localeCompare(dateKey(b)))
  const groups = []
  const index = {}
  sorted.forEach((a) => {
    const key = monthKey(a.plannedDate)
    if (index[key] == null) { index[key] = groups.length; groups.push({ key, items: [] }) }
    groups[index[key]].items.push(a)
  })
  return groups
}

// Group by area (area-name order), each area date-sorted.
function groupByArea(list) {
  const byArea = {}
  list.forEach((a) => { (byArea[a.area] = byArea[a.area] || []).push(a) })
  return Object.keys(byArea).sort().map((area) => ({
    area,
    items: byArea[area].sort((a, b) => dateKey(a).localeCompare(dateKey(b))),
  }))
}

const uniqueDays = (items) => new Set(items.filter((a) => a.plannedDate).map((a) => a.plannedDate)).size

// A distinct color per product type for quick visual scanning.
function typeColor(type) {
  return {
    Fungicide: '#3A6B4A', Herbicide: '#D97706', Insecticide: '#DC2626',
    'Growth Reg': '#7C3AED', Fertilizer: '#2563EB', Biological: '#0D9488',
    'Wetting Agent': '#64748B',
  }[type] || '#94A3B8'
}

export default function AnnualProgram({ areas, products = [], onProductsChanged }) {
  const [programs, setPrograms] = useState([])
  const [activeProgram, setActiveProgram] = useState(null)
  const [apps, setApps] = useState([])
  const [loading, setLoading] = useState(true)
  const [areaFilter, setAreaFilter] = useState('all')
  const [imp, setImp] = useState(null) // import flow state
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [editApp, setEditApp] = useState(null) // application being added/edited
  const [copyForm, setCopyForm] = useState(null) // roll-forward form state
  const [newForm, setNewForm] = useState(null) // blank-season form state
  const [viewMode, setViewMode] = useState('timeline') // 'timeline' | 'area'
  const [collapsed, setCollapsed] = useState({}) // section key -> true when folded
  const fileRef = useRef(null)

  const toggle = (k) => setCollapsed((c) => ({ ...c, [k]: !c[k] }))
  const scrollToMonth = (key) => {
    document.getElementById(`month-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(null), 3000) }

  useEffect(() => { loadPrograms() }, [])

  async function loadPrograms() {
    setLoading(true)
    try {
      const list = await db.fetchPrograms()
      setPrograms(list)
      if (list.length > 0) {
        setActiveProgram(list[0])
        setApps(await db.fetchApplications(list[0].id))
      }
    } catch (e) {
      console.error(e)
      showToast('Could not load programs')
    }
    setLoading(false)
  }

  async function selectProgram(p) {
    setActiveProgram(p)
    setAreaFilter('all')
    try {
      setApps(await db.fetchApplications(p.id))
    } catch (e) {
      console.error(e)
    }
  }

  async function onFileChosen(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImp({ stage: 'parsing' })
    try {
      const buf = await file.arrayBuffer()
      const data = parseWorkbook(buf)
      const year = new Date().getFullYear()
      setImp({
        stage: 'preview',
        data,
        importProducts: true,
        importProgram: true,
        year,
        name: `${year} Pesticide Plan`,
      })
    } catch (err) {
      console.error(err)
      setImp(null)
      showToast('Could not read that file — is it the pesticide plan .xlsx?')
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  async function runImport() {
    if (!imp?.data) return
    setBusy(true)
    try {
      if (imp.importProducts) {
        await db.bulkUpsertProducts(imp.data.products)
        onProductsChanged?.()
      }
      if (imp.importProgram) {
        const prog = await db.createProgram({ year: Number(imp.year), name: imp.name })
        await db.bulkInsertApplications(prog.id, imp.data.applications)
      }
      setImp(null)
      await loadPrograms()
      showToast('Import complete')
    } catch (e) {
      console.error(e)
      showToast('Import failed — ' + (e?.message || 'unknown error'))
    }
    setBusy(false)
  }

  async function removeProgram(p) {
    if (!confirm(`Delete "${p.name}" and all its planned applications? This cannot be undone.`)) return
    try {
      await db.deleteProgram(p.id)
      showToast('Program deleted')
      await loadPrograms()
      if (activeProgram?.id === p.id) { setActiveProgram(null); setApps([]) }
    } catch (e) {
      console.error(e)
      showToast('Could not delete program')
    }
  }

  function startAddApp() {
    setEditApp({
      programId: activeProgram.id,
      area: areaFilter !== 'all' ? areaFilter : '',
      product: '',
      rateOzM: '',
      rateOzA: '',
      basis: 'oz / M',
      type: '',
      target: '',
      plannedDate: new Date().toISOString().slice(0, 10),
    })
  }

  function pickProduct(name) {
    const prod = products.find((p) => p.name === name)
    setEditApp((prev) => ({
      ...prev,
      product: name,
      type: prod?.type || prev.type,
      basis: prod?.basis || prev.basis,
      rateOzM: prev.rateOzM === '' && prod?.rate != null ? prod.rate : prev.rateOzM,
    }))
  }

  async function saveApp() {
    if (!editApp.product || !editApp.area) {
      showToast('Pick an area and a product first')
      return
    }
    setBusy(true)
    try {
      const saved = await db.upsertApplication({
        ...editApp,
        rateOzM: editApp.rateOzM === '' ? null : Number(editApp.rateOzM),
        rateOzA: editApp.rateOzA === '' ? null : Number(editApp.rateOzA),
      })
      setApps((prev) => {
        const exists = prev.some((a) => a.id === saved.id)
        const next = exists ? prev.map((a) => (a.id === saved.id ? saved : a)) : [...prev, saved]
        return next.sort((a, b) => String(a.plannedDate || '').localeCompare(String(b.plannedDate || '')))
      })
      setEditApp(null)
      showToast('Application saved')
    } catch (e) {
      console.error(e)
      showToast('Could not save application')
    }
    setBusy(false)
  }

  async function removeApp(id) {
    try {
      await db.deleteApplication(id)
      setApps((prev) => prev.filter((a) => a.id !== id))
      setEditApp(null)
      showToast('Application removed')
    } catch (e) {
      console.error(e)
      showToast('Could not remove application')
    }
  }

  function startCopy() {
    const nextYear = (activeProgram.year || new Date().getFullYear()) + 1
    setCopyForm({ year: nextYear, name: `${nextYear} Pesticide Plan`, shiftDays: 0 })
  }

  function startNewProgram() {
    // Default to the next year we don't already have a program for.
    const years = programs.map((p) => p.year).filter(Boolean)
    let year = new Date().getFullYear()
    while (years.includes(year)) year += 1
    setNewForm({ year, name: `${year} Pesticide Plan` })
  }

  async function runNewProgram() {
    setBusy(true)
    try {
      const prog = await db.createProgram({ year: Number(newForm.year), name: newForm.name })
      setNewForm(null)
      await loadPrograms()
      await selectProgram(prog)
      showToast('New season created — add applications when ready')
    } catch (e) {
      console.error(e)
      showToast('Could not create the season')
    }
    setBusy(false)
  }

  async function runCopy() {
    setBusy(true)
    try {
      const prog = await db.copyProgram(activeProgram.id, {
        year: Number(copyForm.year),
        name: copyForm.name,
        shiftDays: Number(copyForm.shiftDays) || 0,
      })
      setCopyForm(null)
      await loadPrograms()
      await selectProgram(prog)
      showToast('New season created')
    } catch (e) {
      console.error(e)
      showToast('Could not roll forward')
    }
    setBusy(false)
  }

  if (loading) {
    return (
      <div className="pt-16 flex justify-center">
        <Loader2 className="animate-spin text-slate-300" size={26} />
      </div>
    )
  }

  // Per-area counts for the current program.
  const areaCounts = {}
  apps.forEach((a) => { areaCounts[a.area] = (areaCounts[a.area] || 0) + 1 })
  const areaNames = Object.keys(areaCounts).sort()
  const visibleApps = areaFilter === 'all' ? apps : apps.filter((a) => a.area === areaFilter)

  // Derived groupings + a season summary for the redesigned browse views.
  const monthGroups = groupByMonth(visibleApps)
  const areaGroups = groupByArea(visibleApps)
  const thisMonth = new Date().toISOString().slice(0, 7)
  const datedApps = visibleApps.filter((a) => a.plannedDate).map((a) => a.plannedDate).sort()
  const seasonSpan = datedApps.length ? `${fmtDate(datedApps[0])} – ${fmtDate(datedApps[datedApps.length - 1])}` : '—'
  const summary = [
    { label: 'Applications', value: visibleApps.length },
    { label: 'Spray days', value: uniqueDays(visibleApps) },
    { label: 'Areas', value: new Set(visibleApps.map((a) => a.area)).size },
    { label: 'Season', value: seasonSpan, wide: true },
  ]

  // One tappable application row, shared by both views.
  const AppRow = (a, opts = {}) => (
    <button key={a.id} onClick={() => setEditApp({ ...a, rateOzM: a.rateOzM ?? '', rateOzA: a.rateOzA ?? '', target: a.target || '' })} className={`w-full text-left flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50 ${opts.border ? 'border-t border-black/5' : ''}`}>
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: typeColor(a.type) }} />
      <div className="min-w-0 flex-1">
        <p className="font-body text-sm font-semibold text-slate-800 truncate">{a.product}</p>
        <p className="font-body text-[11px] text-slate-400 truncate">
          {opts.showArea ? `${a.area} · ` : ''}{opts.showDate && a.plannedDate ? `${fmtDate(a.plannedDate)} · ` : ''}{a.rateOzM ? `${a.rateOzM} oz/M` : ''}{a.target ? ` · ${a.target}` : ''}
        </p>
      </div>
      {a.type && (
        <span className="font-body text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0" style={{ backgroundColor: `${typeColor(a.type)}18`, color: typeColor(a.type) }}>{a.type}</span>
      )}
    </button>
  )

  return (
    <div className="pt-6 pb-10">
      {toast && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 text-white px-4 py-2.5 rounded-full shadow-xl text-sm font-body font-medium" style={{ backgroundColor: '#1A1A16' }}>
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">Annual Program</h2>
          <p className="font-body text-xs text-slate-400 mt-0.5">Your season-long spray plan, by area</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {activeProgram && (
            <button onClick={startAddApp} className="font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5" style={{ backgroundColor: GOLD, color: FOREST }}>
              <Plus size={14} /> Add Application
            </button>
          )}
          <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={onFileChosen} className="hidden" />
          <button onClick={() => fileRef.current?.click()} className="font-body text-xs font-bold px-3.5 py-2 rounded-full text-white flex items-center gap-1.5" style={{ backgroundColor: FOREST }}>
            <Upload size={14} /> Import from Excel
          </button>
        </div>
      </div>

      {/* Import preview / confirm */}
      {imp && (
        <div className="bg-white rounded-2xl border-2 p-4 my-4 shadow-sm" style={{ borderColor: GOLD }}>
          {imp.stage === 'parsing' ? (
            <div className="flex items-center gap-3 text-slate-500 font-body text-sm py-2">
              <Loader2 className="animate-spin" size={18} /> Reading your spreadsheet…
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3">
                <FileSpreadsheet size={18} style={{ color: FERN }} />
                <p className="font-display text-base font-semibold text-slate-900">Import preview</p>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <label className="flex items-start gap-2 rounded-xl border border-slate-200 p-3 cursor-pointer">
                  <input type="checkbox" checked={imp.importProducts} onChange={(e) => setImp({ ...imp, importProducts: e.target.checked })} className="mt-0.5" style={{ accentColor: FERN }} />
                  <span>
                    <span className="font-body text-sm font-semibold text-slate-800 block">{imp.data.products.length} products</span>
                    <span className="font-body text-[11px] text-slate-400">Add / update the Chemical Library (keeps existing stock)</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 rounded-xl border border-slate-200 p-3 cursor-pointer">
                  <input type="checkbox" checked={imp.importProgram} onChange={(e) => setImp({ ...imp, importProgram: e.target.checked })} className="mt-0.5" style={{ accentColor: FERN }} />
                  <span>
                    <span className="font-body text-sm font-semibold text-slate-800 block">{imp.data.applications.length} planned applications</span>
                    <span className="font-body text-[11px] text-slate-400">Across {Object.keys(imp.data.areaCounts).filter((k) => imp.data.areaCounts[k] > 0).length} areas</span>
                  </span>
                </label>
              </div>

              {imp.importProgram && (
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Program name</label>
                    <input value={imp.name} onChange={(e) => setImp({ ...imp, name: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
                  </div>
                  <div>
                    <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Year</label>
                    <input type="number" value={imp.year} onChange={(e) => setImp({ ...imp, year: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
                  </div>
                </div>
              )}

              {imp.data.unmatched.length > 0 && (
                <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-100 p-3 mb-3">
                  <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
                  <p className="font-body text-[11px] text-amber-700">
                    {imp.data.unmatched.length} program product{imp.data.unmatched.length !== 1 ? 's' : ''} not found in the product list — they'll still be imported by name, just add their details later in the Chemical Library: <b>{imp.data.unmatched.join(', ')}</b>
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={() => setImp(null)} disabled={busy} className="flex-1 py-2.5 rounded-xl text-sm font-semibold font-body text-slate-500 border border-slate-200">Cancel</button>
                <button onClick={runImport} disabled={busy || (!imp.importProducts && !imp.importProgram)} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body text-white flex items-center justify-center gap-2 disabled:opacity-50" style={{ backgroundColor: FOREST }}>
                  {busy ? <><Loader2 className="animate-spin" size={15} /> Importing…</> : <><Check size={15} /> Import</>}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Application editor */}
      {editApp && (
        <div className="bg-white rounded-2xl border-2 p-4 my-4 shadow-sm" style={{ borderColor: GOLD }}>
          <p className="font-display text-base font-semibold text-slate-900 mb-3">
            {editApp.id ? 'Edit application' : 'Add application'}
          </p>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Area</label>
                <input list="ap-areas" value={editApp.area} onChange={(e) => setEditApp({ ...editApp, area: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" placeholder="e.g. Blue Greens" />
                <datalist id="ap-areas">
                  {[...new Set([...areaNames, ...Object.keys(areas || {})])].map((a) => <option key={a} value={a} />)}
                </datalist>
              </div>
              <div>
                <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Planned date</label>
                <input type="date" value={editApp.plannedDate || ''} onChange={(e) => setEditApp({ ...editApp, plannedDate: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
              </div>
            </div>
            <div>
              <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Product</label>
              <select value={editApp.product} onChange={(e) => pickProduct(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white">
                <option value="">Select product…</option>
                {products.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Rate oz/M</label>
                <input type="number" step="any" value={editApp.rateOzM} onChange={(e) => setEditApp({ ...editApp, rateOzM: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
              </div>
              <div>
                <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Rate oz/A</label>
                <input type="number" step="any" value={editApp.rateOzA} onChange={(e) => setEditApp({ ...editApp, rateOzA: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
              </div>
              <div>
                <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Target</label>
                <input value={editApp.target} onChange={(e) => setEditApp({ ...editApp, target: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" placeholder="e.g. Dollar Spot" />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              {editApp.id && (
                <button onClick={() => removeApp(editApp.id)} className="py-2.5 px-3 rounded-xl text-red-500 border border-red-100"><Trash2 size={15} /></button>
              )}
              <button onClick={() => setEditApp(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold font-body text-slate-500 border border-slate-200">Cancel</button>
              <button onClick={saveApp} disabled={busy} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body text-white disabled:opacity-50" style={{ backgroundColor: FOREST }}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Create a blank season */}
      {newForm && (
        <div className="bg-white rounded-2xl border-2 p-4 my-4 shadow-sm" style={{ borderColor: FOREST }}>
          <p className="font-display text-base font-semibold text-slate-900 mb-1">Start a blank season</p>
          <p className="font-body text-xs text-slate-400 mb-3">Creates an empty program for the year you choose. Add applications yourself, or import an Excel plan into it later.</p>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Year</label>
              <input type="number" value={newForm.year} onChange={(e) => setNewForm({ ...newForm, year: e.target.value, name: `${e.target.value} Pesticide Plan` })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
            </div>
            <div className="col-span-2">
              <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Name</label>
              <input value={newForm.name} onChange={(e) => setNewForm({ ...newForm, name: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setNewForm(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold font-body text-slate-500 border border-slate-200">Cancel</button>
            <button onClick={runNewProgram} disabled={busy} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body text-white disabled:opacity-50 flex items-center justify-center gap-2" style={{ backgroundColor: FOREST }}>
              {busy ? <><Loader2 className="animate-spin" size={15} /> Creating…</> : 'Create Season'}
            </button>
          </div>
        </div>
      )}

      {/* Roll forward to a new season */}
      {copyForm && (
        <div className="bg-white rounded-2xl border-2 p-4 my-4 shadow-sm" style={{ borderColor: FERN }}>
          <p className="font-display text-base font-semibold text-slate-900 mb-1">Roll forward to a new season</p>
          <p className="font-body text-xs text-slate-400 mb-3">Copies every application into a new program, shifting each planned date so the sequence stays intact. Adjust individual applications afterward.</p>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">New year</label>
              <input type="number" value={copyForm.year} onChange={(e) => setCopyForm({ ...copyForm, year: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
            </div>
            <div className="col-span-2">
              <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Name</label>
              <input value={copyForm.name} onChange={(e) => setCopyForm({ ...copyForm, name: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
            </div>
          </div>
          <div className="mb-3">
            <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Shift all dates by (days)</label>
            <input type="number" value={copyForm.shiftDays} onChange={(e) => setCopyForm({ ...copyForm, shiftDays: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" placeholder="e.g. 365, or 0 to keep the same calendar dates" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setCopyForm(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold font-body text-slate-500 border border-slate-200">Cancel</button>
            <button onClick={runCopy} disabled={busy} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body text-white disabled:opacity-50 flex items-center justify-center gap-2" style={{ backgroundColor: FERN }}>
              {busy ? <><Loader2 className="animate-spin" size={15} /> Creating…</> : 'Create Season'}
            </button>
          </div>
        </div>
      )}

      {/* No program yet */}
      {programs.length === 0 && !imp && (
        <div className="bg-white rounded-2xl border border-black/5 p-10 text-center shadow-sm mt-4">
          <FileSpreadsheet className="mx-auto mb-3 text-slate-300" size={30} />
          <p className="font-display text-lg font-semibold text-slate-900 mb-1">No program yet</p>
          <p className="font-body text-sm text-slate-400 max-w-sm mx-auto mb-5">
            Import your existing Excel pesticide plan to load the whole season at once — every area's planned applications, plus your full product list.
          </p>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <button onClick={() => fileRef.current?.click()} className="font-body text-xs font-bold px-4 py-2.5 rounded-full text-white inline-flex items-center gap-1.5" style={{ backgroundColor: FOREST }}>
              <Upload size={14} /> Import from Excel
            </button>
            <button onClick={startNewProgram} className="font-body text-xs font-bold px-4 py-2.5 rounded-full inline-flex items-center gap-1.5" style={{ backgroundColor: 'white', color: FOREST, border: '1px solid rgba(0,0,0,0.12)' }}>
              <Plus size={14} /> Start a blank season
            </button>
          </div>
        </div>
      )}

      {/* Program selector */}
      {programs.length > 0 && (
        <>
          <div className="flex items-center gap-2 mt-4 mb-4 flex-wrap">
            {programs.map((p) => (
              <button key={p.id} onClick={() => selectProgram(p)} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full transition flex items-center gap-2" style={activeProgram?.id === p.id ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>
                {p.name || `${p.year} Program`}
                {activeProgram?.id === p.id && (
                  <span onClick={(e) => { e.stopPropagation(); removeProgram(p) }} className="opacity-70 hover:opacity-100"><Trash2 size={12} /></span>
                )}
              </button>
            ))}
            <button onClick={startNewProgram} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full transition flex items-center gap-1.5" style={{ backgroundColor: 'white', color: FOREST, border: '1px solid rgba(0,0,0,0.08)' }}>
              <Plus size={13} /> New Season
            </button>
            {activeProgram && (
              <button onClick={startCopy} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full transition flex items-center gap-1.5" style={{ backgroundColor: 'white', color: FERN, border: '1px solid rgba(0,0,0,0.08)' }}>
                <CalendarPlus size={13} /> Roll forward
              </button>
            )}
          </div>

          {/* Season summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            {summary.map((s) => (
              <div key={s.label} className={`bg-white rounded-xl border border-black/5 px-3 py-2.5 shadow-sm ${s.wide ? 'col-span-2 sm:col-span-1' : ''}`}>
                <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400">{s.label}</p>
                <p className="font-display font-bold text-slate-900" style={{ fontSize: s.wide ? 13 : 20, lineHeight: 1.2, marginTop: 2 }}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* View toggle */}
          <div className="flex items-center gap-2 mb-3">
            {[['timeline', 'Timeline', CalendarDays], ['area', 'By Area', MapPin]].map(([k, label, Icon]) => (
              <button key={k} onClick={() => setViewMode(k)} className="font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5 transition" style={viewMode === k ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>

          {/* Area filter */}
          <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
            <button onClick={() => setAreaFilter('all')} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition" style={areaFilter === 'all' ? { backgroundColor: FERN, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>
              All areas ({apps.length})
            </button>
            {areaNames.map((a) => (
              <button key={a} onClick={() => setAreaFilter(a)} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition" style={areaFilter === a ? { backgroundColor: FERN, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>
                {a} ({areaCounts[a]})
              </button>
            ))}
          </div>

          {visibleApps.length === 0 ? (
            <div className="bg-white rounded-2xl border border-black/5 p-8 text-center text-slate-400 font-body text-sm">No applications in this program.</div>
          ) : viewMode === 'timeline' ? (
            <>
              {/* Month jump bar */}
              {monthGroups.length > 1 && (
                <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1 -mx-1 px-1">
                  {monthGroups.map((g) => (
                    <button key={g.key} onClick={() => scrollToMonth(g.key)} className="font-body text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap flex items-center gap-1 transition" style={g.key === thisMonth ? { backgroundColor: GOLD, color: FOREST } : { backgroundColor: '#F0F6F2', color: FERN }}>
                      {fmtMonthShort(g.key)} <span className="opacity-60">{g.items.length}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Months → spray days */}
              <div className="space-y-4">
                {monthGroups.map((mg) => {
                  const folded = collapsed[`m:${mg.key}`]
                  return (
                    <div key={mg.key} id={`month-${mg.key}`} style={{ scrollMarginTop: 12 }}>
                      <button onClick={() => toggle(`m:${mg.key}`)} className="w-full flex items-center justify-between mb-2 group">
                        <span className="font-display text-base font-bold flex items-center gap-1.5" style={{ color: FOREST }}>
                          {folded ? <ChevronRight size={16} /> : <ChevronDown size={16} />}{fmtMonth(mg.key)}
                        </span>
                        <span className="font-body text-[11px] font-semibold text-slate-400">{mg.items.length} apps · {uniqueDays(mg.items)} days</span>
                      </button>
                      {!folded && (
                        <div className="space-y-3">
                          {groupByDate(mg.items).map((g) => (
                            <div key={g.date || 'none'} className="bg-white rounded-2xl border border-black/5 overflow-hidden shadow-sm">
                              <div className="flex items-center justify-between px-4 py-2.5" style={{ backgroundColor: '#F0F6F2' }}>
                                <p className="font-body text-xs font-bold flex items-center gap-1.5" style={{ color: FOREST }}>
                                  <Calendar size={12} />{fmtDateHeading(g.date)}
                                </p>
                                <span className="font-body text-[10px] font-semibold text-slate-400">
                                  {g.items.length} application{g.items.length !== 1 ? 's' : ''}
                                </span>
                              </div>
                              {g.items.map((a, i) => AppRow(a, { border: i !== 0, showArea: areaFilter === 'all' }))}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            /* By Area */
            <div className="space-y-3">
              {areaGroups.map((ag) => {
                const folded = collapsed[`a:${ag.area}`]
                return (
                  <div key={ag.area} className="bg-white rounded-2xl border border-black/5 overflow-hidden shadow-sm">
                    <button onClick={() => toggle(`a:${ag.area}`)} className="w-full flex items-center justify-between px-4 py-3" style={{ backgroundColor: '#F0F6F2' }}>
                      <span className="font-body text-sm font-bold flex items-center gap-1.5" style={{ color: FOREST }}>
                        {folded ? <ChevronRight size={14} /> : <ChevronDown size={14} />}{ag.area}
                      </span>
                      <span className="font-body text-[10px] font-semibold text-slate-400">{ag.items.length} apps · {uniqueDays(ag.items)} days</span>
                    </button>
                    {!folded && ag.items.map((a, i) => AppRow(a, { border: i !== 0, showDate: true }))}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
