'use client'

// ════════════════════════════════════════════════════════════════════════
//  Spray Ops + Turf Performance — the full app UI.
//
//  This is a faithful port of the original single-file prototype. The design,
//  layout and calculations are unchanged. The differences from the prototype:
//    • Data comes from Supabase (lib/db) instead of the browser key-value store.
//    • Screens and actions are gated by the signed-in user's role.
//    • It receives the current `user` (with role) from the server.
// ════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useRef } from 'react'
import {
  Plus, Trash2, Calendar, User, ShieldCheck, Loader2, Droplet, CloudUpload,
  Check, ChevronRight, Cloud, Sprout, ClipboardList, TrendingUp, AlertTriangle,
  Package, Truck, MapPin, Sparkles, Wind, Thermometer, Search, X, Info,
} from 'lucide-react'
import {
  uid, convertUnits, unitsAreCompatible, calcAmount, fmtDate, aggregateNPK, npkDiagnostics, rotationByArea, rotationWarnings,
  productUsage, sprayHistory, daysSinceByArea, downloadCSV, productCosts, productRateForN,
} from '@/lib/calc'
import { PRODUCT_TYPES, UNITS } from '@/lib/defaults'
import * as db from '@/lib/db'
import { fetchCurrent, fetchSeasonDaily, gddFromDaily, gddSince, fetchWeather, dailyFromHourly, sprayWindow, fetchBreakdownTemps } from '@/lib/weather'
import { protectionByArea, protectionAlertCount } from '@/lib/disease'
import { recommend, suggestedAnnualN, baseSaturation, MLSN } from '@/lib/soil'
import { applicationTimings, openWindows, soilTrend, currentSoilTemp, TIMING_WINDOWS } from '@/lib/soiltiming'
import { logout } from '@/app/actions/auth'
import AnnualProgram from '@/components/AnnualProgram'
import SprayCalendar from '@/components/SprayCalendar'
import Weather from '@/components/Weather'

// ── PALETTE ───────────────────────────────────────────────────────────────
const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#C9A84C'
const CREAM = '#F7F5EF'
const INK = '#1A1A16'

// ── ROLE HELPERS ────────────────────────────────────────────────────────────
const canManage = (role) => role === 'superintendent' || role === 'director'
const canApprove = (role) => role === 'director'

// Standard PPE options and common field instructions (quick-insert on a sheet).
const PPE_OPTIONS = ['Gloves', 'Long Sleeves', 'Eye Protection', 'Respirator', 'Coveralls', 'Chemical Boots']
// Rate bases the crew can pick from. "/ M" = per 1,000 sq ft, "/ A" = per acre.
const BASIS_OPTIONS = ['oz / M', 'oz / A', 'lbs / M', 'lbs / A', 'g / M', 'g / A', 'gal / M', 'gal / A']
const QUICK_INSTRUCTIONS = ['Water in 0.1"', 'Do not mow for 24h', 'Avoid overlap near bunkers', 'Spray when turf is dry']

// A full tank (area.galTank of water) covers area.sqft. If the crew only fills a
// partial tank, they cover proportionally less, so every product scales down by
// the same fraction. We do that by shrinking the effective area passed into the
// rate math — which keeps all the existing rounding correct. null/blank/equal =
// a full tank (no scaling).
function effectiveSqft(fillGallons, area) {
  const full = area?.sqft || 0
  const gt = Number(area?.galTank)
  const fg = Number(fillGallons)
  if (gt > 0 && fg > 0 && fg !== gt) return full * (fg / gt)
  return full
}
function isPartialFill(fillGallons, area) {
  const gt = Number(area?.galTank)
  const fg = Number(fillGallons)
  return gt > 0 && fg > 0 && fg !== gt
}

// ── Inventory deduction helpers (pure) ───────────────────────────────────────
// Product used by ONE partial-fill tank of `gallons`, per product, in the calc
// unit. Combined by product name so repeat lines add up.
function partialDeductions(sheet, area, gallons) {
  if (!(Number(gallons) > 0) || !(Number(area?.galTank) > 0)) return []
  const map = {}
  ;(sheet.products || []).filter((p) => p.product).forEach((p) => {
    const { value, unit } = calcAmount(parseFloat(p.rate), p.basis, effectiveSqft(gallons, area), p.forceGal)
    if (value != null) map[p.product] = { name: p.product, unit, total: (map[p.product]?.total || 0) + value }
  })
  return Object.values(map)
}

// Total product to pull from inventory when a sheet is approved: the main tanks
// PLUS the optional partial-fill extra tank.
function sheetDeductions(sheet, area) {
  const tanks = sheet.tanks || 1
  const map = {}
  ;(sheet.products || []).filter((p) => p.product).forEach((p) => {
    const { value: amt, unit } = calcAmount(parseFloat(p.rate), p.basis, area?.sqft, p.forceGal)
    if (amt == null) return
    map[p.product] = { name: p.product, unit, total: (map[p.product]?.total || 0) + amt * tanks }
  })
  partialDeductions(sheet, area, sheet.partialGallons).forEach((d) => {
    map[d.name] = { name: d.name, unit: d.unit, total: (map[d.name]?.total || 0) + d.total }
  })
  return Object.values(map)
}

// The inventory change when a sheet's partial fill goes from oldGal to newGal —
// positive totals pull stock, negative totals put it back (partial reduced).
function partialDelta(sheet, area, oldGal, newGal) {
  const map = {}
  partialDeductions(sheet, area, newGal).forEach((d) => { map[d.name] = { name: d.name, unit: d.unit, total: d.total } })
  partialDeductions(sheet, area, oldGal).forEach((d) => {
    map[d.name] = map[d.name]
      ? { ...map[d.name], total: map[d.name].total - d.total }
      : { name: d.name, unit: d.unit, total: -d.total }
  })
  return Object.values(map).filter((d) => Math.abs(d.total) > 1e-6)
}

// Find the settings area for a sheet's area name, tolerating short/variant names
// (e.g. a sheet's "Blue Greens" matching the settings key "Blue Greens SprayBug
// 1.67gpm"). Returns the area object or null. Exact match wins first.
function resolveArea(areas, name) {
  if (!areas) return null
  if (name && areas[name]) return areas[name]
  const keys = Object.keys(areas)
  if (!keys.length || !name) return null
  const n = String(name).toLowerCase()
  const k =
    keys.find((x) => x.toLowerCase() === n) ||
    keys.find((x) => x.toLowerCase().startsWith(n)) ||
    keys.find((x) => x.toLowerCase().includes(n)) ||
    keys.find((x) => n.includes(x.toLowerCase()))
  return k ? areas[k] : null
}

// Classify an area / hole name into a course section, for grouping soil tests.
function soilSection(name) {
  const n = String(name || '').toLowerCase()
  if (/green/.test(n)) return 'Greens'
  if (/tee/.test(n)) return 'Tees'
  if (/fairway/.test(n)) return 'Fairways'
  if (/approach/.test(n)) return 'Approaches'
  if (/collar|surround/.test(n)) return 'Collars'
  if (/intermediate|inter\b/.test(n)) return 'Intermediate'
  if (/rough/.test(n)) return 'Rough'
  if (/native/.test(n)) return 'Natives'
  return 'Other'
}
const SECTION_ORDER = ['Greens', 'Tees', 'Fairways', 'Approaches', 'Collars', 'Intermediate', 'Rough', 'Natives', 'Other']
// Sections always offered as tabs so the course structure is visible even before
// a section has any samples.
const DEFAULT_SECTIONS = ['Greens', 'Tees', 'Fairways', 'Approaches', 'Rough']

// Average a set of soil tests into one synthetic reading — used to treat a whole
// section (e.g. every green sampled) as a single result, since it's managed the
// same across the section.
function averageTests(tests, section) {
  const keys = ['ph', 'cec', 'om', 'p', 'k', 'ca', 'mg', 's', 'na']
  const out = { id: `avg-${section}`, area: section }
  keys.forEach((key) => {
    const nums = tests.map((t) => t[key]).filter((v) => v != null && v !== '' && !isNaN(Number(v))).map(Number)
    out[key] = nums.length ? Math.round((nums.reduce((s, v) => s + v, 0) / nums.length) * 100) / 100 : ''
  })
  const ns = tests.map((t) => Number(t.annualN)).filter((v) => !isNaN(v) && v > 0)
  out.annualN = ns.length ? Math.round((ns.reduce((s, v) => s + v, 0) / ns.length) * 10) / 10 : null
  out.grasses = (tests.find((t) => t.grasses && t.grasses.length) || {}).grasses || []
  out.soilType = (tests.find((t) => t.soilType) || {}).soilType || ''
  out.date = tests.map((t) => t.date).filter(Boolean).sort().slice(-1)[0] || ''
  out.count = tests.length
  return out
}

// Which grasses on this area a product warns against — the overlap of the
// product's "avoid" list and the grasses present on the area. Empty = safe.
function grassConflicts(prodInfo, area) {
  const areaGrasses = area?.grasses || []
  const avoid = prodInfo?.avoidGrasses || []
  if (!areaGrasses.length || !avoid.length) return []
  return avoid.filter((g) => areaGrasses.includes(g))
}

// ── ERROR BOUNDARY ────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    console.error('App crashed:', error, info)
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', backgroundColor: '#FEF2F2', padding: 24, fontFamily: 'Arial, sans-serif' }}>
          <h2 style={{ color: '#DC2626', fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Something broke</h2>
          <p style={{ color: '#7F1D1D', fontSize: 13, marginBottom: 12 }}>
            The app hit an error and stopped. This is the actual error message — screenshot this and send it back:
          </p>
          <pre style={{ backgroundColor: 'white', border: '1px solid #FCA5A5', borderRadius: 8, padding: 12, fontSize: 11, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            {this.state.error?.message || String(this.state.error)}
            {'\n\n'}
            {this.state.error?.stack || ''}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 16, padding: '8px 16px', backgroundColor: '#16291F', color: 'white', borderRadius: 8, fontSize: 13, fontWeight: 600 }}
          >
            Try to continue
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ── ROOT ────────────────────────────────────────────────────────────────────
export default function SprayApp({ user }) {
  const [module, setModule] = useState('spray') // spray | turf

  return (
    <ErrorBoundary>
      {/* Module switcher — always visible, sits above everything */}
      <div style={{ backgroundColor: '#0F1D15' }} className="text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-2 flex items-center gap-1">
          <button
            onClick={() => setModule('spray')}
            className="font-body text-xs font-bold px-3.5 py-1.5 rounded-full transition flex items-center gap-1.5"
            style={module === 'spray' ? { backgroundColor: GOLD, color: FOREST } : { color: 'rgba(255,255,255,0.5)' }}
          >
            <Droplet size={12} /> Spray Ops
          </button>
          <button
            onClick={() => setModule('turf')}
            className="font-body text-xs font-bold px-3.5 py-1.5 rounded-full transition flex items-center gap-1.5"
            style={module === 'turf' ? { backgroundColor: GOLD, color: FOREST } : { color: 'rgba(255,255,255,0.5)' }}
          >
            <Sprout size={12} /> Turf Performance
          </button>

          <div className="ml-auto flex items-center gap-3">
            <span className="font-body text-[11px] text-white/50 hidden sm:inline">
              {user.fullName} · {roleLabel(user.role)}
            </span>
            <form action={logout}>
              <button type="submit" className="font-body text-[11px] font-semibold text-white/60 hover:text-white transition">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </div>

      {module === 'spray' ? <SprayOpsModule user={user} /> : <TurfPerformanceModule />}
    </ErrorBoundary>
  )
}

function roleLabel(role) {
  return role === 'director' ? 'Director of Grounds' : role === 'superintendent' ? 'Superintendent' : 'Operator'
}

// ── SPRAY OPS MODULE ──────────────────────────────────────────────────────
function SprayOpsModule({ user }) {
  const manage = canManage(user.role)
  const [route, setRoute] = useState(canManage(user.role) ? 'dashboard' : 'tospray')
  const [sheets, setSheets] = useState([])
  const [products, setProducts] = useState([])
  const [activeSheet, setActiveSheet] = useState(null)
  const [deliveries, setDeliveries] = useState([])
  const [programApps, setProgramApps] = useState([]) // applications of the current program
  const [areas, setAreas] = useState({})
  const [operators, setOperators] = useState([])
  const [directors, setDirectors] = useState([])
  const [targets, setTargets] = useState([])
  const [sheetTypes, setSheetTypes] = useState([])
  const [courseInfo, setCourseInfo] = useState({ clubName: 'Congressional Country Club', deptName: 'Golf Maintenance' })
  const [location, setLocation] = useState({ address: '', lat: null, lng: null, timezone: 'America/New_York' })
  const [grassTypes, setGrassTypes] = useState([])
  const [soilTypes, setSoilTypes] = useState([])
  const [applicatorLicenses, setApplicatorLicenses] = useState({})
  const [directorPins, setDirectorPins] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [dismissLic, setDismissLic] = useState(false)
  const [onboardDismissed, setOnboardDismissed] = useState(false)

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2600)
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [s, p, d, settings, progs] = await Promise.all([
        db.fetchSheets(),
        db.fetchProducts(),
        db.fetchDeliveries(),
        db.fetchSettings(),
        db.fetchPrograms(),
      ])
      setSheets(s)
      setProducts(p)
      setDeliveries(d)
      setAreas(settings.areas)
      setOperators(settings.operators)
      setDirectors(settings.directors)
      setTargets(settings.targets)
      setSheetTypes(settings.sheetTypes)
      setCourseInfo(settings.courseInfo)
      setLocation(settings.location)
      setGrassTypes(settings.grassTypes || [])
      setSoilTypes(settings.soilTypes || [])
      setApplicatorLicenses(settings.applicatorLicenses || {})
      setDirectorPins(settings.directorPins || {})
      // Load the newest program's applications so the dashboard can surface
      // what's planned for the days ahead.
      if (progs.length > 0) {
        setProgramApps(await db.fetchApplications(progs[0].id))
      } else {
        setProgramApps([])
      }
    } catch (e) {
      console.error('Failed to load data', e)
      showToast('Could not load data — check your connection')
    }
    setLoading(false)
  }

  async function saveSettings(patch) {
    // Update local state immediately for a responsive feel.
    if (patch.areas) setAreas(patch.areas)
    if (patch.operators) setOperators(patch.operators)
    if (patch.directors) setDirectors(patch.directors)
    if (patch.targets) setTargets(patch.targets)
    if (patch.sheetTypes) setSheetTypes(patch.sheetTypes)
    if (patch.courseInfo) setCourseInfo(patch.courseInfo)
    if (patch.location) setLocation(patch.location)
    if (patch.grassTypes) setGrassTypes(patch.grassTypes)
    if (patch.soilTypes) setSoilTypes(patch.soilTypes)
    if (patch.applicatorLicenses) setApplicatorLicenses(patch.applicatorLicenses)
    if (patch.directorPins) setDirectorPins(patch.directorPins)
    try {
      await db.saveSettings(patch)
    } catch (e) {
      console.error(e)
      showToast('Could not save settings')
    }
  }

  async function saveProduct(product) {
    setProducts((prev) => {
      const exists = prev.some((p) => p.name === product.name)
      return exists ? prev.map((p) => (p.name === product.name ? product : p)) : [...prev, product]
    })
    try {
      await db.upsertProduct(product)
    } catch (e) {
      console.error(e)
      showToast('Could not save product')
    }
  }

  async function removeProduct(name) {
    setProducts((prev) => prev.filter((p) => p.name !== name))
    try {
      await db.deleteProduct(name)
    } catch (e) {
      console.error(e)
      showToast('Could not delete product')
    }
  }

  async function importHistory(sheets) {
    const n = await db.bulkInsertSheets(sheets)
    setSheets(await db.fetchSheets())
    showToast(`Imported ${n} historical spray${n !== 1 ? 's' : ''}`)
  }

  async function removeSheet(sheet) {
    setSheets((prev) => prev.filter((s) => s.id !== sheet.id))
    if (activeSheet?.id === sheet.id) { setActiveSheet(null); setRoute('list') }
    try {
      await db.deleteSheet(sheet.id)
      showToast('Spray sheet deleted')
    } catch (e) {
      console.error(e)
      showToast('Could not delete — check your connection')
    }
  }

  async function reloadProducts() {
    try {
      setProducts(await db.fetchProducts())
    } catch (e) {
      console.error(e)
    }
  }

  async function importProductsFromSheet(partials) {
    const { added, updated } = await db.importProducts(partials)
    await reloadProducts()
    showToast(`Imported: ${added} new, ${updated} updated`)
    return { added, updated }
  }

  async function addDelivery(delivery) {
    try {
      await db.addDelivery(delivery)
      // Bump stock on the product, converting the delivered unit into the
      // product's base stock unit first.
      const prod = products.find((p) => p.name === delivery.product)
      if (prod) {
        const converted = convertUnits(Number(delivery.qty), delivery.unit, prod.unit)
        const updated = { ...prod, stock: Math.round(((prod.stock || 0) + converted) * 1000) / 1000 }
        await saveProduct(updated)
      }
      const fresh = await db.fetchDeliveries()
      setDeliveries(fresh)
      showToast(`${delivery.qty} ${delivery.unit} of ${delivery.product} added to stock`)
    } catch (e) {
      console.error(e)
      showToast('Could not log delivery')
    }
  }

  async function saveSheet(sheet) {
    setSaving(true)
    try {
      const saved = await db.saveSheet(sheet)
      setSheets((prev) => {
        const exists = prev.some((s) => s.id === saved.id)
        const next = exists ? prev.map((s) => (s.id === saved.id ? saved : s)) : [saved, ...prev]
        return next.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      })
      setSaving(false)
      return saved
    } catch (e) {
      console.error('Save failed', e)
      showToast('Could not save — check your connection')
      setSaving(false)
      return null
    }
  }

  // Apply a list of {name, total, unit} deductions to inventory. A negative total
  // puts stock back (used when a partial fill is reduced or removed). Converts the
  // sprayed amount into each product's own stock unit first.
  async function deductStock(deductions) {
    if (!deductions || deductions.length === 0) return
    let nextProducts = [...products]
    for (const ded of deductions) {
      const prod = nextProducts.find((pr) => pr.name === ded.name)
      if (!prod) continue
      const used = convertUnits(ded.total, ded.unit, prod.unit)
      const newStock = Math.max(0, Math.round(((prod.stock || 0) - used) * 100) / 100)
      const updatedProd = { ...prod, stock: newStock }
      nextProducts = nextProducts.map((pr) => (pr.name === ded.name ? updatedProd : pr))
      try {
        await db.upsertProduct(updatedProd)
      } catch (e) {
        console.error('Stock update failed', e)
      }
    }
    setProducts(nextProducts)
  }

  async function approveSheet(sig, signature = '') {
    // Record how much partial fill we're deducting now, so later edits to the
    // partial only adjust the difference.
    const partialNow = Number(activeSheet.partialGallons) || 0
    const updated = { ...activeSheet, status: 'approved', directorSig: sig, directorSignature: signature || activeSheet.directorSignature || '', directorDate: new Date().toISOString(), partialStockDeducted: partialNow }
    const saved = await saveSheet(updated)
    if (!saved) return

    // Auto-deduct stock for the main tanks + any partial fill on this sheet.
    const area = resolveArea(areas, saved.area) || {}
    await deductStock(sheetDeductions(saved, area))
    setActiveSheet(saved)
    showToast('Approved — stock deducted, now live on all iPads')
  }

  function newSheet() {
    const areaKeys = Object.keys(areas)
    const firstArea = areaKeys[0]
    setActiveSheet({
      id: crypto.randomUUID(),
      sheetType: firstArea || 'Spray Sheet',
      date: new Date().toISOString().slice(0, 10),
      operator: '',
      area: firstArea,
      tanks: firstArea ? areas[firstArea].tanks : 1,
      weather: { temp: '', wind: '', humidity: '', windDir: '' },
      products: [{ id: uid(), product: '', rate: '', basis: '', forceGal: false }],
      targets: [],
      instructions: '',
      ppe: [],
      status: 'pending',
      directorSig: '',
      directorDate: '',
      createdAt: new Date().toISOString(),
    })
    setRoute('edit')
  }

  // Match a program area name (e.g. "Blue Greens") to the best spray area in
  // Settings (e.g. "Blue Greens SprayBug 1.67gpm"). Falls back to the first area.
  function matchSprayArea(programArea) {
    const keys = Object.keys(areas)
    if (keys.length === 0) return ''
    const pa = String(programArea || '').toLowerCase()
    return (
      keys.find((k) => k.toLowerCase().startsWith(pa)) ||
      keys.find((k) => k.toLowerCase().includes(pa)) ||
      keys[0]
    )
  }

  // Build a spray sheet pre-filled from one or more planned applications (a
  // single area on a single day). The user reviews/edits it, then saves — at
  // which point those applications are marked as executed.
  function createSheetFromProgram(planned) {
    const area = matchSprayArea(planned[0].area)
    setActiveSheet({
      id: crypto.randomUUID(),
      sheetType: area || 'Spray Sheet',
      date: planned[0].plannedDate || new Date().toISOString().slice(0, 10),
      operator: '',
      area,
      tanks: area && areas[area] ? areas[area].tanks : 1,
      weather: { temp: '', wind: '', humidity: '', windDir: '' },
      products: planned.map((a) => ({
        id: uid(),
        product: a.product,
        rate: a.rateOzM != null ? String(a.rateOzM) : '',
        basis: a.basis || 'oz / M',
        forceGal: false,
      })),
      targets: [...new Set(planned.map((a) => a.target).filter(Boolean))],
      instructions: '',
      ppe: [],
      status: 'pending',
      directorSig: '',
      directorDate: '',
      createdAt: new Date().toISOString(),
      _sourceAppIds: planned.map((a) => a.id),
    })
    setRoute('edit')
  }

  const pending = sheets.filter((s) => s.status === 'pending')
  const approved = sheets.filter((s) => s.status === 'approved')
  const today = new Date().toISOString().slice(0, 10)
  const todaySheets = sheets.filter((s) => s.date === today)

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: FOREST }}>
        <Loader2 className="animate-spin text-white/40" size={28} />
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: CREAM }}>
      {toast && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 text-white px-4 py-2.5 rounded-full shadow-xl text-sm font-body font-medium" style={{ backgroundColor: INK }}>
          {toast}
        </div>
      )}

      {manage && !onboardDismissed && !courseInfo?.onboarded && (
        <OnboardingWizard
          courseInfo={courseInfo}
          grassTypes={grassTypes}
          onSkip={() => setOnboardDismissed(true)}
          onFinish={async (patch) => { await saveSettings(patch); setOnboardDismissed(true); showToast('Course set up — you can change this in Settings') }}
        />
      )}

      <TopNav route={route} setRoute={setRoute} onNew={newSheet} courseInfo={courseInfo} manage={manage} />

      {(() => {
        if (dismissLic) return null
        const alerts = computeLicenseAlerts(applicatorLicenses)
        if (alerts.length === 0) return null
        const anyExpired = alerts.some((a) => a.level === 'expired')
        return (
          <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-4">
            <div className="rounded-2xl border-2 p-3" style={anyExpired ? { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5' } : { backgroundColor: '#FEF3DD', borderColor: '#FDE9C8' }}>
              <div className="flex items-start gap-2">
                <AlertTriangle size={18} className="shrink-0 mt-0.5" style={{ color: anyExpired ? '#B91C1C' : '#92660D' }} />
                <div className="flex-1 min-w-0">
                  <p className="font-body text-sm font-bold" style={{ color: anyExpired ? '#B91C1C' : '#92660D' }}>
                    {anyExpired ? 'License expired' : 'License expiring soon'}
                  </p>
                  <div className="mt-1 space-y-0.5">
                    {alerts.map((a) => (
                      <p key={`${a.name}-${a.type}`} className="font-body text-[12px]" style={{ color: a.level === 'expired' ? '#B91C1C' : '#92660D' }}>
                        <b>{a.name}</b> — {a.type} license {a.label.toLowerCase()}
                      </p>
                    ))}
                  </div>
                  {manage && <p className="font-body text-[11px] text-slate-500 mt-1">Update dates in Settings → People.</p>}
                </div>
                <button onClick={() => setDismissLic(true)} className="font-body text-[11px] font-bold text-slate-400 shrink-0">Dismiss</button>
              </div>
            </div>
          </div>
        )
      })()}

      <div className="max-w-5xl mx-auto px-4 sm:px-6 pb-24">
        {route === 'dashboard' && (
          <Dashboard
            sheets={sheets} pending={pending} approved={approved} todaySheets={todaySheets} products={products} areas={areas}
            manage={manage} programApps={programApps} location={location}
            onOpen={(s) => { setActiveSheet(s); setRoute('view') }}
            onNew={newSheet}
            onSeeAll={() => setRoute('list')}
            onCreateFromProgram={createSheetFromProgram}
            onGoWeather={() => setRoute('weather')}
          />
        )}
        {route === 'list' && (
          <SheetList sheets={sheets} manage={manage} variant="manage" onOpen={(s) => { setActiveSheet(s); setRoute('view') }} onNew={newSheet} onDelete={removeSheet} onImportHistory={importHistory} />
        )}
        {route === 'tospray' && (
          <SheetList sheets={sheets} manage={manage} variant="tospray" onOpen={(s) => { setActiveSheet(s); setRoute('view') }} onNew={newSheet} />
        )}
        {route === 'records' && (
          <SheetList sheets={sheets} manage={manage} variant="records" onOpen={(s) => { setActiveSheet(s); setRoute('view') }} onNew={newSheet} />
        )}
        {route === 'edit' && activeSheet && manage && (
          <SheetEditor
            sheet={activeSheet} saving={saving} products={products} location={location}
            areas={areas} operators={operators} targets={targets} sheetTypes={sheetTypes} sheets={sheets}
            onSave={async (s) => {
              const saved = await saveSheet(s)
              if (saved) {
                // If this sheet came from the program, mark those planned
                // applications as executed so they drop off the dashboard.
                if (s._sourceAppIds?.length) {
                  try {
                    await db.markApplicationsLinked(s._sourceAppIds, saved.id)
                    setProgramApps((prev) => prev.map((a) => (s._sourceAppIds.includes(a.id) ? { ...a, linkedSheetId: saved.id } : a)))
                  } catch (e) { console.error(e) }
                }
                setActiveSheet(saved); setRoute('view'); showToast('Spray sheet saved')
              }
            }}
            onCancel={() => setRoute('dashboard')}
          />
        )}
        {route === 'view' && activeSheet && (
          <SheetViewer
            key={activeSheet.id}
            sheet={activeSheet} products={products} areas={areas} directors={directors} operators={operators}
            applicatorLicenses={applicatorLicenses} directorPins={directorPins}
            location={location} courseInfo={courseInfo}
            manage={manage} approve={canApprove(user.role)}
            onBack={() => setRoute(manage ? 'dashboard' : 'tospray')}
            onEdit={() => setRoute('edit')}
            onApprove={approveSheet}
            onLogSpray={async (updated, opts = {}) => {
              try {
                const saved = await db.updateSheet(updated)
                let finalSheet = saved
                // Once the main stock is committed (sheet approved or completed),
                // keep the partial-fill deduction in sync — pulling or restoring
                // only the difference, so editing the partial never double-counts.
                if (saved.status === 'approved' || saved.completed) {
                  const area = resolveArea(areas, saved.area) || {}
                  const already = Number(saved.partialStockDeducted) || 0
                  const now = Number(saved.partialGallons) || 0
                  if (already !== now && Number(area.galTank) > 0) {
                    await deductStock(partialDelta(saved, area, already, now))
                    finalSheet = await db.updateSheet({ ...saved, partialStockDeducted: now })
                  }
                }
                setActiveSheet(finalSheet)
                setSheets((prev) => prev.map((s) => (s.id === finalSheet.id ? finalSheet : s)))
                if (!opts.quiet) showToast(updated.completed ? 'Filed in Records' : 'Spray details saved')
              } catch (e) {
                console.error(e)
                showToast('Could not save — check your connection')
              }
            }}
            onRemoteSheet={(fresh) => {
              setActiveSheet((prev) => (prev && prev.id === fresh.id ? fresh : prev))
              setSheets((prev) => prev.map((s) => (s.id === fresh.id ? fresh : s)))
            }}
          />
        )}
        {route === 'chemicals' && manage && (
          <ChemicalLibrary products={products} grassTypes={grassTypes} onSaveProduct={saveProduct} onDeleteProduct={removeProduct} onImport={importProductsFromSheet} />
        )}
        {route === 'inventory' && (
          <Inventory products={products} deliveries={deliveries} onAddDelivery={addDelivery} />
        )}
        {route === 'documents' && (
          <DocumentsLibrary products={products} manage={manage} onSaveProduct={manage ? saveProduct : undefined} />
        )}
        {route === 'weather' && <Weather location={location} onGoToSettings={() => manage && setRoute('settings')} />}
        {route === 'program' && manage && <AnnualProgram areas={areas} products={products} onProductsChanged={reloadProducts} onCreateSheet={createSheetFromProgram} />}
        {route === 'reports' && manage && <Reports sheets={sheets} products={products} areas={areas} />}
        {route === 'settings' && manage && (
          <SettingsPage
            areas={areas} operators={operators} directors={directors} targets={targets}
            sheetTypes={sheetTypes} courseInfo={courseInfo} location={location} grassTypes={grassTypes} soilTypes={soilTypes}
            applicatorLicenses={applicatorLicenses} directorPins={directorPins}
            onSave={async (patch) => { await saveSettings(patch); showToast('Settings updated') }}
          />
        )}
      </div>
    </div>
  )
}

// ── TOP NAV ───────────────────────────────────────────────────────────────
function TopNav({ route, setRoute, onNew, courseInfo, manage }) {
  const items = manage
    ? [['dashboard', 'Dashboard'], ['list', 'All Sheets'], ['program', 'Annual Program'], ['weather', 'Weather'], ['inventory', 'Inventory'], ['documents', 'Labels & SDS'], ['reports', 'Reports'], ['chemicals', 'Chemical Library'], ['settings', 'Settings']]
    : [['tospray', 'To Spray'], ['records', 'Records'], ['inventory', 'Inventory'], ['documents', 'Labels & SDS'], ['weather', 'Weather']]

  return (
    <div style={{ backgroundColor: FOREST }} className="text-white">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-5 pb-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="font-display text-[10px] tracking-[0.25em] uppercase" style={{ color: GOLD }}>{courseInfo?.clubName || 'Golf Club'}</p>
            <h1 className="font-display text-2xl font-semibold mt-0.5">{courseInfo?.deptName || 'Grounds Operations'}</h1>
          </div>
          {manage && (
            <button onClick={onNew} className="font-body text-xs font-semibold px-3.5 py-2 rounded-full flex items-center gap-1.5" style={{ backgroundColor: GOLD, color: FOREST }}>
              <Plus size={14} /> New Sheet
            </button>
          )}
        </div>
        <div className="flex gap-1 font-body text-sm overflow-x-auto">
          {items.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setRoute(key)}
              className="px-3.5 py-1.5 rounded-full font-medium transition whitespace-nowrap"
              style={route === key ? { backgroundColor: 'rgba(255,255,255,0.12)', color: 'white' } : { color: 'rgba(255,255,255,0.5)' }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────
function Dashboard({ sheets, pending, approved, todaySheets, products, areas, onOpen, onNew, onSeeAll, manage, programApps = [], onCreateFromProgram, location, onGoWeather }) {
  const lowStock = (products || []).filter((p) => p.lowStockThreshold > 0 && (p.stock || 0) <= p.lowStockThreshold)
  const today = new Date().toISOString().slice(0, 10)

  // ── Live weather for the spray-window strip + season GDD for PGR timing.
  // Best-effort: the dashboard still renders everything else if this fails.
  const hasLocation = location?.lat != null
  const [wx, setWx] = useState({ current: null, todayWindow: null, season: [], breakdownTemps: [] })
  useEffect(() => {
    if (!hasLocation) return
    let cancelled = false
    ;(async () => {
      try {
        const data = await fetchWeather(location.lat, location.lng)
        const daily = dailyFromHourly(data)
        const todayRow = daily.find((d) => d.date === today) || daily[0] || null
        if (!cancelled) setWx((w) => ({ ...w, todayWindow: todayRow ? { ...todayRow, spray: sprayWindow(todayRow) } : null }))
      } catch { /* ignore */ }
      try { const c = await fetchCurrent(location.lat, location.lng); if (!cancelled) setWx((w) => ({ ...w, current: c })) } catch { /* ignore */ }
      try { const s = await fetchSeasonDaily(location.lat, location.lng); if (!cancelled) setWx((w) => ({ ...w, season: s })) } catch { /* ignore */ }
      try { const bt = await fetchBreakdownTemps(location.lat, location.lng); if (!cancelled) setWx((w) => ({ ...w, breakdownTemps: bt })) } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [hasLocation, location?.lat, location?.lng, today])

  // ── Disease protection (fungicide cover remaining, per area). A per-device
  // toggle (default on) switches between heat-adjusted breakdown and plain days.
  const [heatOn, setHeatOn] = useState(() => {
    if (typeof window === 'undefined') return true
    try { const v = window.localStorage.getItem('heatAdjustProtection'); return v === null ? true : v === '1' } catch { return true }
  })
  const toggleHeat = () => setHeatOn((v) => {
    const nv = !v
    try { window.localStorage.setItem('heatAdjustProtection', nv ? '1' : '0') } catch { /* ignore */ }
    return nv
  })
  const diseaseRows = manage ? protectionByArea(sheets, products, areas, undefined, heatOn ? wx.breakdownTemps : null) : []
  const diseaseAlerts = protectionAlertCount(diseaseRows)

  // ── Soil-temp application timing — nudge when a window opens (toggle, per device).
  const soilNow = currentSoilTemp(wx.breakdownTemps)
  const soilTrendDir = soilTrend(wx.breakdownTemps)
  const openWins = manage && soilNow != null ? openWindows(soilNow, soilTrendDir) : []
  const [timingNudge, setTimingNudge] = useState(() => {
    if (typeof window === 'undefined') return true
    try { const v = window.localStorage.getItem('soilTimingNudge'); return v === null ? true : v === '1' } catch { return true }
  })
  const toggleTimingNudge = () => setTimingNudge((v) => {
    const nv = !v
    try { window.localStorage.setItem('soilTimingNudge', nv ? '1' : '0') } catch { /* ignore */ }
    return nv
  })

  // ── PGR reapply timing (GDD base-32 since each area's last growth-reg spray).
  const PGR_TARGET = 200
  const pgrRows = (() => {
    if (!manage || !wx.season.length) return []
    const pgrNames = new Set((products || []).filter((p) => p.type === 'Growth Reg').map((p) => p.name))
    if (pgrNames.size === 0) return []
    const lastByArea = {}
    ;(sheets || [])
      .filter((s) => (s.status === 'approved' || s.completed) && s.date)
      .forEach((s) => {
        const pgr = (s.products || []).filter((p) => pgrNames.has(p.product)).map((p) => p.product)
        if (pgr.length === 0) return
        if (!lastByArea[s.area] || s.date > lastByArea[s.area].date) lastByArea[s.area] = { date: s.date, products: pgr }
      })
    // Iterate the areas that actually have a PGR spray (by the sheet's own area
    // name), so a name mismatch with Settings can't hide the bars.
    return Object.keys(lastByArea).map((area) => {
      const last = lastByArea[area]
      const gdd = gddSince(wx.season, last.date, 32)
      const pct = gdd != null && PGR_TARGET > 0 ? Math.min(100, Math.round((gdd / PGR_TARGET) * 100)) : 0
      const status = gdd == null ? 'none' : gdd >= PGR_TARGET ? 'due' : gdd >= PGR_TARGET * 0.8 ? 'soon' : 'ok'
      return { area, last, gdd, pct, status }
    }).sort((a, b) => (b.gdd ?? -1) - (a.gdd ?? -1))
  })()
  const pgrAlerts = pgrRows.filter((r) => r.status === 'due' || r.status === 'soon').length

  // Planned applications coming up in the next 7 days that haven't been turned
  // into a spray sheet yet, grouped into one card per area + day.
  const horizon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const upcomingGroups = (() => {
    const due = (programApps || []).filter((a) => !a.linkedSheetId && a.plannedDate && a.plannedDate >= today && a.plannedDate <= horizon)
    const map = {}
    due.forEach((a) => {
      const key = `${a.plannedDate}|${a.area}`
      if (!map[key]) map[key] = { date: a.plannedDate, area: a.area, items: [] }
      map[key].items.push(a)
    })
    return Object.values(map).sort((x, y) => x.date.localeCompare(y.date))
  })()

  const attention = []
  if (pending.length > 0) attention.push({ label: `${pending.length} awaiting approval`, tone: 'warn' })
  if (diseaseAlerts > 0) attention.push({ label: `${diseaseAlerts} area${diseaseAlerts > 1 ? 's' : ''} low on fungicide cover`, tone: 'bad' })
  if (pgrAlerts > 0) attention.push({ label: `${pgrAlerts} PGR reapply due`, tone: 'warn' })
  if (lowStock.length > 0) attention.push({ label: `${lowStock.length} product${lowStock.length > 1 ? 's' : ''} low on stock`, tone: 'bad' })

  return (
    <div className="pt-6 space-y-6">
      {/* Morning briefing — spray window + needs-attention at a glance */}
      {manage && (
        <SprayWindowStrip current={wx.current} today={wx.todayWindow} hasLocation={hasLocation} attention={attention} onGoWeather={onGoWeather} />
      )}

      {/* Soil-temp timing nudge — a window is open based on current soil temp */}
      {manage && timingNudge && openWins.length > 0 && (
        <div className="rounded-2xl border shadow-sm p-4" style={{ backgroundColor: '#F0F6F2', borderColor: '#CFE0D5' }}>
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <p className="font-body text-sm font-bold flex items-center gap-1.5" style={{ color: FERN }}>
              <Sprout size={15} /> Soil temp {soilNow}°F — good timing now
            </p>
            <button onClick={toggleTimingNudge} className="font-body text-[10px] font-bold text-slate-400 shrink-0" title="Turn off this nudge">Hide</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {openWins.map((w) => (
              <span key={w.id} className="font-body text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: 'white', color: FERN, border: '1px solid #DCE8E0' }}>{w.label}</span>
            ))}
          </div>
          <p className="font-body text-[10px] text-slate-400 mt-2">Based on your current 2&quot; soil temperature. See Turf → Timing for the full list.</p>
        </div>
      )}

      {/* Calendar — upcoming (planned) and past (actual) sprays at a glance */}
      <SprayCalendar
        sheets={sheets}
        products={products}
        programApps={manage ? programApps : []}
        onOpenSheet={onOpen}
        onCreateFromProgram={manage ? onCreateFromProgram : undefined}
      />

      {/* Stats strip */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard icon={<ClipboardList size={16} />} label="Pending Approval" value={pending.length} accent={pending.length > 0 ? '#B45309' : FERN} />
        <StatCard icon={<ShieldCheck size={16} />} label="Approved" value={approved.length} accent={FERN} />
        <StatCard icon={<Droplet size={16} />} label="Today" value={todaySheets.length} accent={GOLD} />
        <StatCard icon={<AlertTriangle size={16} />} label="Low Stock" value={lowStock.length} accent={lowStock.length > 0 ? '#DC2626' : FERN} />
      </div>

      {/* Disease protection — how much fungicide cover is left, per area */}
      {manage && diseaseRows.some((r) => r.last) && (
        <DiseaseProtectionCard rows={diseaseRows} heatOn={heatOn} onToggleHeat={toggleHeat} heatAvailable={wx.breakdownTemps.length > 0} />
      )}

      {/* PGR reapply timing — GDD since each area's last growth-reg spray */}
      {manage && pgrRows.length > 0 && (
        <PgrTimingCard rows={pgrRows} target={PGR_TARGET} />
      )}

      {/* From the Program — turn the plan into spray sheets */}
      {manage && upcomingGroups.length > 0 && (
        <section>
          <SectionHeader title="From the Program" subtitle="Planned in the next 7 days — tap to start a spray sheet" />
          <div className="space-y-2">
            {upcomingGroups.map((g) => (
              <div key={`${g.date}|${g.area}`} className="bg-white rounded-2xl border shadow-sm p-4 flex items-center justify-between gap-3" style={{ borderColor: '#EFE6C9' }}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-body text-[11px] font-bold flex items-center gap-1" style={{ color: '#92660D' }}>
                      <Calendar size={11} />{new Date(g.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </span>
                    <span className="font-body text-sm font-semibold text-slate-800 truncate">{g.area}</span>
                  </div>
                  <p className="font-body text-[11px] text-slate-400 truncate">
                    {g.items.map((a) => a.product).join(', ')}
                  </p>
                </div>
                <button onClick={() => onCreateFromProgram(g.items)} className="font-body text-xs font-bold px-3.5 py-2 rounded-full text-white shrink-0 flex items-center gap-1.5" style={{ backgroundColor: FOREST }}>
                  <Plus size={13} /> Create sheet
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {manage && lowStock.length > 0 && (
        <section>
          <SectionHeader title="Low Stock" subtitle="Running low — order soon" />
          <div className="bg-white rounded-2xl border border-red-100 overflow-hidden shadow-sm">
            {lowStock.map((p, i) => (
              <div key={p.name} className={`flex items-center justify-between px-4 py-3 ${i !== 0 ? 'border-t border-red-50' : ''}`}>
                <span className="font-body text-sm text-slate-700">{p.name}</span>
                <span className="font-body text-xs font-bold text-red-500">{p.stock} {p.unit} left</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {pending.length > 0 && (
        <section>
          <SectionHeader title="Awaiting Approval" subtitle="Sent to the Director — not yet live on iPads" />
          <div className="space-y-2">
            {pending.map((s) => <SheetRow key={s.id} sheet={s} onClick={() => onOpen(s)} highlight />)}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-3">
          <SectionHeader title="Recent Sheets" noMargin />
          <button onClick={onSeeAll} className="font-body text-xs font-semibold flex items-center gap-0.5" style={{ color: FERN }}>
            See all <ChevronRight size={13} />
          </button>
        </div>
        {sheets.length === 0 ? (
          <EmptyState onNew={onNew} manage={manage} />
        ) : (
          <div className="space-y-2">
            {sheets.slice(0, 6).map((s) => <SheetRow key={s.id} sheet={s} onClick={() => onOpen(s)} />)}
          </div>
        )}
      </section>
    </div>
  )
}

function StatCard({ icon, label, value, accent }) {
  return (
    <div className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm">
      <div className="flex items-center gap-1.5 mb-2" style={{ color: accent }}>{icon}</div>
      <p className="font-display text-3xl font-semibold text-slate-900">{value}</p>
      <p className="font-body text-[11px] text-slate-400 mt-0.5 leading-tight">{label}</p>
    </div>
  )
}

// Morning briefing strip: live conditions + today's 6am–noon spray window, plus
// a row of "needs attention" chips so the day's priorities read at a glance.
const WINDOW_STYLE = {
  good: { bg: '#E8F3EC', fg: FERN, dot: FERN, label: 'Good window' },
  caution: { bg: '#FEF3DD', fg: '#92660D', dot: '#D97706', label: 'Caution' },
  poor: { bg: '#FEE2E2', fg: '#B91C1C', dot: '#DC2626', label: 'Poor window' },
}
function SprayWindowStrip({ current, today, hasLocation, attention = [], onGoWeather }) {
  const win = today?.spray?.level ? WINDOW_STYLE[today.spray.level] : null
  const toneColor = { bad: '#DC2626', warn: '#92660D', ok: FERN }
  return (
    <div className="rounded-2xl overflow-hidden shadow-sm border border-black/5">
      <button onClick={onGoWeather} className="w-full text-left" style={{ backgroundColor: FOREST }}>
        <div className="px-4 py-3.5 flex items-center justify-between gap-3 text-white">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <Thermometer size={16} style={{ color: GOLD }} />
              <span className="font-display text-xl font-semibold">
                {current?.temp ? `${current.temp}°` : hasLocation ? '—' : 'Set location'}
              </span>
            </div>
            {current && (current.wind || current.humidity) && (
              <span className="font-body text-[11px] opacity-70 flex items-center gap-2 min-w-0 truncate">
                {current.wind && <span className="flex items-center gap-1"><Wind size={11} />{current.wind} mph</span>}
                {current.humidity && <span>{current.humidity}% RH</span>}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {win ? (
              <span className="font-body text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5" style={{ backgroundColor: win.bg, color: win.fg }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: win.dot }} />
                {win.label}
              </span>
            ) : (
              <span className="font-body text-[11px] opacity-60">Spray window</span>
            )}
            <ChevronRight size={15} className="opacity-50" />
          </div>
        </div>
      </button>
      {win && today?.spray?.reasons?.length > 0 && (
        <div className="px-4 py-2 bg-white font-body text-[11px] text-slate-500 border-b border-black/5">
          6am–noon: {today.spray.reasons.join(' · ')}
        </div>
      )}
      {attention.length > 0 && (
        <div className="px-4 py-2.5 bg-white flex flex-wrap gap-1.5">
          {attention.map((a, i) => (
            <span key={i} className="font-body text-[11px] font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5" style={{ backgroundColor: '#F8FAFC', color: toneColor[a.tone] || FERN, border: '1px solid #EEF2F6' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: toneColor[a.tone] || FERN }} />
              {a.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// Disease protection — a shrinking bar per area showing how much fungicide cover
// remains from the last spray. Leads with whatever is exposed or nearly so.
const PROT_STYLE = {
  expired: { bg: '#FEE2E2', fg: '#B91C1C', bar: '#DC2626', label: 'Exposed' },
  soon: { bg: '#FEF3DD', fg: '#92660D', bar: '#D97706', label: 'Running out' },
  ok: { bg: '#E8F3EC', fg: FERN, bar: FERN, label: 'Protected' },
}
function DiseaseProtectionCard({ rows, heatOn, onToggleHeat, heatAvailable }) {
  const shown = rows.filter((r) => r.last)
  const heatAdjusted = shown.some((r) => r.mode === 'temp')
  return (
    <section>
      <div className="flex items-end justify-between gap-2 mb-3">
        <SectionHeader title="Disease Protection" subtitle="Fungicide cover left per area since the last spray" noMargin />
        {onToggleHeat && (
          <button onClick={onToggleHeat} className="font-body text-[11px] font-bold px-2.5 py-1.5 rounded-full flex items-center gap-1.5 shrink-0 transition" style={heatOn ? { backgroundColor: '#FEF3DD', color: '#92660D' } : { backgroundColor: 'white', color: '#94A3B8', border: '1px solid #E2E8F0' }} title="Speed the countdown up in heat">
            <Thermometer size={12} /> Heat {heatOn ? 'on' : 'off'}
          </button>
        )}
      </div>
      <div className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm space-y-3">
        {shown.map((r) => {
          const st = PROT_STYLE[r.status] || PROT_STYLE.ok
          const badge = r.status === 'expired'
            ? (r.mode === 'temp' ? st.label : `${st.label} · ${Math.abs(r.remaining)}d over`)
            : `${st.label} · ${r.remaining}d left`
          return (
            <div key={r.area}>
              <div className="flex items-center justify-between mb-1 gap-2">
                <span className="font-body text-sm font-semibold text-slate-800 truncate">{r.area}</span>
                <span className="font-body text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ backgroundColor: st.bg, color: st.fg }}>{badge}</span>
              </div>
              <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                {/* Expired shows a full status-coloured bar so it's clearly visible,
                    not an empty sliver. Otherwise it fills to the cover remaining. */}
                <div className="h-full rounded-full transition-all" style={{ width: r.status === 'expired' ? '100%' : `${Math.max(8, r.pct)}%`, backgroundColor: st.bar }} />
              </div>
              <p className="font-body text-[10px] text-slate-400 mt-0.5 truncate">
                Last: {r.last.products.join(', ')} · {fmtDate(r.last.date)} · {r.mode === 'temp' ? `${r.window}-day label, heat-adjusted` : `${r.window}-day window`}
              </p>
            </div>
          )
        })}
      </div>
      <p className="font-body text-[10px] text-slate-400 mt-1.5">
        {heatAdjusted
          ? 'Countdown speeds up in heat — it burns down by soil temperature (warm days use up cover faster), not just calendar days. Guidance, not a lab test.'
          : "Window comes from each fungicide's spray interval (set in Chemical Library). Contact products protect ~7–14 days; systemics longer."}
      </p>
    </section>
  )
}

// PGR reapply timing — compact version of the Turf module's growth-reg tracker,
// surfaced on the dashboard so timing lives next to the day's other priorities.
function PgrTimingCard({ rows, target }) {
  const st = { due: { bg: '#FEE2E2', fg: '#B91C1C', bar: '#DC2626', label: 'Reapply now' }, soon: { bg: '#FEF3DD', fg: '#92660D', bar: '#D97706', label: 'Soon' }, ok: { bg: '#E8F3EC', fg: FERN, bar: FERN, label: 'On track' } }
  return (
    <section>
      <SectionHeader title="Growth-Reg Timing" subtitle={`GDD since each area's last PGR (base 32°F) · target ~${target}`} />
      <div className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm space-y-3">
        {rows.map((r) => {
          const s = st[r.status] || st.ok
          return (
            <div key={r.area}>
              <div className="flex items-center justify-between mb-1 gap-2">
                <span className="font-body text-sm font-semibold text-slate-800 truncate">{r.area}</span>
                <span className="font-body text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ backgroundColor: s.bg, color: s.fg }}>
                  {r.gdd} / {target} · {s.label}
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(4, r.pct)}%`, backgroundColor: s.bar }} />
              </div>
              <p className="font-body text-[10px] text-slate-400 mt-0.5 truncate">Last: {r.last.products.join(', ')} · {fmtDate(r.last.date)}</p>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function SectionHeader({ title, subtitle, noMargin }) {
  return (
    <div className={noMargin ? '' : 'mb-3'}>
      <h2 className="font-display text-lg font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="font-body text-xs text-slate-400 mt-0.5">{subtitle}</p>}
    </div>
  )
}

function EmptyState({ onNew, manage }) {
  return (
    <div className="bg-white rounded-2xl border border-black/5 p-10 text-center shadow-sm">
      <Sprout className="mx-auto mb-3 text-slate-300" size={28} />
      <p className="font-body text-sm text-slate-400 mb-4">No spray sheets yet</p>
      {manage && (
        <button onClick={onNew} className="font-body text-xs font-semibold px-4 py-2 rounded-full text-white" style={{ backgroundColor: FOREST }}>
          Create your first sheet
        </button>
      )}
    </div>
  )
}

function SheetRow({ sheet, onClick, highlight }) {
  const productCount = sheet.products?.filter((p) => p.product).length || 0
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white rounded-2xl border p-4 flex items-center justify-between transition active:scale-[0.99] shadow-sm"
      style={{ borderColor: highlight ? '#FDE9C8' : 'rgba(0,0,0,0.05)', backgroundColor: highlight ? '#FFFBF3' : 'white' }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <p className="font-body font-semibold text-sm text-slate-900 truncate">{sheet.area}</p>
          {sheet.completed ? (
            <span className="font-body text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide" style={{ backgroundColor: '#E8F3EC', color: FERN }}>Sprayed</span>
          ) : (
            <StatusPill status={sheet.status} />
          )}
        </div>
        <div className="flex items-center gap-3 mt-1.5 font-body text-[11px] text-slate-400">
          <span className="flex items-center gap-1"><Calendar size={10} />{fmtDate(sheet.date)}</span>
          {sheet.operator && <span className="flex items-center gap-1"><User size={10} />{sheet.operator}</span>}
          <span>{productCount} product{productCount !== 1 ? 's' : ''}</span>
        </div>
      </div>
      <ChevronRight size={16} className="text-slate-300 shrink-0 ml-2" />
    </button>
  )
}

function StatusPill({ status }) {
  const styles = status === 'approved' ? { backgroundColor: '#E8F3EC', color: FERN } : { backgroundColor: '#FEF3DD', color: '#92660D' }
  return (
    <span className="font-body text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide" style={styles}>
      {status === 'approved' ? 'Approved' : 'Pending'}
    </span>
  )
}

// ── SHEET LIST ────────────────────────────────────────────────────────────
const SHEET_FILTER_LABELS = { all: 'All', pending: 'Pending', tospray: 'To Spray', completed: 'Completed' }
function matchSheetFilter(s, f) {
  if (f === 'all') return true
  if (f === 'pending') return s.status === 'pending'
  if (f === 'tospray') return s.status === 'approved' && !s.completed
  if (f === 'completed') return !!s.completed
  return true
}

function SheetList({ sheets, onOpen, onNew, onDelete, onImportHistory, manage, variant = 'manage' }) {
  const [confirmDelete, setConfirmDelete] = useState(null) // sheet pending deletion
  const [histPrev, setHistPrev] = useState(null) // { sheets, count, rowCount, error, fileName }
  const [histBusy, setHistBusy] = useState(false)
  const histFileRef = useRef(null)

  const onHistFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const { parseSprayHistory } = await import('@/lib/importXlsx')
      const res = parseSprayHistory(await file.arrayBuffer())
      setHistPrev({ ...res, fileName: file.name })
    } catch {
      setHistPrev({ sheets: [], count: 0, error: 'Could not read that file. Make sure it is a .xlsx spreadsheet.', fileName: file.name })
    }
  }
  const confirmHist = async () => {
    if (!histPrev?.sheets?.length) return
    setHistBusy(true)
    try { await onImportHistory(histPrev.sheets); setHistPrev(null) }
    catch { setHistPrev((p) => ({ ...p, error: 'Could not save the import. Try again.' })) }
    setHistBusy(false)
  }
  const downloadHistTemplate = async () => {
    const XLSX = await import('xlsx')
    const headers = ['Date', 'Area', 'Product', 'Rate', 'Basis', 'Target', 'Applicator', 'Tanks']
    const ex = [
      ['2025-06-14', 'Blue Greens', 'Daconil Action', 1.8, 'oz / M', 'Dollar Spot', 'Jock McPherson', 2],
      ['2025-06-14', 'Blue Greens', 'Primo MAXX', 0.2, 'oz / M', 'Growth Reg', 'Jock McPherson', 2],
      ['2025-06-21', 'Gold Fairways', 'Acelepryn', 8, 'oz / A', 'Grubs', 'Kevin Johnson', 4],
    ]
    const ws = XLSX.utils.aoa_to_sheet([headers, ...ex])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Spray History')
    XLSX.writeFile(wb, 'spray-history-template.xlsx')
  }
  const CONFIG = {
    manage: { title: 'All Spray Sheets', sub: null, keys: ['tospray', 'pending', 'completed', 'all'], initial: 'tospray' },
    tospray: { title: 'To Spray', sub: 'Approved and outstanding — mark them done as you go', keys: [], initial: 'tospray' },
    records: { title: 'Records', sub: 'Completed sprays — open to print or review', keys: [], initial: 'completed' },
  }
  const cfg = CONFIG[variant] || CONFIG.manage
  const [filter, setFilter] = useState(cfg.initial)
  const active = cfg.keys.length ? filter : cfg.initial
  const filtered = sheets.filter((s) => matchSheetFilter(s, active))

  return (
    <div className="pt-6">
      <div className="flex items-start justify-between gap-2">
        <SectionHeader title={cfg.title} subtitle={cfg.sub} noMargin />
        {onImportHistory && active === 'completed' && (
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={downloadHistTemplate} className="font-body text-[11px] font-bold px-3 py-2 rounded-full border" style={{ color: FERN, borderColor: '#E2E8F0', backgroundColor: 'white' }}>Template</button>
            <button onClick={() => histFileRef.current?.click()} className="font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5 border" style={{ color: FOREST, borderColor: FOREST, backgroundColor: 'white' }}>
              <CloudUpload size={14} /> Import Records
            </button>
          </div>
        )}
      </div>
      <input ref={histFileRef} type="file" accept=".xlsx,.xls" onChange={onHistFile} className="hidden" />

      {histPrev && (
        <div className="bg-white rounded-2xl border-2 p-4 mt-4 shadow-sm" style={{ borderColor: GOLD }}>
          <p className="font-display text-base font-semibold text-slate-900 mb-1">Import history from “{histPrev.fileName}”</p>
          {histPrev.error ? (
            <p className="font-body text-sm text-red-600 mt-1">{histPrev.error}</p>
          ) : (
            <p className="font-body text-sm text-slate-600">
              Found <b>{histPrev.rowCount}</b> product line{histPrev.rowCount !== 1 ? 's' : ''} across <b>{histPrev.count}</b> spray day{histPrev.count !== 1 ? 's' : ''}. These import as completed sprays so they feed all your reports (rotation, usage, GDD, days-since). Nothing is deleted.
            </p>
          )}
          <div className="flex gap-2 pt-3">
            <button onClick={() => setHistPrev(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold font-body text-slate-500 border border-slate-200">Cancel</button>
            {!histPrev.error && histPrev.count > 0 && (
              <button onClick={confirmHist} disabled={histBusy} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body text-white disabled:opacity-60 flex items-center justify-center gap-2" style={{ backgroundColor: FOREST }}>
                {histBusy ? <Loader2 size={15} className="animate-spin" /> : null}
                {histBusy ? 'Importing…' : `Import ${histPrev.count} spray day${histPrev.count !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        </div>
      )}

      {cfg.keys.length > 0 && (
        <div className="flex gap-2 mb-4 mt-3 overflow-x-auto pb-1">
          {cfg.keys.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="font-body text-xs font-semibold px-3 py-1.5 rounded-full transition whitespace-nowrap"
              style={filter === f ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}
            >
              {SHEET_FILTER_LABELS[f]}
            </button>
          ))}
        </div>
      )}
      {filtered.length === 0 ? (
        <div className="mt-3 bg-white rounded-2xl border border-black/5 p-10 text-center text-slate-400 font-body text-sm shadow-sm">
          {variant === 'tospray' ? 'Nothing to spray right now — all caught up.' : variant === 'records' ? 'No completed sprays yet.' : 'No sheets match this filter.'}
        </div>
      ) : (
        <div className="space-y-2 mt-3">
          {filtered.map((s) => (
            <div key={s.id} className="flex items-stretch gap-2">
              <div className="flex-1 min-w-0"><SheetRow sheet={s} onClick={() => onOpen(s)} /></div>
              {onDelete && (
                <button onClick={() => setConfirmDelete(s)} className="shrink-0 px-3 rounded-2xl border border-red-100 text-red-400 hover:bg-red-50 transition flex items-center justify-center" aria-label="Delete sheet">
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(26,26,22,0.45)' }} onClick={() => setConfirmDelete(null)}>
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={18} className="text-red-500" />
              <p className="font-display text-base font-bold text-slate-900">Delete this spray sheet?</p>
            </div>
            <p className="font-body text-sm text-slate-500 mb-4">
              <b>{confirmDelete.area}</b> · {fmtDate(confirmDelete.date)}. This permanently removes the sheet and its records. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold font-body text-slate-500 border border-slate-200">Cancel</button>
              <button onClick={() => { onDelete(confirmDelete); setConfirmDelete(null) }} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body text-white" style={{ backgroundColor: '#DC2626' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── SHARED FORM BITS ────────────────────────────────────────────────────────
function Card({ children }) {
  return <div className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm">{children}</div>
}
function FieldLabel({ children, noMargin }) {
  return <label className={`font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block ${noMargin ? '' : 'mb-1.5'}`}>{children}</label>
}
function Select({ value, onChange, options, placeholder }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white">
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o}>{o}</option>)}
    </select>
  )
}
function InfoChip({ label, value }) {
  return (
    <div>
      <p className="font-body text-[9px] uppercase text-slate-400">{label}</p>
      <p className="font-body text-xs font-bold text-slate-700">{value}</p>
    </div>
  )
}

// ── SHEET EDITOR ──────────────────────────────────────────────────────────
function SheetEditor({ sheet, onSave, onCancel, saving, products, areas, operators, targets: targetOptions, sheetTypes, location, sheets = [] }) {
  const [s, setS] = useState({ ...sheet, targets: sheet.targets || (sheet.target ? [sheet.target] : []) })
  const [nTargets, setNTargets] = useState({}) // per-line "feed by N" target (lb N/M)
  const area = resolveArea(areas, s.area) || areas[Object.keys(areas)[0]] || { tanks: 1, nozzle: '', psi: '', galTank: 0, sqft: 0 }
  const rotationAlerts = rotationWarnings(s, sheets, products)

  const update = (patch) => setS((prev) => ({ ...prev, ...patch }))
  const updateProduct = (id, patch) => setS((prev) => ({ ...prev, products: prev.products.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
  const addRow = () => setS((prev) => ({ ...prev, products: [...prev.products, { id: uid(), product: '', rate: '', basis: '', forceGal: false }] }))
  const removeRow = (id) => setS((prev) => ({ ...prev, products: prev.products.filter((p) => p.id !== id) }))

  // Area is now the sheet's identity — keep sheetType mirroring it so older
  // records and any place that still reads sheetType show the area name.
  const handleAreaChange = (areaName) => update({ area: areaName, sheetType: areaName, tanks: areas[areaName].tanks })
  const handleProductSelect = (id, name) => {
    const prod = products.find((p) => p.name === name)
    updateProduct(id, { product: name, basis: prod?.basis || '', defaultRate: prod?.rate ?? null })
  }
  const toggleTarget = (t) => {
    setS((prev) => ({
      ...prev,
      targets: prev.targets.includes(t) ? prev.targets.filter((x) => x !== t) : [...prev.targets, t],
    }))
  }

  return (
    <div className="pt-6 pb-10 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <button onClick={onCancel} className="font-body text-sm font-medium text-slate-400">Cancel</button>
        <h2 className="font-display text-lg font-semibold text-slate-900">{sheet.status === 'pending' && sheet.directorSig === '' ? 'Spray Sheet' : 'Edit Sheet'}</h2>
        <button onClick={() => onSave(s)} disabled={saving} className="font-body text-xs font-bold px-4 py-2 rounded-full text-white disabled:opacity-50" style={{ backgroundColor: FOREST }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="space-y-4">
        <Card>
          <FieldLabel>Area</FieldLabel>
          <Select value={s.area} onChange={handleAreaChange} options={Object.keys(areas)} />

          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <FieldLabel>Date</FieldLabel>
              <input type="date" value={s.date} onChange={(e) => update({ date: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
            </div>
            <div>
              <FieldLabel>Operator</FieldLabel>
              <Select value={s.operator} onChange={(v) => update({ operator: v })} options={operators} placeholder="Select..." />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mt-3 bg-slate-50 rounded-xl p-3">
            <InfoChip label="Nozzle" value={area.nozzle} />
            <InfoChip label="PSI" value={area.psi} />
            <InfoChip label="Gal/Tank" value={area.galTank} />
          </div>

          <div className="mt-3">
            <FieldLabel>{`Tanks (default ${area.tanks})`}</FieldLabel>
            <input type="number" min={1} value={s.tanks} onChange={(e) => update({ tanks: Number(e.target.value) })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
          </div>
        </Card>

        {rotationAlerts.length > 0 && (
          <div className="rounded-2xl border p-3" style={{ backgroundColor: '#FEF2F2', borderColor: '#FECACA' }}>
            <div className="flex items-center gap-1.5 mb-1">
              <AlertTriangle size={15} className="text-red-500" />
              <p className="font-body text-[12px] font-bold text-red-700">Rotation warning</p>
            </div>
            <div className="space-y-1">
              {rotationAlerts.map((w) => (
                <p key={w.product} className="font-body text-[11px] text-red-600">
                  <b>{w.product}</b> (Group {w.group}) — {w.prevProduct} hit {s.area} just {w.days} day{w.days !== 1 ? 's' : ''} ago (within {w.window}d). Consider a different group to avoid resistance.
                </p>
              ))}
            </div>
          </div>
        )}

        <Card>
          <div className="flex items-center justify-between mb-2">
            <FieldLabel noMargin>Products</FieldLabel>
            <button onClick={addRow} className="font-body text-xs font-bold flex items-center gap-1" style={{ color: FERN }}>
              <Plus size={13} /> Add
            </button>
          </div>
          <div className="space-y-2.5">
            {s.products.map((p) => {
              const { value: amt, unit: amtUnit } = calcAmount(parseFloat(p.rate), p.basis, area.sqft, p.forceGal)
              const total = amt !== null ? Math.round(amt * s.tanks * 10) / 10 : null
              const prodInfo = products.find((pr) => pr.name === p.product)
              const labelMax = p.basis?.includes('/ M') ? prodInfo?.labelMaxM : prodInfo?.labelMaxA
              const labelMin = p.basis?.includes('/ M') ? prodInfo?.labelMinM : prodInfo?.labelMinA
              const rateNum = parseFloat(p.rate)
              const overLimit = labelMax && rateNum && rateNum > labelMax
              const underLimit = labelMin && rateNum && rateNum < labelMin
              const outOfRange = overLimit || underLimit
              return (
                <div key={p.id} className="border rounded-xl p-3" style={{ borderColor: outOfRange ? '#FCA5A5' : '#E2E8F0' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <select value={p.product} onChange={(e) => handleProductSelect(p.id, e.target.value)} className="flex-1 border border-slate-200 rounded-lg px-2 py-2 text-sm font-body bg-white min-w-0">
                      <option value="">Select product...</option>
                      {products.map((pr) => <option key={pr.name} value={pr.name}>{pr.name}</option>)}
                    </select>
                    <button onClick={() => removeRow(p.id)} className="text-red-400 p-1 shrink-0"><Trash2 size={15} /></button>
                  </div>
                  {p.product && (
                    <>
                      <div className="grid grid-cols-2 gap-2 mb-1">
                        <input type="number" step="any" placeholder={p.defaultRate ? `Default ${p.defaultRate}` : 'Rate'} value={p.rate} onChange={(e) => updateProduct(p.id, { rate: e.target.value })} className="border-2 rounded-lg px-2.5 py-2 text-sm font-semibold font-body" style={{ borderColor: outOfRange ? '#EF4444' : GOLD, backgroundColor: outOfRange ? '#FEF2F2' : '#FFFBF0' }} />
                        <select value={p.basis} onChange={(e) => updateProduct(p.id, { basis: e.target.value })} className="border border-slate-200 rounded-lg px-2 py-2 text-xs font-body bg-white">
                          {BASIS_OPTIONS.map((b) => <option key={b}>{b}</option>)}
                        </select>
                      </div>

                      {prodInfo?.type === 'Fertilizer' && (() => {
                        const canN = productRateForN(1, prodInfo) != null
                        return (
                          <div className="flex items-center gap-2 mb-2 rounded-lg px-2.5 py-1.5 flex-wrap" style={{ backgroundColor: '#EFF6FF' }}>
                            <span className="font-body text-[11px] font-bold shrink-0" style={{ color: '#2563EB' }}>Feed by N</span>
                            {canN ? (
                              <>
                                <input type="number" step="any" inputMode="decimal" value={nTargets[p.id] ?? ''} onChange={(e) => setNTargets((t) => ({ ...t, [p.id]: e.target.value }))} placeholder="0.10" className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-sm font-body bg-white" />
                                <span className="font-body text-[11px] text-slate-500">lb N / M</span>
                                <button type="button" onClick={() => { const r = productRateForN(nTargets[p.id], prodInfo); if (r) updateProduct(p.id, r) }} className="font-body text-[11px] font-bold px-2.5 py-1 rounded-full text-white shrink-0" style={{ backgroundColor: '#2563EB' }}>Set rate</button>
                              </>
                            ) : (
                              <span className="font-body text-[11px] text-slate-500">Add this product's N {prodInfo.fertForm === 'liquid' ? '(lb N/gal)' : '%'} in the Chemical Library to dose by nitrogen.</span>
                            )}
                          </div>
                        )
                      })()}

                      {overLimit && (
                        <p className="font-body text-[11px] font-semibold text-red-600 mb-2 flex items-center gap-1">⚠ Over label maximum — limit is {labelMax} {p.basis}</p>
                      )}
                      {underLimit && (
                        <p className="font-body text-[11px] font-semibold text-red-600 mb-2 flex items-center gap-1">⚠ Under label minimum — minimum is {labelMin} {p.basis}</p>
                      )}
                      {grassConflicts(prodInfo, area).length > 0 && (
                        <p className="font-body text-[11px] font-semibold text-red-600 mb-2 rounded-lg px-2 py-1.5" style={{ backgroundColor: '#FEF2F2' }}>
                          ⚠ Grass safety: {p.product} can damage {grassConflicts(prodInfo, area).join(', ')} — this area ({(area.grasses || []).join(', ')}) has it. Check the label.
                        </p>
                      )}
                      {!outOfRange && (labelMin || labelMax) && (
                        <p className="font-body text-[10px] text-slate-400 mb-2">Label range: {labelMin ?? '—'}–{labelMax ?? '—'} {p.basis}</p>
                      )}

                      <label className="flex items-center gap-2 mb-2 cursor-pointer select-none">
                        <input type="checkbox" checked={p.forceGal} onChange={(e) => updateProduct(p.id, { forceGal: e.target.checked })} className="w-4 h-4 rounded" style={{ accentColor: FERN }} />
                        <span className="font-body text-xs text-slate-500">Show final amount in gallons</span>
                      </label>

                      {amt !== null && (
                        <div className="flex items-center justify-between text-xs font-body rounded-lg px-3 py-2" style={{ backgroundColor: outOfRange ? '#FEF2F2' : '#F0F6F2' }}>
                          <span className="text-slate-500">Amt/Tank: <b className="text-slate-800">{amt} {amtUnit}</b></span>
                          <span className="text-slate-500">Total: <b style={{ color: outOfRange ? '#DC2626' : FERN }}>{total} {amtUnit}</b></span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </Card>

        <Card>
          <FieldLabel>Target  <span className="font-normal normal-case text-slate-400">(select all that apply)</span></FieldLabel>
          <div className="flex flex-wrap gap-2 mt-2">
            {targetOptions.map((t) => {
              const active = s.targets.includes(t)
              return (
                <button key={t} onClick={() => toggleTarget(t)} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full transition border" style={active ? { backgroundColor: FERN, color: 'white', borderColor: FERN } : { backgroundColor: 'white', color: '#64748B', borderColor: '#E2E8F0' }}>
                  {t}
                </button>
              )
            })}
          </div>
        </Card>

        <Card>
          <FieldLabel>Instructions</FieldLabel>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {QUICK_INSTRUCTIONS.map((q) => (
              <button key={q} type="button" onClick={() => update({ instructions: (s.instructions ? s.instructions + '\n' : '') + q })} className="font-body text-[11px] font-semibold px-2.5 py-1 rounded-full border" style={{ borderColor: '#E2E8F0', color: '#64748B' }}>
                + {q}
              </button>
            ))}
          </div>
          <textarea value={s.instructions || ''} onChange={(e) => update({ instructions: e.target.value })} rows={3} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" placeholder={'e.g. Water in 0.1" after application. Avoid overlap near bunkers.'} />

          <p className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide mt-4 mb-1.5">PPE Required</p>
          <div className="flex flex-wrap gap-2">
            {PPE_OPTIONS.map((item) => {
              const on = (s.ppe || []).includes(item)
              return (
                <button key={item} type="button" onClick={() => update({ ppe: on ? (s.ppe || []).filter((x) => x !== item) : [...(s.ppe || []), item] })} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full transition border" style={on ? { backgroundColor: '#92660D', color: 'white', borderColor: '#92660D' } : { backgroundColor: 'white', color: '#64748B', borderColor: '#E2E8F0' }}>
                  {item}
                </button>
              )
            })}
          </div>
        </Card>
      </div>
    </div>
  )
}


// ── Self-contained spray-record HTML (for print + PDF) ──────────────────────
// Builds a standalone HTML string from a single sheet. Rendered into an isolated
// iframe (print) or a detached element (PDF) so only THIS sheet is ever output —
// no global print-CSS hacks, no shared ids, no other sheets leaking in.
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}
function sheetRecordHTML(sheet, area = {}, products = [], sheetTargets = [], courseInfo = {}) {
  const L = 'border:1px solid #ccc;padding:5px 8px;background:#F0F0EA;font-weight:700;width:15%'
  const V = 'border:1px solid #ccc;padding:5px 8px;width:35%'
  const TH = 'border:1px solid #16291F;padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;color:#fff'
  const R = 'border:1px solid #ccc;padding:5px 8px'
  const tbl = 'width:100%;border-collapse:collapse;font-size:11px;margin-bottom:12px'
  const blank = '_______________________'

  const rows = (sheet.products || []).filter((p) => p.product).map((p) => {
    const { value: amt, unit } = calcAmount(parseFloat(p.rate), p.basis, area.sqft, p.forceGal)
    const total = amt !== null ? Math.round(amt * (sheet.tanks || 1) * 10) / 10 : null
    return { ...p, amt, total, unit }
  })
  const productRows = rows.map((p, i) => `<tr style="background:${i % 2 === 0 ? '#fff' : '#F5F5F0'}">
    <td style="${R}">${esc(p.product)}</td><td style="${R}">${esc(p.rate)}</td><td style="${R}">${esc(p.basis)}</td>
    <td style="${R}">${p.amt ?? '—'} ${esc(p.unit || '')}</td><td style="${R};font-weight:700">${p.total ?? '—'} ${esc(p.unit || '')}</td></tr>`).join('')

  const partialGal = sheet.partialGallons
  let partialTable = ''
  if (partialGal && area.galTank) {
    const pr = rows.map((p, i) => {
      const { value: amt, unit } = calcAmount(parseFloat(p.rate), p.basis, effectiveSqft(partialGal, area), p.forceGal)
      return `<tr style="background:${i % 2 === 0 ? '#fff' : '#F5F5F0'}"><td style="${R}">${esc(p.product)}</td><td style="${R};font-weight:700">${amt ?? '—'} ${esc(unit || '')}</td></tr>`
    }).join('')
    partialTable = `<table style="${tbl}"><thead><tr style="background:#92660D;color:#fff"><th style="${TH}" colspan="2">Partial Fill — Extra Spray (${esc(partialGal)} gal)</th></tr></thead><tbody>${pr}</tbody></table>`
  }
  const sig = (v) => v ? `<img src="${v}" style="height:48px;max-width:100%" />` : blank
  const w = sheet.weather || {}

  return `<div style="font-family:Arial,sans-serif;color:#111">
    <div style="text-align:center;border-bottom:2px solid #16291F;padding-bottom:10px;margin-bottom:14px">
      <div style="font-size:18px;font-weight:700">${esc(courseInfo.clubName || 'Golf Club')}</div>
      <div style="font-size:12px;color:#555">${esc(courseInfo.deptName || 'Grounds Operations')} — Spray Record</div>
    </div>
    <table style="${tbl}"><tbody>
      <tr><td style="${L}">Area</td><td style="${V}">${esc(sheet.area)}</td><td style="${L}">Date</td><td style="${V}">${esc(sheet.date)}</td></tr>
      <tr><td style="${L}">Operator</td><td style="${V}">${esc(sheet.operator || '—')}</td><td style="${L}">Tanks</td><td style="${V}">${esc(sheet.tanks)}${area.galTank ? ` × ${esc(area.galTank)} gal` : ''}</td></tr>
      <tr><td style="${L}">Nozzle</td><td style="${V}">${esc(area.nozzle || '—')}</td><td style="${L}">PSI</td><td style="${V}">${esc(area.psi || '—')}</td></tr>
      <tr><td style="${L}">Target</td><td style="${V}" colspan="3">${esc(sheetTargets.join(', ') || '—')}</td></tr>
      <tr><td style="${L}">Weather</td><td style="${V}" colspan="3">${w.temp ? `${esc(w.temp)}°F` : '—'} · ${w.wind ? `${esc(w.wind)} mph wind` : '—'} · ${w.humidity ? `${esc(w.humidity)}% humidity` : '—'} · ${esc(w.windDir || '—')}</td></tr>
    </tbody></table>
    <table style="${tbl}"><thead><tr style="background:#16291F"><th style="${TH}">Product</th><th style="${TH}">Rate</th><th style="${TH}">Basis</th><th style="${TH}">Amt/Tank</th><th style="${TH}">Total</th></tr></thead><tbody>${productRows}</tbody></table>
    ${partialTable}
    <table style="${tbl}"><tbody>
      <tr><td style="${L}">PPE</td><td style="${V}" colspan="3">${esc((sheet.ppe || []).join(', ') || '—')}</td></tr>
      <tr><td style="${L}">Instructions</td><td style="${V}" colspan="3">${esc(sheet.instructions || '—')}</td></tr>
    </tbody></table>
    <table style="${tbl}"><tbody><tr><td style="${L};background:#FEF2F2">Safety Notice</td><td style="${V}" colspan="3">Check ALL nozzles before leaving maintenance area. Calculate rates BEFORE filling sprayer.</td></tr></tbody></table>
    <table style="width:100%;border-collapse:collapse;font-size:11px"><tbody>
      <tr><td style="${L}">Applicator</td><td style="${V}">${esc(sheet.completedBy || sheet.operator || blank)}</td><td style="${L}">Date Applied</td><td style="${V}">${sheet.completedAt ? esc(new Date(sheet.completedAt).toLocaleString()) : blank}</td></tr>
      <tr><td style="${L}">Pesticide Lic #</td><td style="${V}">${esc(sheet.applicatorPesticideLicense || '—')}</td><td style="${L}">Fertilizer Lic #</td><td style="${V}">${esc(sheet.applicatorFertilizerLicense || '—')}</td></tr>
      <tr><td style="${L}">Applicator Signature</td><td style="${V}" colspan="3">${sig(sheet.applicatorSignature)}</td></tr>
      <tr><td style="${L}">Superintendent</td><td style="${V}">${esc(sheet.operator || blank)}</td><td style="${L}">Date Submitted</td><td style="${V}">${sheet.createdAt ? esc(new Date(sheet.createdAt).toLocaleDateString()) : blank}</td></tr>
      <tr><td style="${L}">Director Approval</td><td style="${V}">${esc(sheet.directorSig || blank)}</td><td style="${L}">Date Approved</td><td style="${V}">${sheet.directorDate ? esc(new Date(sheet.directorDate).toLocaleString()) : blank}</td></tr>
      <tr><td style="${L}">Director Signature</td><td style="${V}" colspan="3">${sig(sheet.directorSignature)}</td></tr>
      <tr><td style="${L}">Status</td><td style="${V}" colspan="3">${sheet.status === 'approved' ? 'APPROVED' : 'PENDING APPROVAL'}</td></tr>
    </tbody></table>
    <p style="font-size:9px;color:#888;margin-top:20px;text-align:center">Printed ${esc(new Date().toLocaleString())} — Sheet ID: ${esc(sheet.id)}</p>
  </div>`
}

// Print one record via an isolated hidden iframe (only this sheet prints).
function printRecordHTML(bodyHtml) {
  const iframe = document.createElement('iframe')
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
  document.body.appendChild(iframe)
  const doc = iframe.contentWindow.document
  doc.open()
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:0.5in;size:portrait}body{margin:0;font-family:Arial,sans-serif;color:#111}</style></head><body>${bodyHtml}</body></html>`)
  doc.close()
  let fired = false
  const go = () => { if (fired) return; fired = true; try { iframe.contentWindow.focus(); iframe.contentWindow.print() } finally { setTimeout(() => iframe.remove(), 1000) } }
  const imgs = doc.images
  if (imgs && imgs.length) {
    let n = 0
    const done = () => { if (++n >= imgs.length) go() }
    Array.from(imgs).forEach((im) => { if (im.complete) done(); else { im.onload = done; im.onerror = done } })
    setTimeout(go, 1500)
  } else {
    setTimeout(go, 200)
  }
}

// Wait for any <img> in an element to finish loading (signatures are data URLs
// but still need a tick), capped so it never hangs.
function waitForImages(el, cap = 2000) {
  const imgs = Array.from(el.querySelectorAll('img'))
  const pending = imgs.filter((im) => !im.complete)
  if (pending.length === 0) return Promise.resolve()
  return Promise.race([
    Promise.all(pending.map((im) => new Promise((res) => { im.onload = res; im.onerror = res }))),
    new Promise((res) => setTimeout(res, cap)),
  ])
}

// Export one record to PDF from a detached, off-screen element. Builds the PDF as
// a real file: on iPad/iPhone it goes to the native Share sheet (→ "Save to
// Files"), because iOS Safari ignores the classic download that .save() uses.
// Returns 'shared' | 'downloaded' | 'printed' so the caller can guide the user.
async function pdfRecordHTML(bodyHtml, filename) {
  const holder = document.createElement('div')
  Object.assign(holder.style, { position: 'absolute', left: '-10000px', top: '0', width: '760px', background: '#ffffff' })
  holder.innerHTML = bodyHtml
  document.body.appendChild(holder)
  await waitForImages(holder)
  try {
    const html2pdf = (await import('html2pdf.js')).default
    const worker = html2pdf().set({
      margin: 8,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: 820 },
      jsPDF: { unit: 'pt', format: 'a4', orientation: 'portrait' },
    }).from(holder)
    const pdf = await worker.toPdf().get('pdf')
    const blob = pdf.output('blob')
    const file = new File([blob], filename, { type: 'application/pdf' })

    // iPad/iPhone: hand the file to the OS share sheet so it can be saved to Files.
    if (typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: filename }); return 'shared' }
      catch (e) { if (e && e.name === 'AbortError') return 'shared' } // user closed the sheet
    }
    // Desktop and everything else: normal download.
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    return 'downloaded'
  } catch (e) {
    console.error('PDF export failed, falling back to print', e)
    // Last resort: the native print dialog (→ Save as PDF / Save to Files).
    printRecordHTML(bodyHtml)
    return 'printed'
  } finally {
    holder.remove()
  }
}

// ── SIGNATURE PAD ─────────────────────────────────────────────────────────
// A finger/stylus signature box for the iPad. Emits a PNG data URL via onChange
// and can reload a previously saved signature.
function SignaturePad({ value, onChange }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const last = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#1A1A16'
    if (value) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      img.src = value
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pos = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    }
  }
  const start = (e) => { e.preventDefault(); drawing.current = true; last.current = pos(e) }
  const move = (e) => {
    if (!drawing.current) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const p = pos(e)
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke()
    last.current = p
  }
  const end = () => {
    if (!drawing.current) return
    drawing.current = false
    onChange(canvasRef.current.toDataURL('image/png'))
  }
  const clear = () => {
    const canvas = canvasRef.current
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    onChange('')
  }

  return (
    <div>
      <div className="relative rounded-xl border-2 border-dashed border-slate-200 bg-white">
        <canvas
          ref={canvasRef}
          width={600}
          height={160}
          className="w-full block"
          style={{ height: 160, touchAction: 'none' }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
        />
        <button type="button" onClick={clear} className="absolute top-2 right-2 font-body text-[11px] font-bold text-slate-400 bg-white/80 rounded-full px-2.5 py-0.5 border border-slate-200">Clear</button>
      </div>
      <p className="font-body text-[11px] text-slate-400 mt-1">Sign above with your finger or a stylus.</p>
    </div>
  )
}

// ── SHEET VIEWER ──────────────────────────────────────────────────────────
function SheetViewer({ sheet, onBack, onEdit, onApprove, onLogSpray, onRemoteSheet, products, areas, directors, operators = [], applicatorLicenses = {}, directorPins = {}, location, courseInfo, manage, approve }) {
  const [sig, setSig] = useState('')
  const [dirPin, setDirPin] = useState('')
  const [dirSig, setDirSig] = useState('')
  const [pinError, setPinError] = useState('')
  const [wx, setWx] = useState(sheet.weather || { temp: '', wind: '', humidity: '', windDir: '' })
  const [sprayedBy, setSprayedBy] = useState(sheet.completedBy || sheet.operator || '')
  // The applicator's drawn sign-off signature (data URL).
  const [applicatorSig, setApplicatorSig] = useState(sheet.applicatorSignature || '')
  const licenseFor = applicatorLicenses[sprayedBy] || {}
  const [partialGal, setPartialGal] = useState(sheet.partialGallons ?? '')
  const [showPartial, setShowPartial] = useState(sheet.partialGallons != null)
  const [wxLoading, setWxLoading] = useState(false)
  const area = resolveArea(areas, sheet.area) || {}
  const productIds = sheet.products.filter((p) => p.product).map((p) => p.id)
  const tankCount = sheet.tanks || 1

  // Which products are in each tank (shared/synced), keyed by tank number.
  const [tankChecks, setTankChecks] = useState(sheet.tankChecks || {})
  // Which tank THIS device is filling — local only, so several iPads can each
  // work a different tank at the same time.
  const tankIsComplete = (checksObj, n) => {
    const c = checksObj[String(n)] || []
    return productIds.length > 0 && productIds.every((id) => c.includes(id))
  }
  const firstIncomplete = () => {
    for (let n = 1; n <= tankCount; n++) if (!tankIsComplete(sheet.tankChecks || {}, n)) return n
    return 1
  }
  const [curTank, setCurTank] = useState(firstIncomplete())

  // Live sync: mirror the other iPads' check-offs as they happen. The current
  // tank selection stays local so devices don't fight over it.
  useEffect(() => {
    const unsub = db.subscribeSheet(sheet.id, (fresh) => {
      setTankChecks(fresh.tankChecks || {})
      if (fresh.weather) setWx(fresh.weather)
      onRemoteSheet?.(fresh)
    })
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet.id])

  const curChecks = tankChecks[String(curTank)] || []
  const completedCount = Array.from({ length: tankCount }, (_, i) => i + 1).filter((n) => tankIsComplete(tankChecks, n)).length

  // Save the check-off state (broadcasts to the other iPads). No approval needed.
  const pushChecks = (next) => {
    setTankChecks(next)
    onLogSpray?.({ ...sheet, tankChecks: next, weather: wx, partialGallons: partialGal === '' ? null : Number(partialGal) }, { quiet: true })
  }
  const toggleCheck = (pid) => {
    const c = tankChecks[String(curTank)] || []
    const nextC = c.includes(pid) ? c.filter((x) => x !== pid) : [...c, pid]
    pushChecks({ ...tankChecks, [String(curTank)]: nextC })
  }
  const changeTank = (n) => setCurTank(n) // local only
  const goNextTank = () => setCurTank((t) => Math.min(t + 1, tankCount))
  const sheetTargets = sheet.targets || (sheet.target ? [sheet.target] : [])
  const hasLocation = location && location.lat != null && location.lng != null

  async function fillWx() {
    if (!hasLocation) return
    setWxLoading(true)
    try {
      const w = await fetchCurrent(location.lat, location.lng)
      setWx((prev) => ({ ...prev, ...w }))
    } catch { /* ignore */ }
    setWxLoading(false)
  }
  const saveLog = (complete) =>
    onLogSpray?.({
      ...sheet,
      weather: wx,
      tankChecks,
      completed: complete ? true : sheet.completed,
      completedBy: complete ? (sprayedBy || sheet.operator || '') : sheet.completedBy,
      completedAt: complete ? new Date().toISOString() : sheet.completedAt,
      // Snapshot the signature + license numbers onto the record at sign-off.
      applicatorSignature: applicatorSig || sheet.applicatorSignature || '',
      applicatorPesticideLicense: complete ? (licenseFor.pesticide || '') : sheet.applicatorPesticideLicense,
      applicatorFertilizerLicense: complete ? (licenseFor.fertilizer || '') : sheet.applicatorFertilizerLicense,
    })
  // Director approval: verify the PIN (if one is set) before signing off.
  const doApprove = () => {
    if (!sig) return
    const required = directorPins[sig]
    if (required && dirPin !== required) { setPinError("That PIN doesn't match — try again."); return }
    setPinError('')
    onApprove(sig, dirSig)
  }
  const reopen = () => onLogSpray?.({ ...sheet, completed: false })
  // Save the optional partial-fill add-on (no approval needed — separate spray).
  const savePartial = (gal) => onLogSpray?.({ ...sheet, partialGallons: gal === '' || gal == null ? null : Number(gal) }, { quiet: true })
  // Manual save of the current sheet state (weather, check-offs, partial, signature).
  const saveNow = () =>
    onLogSpray?.({ ...sheet, weather: wx, tankChecks, partialGallons: partialGal === '' ? null : Number(partialGal), applicatorSignature: applicatorSig || sheet.applicatorSignature || '' })

  // Print / export this one record — built as isolated HTML so only this sheet
  // is ever output (fixes the "other sheets show up" + blank-PDF bugs).
  const [pdfBusy, setPdfBusy] = useState(false)
  const buildRecordHtml = () => sheetRecordHTML(sheet, area, products, sheetTargets, courseInfo)
  const printRecord = () => printRecordHTML(buildRecordHtml())
  const exportPdf = async () => {
    setPdfBusy(true)
    try {
      const safe = `${sheet.area || 'Spray'}-${sheet.date || ''}`.replace(/[^\w-]+/g, '_')
      await pdfRecordHTML(buildRecordHtml(), `Spray-Sheet_${safe}.pdf`)
    } catch (e) { console.error(e) }
    setPdfBusy(false)
  }

  return (
    <div className="pt-6 pb-10 max-w-2xl mx-auto">
      <div className="no-print flex items-center justify-between mb-5">
        <button onClick={onBack} className="font-body text-sm font-medium text-slate-400">← Back</button>
        <div className="flex items-center gap-3">
          <StatusPill status={sheet.status} />
          <button onClick={saveNow} className="font-body text-sm font-medium" style={{ color: FERN }}>Save</button>
          <button onClick={printRecord} className="font-body text-sm font-medium" style={{ color: FOREST }}>Print</button>
          <button onClick={exportPdf} disabled={pdfBusy} className="font-body text-sm font-medium disabled:opacity-50" style={{ color: FOREST }}>{pdfBusy ? 'PDF…' : 'Export PDF'}</button>
          {manage && sheet.status === 'pending' && (
            <button onClick={onEdit} className="font-body text-sm font-medium" style={{ color: FERN }}>Edit</button>
          )}
        </div>
      </div>


      <div className="no-print">
        <h2 className="font-display text-2xl font-semibold text-slate-900 mb-1">{sheet.area}</h2>
        <p className="font-body text-sm text-slate-400 mb-5">{fmtDate(sheet.date)}</p>

        <div className="space-y-4">
          <Card>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-3 gap-x-4 font-body text-sm">
              <Row label="Date" value={sheet.date || '—'} />
              <Row label="Applicator" value={sheet.operator || '—'} />
              <Row label="Tanks" value={sheet.tanks} />
              <Row label="Nozzle" value={area.nozzle || '—'} />
              <Row label="PSI" value={area.psi || '—'} />
              <Row label="Gal / Tank" value={area.galTank ?? '—'} />
              <Row label="Spray Rate" value={area.sprayRate ? `${area.sprayRate} gal/ac` : '—'} />
              <Row label="Sq Ft" value={area.sqft ? area.sqft.toLocaleString() : '—'} />
              <Row label="Acres" value={area.sqft ? (area.sqft / 43560).toFixed(2) : '—'} />
            </div>
          </Card>

          {(sheet.weather.temp || sheet.weather.wind) && (
            <Card>
              <FieldLabel>Weather</FieldLabel>
              <div className="grid grid-cols-4 gap-2 mt-2 font-body text-sm">
                <div><p className="text-[10px] text-slate-400">Temp</p><p className="font-bold">{sheet.weather.temp || '—'}°F</p></div>
                <div><p className="text-[10px] text-slate-400">Wind</p><p className="font-bold">{sheet.weather.wind || '—'} mph</p></div>
                <div><p className="text-[10px] text-slate-400">Humidity</p><p className="font-bold">{sheet.weather.humidity || '—'}%</p></div>
                <div><p className="text-[10px] text-slate-400">Dir</p><p className="font-bold">{sheet.weather.windDir || '—'}</p></div>
              </div>
            </Card>
          )}

          {/* Products — amount per tank, with the total off to the side (your sheet's layout).
              Tick each product as it goes in the tank; syncs live across iPads. */}
          <Card>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <FieldLabel noMargin>Products</FieldLabel>
                <span className="font-body text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-1" style={{ backgroundColor: '#E8F3EC', color: FERN }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: FERN }} /> LIVE
                </span>
              </div>
              <div className="flex gap-3 pr-1">
                <span className="w-16 text-center font-body text-[10px] font-bold text-slate-400 uppercase tracking-wide">Amt/Tank</span>
                <span className="w-16 text-center font-body text-[10px] font-bold text-slate-400 uppercase tracking-wide">Total</span>
              </div>
            </div>

            {tankCount > 1 && (
              <div className="mb-2 rounded-xl px-2.5 py-2" style={{ backgroundColor: '#F0F6F2' }}>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-body text-[10px] font-bold uppercase tracking-wide mr-1" style={{ color: FERN }}>Tanks</span>
                  {Array.from({ length: tankCount }, (_, i) => i + 1).map((n) => {
                    const done = tankIsComplete(tankChecks, n)
                    const some = (tankChecks[String(n)] || []).length > 0 && !done
                    const isCur = n === curTank
                    const bg = done ? FERN : some ? GOLD : 'white'
                    const fg = done || some ? 'white' : '#64748B'
                    return (
                      <button key={n} onClick={() => changeTank(n)} className="w-8 h-8 rounded-full font-body text-xs font-bold transition flex items-center justify-center" style={{ backgroundColor: bg, color: fg, border: isCur ? `2px solid ${FOREST}` : '1px solid #E2E8F0' }}>
                        {done ? <Check size={14} /> : n}
                      </button>
                    )
                  })}
                  <button onClick={goNextTank} className="font-body text-[11px] font-semibold px-2.5 py-1.5 rounded-full ml-1" style={{ color: FERN, border: '1px solid #CFE3D6' }}>Next →</button>
                  <span className="font-body text-[10px] font-semibold text-slate-500 ml-auto">{completedCount}/{tankCount} tanks done</span>
                </div>
                <p className="font-body text-[11px] mt-1.5 text-slate-500">
                  Filling <b style={{ color: FOREST }}>Tank {curTank}</b>{tankIsComplete(tankChecks, curTank) ? ' — complete ✓' : ''}. Tap a tank to switch; other iPads can fill different tanks at the same time.
                </p>
              </div>
            )}

            <div className="divide-y divide-slate-100">
              {sheet.products.filter((p) => p.product).map((p) => {
                const { value: amt, unit } = calcAmount(parseFloat(p.rate), p.basis, area.sqft, p.forceGal)
                const total = amt !== null ? Math.round(amt * sheet.tanks * 10) / 10 : null
                const prodInfo = products?.find((pr) => pr.name === p.product)
                const labelMax = p.basis?.includes('/ M') ? prodInfo?.labelMaxM : prodInfo?.labelMaxA
                const labelMin = p.basis?.includes('/ M') ? prodInfo?.labelMinM : prodInfo?.labelMinA
                const rateNum = parseFloat(p.rate)
                const overLimit = labelMax && rateNum && rateNum > labelMax
                const underLimit = labelMin && rateNum && rateNum < labelMin
                const outOfRange = overLimit || underLimit
                const stock = prodInfo?.stock ?? null
                const insufficient = stock !== null && total !== null && stock < total
                const checked = curChecks.includes(p.id)
                return (
                  <div key={p.id} className="py-2.5 flex items-center gap-2.5 font-body">
                    <button onClick={() => toggleCheck(p.id)} className="shrink-0" aria-label="Confirm in tank">
                      <span className="w-6 h-6 rounded-md border flex items-center justify-center transition" style={checked ? { backgroundColor: FERN, borderColor: FERN } : { borderColor: '#CBD5E1', backgroundColor: 'white' }}>
                        {checked && <Check size={14} className="text-white" />}
                      </span>
                    </button>
                    <div className="min-w-0 flex-1" style={{ opacity: checked ? 0.55 : 1 }}>
                      <p className="text-sm font-semibold text-slate-800 flex items-center gap-1.5 flex-wrap">
                        {p.product}
                        {overLimit && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">OVER</span>}
                        {underLimit && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">UNDER</span>}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {p.rate} {p.basis}{insufficient ? ` · only ${stock} ${unit} in stock` : ''}
                      </p>
                      {grassConflicts(prodInfo, area).length > 0 && (
                        <p className="text-[10px] font-semibold text-red-600 mt-0.5">⚠ May damage {grassConflicts(prodInfo, area).join(', ')}</p>
                      )}
                      {(prodInfo?.labelUrl || prodInfo?.sdsUrl) && (
                        <div className="flex gap-2 mt-1" onClick={(e) => e.stopPropagation()}>
                          {prodInfo?.labelUrl && <a href={normalizeUrl(prodInfo.labelUrl)} target="_blank" rel="noopener noreferrer" className="text-[11px] font-bold" style={{ color: '#2563EB' }}>Label ↗</a>}
                          {prodInfo?.sdsUrl && <a href={normalizeUrl(prodInfo.sdsUrl)} target="_blank" rel="noopener noreferrer" className="text-[11px] font-bold" style={{ color: '#2563EB' }}>SDS ↗</a>}
                        </div>
                      )}
                    </div>
                    <div className="w-16 text-center rounded-lg py-1.5" style={{ backgroundColor: '#FFF6DD' }}>
                      <p className="text-sm font-bold text-slate-900 leading-none">{amt ?? '—'}</p>
                      <p className="text-[8px] text-slate-500 uppercase mt-0.5">{unit}</p>
                    </div>
                    <div className="w-16 text-center">
                      <p className="text-sm font-bold leading-none" style={{ color: outOfRange ? '#DC2626' : FERN }}>{total ?? '—'}</p>
                      <p className="text-[8px] text-slate-400 uppercase mt-0.5">{unit}</p>
                    </div>
                  </div>
                )
              })}
              {sheet.products.filter((p) => p.product).length === 0 && (
                <p className="py-3 font-body text-sm text-slate-400">No products on this sheet.</p>
              )}
            </div>
          </Card>

          {/* Optional partial fill — a separate extra spray with the same mix. Does
              not touch the main sheet above, and needs no re-approval. */}
          <Card>
            {!showPartial ? (
              <button onClick={() => setShowPartial(true)} className="w-full flex items-center justify-center gap-1.5 font-body text-sm font-semibold py-1" style={{ color: FERN }}>
                <Plus size={15} /> Add partial fill (extra tank)
              </button>
            ) : (
              <>
                <div className="flex items-center justify-between mb-2">
                  <FieldLabel noMargin>Partial Fill — Extra Spray</FieldLabel>
                  <button onClick={() => { setShowPartial(false); setPartialGal(''); savePartial('') }} className="text-red-400 p-1"><Trash2 size={14} /></button>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-body text-[11px] text-slate-400">Gallons of water in this extra tank. Full tank is {area.galTank || '—'} gal.</p>
                  <input type="number" step="any" value={partialGal} onChange={(e) => setPartialGal(e.target.value)} onBlur={(e) => savePartial(e.target.value)} className="w-24 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body text-center" placeholder="gal" />
                </div>

                {Number(partialGal) > 0 && Number(area.galTank) > 0 ? (
                  <>
                    <p className="font-body text-[11px] font-semibold rounded-lg px-3 py-2 my-2" style={{ backgroundColor: '#FFF6DD', color: '#92660D' }}>
                      {partialGal} gal = {Math.round((Number(partialGal) / Number(area.galTank)) * 100)}% of a full tank
                    </p>
                    <div className="divide-y divide-slate-100">
                      {sheet.products.filter((p) => p.product).map((p) => {
                        const { value: amt, unit } = calcAmount(parseFloat(p.rate), p.basis, effectiveSqft(partialGal, area), p.forceGal)
                        return (
                          <div key={p.id} className="py-2 flex items-center justify-between font-body">
                            <span className="text-sm font-semibold text-slate-800">{p.product}</span>
                            <span className="text-sm font-bold" style={{ color: FERN }}>{amt ?? '—'} {unit}</span>
                          </div>
                        )
                      })}
                    </div>
                    <p className="font-body text-[11px] text-slate-400 mt-2">Add these amounts to the partial tank. This is an extra spray — it doesn't change the main sheet above.</p>
                  </>
                ) : (
                  <p className="font-body text-sm text-slate-400 mt-2">Enter the gallons to see the amounts.</p>
                )}
              </>
            )}
          </Card>

          {/* Safety notice — carried over from the paper sheet */}
          <Card>
            <p className="font-body text-[11px] font-bold uppercase tracking-wide text-red-500 mb-1">Before you spray</p>
            <p className="font-body text-xs text-slate-600 leading-relaxed">
              Check ALL nozzles before leaving the maintenance area. Calculate rates BEFORE filling the sprayer.
            </p>
          </Card>

          {sheetTargets.length > 0 && (
            <Card>
              <FieldLabel>Target</FieldLabel>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {sheetTargets.map((t) => (
                  <span key={t} className="font-body text-xs font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: '#EDE7F6', color: '#7C3AED' }}>{t}</span>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <FieldLabel>Instructions</FieldLabel>
            <p className="font-body text-sm text-slate-700 whitespace-pre-wrap">{sheet.instructions ? sheet.instructions : '—'}</p>
          </Card>

          <Card>
            <FieldLabel>PPE Required</FieldLabel>
            {sheet.ppe && sheet.ppe.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {sheet.ppe.map((item) => (
                  <span key={item} className="font-body text-xs font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: '#FEF3DD', color: '#92660D' }}>{item}</span>
                ))}
              </div>
            ) : (
              <p className="font-body text-sm text-slate-400 mt-1">—</p>
            )}
          </Card>

          <Card>
            <FieldLabel>Approval &amp; Distribution</FieldLabel>
            <div className="mt-3 space-y-3">
              <FlowStep done label="Spray sheet created" sub={`by ${sheet.operator || 'Superintendent'}`} icon={<Check size={13} />} />
              <FlowStep done={sheet.status === 'approved'} active={sheet.status === 'pending'}
                label={sheet.status === 'approved' ? 'Approved by Director' : 'Awaiting Director approval'}
                sub={sheet.status === 'approved' ? `${sheet.directorSig} · ${new Date(sheet.directorDate).toLocaleString()}` : 'Sent to your boss for sign-off'}
                icon={<ShieldCheck size={13} />} />
              <FlowStep done={sheet.status === 'approved'}
                label="Live on all iPads"
                sub={sheet.status === 'approved' ? 'Synced to the cloud — visible to every device now' : 'Will sync automatically once approved'}
                icon={<Cloud size={13} />} />
            </div>

            {sheet.status === 'pending' && approve && (
              <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
                <Select value={sig} onChange={(v) => { setSig(v); setPinError('') }} options={directors} placeholder="Select director to approve..." />
                {sig && (
                  <>
                    <div>
                      <FieldLabel>Approval PIN {directorPins[sig] ? '' : '(none set — add one in Settings → People)'}</FieldLabel>
                      <input type="password" inputMode="numeric" value={dirPin} onChange={(e) => { setDirPin(e.target.value.replace(/\D/g, '').slice(0, 8)); setPinError('') }} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body tracking-widest" placeholder="Enter your PIN" />
                      {pinError && <p className="font-body text-[11px] text-red-500 mt-1">{pinError}</p>}
                    </div>
                    <div>
                      <FieldLabel>Director signature</FieldLabel>
                      <SignaturePad value={dirSig} onChange={setDirSig} />
                    </div>
                  </>
                )}
                <button onClick={doApprove} disabled={!sig || !dirSig || (directorPins[sig] && !dirPin)} className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40 flex items-center justify-center gap-2" style={{ backgroundColor: FOREST }}>
                  <CloudUpload size={15} /> Approve &amp; Push to iPads
                </button>
              </div>
            )}
            {sheet.status === 'approved' && sheet.directorSignature && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <p className="font-body text-[11px] text-slate-400 mb-1">Director signature — {sheet.directorSig}</p>
                <img src={sheet.directorSignature} alt="Director signature" className="h-12 rounded border border-slate-100 bg-white" />
              </div>
            )}
            {sheet.status === 'pending' && !approve && (
              <p className="mt-4 pt-4 border-t border-slate-100 font-body text-xs text-slate-400">
                Only the Director of Grounds can approve. This sheet is waiting for sign-off.
              </p>
            )}
          </Card>

          {/* Field log — appears once approved; where the crew records the spray */}
          {sheet.status === 'approved' && (
            <Card>
              {sheet.completed ? (
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Check size={15} style={{ color: FERN }} />
                    <p className="font-body text-sm font-bold" style={{ color: FERN }}>Sprayed &amp; filed in Records</p>
                  </div>
                  <p className="font-body text-xs text-slate-500">
                    {sheet.completedBy ? `By ${sheet.completedBy}` : ''}{sheet.completedAt ? ` · ${new Date(sheet.completedAt).toLocaleString()}` : ''}
                  </p>
                  {(sheet.applicatorPesticideLicense || sheet.applicatorFertilizerLicense) && (
                    <p className="font-body text-[11px] text-slate-400 mt-0.5">
                      {sheet.applicatorPesticideLicense ? `Pesticide Lic: ${sheet.applicatorPesticideLicense}` : ''}
                      {sheet.applicatorPesticideLicense && sheet.applicatorFertilizerLicense ? ' · ' : ''}
                      {sheet.applicatorFertilizerLicense ? `Fertilizer Lic: ${sheet.applicatorFertilizerLicense}` : ''}
                    </p>
                  )}
                  {sheet.applicatorSignature && (
                    <img src={sheet.applicatorSignature} alt="Applicator signature" className="mt-2 h-12 rounded border border-slate-100 bg-white" />
                  )}
                  <div className="flex gap-2 mt-3">
                    <button onClick={printRecord} className="font-body text-xs font-bold px-3.5 py-2 rounded-full text-white" style={{ backgroundColor: FOREST }}>Print record</button>
                    <button onClick={exportPdf} disabled={pdfBusy} className="font-body text-xs font-bold px-3.5 py-2 rounded-full disabled:opacity-50" style={{ color: FOREST, border: `1px solid ${FOREST}` }}>{pdfBusy ? 'Exporting…' : 'Export PDF'}</button>
                    <button onClick={reopen} className="font-body text-xs font-semibold px-3.5 py-2 rounded-full text-slate-500 border border-slate-200">Reopen (back to To Spray)</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <FieldLabel noMargin>Log this spray</FieldLabel>
                    {hasLocation && (
                      <button type="button" onClick={fillWx} disabled={wxLoading} className="font-body text-xs font-bold flex items-center gap-1 disabled:opacity-50" style={{ color: FERN }}>
                        {wxLoading ? <Loader2 className="animate-spin" size={13} /> : <Cloud size={13} />}
                        {wxLoading ? 'Fetching…' : "Use today's weather"}
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {[['temp', 'Temp °F'], ['wind', 'Wind mph'], ['humidity', 'Humidity %'], ['windDir', 'Wind dir']].map(([k, ph]) => (
                      <input key={k} placeholder={ph} value={wx[k] || ''} onChange={(e) => setWx({ ...wx, [k]: e.target.value })} className="border border-slate-200 rounded-xl px-3 py-2 text-sm font-body" />
                    ))}
                  </div>
                  <FieldLabel>Sprayed by</FieldLabel>
                  <Select value={sprayedBy} onChange={setSprayedBy} options={operators} placeholder="Select…" />
                  {sprayedBy && (licenseFor.pesticide || licenseFor.fertilizer) && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 font-body text-[11px] text-slate-500">
                      {licenseFor.pesticide && <span>Pesticide Lic: <b className="text-slate-700">{licenseFor.pesticide}</b></span>}
                      {licenseFor.fertilizer && <span>Fertilizer Lic: <b className="text-slate-700">{licenseFor.fertilizer}</b></span>}
                    </div>
                  )}
                  {sprayedBy && !licenseFor.pesticide && !licenseFor.fertilizer && (
                    <p className="font-body text-[11px] text-amber-600 mt-1.5">No license on file for {sprayedBy}. Add it in Settings → People.</p>
                  )}

                  <div className="mt-3">
                    <FieldLabel>Applicator signature</FieldLabel>
                    <SignaturePad value={applicatorSig} onChange={setApplicatorSig} />
                  </div>

                  <div className="flex gap-2 mt-3">
                    <button onClick={() => saveLog(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold font-body text-slate-600 border border-slate-200">Save progress</button>
                    <button onClick={() => saveLog(true)} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body text-white flex items-center justify-center gap-2" style={{ backgroundColor: FOREST }}>
                      <Check size={15} /> Mark as sprayed
                    </button>
                  </div>
                  <p className="font-body text-[11px] text-slate-400 mt-2">Use “Save progress” for multi-day sprays; “Mark as sprayed” files it in Records (still editable).</p>
                </>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function FlowStep({ done, active, label, sub, icon }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: done ? '#E8F3EC' : active ? '#FEF3DD' : '#F1F5F9', color: done ? FERN : active ? '#92660D' : '#94A3B8' }}>
        {icon}
      </div>
      <div>
        <p className="font-body text-sm font-semibold" style={{ color: done ? '#1E293B' : '#64748B' }}>{label}</p>
        <p className="font-body text-xs text-slate-400">{sub}</p>
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div>
      <p className="text-[10px] text-slate-400 uppercase">{label}</p>
      <p className="font-semibold text-slate-800">{value}</p>
    </div>
  )
}

// ── LIQUID FERT CALCULATOR ────────────────────────────────────────────────
function LiquidFertCalculator({ draft, setDraft }) {
  const density = parseFloat(draft.density) || 0
  const nPct = parseFloat(draft.nPctCalc) || 0
  const pPct = parseFloat(draft.pPctCalc) || 0
  const kPct = parseFloat(draft.kPctCalc) || 0

  const nResult = Math.round(density * (nPct / 100) * 1000) / 1000
  const pResult = Math.round(density * (pPct / 100) * 1000) / 1000
  const kResult = Math.round(density * (kPct / 100) * 1000) / 1000

  useEffect(() => {
    if (density > 0) {
      setDraft((prev) => ({ ...prev, nPerGal: nResult, pPerGal: pResult, kPerGal: kResult }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.density, draft.nPctCalc, draft.pPctCalc, draft.kPctCalc])

  return (
    <div className="space-y-3">
      <div>
        <FieldLabel>Density (lbs per gallon)</FieldLabel>
        <input type="number" step="any" value={draft.density ?? ''} onChange={(e) => setDraft({ ...draft, density: e.target.value })} className="w-full border border-amber-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="e.g. 10.5 — check the label or SDS" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <FieldLabel>N % by weight</FieldLabel>
          <input type="number" step="any" value={draft.nPctCalc ?? ''} onChange={(e) => setDraft({ ...draft, nPctCalc: e.target.value })} className="w-full border border-amber-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="e.g. 8" />
        </div>
        <div>
          <FieldLabel>P % by weight</FieldLabel>
          <input type="number" step="any" value={draft.pPctCalc ?? ''} onChange={(e) => setDraft({ ...draft, pPctCalc: e.target.value })} className="w-full border border-amber-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="e.g. 2" />
        </div>
        <div>
          <FieldLabel>K % by weight</FieldLabel>
          <input type="number" step="any" value={draft.kPctCalc ?? ''} onChange={(e) => setDraft({ ...draft, kPctCalc: e.target.value })} className="w-full border border-amber-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="e.g. 2" />
        </div>
      </div>

      {density > 0 && (nPct > 0 || pPct > 0 || kPct > 0) && (
        <div className="rounded-xl p-3 grid grid-cols-3 gap-2" style={{ backgroundColor: '#FEF3DD' }}>
          <div className="text-center">
            <p className="font-body text-[9px] font-bold uppercase text-amber-700">N lbs/gal</p>
            <p className="font-display text-lg font-bold text-amber-800">{nResult}</p>
          </div>
          <div className="text-center">
            <p className="font-body text-[9px] font-bold uppercase text-amber-700">P lbs/gal</p>
            <p className="font-display text-lg font-bold text-amber-800">{pResult}</p>
          </div>
          <div className="text-center">
            <p className="font-body text-[9px] font-bold uppercase text-amber-700">K lbs/gal</p>
            <p className="font-display text-lg font-bold text-amber-800">{kResult}</p>
          </div>
        </div>
      )}

      <p className="font-body text-[10px] text-amber-500">
        Formula: lbs/gal = density × (% ÷ 100). Both numbers are usually on the product label or Safety Data Sheet (SDS).
      </p>
    </div>
  )
}

// ── AI LABEL READER ───────────────────────────────────────────────────────
// Reads a pesticide/fertilizer label — from uploaded photos or just the product
// name — and fills in the grass-safety fields (plus signal word, active
// ingredient, REI). The user always reviews before it touches the form.
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const s = String(reader.result || '')
      const comma = s.indexOf(',')
      resolve({ media_type: file.type || 'image/jpeg', data: comma >= 0 ? s.slice(comma + 1) : s })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function AiLabelReader({ draft, setDraft, grassTypes = [] }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [imgCount, setImgCount] = useState(0)
  const [images, setImages] = useState([])

  const onPick = async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 4)
    setError('')
    try {
      const encoded = await Promise.all(files.map(fileToBase64))
      setImages(encoded)
      setImgCount(encoded.length)
    } catch {
      setError('Could not read those photos. Try again.')
    }
  }

  const analyze = async () => {
    setError('')
    setResult(null)
    if (!draft.name?.trim() && images.length === 0) {
      setError('Type the product name or add a label photo first.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/analyze-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: draft.name || '', grassTypes, images }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'The AI could not read this. Enter details by hand.')
      } else if (!json.result?.found) {
        setError('The AI could not confidently identify this product. Add a clearer photo, or fill it in by hand.')
        setResult(json.result || null)
      } else {
        setResult(json.result)
      }
    } catch {
      setError('Could not reach the AI service. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const apply = () => {
    if (!result) return
    setDraft((d) => ({
      ...d,
      avoidGrasses: Array.isArray(result.avoidGrasses) ? result.avoidGrasses : (d.avoidGrasses || []),
      activeIngredient: result.activeIngredient || d.activeIngredient || '',
      signalWord: result.signalWord || d.signalWord || '',
      rei: result.rei || d.rei || '',
      phi: result.phi || d.phi || '',
      safetyNote: result.safetyNote || d.safetyNote || '',
    }))
    setResult(null)
    setImages([])
    setImgCount(0)
  }

  return (
    <div className="rounded-xl p-3 border" style={{ backgroundColor: '#F5F3FF', borderColor: '#DDD6FE' }}>
      <div className="flex items-center gap-1.5 mb-1">
        <Sparkles size={14} style={{ color: '#7C3AED' }} />
        <p className="font-body text-[11px] font-bold uppercase tracking-wide" style={{ color: '#7C3AED' }}>Read the label with AI</p>
      </div>
      <p className="font-body text-[10px] text-slate-500 mb-2">
        Snap a photo of the product label (or just use the name above) and the AI fills in grass-safety, signal word and re-entry time. <b>Always double-check against the physical label before you spray.</b>
      </p>
      <div className="flex flex-wrap gap-2">
        <label className="font-body text-xs font-semibold px-3 py-1.5 rounded-full border cursor-pointer flex items-center gap-1.5" style={{ backgroundColor: 'white', color: '#7C3AED', borderColor: '#DDD6FE' }}>
          <CloudUpload size={13} /> {imgCount > 0 ? `${imgCount} photo${imgCount > 1 ? 's' : ''} ready` : 'Add label photo'}
          <input type="file" accept="image/*" multiple capture="environment" onChange={onPick} className="hidden" />
        </label>
        <button type="button" onClick={analyze} disabled={busy} className="font-body text-xs font-bold px-3.5 py-1.5 rounded-full text-white flex items-center gap-1.5 disabled:opacity-60" style={{ backgroundColor: '#7C3AED' }}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {busy ? 'Reading…' : (imgCount > 0 ? 'Read the photo' : 'Look up by name')}
        </button>
      </div>

      {error && <p className="font-body text-[11px] mt-2 font-semibold" style={{ color: '#DC2626' }}>{error}</p>}

      {result && result.found && (
        <div className="mt-3 bg-white rounded-xl p-3 border" style={{ borderColor: '#DDD6FE' }}>
          <p className="font-body text-[11px] font-bold text-slate-700 mb-2">Here's what the AI read — review, then apply:</p>
          <div className="space-y-1.5 font-body text-[11px] text-slate-600">
            {result.activeIngredient ? <div><b>Active ingredient:</b> {result.activeIngredient}</div> : null}
            {result.signalWord ? <div><b>Signal word:</b> {result.signalWord}</div> : null}
            {result.rei ? <div><b>Re-entry (REI):</b> {result.rei}</div> : null}
            <div>
              <b>Avoid on:</b>{' '}
              {Array.isArray(result.avoidGrasses) && result.avoidGrasses.length
                ? result.avoidGrasses.join(', ')
                : <span className="text-slate-400">no grass risk flagged</span>}
            </div>
            {result.safetyNote ? <div className="text-amber-700"><b>Note:</b> {result.safetyNote}</div> : null}
            <div className="text-[10px] text-slate-400">AI confidence: {result.confidence || 'unknown'}</div>
          </div>
          <div className="flex gap-2 mt-3">
            <button type="button" onClick={() => setResult(null)} className="flex-1 py-2 rounded-lg text-[11px] font-semibold font-body text-slate-500 border border-slate-200">Discard</button>
            <button type="button" onClick={apply} className="flex-1 py-2 rounded-lg text-[11px] font-bold font-body text-white" style={{ backgroundColor: '#7C3AED' }}>Apply to form</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── LABELS & SDS ──────────────────────────────────────────────────────────
// Make sure a pasted link has a scheme so it opens as an external site rather
// than a path inside our app.
function normalizeUrl(u) {
  const s = String(u || '').trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s
  return `https://${s}`
}

// Shrink a photo/scan on the device before we store it, so a license copy is a
// small (~100–200 KB) JPEG rather than a multi-megabyte camera image.
function compressImage(file, maxDim = 1400, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        let { width, height } = img
        if (width > maxDim || height > maxDim) {
          if (width >= height) { height = Math.round(height * maxDim / width); width = maxDim }
          else { width = Math.round(width * maxDim / height); height = maxDim }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d').drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.onerror = reject
      img.src = reader.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function DocumentsLibrary({ products, manage, onSaveProduct }) {
  const [q, setQ] = useState('')
  const [missingOnly, setMissingOnly] = useState(false)
  // Local copy of the links so managers can type without a save round-trip per keystroke.
  const [edits, setEdits] = useState({})

  const valOf = (p, field) => (edits[p.name]?.[field] ?? p[field] ?? '')
  const setField = (name, field, v) => setEdits((e) => ({ ...e, [name]: { ...e[name], [field]: v } }))
  const commit = (p, field) => {
    const next = normalizeUrl(valOf(p, field))
    if (next === (p[field] || '')) return
    onSaveProduct?.({ ...p, [field]: next })
  }

  const withDocs = products.filter((p) => p.labelUrl || p.sdsUrl).length
  const filtered = products
    .filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))
    .filter((p) => (missingOnly ? !(p.labelUrl && p.sdsUrl) : true))

  return (
    <div className="pt-6 pb-10">
      <SectionHeader title="Labels & SDS" subtitle="Every product's label and Safety Data Sheet, one tap away" noMargin />

      <div className="bg-white rounded-2xl border border-black/5 p-4 mt-4 mb-4 shadow-sm flex items-center gap-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: '#EFF6FF' }}>
          <ClipboardList size={18} style={{ color: '#2563EB' }} />
        </div>
        <div className="min-w-0">
          <p className="font-body text-sm font-bold text-slate-800">{withDocs} of {products.length} products have documents</p>
          <p className="font-body text-[11px] text-slate-400">{manage ? 'Paste a label or SDS link on any product below — it saves as you go.' : 'Tap a document to open it. Ask a manager to add any that are missing.'}</p>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…" className="flex-1 border border-slate-200 rounded-full px-4 py-2 text-sm font-body bg-white" />
        <button onClick={() => setMissingOnly(!missingOnly)} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition" style={missingOnly ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>
          Missing only
        </button>
      </div>

      <div className="space-y-2">
        {filtered.map((p) => (
          <div key={p.name} className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <p className="font-body font-semibold text-sm text-slate-900 truncate">{p.name}</p>
              <span className="font-body text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0" style={{ backgroundColor: '#F0F6F2', color: FERN }}>{p.type}</span>
            </div>
            {manage ? (
              <div className="grid sm:grid-cols-2 gap-3">
                {[['labelUrl', 'Label link'], ['sdsUrl', 'SDS link']].map(([field, label]) => (
                  <div key={field}>
                    <div className="flex items-center justify-between mb-1">
                      <FieldLabel noMargin>{label}</FieldLabel>
                      {p[field] && <a href={normalizeUrl(p[field])} target="_blank" rel="noopener noreferrer" className="font-body text-[11px] font-bold" style={{ color: '#2563EB' }}>Open ↗</a>}
                    </div>
                    <input value={valOf(p, field)} onChange={(e) => setField(p.name, field, e.target.value)} onBlur={() => commit(p, field)} placeholder="https://…" inputMode="url" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-body bg-white" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex gap-2">
                {[['labelUrl', 'Label'], ['sdsUrl', 'SDS']].map(([field, label]) => (
                  p[field] ? (
                    <a key={field} href={normalizeUrl(p[field])} target="_blank" rel="noopener noreferrer" className="flex-1 text-center font-body text-xs font-bold px-3 py-2.5 rounded-xl text-white" style={{ backgroundColor: '#2563EB' }}>Open {label} ↗</a>
                  ) : (
                    <span key={field} className="flex-1 text-center font-body text-xs font-semibold px-3 py-2.5 rounded-xl text-slate-400 bg-slate-50">No {label} yet</span>
                  )
                ))}
              </div>
            )}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="bg-white rounded-2xl border border-black/5 p-8 text-center text-slate-400 font-body text-sm">No products match.</div>
        )}
      </div>
    </div>
  )
}

// ── CHEMICAL LIBRARY ──────────────────────────────────────────────────────
function ChemicalLibrary({ products, grassTypes = [], onSaveProduct, onDeleteProduct, onImport }) {
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState(null)
  const [filter, setFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [importPreview, setImportPreview] = useState(null) // { products, columns, count, error, fileName }
  const [importing, setImporting] = useState(false)
  const fileRef = useRef(null)
  const editRef = useRef(null)

  // When the editor opens, scroll it into view — it renders above the list, so
  // editing a product far down would otherwise leave the form off-screen.
  useEffect(() => {
    if (editing && editRef.current) editRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [editing])

  const pickFile = () => fileRef.current?.click()
  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    try {
      const { parseChemicalLibrary } = await import('@/lib/importXlsx')
      const buf = await file.arrayBuffer()
      const res = parseChemicalLibrary(buf)
      setImportPreview({ ...res, fileName: file.name })
    } catch (err) {
      setImportPreview({ products: [], columns: [], count: 0, error: 'Could not read that file. Make sure it is a .xlsx or .xls spreadsheet.', fileName: file.name })
    }
  }
  const downloadTemplate = async () => {
    const XLSX = await import('xlsx')
    const headers = ['Name', 'Type', 'Active Ingredient', 'Active %', 'Chemical Group', 'Rotate After (days)', 'Rate', 'Basis', 'Unit', 'Label Min /M', 'Label Max /M', 'Label Min /A', 'Label Max /A', 'Stock', 'Low Stock', 'N', 'P', 'K', 'Case Size', 'Oz/Case', 'Cost/Case', 'Label link', 'SDS link', 'Avoid Grasses']
    const example = ['Daconil Action', 'Fungicide', 'Chlorothalonil + Acibenzolar-S-methyl', 20.3, 'M05', 14, 1.8, 'oz / M', 'oz', 1.8, 3.6, '', '', 0, 0, '', '', '', '2.5 Gal', 320, 240, 'https://example.com/label.pdf', 'https://example.com/sds.pdf', 'Bentgrass, Poa Annua']
    const ws = XLSX.utils.aoa_to_sheet([headers, example])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Chemical Library')
    XLSX.writeFile(wb, 'chemical-library-template.xlsx')
  }
  const confirmImport = async () => {
    if (!importPreview?.products?.length) return
    setImporting(true)
    try {
      await onImport(importPreview.products)
      setImportPreview(null)
    } catch (err) {
      setImportPreview((prev) => ({ ...prev, error: 'Could not save the import. Try again.' }))
    }
    setImporting(false)
  }

  const startEdit = (p) => {
    setEditing(p.name)
    setDraft({ ...p })
  }
  const startNew = () => {
    setEditing('new')
    setDraft({ name: '', type: 'Fungicide', rate: '', basis: 'oz / M', unit: 'oz', labelMaxM: '', labelMaxA: '', labelMinM: '', labelMinA: '', stock: '', lowStockThreshold: '', fertForm: 'granular', n: '', p: '', k: '', nPerGal: '', pPerGal: '', kPerGal: '', avoidGrasses: [], labelUrl: '', sdsUrl: '', activeIngredient: '', activePct: '', caseSize: '', ozPerCase: '', costPerCase: '', moaGroup: '', rotationDays: '', sprayInterval: '' })
  }
  const cancelEdit = () => { setEditing(null); setDraft(null) }

  const saveDraft = () => {
    if (!draft.name.trim()) return
    const cleaned = {
      ...draft,
      rate: draft.rate === '' ? null : parseFloat(draft.rate),
      labelMaxM: draft.labelMaxM === '' ? null : parseFloat(draft.labelMaxM),
      labelMaxA: draft.labelMaxA === '' ? null : parseFloat(draft.labelMaxA),
      labelMinM: draft.labelMinM === '' ? null : parseFloat(draft.labelMinM),
      labelMinA: draft.labelMinA === '' ? null : parseFloat(draft.labelMinA),
      stock: draft.stock === '' || draft.stock == null ? 0 : parseFloat(draft.stock),
      lowStockThreshold: draft.lowStockThreshold === '' || draft.lowStockThreshold == null ? 0 : parseFloat(draft.lowStockThreshold),
      n: draft.n === '' || draft.n == null ? 0 : parseFloat(draft.n),
      p: draft.p === '' || draft.p == null ? 0 : parseFloat(draft.p),
      k: draft.k === '' || draft.k == null ? 0 : parseFloat(draft.k),
      fertForm: draft.fertForm || 'granular',
      nPerGal: draft.nPerGal === '' || draft.nPerGal == null ? 0 : parseFloat(draft.nPerGal),
      pPerGal: draft.pPerGal === '' || draft.pPerGal == null ? 0 : parseFloat(draft.pPerGal),
      kPerGal: draft.kPerGal === '' || draft.kPerGal == null ? 0 : parseFloat(draft.kPerGal),
      activePct: draft.activePct === '' || draft.activePct == null ? null : parseFloat(draft.activePct),
      ozPerCase: draft.ozPerCase === '' || draft.ozPerCase == null ? null : parseFloat(draft.ozPerCase),
      costPerCase: draft.costPerCase === '' || draft.costPerCase == null ? null : parseFloat(draft.costPerCase),
      moaGroup: (draft.moaGroup || '').trim(),
      rotationDays: draft.rotationDays === '' || draft.rotationDays == null ? null : parseInt(draft.rotationDays, 10),
      sprayInterval: draft.sprayInterval === '' || draft.sprayInterval == null ? null : parseInt(draft.sprayInterval, 10),
    }
    onSaveProduct(cleaned)
    cancelEdit()
  }

  const q = search.trim().toLowerCase()
  const filtered = products.filter((p) => {
    if (filter !== 'All' && p.type !== filter) return false
    if (!q) return true
    return (
      String(p.name || '').toLowerCase().includes(q) ||
      String(p.activeIngredient || '').toLowerCase().includes(q) ||
      String(p.moaGroup || '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="pt-6 pb-10">
      <div className="flex items-center justify-between mb-1 gap-2">
        <SectionHeader title="Chemical Library" subtitle="Manage products, rates, and label maximums" noMargin />
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={pickFile} className="font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5 border" style={{ color: FOREST, borderColor: FOREST, backgroundColor: 'white' }}>
            <CloudUpload size={14} /> Import Excel
          </button>
          <button onClick={startNew} className="font-body text-xs font-bold px-3.5 py-2 rounded-full text-white flex items-center gap-1.5" style={{ backgroundColor: FOREST }}>
            <Plus size={14} /> Add Product
          </button>
        </div>
      </div>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={onFile} className="hidden" />
      <p className="font-body text-[11px] text-slate-400 mt-1.5">
        First time importing? <button onClick={downloadTemplate} className="font-bold underline" style={{ color: FERN }}>Download a blank template</button> with the right columns, fill it in, then import it.
      </p>

      {importPreview && (
        <div className="bg-white rounded-2xl border-2 p-4 mt-4 mb-2 shadow-sm" style={{ borderColor: GOLD }}>
          <p className="font-display text-base font-semibold text-slate-900 mb-1">Import from “{importPreview.fileName}”</p>
          {importPreview.error ? (
            <p className="font-body text-sm text-red-600 mt-1">{importPreview.error}</p>
          ) : (
            <>
              <p className="font-body text-sm text-slate-600">
                Found <b>{importPreview.count}</b> product{importPreview.count !== 1 ? 's' : ''}. Columns recognized:
              </p>
              <div className="flex flex-wrap gap-1.5 my-2">
                {importPreview.columns.map((c) => (
                  <span key={c} className="font-body text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#F0F6F2', color: FERN }}>{c}</span>
                ))}
              </div>
              <p className="font-body text-[11px] text-slate-400">
                Matched to existing products by name — those get updated, new names get added. Any column you left out of the sheet keeps its current value. Nothing is deleted.
              </p>
            </>
          )}
          <div className="flex gap-2 pt-3">
            <button onClick={() => setImportPreview(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold font-body text-slate-500 border border-slate-200">Cancel</button>
            {!importPreview.error && importPreview.count > 0 && (
              <button onClick={confirmImport} disabled={importing} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body text-white disabled:opacity-60 flex items-center justify-center gap-2" style={{ backgroundColor: FOREST }}>
                {importing ? <Loader2 size={15} className="animate-spin" /> : null}
                {importing ? 'Importing…' : `Import ${importPreview.count} product${importPreview.count !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="relative mt-4 mb-3">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products by name, active ingredient, or FRAC group…"
          className="w-full border border-slate-200 rounded-full pl-9 pr-9 py-2.5 text-sm font-body bg-white"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="Clear search">
            <X size={15} />
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {['All', ...PRODUCT_TYPES].map((t) => (
          <button key={t} onClick={() => setFilter(t)} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition" style={filter === t ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>
            {t}
          </button>
        ))}
      </div>

      {editing && draft && (
        <div ref={editRef} className="bg-white rounded-2xl border-2 p-4 mb-4 shadow-sm scroll-mt-4" style={{ borderColor: GOLD }}>
          <p className="font-display text-base font-semibold text-slate-900 mb-3">{editing === 'new' ? 'Add New Chemical' : `Edit ${editing}`}</p>
          <div className="space-y-3">
            <div>
              <FieldLabel>Product Name</FieldLabel>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} disabled={editing !== 'new'} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body disabled:bg-slate-50 disabled:text-slate-400" />
            </div>
            {/* AI label reader is switched off (costs pennies per scan). To turn
                it back on, uncomment the line below — no other setup needed once
                ANTHROPIC_API_KEY is in Vercel.
            <AiLabelReader draft={draft} setDraft={setDraft} grassTypes={grassTypes} /> */}
            <div className="grid grid-cols-2 gap-3">
              <div><FieldLabel>Type</FieldLabel><Select value={draft.type} onChange={(v) => setDraft({ ...draft, type: v })} options={PRODUCT_TYPES} /></div>
              <div><FieldLabel>Default Unit</FieldLabel><Select value={draft.unit} onChange={(v) => setDraft({ ...draft, unit: v })} options={UNITS} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>Default Rate</FieldLabel>
                <input type="number" step="any" value={draft.rate ?? ''} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" placeholder="e.g. 1.8" />
              </div>
              <div><FieldLabel>Default Basis</FieldLabel><Select value={draft.basis} onChange={(v) => setDraft({ ...draft, basis: v })} options={BASIS_OPTIONS} /></div>
            </div>
            <div className="rounded-xl p-3" style={{ backgroundColor: '#FEF2F2' }}>
              <p className="font-body text-[11px] font-bold text-red-500 uppercase tracking-wide mb-2">Label Rate Range</p>
              <p className="font-body text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Per 1,000 sq ft</p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <FieldLabel>Min</FieldLabel>
                  <input type="number" step="any" value={draft.labelMinM ?? ''} onChange={(e) => setDraft({ ...draft, labelMinM: e.target.value })} className="w-full border border-red-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="Optional" />
                </div>
                <div>
                  <FieldLabel>Max</FieldLabel>
                  <input type="number" step="any" value={draft.labelMaxM ?? ''} onChange={(e) => setDraft({ ...draft, labelMaxM: e.target.value })} className="w-full border border-red-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="Optional" />
                </div>
              </div>
              <p className="font-body text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Per Acre</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Min</FieldLabel>
                  <input type="number" step="any" value={draft.labelMinA ?? ''} onChange={(e) => setDraft({ ...draft, labelMinA: e.target.value })} className="w-full border border-red-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="Optional" />
                </div>
                <div>
                  <FieldLabel>Max</FieldLabel>
                  <input type="number" step="any" value={draft.labelMaxA ?? ''} onChange={(e) => setDraft({ ...draft, labelMaxA: e.target.value })} className="w-full border border-red-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="Optional" />
                </div>
              </div>
              <p className="font-body text-[10px] text-red-400 mt-2">Leave blank if not applicable. Rates outside this range show a red warning on spray sheets.</p>
            </div>
            {draft.type === 'Fertilizer' && (
              <div className="rounded-xl p-3" style={{ backgroundColor: '#FFFBF0' }}>
                <div className="flex items-center justify-between mb-2">
                  <p className="font-body text-[11px] font-bold uppercase tracking-wide" style={{ color: '#92660D' }}>N-P-K Analysis</p>
                  <div className="flex rounded-full overflow-hidden border border-amber-200">
                    <button onClick={() => setDraft({ ...draft, fertForm: 'granular' })} className="font-body text-[10px] font-bold px-2.5 py-1 transition" style={draft.fertForm !== 'liquid' ? { backgroundColor: '#92660D', color: 'white' } : { backgroundColor: 'white', color: '#92660D' }}>
                      Granular
                    </button>
                    <button onClick={() => setDraft({ ...draft, fertForm: 'liquid' })} className="font-body text-[10px] font-bold px-2.5 py-1 transition" style={draft.fertForm === 'liquid' ? { backgroundColor: '#92660D', color: 'white' } : { backgroundColor: 'white', color: '#92660D' }}>
                      Liquid
                    </button>
                  </div>
                </div>

                {draft.fertForm === 'liquid' ? (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-body text-[10px] font-semibold text-amber-700">
                        {draft.useCalculator ? 'Calculate from density + %' : 'Enter lbs/gal directly'}
                      </p>
                      <button onClick={() => setDraft({ ...draft, useCalculator: !draft.useCalculator })} className="font-body text-[10px] font-bold underline" style={{ color: '#92660D' }}>
                        {draft.useCalculator ? 'Switch to direct entry' : 'Calculate it for me'}
                      </button>
                    </div>

                    {draft.useCalculator ? (
                      <LiquidFertCalculator draft={draft} setDraft={setDraft} />
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <FieldLabel>N lbs/gal</FieldLabel>
                          <input type="number" step="any" value={draft.nPerGal ?? ''} onChange={(e) => setDraft({ ...draft, nPerGal: e.target.value })} className="w-full border border-amber-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="e.g. 3" />
                        </div>
                        <div>
                          <FieldLabel>P lbs/gal</FieldLabel>
                          <input type="number" step="any" value={draft.pPerGal ?? ''} onChange={(e) => setDraft({ ...draft, pPerGal: e.target.value })} className="w-full border border-amber-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="e.g. 0" />
                        </div>
                        <div>
                          <FieldLabel>K lbs/gal</FieldLabel>
                          <input type="number" step="any" value={draft.kPerGal ?? ''} onChange={(e) => setDraft({ ...draft, kPerGal: e.target.value })} className="w-full border border-amber-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="e.g. 0" />
                        </div>
                      </div>
                    )}

                    <p className="font-body text-[10px] text-amber-600 mt-2">
                      {draft.useCalculator
                        ? 'Type the density and guaranteed analysis % from the label — the lbs/gal figures are calculated automatically.'
                        : 'Use the lbs-of-nutrient-per-gallon figure printed on the label.'}
                      {' '}Rate must be entered in gal/M or gal/A.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <FieldLabel>N %</FieldLabel>
                        <input type="number" step="any" value={draft.n ?? ''} onChange={(e) => setDraft({ ...draft, n: e.target.value })} className="w-full border border-amber-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="e.g. 21" />
                      </div>
                      <div>
                        <FieldLabel>P %</FieldLabel>
                        <input type="number" step="any" value={draft.p ?? ''} onChange={(e) => setDraft({ ...draft, p: e.target.value })} className="w-full border border-amber-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="e.g. 0" />
                      </div>
                      <div>
                        <FieldLabel>K %</FieldLabel>
                        <input type="number" step="any" value={draft.k ?? ''} onChange={(e) => setDraft({ ...draft, k: e.target.value })} className="w-full border border-amber-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="e.g. 0" />
                      </div>
                    </div>
                    <p className="font-body text-[10px] text-amber-600 mt-2">From the bag label, e.g. 21-0-0 Urea = N 21, P 0, K 0. Rate must be entered in lbs/M or lbs/A.</p>
                  </>
                )}
              </div>
            )}

            <div className="rounded-xl p-3" style={{ backgroundColor: '#F0F6F2' }}>
              <p className="font-body text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: FERN }}>Inventory</p>
              <p className="font-body text-[10px] text-slate-500 mb-2">
                Stock is tracked in <b style={{ color: FERN }}>{draft.unit || 'oz'}</b> — set above in Default Unit. Change it there if this is wrong.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Current Stock ({draft.unit || 'oz'})</FieldLabel>
                  <div className="relative">
                    <input type="number" step="any" value={draft.stock ?? ''} onChange={(e) => setDraft({ ...draft, stock: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 pr-12 text-sm font-body bg-white" placeholder="0" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 font-body text-xs font-semibold text-slate-400">{draft.unit || 'oz'}</span>
                  </div>
                </div>
                <div>
                  <FieldLabel>Low Stock Alert Below</FieldLabel>
                  <div className="relative">
                    <input type="number" step="any" value={draft.lowStockThreshold ?? ''} onChange={(e) => setDraft({ ...draft, lowStockThreshold: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 pr-12 text-sm font-body bg-white" placeholder="0 = no alert" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 font-body text-xs font-semibold text-slate-400">{draft.unit || 'oz'}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="rounded-xl p-3" style={{ backgroundColor: '#F0FDF4' }}>
              <p className="font-body text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: '#15803D' }}>Ordering — for Early Order totals</p>
              <p className="font-body text-[10px] text-slate-500 mb-2">How this product is packaged and priced, so the Annual Program can estimate cases and cost to order.</p>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <FieldLabel>Case size</FieldLabel>
                  <input value={draft.caseSize ?? ''} onChange={(e) => setDraft({ ...draft, caseSize: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="4 x 1 Gal" />
                </div>
                <div>
                  <FieldLabel>Oz / case</FieldLabel>
                  <input type="number" step="any" value={draft.ozPerCase ?? ''} onChange={(e) => setDraft({ ...draft, ozPerCase: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="512" />
                </div>
                <div>
                  <FieldLabel>Cost / case</FieldLabel>
                  <input type="number" step="any" value={draft.costPerCase ?? ''} onChange={(e) => setDraft({ ...draft, costPerCase: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="$" />
                </div>
              </div>
            </div>
            <div className="rounded-xl p-3" style={{ backgroundColor: '#F8FAFC' }}>
              <p className="font-body text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: '#475569' }}>Label Facts</p>
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <FieldLabel>Active Ingredient</FieldLabel>
                    <input value={draft.activeIngredient ?? ''} onChange={(e) => setDraft({ ...draft, activeIngredient: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="e.g. Azoxystrobin" />
                  </div>
                  <div>
                    <FieldLabel>Active %</FieldLabel>
                    <input type="number" step="any" value={draft.activePct ?? ''} onChange={(e) => setDraft({ ...draft, activePct: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="e.g. 20.3" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldLabel>Signal Word</FieldLabel>
                    <Select value={draft.signalWord || ''} onChange={(v) => setDraft({ ...draft, signalWord: v })} options={['', 'Caution', 'Warning', 'Danger']} />
                  </div>
                  <div>
                    <FieldLabel>Re-entry (REI)</FieldLabel>
                    <input value={draft.rei ?? ''} onChange={(e) => setDraft({ ...draft, rei: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="e.g. 12 hours" />
                  </div>
                </div>
              </div>
            </div>
            <div className="rounded-xl p-3" style={{ backgroundColor: '#F5F3FF' }}>
              <p className="font-body text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: '#7C3AED' }}>Resistance / Rotation</p>
              <p className="font-body text-[10px] text-slate-500 mb-2">The chemical group (FRAC for fungicides, HRAC herbicides, IRAC insecticides). The app warns if you spray the same group on an area again too soon.</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Chemical Group</FieldLabel>
                  <input value={draft.moaGroup ?? ''} onChange={(e) => setDraft({ ...draft, moaGroup: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="e.g. 11, P07, Group 4" />
                </div>
                <div>
                  <FieldLabel>Rotate After (days)</FieldLabel>
                  <input type="number" step="1" value={draft.rotationDays ?? ''} onChange={(e) => setDraft({ ...draft, rotationDays: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="21" />
                </div>
              </div>
            </div>
            {draft.type === 'Fungicide' && (
              <div className="rounded-xl p-3" style={{ backgroundColor: '#EAF3EE' }}>
                <p className="font-body text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: FERN }}>Disease Protection</p>
                <p className="font-body text-[10px] text-slate-500 mb-2">How many days this fungicide holds off disease. The Dashboard shows a shrinking bar per area and flags you before protection runs out. Leave blank to use the rotation days or a 14-day default.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldLabel>Spray Interval (days)</FieldLabel>
                    <input type="number" step="1" value={draft.sprayInterval ?? ''} onChange={(e) => setDraft({ ...draft, sprayInterval: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="14" />
                  </div>
                </div>
              </div>
            )}
            <div className="rounded-xl p-3" style={{ backgroundColor: '#FEF2F2' }}>
              <p className="font-body text-[11px] font-bold text-red-500 uppercase tracking-wide mb-1">Grass Safety — Avoid On</p>
              <p className="font-body text-[10px] text-slate-500 mb-2">Select grasses this product can damage (from the label). A spray sheet warns if the area has one of these.</p>
              <div className="flex flex-wrap gap-2">
                {grassTypes.map((g) => {
                  const on = (draft.avoidGrasses || []).includes(g)
                  return (
                    <button key={g} type="button" onClick={() => setDraft({ ...draft, avoidGrasses: on ? (draft.avoidGrasses || []).filter((x) => x !== g) : [...(draft.avoidGrasses || []), g] })} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full transition border" style={on ? { backgroundColor: '#DC2626', color: 'white', borderColor: '#DC2626' } : { backgroundColor: 'white', color: '#64748B', borderColor: '#E2E8F0' }}>
                      {g}
                    </button>
                  )
                })}
                {grassTypes.length === 0 && <p className="font-body text-xs text-slate-400">Add grass types in Settings → Lists first.</p>}
              </div>
            </div>

            <div className="rounded-xl p-3" style={{ backgroundColor: '#EFF6FF' }}>
              <p className="font-body text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: '#2563EB' }}>Documents — Label & SDS</p>
              <p className="font-body text-[10px] text-slate-500 mb-2">Paste the web link to this product's label and Safety Data Sheet. The crew can open them from the spray sheet and the Labels &amp; SDS screen.</p>
              <div className="space-y-2">
                <div>
                  <FieldLabel>Label link</FieldLabel>
                  <input value={draft.labelUrl ?? ''} onChange={(e) => setDraft({ ...draft, labelUrl: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="https://…" inputMode="url" />
                </div>
                <div>
                  <FieldLabel>SDS link</FieldLabel>
                  <input value={draft.sdsUrl ?? ''} onChange={(e) => setDraft({ ...draft, sdsUrl: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="https://…" inputMode="url" />
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={cancelEdit} className="flex-1 py-2.5 rounded-xl text-sm font-semibold font-body text-slate-500 border border-slate-200">Cancel</button>
              <button onClick={saveDraft} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body text-white" style={{ backgroundColor: FOREST }}>Save Product</button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((p) => (
          <div key={p.name} className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-body font-semibold text-sm text-slate-900 truncate">{p.name}</p>
                <span className="font-body text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0" style={{ backgroundColor: '#F0F6F2', color: FERN }}>{p.type}</span>
              </div>
              <div className="flex items-center gap-3 mt-1 font-body text-[11px] text-slate-400 flex-wrap">
                <span>{p.rate ?? '—'} {p.basis}</span>
                {(p.labelMaxM || p.labelMaxA || p.labelMinM || p.labelMinA) && (
                  <span className="text-red-400 font-medium">
                    Range: {(p.labelMinM || p.labelMaxM) ? `${p.labelMinM ?? '—'}–${p.labelMaxM ?? '—'} oz/M` : ''}
                    {(p.labelMinM || p.labelMaxM) && (p.labelMinA || p.labelMaxA) ? ' · ' : ''}
                    {(p.labelMinA || p.labelMaxA) ? `${p.labelMinA ?? '—'}–${p.labelMaxA ?? '—'} oz/A` : ''}
                  </span>
                )}
                <span className="font-semibold" style={{ color: p.lowStockThreshold > 0 && (p.stock || 0) <= p.lowStockThreshold ? '#DC2626' : '#94A3B8' }}>
                  Stock: {p.stock ?? 0} {p.unit}
                  {p.lowStockThreshold > 0 && (p.stock || 0) <= p.lowStockThreshold && ' ⚠ Low'}
                </span>
              </div>
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => startEdit(p)} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full" style={{ backgroundColor: '#F0F6F2', color: FERN }}>Edit</button>
              <button onClick={() => onDeleteProduct(p.name)} className="text-red-400 p-1.5"><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="bg-white rounded-2xl border border-black/5 p-10 text-center text-slate-400 font-body text-sm">
            {q ? `No products match “${search.trim()}”.` : 'No products in this category yet.'}
          </div>
        )}
      </div>
    </div>
  )
}

// ── INVENTORY ─────────────────────────────────────────────────────────────
function Inventory({ products, deliveries, onAddDelivery }) {
  const [showForm, setShowForm] = useState(false)
  const [draft, setDraft] = useState({ product: '', qty: '', unit: 'oz', supplier: '', date: new Date().toISOString().slice(0, 10) })
  const [filter, setFilter] = useState('All')

  const lowStock = products.filter((p) => p.lowStockThreshold > 0 && (p.stock || 0) <= p.lowStockThreshold)
  const filtered = filter === 'All' ? products : products.filter((p) => p.type === filter)

  const submitDelivery = () => {
    if (!draft.product || !draft.qty) return
    onAddDelivery(draft)
    setDraft({ product: '', qty: '', unit: 'oz', supplier: '', date: new Date().toISOString().slice(0, 10) })
    setShowForm(false)
  }

  const handleProductPick = (name) => {
    const p = products.find((pr) => pr.name === name)
    setDraft({ ...draft, product: name, unit: p?.unit || 'oz' })
  }

  return (
    <div className="pt-6 pb-10">
      <div className="flex items-center justify-between mb-1">
        <SectionHeader title="Inventory" subtitle="Stock on hand, deliveries, and usage" noMargin />
        <button onClick={() => setShowForm(!showForm)} className="font-body text-xs font-bold px-3.5 py-2 rounded-full text-white flex items-center gap-1.5 shrink-0" style={{ backgroundColor: FOREST }}>
          <Truck size={14} /> Log Delivery
        </button>
      </div>

      {lowStock.length > 0 && (
        <div className="bg-red-50 rounded-2xl border border-red-100 p-4 mt-4 flex items-start gap-3">
          <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={16} />
          <div>
            <p className="font-body text-sm font-semibold text-red-700">{lowStock.length} product{lowStock.length !== 1 ? 's' : ''} running low</p>
            <p className="font-body text-xs text-red-500 mt-0.5">{lowStock.map((p) => p.name).join(', ')}</p>
          </div>
        </div>
      )}

      {showForm && (
        <div className="bg-white rounded-2xl border-2 p-4 mt-4 shadow-sm" style={{ borderColor: GOLD }}>
          <p className="font-display text-base font-semibold text-slate-900 mb-3">Log a Delivery</p>
          <div className="space-y-3">
            <div>
              <FieldLabel>Product</FieldLabel>
              <select value={draft.product} onChange={(e) => handleProductPick(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white">
                <option value="">Select product...</option>
                {products.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>Quantity Received</FieldLabel>
                <input type="number" step="any" value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" placeholder="e.g. 32" />
              </div>
              <div>
                <FieldLabel>Unit</FieldLabel>
                <Select value={draft.unit} onChange={(v) => setDraft({ ...draft, unit: v })} options={UNITS} />
              </div>
            </div>
            {draft.product && draft.qty && (() => {
              const p = products.find((pr) => pr.name === draft.product)
              if (!p) return null
              if (draft.unit === p.unit) return null
              if (!unitsAreCompatible(draft.unit, p.unit)) {
                return (
                  <p className="font-body text-[11px] font-semibold text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                    ⚠ This product tracks stock in {p.unit}, but you're logging {draft.unit} — these can't be converted automatically without density. Stock will be added as a raw number; double check it.
                  </p>
                )
              }
              const converted = convertUnits(Number(draft.qty), draft.unit, p.unit)
              return (
                <p className="font-body text-[11px] font-semibold text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">
                  ✓ Converts automatically: {draft.qty} {draft.unit} = {converted} {p.unit} added to stock. The product's rate display stays in {p.unit} — only this delivery is logged in {draft.unit}.
                </p>
              )
            })()}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>Date</FieldLabel>
                <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
              </div>
              <div>
                <FieldLabel>Supplier (optional)</FieldLabel>
                <input value={draft.supplier} onChange={(e) => setDraft({ ...draft, supplier: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" placeholder="e.g. Site One" />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold font-body text-slate-500 border border-slate-200">Cancel</button>
              <button onClick={submitDelivery} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body text-white" style={{ backgroundColor: FOREST }}>Add to Stock</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2 mt-5 mb-3 overflow-x-auto pb-1">
        {['All', ...PRODUCT_TYPES].map((t) => (
          <button key={t} onClick={() => setFilter(t)} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition" style={filter === t ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>
            {t}
          </button>
        ))}
      </div>

      <p className="font-body text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Stock on Hand</p>
      <div className="space-y-2 mb-6">
        {filtered.map((p) => {
          const low = p.lowStockThreshold > 0 && (p.stock || 0) <= p.lowStockThreshold
          return (
            <div key={p.name} className="bg-white rounded-2xl border p-4 shadow-sm flex items-center justify-between" style={{ borderColor: low ? '#FCA5A5' : 'rgba(0,0,0,0.05)' }}>
              <div>
                <p className="font-body font-semibold text-sm text-slate-900">{p.name}</p>
                <p className="font-body text-[11px] text-slate-400">{p.type}</p>
              </div>
              <div className="text-right">
                <p className="font-display text-xl font-bold" style={{ color: low ? '#DC2626' : FOREST }}>{p.stock ?? 0} <span className="text-xs font-body font-medium text-slate-400">{p.unit}</span></p>
                {low && <p className="font-body text-[10px] font-bold text-red-500">LOW STOCK</p>}
              </div>
            </div>
          )
        })}
      </div>

      <p className="font-body text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Recent Deliveries</p>
      {deliveries.length === 0 ? (
        <div className="bg-white rounded-2xl border border-black/5 p-8 text-center text-slate-400 font-body text-sm">No deliveries logged yet.</div>
      ) : (
        <div className="bg-white rounded-2xl border border-black/5 overflow-hidden shadow-sm">
          {deliveries.slice(0, 15).map((d, i) => (
            <div key={d.id} className={`flex items-center justify-between px-4 py-3 ${i !== 0 ? 'border-t border-black/5' : ''}`}>
              <div>
                <p className="font-body text-sm font-semibold text-slate-800">{d.product}</p>
                <p className="font-body text-[11px] text-slate-400">{d.date}{d.supplier ? ` · ${d.supplier}` : ''}</p>
              </div>
              <p className="font-body text-sm font-bold" style={{ color: FERN }}>+{d.qty} {d.unit}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── REPORTS ───────────────────────────────────────────────────────────────
function Reports({ sheets, products, areas }) {
  const [view, setView] = useState('byArea')
  const [report, setReport] = useState('npk') // 'npk' | 'rotation'
  const npkData = aggregateNPK(sheets, products, areas)

  const totalN = Math.round(npkData.reduce((s, r) => s + r.n, 0) * 100) / 100
  const totalP = Math.round(npkData.reduce((s, r) => s + r.p, 0) * 100) / 100
  const totalK = Math.round(npkData.reduce((s, r) => s + r.k, 0) * 100) / 100

  const diag = npkDiagnostics(sheets, products, areas)
  const diagItems = [
    diag.missingAnalysis.length && { title: 'Missing N-P-K analysis', fix: 'Open Chemical Library → edit each product → fill in the N %, P %, K % from the bag (e.g. 21-0-0 = N 21). Until then it counts as zero.', items: diag.missingAnalysis },
    diag.unapprovedSheets.length && { title: 'Sheets not approved yet', fix: 'Reports only count approved sheets. A director needs to approve these for their fertilizer to show.', items: diag.unapprovedSheets },
    diag.missingSqft.length && { title: 'Areas missing square footage', fix: 'Set the area size in Settings → Areas. Without it, the app can\'t work out pounds applied.', items: diag.missingSqft },
    diag.basisIssue.length && { title: 'Check the rate basis', fix: 'These fertilizers use a rate basis that doesn\'t match their form — granular needs lbs/M or lbs/A; liquid needs gal/M or gal/A. Fix the basis on the sheet or in the library.', items: diag.basisIssue },
  ].filter(Boolean)

  const byArea = {}
  npkData.forEach((r) => {
    if (!byArea[r.area]) byArea[r.area] = { area: r.area, n: 0, p: 0, k: 0, sqft: r.sqft, months: [] }
    byArea[r.area].n += r.n; byArea[r.area].p += r.p; byArea[r.area].k += r.k
    byArea[r.area].months.push(r)
  })
  const areaRows = Object.values(byArea).map((a) => {
    const perM = a.sqft > 0 ? a.sqft / 1000 : 0
    return {
      ...a, n: Math.round(a.n * 100) / 100, p: Math.round(a.p * 100) / 100, k: Math.round(a.k * 100) / 100,
      nPerM: perM > 0 ? Math.round((a.n / perM) * 1000) / 1000 : null,
      pPerM: perM > 0 ? Math.round((a.p / perM) * 1000) / 1000 : null,
      kPerM: perM > 0 ? Math.round((a.k / perM) * 1000) / 1000 : null,
    }
  })

  const byMonth = {}
  npkData.forEach((r) => {
    if (!byMonth[r.month]) byMonth[r.month] = { month: r.month, n: 0, p: 0, k: 0, areas: [] }
    byMonth[r.month].n += r.n; byMonth[r.month].p += r.p; byMonth[r.month].k += r.k
    byMonth[r.month].areas.push(r)
  })
  const monthRows = Object.values(byMonth)
    .map((m) => ({ ...m, n: Math.round(m.n * 100) / 100, p: Math.round(m.p * 100) / 100, k: Math.round(m.k * 100) / 100 }))
    .sort((a, b) => b.month.localeCompare(a.month))

  const exportCSV = () => {
    const rows = [['Area', 'Month', 'N (lbs)', 'P (lbs)', 'K (lbs)', 'N per 1000 sqft', 'P per 1000 sqft', 'K per 1000 sqft', 'Approved Sheets']]
    npkData.forEach((r) => rows.push([r.area, r.month, r.n, r.p, r.k, r.nPerM ?? '', r.pPerM ?? '', r.kPerM ?? '', r.sheetCount]))
    downloadCSV(rows, `NPK_Totals_${new Date().toISOString().slice(0, 10)}.csv`)
  }

  return (
    <div className="pt-6 pb-10">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <SectionHeader title="Reports" subtitle="Nutrients and chemical rotation, pulled from your sprays" noMargin />
        {report === 'npk' && (
          <button onClick={exportCSV} className="font-body text-xs font-bold px-3.5 py-2 rounded-full text-white flex items-center gap-1.5 shrink-0" style={{ backgroundColor: FOREST }}>
            <Package size={14} /> Export Spreadsheet
          </button>
        )}
      </div>

      <div className="flex gap-2 mt-4 mb-1 overflow-x-auto pb-1">
        {[['npk', 'Nutrients'], ['cost', 'Cost'], ['rotation', 'Rotation'], ['usage', 'Product Usage'], ['history', 'Spray History'], ['since', 'Days Since']].map(([k, l]) => (
          <button key={k} onClick={() => setReport(k)} className="font-body text-xs font-bold px-3.5 py-2 rounded-full whitespace-nowrap transition" style={report === k ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>
            {l}
          </button>
        ))}
      </div>

      {report === 'cost' && <CostReport sheets={sheets} products={products} areas={areas} />}
      {report === 'rotation' && <RotationReport sheets={sheets} products={products} />}
      {report === 'usage' && <ProductUsageReport sheets={sheets} products={products} areas={areas} />}
      {report === 'history' && <SprayHistoryReport sheets={sheets} />}
      {report === 'since' && <DaysSinceReport sheets={sheets} />}

      {report === 'npk' && (<>
      <div className="grid grid-cols-3 gap-3 mt-5 mb-5">
        <NPKStat label="Total N" value={totalN} color="#2563EB" />
        <NPKStat label="Total P" value={totalP} color="#D97706" />
        <NPKStat label="Total K" value={totalK} color="#7C3AED" />
      </div>

      {diagItems.length > 0 && (
        <div className="bg-amber-50 rounded-2xl border border-amber-200 p-4 mb-4">
          <div className="flex items-start gap-2 mb-2">
            <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={16} />
            <p className="font-body text-sm font-bold text-amber-800">Some fertilizer isn't counting — here's why</p>
          </div>
          <div className="space-y-3">
            {diagItems.map((d) => (
              <div key={d.title}>
                <p className="font-body text-[13px] font-bold text-amber-800">{d.title}</p>
                <p className="font-body text-[11px] text-amber-700 mb-1">{d.fix}</p>
                <div className="flex flex-wrap gap-1.5">
                  {d.items.map((it) => (
                    <span key={it} className="font-body text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white text-amber-700 border border-amber-200">{it}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        {[['byArea', 'By Area'], ['byMonth', 'By Month']].map(([k, l]) => (
          <button key={k} onClick={() => setView(k)} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full transition" style={view === k ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>
            {l}
          </button>
        ))}
      </div>

      {npkData.length === 0 ? (
        <div className="bg-white rounded-2xl border border-black/5 p-10 text-center text-slate-400 font-body text-sm">
          No fertilizer applications recorded yet. Approve a spray sheet with a fertilizer product to see totals here.
        </div>
      ) : view === 'byArea' ? (
        <div className="space-y-2">
          {areaRows.map((a) => (
            <div key={a.area} className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <p className="font-body font-semibold text-sm text-slate-900">{a.area}</p>
                {a.sqft > 0 && <p className="font-body text-[10px] text-slate-400">{a.sqft.toLocaleString()} sq ft</p>}
              </div>
              <p className="font-body text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Total Applied (lbs)</p>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <NPKMini label="N" value={a.n} color="#2563EB" />
                <NPKMini label="P" value={a.p} color="#D97706" />
                <NPKMini label="K" value={a.k} color="#7C3AED" />
              </div>
              {a.nPerM !== null && (
                <>
                  <p className="font-body text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Per 1,000 sq ft</p>
                  <div className="grid grid-cols-3 gap-2">
                    <NPKMini label="N" value={a.nPerM} color="#2563EB" />
                    <NPKMini label="P" value={a.pPerM} color="#D97706" />
                    <NPKMini label="K" value={a.kPerM} color="#7C3AED" />
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {monthRows.map((m) => (
            <div key={m.month} className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm">
              <p className="font-body font-semibold text-sm text-slate-900 mb-2">
                {new Date(m.month + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </p>
              <p className="font-body text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Total Applied (lbs)</p>
              <div className="grid grid-cols-3 gap-2">
                <NPKMini label="N" value={m.n} color="#2563EB" />
                <NPKMini label="P" value={m.p} color="#D97706" />
                <NPKMini label="K" value={m.k} color="#7C3AED" />
              </div>
            </div>
          ))}
        </div>
      )}
      </>)}
    </div>
  )
}

// ── ROTATION REPORT ─────────────────────────────────────────────────────────
// Per area, the chemical groups sprayed over time — repeats within the rotation
// window are flagged so you can keep modes of action rotating.
function RotationReport({ sheets, products }) {
  const byArea = rotationByArea(sheets, products)
  const areas = Object.keys(byArea).sort()
  const taggedCount = products.filter((p) => (p.moaGroup || '').trim()).length

  return (
    <div className="mt-4">
      {taggedCount === 0 && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-100 p-3 mb-3">
          <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
          <p className="font-body text-[11px] text-amber-700">No products have a chemical group set yet. Add each product's group (FRAC/HRAC/IRAC) in the Chemical Library → Resistance / Rotation, and this fills in from your sprays.</p>
        </div>
      )}
      {areas.length === 0 ? (
        <div className="bg-white rounded-2xl border border-black/5 p-10 text-center text-slate-400 font-body text-sm">
          No sprays with a chemical group yet. Approve or complete a sheet whose products have a group set.
        </div>
      ) : (
        <div className="space-y-3">
          {areas.map((area) => (
            <div key={area} className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm">
              <p className="font-body font-semibold text-sm text-slate-900 mb-2">{area}</p>
              <div className="space-y-1.5">
                {byArea[area].map((e, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <span className="font-body text-[11px] text-slate-400 w-14 shrink-0">{e.date ? fmtDate(e.date) : '—'}</span>
                    <span className="font-body text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={e.tooSoon ? { backgroundColor: '#FEE2E2', color: '#B91C1C' } : { backgroundColor: '#F0F6F2', color: FERN }}>
                      Group {e.group}
                    </span>
                    <span className="font-body text-[12px] text-slate-700 truncate flex-1">{e.product}</span>
                    {e.tooSoon && (
                      <span className="font-body text-[10px] font-semibold text-red-600 shrink-0">⚠ {e.prev.days}d after Group {e.group}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="font-body text-[10px] text-slate-400 mt-3">Red = the same chemical group hit this area again within its rotation window (default 21 days, or the product's “Rotate After” setting). Rotate modes of action to slow resistance.</p>
    </div>
  )
}

// ── PRODUCT USAGE REPORT ────────────────────────────────────────────────────
// How much of each product actually went out (from approved/completed sheets).
// ── COST / BUDGET REPORT ────────────────────────────────────────────────────
// What the program has actually cost, from applied amounts × case pricing.
function CostReport({ sheets, products, areas }) {
  const [view, setView] = useState('product') // 'product' | 'area' | 'month'
  const data = productCosts(sheets, products, areas)
  const money = (n) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const monthLabel = (m) => { const [y, mm] = m.split('-'); return new Date(Number(y), Number(mm) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }

  const lists = {
    product: data.rows.map((r) => ({ key: r.name, label: r.name, sub: `${r.apps} application${r.apps !== 1 ? 's' : ''}${r.type ? ` · ${r.type}` : ''}`, cost: r.cost })),
    area: data.byArea.map((r) => ({ key: r.area, label: r.area, sub: '', cost: r.cost })),
    month: data.byMonth.map((r) => ({ key: r.month, label: monthLabel(r.month), sub: '', cost: r.cost })),
  }
  const rows = lists[view]
  const max = Math.max(1, ...rows.map((r) => r.cost))

  const exportCSV = () => {
    const out = [['Product', 'Type', 'Applications', 'Cost ($)']]
    data.rows.forEach((r) => out.push([r.name, r.type, r.apps, r.cost]))
    out.push([])
    out.push(['Area', 'Cost ($)'])
    data.byArea.forEach((r) => out.push([r.area, r.cost]))
    out.push([])
    out.push(['Month', 'Cost ($)'])
    data.byMonth.forEach((r) => out.push([r.month, r.cost]))
    out.push([])
    out.push(['Total', data.totalCost])
    downloadCSV(out, `Spray_Costs_${new Date().toISOString().slice(0, 10)}.csv`)
  }

  const hasData = data.rows.length > 0
  return (
    <div className="mt-4">
      <div className="rounded-2xl p-4 text-white shadow-sm mb-4 flex items-end justify-between" style={{ backgroundColor: FOREST }}>
        <div>
          <p className="font-body text-[11px] font-bold uppercase tracking-wide opacity-70">Total Spent (approved &amp; completed)</p>
          <p className="font-display text-3xl font-bold mt-0.5">{money(data.totalCost)}</p>
        </div>
        {hasData && (
          <button onClick={exportCSV} className="font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5 shrink-0" style={{ backgroundColor: GOLD, color: FOREST }}>
            <Package size={14} /> Export
          </button>
        )}
      </div>

      {data.missing.length > 0 && (
        <div className="bg-amber-50 rounded-2xl border border-amber-200 p-4 mb-4">
          <div className="flex items-start gap-2 mb-1.5">
            <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={16} />
            <p className="font-body text-sm font-bold text-amber-800">Some products aren't priced yet</p>
          </div>
          <p className="font-body text-[11px] text-amber-700 mb-2">Add a case price and case size (oz per case) in Chemical Library so these count toward the total.</p>
          <div className="flex flex-wrap gap-1.5">
            {data.missing.map((m) => <span key={m} className="font-body text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white text-amber-700 border border-amber-200">{m}</span>)}
          </div>
        </div>
      )}

      {!hasData ? (
        <div className="bg-white rounded-2xl border border-black/5 p-10 text-center text-slate-400 font-body text-sm">
          No priced sprays yet. Add case pricing in Chemical Library and approve a sheet to see costs here.
        </div>
      ) : (
        <>
          <div className="flex gap-2 mb-3">
            {[['product', 'By Product'], ['area', 'By Area'], ['month', 'By Month']].map(([k, l]) => (
              <button key={k} onClick={() => setView(k)} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full transition" style={view === k ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>
                {l}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.key} className="bg-white rounded-2xl border border-black/5 p-3.5 shadow-sm">
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <div className="min-w-0">
                    <p className="font-body text-sm font-semibold text-slate-800 truncate">{r.label}</p>
                    {r.sub && <p className="font-body text-[11px] text-slate-400">{r.sub}</p>}
                  </div>
                  <p className="font-display text-base font-bold text-slate-900 shrink-0">{money(r.cost)}</p>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(3, Math.round((r.cost / max) * 100))}%`, backgroundColor: FERN }} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function ProductUsageReport({ sheets, products, areas }) {
  const rows = productUsage(sheets, products, areas)
  const exportCSV = () => {
    const out = [['Product', 'Type', 'Applications', 'Total applied', 'Unit']]
    rows.forEach((r) => out.push([r.name, r.type, r.apps, r.total, r.unit]))
    downloadCSV(out, `Product_Usage_${new Date().toISOString().slice(0, 10)}.csv`)
  }
  return (
    <div className="mt-4">
      {rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-black/5 p-10 text-center text-slate-400 font-body text-sm">No sprays recorded yet. Approve or complete a sheet to see usage.</div>
      ) : (
        <>
          <div className="flex justify-end mb-2">
            <button onClick={exportCSV} className="font-body text-xs font-bold px-3.5 py-2 rounded-full text-white flex items-center gap-1.5" style={{ backgroundColor: FOREST }}><Package size={14} /> Export</button>
          </div>
          <div className="space-y-2">
            {rows.map((r) => {
              const areasUsed = Object.entries(r.byArea).sort((a, b) => b[1] - a[1])
              return (
                <div key={r.name} className="bg-white rounded-2xl border border-black/5 p-3 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-body text-sm font-semibold text-slate-800 truncate">{r.name}</p>
                      <p className="font-body text-[11px] text-slate-400">{r.apps} application{r.apps !== 1 ? 's' : ''}{r.type ? ` · ${r.type}` : ''}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-display text-lg font-bold text-slate-900 leading-none">{r.total.toLocaleString()}</p>
                      <p className="font-body text-[9px] uppercase tracking-wide text-slate-400 mt-0.5">{r.unit} applied</p>
                    </div>
                  </div>
                  {areasUsed.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {areasUsed.map(([area, amt]) => (
                        <span key={area} className="font-body text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: '#F0F6F2', color: FERN }}>{area}: {Math.round(amt * 10) / 10} {r.unit}</span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ── SPRAY HISTORY REPORT ────────────────────────────────────────────────────
function SprayHistoryReport({ sheets }) {
  const [area, setArea] = useState('all')
  const all = sprayHistory(sheets)
  const areaNames = [...new Set(all.map((h) => h.area))].sort()
  const rows = area === 'all' ? all : all.filter((h) => h.area === area)
  const exportCSV = () => {
    const out = [['Date', 'Area', 'Applicator', 'Status', 'Tanks', 'Products']]
    rows.forEach((h) => out.push([h.date || '', h.area, h.operator, h.status, h.tanks, h.products.join('; ')]))
    downloadCSV(out, `Spray_History_${new Date().toISOString().slice(0, 10)}.csv`)
  }
  return (
    <div className="mt-4">
      <div className="flex gap-2 mb-3 overflow-x-auto pb-1 items-center">
        <select value={area} onChange={(e) => setArea(e.target.value)} className="border border-slate-200 rounded-full px-3 py-1.5 text-xs font-body bg-white">
          <option value="all">All areas</option>
          {areaNames.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <button onClick={exportCSV} className="font-body text-xs font-bold px-3.5 py-1.5 rounded-full text-white flex items-center gap-1.5 shrink-0" style={{ backgroundColor: FOREST }}><Package size={13} /> Export</button>
      </div>
      {rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-black/5 p-10 text-center text-slate-400 font-body text-sm">No sprays to show.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((h) => (
            <div key={h.id} className="bg-white rounded-2xl border border-black/5 p-3 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-body text-xs font-bold text-slate-900">{h.area}</span>
                <span className="font-body text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide" style={h.status === 'Sprayed' ? { backgroundColor: '#E8F3EC', color: FERN } : h.status === 'approved' ? { backgroundColor: '#E8F3EC', color: FERN } : { backgroundColor: '#FEF3DD', color: '#92660D' }}>{h.status}</span>
                <span className="font-body text-[11px] text-slate-400 ml-auto">{h.date ? fmtDate(h.date) : '—'}</span>
              </div>
              <p className="font-body text-[11px] text-slate-500 truncate">{h.products.join(', ') || 'No products'}</p>
              {h.operator && <p className="font-body text-[10px] text-slate-400 mt-0.5">By {h.operator}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── DAYS SINCE LAST SPRAY ───────────────────────────────────────────────────
function DaysSinceReport({ sheets }) {
  const rows = daysSinceByArea(sheets)
  return (
    <div className="mt-4">
      {rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-black/5 p-10 text-center text-slate-400 font-body text-sm">No sprays recorded yet.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.area} className="bg-white rounded-2xl border border-black/5 p-3 shadow-sm flex items-center justify-between">
              <div>
                <p className="font-body text-sm font-semibold text-slate-800">{r.area}</p>
                <p className="font-body text-[11px] text-slate-400">Last sprayed {r.date ? fmtDate(r.date) : '—'}</p>
              </div>
              <div className="text-right">
                <p className="font-display text-lg font-bold leading-none" style={{ color: r.days > 30 ? '#B91C1C' : '#1E293B' }}>{r.days}</p>
                <p className="font-body text-[9px] uppercase tracking-wide text-slate-400 mt-0.5">days ago</p>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="font-body text-[10px] text-slate-400 mt-3">Days since each area's most recent approved or completed spray. Red past 30 days.</p>
    </div>
  )
}

function NPKStat({ label, value, color }) {
  return (
    <div className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm">
      <p className="font-display text-2xl font-bold" style={{ color }}>{value}</p>
      <p className="font-body text-[11px] text-slate-400 mt-0.5">{label} (lbs)</p>
    </div>
  )
}

function NPKMini({ label, value, color }) {
  return (
    <div className="rounded-xl px-2 py-2 text-center" style={{ backgroundColor: `${color}12` }}>
      <p className="font-body text-[10px] font-bold uppercase" style={{ color }}>{label}</p>
      <p className="font-display text-base font-bold" style={{ color }}>{value}</p>
    </div>
  )
}

// ── ONBOARDING WIZARD ─────────────────────────────────────────────────────
// Shown the first time a manager signs in (before courseInfo.onboarded is set).
// Captures the two things every club needs before the app is useful: how the
// course is laid out (name + holes, one row per course) and which grasses are
// actually on site. Both are stored in the courseInfo blob (no new migration).
// Prefilled from whatever's already there so an existing club just confirms.
function OnboardingWizard({ courseInfo = {}, grassTypes = [], onFinish, onSkip }) {
  const [step, setStep] = useState(0)
  const [clubName, setClubName] = useState(courseInfo.clubName || '')
  const [deptName, setDeptName] = useState(courseInfo.deptName || 'Golf Maintenance')
  const [courses, setCourses] = useState(
    Array.isArray(courseInfo.courses) && courseInfo.courses.length
      ? courseInfo.courses.map((c) => ({ name: c.name || '', holes: Number(c.holes) || 18 }))
      : [{ name: '', holes: 18 }]
  )
  const [siteGrasses, setSiteGrasses] = useState(courseInfo.siteGrasses || [])
  const [custom, setCustom] = useState('')
  const [customGrasses, setCustomGrasses] = useState([])
  const [saving, setSaving] = useState(false)

  const allGrasses = [...grassTypes, ...customGrasses.filter((g) => !grassTypes.includes(g))]
  const totalHoles = courses.reduce((s, c) => s + (Number(c.holes) || 0), 0)
  const cleanCourses = courses
    .map((c) => ({ name: String(c.name || '').trim(), holes: Number(c.holes) || 0 }))
    .filter((c) => c.holes > 0)

  const setCourse = (i, patch) => setCourses((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const addCourse = () => setCourses((prev) => [...prev, { name: '', holes: 18 }])
  const removeCourse = (i) => setCourses((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev))
  const toggleGrass = (g) => setSiteGrasses((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]))
  const addCustom = () => {
    const g = custom.trim()
    if (!g || allGrasses.includes(g)) { setCustom(''); return }
    setCustomGrasses((prev) => [...prev, g])
    setSiteGrasses((prev) => [...prev, g])
    setCustom('')
  }

  const canNext = step === 0 ? clubName.trim().length > 0 : step === 1 ? cleanCourses.length > 0 : true

  const finish = async () => {
    setSaving(true)
    try {
      // Fold any newly-typed grasses into the club's library so they're pickable
      // everywhere, then record the site selection + course layout on courseInfo.
      const mergedLibrary = [...grassTypes, ...customGrasses.filter((g) => !grassTypes.includes(g))]
      await onFinish({
        courseInfo: {
          ...courseInfo,
          clubName: clubName.trim(),
          deptName: deptName.trim() || 'Golf Maintenance',
          courses: cleanCourses,
          holes: cleanCourses.reduce((s, c) => s + c.holes, 0),
          siteGrasses,
          onboarded: true,
        },
        grassTypes: mergedLibrary,
      })
    } catch (e) { console.error(e) }
    setSaving(false)
  }

  const STEPS = ['Club', 'Course layout', 'Grasses']

  return (
    <div className="fixed inset-0 z-[60] flex items-start sm:items-center justify-center p-4 overflow-y-auto" style={{ backgroundColor: 'rgba(22,41,31,0.55)' }}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg my-6 overflow-hidden">
        <div className="px-6 pt-6 pb-4" style={{ backgroundColor: FOREST }}>
          <p className="font-display text-[10px] tracking-[0.25em] uppercase" style={{ color: GOLD }}>Welcome</p>
          <h2 className="font-display text-xl font-semibold text-white mt-0.5">Let's set up your course</h2>
          <div className="flex gap-1.5 mt-3">
            {STEPS.map((s, i) => (
              <div key={s} className="flex-1 h-1.5 rounded-full transition" style={{ backgroundColor: i <= step ? GOLD : 'rgba(255,255,255,0.2)' }} />
            ))}
          </div>
          <p className="font-body text-[11px] mt-2" style={{ color: 'rgba(255,255,255,0.7)' }}>Step {step + 1} of 3 · {STEPS[step]}</p>
        </div>

        <div className="px-6 py-5">
          {step === 0 && (
            <div className="space-y-4">
              <p className="font-body text-sm text-slate-500">What should we call your club? This shows up across the app and on printed spray records.</p>
              <div>
                <FieldLabel>Club name</FieldLabel>
                <input value={clubName} onChange={(e) => setClubName(e.target.value)} placeholder="e.g. Congressional Country Club" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
              </div>
              <div>
                <FieldLabel>Department</FieldLabel>
                <input value={deptName} onChange={(e) => setDeptName(e.target.value)} placeholder="Golf Maintenance" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <p className="font-body text-sm text-slate-500">How many holes do you manage? Add a row for each course — the app builds your greens lists from this, so 36 or 54 holes stays organized.</p>
              <div className="space-y-2">
                {courses.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input value={c.name} onChange={(e) => setCourse(i, { name: e.target.value })} placeholder={courses.length > 1 ? `Course ${i + 1} name` : 'Course name (optional)'} className="flex-1 min-w-0 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
                    <select value={c.holes} onChange={(e) => setCourse(i, { holes: Number(e.target.value) })} className="border border-slate-200 rounded-xl px-2.5 py-2.5 text-sm font-body bg-white shrink-0">
                      {[9, 18, 27].map((h) => <option key={h} value={h}>{h} holes</option>)}
                    </select>
                    {courses.length > 1 && (
                      <button type="button" onClick={() => removeCourse(i)} className="text-slate-300 hover:text-red-500 transition shrink-0" aria-label="Remove course"><Trash2 size={16} /></button>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" onClick={addCourse} className="font-body text-xs font-bold flex items-center gap-1.5" style={{ color: FERN }}>
                <Plus size={14} /> Add another course
              </button>
              <div className="rounded-xl px-3 py-2 font-body text-[12px] font-semibold" style={{ backgroundColor: '#F0F6F2', color: FERN }}>
                {totalHoles} holes total{cleanCourses.length > 1 ? ` across ${cleanCourses.length} courses` : ''}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="font-body text-sm text-slate-500">Which grasses do you have on site? The app uses these to suggest nitrogen targets and flag products that can damage them — you'll only see these grasses in the pickers.</p>
              <div className="flex flex-wrap gap-1.5">
                {allGrasses.map((g) => {
                  const on = siteGrasses.includes(g)
                  return (
                    <button key={g} type="button" onClick={() => toggleGrass(g)} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full transition border" style={on ? { backgroundColor: FERN, color: 'white', borderColor: FERN } : { backgroundColor: 'white', color: '#64748B', borderColor: '#E2E8F0' }}>{g}</button>
                  )
                })}
              </div>
              <div className="flex items-center gap-2">
                <input value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }} placeholder="Add another grass…" className="flex-1 min-w-0 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
                <button type="button" onClick={addCustom} disabled={!custom.trim()} className="font-body text-xs font-bold px-3 py-2.5 rounded-xl text-white disabled:opacity-40 shrink-0" style={{ backgroundColor: FERN }}>Add</button>
              </div>
              {siteGrasses.length === 0 && <p className="font-body text-[11px] text-slate-400">Pick at least one so the plan knows what you're growing (you can change this later in Settings).</p>}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
          <button type="button" onClick={step === 0 ? onSkip : () => setStep((s) => s - 1)} className="font-body text-xs font-bold px-4 py-2.5 rounded-full text-slate-500">
            {step === 0 ? 'Skip for now' : 'Back'}
          </button>
          {step < 2 ? (
            <button type="button" onClick={() => setStep((s) => s + 1)} disabled={!canNext} className="font-body text-xs font-bold px-6 py-2.5 rounded-full text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>Next</button>
          ) : (
            <button type="button" onClick={finish} disabled={saving} className="font-body text-xs font-bold px-6 py-2.5 rounded-full text-white disabled:opacity-50" style={{ backgroundColor: FOREST }}>{saving ? 'Saving…' : 'Finish setup'}</button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── SETTINGS ──────────────────────────────────────────────────────────────
function SettingsPage({ areas, operators, directors, targets, sheetTypes, courseInfo, location, grassTypes, soilTypes, applicatorLicenses, directorPins, onSave }) {
  const [section, setSection] = useState('course')
  // Grasses actually on site (from onboarding) drive the area/turf pickers; the
  // full library is still edited in Lists and offered when nothing's selected.
  const siteGrasses = courseInfo?.siteGrasses || []
  const grassChoices = siteGrasses.length ? siteGrasses : grassTypes

  return (
    <div className="pt-6 pb-10">
      <SectionHeader title="Settings" subtitle="Manage people, areas, and club details — changes apply everywhere instantly" />

      <div className="flex gap-2 mt-4 mb-5 overflow-x-auto pb-1">
        {[['course', 'Course Info'], ['location', 'Location'], ['people', 'People'], ['areas', 'Sprayer Areas'], ['lists', 'Lists']].map(([k, l]) => (
          <button key={k} onClick={() => setSection(k)} className="font-body text-xs font-semibold px-3.5 py-1.5 rounded-full whitespace-nowrap transition" style={section === k ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>
            {l}
          </button>
        ))}
      </div>

      {section === 'course' && <CourseInfoSettings courseInfo={courseInfo} grassTypes={grassTypes} onSave={onSave} />}
      {section === 'location' && <LocationSettings location={location} onSave={onSave} />}
      {section === 'people' && <PeopleSettings operators={operators} directors={directors} applicatorLicenses={applicatorLicenses} directorPins={directorPins} onSave={onSave} />}
      {section === 'areas' && <AreasSettings areas={areas} grassTypes={grassChoices} soilTypes={soilTypes} onSave={onSave} />}
      {section === 'lists' && <ListsSettings targets={targets} sheetTypes={sheetTypes} grassTypes={grassTypes} soilTypes={soilTypes} onSave={onSave} />}
    </div>
  )
}

function LocationSettings({ location, onSave }) {
  const [draft, setDraft] = useState(location || { address: '', lat: null, lng: null, timezone: 'America/New_York' })
  const [looking, setLooking] = useState(false)
  const [msg, setMsg] = useState(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(location)

  async function lookup() {
    if (!draft.address?.trim()) { setMsg('Enter an address first'); return }
    setLooking(true); setMsg(null)
    try {
      const { geocodeAddress } = await import('@/lib/weather')
      const hit = await geocodeAddress(draft.address)
      if (hit) { setDraft({ ...draft, lat: hit.lat, lng: hit.lng }); setMsg('Coordinates found ✓') }
      else setMsg('No match — enter latitude/longitude manually below')
    } catch {
      setMsg('Lookup unavailable — enter latitude/longitude manually below')
    }
    setLooking(false)
  }

  return (
    <Card>
      <p className="font-body text-xs text-slate-500 mb-3">
        Your course's location drives the weather, Growing Degree Days and disease models. Enter your address and look up the coordinates, or type them in directly.
      </p>
      <FieldLabel>Address</FieldLabel>
      <div className="flex gap-2 mb-3">
        <input value={draft.address || ''} onChange={(e) => setDraft({ ...draft, address: e.target.value })} className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" placeholder="8500 River Road, Bethesda, MD 20817" />
        <button onClick={lookup} disabled={looking} className="font-body text-xs font-bold px-3.5 rounded-xl text-white disabled:opacity-50 flex items-center gap-1.5" style={{ backgroundColor: FERN }}>
          {looking ? <Loader2 className="animate-spin" size={14} /> : <MapPin size={14} />} Look up
        </button>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div>
          <FieldLabel>Latitude</FieldLabel>
          <input type="number" step="any" value={draft.lat ?? ''} onChange={(e) => setDraft({ ...draft, lat: e.target.value === '' ? null : Number(e.target.value) })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" placeholder="38.9726" />
        </div>
        <div>
          <FieldLabel>Longitude</FieldLabel>
          <input type="number" step="any" value={draft.lng ?? ''} onChange={(e) => setDraft({ ...draft, lng: e.target.value === '' ? null : Number(e.target.value) })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" placeholder="-77.1735" />
        </div>
        <div>
          <FieldLabel>Time zone</FieldLabel>
          <input value={draft.timezone || ''} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" placeholder="America/New_York" />
        </div>
      </div>
      {msg && <p className="font-body text-[11px] text-slate-500 mb-3">{msg}</p>}
      <button onClick={() => onSave({ location: draft })} disabled={!dirty} className="font-body text-xs font-bold px-4 py-2.5 rounded-full text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>
        Save Location
      </button>
    </Card>
  )
}

function CourseInfoSettings({ courseInfo, grassTypes = [], onSave }) {
  const [draft, setDraft] = useState({
    ...courseInfo,
    courses: Array.isArray(courseInfo.courses) && courseInfo.courses.length ? courseInfo.courses : [{ name: '', holes: 18 }],
    siteGrasses: courseInfo.siteGrasses || [],
  })
  const [custom, setCustom] = useState('')
  const dirty = JSON.stringify(draft) !== JSON.stringify(courseInfo)

  const courses = draft.courses
  const setCourse = (i, patch) => setDraft((d) => ({ ...d, courses: d.courses.map((c, j) => (j === i ? { ...c, ...patch } : c)) }))
  const addCourse = () => setDraft((d) => ({ ...d, courses: [...d.courses, { name: '', holes: 18 }] }))
  const removeCourse = (i) => setDraft((d) => ({ ...d, courses: d.courses.length > 1 ? d.courses.filter((_, j) => j !== i) : d.courses }))
  const toggleGrass = (g) => setDraft((d) => ({ ...d, siteGrasses: d.siteGrasses.includes(g) ? d.siteGrasses.filter((x) => x !== g) : [...d.siteGrasses, g] }))
  const totalHoles = courses.reduce((s, c) => s + (Number(c.holes) || 0), 0)
  const grassChoices = [...grassTypes, ...(draft.siteGrasses || []).filter((g) => !grassTypes.includes(g))]
  const addCustom = () => {
    const g = custom.trim()
    if (!g) return
    if (!(draft.siteGrasses || []).includes(g)) toggleGrass(g)
    setCustom('')
  }

  const save = () => {
    const cleanCourses = courses.map((c) => ({ name: String(c.name || '').trim(), holes: Number(c.holes) || 0 })).filter((c) => c.holes > 0)
    onSave({ courseInfo: { ...draft, courses: cleanCourses, holes: cleanCourses.reduce((s, c) => s + c.holes, 0), onboarded: true } })
  }

  return (
    <div className="space-y-4">
      <Card>
        <FieldLabel>Club Name</FieldLabel>
        <input value={draft.clubName || ''} onChange={(e) => setDraft({ ...draft, clubName: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body mb-3" />
        <FieldLabel>Department Name</FieldLabel>
        <input value={draft.deptName || ''} onChange={(e) => setDraft({ ...draft, deptName: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
      </Card>

      <Card>
        <FieldLabel>Courses &amp; Holes</FieldLabel>
        <p className="font-body text-[11px] text-slate-400 mt-1 mb-2">One row per course. This builds your greens lists — add a course to grow from 18 to 36, 54 holes and beyond.</p>
        <div className="space-y-2 mb-2">
          {courses.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={c.name || ''} onChange={(e) => setCourse(i, { name: e.target.value })} placeholder={courses.length > 1 ? `Course ${i + 1} name` : 'Course name (optional)'} className="flex-1 min-w-0 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
              <select value={Number(c.holes) || 18} onChange={(e) => setCourse(i, { holes: Number(e.target.value) })} className="border border-slate-200 rounded-xl px-2.5 py-2.5 text-sm font-body bg-white shrink-0">
                {[9, 18, 27].map((h) => <option key={h} value={h}>{h} holes</option>)}
              </select>
              {courses.length > 1 && <button type="button" onClick={() => removeCourse(i)} className="text-slate-300 hover:text-red-500 transition shrink-0" aria-label="Remove course"><Trash2 size={16} /></button>}
            </div>
          ))}
        </div>
        <button type="button" onClick={addCourse} className="font-body text-xs font-bold flex items-center gap-1.5" style={{ color: FERN }}><Plus size={14} /> Add another course</button>
        <p className="font-body text-[11px] font-semibold mt-2" style={{ color: FERN }}>{totalHoles} holes total{courses.filter((c) => Number(c.holes) > 0).length > 1 ? ` · ${courses.filter((c) => Number(c.holes) > 0).length} courses` : ''}</p>
      </Card>

      <Card>
        <FieldLabel>Grasses on site</FieldLabel>
        <p className="font-body text-[11px] text-slate-400 mt-1 mb-2">These drive nitrogen targets and product safety warnings. Only these grasses show in the pickers. (The full library lives in Lists.)</p>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {grassChoices.map((g) => {
            const on = (draft.siteGrasses || []).includes(g)
            return <button key={g} type="button" onClick={() => toggleGrass(g)} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full transition border" style={on ? { backgroundColor: FERN, color: 'white', borderColor: FERN } : { backgroundColor: 'white', color: '#64748B', borderColor: '#E2E8F0' }}>{g}</button>
          })}
          {grassChoices.length === 0 && <span className="font-body text-[11px] text-slate-400">Add grass types in Lists first.</span>}
        </div>
        <div className="flex items-center gap-2">
          <input value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }} placeholder="Add another grass…" className="flex-1 min-w-0 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
          <button type="button" onClick={addCustom} disabled={!custom.trim()} className="font-body text-xs font-bold px-3 py-2.5 rounded-xl text-white disabled:opacity-40 shrink-0" style={{ backgroundColor: FERN }}>Add</button>
        </div>
      </Card>

      <button onClick={save} disabled={!dirty} className="font-body text-xs font-bold px-4 py-2.5 rounded-full text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>
        Save Changes
      </button>
    </div>
  )
}

function NameListEditor({ title, items, onSave, accent }) {
  const [list, setList] = useState(items)
  const [newName, setNewName] = useState('')
  const dirty = JSON.stringify(list) !== JSON.stringify(items)

  const add = () => {
    if (!newName.trim() || list.includes(newName.trim())) return
    setList([...list, newName.trim()])
    setNewName('')
  }
  const remove = (name) => setList(list.filter((n) => n !== name))

  return (
    <Card>
      <FieldLabel>{title}</FieldLabel>
      <div className="flex flex-wrap gap-2 mt-2 mb-3">
        {list.map((n) => (
          <span key={n} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full flex items-center gap-1.5" style={{ backgroundColor: `${accent}15`, color: accent }}>
            {n}
            <button onClick={() => remove(n)} className="opacity-60 hover:opacity-100">×</button>
          </span>
        ))}
        {list.length === 0 && <p className="font-body text-xs text-slate-400">No names yet</p>}
      </div>
      <div className="flex gap-2">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Add a name..." className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
        <button onClick={add} className="font-body text-xs font-bold px-4 rounded-xl text-white" style={{ backgroundColor: FOREST }}>Add</button>
      </div>
      {dirty && (
        <button onClick={() => onSave(list)} className="font-body text-xs font-bold px-4 py-2.5 rounded-full text-white mt-3" style={{ backgroundColor: accent }}>
          Save Changes
        </button>
      )}
    </Card>
  )
}

function PeopleSettings({ operators, directors, applicatorLicenses = {}, directorPins = {}, onSave }) {
  return (
    <div className="space-y-4">
      <ApplicatorsEditor operators={operators} licenses={applicatorLicenses} onSave={onSave} />
      <DirectorsEditor directors={directors} pins={directorPins} onSave={onSave} />
    </div>
  )
}

// Directors / approvers plus a private PIN each types to approve a spray sheet.
function DirectorsEditor({ directors, pins, onSave }) {
  const [newName, setNewName] = useState('')
  const [show, setShow] = useState({})

  const setPin = (name, value) => {
    const digits = value.replace(/\D/g, '').slice(0, 8)
    onSave({ directorPins: { ...pins, [name]: digits } })
  }
  const addPerson = () => {
    const n = newName.trim()
    if (!n || directors.includes(n)) { setNewName(''); return }
    onSave({ directors: [...directors, n] })
    setNewName('')
  }
  const removePerson = (name) => {
    const nextPins = { ...pins }
    delete nextPins[name]
    onSave({ directors: directors.filter((d) => d !== name), directorPins: nextPins })
  }

  return (
    <Card>
      <p className="font-display text-base font-semibold text-slate-900 mb-1">Directors / Approvers</p>
      <p className="font-body text-[11px] text-slate-400 mb-3">Each director sets a private PIN. They type it (and sign) to approve a spray sheet — proving it was really them.</p>

      <div className="space-y-3">
        {directors.map((name) => (
          <div key={name} className="rounded-xl border border-slate-100 p-3" style={{ backgroundColor: '#FDFBF4' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="font-body text-sm font-bold text-slate-800">{name}</p>
              <button onClick={() => removePerson(name)} className="text-slate-300 hover:text-red-500 transition" aria-label={`Remove ${name}`}><Trash2 size={15} /></button>
            </div>
            <FieldLabel>Approval PIN {pins[name] ? '' : '(not set)'}</FieldLabel>
            <div className="relative max-w-[220px]">
              <input
                type={show[name] ? 'text' : 'password'}
                inputMode="numeric"
                value={pins[name] ?? ''}
                onChange={(e) => setPin(name, e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 pr-14 text-sm font-body bg-white tracking-widest"
                placeholder="4–8 digits"
              />
              <button type="button" onClick={() => setShow((s) => ({ ...s, [name]: !s[name] }))} className="absolute right-2 top-1/2 -translate-y-1/2 font-body text-[11px] font-bold" style={{ color: '#92660D' }}>
                {show[name] ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
        ))}
        {directors.length === 0 && <p className="font-body text-sm text-slate-400">No directors yet.</p>}
      </div>

      <div className="flex gap-2 mt-3">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addPerson()} placeholder="Add a director's name…" className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm font-body" />
        <button onClick={addPerson} className="font-body text-xs font-bold px-3.5 py-2 rounded-xl text-white flex items-center gap-1.5" style={{ backgroundColor: '#92660D' }}>
          <Plus size={14} /> Add
        </button>
      </div>
    </Card>
  )
}

// One license: its number plus an optional scanned/photographed copy.
function licenseStatus(exp) {
  if (!exp) return null
  const days = Math.round((new Date(exp + 'T00:00:00').getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000)
  if (days < 0) return { level: 'expired', days, label: `Expired ${-days}d ago` }
  if (days <= 60) return { level: 'soon', days, label: `Expires in ${days}d` }
  return { level: 'ok', days, label: `Valid · ${days}d left` }
}

// All applicator licenses that are expired or expiring within 60 days.
function computeLicenseAlerts(licenses) {
  const out = []
  Object.entries(licenses || {}).forEach(([name, lic]) => {
    ;['pesticide', 'fertilizer'].forEach((type) => {
      const st = licenseStatus(lic[`${type}Exp`])
      if (st && (st.level === 'expired' || st.level === 'soon')) out.push({ name, type, ...st })
    })
  })
  return out.sort((a, b) => (a.level === 'expired' ? 0 : 1) - (b.level === 'expired' ? 0 : 1) || a.days - b.days)
}

function LicenseField({ label, placeholder, num, img, exp, onNum, onImg, onExp }) {
  const st = licenseStatus(exp)
  const stColor = st ? (st.level === 'expired' ? '#B91C1C' : st.level === 'soon' ? '#92660D' : FERN) : '#94A3B8'
  return (
    <div>
      <FieldLabel>{label} #</FieldLabel>
      <input value={num ?? ''} onChange={(e) => onNum(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-body bg-white" placeholder={placeholder} />
      <div className="mt-1.5">
        <FieldLabel>Expiry date</FieldLabel>
        <input type="date" value={exp ?? ''} onChange={(e) => onExp(e.target.value)} className="w-full border rounded-xl px-3 py-2 text-sm font-body bg-white" style={{ borderColor: st && st.level !== 'ok' ? stColor : '#E2E8F0' }} />
        {st && <p className="font-body text-[10px] font-bold mt-1" style={{ color: stColor }}>{st.label}</p>}
      </div>
      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
        {img ? (
          <>
            <a href={img} target="_blank" rel="noopener noreferrer"><img src={img} alt={`${label} copy`} className="h-10 rounded border border-slate-200" /></a>
            <label className="font-body text-[11px] font-bold cursor-pointer" style={{ color: FERN }}>
              Replace
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onImg} />
            </label>
            <button type="button" onClick={() => onImg(null)} className="font-body text-[11px] font-bold text-slate-400">Remove</button>
          </>
        ) : (
          <label className="font-body text-[11px] font-bold cursor-pointer flex items-center gap-1" style={{ color: FERN }}>
            <CloudUpload size={12} /> Attach copy
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onImg} />
          </label>
        )}
      </div>
    </div>
  )
}

// Applicators plus their pesticide and fertilizer license numbers. The names
// still drive every "who sprayed" dropdown; the license numbers ride along and
// get snapshotted onto a spray sheet at sign-off.
function ApplicatorsEditor({ operators, licenses, onSave }) {
  const [newName, setNewName] = useState('')

  const setLicense = (name, field, value) => {
    const next = { ...licenses, [name]: { ...(licenses[name] || {}), [field]: value } }
    onSave({ applicatorLicenses: next })
  }
  const handleImg = async (name, field, e) => {
    if (e === null) { setLicense(name, field, ''); return }
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try { setLicense(name, field, await compressImage(file)) } catch { /* ignore bad image */ }
  }
  const addPerson = () => {
    const n = newName.trim()
    if (!n || operators.includes(n)) { setNewName(''); return }
    onSave({ operators: [...operators, n] })
    setNewName('')
  }
  const removePerson = (name) => {
    const nextLic = { ...licenses }
    delete nextLic[name]
    onSave({ operators: operators.filter((o) => o !== name), applicatorLicenses: nextLic })
  }

  return (
    <Card>
      <p className="font-display text-base font-semibold text-slate-900 mb-1">Applicators</p>
      <p className="font-body text-[11px] text-slate-400 mb-3">Add each applicator and their license numbers. These attach to the spray sheet when they sign off.</p>

      <div className="space-y-3">
        {operators.map((name) => (
          <div key={name} className="rounded-xl border border-slate-100 p-3" style={{ backgroundColor: '#F8FAF9' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="font-body text-sm font-bold text-slate-800">{name}</p>
              <button onClick={() => removePerson(name)} className="text-slate-300 hover:text-red-500 transition" aria-label={`Remove ${name}`}><Trash2 size={15} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <LicenseField label="Pesticide License" placeholder="e.g. MD-12345"
                num={licenses[name]?.pesticide} img={licenses[name]?.pesticideImg} exp={licenses[name]?.pesticideExp}
                onNum={(v) => setLicense(name, 'pesticide', v)} onImg={(e) => handleImg(name, 'pesticideImg', e)} onExp={(v) => setLicense(name, 'pesticideExp', v)} />
              <LicenseField label="Fertilizer License" placeholder="e.g. F-678"
                num={licenses[name]?.fertilizer} img={licenses[name]?.fertilizerImg} exp={licenses[name]?.fertilizerExp}
                onNum={(v) => setLicense(name, 'fertilizer', v)} onImg={(e) => handleImg(name, 'fertilizerImg', e)} onExp={(v) => setLicense(name, 'fertilizerExp', v)} />
            </div>
          </div>
        ))}
        {operators.length === 0 && <p className="font-body text-sm text-slate-400">No applicators yet.</p>}
      </div>

      <div className="flex gap-2 mt-3">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addPerson()} placeholder="Add an applicator's name…" className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm font-body" />
        <button onClick={addPerson} className="font-body text-xs font-bold px-3.5 py-2 rounded-xl text-white flex items-center gap-1.5" style={{ backgroundColor: FERN }}>
          <Plus size={14} /> Add
        </button>
      </div>
    </Card>
  )
}

function ListsSettings({ targets, sheetTypes, grassTypes, soilTypes, onSave }) {
  return (
    <div className="space-y-4">
      <NameListEditor title="Spray Targets" items={targets} accent="#7C3AED" onSave={(list) => onSave({ targets: list })} />
      <NameListEditor title="Sheet Types" items={sheetTypes} accent={FOREST} onSave={(list) => onSave({ sheetTypes: list })} />
      <NameListEditor title="Grass Types" items={grassTypes || []} accent="#2E7D32" onSave={(list) => onSave({ grassTypes: list })} />
      <NameListEditor title="Soil Types" items={soilTypes || []} accent="#92660D" onSave={(list) => onSave({ soilTypes: list })} />
    </div>
  )
}

function AreasSettings({ areas, grassTypes = [], soilTypes = [], onSave }) {
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState(null)

  const startEdit = (name) => { setEditing(name); setDraft({ name, grasses: [], soilType: '', ...areas[name] }) }
  const startNew = () => {
    setEditing('__new__')
    setDraft({ name: '', gear: '', psi: '', tanks: 1, galTank: 0, sprayRate: 0, nozzle: '', sqft: 0, grasses: [], soilType: '' })
  }
  const cancel = () => { setEditing(null); setDraft(null) }

  const save = () => {
    if (!draft.name.trim()) return
    const next = { ...areas }
    if (editing !== '__new__' && editing !== draft.name) delete next[editing]
    next[draft.name] = {
      gear: draft.gear, psi: draft.psi,
      tanks: Number(draft.tanks) || 1, galTank: Number(draft.galTank) || 0,
      sprayRate: Number(draft.sprayRate) || 0, nozzle: draft.nozzle, sqft: Number(draft.sqft) || 0,
      grasses: draft.grasses || [],
      soilType: draft.soilType || '',
    }
    onSave({ areas: next })
    cancel()
  }

  const remove = (name) => {
    const next = { ...areas }
    delete next[name]
    onSave({ areas: next })
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button onClick={startNew} className="font-body text-xs font-bold px-3.5 py-2 rounded-full text-white flex items-center gap-1.5" style={{ backgroundColor: FOREST }}>
          <Plus size={14} /> Add Area
        </button>
      </div>

      {editing && draft && (
        <Card>
          <p className="font-display text-base font-semibold text-slate-900 mb-3">{editing === '__new__' ? 'Add New Area' : `Edit ${editing}`}</p>
          <div className="space-y-3">
            <div>
              <FieldLabel>Area Name</FieldLabel>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><FieldLabel>Gear / Speed</FieldLabel>
                <input value={draft.gear} onChange={(e) => setDraft({ ...draft, gear: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" placeholder="2nd Gear, 5.0 MPH" /></div>
              <div><FieldLabel>PSI</FieldLabel>
                <input value={draft.psi} onChange={(e) => setDraft({ ...draft, psi: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" placeholder="~45 PSI" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><FieldLabel>Default Tanks</FieldLabel>
                <input type="number" value={draft.tanks} onChange={(e) => setDraft({ ...draft, tanks: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" /></div>
              <div><FieldLabel>Gal / Tank</FieldLabel>
                <input type="number" value={draft.galTank} onChange={(e) => setDraft({ ...draft, galTank: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><FieldLabel>Spray Rate (Gal/Ac)</FieldLabel>
                <input type="number" step="any" value={draft.sprayRate} onChange={(e) => setDraft({ ...draft, sprayRate: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" /></div>
              <div><FieldLabel>Nozzle</FieldLabel>
                <input value={draft.nozzle} onChange={(e) => setDraft({ ...draft, nozzle: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" placeholder="White Nozzle" /></div>
            </div>
            <div>
              <FieldLabel>Area (sq ft)</FieldLabel>
              <input type="number" value={draft.sqft} onChange={(e) => setDraft({ ...draft, sqft: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" placeholder="300000" />
            </div>
            <div>
              <FieldLabel>Grasses on this area</FieldLabel>
              <div className="flex flex-wrap gap-2 mt-1">
                {grassTypes.map((g) => {
                  const on = (draft.grasses || []).includes(g)
                  return (
                    <button key={g} type="button" onClick={() => setDraft({ ...draft, grasses: on ? (draft.grasses || []).filter((x) => x !== g) : [...(draft.grasses || []), g] })} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full transition border" style={on ? { backgroundColor: FERN, color: 'white', borderColor: FERN } : { backgroundColor: 'white', color: '#64748B', borderColor: '#E2E8F0' }}>
                      {g}
                    </button>
                  )
                })}
                {grassTypes.length === 0 && <p className="font-body text-xs text-slate-400">Add grass types in the Lists tab first.</p>}
              </div>
            </div>
            <div>
              <FieldLabel>Soil type</FieldLabel>
              <Select value={draft.soilType || ''} onChange={(v) => setDraft({ ...draft, soilType: v })} options={soilTypes} placeholder="None / select…" />
              {soilTypes.length === 0 && <p className="font-body text-xs text-slate-400 mt-1">Add soil types in the Lists tab first.</p>}
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={cancel} className="flex-1 py-2.5 rounded-xl text-sm font-semibold font-body text-slate-500 border border-slate-200">Cancel</button>
              <button onClick={save} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body text-white" style={{ backgroundColor: FOREST }}>Save Area</button>
            </div>
          </div>
        </Card>
      )}

      <div className="space-y-2 mt-4">
        {Object.entries(areas).map(([name, a]) => (
          <div key={name} className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-body font-semibold text-sm text-slate-900 truncate">{name}</p>
              <p className="font-body text-[11px] text-slate-400 mt-0.5">
                {a.tanks} tank{a.tanks !== 1 ? 's' : ''} · {a.galTank} gal/tank · {a.sqft?.toLocaleString()} sq ft
              </p>
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => startEdit(name)} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full" style={{ backgroundColor: '#F0F6F2', color: FERN }}>Edit</button>
              <button onClick={() => remove(name)} className="text-red-400 p-1.5"><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
//  TURF PERFORMANCE MODULE — scaffold only (features come in a later phase).
// ════════════════════════════════════════════════════════════════════════
function TurfPerformanceModule() {
  const [route, setRoute] = useState('dashboard')
  const [turf, setTurf] = useState({ location: null, sheets: [], products: [], areas: {} })
  const [daily, setDaily] = useState([])
  const [clippings, setClippings] = useState([])
  const [practices, setPractices] = useState([])
  const [soilTests, setSoilTests] = useState([])
  const [soilSeries, setSoilSeries] = useState([])
  const [loadingTurf, setLoadingTurf] = useState(true)

  useEffect(() => {
    (async () => {
      setLoadingTurf(true)
      try {
        const [settings, sheets, products, clips, pracs, soils] = await Promise.all([db.fetchSettings(), db.fetchSheets(), db.fetchProducts(), db.fetchClippings().catch(() => []), db.fetchCulturalPractices().catch(() => []), db.fetchSoilTests().catch(() => [])])
        // Prefer the grasses actually on site (from onboarding) for the pickers;
        // fall back to the full library when the club hasn't selected any yet.
        const siteGrasses = settings.courseInfo?.siteGrasses || []
        const grassChoices = siteGrasses.length ? siteGrasses : (settings.grassTypes || [])
        setTurf({ location: settings.location, sheets, products, areas: settings.areas, grassTypes: grassChoices, soilTypes: settings.soilTypes || [], courseInfo: settings.courseInfo || {} })
        setClippings(clips)
        setPractices(pracs)
        setSoilTests(soils)
        if (settings.location?.lat != null) {
          try { setDaily(await fetchSeasonDaily(settings.location.lat, settings.location.lng)) } catch (e) { console.error(e) }
          try { setSoilSeries(await fetchBreakdownTemps(settings.location.lat, settings.location.lng)) } catch (e) { console.error(e) }
        }
      } catch (e) { console.error(e) }
      setLoadingTurf(false)
    })()
  }, [])

  async function reloadClippings() {
    try { setClippings(await db.fetchClippings()) } catch (e) { console.error(e) }
  }
  async function reloadPractices() {
    try { setPractices(await db.fetchCulturalPractices()) } catch (e) { console.error(e) }
  }
  async function reloadSoilTests() {
    try { setSoilTests(await db.fetchSoilTests()) } catch (e) { console.error(e) }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: CREAM }}>
      <div style={{ backgroundColor: FOREST }} className="text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-5 pb-4">
          <div className="mb-4">
            <p className="font-display text-[10px] tracking-[0.25em] uppercase" style={{ color: GOLD }}>{turf.courseInfo?.clubName || 'Golf Club'}</p>
            <h1 className="font-display text-2xl font-semibold mt-0.5">Turf Performance</h1>
          </div>
          <div className="flex gap-1 font-body text-sm overflow-x-auto">
            {[['dashboard', 'Dashboard'], ['gdd', 'Growing Degree Days'], ['timing', 'Timing'], ['soil', 'Soil Tests'], ['clippings', 'Clipping Yields'], ['practices', 'Practices'], ['speed', 'Greens Speed']].map(([key, label]) => (
              <button key={key} onClick={() => setRoute(key)} className="px-3.5 py-1.5 rounded-full font-medium transition whitespace-nowrap" style={route === key ? { backgroundColor: 'rgba(255,255,255,0.12)', color: 'white' } : { color: 'rgba(255,255,255,0.5)' }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 pb-24 pt-6">
        {route === 'dashboard' && <TurfDashboardPlaceholder />}
        {route === 'gdd' && (
          loadingTurf ? <div className="pt-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={26} /></div>
          : <GddPgrTab daily={daily} sheets={turf.sheets} products={turf.products} areas={turf.areas} hasLocation={turf.location?.lat != null} />
        )}
        {route === 'clippings' && (
          loadingTurf ? <div className="pt-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={26} /></div>
          : <ClippingsTab clippings={clippings} areas={turf.areas} courseInfo={turf.courseInfo}
              onAddMany={async (list) => { await db.addClippings(list); await reloadClippings() }}
              onDelete={async (id) => { await db.deleteClipping(id); await reloadClippings() }} />
        )}
        {route === 'timing' && (
          loadingTurf ? <div className="pt-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={26} /></div>
          : <TimingTab soilSeries={soilSeries} hasLocation={turf.location?.lat != null} />
        )}
        {route === 'soil' && (
          loadingTurf ? <div className="pt-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={26} /></div>
          : <SoilTestsTab soilTests={soilTests} areas={turf.areas} grassTypes={turf.grassTypes || []} soilTypes={turf.soilTypes || []} courseInfo={turf.courseInfo}
              onAdd={async (t) => { await db.addSoilTest(t); await reloadSoilTests() }}
              onUpdate={async (t) => { await db.updateSoilTest(t); await reloadSoilTests() }}
              onDelete={async (id) => { await db.deleteSoilTest(id); await reloadSoilTests() }} />
        )}
        {route === 'practices' && (
          loadingTurf ? <div className="pt-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={26} /></div>
          : <PracticesTab practices={practices} areas={turf.areas}
              onAddMany={async (list) => { await db.addCulturalPractices(list); await reloadPractices() }}
              onDelete={async (id) => { await db.deleteCulturalPractice(id); await reloadPractices() }} />
        )}
        {route === 'speed' && <ComingSoonCard title="Greens Speed" desc="Log Stimpmeter readings by green and date to track consistency over time." />}
      </div>
    </div>
  )
}

// ── GDD + GROWTH-REG TRACKER ────────────────────────────────────────────────
// Season GDD, plus GDD accumulated since each area's last growth-regulator
// application (base 32°F) against a reapply target — the Primo/Anuew model.
function GddPgrTab({ daily, sheets, products, areas, hasLocation }) {
  const [target, setTarget] = useState(200)

  if (!hasLocation) {
    return <ComingSoonCard title="Set your location first" desc="Growing Degree Days come from your course location. Add your address in Spray Ops → Settings → Location, then come back." />
  }

  const gddSeries = gddFromDaily(daily)
  const seasonGdd = gddSeries.length ? gddSeries[gddSeries.length - 1].acc : 0

  const pgrNames = new Set(products.filter((p) => p.type === 'Growth Reg').map((p) => p.name))
  const lastByArea = {}
  ;(sheets || [])
    .filter((s) => (s.status === 'approved' || s.completed) && s.date)
    .forEach((s) => {
      const pgr = (s.products || []).filter((p) => pgrNames.has(p.product)).map((p) => p.product)
      if (pgr.length === 0) return
      if (!lastByArea[s.area] || s.date > lastByArea[s.area].date) lastByArea[s.area] = { date: s.date, products: pgr }
    })

  const areaRows = Object.keys(areas).map((area) => {
    const last = lastByArea[area]
    const gdd = last ? gddSince(daily, last.date, 32) : null
    const pct = gdd != null && target > 0 ? Math.min(100, Math.round((gdd / target) * 100)) : 0
    let status = 'none'
    if (gdd != null) status = gdd >= target ? 'due' : gdd >= target * 0.8 ? 'soon' : 'ok'
    return { area, last, gdd, pct, status }
  }).sort((a, b) => (b.gdd ?? -1) - (a.gdd ?? -1))

  const statusStyle = { due: { bg: '#FEE2E2', fg: '#B91C1C', label: 'Reapply now' }, soon: { bg: '#FEF3DD', fg: '#92660D', label: 'Soon' }, ok: { bg: '#E8F3EC', fg: FERN, label: 'On track' } }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-4 text-white shadow-sm" style={{ backgroundColor: FOREST }}>
        <p className="font-body text-[11px] font-bold uppercase tracking-wide opacity-70">Season GDD (base 50°F)</p>
        <p className="font-display text-3xl font-bold mt-0.5">{Math.round(seasonGdd).toLocaleString()}</p>
        <p className="font-body text-[11px] opacity-70 mt-0.5">Accumulated since Jan 1 · {daily.length} days of weather</p>
      </div>

      <div className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-1">
          <p className="font-display text-base font-semibold text-slate-900">Growth-Reg Timing</p>
          <div className="flex items-center gap-1.5">
            <span className="font-body text-[11px] text-slate-400">Reapply target</span>
            <input type="number" value={target} onChange={(e) => setTarget(Number(e.target.value) || 0)} className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-sm font-body text-center" />
            <span className="font-body text-[11px] text-slate-400">GDD</span>
          </div>
        </div>
        <p className="font-body text-[11px] text-slate-400 mb-3">GDD since each area's last growth-reg spray (base 32°F). ~200 is a common greens target; fairways run higher.</p>
        <div className="space-y-3">
          {areaRows.map((r) => (
            <div key={r.area}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-body text-sm font-semibold text-slate-800">{r.area}</span>
                {r.gdd != null ? (
                  <span className="font-body text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: statusStyle[r.status].bg, color: statusStyle[r.status].fg }}>
                    {r.gdd} / {target} · {statusStyle[r.status].label}
                  </span>
                ) : (
                  <span className="font-body text-[10px] text-slate-400">No growth-reg app logged</span>
                )}
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${r.pct}%`, backgroundColor: r.gdd == null ? '#E2E8F0' : statusStyle[r.status].fg }} />
              </div>
              {r.last && <p className="font-body text-[10px] text-slate-400 mt-0.5">Last: {r.last.products.join(', ')} · {fmtDate(r.last.date)}</p>}
            </div>
          ))}
          {areaRows.length === 0 && <p className="font-body text-sm text-slate-400">No areas set up yet.</p>}
        </div>
      </div>
      <p className="font-body text-[10px] text-slate-400">Weather is pulled from your course location (Open-Meteo). GDD updates daily.</p>
    </div>
  )
}

// ── CLIPPING YIELDS ─────────────────────────────────────────────────────────
// Log clipping volume per area over time — the feedback loop for growth-reg
// performance. Each area shows its recent entries as simple bars.
// Reusable mini line chart (pure SVG, no libraries). Feed it points in time order
// and it draws a filled trend line with a dashed average and an emphasized latest
// point — used for clipping yields and available for any other metric.
function TrendChart({ points = [], color = FERN, height = 120, unit = '', showAvg = true, refLine = null }) {
  const data = points
    .filter((p) => p.value != null && p.value !== '' && !isNaN(Number(p.value)))
    .map((p) => ({ date: p.date, value: Number(p.value) }))
  if (data.length === 0) return <p className="font-body text-[11px] text-slate-400">No data yet.</p>
  const W = 320, padL = 6, padR = 6, padT = 14, padB = 4
  const vals = data.map((d) => d.value)
  const ref = refLine && refLine.value != null && !isNaN(Number(refLine.value)) ? Number(refLine.value) : null
  const scaleVals = ref != null ? [...vals, ref] : vals // keep the reference line in view
  const min = Math.min(...scaleVals), max = Math.max(...scaleVals)
  const range = max - min || Math.abs(max) || 1
  const n = data.length
  const X = (i) => padL + (n === 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR))
  const Y = (v) => padT + (1 - (v - min) / range) * (height - padT - padB)
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(d.value).toFixed(1)}`).join(' ')
  const areaPath = `${line} L${X(n - 1).toFixed(1)},${height - padB} L${X(0).toFixed(1)},${height - padB} Z`
  const mean = vals.reduce((s, v) => s + v, 0) / n
  const last = data[n - 1]
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" style={{ display: 'block', overflow: 'visible' }}>
        {ref != null && (
          <>
            <line x1={padL} x2={W - padR} y1={Y(ref)} y2={Y(ref)} stroke={refLine.color || '#DC2626'} strokeWidth="1" strokeDasharray="2 2" />
            <text x={padL} y={Y(ref) - 3} fontSize="8" fill={refLine.color || '#DC2626'} style={{ fontVariantNumeric: 'tabular-nums' }}>{refLine.label || ref}</text>
          </>
        )}
        {showAvg && n > 1 && <line x1={padL} x2={W - padR} y1={Y(mean)} y2={Y(mean)} stroke="#CBD5E1" strokeWidth="1" strokeDasharray="3 3" />}
        <path d={areaPath} fill={color} opacity="0.12" />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => <circle key={i} cx={X(i)} cy={Y(d.value)} r={i === n - 1 ? 3.5 : 2} fill={color} />)}
        <text x={X(n - 1)} y={Y(last.value) - 7} textAnchor="end" fontSize="11" fontWeight="700" fill={color} style={{ fontVariantNumeric: 'tabular-nums' }}>{last.value}</text>
      </svg>
      <div className="flex justify-between font-body text-[9px] text-slate-400 mt-1.5" style={{ fontVariantNumeric: 'tabular-nums' }}>
        <span>{fmtDate(data[0].date)}</span>
        {n > 1 && <span>avg {Math.round(mean * 10) / 10}{unit ? ` ${unit}` : ''}</span>}
        <span>{fmtDate(last.date)}</span>
      </div>
    </div>
  )
}

const GREEN_EXTRAS = ['Practice Green', 'Putting Green', 'Chipping Green', 'Short Game Green', 'Nursery Green']
// Course/hole-aware greens list for the pickers. Zero or one course → plain
// "Green 1..N" from the configured hole count; several courses → course-prefixed
// holes ("Blue Green 1", "Gold Green 1", …) so a 36- or 54-hole club stays clear.
function greenOptionsFor(courseInfo) {
  const courses = Array.isArray(courseInfo?.courses)
    ? courseInfo.courses.filter((c) => c && Number(c.holes) > 0)
    : []
  if (courses.length > 1) {
    const list = []
    courses.forEach((c) => {
      const n = Math.min(Number(c.holes) || 0, 99)
      const name = String(c.name || 'Course').trim()
      for (let i = 1; i <= n; i++) list.push(`${name} Green ${i}`)
    })
    return [...list, ...GREEN_EXTRAS]
  }
  const holes = courses.length === 1 ? Number(courses[0].holes) : (Number(courseInfo?.holes) || 18)
  const n = Math.min(Math.max(holes || 18, 1), 99)
  return [...Array.from({ length: n }, (_, i) => `Green ${i + 1}`), ...GREEN_EXTRAS]
}
const greenNum = (s) => { const m = String(s).match(/\d+/); return m ? Number(m[0]) : 999 }
const sortGreens = (a, b) => greenNum(a) - greenNum(b) || String(a).localeCompare(String(b))

// Turn a Supabase save error into something the crew can act on. A missing table
// is the common one — it means the phase migration hasn't been run yet.
function saveErrorText(e, migration) {
  const m = String(e?.message || e || '').toLowerCase()
  if (e?.code === '42P01' || m.includes('does not exist') || m.includes('could not find the table') || m.includes('schema cache')) {
    return `The database table isn't set up yet. Run ${migration} once in Supabase → SQL Editor, then try again.`
  }
  return e?.message ? `Could not save: ${e.message}` : 'Could not save — check your connection and try again.'
}
const clipErrorText = (e) => saveErrorText(e, 'supabase/phase10.sql')
const practiceErrorText = (e) => saveErrorText(e, 'supabase/phase11.sql')

function ClippingsTab({ clippings, areas, courseInfo, onAddMany, onDelete }) {
  const greenOptions = greenOptionsFor(courseInfo)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [unit, setUnit] = useState('baskets')
  const [notes, setNotes] = useState('')
  const [selected, setSelected] = useState([]) // green names being logged
  const [vols, setVols] = useState({}) // green -> volume
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('all')
  const [msg, setMsg] = useState(null) // { type: 'ok' | 'err', text }

  const toggleGreen = (g) => setSelected((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]))
  const setVol = (g, v) => setVols((prev) => ({ ...prev, [g]: v }))

  const entries = selected.filter((g) => vols[g] !== '' && vols[g] != null)
  const save = async () => {
    if (entries.length === 0) return
    setBusy(true)
    setMsg(null)
    try {
      await onAddMany(entries.map((g) => ({ area: g, date, volume: Number(vols[g]), unit, notes })))
      setVols({})
      setNotes('')
      setMsg({ type: 'ok', text: `Logged ${entries.length} green${entries.length !== 1 ? 's' : ''}.` })
      // keep the selected greens so the same set is ready next time
    } catch (e) {
      console.error(e)
      setMsg({ type: 'err', text: clipErrorText(e) })
    }
    setBusy(false)
  }

  const shown = filter === 'all' ? clippings : clippings.filter((c) => c.area === filter)
  const byArea = {}
  clippings.forEach((c) => { (byArea[c.area] = byArea[c.area] || []).push(c) })

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border-2 p-4 shadow-sm" style={{ borderColor: GOLD }}>
        <p className="font-display text-base font-semibold text-slate-900 mb-1">Log clipping yield</p>
        <p className="font-body text-[11px] text-slate-400 mb-3">Pick every green you collected today, then enter each one's volume — logs them all at once.</p>

        <FieldLabel>Greens</FieldLabel>
        <div className="flex flex-wrap gap-1.5 mt-1 mb-3">
          {greenOptions.map((g) => {
            const on = selected.includes(g)
            return (
              <button key={g} type="button" onClick={() => toggleGreen(g)} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full transition border" style={on ? { backgroundColor: FERN, color: 'white', borderColor: FERN } : { backgroundColor: 'white', color: '#64748B', borderColor: '#E2E8F0' }}>
                {g.replace('Green ', '')}
              </button>
            )
          })}
        </div>

        {selected.length > 0 && (
          <div className="rounded-xl p-3 mb-3" style={{ backgroundColor: '#F8FAF9' }}>
            <FieldLabel>Volume per green ({unit})</FieldLabel>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {[...selected].sort(sortGreens).map((g) => (
                <div key={g} className="flex items-center gap-2">
                  <span className="font-body text-xs font-semibold text-slate-600 w-20 shrink-0 truncate">{g}</span>
                  <input type="number" step="any" value={vols[g] ?? ''} onChange={(e) => setVol(g, e.target.value)} className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-body bg-white" placeholder="0" />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <FieldLabel>Date</FieldLabel>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
          </div>
          <div>
            <FieldLabel>Unit</FieldLabel>
            <Select value={unit} onChange={setUnit} options={['baskets', 'L', 'gal', 'ft³']} />
          </div>
        </div>
        <div className="mb-3">
          <FieldLabel>Notes (optional)</FieldLabel>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" placeholder="e.g. damp, double-cut" />
        </div>
        {msg && (
          <div className="rounded-xl px-3 py-2 mb-2 font-body text-[12px] font-semibold" style={msg.type === 'ok' ? { backgroundColor: '#E8F3EC', color: FERN } : { backgroundColor: '#FEE2E2', color: '#B91C1C' }}>
            {msg.text}
          </div>
        )}
        <button onClick={save} disabled={busy || entries.length === 0} className="w-full py-2.5 rounded-xl text-sm font-bold font-body text-white disabled:opacity-50" style={{ backgroundColor: FOREST }}>
          {busy ? 'Saving…' : `Log ${entries.length || ''} green${entries.length !== 1 ? 's' : ''}`.trim()}
        </button>
        {entries.length === 0 && selected.length > 0 && (
          <p className="font-body text-[11px] text-slate-400 mt-1.5 text-center">Enter a volume for at least one green to save.</p>
        )}
      </div>

      {/* Trend graph per area */}
      {Object.keys(byArea).length > 0 && (
        <div className="space-y-3">
          {Object.entries(byArea).sort((a, b) => sortGreens(a[0], b[0])).map(([area, list]) => {
            const recent = [...list].sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-20)
            const latest = recent[recent.length - 1]
            return (
              <div key={area} className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-body font-semibold text-sm text-slate-900">{area}</p>
                  <p className="font-body text-[10px] text-slate-400">{recent.length} log{recent.length !== 1 ? 's' : ''} · latest {latest?.volume} {latest?.unit}</p>
                </div>
                <TrendChart points={recent.map((c) => ({ date: c.date, value: c.volume }))} unit={latest?.unit || ''} />
              </div>
            )
          })}
        </div>
      )}

      {/* History */}
      <div>
        <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
          <button onClick={() => setFilter('all')} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap" style={filter === 'all' ? { backgroundColor: FERN, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>All</button>
          {Object.keys(byArea).sort(sortGreens).map((a) => (
            <button key={a} onClick={() => setFilter(a)} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap" style={filter === a ? { backgroundColor: FERN, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>{a}</button>
          ))}
        </div>
        {shown.length === 0 ? (
          <div className="bg-white rounded-2xl border border-black/5 p-8 text-center text-slate-400 font-body text-sm">No clipping logs yet.</div>
        ) : (
          <div className="space-y-2">
            {shown.map((c) => (
              <div key={c.id} className="bg-white rounded-2xl border border-black/5 p-3 shadow-sm flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-body text-sm font-semibold text-slate-800 truncate">{c.area}</p>
                  <p className="font-body text-[11px] text-slate-400">{fmtDate(c.date)}{c.notes ? ` · ${c.notes}` : ''}</p>
                </div>
                <p className="font-display text-base font-bold text-slate-900 shrink-0">{c.volume} <span className="font-body text-[11px] font-medium text-slate-400">{c.unit}</span></p>
                <button onClick={() => onDelete(c.id)} className="text-slate-300 hover:text-red-500 transition shrink-0" aria-label="Delete"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── SOIL TESTS + MLSN FERTILITY RECOMMENDATIONS ─────────────────────────────
// Enter a soil test per area, and the app turns it into a plain fertilizer plan
// using the MLSN guidelines (keep each nutrient above a proven floor; feed what
// the plant uses over the year).
const SOIL_STATUS = {
  deficient: { bg: '#FEE2E2', fg: '#B91C1C', bar: '#DC2626', label: 'Below MLSN — build up' },
  maintain: { bg: '#FEF3DD', fg: '#92660D', bar: '#D97706', label: 'OK — feed to maintain' },
  adequate: { bg: '#E8F3EC', fg: FERN, bar: FERN, label: 'Plenty in reserve' },
  notest: { bg: '#F1F5F9', fg: '#64748B', bar: '#CBD5E1', label: 'Not tested' },
}
// MLSN works in Mehlich-3 ppm (elemental). Some labs (e.g. Logan Labs) report in
// lb/acre, with phosphorus as P₂O₅. Convert entered values to ppm so the engine
// stays consistent no matter which report the user is reading from.
//   ppm = lb/acre ÷ 2  ·  elemental P = P₂O₅ × 0.4364
const LBAC_TO_PPM = 0.5
const P2O5_TO_P = 0.4364
function convertSoilToPpm(form) {
  const n = (v) => (v === '' || v == null || isNaN(Number(v)) ? '' : Number(v))
  const r1 = (v) => (v === '' ? '' : Math.round(v * 10) / 10)
  if (form.units !== 'logan') return { p: form.p, k: form.k, ca: form.ca, mg: form.mg, s: form.s, na: form.na }
  const p = n(form.p), k = n(form.k), ca = n(form.ca), mg = n(form.mg), na = n(form.na)
  return {
    p: r1(p === '' ? '' : p * P2O5_TO_P * LBAC_TO_PPM),
    k: r1(k === '' ? '' : k * LBAC_TO_PPM),
    ca: r1(ca === '' ? '' : ca * LBAC_TO_PPM),
    mg: r1(mg === '' ? '' : mg * LBAC_TO_PPM),
    na: r1(na === '' ? '' : na * LBAC_TO_PPM),
    s: form.s, // Logan reports sulfur (and micros) in ppm already
  }
}

// Plain-English meaning for each soil field, keyed by its form key. Shown on tap
// (iPad) or hover (desktop) so the crew doesn't need to remember the shorthand.
const SOIL_GLOSSARY = {
  p: 'Phosphorus — root development and energy transfer.',
  k: 'Potassium — wear/heat/drought tolerance and water regulation.',
  ca: 'Calcium — cell-wall strength and root growth.',
  mg: 'Magnesium — the core of chlorophyll (green colour).',
  s: 'Sulfur — proteins and chlorophyll; mildly acidifying.',
  ph: 'pH — acidity/alkalinity. Ideal ~6.0–6.5; drives how available other nutrients are.',
  cec: 'CEC / TEC — the soil’s nutrient-holding capacity. Low (≈ sand) means nutrients leach.',
  om: 'Organic Matter — decomposed material; helps hold moisture and nutrients.',
  na: 'Sodium — too much harms soil structure and roots; flush it on sand.',
  fe: 'Iron — deep green colour without pushing extra growth.',
  mn: 'Manganese — enzyme and chlorophyll function.',
  cu: 'Copper — enzyme function; deficiency is rare.',
  zn: 'Zinc — growth hormones and enzymes.',
  b: 'Boron — cell walls and growing points; needed in tiny amounts.',
  bsCa: 'Calcium base saturation — % of the soil’s exchange sites held by calcium.',
  bsMg: 'Magnesium base saturation — % of exchange sites held by magnesium.',
  bsK: 'Potassium base saturation — % of exchange sites held by potassium.',
  bsNa: 'Sodium base saturation — % held by sodium; keep this low.',
  bsH: 'Exchangeable hydrogen — the acidity-holding portion of the exchange sites.',
}

// A little "i" that reveals a definition on tap (mobile) or hover (desktop).
function InfoTip({ text }) {
  const [open, setOpen] = useState(false)
  if (!text) return null
  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onBlur={() => setOpen(false)}
        className="ml-1 text-slate-300 hover:text-slate-500"
        aria-label="What is this?"
      >
        <Info size={11} />
      </button>
      {open && (
        <span className="absolute z-30 left-0 top-full mt-1 w-44 rounded-lg px-2.5 py-1.5 shadow-lg font-body text-[10px] leading-snug normal-case tracking-normal font-medium" style={{ backgroundColor: '#1A1A16', color: '#F7F5EF' }}>
          {text}
        </span>
      )}
    </span>
  )
}

// A numeric field for the soil form. Defined at module scope (not inside the tab)
// so its identity is stable across renders — otherwise React remounts the input
// on every keystroke and it loses focus after one character.
function SoilNum({ label, ph, value, onChange, tip }) {
  return (
    <div>
      <FieldLabel><span className="inline-flex items-center">{label}<InfoTip text={tip} /></span></FieldLabel>
      <input type="number" step="any" inputMode="decimal" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder={ph} />
    </div>
  )
}

function SoilTestsTab({ soilTests, areas, grassTypes = [], soilTypes = [], courseInfo, onAdd, onUpdate, onDelete }) {
  const greenOptions = greenOptionsFor(courseInfo)
  const areaNames = Object.keys(areas || {})
  // The location can be a settings area (Blue Greens) OR an individual green /
  // hole (Green 5), just like clipping yields — so soil can be tracked per hole.
  const areaOptions = [...areaNames, ...greenOptions.filter((g) => !areaNames.includes(g))]

  // Grass + soil context for a chosen location. Settings areas carry it directly;
  // an individual green inherits from the course's greens settings-area so its
  // plan is still variety/soil-aware.
  const greensSeed = () => {
    const key = areaNames.find((a) => /green/i.test(a))
    return key ? { grasses: areas[key]?.grasses || [], soilType: areas[key]?.soilType || '' } : { grasses: [], soilType: '' }
  }
  const contextFor = (name) => (areas[name] ? { grasses: areas[name].grasses || [], soilType: areas[name].soilType || '' } : greensSeed())

  const seed0 = contextFor(areaOptions[0] || '')
  const blank = { area: areaOptions[0] || '', date: new Date().toISOString().slice(0, 10), annualN: String(suggestedAnnualN(seed0.grasses).n), units: 'ppm', ph: '', bufferPh: '', om: '', cec: '', p: '', k: '', ca: '', mg: '', s: '', na: '', fe: '', mn: '', cu: '', zn: '', b: '', bsCa: '', bsMg: '', bsK: '', bsNa: '', bsH: '', lab: '', notes: '', grasses: seed0.grasses, soilType: seed0.soilType }
  const [showMicros, setShowMicros] = useState(false)
  const [showBaseSat, setShowBaseSat] = useState(false)
  const [form, setForm] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null) // soil test being edited, or null for a new one
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  // Load an existing test into the form for editing. Stored values are already
  // ppm, so edit in ppm mode (no re-conversion).
  const editTest = (t) => {
    setForm({
      area: t.area, date: t.date || new Date().toISOString().slice(0, 10), units: 'ppm',
      annualN: t.annualN != null ? String(t.annualN) : '',
      ph: t.ph ?? '', bufferPh: t.bufferPh ?? '', om: t.om ?? '', cec: t.cec ?? '',
      p: t.p ?? '', k: t.k ?? '', ca: t.ca ?? '', mg: t.mg ?? '', s: t.s ?? '', na: t.na ?? '',
      fe: t.micros?.fe ?? '', mn: t.micros?.mn ?? '', cu: t.micros?.cu ?? '', zn: t.micros?.zn ?? '', b: t.micros?.b ?? '',
      bsCa: t.baseSat?.ca ?? '', bsMg: t.baseSat?.mg ?? '', bsK: t.baseSat?.k ?? '', bsNa: t.baseSat?.na ?? '', bsH: t.baseSat?.h ?? '',
      lab: t.lab ?? '', notes: t.notes ?? '', grasses: t.grasses ?? [], soilType: t.soilType ?? '',
    })
    setEditingId(t.id)
    setShowForm(true)
    setMsg(null)
  }
  const openNew = () => { setForm(blank); setEditingId(null); setShowForm(true); setMsg(null) }
  const toggleGrass = (g) => setForm((f) => ({ ...f, grasses: (f.grasses || []).includes(g) ? f.grasses.filter((x) => x !== g) : [...(f.grasses || []), g] }))

  const nSuggest = suggestedAnnualN(form.grasses || [])

  // When the location changes, pull in its grass + soil context and re-suggest N
  // (unless the user hand-typed an N value).
  const pickArea = (v) => setForm((f) => {
    const ctx = contextFor(v)
    const wasSuggested = f.annualN === '' || f.annualN === String(suggestedAnnualN(f.grasses || []).n)
    return { ...f, area: v, grasses: ctx.grasses, soilType: ctx.soilType, annualN: wasSuggested ? String(suggestedAnnualN(ctx.grasses).n) : f.annualN }
  })

  const save = async () => {
    if (!form.area || !form.date) { setMsg({ type: 'err', text: 'Pick a location and a date first.' }); return }
    setBusy(true); setMsg(null)
    try {
      // Store macronutrients as ppm so the engine is unit-agnostic; sodium and
      // micros ride in `extras` for the record (they don't drive the MLSN plan).
      const conv = convertSoilToPpm(form)
      const payload = { ...form, ...conv, extras: {
        na: conv.na, fe: form.fe, mn: form.mn, cu: form.cu, zn: form.zn, b: form.b,
        baseSat: { ca: form.bsCa, mg: form.bsMg, k: form.bsK, na: form.bsNa, h: form.bsH },
      } }
      if (editingId) await onUpdate({ ...payload, id: editingId })
      else await onAdd(payload)
      setForm((f) => ({ ...blank, area: f.area, grasses: f.grasses, soilType: f.soilType, annualN: f.annualN, units: f.units }))
      setShowForm(false)
      setMsg({ type: 'ok', text: editingId ? `Soil test updated for ${form.area}.` : `Soil test saved for ${form.area}.` })
      setEditingId(null)
    } catch (e) {
      console.error(e)
      setMsg({ type: 'err', text: saveErrorText(e, 'supabase/phase12.sql') })
    }
    setBusy(false)
  }

  // Group everything by course section (Greens / Tees / Fairways / …) for tabs.
  // Always show the common sections, plus any others that have data.
  const presentSections = SECTION_ORDER.filter((sec) => soilTests.some((t) => soilSection(t.area) === sec))
  const sections = SECTION_ORDER.filter((sec) => DEFAULT_SECTIONS.includes(sec) || presentSections.includes(sec))
  const [section, setSection] = useState(null)
  const [trendKey, setTrendKey] = useState('k')
  const [areaPick, setAreaPick] = useState('all') // 'all' = whole section, else one hole
  const activeSection = section && sections.includes(section) ? section : (presentSections[0] || 'Greens')
  const sectionTests = soilTests.filter((t) => soilSection(t.area) === activeSection)

  // Holes/areas that have tests in this section, for the individual-area picker.
  const sectionAreas = [...new Set(sectionTests.map((t) => t.area))].sort(sortGreens)
  const pick = areaPick !== 'all' && sectionAreas.includes(areaPick) ? areaPick : 'all'
  const viewTests = pick === 'all' ? sectionTests : sectionTests.filter((t) => t.area === pick)

  // Latest test per hole/area in view...
  const latestByArea = {}
  viewTests.forEach((t) => { if (!latestByArea[t.area]) latestByArea[t.area] = t })
  const latest = Object.values(latestByArea)
  // ...combined into ONE reading (the whole section averaged, or a single hole).
  const sectionAvg = latest.length ? averageTests(latest, pick === 'all' ? activeSection : pick) : null

  // Trend: one point per test date, averaged across whatever is in view.
  // Every metric that gets entered is graphable (accessor handles nested fields).
  const TREND_KEYS = [
    { k: 'ph', label: 'pH', val: (t) => t.ph },
    { k: 'om', label: 'OM%', val: (t) => t.om, unit: '%' },
    { k: 'cec', label: 'CEC', val: (t) => t.cec },
    { k: 'p', label: 'P', val: (t) => t.p, floor: MLSN.P },
    { k: 'k', label: 'K', val: (t) => t.k, floor: MLSN.K },
    { k: 'ca', label: 'Ca', val: (t) => t.ca, floor: MLSN.Ca },
    { k: 'mg', label: 'Mg', val: (t) => t.mg, floor: MLSN.Mg },
    { k: 's', label: 'S', val: (t) => t.s, floor: MLSN.S },
    { k: 'na', label: 'Na', val: (t) => t.na },
  ]
  const trendDef = TREND_KEYS.find((x) => x.k === trendKey) || TREND_KEYS[4]
  const seriesForDef = (def, tests) => {
    const byDate = {}
    tests.forEach((t) => { (byDate[t.date] ||= []).push(t) })
    return Object.keys(byDate).sort().map((d) => {
      const nums = byDate[d].map(def.val).filter((v) => v != null && v !== '' && !isNaN(Number(v))).map(Number)
      return { date: d, value: nums.length ? Math.round((nums.reduce((s, v) => s + v, 0) / nums.length) * 100) / 100 : null }
    }).filter((p) => p.value != null)
  }
  const trendSeries = seriesForDef(trendDef, viewTests)

  // Render a numeric field bound to a form key. Called as a function (not <Num/>)
  // so it renders the stable module-level SoilNum directly and keeps focus.
  const num = (k, label, ph) => <SoilNum key={k} label={label} ph={ph} tip={SOIL_GLOSSARY[k]} value={form[k]} onChange={(v) => set(k, v)} />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-display text-lg font-semibold text-slate-900">Soil Tests</p>
          <p className="font-body text-[11px] text-slate-400">Enter lab results in ppm (Mehlich-3) — the app builds an MLSN fertility plan.</p>
        </div>
        <button onClick={() => { if (showForm) { setShowForm(false); setEditingId(null) } else openNew() }} className="font-body text-xs font-bold px-3.5 py-2 rounded-full text-white flex items-center gap-1.5 shrink-0" style={{ backgroundColor: FOREST }}>
          <Plus size={14} /> {showForm ? 'Close' : 'Add test'}
        </button>
      </div>

      {msg && (
        <div className="rounded-xl px-3 py-2 font-body text-[12px] font-semibold" style={msg.type === 'ok' ? { backgroundColor: '#E8F3EC', color: FERN } : { backgroundColor: '#FEE2E2', color: '#B91C1C' }}>{msg.text}</div>
      )}

      {showForm && (
        <div className="bg-white rounded-2xl border-2 p-4 shadow-sm" style={{ borderColor: GOLD }}>
          {editingId && <p className="font-display text-base font-semibold text-slate-900 mb-2">Edit soil test — {form.area}</p>}
          <div className="mb-3">
            <FieldLabel>Where was this sampled?</FieldLabel>
            {areaNames.length > 0 && (
              <>
                <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400 mt-1 mb-1">Areas</p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {areaNames.map((a) => {
                    const on = form.area === a
                    return <button key={a} type="button" onClick={() => pickArea(a)} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full transition border" style={on ? { backgroundColor: FOREST, color: 'white', borderColor: FOREST } : { backgroundColor: 'white', color: '#64748B', borderColor: '#E2E8F0' }}>{a}</button>
                  })}
                </div>
              </>
            )}
            <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Greens / holes</p>
            <div className="flex flex-wrap gap-1.5">
              {greenOptions.map((g) => {
                const on = form.area === g
                return <button key={g} type="button" onClick={() => pickArea(g)} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full transition border" style={on ? { backgroundColor: FERN, color: 'white', borderColor: FERN } : { backgroundColor: 'white', color: '#64748B', borderColor: '#E2E8F0' }}>{g.replace('Green ', '#')}</button>
              })}
            </div>
          </div>

          <div className="mb-3">
            <FieldLabel>Test date</FieldLabel>
            <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
          </div>

          <div className="rounded-xl p-3 mb-3" style={{ backgroundColor: '#F5FAF6' }}>
            <p className="font-body text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: FERN }}>Grass &amp; soil (drives the plan)</p>
            <p className="font-body text-[10px] text-slate-400 mb-2">Prefilled from the area — adjust for an individual hole. Grass sets the N target; sandy soil bumps K &amp; S.</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {grassTypes.map((g) => {
                const on = (form.grasses || []).includes(g)
                return (
                  <button key={g} type="button" onClick={() => toggleGrass(g)} className="font-body text-[11px] font-semibold px-2.5 py-1 rounded-full transition border" style={on ? { backgroundColor: FERN, color: 'white', borderColor: FERN } : { backgroundColor: 'white', color: '#64748B', borderColor: '#E2E8F0' }}>{g}</button>
                )
              })}
              {grassTypes.length === 0 && <span className="font-body text-[11px] text-slate-400">Add grass types in Settings → Lists.</span>}
            </div>
            <Select value={form.soilType || ''} onChange={(v) => set('soilType', v)} options={soilTypes} placeholder="Soil type (optional)" />
          </div>

          <div className="rounded-xl p-3 mb-3" style={{ backgroundColor: '#F0F6F2' }}>
            <div className="flex items-center justify-between mb-2 gap-2">
              <p className="font-body text-[11px] font-bold uppercase tracking-wide" style={{ color: FERN }}>Nutrients</p>
              <div className="flex rounded-full overflow-hidden border" style={{ borderColor: '#CFE0D5' }}>
                {[['ppm', 'ppm (Mehlich-3)'], ['logan', 'lb/ac (Logan)']].map(([k, l]) => (
                  <button key={k} type="button" onClick={() => set('units', k)} className="font-body text-[10px] font-bold px-2.5 py-1 transition" style={form.units === k ? { backgroundColor: FERN, color: 'white' } : { backgroundColor: 'white', color: FERN }}>{l}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {num('p', form.units === 'logan' ? 'P₂O₅' : 'P', form.units === 'logan' ? 'lb/ac' : 'ppm')}
              {num('k', 'K', form.units === 'logan' ? 'lb/ac' : 'ppm')}
              {num('ca', 'Ca', form.units === 'logan' ? 'lb/ac' : 'ppm')}
              {num('mg', 'Mg', form.units === 'logan' ? 'lb/ac' : 'ppm')}
              {num('s', 'S', 'ppm')}
            </div>
            {form.units === 'logan' && (
              <p className="font-body text-[10px] text-slate-400 mt-2">Logan reports P as P₂O₅ and K/Ca/Mg in lb/acre — the app converts them to ppm on save (sulfur is already ppm). Use the “Value Found” numbers.</p>
            )}
          </div>

          <div className="rounded-xl p-3 mb-3" style={{ backgroundColor: '#F8FAFC' }}>
            <p className="font-body text-[11px] font-bold uppercase tracking-wide mb-2 text-slate-500">Soil chemistry</p>
            <div className="grid grid-cols-4 gap-2.5">
              {num('ph', 'pH', '6.3')}
              {num('cec', 'CEC / TEC', 'opt.')}
              {num('om', 'OM %', 'opt.')}
              {num('na', 'Na', form.units === 'logan' ? 'lb/ac' : 'ppm')}
            </div>
          </div>

          <div className="rounded-xl p-3 mb-3" style={{ backgroundColor: '#FBF7EF' }}>
            <button type="button" onClick={() => setShowMicros((v) => !v)} className="w-full flex items-center justify-between">
              <span className="font-body text-[11px] font-bold uppercase tracking-wide" style={{ color: '#92660D' }}>Micronutrients (ppm) — optional</span>
              <ChevronRight size={14} className="text-slate-400" style={{ transform: showMicros ? 'rotate(90deg)' : 'none' }} />
            </button>
            {showMicros && (
              <div className="grid grid-cols-5 gap-2 mt-2">
                {num('fe', 'Fe', 'ppm')}
                {num('mn', 'Mn', 'ppm')}
                {num('cu', 'Cu', 'ppm')}
                {num('zn', 'Zn', 'ppm')}
                {num('b', 'B', 'ppm')}
              </div>
            )}
          </div>

          <div className="rounded-xl p-3 mb-3" style={{ backgroundColor: '#F1F5F9' }}>
            <button type="button" onClick={() => setShowBaseSat((v) => !v)} className="w-full flex items-center justify-between">
              <span className="font-body text-[11px] font-bold uppercase tracking-wide text-slate-500">Base saturation (%) — optional</span>
              <ChevronRight size={14} className="text-slate-400" style={{ transform: showBaseSat ? 'rotate(90deg)' : 'none' }} />
            </button>
            {showBaseSat && (
              <div className="grid grid-cols-5 gap-2 mt-2">
                {num('bsCa', 'Ca', '%')}
                {num('bsMg', 'Mg', '%')}
                {num('bsK', 'K', '%')}
                {num('bsNa', 'Na', '%')}
                {num('bsH', 'H', '%')}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <FieldLabel>Annual N target (lb / M / yr)</FieldLabel>
              <input type="number" step="any" value={form.annualN ?? ''} onChange={(e) => set('annualN', e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="e.g. 4" />
              <p className="font-body text-[10px] text-slate-400 mt-1">{nSuggest.matched ? `Typical for ${(form.grasses || []).join(', ')}: ${nSuggest.n} — adjust as needed.` : 'Set your season N goal for this area.'}</p>
            </div>
            <div>
              <FieldLabel>Lab (optional)</FieldLabel>
              <input value={form.lab} onChange={(e) => set('lab', e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="e.g. Waypoint" />
            </div>
          </div>
          <div className="mb-3">
            <FieldLabel>Notes (optional)</FieldLabel>
            <input value={form.notes} onChange={(e) => set('notes', e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="e.g. sampled greens 0–4 inch" />
          </div>
          <p className="font-body text-[10px] text-slate-400 mb-3">Annual N drives how much nutrient the plant will use over the year. The recommendation keeps each nutrient at or above its MLSN floor (P {MLSN.P}, K {MLSN.K}, Ca {MLSN.Ca}, Mg {MLSN.Mg}, S {MLSN.S} ppm) while covering that use.</p>
          <button onClick={save} disabled={busy} className="w-full py-2.5 rounded-xl text-sm font-bold font-body text-white disabled:opacity-50" style={{ backgroundColor: FOREST }}>{busy ? 'Saving…' : editingId ? 'Update soil test' : 'Save soil test'}</button>
        </div>
      )}

      {/* Section tabs — Greens / Tees / Fairways / … (always shown) */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {sections.map((sec) => {
          const has = presentSections.includes(sec)
          return (
            <button key={sec} onClick={() => setSection(sec)} className="font-body text-xs font-bold px-3.5 py-2 rounded-full whitespace-nowrap transition" style={sec === activeSection ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: has ? '#64748B' : '#B4BAC4', border: '1px solid rgba(0,0,0,0.08)' }}>
              {sec}
            </button>
          )
        })}
      </div>

      {/* Area picker — whole section average, or one hole on its own */}
      {sectionAreas.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mt-1">
          <button onClick={() => setAreaPick('all')} className="font-body text-[11px] font-bold px-3 py-1.5 rounded-full whitespace-nowrap transition" style={pick === 'all' ? { backgroundColor: FERN, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>All (avg)</button>
          {sectionAreas.map((a) => (
            <button key={a} onClick={() => setAreaPick(a)} className="font-body text-[11px] font-bold px-3 py-1.5 rounded-full whitespace-nowrap transition" style={pick === a ? { backgroundColor: FERN, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>{a.replace('Green ', '#')}</button>
          ))}
        </div>
      )}

      {sectionAvg ? (
        <>
          {/* One combined reading — the whole section averaged, or a single hole */}
          <SoilRecCard test={sectionAvg} area={resolveArea(areas, latest[0]?.area)} titleOverride={pick === 'all' ? `${activeSection} — average of ${sectionAvg.count} sample${sectionAvg.count !== 1 ? 's' : ''}` : pick} />

          {/* Trend graph — pick any metric; the card stays put so you can switch */}
          <div className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <p className="font-body text-sm font-semibold text-slate-900">{pick === 'all' ? activeSection : pick} trend</p>
              <p className="font-body text-[10px] text-slate-400">{pick === 'all' ? `avg across ${activeSection.toLowerCase()} each test` : 'this location over time'}</p>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {TREND_KEYS.map((t) => (
                <button key={t.k} onClick={() => setTrendKey(t.k)} className="font-body text-[11px] font-semibold px-2.5 py-1 rounded-full transition" style={t.k === trendKey ? { backgroundColor: FERN, color: 'white' } : { backgroundColor: '#F0F6F2', color: FERN }}>{t.label}</button>
              ))}
            </div>
            {trendSeries.length === 0 ? (
              <p className="font-body text-[12px] text-slate-400 py-4 text-center">No {trendDef.label} entered on these tests yet.</p>
            ) : (
              <>
                <TrendChart points={trendSeries} unit={trendDef.unit || 'ppm'} refLine={trendDef.floor ? { value: trendDef.floor, label: `MLSN ${trendDef.floor}` } : null} />
                {trendSeries.length < 2 && <p className="font-body text-[10px] text-slate-400 mt-1.5 text-center">Add another test date to draw the trend line.</p>}
              </>
            )}
          </div>

          {/* The individual samples that make up this section (to review / delete) */}
          <div className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm">
            <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">Samples in {activeSection.toLowerCase()}</p>
            <div className="space-y-1.5">
              {latest.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2">
                  <span className="font-body text-sm text-slate-700 truncate flex-1">{t.area}</span>
                  <span className="font-body text-[11px] text-slate-400 shrink-0">{fmtDate(t.date)}</span>
                  <button onClick={() => editTest(t)} className="font-body text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0" style={{ backgroundColor: '#F0F6F2', color: FERN }}>Edit</button>
                  <button onClick={() => onDelete(t.id)} className="text-slate-300 hover:text-red-500 transition shrink-0" aria-label="Delete"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        !showForm && <div className="bg-white rounded-2xl border border-black/5 p-8 text-center text-slate-400 font-body text-sm">No soil tests in {activeSection} yet. Tap “Add test” and pick a {activeSection === 'Greens' ? 'green/hole' : activeSection.toLowerCase().replace(/s$/, '')}.</div>
      )}
    </div>
  )
}

function SoilRecCard({ test, area = {}, onDelete, titleOverride }) {
  // Prefer the grass/soil captured on the test (works for per-hole tests); fall
  // back to the settings area if an older test didn't store it.
  const grasses = (test.grasses && test.grasses.length ? test.grasses : area.grasses) || []
  const soilType = test.soilType || area.soilType || ''
  const rec = recommend(test, test.annualN, { grasses, soilType })
  const tested = rec.rows.filter((r) => r.status !== 'notest')
  const context = [grasses.join(', '), soilType].filter(Boolean).join(' · ')
  return (
    <div className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="font-body text-sm font-semibold text-slate-900 truncate">{titleOverride || test.area}</p>
          <p className="font-body text-[11px] text-slate-400">{test.date ? `Latest ${fmtDate(test.date)}` : ''}{test.lab ? ` · ${test.lab}` : ''} · N {rec.annualN} lb/M/yr{rec.nSource === 'grass' ? ' (from grass)' : ''}</p>
          {context && <p className="font-body text-[10px] text-slate-400 truncate">{context}</p>}
        </div>
        {onDelete && <button onClick={() => onDelete(test.id)} className="text-slate-300 hover:text-red-500 transition shrink-0" aria-label="Delete"><Trash2 size={15} /></button>}
      </div>

      {rec.soil?.note && (
        <div className="rounded-xl px-3 py-2 mb-2 font-body text-[11px]" style={{ backgroundColor: rec.soil.sandy ? '#FEF3DD' : '#F0F6F2', color: rec.soil.sandy ? '#92660D' : FERN }}>
          {rec.soil.note}
        </div>
      )}

      {rec.ph && (
        <div className="rounded-xl px-3 py-2 mb-3 font-body text-[12px]" style={{ backgroundColor: rec.ph.status === 'ok' ? '#E8F3EC' : '#FEF3DD', color: rec.ph.status === 'ok' ? FERN : '#92660D' }}>
          {rec.ph.text}
        </div>
      )}

      {tested.length === 0 ? (
        <p className="font-body text-[12px] text-slate-400">No nutrient values entered on this test.</p>
      ) : (
        <div className="space-y-2.5">
          {tested.map((r) => {
            const st = SOIL_STATUS[r.status]
            return (
              <div key={r.key}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-body text-sm font-semibold text-slate-800">{r.label}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {r.applyLbM > 0 && <span className="font-body text-[12px] font-bold" style={{ color: st.fg }}>Apply {r.applyLbM} lb/M</span>}
                    <span className="font-body text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: st.bg, color: st.fg }}>{st.label}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(3, Math.min(100, Math.round((r.soilPpm / (r.mlsnPpm * 2)) * 100)))}%`, backgroundColor: st.bar }} />
                  </div>
                  <span className="font-body text-[10px] text-slate-400 shrink-0 w-24 text-right">{r.soilPpm} / {r.mlsnPpm} ppm min</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {(() => {
        const na = test.na
        const hasNa = na != null && na !== ''
        const highNa = hasNa && Number(na) >= 50
        const micros = test.micros || {}
        const microChips = Object.entries({ Fe: micros.fe, Mn: micros.mn, Cu: micros.cu, Zn: micros.zn, B: micros.b }).filter(([, v]) => v != null && v !== '')
        if (!hasNa && microChips.length === 0) return null
        return (
          <div className="mt-3 pt-3 border-t border-slate-100">
            {hasNa && (
              <div className="rounded-xl px-3 py-2 mb-2 font-body text-[11px]" style={highNa ? { backgroundColor: '#FEF3DD', color: '#92660D' } : { backgroundColor: '#F8FAFC', color: '#64748B' }}>
                Sodium {na} ppm{highNa ? ' — elevated for a sand green; flush with irrigation and consider gypsum to displace it.' : ' — in a comfortable range.'}
              </div>
            )}
            {microChips.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                <span className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400 self-center">Micros:</span>
                {microChips.map(([k, v]) => (
                  <span key={k} className="font-body text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: '#FBF7EF', color: '#92660D' }}>{k} {v}</span>
                ))}
              </div>
            )}
          </div>
        )
      })()}

      {(() => {
        const bs = baseSaturation(test.baseSat || {})
        if (bs.length === 0) return null
        const tone = { ok: { bg: '#E8F3EC', fg: FERN }, low: { bg: '#FEF3DD', fg: '#92660D' }, high: { bg: '#FEE2E2', fg: '#B91C1C' } }
        return (
          <div className="mt-3 pt-3 border-t border-slate-100">
            <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Base saturation (ideal band)</p>
            <div className="flex flex-wrap gap-1.5">
              {bs.map((r) => {
                const t = tone[r.status] || tone.ok
                const range = r.key === 'na' ? `<${r.hi}%` : `${r.lo}–${r.hi}%`
                return <span key={r.key} className="font-body text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: t.bg, color: t.fg }}>{r.label} {r.value}% <span className="opacity-60">({range})</span></span>
              })}
            </div>
            <p className="font-body text-[9px] text-slate-400 mt-1.5">Informational — MLSN drives the plan above, not base saturation.</p>
          </div>
        )
      })()}

      <p className="font-body text-[10px] text-slate-400 mt-3">MLSN plan — “Apply” is pounds of the nutrient per 1,000 sq ft for the year. Split it across your fertilizer applications. Guidance only; pair with agronomic judgment.</p>
    </div>
  )
}

// ── CULTURAL PRACTICES ──────────────────────────────────────────────────────
// Log the non-spray work — mow, roll, topdress, aerify and the rest — across
// several areas at once, so the record shows everything that touched the turf,
// not just chemicals.
const PRACTICE_OPTIONS = ['Mow', 'Roll', 'Brush', 'Groom', 'Verticut', 'Topdress', 'Aerify', 'Spike/Slice', 'Blow/Drag', 'Water-in']
function PracticesTab({ practices, areas, onAddMany, onDelete }) {
  const areaNames = Object.keys(areas || {})
  const [practice, setPractice] = useState('Mow')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [selected, setSelected] = useState([])
  const [value, setValue] = useState('')
  const [unit, setUnit] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('all')
  const [msg, setMsg] = useState(null) // { type: 'ok' | 'err', text }

  const toggleArea = (a) => setSelected((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]))
  const allOn = selected.length === areaNames.length && areaNames.length > 0
  const toggleAll = () => setSelected(allOn ? [] : [...areaNames])

  const save = async () => {
    if (selected.length === 0) return
    setBusy(true)
    setMsg(null)
    try {
      await onAddMany(selected.map((a) => ({ area: a, practice, date, value: value === '' ? null : Number(value), unit, notes })))
      setValue(''); setNotes('')
      setMsg({ type: 'ok', text: `Logged ${practice} on ${selected.length} area${selected.length !== 1 ? 's' : ''}.` })
      // keep the practice + selected areas ready for the next log
    } catch (e) {
      console.error(e)
      setMsg({ type: 'err', text: practiceErrorText(e) })
    }
    setBusy(false)
  }

  const shown = filter === 'all' ? practices : practices.filter((p) => p.practice === filter)
  const usedPractices = [...new Set(practices.map((p) => p.practice))]
  // Last-14-days count per practice, for the quick summary strip.
  const cutoff = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)
  const recentCounts = {}
  practices.filter((p) => p.date >= cutoff).forEach((p) => { recentCounts[p.practice] = (recentCounts[p.practice] || 0) + 1 })
  const summary = Object.entries(recentCounts).sort((a, b) => b[1] - a[1])

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border-2 p-4 shadow-sm" style={{ borderColor: GOLD }}>
        <p className="font-display text-base font-semibold text-slate-900 mb-1">Log a practice</p>
        <p className="font-body text-[11px] text-slate-400 mb-3">Pick what you did and every area it happened on — logs them all at once.</p>

        <FieldLabel>Practice</FieldLabel>
        <div className="flex flex-wrap gap-1.5 mt-1 mb-3">
          {PRACTICE_OPTIONS.map((p) => {
            const on = practice === p
            return (
              <button key={p} type="button" onClick={() => setPractice(p)} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full transition border" style={on ? { backgroundColor: FOREST, color: 'white', borderColor: FOREST } : { backgroundColor: 'white', color: '#64748B', borderColor: '#E2E8F0' }}>
                {p}
              </button>
            )
          })}
        </div>

        <div className="flex items-center justify-between mb-1">
          <FieldLabel>Areas</FieldLabel>
          {areaNames.length > 0 && (
            <button type="button" onClick={toggleAll} className="font-body text-[11px] font-bold" style={{ color: FERN }}>{allOn ? 'Clear all' : 'Select all'}</button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 mt-1 mb-3">
          {areaNames.map((a) => {
            const on = selected.includes(a)
            return (
              <button key={a} type="button" onClick={() => toggleArea(a)} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full transition border" style={on ? { backgroundColor: FERN, color: 'white', borderColor: FERN } : { backgroundColor: 'white', color: '#64748B', borderColor: '#E2E8F0' }}>
                {a}
              </button>
            )
          })}
          {areaNames.length === 0 && <p className="font-body text-xs text-slate-400">Add areas in Spray Ops → Settings first.</p>}
        </div>

        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <FieldLabel>Date</FieldLabel>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
          </div>
          <div>
            <FieldLabel>Amount (opt.)</FieldLabel>
            <input type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" placeholder="e.g. 2" />
          </div>
          <div>
            <FieldLabel>Unit (opt.)</FieldLabel>
            <input value={unit} onChange={(e) => setUnit(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" placeholder="passes, lbs/M" />
          </div>
        </div>
        <div className="mb-3">
          <FieldLabel>Notes (optional)</FieldLabel>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" placeholder="e.g. .100 HOC, double-cut, sand topdress" />
        </div>
        {msg && (
          <div className="rounded-xl px-3 py-2 mb-2 font-body text-[12px] font-semibold" style={msg.type === 'ok' ? { backgroundColor: '#E8F3EC', color: FERN } : { backgroundColor: '#FEE2E2', color: '#B91C1C' }}>
            {msg.text}
          </div>
        )}
        <button onClick={save} disabled={busy || selected.length === 0} className="w-full py-2.5 rounded-xl text-sm font-bold font-body text-white disabled:opacity-50" style={{ backgroundColor: FOREST }}>
          {busy ? 'Saving…' : `Log ${practice}${selected.length ? ` · ${selected.length} area${selected.length !== 1 ? 's' : ''}` : ''}`}
        </button>
      </div>

      {summary.length > 0 && (
        <div className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm">
          <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">Last 14 days</p>
          <div className="flex flex-wrap gap-1.5">
            {summary.map(([p, n]) => (
              <span key={p} className="font-body text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: '#F0F6F2', color: FERN }}>{p} · {n}</span>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
          <button onClick={() => setFilter('all')} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap" style={filter === 'all' ? { backgroundColor: FERN, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>All</button>
          {usedPractices.map((p) => (
            <button key={p} onClick={() => setFilter(p)} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap" style={filter === p ? { backgroundColor: FERN, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>{p}</button>
          ))}
        </div>
        {shown.length === 0 ? (
          <div className="bg-white rounded-2xl border border-black/5 p-8 text-center text-slate-400 font-body text-sm">No practices logged yet.</div>
        ) : (
          <div className="space-y-2">
            {shown.map((p) => (
              <div key={p.id} className="bg-white rounded-2xl border border-black/5 p-3 shadow-sm flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-body text-sm font-semibold text-slate-800 truncate">{p.practice} · {p.area}</p>
                  <p className="font-body text-[11px] text-slate-400 truncate">{fmtDate(p.date)}{p.value != null ? ` · ${p.value}${p.unit ? ` ${p.unit}` : ''}` : ''}{p.notes ? ` · ${p.notes}` : ''}</p>
                </div>
                <button onClick={() => onDelete(p.id)} className="text-slate-300 hover:text-red-500 transition shrink-0" aria-label="Delete"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── SOIL-TEMP APPLICATION TIMING ────────────────────────────────────────────
const MONTH_ABBR = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthRange = (months = []) => (months.length ? `${MONTH_ABBR[months[0]]}–${MONTH_ABBR[months[months.length - 1]]}` : '')
const TIMING_STATUS_STYLE = {
  now: { bg: '#E8F3EC', fg: '#2C5238', dot: '#3A6B4A', label: 'Apply now' },
  soon: { bg: '#FEF3DD', fg: '#7A5E12', dot: '#C9A84C', label: 'Getting close' },
  later: { bg: '#F1F5F9', fg: '#64748B', dot: '#CBD5E1', label: 'Not yet' },
  passed: { bg: '#F3E0D9', fg: '#8A3520', dot: '#B4553D', label: 'Window passed' },
  offseason: { bg: '#F8FAFC', fg: '#94A3B8', dot: '#E2E8F0', label: 'Out of season' },
  unknown: { bg: '#F1F5F9', fg: '#64748B', dot: '#CBD5E1', label: '—' },
}
function TimingTab({ soilSeries, hasLocation }) {
  if (!hasLocation) return <ComingSoonCard title="Set your location first" desc="Soil temperature comes from your course location. Add it in Spray Ops → Settings → Location, then come back." />
  const soilNow = currentSoilTemp(soilSeries)
  const trend = soilTrend(soilSeries)
  // Show every window here (including out-of-season), so the whole list is visible.
  const timings = applicationTimings(soilNow, trend, new Date(), {}, true)
  const recent = (soilSeries || []).slice(-30).map((d) => ({ date: d.date, value: d.soil != null ? d.soil : d.temp }))

  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-4 text-white shadow-sm flex items-center justify-between flex-wrap gap-3" style={{ backgroundColor: FOREST }}>
        <div>
          <p className="font-body text-[11px] font-bold uppercase tracking-wide opacity-70">Soil temperature · 2&quot;</p>
          <p className="font-display text-3xl font-bold mt-0.5">{soilNow != null ? `${soilNow}°F` : '—'}</p>
        </div>
        <span className="font-body text-xs font-bold px-3 py-1.5 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}>
          {trend === 'rising' ? '↑ Warming' : trend === 'falling' ? '↓ Cooling' : '→ Holding'}
        </span>
      </div>

      {recent.length >= 2 && (
        <div className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm">
          <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">Soil temp · last {recent.length} days</p>
          <TrendChart points={recent} unit="°F" />
        </div>
      )}

      {timings.length === 0 ? (
        <div className="bg-white rounded-2xl border border-black/5 p-8 text-center text-slate-400 font-body text-sm">No application windows in season right now.</div>
      ) : (
        <div className="space-y-2">
          {timings.map((t) => {
            const st = TIMING_STATUS_STYLE[t.status] || TIMING_STATUS_STYLE.unknown
            return (
              <div key={t.id} className="bg-white rounded-2xl border border-black/5 p-3.5 shadow-sm">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-body text-sm font-semibold text-slate-800 truncate">{t.label}</span>
                  <span className="font-body text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 shrink-0" style={{ backgroundColor: st.bg, color: st.fg }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: st.dot }} />{st.label}
                  </span>
                </div>
                <p className="font-body text-[11px] text-slate-400">Trigger ~{t.threshold}°F ({t.direction === 'falling' ? 'cooling' : 'warming'}){t.months ? ` · ${monthRange(t.months)}` : ''} · {t.note}</p>
              </div>
            )
          })}
        </div>
      )}
      <p className="font-body text-[10px] text-slate-400">Soil temp is a 2-inch estimate from your location. Windows are published transition-zone starting points — pair with your own read and local extension guidance.</p>
    </div>
  )
}

function TurfDashboardPlaceholder() {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-black/5 p-8 text-center shadow-sm">
        <Sprout className="mx-auto mb-3 text-slate-300" size={32} />
        <p className="font-display text-lg font-semibold text-slate-900 mb-1">Turf Performance</p>
        <p className="font-body text-sm text-slate-400 max-w-sm mx-auto">
          This is a separate space from Spray Ops, built to track Growing Degree Days, clipping yields,
          and greens speed — the data needed to fine-tune growth regulator timing for consistent greens.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <ComingSoonMini icon={<TrendingUp size={16} />} label="GDD Tracking" />
        <ComingSoonMini icon={<ClipboardList size={16} />} label="Clipping Yields" />
        <ComingSoonMini icon={<Droplet size={16} />} label="Greens Speed" />
      </div>
    </div>
  )
}

function ComingSoonMini({ icon, label }) {
  return (
    <div className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm flex items-center gap-3">
      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: '#F0F6F2', color: FERN }}>
        {icon}
      </div>
      <div>
        <p className="font-body text-sm font-semibold text-slate-800">{label}</p>
        <p className="font-body text-[11px] text-slate-400">Coming soon</p>
      </div>
    </div>
  )
}

function ComingSoonCard({ title, desc }) {
  return (
    <div className="bg-white rounded-2xl border border-black/5 p-10 text-center shadow-sm">
      <p className="font-display text-lg font-semibold text-slate-900 mb-2">{title}</p>
      <p className="font-body text-sm text-slate-400 max-w-sm mx-auto">{desc}</p>
    </div>
  )
}
