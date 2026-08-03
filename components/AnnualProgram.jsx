'use client'

// ── Annual Program ──────────────────────────────────────────────────────────
// The season-long spray plan: import it from the existing Excel pesticide plan,
// then browse it by area. (Editing individual applications, the early-order
// calculator and auto-populating spray sheets come in the next phase.)
import { useState, useEffect, useRef } from 'react'
import { Upload, Calendar, Trash2, Loader2, AlertTriangle, Check, FileSpreadsheet, Plus, CalendarPlus, ChevronDown, ChevronRight, CalendarDays, MapPin, DollarSign, Package, Pencil, ClipboardList, Gauge, LayoutGrid, Sparkles } from 'lucide-react'
import * as db from '@/lib/db'
import { parseWorkbook } from '@/lib/importXlsx'
import { downloadCSV } from '@/lib/calc'
import { fetchSeasonDaily, fetchBreakdownTemps, gddSince } from '@/lib/weather'
import { buildPlanFromRecords, planToApplications, recordYears } from '@/lib/planbuilder'
import { triggerStatus, describeTrigger, normalizeTrigger, defaultTrigger, TRIGGER_MODES, GDD_BASES, statusRank, coverageDays, isoAddDays } from '@/lib/triggers'
import { suppressionMap } from '@/lib/pgr'
import { localDateISO } from '@/lib/dates'

// ── Coverage grid helpers ────────────────────────────────────────────────────
// Every application protects its area for a stretch (coverageDays). We paint the
// season WEEK BY WEEK — summer disease/weed pressure moves week to week, so
// months are too coarse to reveal a gap that opens and closes inside a month —
// and flag an *interior* uncovered week (one between covered weeks) as a gap.
// Weeks are 7-day buckets anchored to the Sunday on/before the first spray.
function weeksBetween(startIso, endIso) {
  const s = new Date(startIso + 'T00:00:00')
  s.setDate(s.getDate() - s.getDay()) // back up to Sunday
  const end = new Date(endIso + 'T00:00:00')
  const out = []
  for (let d = new Date(s); d <= end; d.setDate(d.getDate() + 7)) {
    const start = d.toISOString().slice(0, 10)
    out.push({ start, end: isoAddDays(start, 7) }) // [start, end)
  }
  return out
}
// Two-row header: group the weeks by month (for the spanning month labels) and
// number each week within its month (W1, W2, …) — much easier to read than a
// row of dates.
function weekHeader(weeks) {
  const groups = []
  const nums = []
  let n = 0, prevKey = ''
  weeks.forEach((w) => {
    const d = new Date(w.start + 'T00:00:00')
    const key = `${d.getFullYear()}-${d.getMonth()}`
    if (key !== prevKey) { n = 1; prevKey = key; groups.push({ label: d.toLocaleDateString('en-US', { month: 'long' }), span: 1 }) }
    else { n++; groups[groups.length - 1].span++ }
    nums.push(n)
  })
  return { groups, nums }
}
function coverageRow(areaApps, weeks) {
  const spans = areaApps
    .map((a) => { const start = a.plannedDate || a.templateDate; return start ? { start, end: isoAddDays(start, coverageDays(a)) } : null })
    .filter(Boolean)
  const covered = (iso) => spans.some((s) => iso >= s.start && iso < s.end)
  const cells = weeks.map((w) => {
    let c = 0
    for (let i = 0; i < 7; i++) { if (covered(isoAddDays(w.start, i))) c++ }
    return { start: w.start, end: w.end, frac: c / 7 }
  })
  const firstOn = cells.findIndex((c) => c.frac > 0)
  const lastOn = cells.length - 1 - [...cells].reverse().findIndex((c) => c.frac > 0)
  return cells.map((c, i) => {
    let state = ''
    if (c.frac >= 0.6) state = 'on'
    else if (c.frac > 0) state = 'light'
    else if (firstOn !== -1 && i > firstOn && i < lastOn) state = 'gap'
    return { ...c, state }
  })
}
const COVER = '#6FA57C', COVER_LIGHT = '#BCD6C2', GAPCLR = '#E9D9D5'

// Status → chip colors for the Living Calendar. Semantic, separate from the
// program's green/gold accents.
const STATUS_STYLE = {
  overdue: { bg: '#F6E0DC', fg: '#B23A2E', label: 'Overdue' },
  due:     { bg: '#F6E0DC', fg: '#B23A2E', label: 'Due' },
  soon:    { bg: '#F6ECD4', fg: '#9A6B12', label: 'Coming up' },
  ok:      { bg: '#E4EFE5', fg: '#3A6B4A', label: 'On track' },
  none:    { bg: '#EEF1F4', fg: '#6B7280', label: 'No data' },
  done:    { bg: '#E8EAE6', fg: '#6B7280', label: 'Done' },
}

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#C9A84C'

// A live-status pill for an application/event in the Living Calendar.
function StatusChip({ status, size = 'sm' }) {
  if (!status) return null
  const s = STATUS_STYLE[status.state] || STATUS_STYLE.none
  const pad = size === 'lg' ? '4px 11px' : '3px 9px'
  const fs = size === 'lg' ? 12.5 : 11
  return (
    <span className="font-body font-bold rounded-full whitespace-nowrap" style={{ backgroundColor: s.bg, color: s.fg, padding: pad, fontSize: fs }}>
      {status.headline}
    </span>
  )
}

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
    // Net the season need against what's already on the shelf, so we order the
    // gap — not the whole year over again. Stock is converted into the same oz
    // the season total is in.
    const onHandOz = stockToOz(p.stock, unit)
    const netOz = Math.max(0, r.totalOz - onHandOz)
    const casesExact = ozPerCase ? netOz / ozPerCase : null
    const casesToOrder = casesExact != null ? Math.ceil(casesExact) : null
    const totalInUnits = ozPerUnit ? r.totalOz / ozPerUnit : null
    const costPerCase = Number(p.costPerCase) || 0
    const estCost = casesToOrder != null && costPerCase ? Math.round(casesToOrder * costPerCase * 100) / 100 : null
    return { ...r, ozPerCase, unit, caseSize: p.caseSize || '', onHandOz, netOz, casesExact, casesToOrder, totalInUnits, costPerCase, estCost, missingCase: !ozPerCase }
  }).sort((a, b) => b.totalOz - a.totalOz)

  const areaList = [...areaSet].sort()
  const casesTotal = rows.reduce((s, r) => s + (r.casesToOrder || 0), 0)
  const estTotalCost = Math.round(rows.reduce((s, r) => s + (r.estCost || 0), 0) * 100) / 100
  const missingCaseCount = rows.filter((r) => r.missingCase).length
  return { rows, areaList, casesTotal, estTotalCost, missingCaseCount, missingSqft }
}

// Convert a stock amount into ounces so it can be netted against a season total.
// Liquids go through fluid ounces, dry products through weight ounces — matching
// how "oz per case" is stored for each.
function stockToOz(stock, unit) {
  const q = Number(stock)
  if (!q || q <= 0) return 0
  const vol = { gal: 128, qt: 32, pt: 16, 'fl oz': 1, oz: 1, L: 33.814, ml: 0.033814 }
  const wt = { lbs: 16, kg: 35.274, g: 0.035274 }
  if (vol[unit] != null) return q * vol[unit]
  if (wt[unit] != null) return q * wt[unit]
  return 0
}

// A distinct color per product type for quick visual scanning.
function typeColor(type) {
  return {
    Fungicide: '#3A6B4A', Herbicide: '#D97706', Insecticide: '#DC2626',
    'Growth Reg': '#7C3AED', Fertilizer: '#2563EB', Biological: '#0D9488',
    'Wetting Agent': '#64748B',
  }[type] || '#94A3B8'
}

export default function AnnualProgram({ areas, products = [], sheets = [], location, onProductsChanged, onCreateSheet }) {
  const [programs, setPrograms] = useState([])
  // Weather that feeds the Living Calendar's live status. Best-effort — the plan
  // still shows without it (growth triggers just read "waiting on data").
  const [season, setSeason] = useState([])
  const [soilSeries, setSoilSeries] = useState([])
  const nowIso = localDateISO()
  useEffect(() => {
    if (location?.lat == null) return
    let off = false
    ;(async () => { try { const s = await fetchSeasonDaily(location.lat, location.lng); if (!off) setSeason(s) } catch { /* ignore */ } })()
    ;(async () => { try { const bt = await fetchBreakdownTemps(location.lat, location.lng); if (!off) setSoilSeries(bt) } catch { /* ignore */ } })()
    return () => { off = true }
  }, [location?.lat, location?.lng])
  // Live status for one event (a mix shares one trigger). Anchor GDD/interval on
  // the growth-reg product when there is one, else the first product.
  // Products whose spray also suppresses growth (PGRs + DMI fungicides) — so a
  // DMI application resets a growth-reg trigger's GDD clock, just like the dashboard.
  const suppressors = new Set(Object.keys(suppressionMap(products)).map((n) => n.trim().toLowerCase()))
  const statusCtx = { season, soilSeries, sheets, today: nowIso, suppressors }
  const eventStatus = (ev) => {
    const items = ev.items || []
    const lead = items.find((i) => String(i.type || '').toLowerCase().includes('growth')) || items[0] || {}
    return triggerStatus({
      area: ev.area, product: lead.product, type: lead.type,
      trigger: items[0]?.trigger, plannedDate: ev.date, templateDate: lead.templateDate,
      linkedSheetId: items.find((i) => i.linkedSheetId)?.linkedSheetId || null,
    }, statusCtx)
  }
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
  const [buildPrev, setBuildPrev] = useState(null) // Build From Last Year preview
  const [editProgForm, setEditProgForm] = useState(null) // rename/edit-season form
  const [orderEdit, setOrderEdit] = useState(null) // { name, caseSize, ozPerCase } for early-order inline edit
  const [viewMode, setViewMode] = useState('now') // 'now' | 'timeline' | 'area' | 'order'
  const [collapsed, setCollapsed] = useState({}) // section key -> true when folded
  const [flatPrev, setFlatPrev] = useState(null) // simple-list import preview
  const fileRef = useRef(null)
  const flatFileRef = useRef(null)

  async function onFlatFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const { parseProgramFlat } = await import('@/lib/importXlsx')
      const res = parseProgramFlat(await file.arrayBuffer())
      setFlatPrev({ ...res, fileName: file.name })
    } catch {
      setFlatPrev({ apps: [], count: 0, error: 'Could not read that file. Make sure it is a .xlsx spreadsheet.', fileName: file.name })
    }
  }
  async function confirmFlat() {
    if (!flatPrev?.apps?.length || !activeProgram) return
    setBusy(true)
    try {
      await db.bulkInsertApplications(activeProgram.id, flatPrev.apps)
      setApps(await db.fetchApplications(activeProgram.id))
      setFlatPrev(null)
      showToast(`Imported ${flatPrev.count} planned application${flatPrev.count !== 1 ? 's' : ''}`)
    } catch (e) {
      console.error(e)
      setFlatPrev((p) => ({ ...p, error: 'Could not save the import. Try again.' }))
    }
    setBusy(false)
  }
  async function downloadFlatTemplate() {
    const XLSX = await import('xlsx')
    const headers = ['Date', 'Area', 'Product', 'Rate', 'Basis', 'Target']
    const ex = [
      ['2026-05-12', 'Blue Greens', 'Daconil Action', 1.8, 'oz / M', 'Dollar Spot'],
      ['2026-05-12', 'Blue Greens', 'Primo MAXX', 0.2, 'oz / M', 'Growth Reg'],
      ['2026-05-26', 'Gold Fairways', 'Acelepryn', 8, 'oz / A', 'Grubs'],
    ]
    const ws = XLSX.utils.aoa_to_sheet([headers, ...ex])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Program')
    XLSX.writeFile(wb, 'annual-program-template.xlsx')
  }

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
      plannedDate: localDateISO(),
      trigger: { mode: 'date' },
      products: [blankRow()],
    })
  }

  // Open an existing spray event (all products on that area + date) for editing.
  function openEvent(items) {
    setEditApp({
      originalIds: items.map((i) => i.id),
      area: items[0].area,
      plannedDate: items[0].plannedDate || '',
      trigger: normalizeTrigger(items[0].trigger, items[0].type),
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
          trigger: editApp.trigger || { mode: 'date' },
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

  function startEditProgram() {
    setEditProgForm({ id: activeProgram.id, year: activeProgram.year, name: activeProgram.name || `${activeProgram.year} Program` })
  }
  async function runEditProgram() {
    setBusy(true)
    try {
      const updated = await db.updateProgram(editProgForm.id, { year: Number(editProgForm.year), name: editProgForm.name })
      setPrograms((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
      setActiveProgram(updated)
      setEditProgForm(null)
      showToast('Season updated')
    } catch (e) {
      console.error(e)
      showToast('Could not update the season')
    }
    setBusy(false)
  }

  function startOrderEdit(r) {
    const p = products.find((x) => x.name === r.name) || {}
    setOrderEdit({ name: r.name, caseSize: p.caseSize ?? '', ozPerCase: p.ozPerCase ?? '' })
  }
  async function saveOrderEdit() {
    const p = products.find((x) => x.name === orderEdit.name)
    if (!p) { setOrderEdit(null); return }
    setBusy(true)
    try {
      await db.upsertProduct({ ...p, caseSize: orderEdit.caseSize, ozPerCase: orderEdit.ozPerCase === '' ? null : Number(orderEdit.ozPerCase) })
      await onProductsChanged?.()
      setOrderEdit(null)
      showToast('Product updated')
    } catch (e) {
      console.error(e)
      showToast('Could not save the product')
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

  // ── Build From Last Year ──────────────────────────────────────────────
  // Recent GDD/day (base 32), for turning an observed spray interval into a GDD
  // target on growth-reg triggers. null when the season archive isn't loaded.
  const gddPerDay = (() => {
    if (!season.length) return null
    const g = gddSince(season, isoAddDays(nowIso, -30), 32)
    return g != null && g > 0 ? g / 30 : null
  })()
  const nextFreeYear = () => {
    const years = programs.map((p) => p.year).filter(Boolean)
    let y = new Date().getFullYear() + 1
    while (years.includes(y)) y += 1
    return y
  }
  function openBuild() {
    const years = recordYears(sheets)
    if (years.length === 0) { showToast('No completed sprays yet to learn from'); return }
    const sourceYear = years[0]
    const targetYear = nextFreeYear()
    const plan = buildPlanFromRecords(sheets, products, { sourceYear, targetYear, gddPerDay })
    setBuildPrev({ sourceYear, targetYear, years, plan })
  }
  function rebuild(patch) {
    setBuildPrev((prev) => {
      const next = { ...prev, ...patch }
      next.plan = buildPlanFromRecords(sheets, products, { sourceYear: next.sourceYear, targetYear: next.targetYear, gddPerDay })
      return next
    })
  }
  async function confirmBuild() {
    if (!buildPrev?.plan?.events?.length) return
    setBusy(true)
    try {
      const prog = await db.createProgram({ year: Number(buildPrev.targetYear), name: `${buildPrev.targetYear} Plan (from ${buildPrev.sourceYear})` })
      await db.bulkInsertApplications(prog.id, planToApplications(buildPrev.plan))
      setBuildPrev(null)
      await loadPrograms()
      await selectProgram(prog)
      showToast(`Drafted ${buildPrev.plan.stats.sprays} sprays for ${buildPrev.targetYear}`)
    } catch (e) {
      console.error(e)
      showToast('Could not build the plan')
    }
    setBusy(false)
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
  const _ago30 = new Date(_today); _ago30.setDate(_ago30.getDate() - 30)
  const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const todayIso = isoLocal(_today)
  const in7Iso = isoLocal(_in7)
  const ago30Iso = isoLocal(_ago30)
  // Only surface RECENTLY-missed sprays (last 30 days) — not a whole past season.
  const overdueEvents = groupByEvent(apps.filter((a) => a.plannedDate && a.plannedDate < todayIso && a.plannedDate >= ago30Iso).sort((a, b) => dateKey(b).localeCompare(dateKey(a)))).slice(0, 3)
  const thisWeekEvents = groupByEvent(apps.filter((a) => a.plannedDate && a.plannedDate >= todayIso && a.plannedDate <= in7Iso))
  const offYearCount = activeProgram ? apps.filter((a) => a.plannedDate && a.plannedDate.slice(0, 4) !== String(activeProgram.year)).length : 0

  // Early-order totals for the whole season (respects the area filter).
  const earlyOrder = computeEarlyOrder(visibleApps, products, areas)
  const exportEarlyOrder = () => {
    const areaCols = earlyOrder.areaList
    const rows = [['Product', 'Type', 'Total oz needed', 'On hand oz', 'Net oz', 'Case size', 'Oz/case', 'Cases needed', 'Cases to order', 'Cost/case', 'Est. cost', ...areaCols]]
    earlyOrder.rows.forEach((r) => rows.push([
      r.name, r.type, Math.round(r.totalOz), Math.round(r.onHandOz || 0), Math.round(r.netOz || 0), r.caseSize, r.ozPerCase || '',
      r.casesExact != null ? round1(r.casesExact) : '', r.casesToOrder != null ? r.casesToOrder : '',
      r.costPerCase || '', r.estCost != null ? r.estCost : '',
      ...areaCols.map((a) => Math.round(r.byArea[a] || 0)),
    ]))
    rows.push([])
    rows.push(['', '', '', '', '', '', '', '', earlyOrder.casesTotal, '', earlyOrder.estTotalCost])
    downloadCSV(rows, `Early_Order_${activeProgram?.year || ''}.csv`)
  }

  // A whole planned spray: date + area + the tank mix. Tapping the card opens it
  // to edit; a separate button sits underneath (in the gap before the next spray)
  // to turn it straight into a spray sheet.
  const EventCard = (ev, opts = {}) => {
    const status = eventStatus(ev)
    const trig = normalizeTrigger(ev.items[0]?.trigger, ev.items[0]?.type)
    return (
    <div key={ev.key}>
      <div onClick={() => openEvent(ev.items)} className="cursor-pointer bg-white rounded-2xl border border-black/5 overflow-hidden shadow-sm hover:border-slate-200 transition">
        <div className="flex items-center justify-between px-4 py-2.5 gap-2" style={{ backgroundColor: '#F0F6F2' }}>
          <p className="font-body text-xs font-bold flex items-center gap-1.5 min-w-0" style={{ color: FOREST }}>
            <Calendar size={12} className="shrink-0" /><span className="truncate">{trig.mode === 'date' ? fmtDateHeading(ev.date) : describeTrigger(trig, ev.items[0]?.type)}</span>
          </p>
          <div className="flex items-center gap-1.5 shrink-0">
            <StatusChip status={status} />
            <span className="font-body text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'white', color: FERN }}>
              {opts.badge != null ? opts.badge : ev.area}
            </span>
          </div>
        </div>
        {status.detail && status.state !== 'done' && (
          <div className="px-4 pt-2 pb-0">
            <p className="font-body text-[11px] text-slate-400">{status.detail}{status.projectedDate && status.state !== 'due' && status.state !== 'overdue' ? ` · ~${fmtDate(status.projectedDate)}` : ''}</p>
          </div>
        )}
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
      </div>
      {onCreateSheet && (
        <button onClick={() => onCreateSheet(ev.items)} className="mt-1.5 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed font-body text-xs font-bold transition hover:bg-white" style={{ color: FOREST, borderColor: GOLD, backgroundColor: '#FFFDF6' }}>
          <ClipboardList size={13} /> Create spray sheet for this
        </button>
      )}
    </div>
    )
  }

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
          {activeProgram && (
            <>
              <button onClick={downloadFlatTemplate} className="font-body text-[11px] font-bold px-3 py-2 rounded-full border" style={{ color: FERN, borderColor: '#E2E8F0', backgroundColor: 'white' }}>Template</button>
              <input ref={flatFileRef} type="file" accept=".xlsx,.xls" onChange={onFlatFile} className="hidden" />
              <button onClick={() => flatFileRef.current?.click()} className="font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5 border" style={{ color: FOREST, borderColor: FOREST, backgroundColor: 'white' }}>
                <Upload size={14} /> Import Sprays
              </button>
            </>
          )}
          <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={onFileChosen} className="hidden" />
          <button onClick={() => fileRef.current?.click()} className="font-body text-xs font-bold px-3.5 py-2 rounded-full text-white flex items-center gap-1.5" style={{ backgroundColor: FOREST }}>
            <Upload size={14} /> Full Plan
          </button>
        </div>
      </div>

      {/* Simple-list import preview */}
      {flatPrev && (
        <div className="bg-white rounded-2xl border-2 p-4 my-4 shadow-sm" style={{ borderColor: GOLD }}>
          <p className="font-display text-base font-semibold text-slate-900 mb-1">Import sprays into {activeProgram?.name || 'this season'}</p>
          {flatPrev.error ? (
            <p className="font-body text-sm text-red-600 mt-1">{flatPrev.error}</p>
          ) : (
            <p className="font-body text-sm text-slate-600">
              Found <b>{flatPrev.count}</b> planned application{flatPrev.count !== 1 ? 's' : ''} in “{flatPrev.fileName}”. These add to the current season as planned sprays. Match product names to your Chemical Library so rates and groups link up.
            </p>
          )}
          <div className="flex gap-2 pt-3">
            <button onClick={() => setFlatPrev(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold font-body text-slate-500 border border-slate-200">Cancel</button>
            {!flatPrev.error && flatPrev.count > 0 && (
              <button onClick={confirmFlat} disabled={busy} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body text-white disabled:opacity-60 flex items-center justify-center gap-2" style={{ backgroundColor: FOREST }}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : null}
                {busy ? 'Importing…' : `Import ${flatPrev.count}`}
              </button>
            )}
          </div>
        </div>
      )}

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

      {/* Planned-spray editor — opens as a centered popup so you edit in place */}
      {editApp && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 overflow-y-auto" style={{ backgroundColor: 'rgba(26,26,22,0.45)' }} onClick={() => setEditApp(null)}>
        <div className="bg-white rounded-2xl border-2 p-4 shadow-2xl my-6 w-full max-w-lg" style={{ borderColor: GOLD }} onClick={(e) => e.stopPropagation()}>
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
                <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Baseline date</label>
                <input type="date" value={editApp.plannedDate || ''} onChange={(e) => setEditApp({ ...editApp, plannedDate: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
              </div>
            </div>

            {/* ── Trigger: when this spray should fire ─────────────── */}
            {(() => {
              const trig = normalizeTrigger(editApp.trigger, editApp.products?.[0]?.type)
              const setTrig = (patch) => setEditApp((prev) => ({ ...prev, trigger: { ...normalizeTrigger(prev.trigger, prev.products?.[0]?.type), ...patch } }))
              const pickMode = (mode) => setEditApp((prev) => ({ ...prev, trigger: normalizeTrigger({ mode }, prev.products?.[0]?.type) }))
              return (
                <div className="rounded-xl border p-3" style={{ borderColor: '#EFE6C9', backgroundColor: '#FFFDF6' }}>
                  <label className="font-body text-[11px] font-bold uppercase tracking-wide block mb-2" style={{ color: FERN }}>When should this fire?</label>
                  <div className="grid grid-cols-2 gap-1.5 mb-2.5">
                    {TRIGGER_MODES.map((m) => {
                      const on = trig.mode === m.key
                      return (
                        <button key={m.key} type="button" onClick={() => pickMode(m.key)} className="font-body text-xs font-bold px-2.5 py-2 rounded-lg text-left transition" style={on ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>
                          {m.label}
                        </button>
                      )
                    })}
                  </div>

                  {trig.mode === 'date' && (
                    <p className="font-body text-[11px] text-slate-400">Runs on the baseline date above.</p>
                  )}
                  {trig.mode === 'gdd' && (
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <label className="font-body text-[10px] font-bold text-slate-400 uppercase block mb-1">GDD target</label>
                        <input type="number" step="any" value={trig.target} onChange={(e) => setTrig({ target: e.target.value })} className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-body bg-white" />
                      </div>
                      <div className="flex-1">
                        <label className="font-body text-[10px] font-bold text-slate-400 uppercase block mb-1">Base °F</label>
                        <select value={trig.base} onChange={(e) => setTrig({ base: Number(e.target.value) })} className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-body bg-white">
                          {GDD_BASES.map((b) => <option key={b} value={b}>{b}°F</option>)}
                        </select>
                      </div>
                    </div>
                  )}
                  {trig.mode === 'interval' && (
                    <div>
                      <label className="font-body text-[10px] font-bold text-slate-400 uppercase block mb-1">Days between sprays</label>
                      <input type="number" value={trig.days} onChange={(e) => setTrig({ days: e.target.value })} className="w-28 border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-body bg-white" />
                    </div>
                  )}
                  {trig.mode === 'soil' && (
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <label className="font-body text-[10px] font-bold text-slate-400 uppercase block mb-1">Soil temp °F</label>
                        <input type="number" step="any" value={trig.temp} onChange={(e) => setTrig({ temp: e.target.value })} className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-body bg-white" />
                      </div>
                      <div className="flex-1">
                        <label className="font-body text-[10px] font-bold text-slate-400 uppercase block mb-1">Direction</label>
                        <select value={trig.dir} onChange={(e) => setTrig({ dir: e.target.value })} className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-body bg-white">
                          <option value="rising">at or above &amp; rising</option>
                          <option value="falling">at or below &amp; falling</option>
                        </select>
                      </div>
                    </div>
                  )}
                  <p className="font-body text-[11px] mt-2" style={{ color: FERN }}>{describeTrigger(trig, editApp.products?.[0]?.type)}</p>
                </div>
              )
            })()}

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
        </div>
      )}

      {/* Edit / rename the season */}
      {editProgForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3" style={{ backgroundColor: 'rgba(26,26,22,0.45)' }} onClick={() => setEditProgForm(null)}>
          <div className="bg-white rounded-2xl border-2 p-4 shadow-2xl w-full max-w-md" style={{ borderColor: FOREST }} onClick={(e) => e.stopPropagation()}>
            <p className="font-display text-base font-semibold text-slate-900 mb-3">Edit season</p>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Year</label>
                <input type="number" value={editProgForm.year} onChange={(e) => setEditProgForm({ ...editProgForm, year: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
              </div>
              <div className="col-span-2">
                <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Name</label>
                <input value={editProgForm.name} onChange={(e) => setEditProgForm({ ...editProgForm, name: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
              </div>
            </div>
            <p className="font-body text-[11px] text-slate-400 mb-3">Changing the year only relabels the season — it doesn't move the spray dates. Use the “Fix to year” banner for that.</p>
            <div className="flex gap-2">
              <button onClick={() => setEditProgForm(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold font-body text-slate-500 border border-slate-200">Cancel</button>
              <button onClick={runEditProgram} disabled={busy} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body text-white disabled:opacity-50" style={{ backgroundColor: FOREST }}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Build From Last Year — preview a draft plan from actual records */}
      {buildPrev && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-3 overflow-y-auto" style={{ backgroundColor: 'rgba(26,26,22,0.45)' }} onClick={() => setBuildPrev(null)}>
          <div className="bg-white rounded-2xl border-2 shadow-2xl my-6 w-full max-w-lg" style={{ borderColor: GOLD }} onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-black/5">
              <p className="font-display text-base font-semibold text-slate-900 mb-1 flex items-center gap-1.5"><Sparkles size={16} style={{ color: GOLD }} /> Build from last year</p>
              <p className="font-body text-xs text-slate-400">Drafts next season from what you actually sprayed — same products, areas and cadence, with smart triggers. You review here, then edit anything after.</p>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Learn from</label>
                  <select value={buildPrev.sourceYear} onChange={(e) => rebuild({ sourceYear: Number(e.target.value) })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white">
                    {buildPrev.years.map((y) => <option key={y} value={y}>{y} records</option>)}
                  </select>
                </div>
                <div>
                  <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Draft for</label>
                  <input type="number" value={buildPrev.targetYear} onChange={(e) => rebuild({ targetYear: Number(e.target.value) })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
                </div>
              </div>
            </div>

            {buildPrev.plan.events.length === 0 ? (
              <div className="p-8 text-center font-body text-sm text-slate-400">No completed sprays in {buildPrev.sourceYear} to learn from.</div>
            ) : (
              <>
                <div className="p-4 border-b border-black/5">
                  <div className="grid grid-cols-4 gap-2 text-center">
                    {[['Sprays', buildPrev.plan.stats.sprays], ['Areas', buildPrev.plan.stats.areas], ['GDD/interval', buildPrev.plan.stats.gddTriggers + buildPrev.plan.stats.intervalTriggers], ['To review', buildPrev.plan.reviews.length]].map(([lbl, n]) => (
                      <div key={lbl} className="rounded-xl bg-slate-50 px-2 py-2">
                        <p className="font-display font-bold" style={{ fontSize: 20, color: lbl === 'To review' && n > 0 ? '#B23A2E' : FOREST }}>{n}</p>
                        <p className="font-body text-[9px] font-bold uppercase tracking-wide text-slate-400">{lbl}</p>
                      </div>
                    ))}
                  </div>
                  {gddPerDay == null && buildPrev.plan.stats.gddTriggers > 0 && (
                    <p className="font-body text-[11px] text-slate-400 mt-2">Growth-reg triggers use a 200-GDD default — set your course location in Settings to tune them to your own weather.</p>
                  )}
                </div>

                {buildPrev.plan.reviews.length > 0 && (
                  <div className="px-4 pt-3">
                    <p className="font-body text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: '#B23A2E' }}>Worth a look — resistance</p>
                    <div className="space-y-1.5 mb-1">
                      {buildPrev.plan.reviews.slice(0, 4).map((r, i) => (
                        <div key={i} className="flex items-start gap-2 rounded-lg p-2" style={{ backgroundColor: '#FBEDEA' }}>
                          <AlertTriangle size={13} className="shrink-0 mt-0.5" style={{ color: '#B23A2E' }} />
                          <p className="font-body text-[11px]" style={{ color: '#7A2A22' }}><b>{r.area}</b> · {r.product} — same group ({r.group}) as {r.prevProduct} just before. Consider rotating.</p>
                        </div>
                      ))}
                      {buildPrev.plan.reviews.length > 4 && <p className="font-body text-[11px] text-slate-400">+{buildPrev.plan.reviews.length - 4} more.</p>}
                    </div>
                  </div>
                )}

                <div className="p-4 max-h-72 overflow-y-auto space-y-1.5">
                  {buildPrev.plan.events.slice(0, 60).map((ev, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg border border-black/5 px-3 py-2">
                      <span className="font-body text-[11px] font-bold text-slate-400 w-14 shrink-0">{fmtDate(ev.date)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-body text-[12px] font-semibold text-slate-800 truncate">{ev.area}</p>
                        <p className="font-body text-[11px] text-slate-400 truncate">{ev.items.map((it) => it.product).join(', ')}</p>
                      </div>
                      <span className="font-body text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ backgroundColor: ev.trigger.mode === 'gdd' ? '#E4EFE5' : ev.trigger.mode === 'interval' ? '#F6ECD4' : '#EEF1F4', color: ev.trigger.mode === 'gdd' ? FERN : ev.trigger.mode === 'interval' ? '#9A6B12' : '#6B7280' }}>
                        {ev.trigger.mode === 'gdd' ? `${ev.trigger.target} GDD` : ev.trigger.mode === 'interval' ? `${ev.trigger.days}d` : 'date'}
                      </span>
                    </div>
                  ))}
                  {buildPrev.plan.events.length > 60 && <p className="font-body text-[11px] text-slate-400 text-center pt-1">+{buildPrev.plan.events.length - 60} more sprays.</p>}
                </div>
              </>
            )}

            <div className="p-4 border-t border-black/5 flex gap-2">
              <button onClick={() => setBuildPrev(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold font-body text-slate-500 border border-slate-200">Cancel</button>
              <button onClick={confirmBuild} disabled={busy || buildPrev.plan.events.length === 0} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body text-white disabled:opacity-50" style={{ backgroundColor: FOREST }}>{busy ? 'Building…' : `Create ${buildPrev.targetYear} plan`}</button>
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
              <button onClick={startEditProgram} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full transition flex items-center gap-1.5" style={{ backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>
                <Pencil size={12} /> Edit season
              </button>
            )}
            {activeProgram && (
              <button onClick={startCopy} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full transition flex items-center gap-1.5" style={{ backgroundColor: 'white', color: FERN, border: '1px solid rgba(0,0,0,0.08)' }}>
                <CalendarPlus size={13} /> Roll forward
              </button>
            )}
            <button onClick={openBuild} className="font-body text-xs font-bold px-3 py-1.5 rounded-full transition flex items-center gap-1.5" style={{ backgroundColor: GOLD, color: FOREST }}>
              <Sparkles size={13} /> Build from last year
            </button>
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
            {[['now', 'This Week', Gauge], ['coverage', 'Coverage', LayoutGrid], ['timeline', 'Timeline', CalendarDays], ['area', 'By Area', MapPin], ['order', 'Early Order', DollarSign]].map(([k, label, Icon]) => (
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
          ) : viewMode === 'now' ? (
            (() => {
              const events = groupByEvent(visibleApps).map((ev) => ({ ev, st: eventStatus(ev) }))
              const rankThen = (a, b) => statusRank(a.st.state) - statusRank(b.st.state) || String(a.st.projectedDate || '9999').localeCompare(String(b.st.projectedDate || '9999'))
              const actionable = events.filter((e) => ['overdue', 'due', 'soon'].includes(e.st.state)).sort(rankThen)
              const onTrack = events.filter((e) => e.st.state === 'ok').sort(rankThen)
              const counts = { overdue: 0, due: 0, soon: 0 }
              actionable.forEach((e) => { counts[e.st.state === 'overdue' ? 'overdue' : e.st.state === 'due' ? 'due' : 'soon']++ })
              return (
                <div className="space-y-4">
                  {location?.lat == null && (
                    <div className="rounded-xl border p-3 font-body text-[12px]" style={{ backgroundColor: '#FEF9E7', borderColor: '#EFE0B0', color: '#7A5B12' }}>
                      Set your course location in Settings → Location to turn on live growth &amp; soil-temp triggers. Date triggers still work without it.
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-2">
                    {[['Overdue', counts.overdue, STATUS_STYLE.overdue], ['Due now', counts.due, STATUS_STYLE.due], ['Coming up', counts.soon, STATUS_STYLE.soon]].map(([lbl, n, s]) => (
                      <div key={lbl} className="rounded-xl border border-black/5 px-3 py-2.5 shadow-sm bg-white text-center">
                        <p className="font-display font-bold" style={{ fontSize: 22, color: s.fg }}>{n}</p>
                        <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400">{lbl}</p>
                      </div>
                    ))}
                  </div>

                  {actionable.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-black/5 p-8 text-center font-body text-sm" style={{ color: FERN }}>
                      <Check size={22} className="mx-auto mb-2" /> Nothing needs attention this week. {onTrack.length} spray{onTrack.length !== 1 ? 's' : ''} on track.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {actionable.map(({ ev }) => EventCard(ev, { badge: ev.area }))}
                    </div>
                  )}

                  {onTrack.length > 0 && actionable.length > 0 && (
                    <div>
                      <button onClick={() => toggle('now:ontrack')} className="w-full flex items-center justify-between mb-2 mt-2">
                        <span className="font-display text-sm font-bold flex items-center gap-1.5" style={{ color: FOREST }}>
                          {collapsed['now:ontrack'] ? <ChevronRight size={15} /> : <ChevronDown size={15} />}On track ({onTrack.length})
                        </span>
                      </button>
                      {!collapsed['now:ontrack'] && (
                        <div className="space-y-3">{onTrack.map(({ ev }) => EventCard(ev, { badge: ev.area }))}</div>
                      )}
                    </div>
                  )}
                </div>
              )
            })()
          ) : viewMode === 'coverage' ? (
            (() => {
              const dated = visibleApps.filter((a) => a.plannedDate || a.templateDate)
              if (dated.length === 0) return <div className="bg-white rounded-2xl border border-black/5 p-8 text-center text-slate-400 font-body text-sm">Add planned sprays with dates to see season coverage.</div>
              // Season bounds: earliest planned date → the latest date any spray's
              // cover runs out, so the last window is fully shown.
              const startsIso = dated.map((a) => a.plannedDate || a.templateDate).sort()
              let endIso = startsIso[startsIso.length - 1]
              dated.forEach((a) => { const s = a.plannedDate || a.templateDate; if (s) { const e = isoAddDays(s, coverageDays(a)); if (e > endIso) endIso = e } })
              const weeks = weeksBetween(startsIso[0], endIso)
              const { groups: monthGroups, nums: weekNums } = weekHeader(weeks)
              const rows = areaGroups
              return (
                <div>
                  <p className="font-body text-xs text-slate-400 mb-3">How long each area stays protected, <b>week by week</b>. A <b style={{ color: '#B23A2E' }}>gap</b> is an uncovered week between sprays — tap it to slot one in. Scroll sideways to see the whole season.</p>
                  <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-3 overflow-x-auto">
                    <table className="border-separate" style={{ borderSpacing: 2, minWidth: Math.max(360, 132 + weeks.length * 30) }}>
                      <thead>
                        <tr>
                          <th rowSpan={2} style={{ width: 120 }}></th>
                          {monthGroups.map((g, i) => (
                            <th key={i} colSpan={g.span} className="font-body text-[11px] font-bold text-center pb-0.5" style={{ color: FOREST, borderBottom: '1px solid #E2E0DB' }}>{g.label}</th>
                          ))}
                        </tr>
                        <tr>
                          {weeks.map((w, i) => (
                            <th key={w.start} className="font-body text-[9px] font-semibold text-center px-0.5 pt-1" style={{ color: '#94A3B8' }}>W{weekNums[i]}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((ag) => {
                          const cells = coverageRow(ag.items, weeks)
                          return (
                            <tr key={ag.area}>
                              <td className="font-body text-[12px] font-semibold text-slate-700 pr-2 whitespace-nowrap" style={{ width: 120 }}>{ag.area}</td>
                              {cells.map((c) => {
                                const bg = c.state === 'on' ? COVER : c.state === 'light' ? COVER_LIGHT : c.state === 'gap' ? GAPCLR : '#F1F3EF'
                                const isGap = c.state === 'gap'
                                return (
                                  <td key={c.start} className="p-0">
                                    <button
                                      type="button"
                                      onClick={isGap ? () => setEditApp({ originalIds: [], area: ag.area, plannedDate: isoAddDays(c.start, 3), trigger: { mode: 'date' }, products: [blankRow()] }) : undefined}
                                      title={isGap ? `Coverage gap — week of ${fmtDate(c.start)}. Tap to add a spray.` : `Week of ${fmtDate(c.start)}`}
                                      className="w-full rounded border transition"
                                      style={{ height: 26, backgroundColor: bg, borderColor: isGap ? '#D9B3AC' : 'transparent', cursor: isGap ? 'pointer' : 'default' }}
                                    >
                                      {isGap && <span style={{ color: '#B23A2E', fontWeight: 800, fontSize: 12 }}>!</span>}
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
                  <div className="flex flex-wrap gap-4 mt-3 font-body text-[12px] text-slate-500">
                    <span className="flex items-center gap-1.5"><i style={{ width: 16, height: 12, borderRadius: 3, background: COVER, display: 'inline-block' }} /> Protected</span>
                    <span className="flex items-center gap-1.5"><i style={{ width: 16, height: 12, borderRadius: 3, background: COVER_LIGHT, display: 'inline-block' }} /> Part-week</span>
                    <span className="flex items-center gap-1.5"><i style={{ width: 16, height: 12, borderRadius: 3, background: GAPCLR, display: 'inline-block' }} /> <b style={{ color: '#B23A2E' }}>Gap week</b></span>
                  </div>
                </div>
              )
            })()
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
                  <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400">Cases to order</p>
                  <p className="font-display font-bold text-slate-900" style={{ fontSize: 20, marginTop: 2 }}>{earlyOrder.casesTotal}</p>
                  <p className="font-body text-[9px] text-slate-400 leading-tight">net of stock on hand</p>
                </div>
                <div className="bg-white rounded-xl border border-black/5 px-3 py-2.5 shadow-sm">
                  <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400">Est. cost</p>
                  <p className="font-display font-bold text-slate-900" style={{ fontSize: 20, marginTop: 2 }}>{earlyOrder.estTotalCost > 0 ? `$${earlyOrder.estTotalCost.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}</p>
                  <p className="font-body text-[9px] text-slate-400 leading-tight">priced products only</p>
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
                  const editing = orderEdit?.name === r.name
                  return (
                    <div key={r.name} className="bg-white rounded-2xl border border-black/5 p-3 shadow-sm">
                      <button onClick={() => startOrderEdit(r)} className="w-full text-left flex items-start gap-3">
                        <span className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: typeColor(r.type) }} />
                        <div className="min-w-0 flex-1">
                          <p className="font-body text-sm font-semibold text-slate-800 truncate flex items-center gap-1">{r.name} <Pencil size={11} className="text-slate-300 shrink-0" /></p>
                          <p className="font-body text-[11px] text-slate-400">
                            {Math.round(r.totalOz).toLocaleString()} oz needed{r.onHandOz > 0 ? ` − ${Math.round(r.onHandOz).toLocaleString()} on hand` : ''}{r.caseSize ? ` · ${r.caseSize}` : ''}{r.ozPerCase ? ` @ ${r.ozPerCase} oz/case` : ''}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          {r.casesToOrder != null ? (
                            <>
                              <p className="font-display text-lg font-bold text-slate-900 leading-none">{r.casesToOrder}</p>
                              <p className="font-body text-[9px] uppercase tracking-wide text-slate-400 mt-0.5">case{r.casesToOrder !== 1 ? 's' : ''} · need {round1(r.casesExact)}</p>
                              {r.estCost != null && <p className="font-body text-[11px] font-bold mt-0.5" style={{ color: FERN }}>${r.estCost.toLocaleString('en-US', { maximumFractionDigits: 0 })}</p>}
                            </>
                          ) : (
                            <p className="font-body text-[11px] font-semibold text-amber-600">add oz/case</p>
                          )}
                        </div>
                      </button>
                      {editing && (
                        <div className="mt-2 pt-2 border-t border-slate-100 grid grid-cols-2 gap-2">
                          <div>
                            <label className="font-body text-[10px] font-bold text-slate-400 uppercase block mb-1">Case size</label>
                            <input value={orderEdit.caseSize} onChange={(e) => setOrderEdit({ ...orderEdit, caseSize: e.target.value })} className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-body bg-white" placeholder="4 x 1 Gal" />
                          </div>
                          <div>
                            <label className="font-body text-[10px] font-bold text-slate-400 uppercase block mb-1">Oz / case</label>
                            <input type="number" step="any" value={orderEdit.ozPerCase} onChange={(e) => setOrderEdit({ ...orderEdit, ozPerCase: e.target.value })} className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-body bg-white" placeholder="512" />
                          </div>
                          <div className="col-span-2 flex gap-2">
                            <button onClick={() => setOrderEdit(null)} className="flex-1 py-2 rounded-lg text-[12px] font-semibold font-body text-slate-500 border border-slate-200">Cancel</button>
                            <button onClick={saveOrderEdit} disabled={busy} className="flex-1 py-2 rounded-lg text-[12px] font-bold font-body text-white disabled:opacity-50" style={{ backgroundColor: FOREST }}>Save</button>
                          </div>
                        </div>
                      )}
                      {!editing && areasUsed.length > 0 && (
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

              <p className="font-body text-[10px] text-slate-400 mt-3">Estimate for planning. Totals = each application's rate × the area's size, summed over the season, minus current stock on hand, then converted to cases with each product's Oz/case. “Cases” rounds up to whole cases; “need” is the exact amount. Cost = cases × the product's cost per case.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
