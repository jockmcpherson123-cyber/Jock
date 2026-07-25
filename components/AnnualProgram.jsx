'use client'

// ── Annual Program ──────────────────────────────────────────────────────────
// The season-long spray plan: import it from the existing Excel pesticide plan,
// then browse it by area. (Editing individual applications, the early-order
// calculator and auto-populating spray sheets come in the next phase.)
import { useState, useEffect, useRef } from 'react'
import { Upload, Calendar, Trash2, Loader2, AlertTriangle, Check, FileSpreadsheet, Plus, CalendarPlus, ChevronDown, ChevronRight, CalendarDays, MapPin, DollarSign, Package } from 'lucide-react'
import * as db from '@/lib/db'
import { parseWorkbook } from '@/lib/importXlsx'
import { downloadCSV } from '@/lib/calc'

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

// A "spray event" = everything going on ONE area on ONE date (the tank mix).
// Groups the underlying one-row-per-product records into those events.
function groupByEvent(list) {
  const map = {}
  const order = []
  list.forEach((a) => {
    const key = `${a.area}||${a.plannedDate || 'none'}`
    if (!map[key]) { map[key] = { key, area: a.area, date: a.plannedDate || null, items: [] }; order.push(key) }
    map[key].items.push(a)
  })
  return order.map((k) => map[k])
}

let _rowSeq = 0
const rowKey = () => `r${Date.now()}_${_rowSeq++}`

const round1 = (n) => Math.round(n * 10) / 10

// Early Order: add up the whole program into how much of each product to buy,
// like the spreadsheet's Totals tab. For each planned application, total product
// (oz) = rate × the area's size. Then oz → cases using the product's case size,
// with a breakdown of ounces by area. No cost — quantities and cases only.
function computeEarlyOrder(apps, products, areas) {
  const prodByName = {}
  products.forEach((p) => { prodByName[p.name] = p })
  const areaKeys = Object.keys(areas || {})
  const sqftFor = (name) => {
    if (areas[name]?.sqft) return areas[name].sqft
    const n = String(name || '').toLowerCase()
    const k = areaKeys.find((x) => x.toLowerCase().startsWith(n)) || areaKeys.find((x) => x.toLowerCase().includes(n))
    return k ? areas[k].sqft || 0 : 0
  }

  const perProduct = {}
  const areaSet = new Set()
  let missingSqft = false
  apps.forEach((a) => {
    const sqft = sqftFor(a.area)
    if (!sqft) { missingSqft = true; return }
    let oz = 0
    if (a.rateOzM != null && a.rateOzM !== '') oz = Number(a.rateOzM) * (sqft / 1000)
    else if (a.rateOzA != null && a.rateOzA !== '') oz = Number(a.rateOzA) * (sqft / 43560)
    if (!oz || !isFinite(oz)) return
    areaSet.add(a.area)
    if (!perProduct[a.product]) perProduct[a.product] = { name: a.product, type: prodByName[a.product]?.type || a.type || 'Other', totalOz: 0, byArea: {} }
    perProduct[a.product].totalOz += oz
    perProduct[a.product].byArea[a.area] = (perProduct[a.product].byArea[a.area] || 0) + oz
  })

  const rows = Object.values(perProduct).map((r) => {
    const p = prodByName[r.name] || {}
    const ozPerCase = Number(p.ozPerCase) || 0
    const unit = p.unit || 'oz'
    const ozPerUnit = Number(p.ozPerUnit) || 0
    const casesExact = ozPerCase ? r.totalOz / ozPerCase : null
    const casesToOrder = casesExact != null ? Math.ceil(casesExact) : null
    const totalInUnits = ozPerUnit ? r.totalOz / ozPerUnit : null
    return { ...r, ozPerCase, unit, caseSize: p.caseSize || '', casesExact, casesToOrder, totalInUnits, missingCase: !ozPerCase }
  }).sort((a, b) => b.totalOz - a.totalOz)

  const areaList = [...areaSet].sort()
  const casesTotal = rows.reduce((s, r) => s + (r.casesToOrder || 0), 0)
  const missingCaseCount = rows.filter((r) => r.missingCase).length
  return { rows, areaList, casesTotal, missingCaseCount, missingSqft }
}

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
        // Force every planned date into the season's year (the spreadsheet's
        // second Date column is often blank, leaving an old template date).
        const yr = Number(imp.year)
        const normalized = imp.data.applications.map((a) => ({
          ...a,
          plannedDate: a.plannedDate ? `${yr}-${a.plannedDate.slice(5)}` : a.plannedDate,
        }))
        await db.bulkInsertApplications(prog.id, normalized)
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

  const blankRow = () => ({ key: rowKey(), product: '', rateOzM: '', rateOzA: '', basis: 'oz / M', type: '', target: '' })

  // Start a brand-new planned spray (one date + one area + a tank mix).
  function startAddApp() {
    setEditApp({
      originalIds: [],
      area: areaFilter !== 'all' ? areaFilter : '',
      plannedDate: new Date().toISOString().slice(0, 10),
      products: [blankRow()],
    })
  }

  // Open an existing spray event (all products on that area + date) for editing.
  function openEvent(items) {
    setEditApp({
      originalIds: items.map((i) => i.id),
      area: items[0].area,
      plannedDate: items[0].plannedDate || '',
      products: items.map((i) => ({
        key: i.id, id: i.id, product: i.product,
        rateOzM: i.rateOzM ?? '', rateOzA: i.rateOzA ?? '',
        basis: i.basis || 'oz / M', type: i.type || '', target: i.target || '',
      })),
    })
  }

  const updateRow = (key, patch) => setEditApp((prev) => ({ ...prev, products: prev.products.map((r) => (r.key === key ? { ...r, ...patch } : r)) }))
  const addRow = () => setEditApp((prev) => ({ ...prev, products: [...prev.products, blankRow()] }))
  const removeRow = (key) => setEditApp((prev) => ({ ...prev, products: prev.products.filter((r) => r.key !== key) }))
  function pickProduct(key, name) {
    const prod = products.find((p) => p.name === name)
    updateRow(key, {
      product: name,
      type: prod?.type || '',
      basis: prod?.basis || 'oz / M',
      rateOzM: prod?.rate != null ? prod.rate : '',
    })
  }

  async function saveApp() {
    const rows = (editApp.products || []).filter((r) => r.product)
    if (!editApp.area || rows.length === 0) {
      showToast('Pick an area and at least one product')
      return
    }
    setBusy(true)
    try {
      // Save each product in the mix (sharing the same area + date).
      for (const r of rows) {
        await db.upsertApplication({
          id: r.id,
          programId: activeProgram.id,
          area: editApp.area,
          plannedDate: editApp.plannedDate || null,
          product: r.product,
          rateOzM: r.rateOzM === '' ? null : Number(r.rateOzM),
          rateOzA: r.rateOzA === '' ? null : Number(r.rateOzA),
          basis: r.basis || 'oz / M',
          type: r.type || null,
          target: r.target || null,
        })
      }
      // Delete any products that were removed from the mix.
      const keptIds = new Set(rows.filter((r) => r.id).map((r) => r.id))
      for (const id of editApp.originalIds || []) {
        if (!keptIds.has(id)) await db.deleteApplication(id)
      }
      setApps(await db.fetchApplications(activeProgram.id))
      setEditApp(null)
      showToast('Planned spray saved')
    } catch (e) {
      console.error(e)
      showToast('Could not save — check your connection')
    }
    setBusy(false)
  }

  // Delete a whole planned spray (every product on that area + date).
  async function deleteEvent() {
    if (!editApp.originalIds?.length) { setEditApp(null); return }
    if (!confirm('Delete this whole planned spray?')) return
    setBusy(true)
    try {
      for (const id of editApp.originalIds) await db.deleteApplication(id)
      setApps(await db.fetchApplications(activeProgram.id))
      setEditApp(null)
      showToast('Planned spray removed')
    } catch (e) {
      console.error(e)
      showToast('Could not remove')
    }
    setBusy(false)
  }

  function startCopy() {
    const nextYear = (activeProgram.year || new Date().getFullYear()) + 1
    setCopyForm({ year: nextYear, name: `${nextYear} Pesticide Plan`, shiftDays: 0 })
  }

  // Shift any planned dates that aren't in the program's year to that year,
  // keeping month + day. Fixes old template dates pulled in on import.
  async function normalizeDates() {
    const yr = activeProgram.year
    const toFix = apps.filter((a) => a.plannedDate && a.plannedDate.slice(0, 4) !== String(yr))
    if (!toFix.length) return
    setBusy(true)
    try {
      for (const a of toFix) {
        await db.upsertApplication({ ...a, programId: activeProgram.id, plannedDate: `${yr}-${a.plannedDate.slice(5)}` })
      }
      setApps(await db.fetchApplications(activeProgram.id))
      showToast(`Dates moved into ${yr}`)
    } catch (e) {
      console.error(e)
      showToast('Could not fix the dates')
    }
    setBusy(false)
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

  // What's due in the next 7 days (across the whole course) — shown on top so
  // you see this week's sprays without scrolling.
  const _today = new Date(); _today.setHours(0, 0, 0, 0)
  const _in7 = new Date(_today); _in7.setDate(_in7.getDate() + 7)
  const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const todayIso = isoLocal(_today)
  const in7Iso = isoLocal(_in7)
  const overdueEvents = groupByEvent(apps.filter((a) => a.plannedDate && a.plannedDate < todayIso).sort((a, b) => dateKey(b).localeCompare(dateKey(a)))).slice(0, 3)
  const thisWeekEvents = groupByEvent(apps.filter((a) => a.plannedDate && a.plannedDate >= todayIso && a.plannedDate <= in7Iso))
  const offYearCount = activeProgram ? apps.filter((a) => a.plannedDate && a.plannedDate.slice(0, 4) !== String(activeProgram.year)).length : 0

  // Early-order totals for the whole season (respects the area filter).
  const earlyOrder = computeEarlyOrder(visibleApps, products, areas)
  const exportEarlyOrder = () => {
    const areaCols = earlyOrder.areaList
    const rows = [['Product', 'Type', 'Total oz', 'Case size', 'Oz/case', 'Cases needed', 'Cases to order', ...areaCols]]
    earlyOrder.rows.forEach((r) => rows.push([
      r.name, r.type, Math.round(r.totalOz), r.caseSize, r.ozPerCase || '',
      r.casesExact != null ? round1(r.casesExact) : '', r.casesToOrder != null ? r.casesToOrder : '',
      ...areaCols.map((a) => Math.round(r.byArea[a] || 0)),
    ]))
    downloadCSV(rows, `Early_Order_${activeProgram?.year || ''}.csv`)
  }

  // A whole planned spray: date + area + the tank mix. Tapping opens it to edit.
  const EventCard = (ev, opts = {}) => (
    <button key={ev.key} onClick={() => openEvent(ev.items)} className="w-full text-left bg-white rounded-2xl border border-black/5 overflow-hidden shadow-sm hover:border-slate-200 transition">
      <div className="flex items-center justify-between px-4 py-2.5" style={{ backgroundColor: '#F0F6F2' }}>
        <p className="font-body text-xs font-bold flex items-center gap-1.5" style={{ color: FOREST }}>
          <Calendar size={12} />{fmtDateHeading(ev.date)}
        </p>
        <span className="font-body text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'white', color: FERN }}>
          {opts.badge != null ? opts.badge : ev.area}
        </span>
      </div>
      <div className="divide-y divide-black/5">
        {ev.items.map((a) => (
          <div key={a.id} className="flex items-center gap-2.5 px-4 py-2.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: typeColor(a.type) }} />
            <div className="min-w-0 flex-1">
              <p className="font-body text-sm font-semibold text-slate-800 truncate">{a.product}</p>
              {(a.rateOzM || a.target) && (
                <p className="font-body text-[11px] text-slate-400 truncate">{a.rateOzM ? `${a.rateOzM} oz/M` : ''}{a.rateOzM && a.target ? ' · ' : ''}{a.target || ''}</p>
              )}
            </div>
            {a.type && (
              <span className="font-body text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0" style={{ backgroundColor: `${typeColor(a.type)}18`, color: typeColor(a.type) }}>{a.type}</span>
            )}
          </div>
        ))}
      </div>
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

      {/* Planned-spray editor — one date + one area + a tank mix of products */}
      {editApp && (
        <div className="bg-white rounded-2xl border-2 p-4 my-4 shadow-sm" style={{ borderColor: GOLD }}>
          <p className="font-display text-base font-semibold text-slate-900 mb-1">
            {editApp.originalIds?.length ? 'Edit planned spray' : 'New planned spray'}
          </p>
          <p className="font-body text-xs text-slate-400 mb-3">One area, one date, and everything going in the tank.</p>
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
              <div className="flex items-center justify-between mb-1.5">
                <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide">Products in the tank</label>
                <button onClick={addRow} className="font-body text-xs font-bold flex items-center gap-1" style={{ color: FERN }}><Plus size={13} /> Add product</button>
              </div>
              <div className="space-y-2">
                {editApp.products.map((r) => (
                  <div key={r.key} className="rounded-xl border border-slate-100 p-2.5" style={{ backgroundColor: '#F8FAF9' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <select value={r.product} onChange={(e) => pickProduct(r.key, e.target.value)} className="flex-1 border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-body bg-white">
                        <option value="">Select product…</option>
                        {products.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                      </select>
                      {editApp.products.length > 1 && (
                        <button onClick={() => removeRow(r.key)} className="text-slate-300 hover:text-red-500 transition shrink-0" aria-label="Remove product"><Trash2 size={15} /></button>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="font-body text-[10px] font-bold text-slate-400 uppercase block mb-1">Rate oz/M</label>
                        <input type="number" step="any" value={r.rateOzM} onChange={(e) => updateRow(r.key, { rateOzM: e.target.value })} className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-body bg-white" />
                      </div>
                      <div>
                        <label className="font-body text-[10px] font-bold text-slate-400 uppercase block mb-1">Rate oz/A</label>
                        <input type="number" step="any" value={r.rateOzA} onChange={(e) => updateRow(r.key, { rateOzA: e.target.value })} className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-body bg-white" />
                      </div>
                      <div>
                        <label className="font-body text-[10px] font-bold text-slate-400 uppercase block mb-1">Target</label>
                        <input value={r.target} onChange={(e) => updateRow(r.key, { target: e.target.value })} className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-body bg-white" placeholder="e.g. Dollar Spot" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              {editApp.originalIds?.length > 0 && (
                <button onClick={deleteEvent} className="py-2.5 px-3 rounded-xl text-red-500 border border-red-100" aria-label="Delete planned spray"><Trash2 size={15} /></button>
              )}
              <button onClick={() => setEditApp(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold font-body text-slate-500 border border-slate-200">Cancel</button>
              <button onClick={saveApp} disabled={busy} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body text-white disabled:opacity-50" style={{ backgroundColor: FOREST }}>{busy ? 'Saving…' : 'Save'}</button>
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

          {/* Off-year dates (old template dates pulled in on import) */}
          {offYearCount > 0 && (
            <div className="flex items-center gap-3 rounded-2xl bg-amber-50 border border-amber-200 p-3 mb-4">
              <AlertTriangle size={18} className="text-amber-500 shrink-0" />
              <p className="font-body text-[12px] text-amber-800 flex-1">
                <b>{offYearCount}</b> spray{offYearCount !== 1 ? 's have' : ' has'} a date outside {activeProgram.year} (old dates from the spreadsheet). Move {offYearCount !== 1 ? 'them' : 'it'} into {activeProgram.year}, keeping the same month &amp; day?
              </p>
              <button onClick={normalizeDates} disabled={busy} className="font-body text-xs font-bold px-3 py-2 rounded-full text-white shrink-0 disabled:opacity-50" style={{ backgroundColor: '#92660D' }}>
                {busy ? 'Fixing…' : `Fix to ${activeProgram.year}`}
              </button>
            </div>
          )}

          {/* This week's sprays — on top, no scrolling needed */}
          <div className="rounded-2xl p-4 mb-4 border-2" style={{ borderColor: GOLD, backgroundColor: '#FFFDF6' }}>
            <div className="flex items-center gap-1.5 mb-2">
              <Calendar size={14} style={{ color: '#92660D' }} />
              <p className="font-display text-base font-bold" style={{ color: '#92660D' }}>This Week</p>
              <span className="font-body text-[11px] text-slate-400">next 7 days</span>
            </div>
            {thisWeekEvents.length === 0 ? (
              <p className="font-body text-sm text-slate-500">Nothing scheduled in the next 7 days.{overdueEvents.length > 0 ? ' A few sprays are past their planned date — see below.' : ''}</p>
            ) : (
              <div className="space-y-2">
                {thisWeekEvents.map((ev) => EventCard(ev))}
              </div>
            )}
            {overdueEvents.length > 0 && (
              <div className="mt-3">
                <p className="font-body text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: '#B91C1C' }}>Past their date</p>
                <div className="space-y-2">
                  {overdueEvents.map((ev) => EventCard(ev))}
                </div>
              </div>
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
            {[['timeline', 'Timeline', CalendarDays], ['area', 'By Area', MapPin], ['order', 'Early Order', DollarSign]].map(([k, label, Icon]) => (
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
                          {groupByEvent(mg.items).map((ev) => EventCard(ev))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          ) : viewMode === 'area' ? (
            /* By Area */
            <div className="space-y-4">
              {areaGroups.map((ag) => {
                const folded = collapsed[`a:${ag.area}`]
                const events = groupByEvent(ag.items)
                return (
                  <div key={ag.area}>
                    <button onClick={() => toggle(`a:${ag.area}`)} className="w-full flex items-center justify-between mb-2">
                      <span className="font-display text-base font-bold flex items-center gap-1.5" style={{ color: FOREST }}>
                        {folded ? <ChevronRight size={16} /> : <ChevronDown size={16} />}{ag.area}
                      </span>
                      <span className="font-body text-[11px] font-semibold text-slate-400">{events.length} spray{events.length !== 1 ? 's' : ''} · {uniqueDays(ag.items)} days</span>
                    </button>
                    {!folded && (
                      <div className="space-y-3">
                        {events.map((ev) => EventCard(ev, { badge: `${ev.items.length} product${ev.items.length !== 1 ? 's' : ''}` }))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            /* Early Order — how much to buy for the season (quantities + cases) */
            <div>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="bg-white rounded-xl border border-black/5 px-3 py-2.5 shadow-sm">
                  <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400">Products</p>
                  <p className="font-display font-bold text-slate-900" style={{ fontSize: 20, marginTop: 2 }}>{earlyOrder.rows.length}</p>
                </div>
                <div className="bg-white rounded-xl border border-black/5 px-3 py-2.5 shadow-sm">
                  <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400">Cases to order</p>
                  <p className="font-display font-bold text-slate-900" style={{ fontSize: 20, marginTop: 2 }}>{earlyOrder.casesTotal}</p>
                </div>
                <button onClick={exportEarlyOrder} className="rounded-xl text-white shadow-sm flex flex-col items-center justify-center gap-1" style={{ backgroundColor: FOREST }}>
                  <Package size={16} />
                  <span className="font-body text-[11px] font-bold">Export CSV</span>
                </button>
              </div>

              {(earlyOrder.missingCaseCount > 0 || earlyOrder.missingSqft) && (
                <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-100 p-3 mb-3">
                  <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
                  <p className="font-body text-[11px] text-amber-700">
                    {earlyOrder.missingCaseCount > 0 && <>{earlyOrder.missingCaseCount} product{earlyOrder.missingCaseCount !== 1 ? 's' : ''} missing “Oz/case” — add it in the Chemical Library (Ordering section) to get its cases-needed. </>}
                    {earlyOrder.missingSqft && <>Some areas have no square footage set (Settings → Sprayer Areas), so their totals can't be calculated.</>}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                {earlyOrder.rows.map((r) => {
                  const areasUsed = Object.entries(r.byArea).sort((a, b) => b[1] - a[1])
                  return (
                    <div key={r.name} className="bg-white rounded-2xl border border-black/5 p-3 shadow-sm">
                      <div className="flex items-start gap-3">
                        <span className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: typeColor(r.type) }} />
                        <div className="min-w-0 flex-1">
                          <p className="font-body text-sm font-semibold text-slate-800 truncate">{r.name}</p>
                          <p className="font-body text-[11px] text-slate-400">
                            {Math.round(r.totalOz).toLocaleString()} oz total{r.totalInUnits != null ? ` (${round1(r.totalInUnits)} ${r.unit})` : ''}{r.caseSize ? ` · ${r.caseSize}` : ''}{r.ozPerCase ? ` @ ${r.ozPerCase} oz/case` : ''}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          {r.casesToOrder != null ? (
                            <>
                              <p className="font-display text-lg font-bold text-slate-900 leading-none">{r.casesToOrder}</p>
                              <p className="font-body text-[9px] uppercase tracking-wide text-slate-400 mt-0.5">case{r.casesToOrder !== 1 ? 's' : ''} · need {round1(r.casesExact)}</p>
                            </>
                          ) : (
                            <p className="font-body text-[11px] font-semibold text-amber-600">add oz/case</p>
                          )}
                        </div>
                      </div>
                      {areasUsed.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2 pl-5">
                          {areasUsed.map(([area, oz]) => (
                            <span key={area} className="font-body text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: '#F0F6F2', color: FERN }}>{area}: {Math.round(oz).toLocaleString()} oz</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
                {earlyOrder.rows.length === 0 && (
                  <div className="bg-white rounded-2xl border border-black/5 p-8 text-center text-slate-400 font-body text-sm">Nothing to total yet — add planned sprays and set area sizes.</div>
                )}
              </div>

              <p className="font-body text-[10px] text-slate-400 mt-3">Estimate for planning. Totals = each application's rate × the area's size, summed over the season, then converted to cases with each product's Oz/case. “Cases” rounds up to whole cases; “need” is the exact amount.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
