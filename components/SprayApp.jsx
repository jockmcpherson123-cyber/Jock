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
  Check, ChevronRight, ChevronUp, ChevronDown, Cloud, Sprout, ClipboardList, TrendingUp, AlertTriangle,
  Package, Truck, MapPin, Sparkles, Wind, Thermometer, Search, X, Info, Menu, BarChart3, UserPlus, Clock, CloudRain, Image as ImageIcon, BookOpen, Target, Scissors, Gauge, Trophy,
  Sun, CloudSun, CloudDrizzle, CloudSnow, CloudFog, CloudLightning, QrCode, Printer,
} from 'lucide-react'
import {
  uid, convertUnits, unitsAreCompatible, calcAmount, fmtDate, aggregateNPK, npkDiagnostics, rotationByArea, rotationWarnings,
  productUsage, sprayHistory, daysSinceByArea, downloadCSV, productCosts, productRateForN, eiqLoad, measureOut,
} from '@/lib/calc'
import { PRODUCT_TYPES, UNITS, DEFAULT_TARGETS, FORMULATIONS, FORMULATION_LABEL, guessFormulation, effectiveFormulation, sortByMixOrder, mixRank } from '@/lib/defaults'
import * as db from '@/lib/db'
import { fetchCurrent, fetchSeasonDaily, gddFromDaily, gddSince, fetchWeather, dailyFromHourly, sprayWindow, fetchBreakdownTemps, dailyFromForecastBlock, mergeDaily, projectGddReachDate, buildRainYear, weatherCodeInfo } from '@/lib/weather'
import { fungicideLogByArea } from '@/lib/disease'
import { recommend, suggestedAnnualN, baseSaturation, MLSN } from '@/lib/soil'
import { applicationTimings, openWindows, soilTrend, currentSoilTemp, TIMING_WINDOWS } from '@/lib/soiltiming'
import { PROFILES, NUTRIENTS, photoSearchUrl } from '@/lib/knowledge'
import { FERT_AREAS, fertArea } from '@/lib/fertAreas'
import { computeFert, parseAnalysis, fmtNum } from '@/lib/fert'
import { fungicidesFor, ratingsSourceFor, ownedMatch, diseaseIdForTarget, diseasesForProduct } from '@/lib/fungicides'
import { suppressionMap, suppressionKind } from '@/lib/pgr'
import { modelForProduct, regulationStatus, suppressionAt, combinedSuppression, surfaceCol, withTargets, PGR_MODELS, PHASE_STYLE } from '@/lib/pgrmodel'
import { localDateISO } from '@/lib/dates'
import { mixPlan } from '@/lib/mix'
import { sheetApplied } from '@/lib/applied'
import { SearchSelect, MultiSelect } from '@/components/pickers'
import PlaybookModule from '@/components/Playbook'
import MowingRoutes from '@/components/MowingRoutes'
import MowingDirections from '@/components/MowingDirections'
import MowPattern from '@/components/MowPattern'
import { labelledLayout } from '@/lib/mowing'
import { directionForJob, stepLabel, surfaceKind } from '@/lib/mowdir'
import { loadTranslations, txGet } from '@/lib/translate'
import { logout } from '@/app/actions/auth'
import AnnualProgram from '@/components/AnnualProgram'
import WeeklyReport from '@/components/WeeklyReport'
import HocEditor from '@/components/HocEditor'
import WettingAgent from '@/components/WettingAgent'
import Growth from '@/components/Growth'
import Tournament from '@/components/Tournament'
import CourseMap from '@/components/CourseMap'
import IrrigationParts from '@/components/IrrigationParts'
import { qrDataUrl } from '@/lib/tournament'
import SprayCalendar from '@/components/SprayCalendar'
import Weather from '@/components/Weather'

// Build the product's container/jug descriptor for measureOut (if one is set).
const productJug = (prod) => (prod && prod.jugSize > 0 ? { size: Number(prod.jugSize), unit: prod.jugUnit || 'gal' } : null)

// ── PALETTE ───────────────────────────────────────────────────────────────
const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#C9A84C'
const CREAM = '#F7F5EF'
const INK = '#1A1A16'
// Clubhouse × Instrument restyle: "soft stone" surfaces + warm-neutral inks
// (warmth dialled out). Mirrors the CSS tokens in globals.css so inline styles
// stay in sync.
const PAPER = '#F9F8F5'
const PAPER_2 = '#E8E7E2'
const HAIR = '#E2E0DB'
const INK_2 = '#5B6160'
const INK_3 = '#8A8984'
const GOLD_SOFT = '#B9982F' // toned-down gold for decorative hairlines

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
  // Never let a Greens sheet borrow a Fairway's nozzle/rate: when the name has a
  // recognizable section, fuzzy matches must stay in that same section. Only if
  // no same-section area exists at all do we fall back to any match.
  const wantSec = soilSection(name)
  const sameSec = (x) => wantSec === 'Other' || soilSection(x) === wantSec
  const match = (pool) =>
    pool.find((x) => x.toLowerCase() === n) ||
    pool.find((x) => x.toLowerCase().startsWith(n)) ||
    pool.find((x) => x.toLowerCase().includes(n)) ||
    pool.find((x) => n.includes(x.toLowerCase()))
  const k = match(keys.filter(sameSec)) || match(keys)
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

// ── SIDEBAR NAVIGATION MODEL ─────────────────────────────────────────────────
// One grouped left rail drives the whole app. Every screen is a sidebar item that
// maps to a module (m) and the route/section within it (r). This replaced the old
// top module-switcher + per-module tab strips.
const NAV_MANAGER = [
  { items: [{ id: 'home', label: 'Home', m: 'spray', r: 'dashboard', home: true, icon: BarChart3, follow: true }] },
  { title: 'Spray Program', items: [
    { id: 'program', label: 'Annual Program', m: 'spray', r: 'program', follow: true },
    { id: 'sheets', label: 'Spray Sheets', m: 'spray', r: 'list', follow: true },
    { id: 'fert', label: 'Fert Sheets', m: 'spray', r: 'fert', follow: true },
    { id: 'chemicals', label: 'Chemical Library', m: 'spray', r: 'chemicals' },
  ] },
  { title: 'Agronomy', items: [
    { id: 'data', label: 'Field Data', m: 'turf', r: 'data', follow: true },
    { id: 'gdd', label: 'GDD & Timing', m: 'turf', r: 'gdd', follow: true },
    { id: 'wetting', label: 'Wetting Agents', m: 'turf', r: 'wetting', follow: true },
    { id: 'growth', label: 'Growth', m: 'turf', r: 'growth', follow: true },
    { id: 'timing', label: 'Soil-Temp Timing', m: 'turf', r: 'timing' },
    { id: 'soil', label: 'Soil Tests', m: 'turf', r: 'soil', follow: true },
    { id: 'hoc', label: 'Height of Cut', m: 'turf', r: 'hoc', follow: true },
    { id: 'practices', label: 'Practices', m: 'turf', r: 'practices', follow: true },
    { id: 'reference', label: 'Reference', m: 'turf', r: 'knowledge' },
  ] },
  { title: 'Course & Crew', items: [
    { id: 'irrmap', label: 'Irrigation Map', m: 'map', r: 'map' },
    { id: 'parts', label: 'Parts', m: 'map', r: 'parts' },
    { id: 'jobboard', label: 'Job Board', m: 'board', r: 'workboard' },
    { id: 'playbook', label: 'Playbook', m: 'playbook', r: null },
    { id: 'tournament', label: 'Tournament', m: 'tournament', r: null },
  ] },
  { title: 'Reports', items: [
    { id: 'weekly', label: 'Weekly Report', m: 'turf', r: 'report', follow: true },
    { id: 'season', label: 'Season Reports', m: 'spray', r: 'reports' },
    { id: 'weather', label: 'Weather', m: 'spray', r: 'weather' },
  ] },
]
const NAV_MANAGER_BOTTOM = [{ id: 'settings', label: 'Settings', m: 'spray', r: 'settings' }]

const NAV_CREW = [
  { items: [{ id: 'tospray', label: 'To Spray', m: 'spray', r: 'tospray', icon: Droplet }] },
  { title: 'Spraying', items: [
    { id: 'records', label: 'Records', m: 'spray', r: 'records' },
    { id: 'fert', label: 'Fert Sheets', m: 'spray', r: 'fert' },
    { id: 'inventory', label: 'Inventory', m: 'spray', r: 'inventory' },
    { id: 'documents', label: 'Labels & SDS', m: 'spray', r: 'documents' },
    { id: 'weather', label: 'Weather', m: 'spray', r: 'weather' },
  ] },
  { title: 'Course', items: [
    { id: 'jobboard', label: 'Job Board', m: 'board', r: 'workboard' },
    { id: 'playbook', label: 'Playbook', m: 'playbook', r: null },
  ] },
]

// Flatten the groups (plus the pinned-bottom items) into one lookup list.
function flattenNav(groups, bottom = []) {
  const out = []
  for (const g of groups) for (const it of g.items) out.push(it)
  for (const it of bottom) out.push(it)
  return out
}

// ── ROOT ────────────────────────────────────────────────────────────────────
export default function SprayApp({ user }) {
  const manage = canManage(user.role)
  const groups = manage ? NAV_MANAGER : NAV_CREW
  const bottom = manage ? NAV_MANAGER_BOTTOM : []
  const allItems = flattenNav(groups, bottom)
  const initial = allItems[0]

  const [sel, setSel] = useState(initial)
  const [seq, setSeq] = useState(0)
  const [drawer, setDrawer] = useState(false)
  // The property's courses (name + colour) and club name, for the course bar and
  // the sidebar brand. Fetched once here so the bar is one global control.
  const [courses, setCourses] = useState([])
  const [clubName, setClubName] = useState('')
  const [course, setCourse] = useState('') // '' = All
  useEffect(() => { (async () => {
    try {
      const s = await db.fetchSettings()
      setCourses(((s.courseInfo?.courses) || []).filter((c) => c && c.name))
      setClubName(s.courseInfo?.clubName || '')
    } catch (e) { console.error(e) }
  })() }, [])

  // A stable nav token — only changes when the user actually picks a sidebar item,
  // so modules re-sync their internal route on a click (and on a re-click) but not
  // on every incidental re-render (which would clobber in-module navigation).
  const nav = React.useMemo(() => ({ route: sel.r, seq }), [sel.r, seq])

  const pick = (item) => { setSel(item); setSeq((s) => s + 1); setDrawer(false) }
  const showCourseBar = !!sel.follow && courses.length >= 2

  const Rail = ({ onPick }) => (
    <SidebarRail
      groups={groups} bottom={bottom} activeId={sel.id} onPick={onPick}
      clubName={clubName || user.clubName} user={user}
    />
  )

  return (
    <ErrorBoundary>
      <div className="flex min-h-screen" style={{ backgroundColor: CREAM }}>
        {/* Persistent rail — laptop/desktop (the primary way this app is used) */}
        <aside className="hidden lg:flex flex-col shrink-0 w-56 h-screen sticky top-0" style={{ backgroundColor: FOREST }}>
          <Rail onPick={pick} />
        </aside>

        {/* Slide-out drawer — iPad portrait / phone */}
        {drawer && (
          <div className="lg:hidden fixed inset-0 flex" style={{ zIndex: 2000 }} onClick={() => setDrawer(false)}>
            <div className="absolute inset-0" style={{ backgroundColor: 'rgba(10,20,14,0.55)' }} />
            <div className="relative w-60 max-w-[82%] h-full flex flex-col shadow-2xl" style={{ backgroundColor: FOREST }} onClick={(e) => e.stopPropagation()}>
              <Rail onPick={pick} />
            </div>
          </div>
        )}

        <div className="flex-1 min-w-0 flex flex-col">
          {/* Slim top bar: mobile menu + current location */}
          <div className="flex items-center gap-3 px-4 sm:px-6 h-12 shrink-0 border-b" style={{ borderColor: HAIR, backgroundColor: PAPER }}>
            <button onClick={() => setDrawer(true)} className="lg:hidden w-8 h-8 -ml-1 rounded-lg flex items-center justify-center" style={{ color: FOREST }} aria-label="Open menu">
              <Menu size={18} />
            </button>
            <span className="font-display text-[15px] font-semibold truncate" style={{ color: FOREST }}>{sel.label}</span>
          </div>

          {/* Course bar — the one global All / Blue / Gold selector. Colours come
              from Property Setup. Shows only on course-aware screens; ignores the
              rest. Defaults to All so nothing is hidden until you pick a course. */}
          {showCourseBar && (
            <div className="flex items-stretch h-10 shrink-0 border-b overflow-x-auto no-scrollbar" style={{ borderColor: HAIR, backgroundColor: PAPER }}>
              <CourseTab label="All" on={course === ''} onClick={() => setCourse('')} />
              {courses.map((c) => (
                <CourseTab key={c.name} label={c.name} color={c.color} on={course === c.name} onClick={() => setCourse(c.name)} />
              ))}
            </div>
          )}

          <div className="flex-1 min-w-0">
            {sel.m === 'spray' ? <SprayOpsModule user={user} nav={nav} hideChrome homeMode={!!sel.home} course={sel.follow ? course : ''} />
              : sel.m === 'turf' ? <TurfPerformanceModule user={user} nav={nav} hideChrome course={sel.follow ? course : ''} />
              : sel.m === 'playbook' ? <PlaybookModule user={user} manage={manage} hideChrome />
              : sel.m === 'tournament' ? <Tournament />
              : sel.m === 'map' ? <IrrigationModule user={user} manage={manage} nav={nav} hideChrome />
              : <WhiteboardModule user={user} nav={nav} hideChrome />}
          </div>
        </div>
      </div>
    </ErrorBoundary>
  )
}

// One tab in the colour course bar. Active tab carries the course's own colour
// as an underline + dot, so you can always see which course you're in.
function CourseTab({ label, color, on, onClick }) {
  const accent = color || FERN
  return (
    <button onClick={onClick} className="flex items-center gap-2 px-4 shrink-0 font-body text-[13px] whitespace-nowrap transition"
      style={{ fontWeight: on ? 800 : 600, color: on ? INK : INK_2, borderBottom: `3px solid ${on ? accent : 'transparent'}` }}>
      {color && <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />}
      {label}
    </button>
  )
}

// The grouped dark rail. Gold uppercase group labels, gold active left-bar.
function SidebarRail({ groups, bottom, activeId, onPick, clubName, user }) {
  const itemBtn = (it) => {
    const on = it.id === activeId
    return (
      <button
        key={it.id}
        onClick={() => onPick(it)}
        className="w-full text-left font-body text-[13px] transition"
        style={{
          padding: '7px 16px 7px 17px',
          borderLeft: `3px solid ${on ? GOLD : 'transparent'}`,
          backgroundColor: on ? 'rgba(201,168,76,0.13)' : 'transparent',
          color: on ? '#FFFFFF' : 'rgba(255,255,255,0.62)',
          fontWeight: on ? 700 : 500,
        }}
      >
        {it.label}
      </button>
    )
  }
  return (
    <>
      {/* Brand */}
      <div className="px-4 pt-4 pb-3 shrink-0">
        <p className="font-display text-[9px] tracking-[0.22em] uppercase" style={{ color: GOLD }}>{clubName || 'Congressional'}</p>
        <p className="font-display text-[17px] font-semibold text-white leading-tight mt-0.5">Grounds</p>
      </div>

      {/* Groups */}
      <nav className="flex-1 overflow-y-auto no-scrollbar pb-3">
        {groups.map((g, i) => (
          <div key={g.title || `g${i}`} className="mb-1.5">
            {g.title && (
              <p className="font-body text-[9.5px] font-bold uppercase tracking-[0.12em] px-4 pt-3 pb-1" style={{ color: 'rgba(201,168,76,0.85)' }}>{g.title}</p>
            )}
            {g.items.map(itemBtn)}
          </div>
        ))}
      </nav>

      {/* Pinned bottom: settings + user + sign out */}
      <div className="shrink-0 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        {(bottom || []).map(itemBtn)}
        <div className="px-4 py-3 flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 font-body text-[10px] font-extrabold" style={{ backgroundColor: GOLD, color: FOREST }}>
            {initials(user.fullName)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-body text-[11.5px] font-semibold text-white truncate leading-tight">{user.fullName}</p>
            <p className="font-body text-[10px] truncate" style={{ color: 'rgba(255,255,255,0.5)' }}>{roleLabel(user.role)}</p>
          </div>
          <form action={logout}>
            <button type="submit" className="font-body text-[10.5px] font-semibold transition" style={{ color: 'rgba(255,255,255,0.55)' }} title="Sign out">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </>
  )
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '·'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

function roleLabel(role) {
  return role === 'director' ? 'Director of Grounds' : role === 'superintendent' ? 'Superintendent' : 'Operator'
}

// ── IRRIGATION MODULE ─────────────────────────────────────────────────────
// The irrigation map plus its parts stockroom, behind a small Map / Parts toggle.
function IrrigationModule({ user, manage, nav, hideChrome }) {
  const [view, setView] = useState(nav?.route || 'map')
  useEffect(() => { if (nav?.route) setView(nav.route) }, [nav])
  return (
    <div>
      {!hideChrome && (
        <div style={{ backgroundColor: '#F4F6F4', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex gap-2">
            {[['map', 'Map', MapPin], ['parts', 'Parts', Package]].map(([k, label, Icon]) => (
              <button key={k} onClick={() => setView(k)} className="font-body text-xs font-bold px-3.5 py-1.5 rounded-full flex items-center gap-1.5 transition" style={view === k ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {view === 'map' ? <CourseMap user={user} manage={manage} /> : <IrrigationParts manage={manage} />}
    </div>
  )
}

// ── SPRAY OPS MODULE ──────────────────────────────────────────────────────
function SprayOpsModule({ user, nav, hideChrome, homeMode, course = '' }) {
  const manage = canManage(user.role)
  const [route, setRoute] = useState(nav?.route || (canManage(user.role) ? 'dashboard' : 'tospray'))
  // Re-sync the internal route when the sidebar picks a Spray-Ops screen.
  useEffect(() => { if (nav?.route) setRoute(nav.route) }, [nav])
  const [sheets, setSheets] = useState([])
  const [products, setProducts] = useState([])
  const [fertSheets, setFertSheets] = useState([])
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
  const [pendingDelete, setPendingDelete] = useState(null) // sheet awaiting a delayed delete (undo window)
  const deleteTimerRef = useRef(null)

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
      const [s, p, d, settings, progs, ferts] = await Promise.all([
        db.fetchSheets(),
        db.fetchProducts(),
        db.fetchDeliveries(),
        db.fetchSettings(),
        db.fetchPrograms(),
        db.fetchFertSheets().catch(() => []),
      ])
      setSheets(s)
      setProducts(p)
      setFertSheets(ferts || [])
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

  // Actually remove the row from the database (called after the undo window).
  function commitDelete(sheet) {
    db.deleteSheet(sheet.id).catch((e) => {
      console.error(e)
      showToast('Could not delete — check your connection')
      setSheets((prev) => (prev.some((s) => s.id === sheet.id) ? prev : [...prev, sheet]))
    })
  }

  // Delete a sheet with a short UNDO window: it disappears immediately, but the
  // database delete is held for a few seconds so it can be brought right back.
  function removeSheet(sheet) {
    // If another delete is still pending, commit it now before starting a new one.
    if (deleteTimerRef.current) { clearTimeout(deleteTimerRef.current); deleteTimerRef.current = null; if (pendingDelete) commitDelete(pendingDelete) }
    setSheets((prev) => prev.filter((s) => s.id !== sheet.id))
    if (activeSheet?.id === sheet.id) { setActiveSheet(null); setRoute('list') }
    setPendingDelete(sheet)
    deleteTimerRef.current = setTimeout(() => { commitDelete(sheet); setPendingDelete(null); deleteTimerRef.current = null }, 6000)
  }

  // Bring a just-deleted sheet back (within the undo window).
  function undoDelete() {
    if (deleteTimerRef.current) { clearTimeout(deleteTimerRef.current); deleteTimerRef.current = null }
    if (pendingDelete) {
      const sheet = pendingDelete
      setSheets((prev) => (prev.some((s) => s.id === sheet.id) ? prev : [...prev, sheet]))
      setPendingDelete(null)
      showToast('Spray sheet restored')
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

  function newSheet(presetArea) {
    const areaKeys = Object.keys(areas)
    // Preset the area when the Advisor (or anywhere) starts a sheet for a
    // specific area; otherwise default to the first area.
    const firstArea = (typeof presetArea === 'string' && areas[presetArea]) ? presetArea : areaKeys[0]
    setActiveSheet({
      id: crypto.randomUUID(),
      sheetType: firstArea || 'Spray Sheet',
      date: localDateISO(),
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

  // Clone a past sheet into a fresh, editable one for today — same area, mix and
  // rates — clearing everything spray-specific (sign-off, weather, tank checks).
  function sprayAgain(src) {
    setActiveSheet({
      id: crypto.randomUUID(),
      sheetType: src.sheetType || src.area || 'Spray Sheet',
      date: localDateISO(),
      operator: src.operator || '',
      area: src.area,
      tanks: src.tanks || (src.area && areas[src.area] ? areas[src.area].tanks : 1),
      weather: { temp: '', wind: '', humidity: '', windDir: '' },
      products: (src.products || []).filter((p) => p.product).map((p) => ({
        id: uid(), product: p.product, rate: p.rate, basis: p.basis, forceGal: !!p.forceGal, target: p.target || '',
      })),
      targets: src.targets || [],
      instructions: src.instructions || '',
      ppe: src.ppe || [],
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
      date: planned[0].plannedDate || localDateISO(),
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
        target: a.target || '', // carry the plan's target onto the product line
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

  // Scope the displayed sheets to the course picked in the global course bar
  // (by first-word match on the sheet's area). This filters the view only —
  // the underlying sheet data and all actions stay untouched.
  const cTok = (s) => String(s || '').trim().split(/\s+/)[0].toLowerCase()
  const inCourse = (area) => !course || cTok(area) === cTok(course)
  const scopeAreas = (a) => (!course ? a : Object.fromEntries(Object.entries(a || {}).filter(([n]) => cTok(n) === cTok(course))))
  const visibleSheets = course ? sheets.filter((s) => inCourse(s.area)) : sheets
  const pending = visibleSheets.filter((s) => s.status === 'pending')
  const approved = visibleSheets.filter((s) => s.status === 'approved')
  const today = localDateISO()
  const todaySheets = visibleSheets.filter((s) => s.date === today)

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

      {pendingDelete && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 text-white pl-4 pr-2 py-2 rounded-full shadow-xl text-sm font-body" style={{ backgroundColor: INK }}>
          <span>Sheet deleted — <b>{pendingDelete.area}</b></span>
          <button onClick={undoDelete} className="font-bold px-3 py-1.5 rounded-full" style={{ backgroundColor: GOLD, color: FOREST }}>Undo</button>
        </div>
      )}

      {manage && !onboardDismissed && !courseInfo?.onboarded && (
        <OnboardingWizard
          courseInfo={courseInfo}
          grassTypes={grassTypes}
          areas={areas}
          soilTypes={soilTypes}
          onSkip={() => setOnboardDismissed(true)}
          onFinish={async (patch) => { await saveSettings(patch); setOnboardDismissed(true); showToast('Course set up — you can change this in Settings') }}
        />
      )}

      {!hideChrome && <TopNav route={route} setRoute={setRoute} onNew={newSheet} courseInfo={courseInfo} manage={manage} />}

      {(() => {
        if (dismissLic) return null
        const alerts = computeLicenseAlerts(applicatorLicenses)
        if (alerts.length === 0) return null
        const anyExpired = alerts.some((a) => a.level === 'expired')
        return (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4">
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

      <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-24">
        {route === 'dashboard' && (
          <Dashboard
            sheets={visibleSheets} pending={pending} approved={approved} todaySheets={todaySheets} products={products} areas={areas}
            manage={manage} programApps={course ? programApps.filter((a) => inCourse(a.area)) : programApps} location={location} courseInfo={courseInfo}
            homeMode={homeMode}
            onOpen={(s) => { setActiveSheet(s); setRoute('view') }}
            onNew={newSheet}
            onSeeAll={() => setRoute('list')}
            onCreateFromProgram={createSheetFromProgram}
            onGoWeather={() => setRoute('weather')}
            onGo={(r) => setRoute(r)}
          />
        )}
        {route === 'list' && (
          <SheetList sheets={visibleSheets} manage={manage} variant="manage" onOpen={(s) => { setActiveSheet(s); setRoute('view') }} onNew={newSheet} onDelete={removeSheet} onImportHistory={importHistory} />
        )}
        {route === 'tospray' && (
          <SheetList sheets={visibleSheets} manage={manage} variant="tospray" onOpen={(s) => { setActiveSheet(s); setRoute('view') }} onNew={newSheet} />
        )}
        {route === 'records' && (
          <SheetList sheets={visibleSheets} manage={manage} variant="records" onOpen={(s) => { setActiveSheet(s); setRoute('view') }} onNew={newSheet} />
        )}
        {route === 'edit' && activeSheet && manage && (
          <SheetEditor
            sheet={activeSheet} saving={saving} products={products} location={location}
            areas={areas} operators={operators} targets={targets} sheetTypes={sheetTypes} sheets={sheets} courseInfo={courseInfo}
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
            onDelete={() => removeSheet(activeSheet)}
            onSprayAgain={() => sprayAgain(activeSheet)}
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
          <ChemicalHub
            products={products} grassTypes={grassTypes} deliveries={deliveries} manage={manage}
            onSaveProduct={saveProduct} onDeleteProduct={removeProduct} onImport={importProductsFromSheet} onAddDelivery={addDelivery}
          />
        )}
        {route === 'inventory' && !manage && (
          <Inventory products={products} deliveries={deliveries} onAddDelivery={addDelivery} />
        )}
        {route === 'documents' && !manage && (
          <DocumentsLibrary products={products} manage={manage} onSaveProduct={manage ? saveProduct : undefined} />
        )}
        {route === 'weather' && <Weather location={location} courseInfo={courseInfo} products={products} manage={manage} onSaveRain={async (rainOverrides) => { await saveSettings({ courseInfo: { ...courseInfo, rainOverrides } }); showToast('Rainfall saved') }} onGoToSettings={() => manage && setRoute('settings')} />}
        {route === 'program' && manage && <AnnualProgram areas={scopeAreas(areas)} products={products} sheets={visibleSheets} location={location} courseInfo={courseInfo} onProductsChanged={reloadProducts} onCreateSheet={createSheetFromProgram} />}
        {route === 'reports' && manage && <Reports sheets={sheets} products={products} areas={areas} courseInfo={courseInfo} fertSheets={fertSheets} onSaveSettings={saveSettings} />}
        {route === 'fert' && <FertSheets manage={manage} courseInfo={courseInfo} courseFilter={course} />}
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

// ── FERTILIZER SHEETS ─────────────────────────────────────────────────────
// Granular fert applications, per area — the digital version of the club's
// Excel fert sheets. Pick an area (its per-section square footage is built in),
// a product + rate + bag size, and it works out lbs, bags and cost per section.
function FertSheets({ manage, courseInfo, courseFilter = '' }) {
  const [sheets, setSheets] = useState([])
  const fcTok = (s) => String(s || '').trim().split(/\s+/)[0].toLowerCase()
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState(null) // sheet object being viewed/edited
  const [toast, setToast] = useState(null)
  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 2400) }

  useEffect(() => { (async () => {
    try { setSheets(await db.fetchFertSheets()) } catch (e) { console.error(e) } finally { setLoading(false) }
  })() }, [])

  const blank = () => {
    const a = FERT_AREAS[0]
    return { area: a.area, product: '', analysis: { n: 0, p: 0, k: 0 }, rate: 4, bag: a.bag, adjustPct: a.adjustPct, pricePerBag: 0, applicator: '', appDate: new Date().toISOString().slice(0, 10), status: 'planned', notes: '', sections: a.sections.map((s) => ({ ...s, actual: '' })) }
  }

  async function save(sheet) {
    try {
      const saved = sheet.id ? await db.updateFertSheet(sheet.id, sheet) : await db.addFertSheet(sheet)
      setSheets((prev) => sheet.id ? prev.map((x) => x.id === saved.id ? saved : x) : [saved, ...prev])
      setActive(saved); flash('Fert sheet saved')
      return saved
    } catch (e) { console.error(e); flash('Could not save — is the phase25 table set up?') }
  }
  async function remove(id) {
    try { await db.deleteFertSheet(id); setSheets((prev) => prev.filter((x) => x.id !== id)); setActive(null); flash('Deleted') }
    catch (e) { console.error(e); flash('Could not delete') }
  }

  if (loading) return <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 text-center font-body text-sm text-slate-400"><Loader2 className="animate-spin inline mr-2" size={16} /> Loading fert sheets…</div>

  if (active) return <FertEditor sheet={active} manage={manage} courseInfo={courseInfo} onSave={save} onDelete={remove} onBack={() => setActive(null)} toast={toast} />

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {toast && <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[1000] px-4 py-2 rounded-full text-white font-body text-sm shadow-lg" style={{ backgroundColor: FOREST }}>{toast}</div>}
      <div className="flex items-center justify-between mb-4">
        <SectionHeader title="Fertilizer Sheets" subtitle="Granular fert applications by area — lbs, bags and cost worked out per section" noMargin />
        {manage && <button onClick={() => setActive(blank())} className="font-body text-xs font-semibold px-3.5 py-2 rounded-full flex items-center gap-1.5 shrink-0" style={{ backgroundColor: GOLD, color: FOREST }}><Plus size={14} /> New fert sheet</button>}
      </div>
      {(courseFilter ? sheets.filter((s) => fcTok(s.area) === fcTok(courseFilter)) : sheets).length === 0 ? (
        <div className="paper-card p-10 text-center">
          <Sprout className="mx-auto mb-3" size={28} style={{ color: HAIR }} />
          <p className="font-body text-sm mb-1" style={{ color: INK_3 }}>{courseFilter ? `No ${courseFilter} fert sheets yet.` : 'No fert sheets yet.'}</p>
          <p className="font-body text-xs mb-4" style={{ color: INK_3 }}>Start one for any area — the square footage of every green/tee/hole is already built in.</p>
          {manage && <button onClick={() => setActive(blank())} className="font-body text-xs font-semibold px-4 py-2 rounded-full text-white" style={{ backgroundColor: FOREST }}>Create your first fert sheet</button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {(courseFilter ? sheets.filter((s) => fcTok(s.area) === fcTok(courseFilter)) : sheets).map((s) => {
            const c = computeFert(s)
            return (
              <button key={s.id} onClick={() => setActive(s)} className="paper-card p-4 text-left hover:shadow-md transition">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-display text-base font-bold" style={{ color: FOREST }}>{s.area}</p>
                  <span className="font-body text-[10px] font-bold px-2 py-0.5 rounded-full" style={s.status === 'complete' ? { backgroundColor: '#DCFCE7', color: '#166534' } : { backgroundColor: '#EEF4EF', color: FERN }}>{s.status === 'complete' ? 'Complete' : 'Planned'}</span>
                </div>
                <p className="font-body text-[13px] text-slate-600 mt-0.5">{s.product || 'No product set'}{s.analysis?.n != null && (s.analysis.n || s.analysis.p || s.analysis.k) ? ` · ${s.analysis.n}-${s.analysis.p}-${s.analysis.k}` : ''}</p>
                <div className="flex items-center gap-4 mt-2 font-body text-[12px] text-slate-500">
                  <span><b style={{ color: FOREST }}>{fmtNum(c.totalBags, 1)}</b> bags</span>
                  <span><b style={{ color: FOREST }}>{fmtNum(c.totalLbs, 0)}</b> lbs</span>
                  <span>{s.rate} lb/M</span>
                  {c.cost > 0 && <span>${fmtNum(c.cost, 0)}</span>}
                  {s.appDate && <span className="ml-auto">{fmtDate ? fmtDate(s.appDate) : s.appDate}</span>}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FertEditor({ sheet, manage, courseInfo, onSave, onDelete, onBack, toast }) {
  const [s, setS] = useState(sheet)
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  useEffect(() => { setS(sheet) }, [sheet])
  const c = computeFert(s)
  const set = (patch) => setS((p) => ({ ...p, ...patch }))
  const setSection = (i, patch) => setS((p) => ({ ...p, sections: p.sections.map((x, k) => k === i ? { ...x, ...patch } : x) }))
  const addSection = () => setS((p) => ({ ...p, sections: [...p.sections, { name: '', sqft: '', actual: '' }] }))
  const removeSection = (i) => setS((p) => ({ ...p, sections: p.sections.filter((_, k) => k !== i) }))
  // Switching area reloads that area's built-in sections + bag/adjust defaults.
  const pickArea = (name) => {
    const a = fertArea(name); if (!a) return set({ area: name })
    set({ area: name, bag: a.bag, adjustPct: a.adjustPct, sections: a.sections.map((x) => ({ ...x, actual: '' })) })
  }
  const onAnalysis = (v) => { const p = parseAnalysis(v); set(p ? { product: s.product, analysis: p, _npkStr: v } : { _npkStr: v }) }

  async function doSave() { setSaving(true); await onSave(s); setSaving(false) }
  function printSheet() {
    const rows = c.rows.map((r) => `<tr><td>${esc(r.name)}</td><td class=n>${fmtNum(r.sqft, 0)}</td><td class=n>${fmtNum(r.lbs, 1)}</td><td class=n>${fmtNum(r.bags, 2)}</td><td class=n>${fmtNum(r.cumBags, 2)}</td><td></td></tr>`).join('')
    const w = window.open('', '_blank'); if (!w) return
    w.document.write(`<html><head><title>${esc(s.area)} Fert Sheet</title><style>body{font-family:Georgia,serif;padding:24px;color:#16291F}h1{font-size:18px}table{width:100%;border-collapse:collapse;font-size:12px;margin-top:10px}td,th{border:1px solid #ccc;padding:4px 6px;text-align:left}.n{text-align:right}.meta{font-size:12px;margin:2px 0}tfoot td{font-weight:bold;background:#f3f3f3}</style></head><body>
      <h1>${esc(s.area)} — Fertility Application</h1>
      <p class=meta><b>Product:</b> ${esc(s.product)} ${s.analysis?.n != null ? `(${s.analysis.n}-${s.analysis.p}-${s.analysis.k})` : ''} &nbsp; <b>Rate:</b> ${s.rate} lb/1,000 ft² &nbsp; <b>Bag:</b> ${s.bag} lb</p>
      <p class=meta><b>Applicator:</b> ${esc(s.applicator)} &nbsp; <b>Date:</b> ${esc(s.appDate)} &nbsp; <b>Overlap adj:</b> ${s.adjustPct}%</p>
      <table><thead><tr><th>Section</th><th class=n>Sq ft</th><th class=n>Lbs product</th><th class=n>Bags</th><th class=n>Running bags</th><th>Actual used</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td>Total</td><td class=n>${fmtNum(c.totalSqft, 0)}</td><td class=n>${fmtNum(c.totalLbs, 1)}</td><td class=n>${fmtNum(c.totalBags, 2)}</td><td class=n></td><td></td></tr></tfoot></table>
      <p class=meta style="margin-top:8px">N ${fmtNum(c.nPerM, 2)} · P ${fmtNum(c.pPerM, 2)} · K ${fmtNum(c.kPerM, 2)} lb/1,000 ft² &nbsp; | &nbsp; Season total: N ${fmtNum(c.totalN, 0)} · P ${fmtNum(c.totalP, 0)} · K ${fmtNum(c.totalK, 0)} lb${c.cost > 0 ? ` &nbsp; | &nbsp; Cost: $${fmtNum(c.cost, 0)}` : ''}</p>
      </body></html>`)
    w.document.close(); w.focus(); setTimeout(() => w.print(), 300)
  }
  const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]))
  const inp = 'w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm font-body'
  const lbl = 'font-body text-[10px] font-bold uppercase tracking-wide text-slate-400'

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {toast && <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[1000] px-4 py-2 rounded-full text-white font-body text-sm shadow-lg" style={{ backgroundColor: FOREST }}>{toast}</div>}
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <button onClick={onBack} className="font-body text-xs font-semibold flex items-center gap-1" style={{ color: FERN }}>← All fert sheets</button>
        <div className="flex items-center gap-2">
          <button onClick={printSheet} className="font-body text-xs font-bold px-3 py-1.5 rounded-full" style={{ color: FOREST, border: '1px solid #E2E8F0' }}>Print</button>
          {manage && s.id && (s.status !== 'complete'
            ? <button onClick={async () => { setSaving(true); await onSave({ ...s, status: 'complete' }); setSaving(false) }} className="font-body text-xs font-bold px-3 py-1.5 rounded-full text-white" style={{ backgroundColor: FERN }}>Mark complete</button>
            : <button onClick={async () => { setSaving(true); await onSave({ ...s, status: 'planned' }); setSaving(false) }} className="font-body text-xs font-bold px-3 py-1.5 rounded-full" style={{ color: FOREST, border: '1px solid #E2E8F0' }}>Reopen</button>)}
          {manage && <button onClick={doSave} disabled={saving} className="font-body text-xs font-bold px-3.5 py-1.5 rounded-full text-white flex items-center gap-1.5 disabled:opacity-60" style={{ backgroundColor: FOREST }}>{saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save</button>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* Left: the setup */}
        <div className="paper-card p-4 space-y-3">
          <div><label className={lbl}>Area</label>
            <select value={s.area} disabled={!manage} onChange={(e) => pickArea(e.target.value)} className={inp + ' bg-white'}>
              {FERT_AREAS.map((a) => <option key={a.area} value={a.area}>{a.area}</option>)}
              {!FERT_AREAS.some((a) => a.area === s.area) && <option value={s.area}>{s.area}</option>}
            </select>
          </div>
          <div><label className={lbl}>Product</label><input value={s.product} disabled={!manage} onChange={(e) => set({ product: e.target.value })} className={inp} placeholder="e.g. Harrells 24-6-6 Polyon" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={lbl}>Analysis N-P-K</label><input value={s._npkStr ?? (s.analysis?.n != null && (s.analysis.n || s.analysis.p || s.analysis.k) ? `${s.analysis.n}-${s.analysis.p}-${s.analysis.k}` : '')} disabled={!manage} onChange={(e) => onAnalysis(e.target.value)} className={inp} placeholder="24-6-6" /></div>
            <div><label className={lbl}>Rate (lb/1,000 ft²)</label><input value={s.rate} disabled={!manage} inputMode="decimal" onChange={(e) => set({ rate: e.target.value.replace(/[^\d.]/g, '') })} className={inp} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={lbl}>Bag size (lb)</label><input value={s.bag} disabled={!manage} inputMode="decimal" onChange={(e) => set({ bag: e.target.value.replace(/[^\d.]/g, '') })} className={inp} /></div>
            <div><label className={lbl}>Overlap adj (%)</label><input value={s.adjustPct} disabled={!manage} inputMode="decimal" onChange={(e) => set({ adjustPct: e.target.value.replace(/[^\d.]/g, '') })} className={inp} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={lbl}>Price / bag ($)</label><input value={s.pricePerBag} disabled={!manage} inputMode="decimal" onChange={(e) => set({ pricePerBag: e.target.value.replace(/[^\d.]/g, '') })} className={inp} /></div>
            <div><label className={lbl}>Date</label><input type="date" value={s.appDate || ''} disabled={!manage} onChange={(e) => set({ appDate: e.target.value })} className={inp} /></div>
          </div>
          <div><label className={lbl}>Applicator</label><input value={s.applicator} onChange={(e) => set({ applicator: e.target.value })} className={inp} placeholder="Name" /></div>
          <div><label className={lbl}>Notes</label><textarea value={s.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} className={inp} /></div>
          {manage && s.id && (!confirmDel
            ? <button onClick={() => setConfirmDel(true)} className="font-body text-xs font-bold px-3 py-2 rounded-full flex items-center gap-1.5" style={{ color: '#B91C1C', border: '1px solid #F3C6C6' }}><Trash2 size={13} /> Delete sheet</button>
            : <div className="flex items-center gap-2"><span className="font-body text-[12px] text-slate-500">Delete?</span><button onClick={() => onDelete(s.id)} className="font-body text-xs font-bold px-3 py-2 rounded-full text-white" style={{ backgroundColor: '#DC2626' }}>Yes</button><button onClick={() => setConfirmDel(false)} className="font-body text-xs font-bold px-3 py-2 rounded-full text-slate-500 border border-slate-200">Keep</button></div>)}
        </div>

        {/* Right: the computed table + totals */}
        <div className="lg:col-span-2 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="paper-card p-3"><p className={lbl}>Total bags</p><p className="font-display text-xl font-bold" style={{ color: FOREST }}>{fmtNum(c.totalBags, 1)}</p></div>
            <div className="paper-card p-3"><p className={lbl}>Total product</p><p className="font-display text-xl font-bold" style={{ color: FOREST }}>{fmtNum(c.totalLbs, 0)} <span className="text-sm font-body">lb</span></p></div>
            <div className="paper-card p-3"><p className={lbl}>N · P · K /M</p><p className="font-display text-base font-bold" style={{ color: FOREST }}>{fmtNum(c.nPerM, 2)}·{fmtNum(c.pPerM, 2)}·{fmtNum(c.kPerM, 2)}</p></div>
            <div className="paper-card p-3"><p className={lbl}>Cost</p><p className="font-display text-xl font-bold" style={{ color: FOREST }}>{c.cost > 0 ? '$' + fmtNum(c.cost, 0) : '—'}</p></div>
          </div>
          <div className="paper-card overflow-x-auto">
            <table className="w-full text-sm font-body" style={{ minWidth: 560 }}>
              <thead><tr style={{ borderBottom: '1px solid #EEF0EC' }}>
                {['Section', 'Sq ft', 'Lbs product', 'Bags', 'Running bags', 'Actual used'].map((h, i) => <th key={h} className={`px-3 py-2 ${i ? 'text-right' : 'text-left'}`} style={{ color: INK_2, fontWeight: 700, fontSize: 11 }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {c.rows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #F3F5F2' }}>
                    <td className="px-3 py-1.5" style={{ color: FOREST }}>{manage ? <input value={s.sections[i]?.name ?? ''} onChange={(e) => setSection(i, { name: e.target.value })} className="w-full border-0 bg-transparent focus:bg-slate-50 rounded px-1 py-0.5 text-[13px]" style={{ color: FOREST }} /> : r.name}</td>
                    <td className="px-2 py-1 text-right">{manage ? <input value={s.sections[i]?.sqft ?? ''} inputMode="numeric" onChange={(e) => setSection(i, { sqft: e.target.value.replace(/[^\d.]/g, '') })} className="w-20 border border-slate-200 rounded px-1.5 py-1 text-right text-[13px] tabular-nums" /> : <span className="tabular-nums text-slate-500">{fmtNum(r.sqft, 0)}</span>}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{fmtNum(r.lbs, 1)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-bold" style={{ color: FOREST }}>{fmtNum(r.bags, 2)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{fmtNum(r.cumBags, 2)}</td>
                    <td className="px-2 py-1 text-right whitespace-nowrap"><input value={r.actual ?? ''} onChange={(e) => setSection(i, { actual: e.target.value.replace(/[^\d.]/g, '') })} className="w-16 border border-slate-200 rounded px-1.5 py-1 text-right text-[13px] tabular-nums" placeholder="—" />{manage && <button onClick={() => removeSection(i)} className="ml-1.5 text-slate-300 hover:text-red-500 align-middle"><X size={13} /></button>}</td>
                  </tr>
                ))}
                {manage && <tr><td colSpan={6} className="px-3 py-2"><button onClick={addSection} className="font-body text-[12px] font-bold flex items-center gap-1" style={{ color: FERN }}><Plus size={13} /> Add section</button></td></tr>}
              </tbody>
              <tfoot><tr style={{ borderTop: '2px solid #EEF0EC' }}>
                <td className="px-3 py-2 font-bold" style={{ color: FOREST }}>Total</td>
                <td className="px-3 py-2 text-right tabular-nums font-bold" style={{ color: FOREST }}>{fmtNum(c.totalSqft, 0)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-bold" style={{ color: FOREST }}>{fmtNum(c.totalLbs, 1)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-bold" style={{ color: FOREST }}>{fmtNum(c.totalBags, 2)}</td>
                <td></td>
                <td className="px-3 py-2 text-right tabular-nums font-bold" style={{ color: FOREST }}>{c.totalActualBags ? fmtNum(c.totalActualBags, 2) : ''}</td>
              </tr></tfoot>
            </table>
          </div>
          <p className="font-body text-[11px] text-slate-400">Square footage for every section is built in from the club sheets — edit any value and the lbs/bags update live. Overlap adjustment adds a % to the area (greens use 5%).</p>
        </div>
      </div>
    </div>
  )
}

// ── TOP NAV ───────────────────────────────────────────────────────────────
function TopNav({ route, setRoute, onNew, courseInfo, manage }) {
  const items = manage
    ? [['dashboard', 'Dashboard'], ['list', 'All Sheets'], ['fert', 'Fert Sheets'], ['program', 'Annual Program'], ['weather', 'Weather'], ['reports', 'Reports'], ['chemicals', 'Chemical Library'], ['settings', 'Settings']]
    : [['tospray', 'To Spray'], ['records', 'Records'], ['fert', 'Fert Sheets'], ['inventory', 'Inventory'], ['documents', 'Labels & SDS'], ['weather', 'Weather']]

  return (
    <div style={{ backgroundColor: FOREST }} className="text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-5 pb-4">
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
        <div className="flex gap-1 font-body text-sm overflow-x-auto no-scrollbar [&>*]:shrink-0">
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

// The season/soil weather comes from Open-Meteo's archive (Jan 1 → today), the
// slowest call on the dashboard. Cache it for the day so a revisit shows the
// Growth-Reg timing instantly instead of waiting for the network again.
const wxCacheKey = (lat, lng, day) => `wxSeasonCache:${Math.round(lat * 100)},${Math.round(lng * 100)},${day}`
function readWxCache(lat, lng, day) {
  if (typeof window === 'undefined' || lat == null) return null
  try { const raw = window.sessionStorage.getItem(wxCacheKey(lat, lng, day)); return raw ? JSON.parse(raw) : null } catch { return null }
}
function writeWxCache(lat, lng, day, patch) {
  if (typeof window === 'undefined' || lat == null) return
  try {
    const prev = readWxCache(lat, lng, day) || {}
    window.sessionStorage.setItem(wxCacheKey(lat, lng, day), JSON.stringify({ ...prev, ...patch }))
  } catch { /* ignore (private mode / quota) */ }
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────
function Dashboard({ sheets, pending, approved, todaySheets, products, areas, onOpen, onNew, onSeeAll, manage, programApps = [], onCreateFromProgram, location, courseInfo, onGoWeather, onGo, homeMode }) {
  // Home is a read-only overview — the create-a-spray-sheet affordances live on
  // the Annual Program and Spray Sheets screens, not here.
  const create = manage && !homeMode
  const lowStock = (products || []).filter((p) => p.lowStockThreshold > 0 && (p.stock || 0) <= p.lowStockThreshold)
  const today = localDateISO()

  // ── Live weather for the spray-window strip + season GDD for PGR timing.
  // Best-effort: the dashboard still renders everything else if this fails.
  const hasLocation = location?.lat != null
  const [wx, setWx] = useState(() => {
    const cached = readWxCache(location?.lat, location?.lng, today)
    return { current: null, todayWindow: null, season: cached?.season || [], breakdownTemps: cached?.breakdownTemps || [], forecast: [] }
  })
  useEffect(() => {
    if (!hasLocation) return
    let cancelled = false
    // On a location change, drop the previous location's readings first so we
    // never show (e.g.) DC's soil temp or GDD under a Chicago location while the
    // refetch lands — reseed from this location's own cache if we have it.
    const cached = readWxCache(location.lat, location.lng, today)
    setWx({ current: null, todayWindow: null, season: cached?.season || [], breakdownTemps: cached?.breakdownTemps || [], forecast: [] })
    // Fire all four independently and in parallel — each updates the dashboard as
    // soon as it lands. (They used to run one-after-another, so Growth-Reg timing,
    // which needs the season data, had to wait behind the other calls — the lag
    // the crew saw before the PGR card filled in.)
    ;(async () => {
      try {
        const data = await fetchWeather(location.lat, location.lng)
        const daily = dailyFromHourly(data)
        const todayRow = daily.find((d) => d.date === today) || daily[0] || null
        // The daily block carries the next ~14 days too — kept for projecting the
        // Growth-Reg reapply date from upcoming weather.
        const forecast = dailyFromForecastBlock(data)
        if (!cancelled) setWx((w) => ({ ...w, todayWindow: todayRow ? { ...todayRow, spray: sprayWindow(todayRow) } : null, forecast }))
      } catch { /* ignore */ }
    })()
    ;(async () => { try { const c = await fetchCurrent(location.lat, location.lng); if (!cancelled) setWx((w) => ({ ...w, current: c })) } catch { /* ignore */ } })()
    ;(async () => { try { const s = await fetchSeasonDaily(location.lat, location.lng); if (!cancelled) { setWx((w) => ({ ...w, season: s })); writeWxCache(location.lat, location.lng, today, { season: s }) } } catch { /* ignore */ } })()
    ;(async () => { try { const bt = await fetchBreakdownTemps(location.lat, location.lng); if (!cancelled) { setWx((w) => ({ ...w, breakdownTemps: bt })); writeWxCache(location.lat, location.lng, today, { breakdownTemps: bt }) } } catch { /* ignore */ } })()
    return () => { cancelled = true }
  }, [hasLocation, location?.lat, location?.lng, today])

  // ── Recent fungicide sprays, per area — a plain record of what went down and
  // what it covers, newest first (the superintendent judges coverage himself).
  const fungLog = manage ? fungicideLogByArea(sheets, products) : []

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

  // ── PGR reapply timing — the classic Primo/Anuew model: 200 GDD, base 0°C.
  // The daily temps are °F, so we accumulate GDD base 32°F and convert to °C
  // (÷1.8) for display against the familiar 200 target.
  const PGR_TARGET = 200 // GDD, base 0°C
  const pgrRows = (() => {
    if (!manage || !wx.season.length) return []
    // Growth suppression comes from true PGRs AND DMI (FRAC 3) fungicides, which
    // also regulate growth — so both reset the "GDD since suppression" clock.
    const supMap = suppressionMap(products)
    if (Object.keys(supMap).length === 0) return []
    const lastByArea = {}
    const areaHasPGR = {} // only areas actually running a PGR program get tracked
    ;(sheets || [])
      .filter((s) => sheetApplied(s) && s.date)
      .forEach((s) => {
        const sup = (s.products || []).filter((p) => supMap[p.product])
        if (sup.length === 0) return
        if (sup.some((p) => supMap[p.product] === 'pgr')) areaHasPGR[s.area] = true
        const dmiOnly = sup.every((p) => supMap[p.product] === 'dmi')
        if (!lastByArea[s.area] || s.date > lastByArea[s.area].date) lastByArea[s.area] = { date: s.date, products: sup.map((p) => p.product), dmiOnly }
      })
    // Only show areas with a real PGR program. A DMI fungicide (e.g. on the rough)
    // regulates growth, so it shifts the clock where you already run a PGR — but
    // it should NOT create a growth-reg task for a fungicide-only area.
    return Object.keys(lastByArea).filter((area) => areaHasPGR[area]).map((area) => {
      const last = lastByArea[area]
      const gddF = gddSince(wx.season, last.date, 32)
      const gdd = gddF == null ? null : Math.round(gddF / 1.8) // °F-GDD → °C-GDD
      const pct = gdd != null && PGR_TARGET > 0 ? Math.min(100, Math.round((gdd / PGR_TARGET) * 100)) : 0
      const status = gdd == null ? 'none' : gdd >= PGR_TARGET ? 'due' : gdd >= PGR_TARGET * 0.8 ? 'soon' : 'ok'
      // Projected reapply date from the upcoming forecast — remaining °C-GDD is
      // converted back to °F (×1.8) because the forecast walker works in °F.
      const est = gdd == null ? null : projectGddReachDate((PGR_TARGET - gdd) * 1.8, wx.forecast, 32, today)
      return { area, last, gdd, pct, status, est }
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
  if (pgrAlerts > 0) attention.push({ label: `${pgrAlerts} PGR reapply due`, tone: 'warn' })
  if (lowStock.length > 0) attention.push({ label: `${lowStock.length} product${lowStock.length > 1 ? 's' : ''} low on stock`, tone: 'bad' })

  return (
    <div className="pt-6 space-y-6">
      {manage && (
        <div className="flex justify-end -mb-2">
          <a href="/command" target="_blank" rel="noopener noreferrer" className="font-body text-[11px] font-bold px-3 py-1.5 rounded-full flex items-center gap-1.5 border" style={{ color: FOREST, borderColor: '#E2E8F0', backgroundColor: 'white' }} title="Open the wide Command Center on a monitor or shop TV">
            <BarChart3 size={13} /> Command Center ↗
          </a>
        </div>
      )}

      {/* Morning briefing — spray window + needs-attention at a glance (full width) */}
      {manage && (
        <SprayWindowStrip current={wx.current} today={wx.todayWindow} hasLocation={hasLocation} attention={attention} onGoWeather={onGoWeather} />
      )}

      {/* Stats cluster — one connected instrument panel, scans across full width */}
      <div className="paper-card stat-cluster grid grid-cols-4 overflow-hidden">
        <StatCard icon={<ClipboardList size={16} />} label="Pending Approval" value={pending.length} accent={pending.length > 0 ? '#B45309' : FERN} onClick={onGo ? () => onGo('list') : undefined} />
        <StatCard icon={<ShieldCheck size={16} />} label="Approved" value={approved.length} accent={FERN} onClick={onGo ? () => onGo('list') : undefined} />
        <StatCard icon={<Droplet size={16} />} label="Today" value={todaySheets.length} accent={GOLD} onClick={onGo ? () => onGo('list') : undefined} />
        <StatCard icon={<AlertTriangle size={16} />} label="Low Stock" value={lowStock.length} accent={lowStock.length > 0 ? '#DC2626' : FERN} onClick={onGo ? () => onGo(manage ? 'chemicals' : 'inventory') : undefined} />
      </div>

      {/* Wide split — the day's work in a broad main column, quick-glance boxes
          off to the side so information scans across instead of down. */}
      <div className="lg:grid lg:grid-cols-3 lg:gap-6 lg:items-start space-y-6 lg:space-y-0">
        {/* ── MAIN column ─────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Calendar — upcoming (planned) and past (actual) sprays at a glance */}
          <SprayCalendar
            sheets={sheets}
            products={products}
            programApps={manage ? programApps : []}
            onOpenSheet={onOpen}
            onCreateFromProgram={create ? onCreateFromProgram : undefined}
          />

          {/* Insight cards — two-across on very wide screens so there's less scrolling */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
            {/* Recent fungicide sprays — a plain record of what went down & covers */}
            {manage && fungLog.length > 0 && (
              <FungicideLogCard areas={fungLog} />
            )}

            {/* PGR reapply timing — GDD since each area's last growth-reg spray */}
            {manage && pgrRows.length > 0 && (
              <PgrTimingCard rows={pgrRows} target={PGR_TARGET} />
            )}
          </div>

          {/* From the Program — turn the plan into spray sheets */}
          {create && upcomingGroups.length > 0 && (
            <section>
              <SectionHeader title="From the Program" subtitle="Planned in the next 7 days — tap to start a spray sheet" />
              <div className="space-y-2">
                {upcomingGroups.map((g) => (
                  <div key={`${g.date}|${g.area}`} className="paper-card p-4 flex items-center justify-between gap-3" style={{ borderColor: '#E8CE92' }}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-body text-[11px] font-bold flex items-center gap-1 tnum" style={{ color: '#92660D' }}>
                          <Calendar size={11} />{new Date(g.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </span>
                        <span className="font-body text-sm font-semibold truncate" style={{ color: FOREST }}>{g.area}</span>
                      </div>
                      <p className="font-body text-[11px] truncate" style={{ color: INK_3 }}>
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

          {pending.length > 0 && (
            <section>
              <SectionHeader title="Awaiting Approval" subtitle="Sent to the Director — not yet live on iPads" />
              <div className="space-y-2">
                {pending.map((s) => <SheetRow key={s.id} sheet={s} onClick={() => onOpen(s)} highlight />)}
              </div>
            </section>
          )}

          {sheets.length === 0 && (
            <EmptyState onNew={onNew} manage={create} />
          )}
        </div>

        {/* ── SIDEBAR — quick-glance boxes ────────────────────────────── */}
        <div className="space-y-4">
          {/* 5-day forecast — a normal weather strip with little sun/cloud pics */}
          {manage && hasLocation && wx.forecast.length > 0 && (
            <ForecastStrip forecast={wx.forecast} today={today} onGoWeather={onGoWeather} />
          )}

          {/* Rain — a little year-to-date box; taps through to the full tracker */}
          {manage && hasLocation && wx.season.length > 0 && (() => {
            const rain = buildRainYear(wx.season, wx.forecast, courseInfo?.rainOverrides || {}, today)
            return (
              <button onClick={onGoWeather} className="w-full paper-card p-4 text-left transition">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: '#E8EEF6' }}>
                    <CloudRain size={16} style={{ color: '#3A6187' }} />
                  </div>
                  <p className="eyebrow">Rain · {rain.year}</p>
                </div>
                <p className="font-display text-2xl font-bold leading-none tnum" style={{ color: FOREST }}>{rain.ytd.toFixed(2)}"</p>
                <p className="font-body text-[11px] mt-0.5" style={{ color: INK_3 }}>year to date</p>
                <div className="mt-2.5 pt-2.5 flex items-center justify-between" style={{ borderTop: `1px solid ${HAIR}` }}>
                  <span className="font-body text-[11px]" style={{ color: INK_3 }}>Last 30 days ›</span>
                  <span className="font-body text-sm font-bold tnum" style={{ color: INK_2 }}>{rain.last30.toFixed(2)}"</span>
                </div>
              </button>
            )
          })()}

          {/* Soil-temp timing nudge — a window is open based on current soil temp */}
          {manage && timingNudge && openWins.length > 0 && (
            <div className="rounded-[10px] p-4" style={{ backgroundColor: '#EEF4EF', border: `1px solid #CFE0D5` }}>
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <p className="font-body text-sm font-bold flex items-center gap-1.5" style={{ color: FERN }}>
                  <Sprout size={15} /> Soil <span className="tnum">{soilNow}°F</span> — good timing
                </p>
                <button onClick={toggleTimingNudge} className="font-body text-[10px] font-bold shrink-0" style={{ color: INK_3 }} title="Turn off this nudge">Hide</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {openWins.map((w) => (
                  <span key={w.id} className="font-body text-[11px] font-semibold px-2.5 py-1 rounded-md" style={{ backgroundColor: PAPER, color: FERN, border: `1px solid #DCE8E0` }}>{w.label}</span>
                ))}
              </div>
              <p className="font-body text-[10px] mt-2" style={{ color: INK_3 }}>Based on your current 2&quot; soil temperature. See Turf → Timing for the full list.</p>
            </div>
          )}

          {/* Low stock — running low, order soon */}
          {manage && lowStock.length > 0 && (
            <div className="paper-card overflow-hidden" style={{ borderColor: '#E9C9C2' }}>
              <p className="eyebrow px-4 pt-3.5 pb-1 flex items-center gap-1.5" style={{ color: '#C0392B' }}><AlertTriangle size={12} /> Low Stock</p>
              {lowStock.map((p) => (
                <div key={p.name} className="flex items-center justify-between px-4 py-2.5" style={{ borderTop: `1px solid ${HAIR}` }}>
                  <span className="font-body text-sm truncate mr-2" style={{ color: INK_2 }}>{p.name}</span>
                  <span className="font-body text-xs font-bold tnum shrink-0" style={{ color: '#C0392B' }}>{p.stock} {p.unit} left</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// One cell of the instrument-panel stat cluster (the wrapping .paper-card and
// hairline dividers live in the Dashboard grid).
function StatCard({ icon, label, value, accent, onClick }) {
  const inner = (
    <>
      <div className="flex items-center gap-1.5 mb-2" style={{ color: accent }}>{icon}{onClick && <ChevronRight size={13} className="ml-auto" style={{ color: INK_3 }} />}</div>
      <p className="font-display text-3xl font-semibold tnum" style={{ color: FOREST }}>{value}</p>
      <p className="font-body text-[11px] mt-0.5 leading-tight" style={{ color: INK_3 }}>{label}</p>
    </>
  )
  if (onClick) return <button onClick={onClick} className="p-4 text-left w-full transition hover:bg-black/[0.02] active:bg-black/[0.04]">{inner}</button>
  return <div className="p-4">{inner}</div>
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
    <div className="rounded-[10px] overflow-hidden" style={{ border: `1px solid ${HAIR}` }}>
      {/* Clubhouse identity band — dark forest with a gold hairline beneath */}
      <button onClick={onGoWeather} className="w-full text-left" style={{ backgroundColor: FOREST, borderBottom: `2px solid ${GOLD_SOFT}` }}>
        <div className="px-4 py-3.5 flex items-center justify-between gap-3 text-white">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <Thermometer size={16} style={{ color: GOLD }} />
              <span className="font-display text-xl font-semibold tnum">
                {current?.temp ? `${current.temp}°` : hasLocation ? '—' : 'Set location'}
              </span>
            </div>
            {current && (current.wind || current.humidity) && (
              <span className="font-body text-[11px] opacity-70 flex items-center gap-2 min-w-0 truncate">
                {current.wind && <span className="flex items-center gap-1 tnum"><Wind size={11} />{current.wind} mph</span>}
                {current.humidity && <span className="tnum">{current.humidity}% RH</span>}
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
        <div className="px-4 py-2 font-body text-[11px]" style={{ backgroundColor: PAPER, color: INK_2, borderBottom: `1px solid ${HAIR}` }}>
          6am–noon: {today.spray.reasons.join(' · ')}
        </div>
      )}
      {attention.length > 0 && (
        <div className="px-4 py-2.5 flex flex-wrap gap-1.5" style={{ backgroundColor: PAPER }}>
          {attention.map((a, i) => (
            <span key={i} className="font-body text-[11px] font-semibold px-2.5 py-1 rounded-md flex items-center gap-1.5" style={{ backgroundColor: CREAM, color: toneColor[a.tone] || FERN, border: `1px solid ${HAIR}` }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: toneColor[a.tone] || FERN }} />
              {a.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// A little weather picture for a forecast day — sun, cloud, rain, etc. — mapped
// from the WMO code the weather service returns (via weatherCodeInfo).
const WX_ICON = {
  sun: { Icon: Sun, color: '#E0A82E' },
  partly: { Icon: CloudSun, color: '#D9A441' },
  cloud: { Icon: Cloud, color: '#7C8B93' },
  fog: { Icon: CloudFog, color: '#8A97A0' },
  drizzle: { Icon: CloudDrizzle, color: '#4E86B4' },
  rain: { Icon: CloudRain, color: '#3A6187' },
  snow: { Icon: CloudSnow, color: '#6FA0C4' },
  storm: { Icon: CloudLightning, color: '#7B5EA7' },
}
function WeatherIcon({ k, size = 22 }) {
  const w = WX_ICON[k] || WX_ICON.cloud
  const I = w.Icon
  return <I size={size} style={{ color: w.color }} />
}

// Compact 5-day forecast — a normal weather strip (little sun/cloud pictures +
// high/low) for the dashboard sidebar. Deliberately light on detail; the full
// numbers live on the Weather screen.
function ForecastStrip({ forecast = [], today, onGoWeather }) {
  const days = (forecast || []).filter((d) => d.date >= today).slice(0, 5)
  if (days.length === 0) return null
  return (
    <button onClick={onGoWeather} className="w-full paper-card p-3.5 text-left transition">
      <div className="flex items-center justify-between mb-2.5">
        <p className="eyebrow flex items-center gap-1.5"><CloudSun size={12} style={{ color: '#D9A441' }} /> 5-Day Forecast</p>
        <ChevronRight size={13} style={{ color: INK_3 }} />
      </div>
      <div className="flex items-stretch justify-between gap-1">
        {days.map((d, i) => {
          const info = weatherCodeInfo(d.code)
          const label = i === 0 ? 'Today' : new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })
          const wet = d.precipProb != null && d.precipProb >= 30
          return (
            <div key={d.date} className="flex flex-col items-center gap-1 flex-1 min-w-0" title={info.label}>
              <span className="font-body text-[10px] font-bold" style={{ color: i === 0 ? FOREST : INK_3 }}>{label}</span>
              <WeatherIcon k={info.key} size={22} />
              <span className="font-body text-[13px] font-bold tnum leading-none" style={{ color: FOREST }}>{d.tMax != null ? `${Math.round(d.tMax)}°` : '—'}</span>
              <span className="font-body text-[10px] tnum leading-none" style={{ color: INK_3 }}>{d.tMin != null ? `${Math.round(d.tMin)}°` : ''}</span>
              <span className="font-body text-[9px] font-semibold tnum leading-none" style={{ color: wet ? '#3A6187' : 'transparent' }}>{wet ? `${d.precipProb}%` : '0'}</span>
            </div>
          )
        })}
      </div>
    </button>
  )
}

// Recent fungicide sprays — a plain record, per area, newest first: what went
// down, when (and how long ago), and the diseases those products typically
// control. No status/countdown — the superintendent reads the history and
// judges coverage himself.
function agoLabel(since) {
  if (since == null) return ''
  if (since <= 0) return 'today'
  if (since === 1) return 'yesterday'
  return `${since} days ago`
}
function FungicideLogCard({ areas }) {
  return (
    <section>
      <SectionHeader title="Recent Fungicide Sprays" subtitle="What you've put down lately, by area — and the diseases each spray typically covers" />
      <div className="paper-card p-4 space-y-4">
        {areas.map((a) => (
          <div key={a.area}>
            <p className="font-body text-sm font-bold mb-1.5" style={{ color: FOREST }}>{a.area}</p>
            <div className="space-y-2">
              {a.sprays.map((s) => (
                <div key={s.date} className="rounded-lg px-3 py-2" style={{ backgroundColor: PAPER_2 }}>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-body text-[13px] font-semibold leading-tight" style={{ color: FOREST }}>{s.products.join(', ')}</p>
                    <span className="font-body text-[11px] tnum shrink-0" style={{ color: INK_3 }}>{fmtDate(s.date)} · {agoLabel(s.since)}</span>
                  </div>
                  {s.diseases.length > 0 && (
                    <p className="font-body text-[11px] leading-snug mt-1" style={{ color: FERN }}>
                      <span className="font-bold uppercase tracking-wide text-[9px]" style={{ color: INK_3 }}>Covers </span>
                      {s.diseases.join(' · ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="font-body text-[10px] mt-1.5" style={{ color: INK_3 }}>
        Diseases shown are the typical targets for each product (from the Chemical Library) — a memory aid, not a lab test.
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
      <SectionHeader title="Growth-Reg Timing" subtitle={`GDD since the last growth-suppressing spray — PGR or DMI fungicide (base 0°C) · target ~${target}`} />
      <div className="paper-card p-4 space-y-3">
        {rows.map((r) => {
          const s = st[r.status] || st.ok
          return (
            <div key={r.area}>
              <div className="flex items-center justify-between mb-1 gap-2">
                <span className="font-body text-sm font-semibold truncate" style={{ color: FOREST }}>{r.area}</span>
                <span className="font-body text-[10px] font-bold px-2 py-0.5 rounded shrink-0 tnum" style={{ backgroundColor: s.bg, color: s.fg }}>
                  {r.gdd} / {target} · {s.label}
                </span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: PAPER_2 }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(4, r.pct)}%`, backgroundColor: s.bar }} />
              </div>
              <p className="font-body text-[10px] mt-0.5 truncate" style={{ color: INK_3 }}>Last: {r.last.products.join(', ')}{r.last.dmiOnly && <span className="font-bold" style={{ color: '#6D4AC2' }}> · DMI (also regulates)</span>} · {fmtDate(r.last.date)}</p>
              {r.est && (
                <p className="font-body text-[10px] font-semibold mt-0.5 truncate" style={{ color: r.status === 'due' ? '#B91C1C' : FERN }}>
                  {r.status === 'due' ? 'Reapply now — target reached' : `Est. reapply ~${fmtDate(r.est.date)} (${r.est.days}d, forecast)`}
                </p>
              )}
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
      <h2 className="font-display text-lg font-semibold" style={{ color: FOREST }}>{title}</h2>
      {/* short gold rule under each heading — the club-stationery signature */}
      <div className="mt-1 h-px" style={{ width: 26, backgroundColor: GOLD_SOFT }} />
      {subtitle && <p className="font-body text-xs mt-1.5" style={{ color: INK_2 }}>{subtitle}</p>}
    </div>
  )
}

function EmptyState({ onNew, manage }) {
  return (
    <div className="paper-card p-10 text-center">
      <Sprout className="mx-auto mb-3" size={28} style={{ color: HAIR }} />
      <p className="font-body text-sm mb-4" style={{ color: INK_3 }}>No spray sheets yet</p>
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
      className="w-full text-left paper-card p-4 flex items-center justify-between transition active:scale-[0.99]"
      style={highlight ? { borderColor: '#E8CE92', backgroundColor: '#FBF6E9' } : undefined}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <p className="font-body font-semibold text-sm truncate" style={{ color: FOREST }}>{sheet.area}</p>
          {sheet.completed ? (
            <span className="font-body text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wide" style={{ backgroundColor: '#E8F3EC', color: FERN }}>Sprayed</span>
          ) : (
            <StatusPill status={sheet.status} />
          )}
        </div>
        <div className="flex items-center gap-3 mt-1.5 font-body text-[11px]" style={{ color: INK_3 }}>
          <span className="flex items-center gap-1 tnum"><Calendar size={10} />{fmtDate(sheet.date)}</span>
          {sheet.operator && <span className="flex items-center gap-1"><User size={10} />{sheet.operator}</span>}
          <span className="tnum">{productCount} product{productCount !== 1 ? 's' : ''}</span>
        </div>
      </div>
      <ChevronRight size={16} className="shrink-0 ml-2" style={{ color: HAIR }} />
    </button>
  )
}

function StatusPill({ status }) {
  const styles = status === 'approved' ? { backgroundColor: '#E8F3EC', color: FERN } : { backgroundColor: '#FEF3DD', color: '#92660D' }
  return (
    <span className="font-body text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wide" style={styles}>
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
  const [q, setQ] = useState('')
  const active = cfg.keys.length ? filter : cfg.initial
  const needle = q.trim().toLowerCase()
  const searchMatch = (s) => !needle || [s.area, s.operator, s.completedBy, s.date, ...(s.products || []).flatMap((p) => [p.product, p.target])].some((v) => String(v || '').toLowerCase().includes(needle))
  const filtered = sheets.filter((s) => matchSheetFilter(s, active) && searchMatch(s))

  // One row per product line, so the export drops straight into a spreadsheet.
  const exportRecordsCsv = () => {
    const rows = [['Date', 'Area', 'Applicator', 'Tanks', 'Product', 'Rate', 'Basis', 'Spraying for', 'Temp F', 'Wind mph', 'Humidity %', 'Wind dir']]
    filtered.forEach((s) => {
      const w = s.weather || {}
      ;(s.products || []).filter((p) => p.product).forEach((p) => {
        rows.push([s.date || '', s.area || '', s.completedBy || s.operator || '', s.tanks ?? '', p.product, p.rate ?? '', p.basis || '', p.target || '', w.temp || '', w.wind || '', w.humidity || '', w.windDir || ''])
      })
    })
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = `spray-records_${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

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
      {(variant === 'records' || variant === 'manage') && (
        <div className="flex items-center gap-2 mb-3 mt-1">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by area, product, applicator, date…" className="w-full border border-slate-200 rounded-full pl-9 pr-3 py-2 text-sm font-body bg-white" />
          </div>
          {variant === 'records' && (
            <button onClick={exportRecordsCsv} disabled={!filtered.length} className="font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5 border disabled:opacity-40 shrink-0" style={{ color: FOREST, borderColor: FOREST, backgroundColor: 'white' }}>
              <CloudUpload size={14} className="rotate-180" /> Export CSV
            </button>
          )}
        </div>
      )}
      {filtered.length === 0 ? (
        <div className="mt-3 bg-white rounded-2xl border border-black/5 p-10 text-center text-slate-400 font-body text-sm shadow-sm">
          {needle ? 'No sheets match your search.' : variant === 'tospray' ? 'Nothing to spray right now — all caught up.' : variant === 'records' ? 'No completed sprays yet.' : 'No sheets match this filter.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-2 mt-3 items-start">
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
// Every dropdown in the app is a type-to-search picker (see components/pickers).
function Select({ value, onChange, options, placeholder }) {
  return <SearchSelect value={value} options={options} onPick={onChange} placeholder={placeholder || 'Search…'} />
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
function SheetEditor({ sheet, onSave, onCancel, saving, products, areas, operators, targets: targetOptions, sheetTypes, location, sheets = [], courseInfo = {} }) {
  const [s, setS] = useState({ ...sheet, targets: sheet.targets || (sheet.target ? [sheet.target] : []) })
  const [nTargets, setNTargets] = useState({}) // per-line "feed by N" target (lb N/M)
  const area = resolveArea(areas, s.area) || areas[Object.keys(areas)[0]] || { tanks: 1, nozzle: '', psi: '', galTank: 0, sqft: 0 }
  const rotationAlerts = rotationWarnings(s, sheets, products)

  const update = (patch) => setS((prev) => ({ ...prev, ...patch }))
  const updateProduct = (id, patch) => setS((prev) => ({ ...prev, products: prev.products.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
  const removeRow = (id) => setS((prev) => ({ ...prev, products: prev.products.filter((p) => p.id !== id) }))

  // Area is now the sheet's identity — keep sheetType mirroring it so older
  // records and any place that still reads sheetType show the area name.
  const handleAreaChange = (areaName) => update({ area: areaName, sheetType: areaName, tanks: areas[areaName].tanks })
  const handleProductSelect = (id, name) => {
    const prod = products.find((p) => p.name === name)
    updateProduct(id, { product: name, basis: prod?.basis || '', defaultRate: prod?.rate ?? null })
  }
  // Add or remove a product from the tank mix — tap several at once, like the
  // Annual Program. Fills a leading blank row first, else appends.
  const toggleProductRow = (name) => setS((prev) => {
    if (prev.products.some((p) => p.product === name)) return { ...prev, products: prev.products.filter((p) => p.product !== name) }
    const prod = products.find((pr) => pr.name === name)
    const filled = { product: name, basis: prod?.basis || '', defaultRate: prod?.rate ?? null }
    const blankIdx = prev.products.findIndex((p) => !p.product)
    if (blankIdx >= 0) { const copy = [...prev.products]; copy[blankIdx] = { ...copy[blankIdx], ...filled }; return { ...prev, products: copy } }
    return { ...prev, products: [...prev.products, { id: uid(), rate: '', forceGal: false, ...filled }] }
  })
  // A product line's target is a comma-joined string ("Dollar Spot, Brown Patch").
  const splitTargets = (str) => String(str || '').split(',').map((x) => x.trim()).filter(Boolean)
  // The sheet's overall targets are derived from the per-product "Spraying for"
  // choices — there's no separate sheet-level target picker any more.
  const productTargets = [...new Set((s.products || []).flatMap((p) => splitTargets(p.target)))]

  return (
    <div className="pt-6 pb-10 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <button onClick={onCancel} className="font-body text-sm font-medium text-slate-400">Cancel</button>
        <h2 className="font-display text-lg font-semibold text-slate-900">{sheet.status === 'pending' && sheet.directorSig === '' ? 'Spray Sheet' : 'Edit Sheet'}</h2>
        <button onClick={() => onSave({ ...s, targets: productTargets.length ? productTargets : (s.targets || []) })} disabled={saving} className="font-body text-xs font-bold px-4 py-2 rounded-full text-white disabled:opacity-50" style={{ backgroundColor: FOREST }}>
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

        {(() => {
          const kinds = (s.products || []).filter((p) => p.product).map((p) => suppressionKind(products.find((x) => x.name === p.product))).filter(Boolean)
          if (!kinds.includes('dmi')) return null
          const hasPGR = kinds.includes('pgr')
          return (
            <div className="rounded-2xl border p-3" style={{ backgroundColor: '#F5F3FB', borderColor: '#E4DCF5' }}>
              <div className="flex items-center gap-1.5 mb-1">
                <Info size={15} style={{ color: '#6D4AC2' }} />
                <p className="font-body text-[12px] font-bold" style={{ color: '#5B3EA6' }}>Growth regulation from a DMI</p>
              </div>
              <p className="font-body text-[11px]" style={{ color: '#5B3EA6' }}>
                {hasPGR
                  ? 'This tank has a PGR and a DMI (FRAC 3) fungicide. DMIs also suppress growth, so they stack — watch for over-regulation, especially in summer heat, and consider easing the PGR rate.'
                  : 'This tank includes a DMI (FRAC 3) fungicide, which also regulates growth. It will count as a growth-suppression event in your Growth-Reg timing.'}
              </p>
            </div>
          )
        })()}

        <Card>
          <FieldLabel>Products</FieldLabel>
          <MultiSelect selected={s.products.map((p) => p.product).filter(Boolean)} options={products.map((pr) => pr.name)} onToggle={toggleProductRow} hideChips placeholder="Search products — tap to add several…" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mt-3 items-start">
            {sortByMixOrder(s.products.filter((p) => p.product), (p) => products.find((pr) => pr.name === p.product), courseInfo.mixOrder).map((p, mixIdx) => {
              const { value: amt, unit: amtUnit } = calcAmount(parseFloat(p.rate), p.basis, area.sqft, p.forceGal)
              const total = amt !== null ? Math.round(amt * s.tanks * 10) / 10 : null
              const prodInfo = products.find((pr) => pr.name === p.product)
              const labelMax = p.basis?.includes('/ M') ? prodInfo?.labelMaxM : prodInfo?.labelMaxA
              const labelMin = p.basis?.includes('/ M') ? prodInfo?.labelMinM : prodInfo?.labelMinA
              const rateNum = parseFloat(p.rate)
              const overLimit = labelMax && rateNum && rateNum > labelMax
              // Only flag going OVER the label rate — under-rate is intentional often.
              const outOfRange = overLimit
              return (
                <div key={p.id} className="border rounded-xl p-3" style={{ borderColor: outOfRange ? '#FCA5A5' : '#E2E8F0' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="shrink-0 inline-flex items-center justify-center font-body text-[11px] font-extrabold rounded" style={{ width: 20, height: 20, backgroundColor: '#EAF2EC', color: FOREST }}>{mixIdx + 1}</span>
                    <span className="font-body text-sm font-bold min-w-0 truncate" style={{ color: FOREST }}>{p.product}</span>
                    <span className="font-body text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0" style={{ backgroundColor: '#F1F5F3', color: '#57756A' }}>{FORMULATION_LABEL[effectiveFormulation(prodInfo || { name: p.product })] || 'Other'}</span>
                    <button onClick={() => removeRow(p.id)} className="text-red-400 p-1 shrink-0 ml-auto"><Trash2 size={15} /></button>
                  </div>
                  {p.product && (
                    <>
                      <div className="grid grid-cols-2 gap-2 mb-1">
                        <input type="number" step="any" placeholder={p.defaultRate ? `Default ${p.defaultRate}` : 'Rate'} value={p.rate} onChange={(e) => updateProduct(p.id, { rate: e.target.value })} className="border-2 rounded-lg px-2.5 py-2 text-sm font-semibold font-body" style={{ borderColor: outOfRange ? '#EF4444' : GOLD, backgroundColor: outOfRange ? '#FEF2F2' : '#FFFBF0' }} />
                        <SearchSelect value={p.basis} options={BASIS_OPTIONS} onPick={(v) => updateProduct(p.id, { basis: v })} sort={false} placeholder="Basis…" />
                      </div>

                      {/* What are we spraying this for — the crew sees this on the sheet.
                          Multi-select: pick one or more. Options are the likely diseases
                          for this product, its purpose, and your saved target list. */}
                      {(() => {
                        const suggested = diseasesForProduct({ name: p.product, activeIngredient: prodInfo?.activeIngredient })
                        const t = String(prodInfo?.type || '').toLowerCase()
                        const tp = t.includes('growth') ? 'Growth Reg' : t.includes('herb') ? 'Weed control' : t.includes('insect') ? 'Insect control' : t.includes('fert') ? 'Feed / nutrition' : null
                        const sel = splitTargets(p.target)
                        const allOpts = Array.from(new Set([...(suggested || []), ...(tp ? [tp] : []), ...(targetOptions || [])].filter(Boolean)))
                        const toggleT = (tg) => updateProduct(p.id, { target: (sel.includes(tg) ? sel.filter((x) => x !== tg) : [...sel, tg]).join(', ') })
                        return (
                          <div className="mb-2">
                            <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1 mb-1"><Target size={11} /> Spraying for</label>
                            <MultiSelect selected={sel} options={allOpts} onToggle={toggleT} placeholder="Search what you’re spraying for — tap several…" />
                          </div>
                        )
                      })()}

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
                      {!overLimit && labelMin && rateNum > 0 && rateNum < labelMin && (
                        <p className="font-body text-[11px] font-semibold mb-2 flex items-center gap-1" style={{ color: '#B45309' }}>↓ Below label minimum ({labelMin} {p.basis}) — light rate. Fine if that's intended.</p>
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

        {/* Build-time check: are we short on any product for the whole job, and
            how full is the tank? Live as rates/tanks change. */}
        {(() => {
          const plan = mixPlan(s, area, products, courseInfo?.mixOrder)
          if (!plan.hasProducts) return null
          return (
            <Card>
              <div className="flex items-center justify-between">
                <FieldLabel noMargin>Tank &amp; Stock Check</FieldLabel>
                <span className="font-body text-[11px] text-slate-400">{plan.totalSolutionGal} gal · {plan.tanks} tank{plan.tanks > 1 ? 's' : ''}{plan.totalLiquidPct != null ? ` · products ~${plan.totalLiquidPct}% of tank` : ''}</span>
              </div>
              {plan.stockIssues.length > 0 ? (
                <div className="rounded-lg px-3 py-2 mt-2 font-body text-[12px] flex items-start gap-1.5" style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}>
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span><b>Short on stock for this job:</b> {plan.stockIssues.map((l) => `${l.name} — need ${l.need}, have ${l.stock} ${l.stockUnit}`).join('; ')}.</span>
                </div>
              ) : (
                <p className="font-body text-[12px] text-slate-500 mt-2 flex items-center gap-1.5"><Check size={14} style={{ color: FERN }} /> Enough stock on hand for every product.</p>
              )}
            </Card>
          )
        })()}
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
// Parse a re-entry interval string ("12 hours", "2 days") to hours, or null.
function reiHours(str) {
  const m = String(str || '').match(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|d|day|days)/i)
  if (!m) return null
  const n = parseFloat(m[1])
  return /^d/i.test(m[2]) ? n * 24 : n
}
function sheetRecordHTML(sheet, area = {}, products = [], sheetTargets = [], courseInfo = {}) {
  const L = 'border:1px solid #ccc;padding:5px 8px;background:#F0F0EA;font-weight:700;width:15%'
  const V = 'border:1px solid #ccc;padding:5px 8px;width:35%'
  const TH = 'border:1px solid #16291F;padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;color:#fff'
  const R = 'border:1px solid #ccc;padding:5px 8px'
  const tbl = 'width:100%;border-collapse:collapse;font-size:11px;margin-bottom:12px'
  const blank = '_______________________'

  // Partial fill is folded straight into each product's TOTAL so the sheet stays
  // one connected list (no separate extra-spray table).
  const partialGal = sheet.partialGallons
  const hasPartial = partialGal && area.galTank
  const rows = sortByMixOrder((sheet.products || []).filter((p) => p.product), (p) => products.find((pr) => pr.name === p.product), courseInfo.mixOrder).map((p) => {
    const prodInfo = products.find((pr) => pr.name === p.product) || {}
    const { value: amt, unit } = calcAmount(parseFloat(p.rate), p.basis, area.sqft, p.forceGal)
    let partialAmt = 0
    if (hasPartial && amt !== null) {
      const { value: pAmt } = calcAmount(parseFloat(p.rate), p.basis, effectiveSqft(partialGal, area), p.forceGal)
      partialAmt = pAmt || 0
    }
    const total = amt !== null ? Math.round((amt * (sheet.tanks || 1) + partialAmt) * 10) / 10 : null
    return { ...p, amt, total, unit, epaReg: prodInfo.epaReg, ai: prodInfo.activeIngredient, rei: prodInfo.rei, signalWord: prodInfo.signalWord }
  })
  const productRows = rows.map((p, i) => {
    const forLine = (p.target && String(p.target).trim()) ? `<div style="font-size:9px;color:#3A6B4A;margin-top:1px">For: ${esc(p.target)}</div>` : ''
    const meta = [p.epaReg && `EPA Reg&nbsp;# ${esc(p.epaReg)}`, p.ai && `AI: ${esc(p.ai)}`, p.rei && `REI: ${esc(p.rei)}`, p.signalWord && esc(p.signalWord)].filter(Boolean).join(' · ')
    const metaLine = meta ? `<div style="font-size:9px;color:#666;margin-top:1px">${meta}</div>` : ''
    return `<tr style="background:${i % 2 === 0 ? '#fff' : '#F5F5F0'}">
    <td style="${R}"><b>${i + 1}.</b> ${esc(p.product)}${forLine}${metaLine}</td><td style="${R}">${esc(p.rate)}</td><td style="${R}">${esc(p.basis)}</td>
    <td style="${R}">${p.amt ?? '—'} ${esc(p.unit || '')}</td><td style="${R};font-weight:700">${p.total ?? '—'} ${esc(p.unit || '')}</td></tr>`
  }).join('')

  // Restricted-entry summary: the longest REI on the sheet, and — if signed off
  // with a parseable interval — the time the area is clear to re-enter.
  const maxRei = rows.reduce((mx, p) => { const h = reiHours(p.rei); return h != null && h > mx ? h : mx }, 0)
  const longestReiLabel = (rows.find((p) => reiHours(p.rei) === maxRei) || {}).rei || ''
  let reiRow = ''
  if (maxRei > 0) {
    let clear = ''
    if (sheet.completedAt) { const t = new Date(new Date(sheet.completedAt).getTime() + maxRei * 3600000); clear = ` — keep posted until <b>${esc(t.toLocaleString())}</b>` }
    reiRow = `<table style="${tbl}"><tbody><tr><td style="${L};background:#FFF7E6">Restricted Entry</td><td style="${V}" colspan="3">Longest REI on this sheet: <b>${esc(longestReiLabel || `${maxRei} hours`)}</b>${clear}. Do not allow entry until the interval has passed.</td></tr></tbody></table>`
  }
  const partialNote = hasPartial ? `<div style="font-size:10px;color:#555;margin:-6px 0 12px">Totals include the ${esc(partialGal)} gal partial fill (${sheet.tanks || 1} full tank${(sheet.tanks || 1) !== 1 ? 's' : ''} + ${esc(partialGal)} gal).</div>` : ''
  const sig = (v) => v ? `<img src="${v}" style="height:48px;max-width:100%" />` : blank
  const w = sheet.weather || {}

  return `<div style="font-family:Arial,sans-serif;color:#111">
    <div style="text-align:center;border-bottom:2px solid #16291F;padding-bottom:10px;margin-bottom:14px">
      <div style="font-size:18px;font-weight:700">${esc(courseInfo.clubName || 'Golf Club')}</div>
      <div style="font-size:12px;color:#555">${esc(courseInfo.deptName || 'Grounds Operations')} — Spray Record</div>
    </div>
    <table style="${tbl}"><tbody>
      <tr><td style="${L}">Area</td><td style="${V}">${esc(sheet.area)}</td><td style="${L}">Date</td><td style="${V}">${esc(sheet.date)}</td></tr>
      <tr><td style="${L}">Operator</td><td style="${V}">${esc(sheet.operator || '—')}</td><td style="${L}">Tanks</td><td style="${V}">${esc(sheet.tanks)}${area.galTank ? ` × ${esc(area.galTank)} gal` : ''}${hasPartial ? ` + ${esc(partialGal)} gal partial` : ''}</td></tr>
      <tr><td style="${L}">Nozzle</td><td style="${V}">${esc(area.nozzle || '—')}</td><td style="${L}">PSI</td><td style="${V}">${esc(area.psi || '—')}</td></tr>
      <tr><td style="${L}">Target</td><td style="${V}" colspan="3">${esc(sheetTargets.join(', ') || '—')}</td></tr>
      <tr><td style="${L}">Weather</td><td style="${V}" colspan="3">${w.temp ? `${esc(w.temp)}°F` : '—'} · ${w.wind ? `${esc(w.wind)} mph wind` : '—'} · ${w.humidity ? `${esc(w.humidity)}% humidity` : '—'} · ${esc(w.windDir || '—')}</td></tr>
    </tbody></table>
    <table style="${tbl}"><thead><tr style="background:#16291F"><th style="${TH}">Product</th><th style="${TH}">Rate</th><th style="${TH}">Basis</th><th style="${TH}">Amt/Tank</th><th style="${TH}">Total</th></tr></thead><tbody>${productRows}</tbody></table>
    ${partialNote}
    <table style="${tbl}"><tbody>
      <tr><td style="${L}">PPE</td><td style="${V}" colspan="3">${esc((sheet.ppe || []).join(', ') || '—')}</td></tr>
      <tr><td style="${L}">Instructions</td><td style="${V}" colspan="3">${esc(sheet.instructions || '—')}</td></tr>
    </tbody></table>
    <table style="${tbl}"><tbody><tr><td style="${L};background:#FEF2F2">Safety Notice</td><td style="${V}" colspan="3">Check ALL nozzles before leaving maintenance area. Calculate rates BEFORE filling sprayer.</td></tr></tbody></table>
    ${reiRow}
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

// Build a one-tap board report for a whole season: spend, environmental impact
// (EIQ), resistance rotation, nutrients, and the full application log — all from
// the sprays already on record. Returns an HTML body for the shared PDF pipeline.
function seasonReportHTML(allSheets, products, areas, courseInfo = {}, year) {
  const sheets = (allSheets || []).filter((s) => String(s.date || '').slice(0, 4) === String(year))
  const cost = productCosts(sheets, products, areas)
  const eiq = eiqLoad(sheets, products, areas)
  const npk = aggregateNPK(sheets, products, areas)
  const rot = rotationByArea(sheets, products)
  const done = sheets.filter((s) => s.status === 'approved' || s.completed)

  const money = (n) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const num = (n) => (n || 0).toLocaleString('en-US')
  const monthLabel = (m) => { const [y, mm] = m.split('-'); return new Date(Number(y), Number(mm) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) }
  const TH = 'border:1px solid #16291F;padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;color:#fff'
  const R = 'border:1px solid #ccc;padding:5px 8px;font-size:11px'
  const RB = R + ';font-weight:700'
  const tbl = 'width:100%;border-collapse:collapse;margin-bottom:14px'
  const h2 = 'font-size:13px;font-weight:700;color:#16291F;margin:18px 0 6px;border-bottom:1px solid #C9A84C;padding-bottom:3px'

  const totalN = Math.round(npk.reduce((s, r) => s + r.n, 0) * 10) / 10
  const totalP = Math.round(npk.reduce((s, r) => s + r.p, 0) * 10) / 10
  const totalK = Math.round(npk.reduce((s, r) => s + r.k, 0) * 10) / 10

  const kpi = (label, value) => `<td style="border:1px solid #16291F;padding:8px;text-align:center;width:25%">
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#555">${label}</div>
    <div style="font-size:17px;font-weight:700;color:#16291F;margin-top:2px">${value}</div></td>`

  const costMonth = cost.byMonth.map((r) => `<tr><td style="${R}">${monthLabel(r.month)}</td><td style="${RB};text-align:right">${money(r.cost)}</td></tr>`).join('') || `<tr><td style="${R}" colspan="2">No priced sprays.</td></tr>`
  const costArea = cost.byArea.map((r) => `<tr><td style="${R}">${esc(r.area)}</td><td style="${RB};text-align:right">${money(r.cost)}</td></tr>`).join('') || `<tr><td style="${R}" colspan="2">No priced sprays.</td></tr>`
  const eiqRows = eiq.rows.slice(0, 12).map((r) => `<tr><td style="${R}">${esc(r.name)}</td><td style="${R}">${esc(r.type)}</td><td style="${R};text-align:right">${r.apps}</td><td style="${RB};text-align:right">${num(r.load)}</td></tr>`).join('') || `<tr><td style="${R}" colspan="4">No scored pesticide sprays. Add EIQ values in the Chemical Library.</td></tr>`

  // Resistance flags — any same-group repeat inside its window.
  const flags = []
  Object.entries(rot).forEach(([area, list]) => list.forEach((e) => { if (e.tooSoon) flags.push({ area, ...e }) }))
  const flagRows = flags.length
    ? flags.map((f) => `<tr><td style="${R}">${esc(f.area)}</td><td style="${R}">Group ${esc(f.group)}</td><td style="${R}">${esc(f.product)}</td><td style="${R}">${f.prev?.days}d after ${esc(f.prev?.product || '')}</td></tr>`).join('')
    : `<tr><td style="${R};color:#2E7D32" colspan="4">No resistance-window violations — modes of action were rotated well.</td></tr>`

  const npkArea = {}
  npk.forEach((r) => { const a = (npkArea[r.area] ||= { area: r.area, n: 0, p: 0, k: 0 }); a.n += r.n; a.p += r.p; a.k += r.k })
  const npkRows = Object.values(npkArea).map((a) => `<tr><td style="${R}">${esc(a.area)}</td><td style="${R};text-align:right">${Math.round(a.n * 10) / 10}</td><td style="${R};text-align:right">${Math.round(a.p * 10) / 10}</td><td style="${R};text-align:right">${Math.round(a.k * 10) / 10}</td></tr>`).join('') || `<tr><td style="${R}" colspan="4">No fertilizer recorded.</td></tr>`

  const log = [...done].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .map((s) => `<tr><td style="${R}">${esc(s.date || '')}</td><td style="${R}">${esc(s.area || '')}</td><td style="${R}">${esc((s.products || []).filter((p) => p.product).map((p) => p.product).join(', '))}</td><td style="${R}">${s.completed ? 'Sprayed' : 'Approved'}</td></tr>`).join('') || `<tr><td style="${R}" colspan="4">No applications recorded.</td></tr>`

  return `<div style="font-family:Arial,sans-serif;color:#111">
    <div style="text-align:center;border-bottom:2px solid #16291F;padding-bottom:10px;margin-bottom:6px">
      <div style="font-size:19px;font-weight:700">${esc(courseInfo.clubName || 'Golf Club')}</div>
      <div style="font-size:12px;color:#555">${esc(courseInfo.deptName || 'Grounds Operations')} — ${esc(year)} Season Report</div>
    </div>
    <table style="${tbl}"><tbody><tr>
      ${kpi('Applications', num(done.length))}
      ${kpi('Total Spend', money(cost.totalCost))}
      ${kpi('EIQ Load', num(eiq.total))}
      ${kpi('Fertilizer N (lbs)', num(totalN))}
    </tr></tbody></table>

    <div style="${h2}">Program Cost</div>
    <table style="${tbl}"><thead><tr style="background:#16291F"><th style="${TH}">Month</th><th style="${TH};text-align:right">Spend</th></tr></thead><tbody>${costMonth}</tbody></table>
    <table style="${tbl}"><thead><tr style="background:#16291F"><th style="${TH}">Area</th><th style="${TH};text-align:right">Spend</th></tr></thead><tbody>${costArea}</tbody></table>

    <div style="${h2}">Environmental Impact (EIQ)</div>
    <p style="font-size:10px;color:#555;margin:0 0 6px">Cornell EIQ Field Use Rating summed across pesticide sprays (EIQ × active % × amount applied). Relative score — lower is better. Season total: <b>${num(eiq.total)}</b>.</p>
    <table style="${tbl}"><thead><tr style="background:#3A6B4A"><th style="${TH}">Product</th><th style="${TH}">Type</th><th style="${TH};text-align:right">Apps</th><th style="${TH};text-align:right">EIQ load</th></tr></thead><tbody>${eiqRows}</tbody></table>

    <div style="${h2}">Resistance &amp; Rotation</div>
    <table style="${tbl}"><thead><tr style="background:#7C3AED"><th style="${TH}">Area</th><th style="${TH}">Group</th><th style="${TH}">Product</th><th style="${TH}">Repeat</th></tr></thead><tbody>${flagRows}</tbody></table>

    <div style="${h2}">Nutrients Applied (lbs)</div>
    <table style="${tbl}"><thead><tr style="background:#16291F"><th style="${TH}">Area</th><th style="${TH};text-align:right">N</th><th style="${TH};text-align:right">P</th><th style="${TH};text-align:right">K</th></tr></thead><tbody>${npkRows}<tr><td style="${RB}">Total</td><td style="${RB};text-align:right">${totalN}</td><td style="${RB};text-align:right">${totalP}</td><td style="${RB};text-align:right">${totalK}</td></tr></tbody></table>

    <div style="${h2}">Application Log</div>
    <table style="${tbl}"><thead><tr style="background:#16291F"><th style="${TH}">Date</th><th style="${TH}">Area</th><th style="${TH}">Products</th><th style="${TH}">Status</th></tr></thead><tbody>${log}</tbody></table>

    <p style="font-size:9px;color:#888;margin-top:16px;text-align:center">Generated ${esc(new Date().toLocaleString())} · ${esc(courseInfo.clubName || '')} ${esc(year)} Season Report</p>
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

// Print a spray record on exactly ONE page. Browsers flow HTML across as many
// pages as it takes, so instead we render the whole sheet to a single image and
// print that image scaled to fit the page (width AND height) — guaranteeing one
// page on iPad Safari where CSS print-scaling is unreliable.
async function printRecordSinglePage(bodyHtml) {
  const holder = document.createElement('div')
  Object.assign(holder.style, { position: 'absolute', left: '-10000px', top: '0', width: '760px', background: '#ffffff' })
  holder.innerHTML = bodyHtml
  document.body.appendChild(holder)
  await waitForImages(holder)
  let dataUrl
  try {
    const html2canvas = (await import('html2canvas')).default
    const canvas = await html2canvas(holder, { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: 820 })
    dataUrl = canvas.toDataURL('image/jpeg', 0.95)
  } catch (e) {
    console.error('Single-page print render failed, falling back to normal print', e)
  } finally {
    holder.remove()
  }
  if (!dataUrl) { printRecordHTML(bodyHtml); return }

  const iframe = document.createElement('iframe')
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
  document.body.appendChild(iframe)
  const doc = iframe.contentWindow.document
  doc.open()
  // max-height (9.6in) sits under a US-Letter printable height so the single
  // image always fits one page on Letter or A4, aspect ratio preserved.
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:0.4in;size:portrait}html,body{margin:0;padding:0}img{display:block;margin:0 auto;max-width:100%;max-height:9.6in}</style></head><body><img src="${dataUrl}"></body></html>`)
  doc.close()
  const go = () => { try { iframe.contentWindow.focus(); iframe.contentWindow.print() } finally { setTimeout(() => iframe.remove(), 1000) } }
  const img = doc.images[0]
  if (img && !img.complete) { img.onload = go; img.onerror = go; setTimeout(go, 1500) } else { setTimeout(go, 250) }
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
async function pdfRecordHTML(bodyHtml, filename, opts = {}) {
  const singlePage = !!opts.singlePage
  const holder = document.createElement('div')
  Object.assign(holder.style, { position: 'absolute', left: '-10000px', top: '0', width: '760px', background: '#ffffff' })
  holder.innerHTML = bodyHtml
  document.body.appendChild(holder)
  await waitForImages(holder)
  try {
    let blob
    if (singlePage) {
      // Force everything onto ONE A4 page — capture the whole sheet as one image
      // and scale it down to fit if it's tall (spray sheets should never spill).
      const html2canvas = (await import('html2canvas')).default
      const { jsPDF } = await import('jspdf')
      const canvas = await html2canvas(holder, { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: 820 })
      const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' })
      const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight()
      const m = 16
      let w = pw - m * 2
      let h = canvas.height * (w / canvas.width)
      const availH = ph - m * 2
      if (h > availH) { h = availH; w = canvas.width * (h / canvas.height) }
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', (pw - w) / 2, m, w, h)
      blob = pdf.output('blob')
    } else {
      const html2pdf = (await import('html2pdf.js')).default
      const worker = html2pdf().set({
        margin: 8,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: 820 },
        jsPDF: { unit: 'pt', format: 'a4', orientation: 'portrait' },
      }).from(holder)
      const pdf = await worker.toPdf().get('pdf')
      blob = pdf.output('blob')
    }
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
function SheetViewer({ sheet, onBack, onEdit, onDelete, onSprayAgain, onApprove, onLogSpray, onRemoteSheet, products, areas, directors, operators = [], applicatorLicenses = {}, directorPins = {}, location, courseInfo, manage, approve }) {
  // TEMP (testing): let the manager tick tanks + log sprays too. The crew normally
  // owns the fill/tick flow; restore this to `!manage` to hide it from managers.
  const canFill = true
  const [confirmDel, setConfirmDel] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
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
  // The spray is "done in the field" once every product is ticked into every
  // tank. Until then the crew is still filling/spraying, so we keep the sign-off
  // section (weather + signature) tucked away and only reveal it at the end.
  const allTanksDone = productIds.length > 0 && completedCount === tankCount

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
  const printRecord = () => printRecordSinglePage(buildRecordHtml())
  const exportPdf = async () => {
    setPdfBusy(true)
    try {
      const safe = `${sheet.area || 'Spray'}-${sheet.date || ''}`.replace(/[^\w-]+/g, '_')
      await pdfRecordHTML(buildRecordHtml(), `Spray-Sheet_${safe}.pdf`, { singlePage: true })
    } catch (e) { console.error(e) }
    setPdfBusy(false)
  }

  return (
    <div className="pt-6 pb-10 max-w-7xl mx-auto">
      <div className="no-print flex items-center justify-between gap-2 mb-5">
        <button onClick={onBack} className="font-body text-sm font-medium text-slate-400 shrink-0">← Back</button>
        <div className="flex items-center gap-2 sm:gap-3">
          <StatusPill status={sheet.status} />
          {manage && (
            <button onClick={onEdit} className="font-body text-sm font-semibold px-3 py-1.5 rounded-full" style={{ color: FERN, border: `1px solid ${FERN}` }}>Edit</button>
          )}
          {/* Everything else tucked into one tidy menu */}
          <div className="relative">
            <button onClick={() => setMenuOpen((o) => !o)} className="font-body text-sm font-semibold px-2.5 py-1.5 rounded-full flex items-center gap-1" style={{ color: FOREST, border: `1px solid ${HAIR}` }} aria-label="More actions">
              More <ChevronDown size={14} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 mt-1 z-50 w-44 rounded-xl shadow-xl py-1" style={{ backgroundColor: 'white', border: `1px solid ${HAIR}` }}>
                  {[
                    ['Save', () => saveNow(), FERN],
                    ['Print', () => printRecord(), FOREST],
                    [pdfBusy ? 'Exporting…' : 'Export PDF', () => exportPdf(), FOREST],
                    ...(manage && onSprayAgain ? [['Spray again', () => onSprayAgain(), FOREST]] : []),
                    ...(manage && onDelete ? [['Delete', () => setConfirmDel(true), '#DC2626']] : []),
                  ].map(([label, fn, color]) => (
                    <button key={label} onClick={() => { setMenuOpen(false); fn() }} className="w-full text-left font-body text-sm px-4 py-2 hover:bg-slate-50" style={{ color }}>{label}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {confirmDel && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(26,26,22,0.45)' }} onClick={() => setConfirmDel(false)}>
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={18} className="text-red-500" />
              <p className="font-display text-base font-bold text-slate-900">Delete this spray sheet?</p>
            </div>
            <p className="font-body text-sm text-slate-500 mb-4"><b>{sheet.area}</b> · {fmtDate(sheet.date)}. You'll get a few seconds to undo.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDel(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold font-body text-slate-500 border border-slate-200">Cancel</button>
              <button onClick={() => { setConfirmDel(false); onDelete() }} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body text-white" style={{ backgroundColor: '#DC2626' }}>Delete</button>
            </div>
          </div>
        </div>
      )}


      <div className="no-print">
        <h2 className="font-display text-2xl font-semibold text-slate-900 mb-1">{sheet.area}</h2>
        <p className="font-body text-sm text-slate-400 mb-5">{fmtDate(sheet.date)}</p>

        {/* Single full-width stack for both the crew iPad and the director's
            approval view: the specs box up top, the products (the working part
            of the sheet) spanning the whole screen, then the reference/sign-off
            cards — Before You Spray, Target, PPE, approval/log — flowing below. */}
        <div className="space-y-4">
          {/* The wide working area: specs, weather, products */}
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
                {!manage && (
                  <span className="font-body text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-1" style={{ backgroundColor: '#E8F3EC', color: FERN }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: FERN }} /> LIVE
                  </span>
                )}
              </div>
              <div className="flex gap-3 pr-1">
                <span className={`${manage ? 'w-16' : 'w-28'} text-center font-body text-[10px] font-bold text-slate-400 uppercase tracking-wide`}>Amt/Tank</span>
                <span className={`${manage ? 'w-16' : 'w-20'} text-center font-body text-[10px] font-bold text-slate-400 uppercase tracking-wide`}>Total</span>
              </div>
            </div>

            {tankCount > 1 && canFill && (
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
              {sortByMixOrder(sheet.products.filter((p) => p.product), (p) => products?.find((pr) => pr.name === p.product), courseInfo?.mixOrder).map((p) => {
                const { value: amt, unit } = calcAmount(parseFloat(p.rate), p.basis, area.sqft, p.forceGal)
                const total = amt !== null ? Math.round(amt * sheet.tanks * 10) / 10 : null
                const prodInfo = products?.find((pr) => pr.name === p.product)
                const labelMax = p.basis?.includes('/ M') ? prodInfo?.labelMaxM : prodInfo?.labelMaxA
                const labelMin = p.basis?.includes('/ M') ? prodInfo?.labelMinM : prodInfo?.labelMinA
                const rateNum = parseFloat(p.rate)
                const overLimit = labelMax && rateNum && rateNum > labelMax
                // Only flag going OVER the label rate — under-rate is intentional often.
                const outOfRange = overLimit
                const stock = prodInfo?.stock ?? null
                const insufficient = stock !== null && total !== null && stock < total
                const checked = curChecks.includes(p.id)
                const measure = !manage && measureOut(amt, unit, productJug(prodInfo))
                return (
                  <div key={p.id} className="py-2.5 flex items-center gap-2.5 font-body">
                    {canFill && (
                      <button onClick={() => toggleCheck(p.id)} className="shrink-0" aria-label="Confirm in tank">
                        <span className="w-6 h-6 rounded-md border flex items-center justify-center transition" style={checked ? { backgroundColor: FERN, borderColor: FERN } : { borderColor: '#CBD5E1', backgroundColor: 'white' }}>
                          {checked && <Check size={14} className="text-white" />}
                        </span>
                      </button>
                    )}
                    <div className="min-w-0 flex-1" style={{ opacity: checked ? 0.55 : 1 }}>
                      <p className={`${manage ? 'text-sm font-semibold' : 'text-lg font-bold'} text-slate-800 flex items-center gap-1.5 flex-wrap`}>
                        {p.product}
                        {overLimit && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">OVER</span>}
                      </p>
                      <p className={`${manage ? 'text-[11px]' : 'text-xs'} text-slate-400`}>
                        {p.rate} {p.basis}{insufficient ? ` · only ${stock} ${unit} in stock` : ''}
                      </p>
                      {p.target && String(p.target).trim() && (
                        <p className="text-[11px] mt-0.5 flex items-start gap-1" style={{ color: FERN }}>
                          <Target size={11} className="shrink-0 mt-0.5" />
                          <span><span className="font-bold">Spraying for:</span> {p.target}</span>
                        </p>
                      )}
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
                    <div className={`${manage ? 'w-16' : 'w-28'} shrink-0 flex flex-col items-center`}>
                      <div className={`w-full ${manage ? 'py-1.5' : 'py-2.5'} text-center rounded-lg`} style={{ backgroundColor: '#FFF6DD' }}>
                        <p className={`${manage ? 'text-sm' : 'text-2xl'} font-bold text-slate-900 leading-none`}>{amt ?? '—'}</p>
                        <p className={`${manage ? 'text-[8px]' : 'text-[10px]'} text-slate-500 uppercase mt-0.5 font-semibold`}>{unit}</p>
                      </div>
                      {measure && (
                        <p className="text-xs mt-1 font-bold text-center leading-tight" style={{ color: '#2563EB' }}>
                          = {measure}
                        </p>
                      )}
                    </div>
                    <div className={`${manage ? 'w-16' : 'w-20'} text-center`}>
                      <p className={`${manage ? 'text-sm' : 'text-lg'} font-bold leading-none`} style={{ color: outOfRange ? '#DC2626' : FERN }}>{total ?? '—'}</p>
                      <p className={`${manage ? 'text-[8px]' : 'text-[10px]'} text-slate-400 uppercase mt-0.5 font-semibold`}>{unit}</p>
                    </div>
                  </div>
                )
              })}
              {sheet.products.filter((p) => p.product).length === 0 && (
                <p className="py-3 font-body text-sm text-slate-400">No products on this sheet.</p>
              )}
            </div>
          </Card>

          {/* Mix & fill — the tank-fill order (by formulation), the amount +
              measure per tank, each product's share of the tank, the total
              solution, and a stock check for the whole job. */}
          {(() => {
            const plan = mixPlan(sheet, area, products, courseInfo?.mixOrder)
            if (!plan.hasProducts) return null
            return (
              <Card>
                <div className="flex items-center justify-between mb-1">
                  <FieldLabel noMargin>Mix &amp; Fill Order</FieldLabel>
                  <span className="font-body text-[11px] text-slate-400">{plan.totalSolutionGal} gal solution · {plan.tanks} tank{plan.tanks > 1 ? 's' : ''}</span>
                </div>
                <p className="font-body text-[11px] text-slate-400 mb-2.5">Fill the tank about half with water, add each product in this order agitating between each, then top off.</p>
                {plan.stockIssues.length > 0 && (
                  <div className="rounded-lg px-3 py-2 mb-2.5 font-body text-[11px] flex items-start gap-1.5" style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}>
                    <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                    <span><b>Short on stock:</b> {plan.stockIssues.map((l) => `${l.name} (need ${l.need}, have ${l.stock})`).join('; ')}. Order or reduce the job before spraying.</span>
                  </div>
                )}
                <ol className="space-y-1.5">
                  {plan.steps.map((st, i) => (
                    <li key={st.id} className="flex items-center gap-2.5 font-body">
                      <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[12px] font-bold text-white" style={{ backgroundColor: st.short ? '#DC2626' : FERN }}>{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-slate-800 leading-tight">
                          {st.name}
                          <span className="text-[10px] font-bold uppercase tracking-wide ml-1.5 px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#EEF2EF', color: FERN }}>{st.formLabel}</span>
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {st.total ?? '—'} {st.unit} total{st.pctOfTank != null ? ` · ~${st.pctOfTank}% of tank` : ''}
                          {st.measure ? <span style={{ color: '#2563EB' }}> · {st.measure}/tank</span> : ''}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
                {plan.totalLiquidPct != null && plan.totalLiquidPct > 0 && (
                  <p className="font-body text-[11px] text-slate-400 mt-2.5">Products make up about <b>{plan.totalLiquidPct}%</b> of each tank; the rest is water.{plan.totalLiquidPct > 12 ? ' That’s a heavy load — double-check compatibility and cut the water to fit.' : ''}</p>
                )}
              </Card>
            )
          })()}

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
          </div>

          {/* Right — reference & sign-off cards, stacked beside the products */}
          <div className="space-y-4">
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

          {/* Approval — only shown when there's actually something to do or show
              (the status is already on the pill up top, so no step-timeline). */}
          {(sheet.status === 'pending' || (sheet.status === 'approved' && sheet.directorSignature)) && (
            <Card>
              {sheet.status === 'pending' && approve && (
                <div className="space-y-2">
                  <FieldLabel noMargin>Approve this sheet</FieldLabel>
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
                    <Check size={15} /> Approve
                  </button>
                </div>
              )}
              {sheet.status === 'approved' && sheet.directorSignature && (
                <div>
                  <p className="font-body text-[11px] text-slate-400 mb-1">Director signature — {sheet.directorSig}</p>
                  <img src={sheet.directorSignature} alt="Director signature" className="h-12 rounded border border-slate-100 bg-white" />
                </div>
              )}
              {sheet.status === 'pending' && !approve && (
                <p className="font-body text-xs text-slate-400">
                  Only the Director of Grounds can approve. This sheet is waiting for sign-off.
                </p>
              )}
            </Card>
          )}

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
                  {!sheetApplied(sheet) && (
                    <div className="mt-2 rounded-lg px-3 py-2 font-body text-[11px] flex items-start gap-1.5" style={{ backgroundColor: '#FFF7E6', border: '1px solid #F0E4C8', color: '#8A5A12' }}>
                      <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                      <span><b>Not counted in the trackers.</b> This spray is missing its sign-off details (all tanks ticked + applicator signature), so it isn’t feeding growth-reg, disease or nutrition. Re-open it to finish.</span>
                    </div>
                  )}
                  <div className="flex gap-2 mt-3">
                    <button onClick={printRecord} className="font-body text-xs font-bold px-3.5 py-2 rounded-full text-white" style={{ backgroundColor: FOREST }}>Print record</button>
                    <button onClick={exportPdf} disabled={pdfBusy} className="font-body text-xs font-bold px-3.5 py-2 rounded-full disabled:opacity-50" style={{ color: FOREST, border: `1px solid ${FOREST}` }}>{pdfBusy ? 'Exporting…' : 'Export PDF'}</button>
                    <button onClick={reopen} className="font-body text-xs font-semibold px-3.5 py-2 rounded-full text-slate-500 border border-slate-200">Reopen (back to To Spray)</button>
                  </div>
                </div>
              ) : (canFill && productIds.length > 0 && !allTanksDone) ? (
                // Still spraying — keep the sign-off (weather + signature) tucked
                // away until the last tank is ticked off, then it appears below.
                // (A sheet with no products has nothing to tick, so we skip
                //  straight to the sign-off rather than getting stuck here.)
                <div className="text-center py-2">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-2" style={{ backgroundColor: '#F0F6F2' }}>
                    <Droplet size={18} style={{ color: FERN }} />
                  </div>
                  <p className="font-body text-sm font-bold" style={{ color: FOREST }}>
                    Spraying in progress — {completedCount} of {tankCount} tank{tankCount > 1 ? 's' : ''} done
                  </p>
                  <p className="font-body text-xs text-slate-500 mt-1">
                    Tick off every product in each tank as you go. When the last tank is checked, the sign-off (weather &amp; signature) shows up here to finish the spray.
                  </p>
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

                  {(() => {
                    // A spray can't be signed off (and won't feed the growth-reg /
                    // disease / nutrition trackers) until every product is checked
                    // into every tank, the weather's filled in, and it's signed.
                    const weatherOk = !!(String(wx.temp).trim() && String(wx.humidity).trim() && String(wx.wind).trim())
                    const missing = []
                    if (!allTanksDone) missing.push(`tick every product into all ${tankCount} tank${tankCount > 1 ? 's' : ''}`)
                    if (!weatherOk) missing.push('fill in the weather (temp, wind, humidity)')
                    if (!sprayedBy) missing.push('choose who sprayed it')
                    if (!applicatorSig) missing.push('add the applicator signature')
                    const canSubmit = missing.length === 0
                    return (
                      <>
                        <div className="flex gap-2 mt-3">
                          <button onClick={() => saveLog(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold font-body text-slate-600 border border-slate-200">Save progress</button>
                          <button onClick={() => canSubmit && saveLog(true)} disabled={!canSubmit} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body text-white flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed" style={{ backgroundColor: FOREST }}>
                            <Check size={15} /> Mark as sprayed
                          </button>
                        </div>
                        {!canSubmit && (
                          <div className="mt-2 rounded-lg px-3 py-2 font-body text-[11px] flex items-start gap-1.5" style={{ backgroundColor: '#FFF7E6', border: '1px solid #F0E4C8', color: '#8A5A12' }}>
                            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                            <span><b>Not counted yet.</b> Before this can be signed off and start counting toward growth-reg, disease &amp; nutrition, you still need to: {missing.join('; ')}.</span>
                          </div>
                        )}
                        <p className="font-body text-[11px] text-slate-400 mt-2">“Save progress” keeps your spot for multi-day sprays; “Mark as sprayed” files it in Records and starts it counting in the trackers.</p>
                      </>
                    )
                  })()}
                </>
              )}
            </Card>
          )}
          </div>
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
          <input type="file" accept="image/*" multiple onChange={onPick} className="hidden" />
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
// Chemical hub — the products library, their Labels & SDS, and inventory all in
// one place, switched by a side menu (vertical rail on wide screens, a scrolling
// tab row on iPad/phone) so they're not three separate top-nav items.
const CHEM_SECTIONS = [
  { key: 'library', label: 'Chemical Library', icon: Droplet },
  { key: 'documents', label: 'Labels & SDS', icon: Info },
  { key: 'inventory', label: 'Inventory', icon: Package },
]
function ChemicalHub({ products, grassTypes, deliveries, manage, onSaveProduct, onDeleteProduct, onImport, onAddDelivery }) {
  const [section, setSection] = useState('library')
  return (
    <div className="md:flex md:gap-6">
      <div className="md:hidden flex gap-2 pt-6 overflow-x-auto pb-1">
        {CHEM_SECTIONS.map((s) => (
          <button key={s.key} onClick={() => setSection(s.key)} className="font-body text-xs font-bold px-3.5 py-2 rounded-full whitespace-nowrap transition" style={section === s.key ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>{s.label}</button>
        ))}
      </div>
      <aside className="hidden md:block w-52 shrink-0 pt-6">
        <div className="bg-white rounded-2xl border border-black/5 p-2 shadow-sm sticky top-4">
          <nav className="space-y-1">
            {CHEM_SECTIONS.map((s) => {
              const on = s.key === section
              const Icon = s.icon
              return (
                <button key={s.key} onClick={() => setSection(s.key)} className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl font-body text-sm font-semibold transition text-left" style={on ? { backgroundColor: FOREST, color: 'white' } : { color: '#4B5563' }}>
                  <Icon size={16} style={{ color: on ? GOLD : '#94A3B8' }} /> {s.label}
                </button>
              )
            })}
          </nav>
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        {section === 'library' && <ChemicalLibrary products={products} grassTypes={grassTypes} onSaveProduct={onSaveProduct} onDeleteProduct={onDeleteProduct} onImport={onImport} />}
        {section === 'documents' && <DocumentsLibrary products={products} manage={manage} onSaveProduct={manage ? onSaveProduct : undefined} />}
        {section === 'inventory' && <Inventory products={products} deliveries={deliveries} onAddDelivery={onAddDelivery} />}
      </div>
    </div>
  )
}

function ChemicalLibrary({ products, grassTypes = [], onSaveProduct, onDeleteProduct, onImport }) {
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState(null)
  const [filter, setFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [importPreview, setImportPreview] = useState(null) // { products, columns, count, error, fileName }
  const [importing, setImporting] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiReview, setAiReview] = useState(null) // { items:[{product,fills,confidence,include}], error }
  const [aiApplying, setAiApplying] = useState(false)
  const [oneAiBusy, setOneAiBusy] = useState(false)
  const [oneAiMsg, setOneAiMsg] = useState(null) // { text, tone: 'ok'|'warn'|'err' }
  const fileRef = useRef(null)
  const editRef = useRef(null)

  // ── AI library fill ──────────────────────────────────────────────────────
  // Ask the AI for each product's label facts, then keep only values for fields
  // the user has left BLANK (never overwrite hand-entered data). EPA reg # and
  // rate ranges are tagged "verify" because those are the ones to eyeball.
  const AI_BLANK = (v) => v == null || v === ''
  const AI_NUM = (s) => { const n = parseFloat(s); return isNaN(n) ? null : n }
  const AI_LABELS = { activeIngredient: 'Active ingredient', activePct: 'Active %', manufacturer: 'Manufacturer', formulation: 'Formulation', signalWord: 'Signal word', rei: 'REI', moaGroup: 'Group', epaReg: 'EPA Reg #', labelMinM: 'Min oz/M', labelMaxM: 'Max oz/M', labelMinA: 'Min oz/A', labelMaxA: 'Max oz/A', sprayInterval: 'Interval (days)' }

  const runAiEnrich = async () => {
    setAiBusy(true); setAiReview(null)
    try {
      const r = await fetch('/api/enrich-products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ products: products.map((p) => ({ name: p.name, type: p.type })) }) })
      const d = await r.json().catch(() => null)
      if (!r.ok) { setAiReview({ error: d?.error || `Server error ${r.status}` }); setAiBusy(false); return }
      const byName = {}
      ;(d.results || []).forEach((res) => { byName[String(res.name || '').toLowerCase()] = res })
      const items = []
      products.forEach((p) => {
        const res = byName[String(p.name).toLowerCase()]
        if (!res || !res.found) return
        const fills = {}
        const strFields = ['activeIngredient', 'manufacturer', 'formulation', 'signalWord', 'rei', 'moaGroup']
        strFields.forEach((f) => { if (!AI_BLANK(res[f]) && AI_BLANK(p[f])) fills[f] = { value: res[f] } })
        if (!AI_BLANK(res.epaReg) && AI_BLANK(p.epaReg)) fills.epaReg = { value: res.epaReg, verify: true }
        if (AI_NUM(res.activePct) != null && AI_BLANK(p.activePct)) fills.activePct = { value: AI_NUM(res.activePct) }
        ;['labelMinM', 'labelMaxM', 'labelMinA', 'labelMaxA', 'sprayInterval'].forEach((f) => { if (AI_NUM(res[f]) != null && AI_BLANK(p[f])) fills[f] = { value: AI_NUM(res[f]), verify: f.startsWith('label') } })
        if (Object.keys(fills).length) items.push({ product: p, fills, confidence: res.confidence || 'medium', include: true })
      })
      setAiReview({ items })
    } catch (e) { setAiReview({ error: String(e?.message || e) }) }
    setAiBusy(false)
  }
  // Autofill just the product being edited — fills only the blank fields in the
  // current form, leaving everything you've typed untouched.
  const autofillOne = async () => {
    if (!draft?.name?.trim()) { setOneAiMsg({ text: 'Enter a product name first.', tone: 'warn' }); return }
    setOneAiBusy(true); setOneAiMsg(null)
    try {
      const r = await fetch('/api/enrich-products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ products: [{ name: draft.name, type: draft.type }] }) })
      const d = await r.json().catch(() => null)
      if (!r.ok) { setOneAiMsg({ text: d?.error || `Server error ${r.status}`, tone: 'err' }); setOneAiBusy(false); return }
      const res = (d.results || [])[0]
      if (!res || !res.found) { setOneAiMsg({ text: 'The AI wasn’t confident about this product — fill it by hand.', tone: 'warn' }); setOneAiBusy(false); return }
      const fills = {}
      ;['activeIngredient', 'manufacturer', 'formulation', 'signalWord', 'rei', 'moaGroup', 'epaReg'].forEach((f) => { if (!AI_BLANK(res[f]) && AI_BLANK(draft[f])) fills[f] = res[f] })
      if (AI_NUM(res.activePct) != null && AI_BLANK(draft.activePct)) fills.activePct = AI_NUM(res.activePct)
      ;['labelMinM', 'labelMaxM', 'labelMinA', 'labelMaxA', 'sprayInterval'].forEach((f) => { if (AI_NUM(res[f]) != null && AI_BLANK(draft[f])) fills[f] = AI_NUM(res[f]) })
      const n = Object.keys(fills).length
      if (n === 0) { setOneAiMsg({ text: 'Nothing to add — the blanks here are already filled in.', tone: 'ok' }); setOneAiBusy(false); return }
      setDraft((d0) => ({ ...d0, ...fills }))
      setOneAiMsg({ text: `Filled ${n} blank field${n !== 1 ? 's' : ''}. Double-check EPA Reg # and rates against the label.`, tone: 'ok' })
    } catch (e) { setOneAiMsg({ text: String(e?.message || e), tone: 'err' }) }
    setOneAiBusy(false)
  }

  const applyAiReview = async () => {
    if (!aiReview?.items) return
    setAiApplying(true)
    try {
      for (const it of aiReview.items) {
        if (!it.include) continue
        const patch = {}
        Object.entries(it.fills).forEach(([f, { value }]) => { patch[f] = value })
        await onSaveProduct({ ...it.product, ...patch })
      }
    } catch (e) { console.error(e) }
    setAiApplying(false); setAiReview(null)
  }

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
    const headers = [
      'Name', 'Type', 'Mixing Order', 'Active Ingredient', 'Active %', 'Manufacturer',
      'Chemical Group', 'Rotate After (days)', 'Spray Interval (days)', 'EIQ', 'Signal Word', 'REI (hrs)',
      'Rate', 'Basis', 'Unit', 'Label Min /M', 'Label Max /M', 'Label Min /A', 'Label Max /A',
      'Stock', 'Low Stock', 'Fert Form', 'N', 'P', 'K', 'N lbs/gal', 'P lbs/gal', 'K lbs/gal',
      'Case Size', 'Oz/Case', 'Cost/Case', 'Label link', 'SDS link', 'Avoid Grasses',
    ]
    const example = [
      'Daconil Action', 'Fungicide', 'Flowable (SC)', 'Chlorothalonil + Acibenzolar-S-methyl', 20.3, 'Syngenta',
      'M05', 14, 14, 33.4, 'Warning', 12,
      1.8, 'oz / M', 'oz', 1.8, 3.6, '', '',
      0, 0, '', '', '', '', '', '', '',
      '2.5 Gal', 320, 240, 'https://example.com/label.pdf', 'https://example.com/sds.pdf', 'Bentgrass, Poa Annua',
    ]
    // A second example — a dry-formulated fertilizer — shows the Mixing Order and
    // fertilizer columns in use.
    const example2 = [
      'Primo Maxx', 'Growth Reg', 'Emulsifiable (EC)', 'Trinexapac-ethyl', 11.3, 'Syngenta',
      'PGR', '', 21, '', 'Caution', 12,
      0.25, 'oz / M', 'oz', 0.125, 0.75, '', '',
      0, 0, '', '', '', '', '', '', '',
      '1 Gal', 128, 420, '', '', '',
    ]
    const ws = XLSX.utils.aoa_to_sheet([headers, example, example2])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Chemical Library')
    XLSX.writeFile(wb, 'chemical-library-template.xlsx')
  }
  // Export the whole library to Excel — same columns as the template, so it
  // round-trips back through Import. Good for backups and sending an order list.
  const exportLibrary = async () => {
    const XLSX = await import('xlsx')
    const headers = [
      'Name', 'Type', 'Mixing Order', 'Active Ingredient', 'Active %', 'Manufacturer',
      'Chemical Group', 'Rotate After (days)', 'Spray Interval (days)', 'EIQ', 'Signal Word', 'REI (hrs)',
      'Rate', 'Basis', 'Unit', 'Label Min /M', 'Label Max /M', 'Label Min /A', 'Label Max /A',
      'Stock', 'Low Stock', 'Fert Form', 'N', 'P', 'K', 'N lbs/gal', 'P lbs/gal', 'K lbs/gal',
      'Case Size', 'Oz/Case', 'Cost/Case', 'Label link', 'SDS link', 'Avoid Grasses',
    ]
    const blank = (v) => (v == null ? '' : v)
    const rows = [...products]
      .sort((a, b) => String(a.type || '').localeCompare(String(b.type || '')) || String(a.name || '').localeCompare(String(b.name || '')))
      .map((p) => [
        p.name || '', p.type || '', FORMULATION_LABEL[effectiveFormulation(p)] || '', p.activeIngredient || '', blank(p.activePct), p.manufacturer || '',
        p.moaGroup || '', blank(p.rotationDays), blank(p.sprayInterval), blank(p.eiq), p.signalWord || '', blank(p.rei),
        blank(p.rate), p.basis || '', p.unit || '', blank(p.labelMinM), blank(p.labelMaxM), blank(p.labelMinA), blank(p.labelMaxA),
        blank(p.stock), blank(p.lowStockThreshold), p.fertForm || '', blank(p.n), blank(p.p), blank(p.k), blank(p.nPerGal), blank(p.pPerGal), blank(p.kPerGal),
        p.caseSize || '', blank(p.ozPerCase), blank(p.costPerCase), p.labelUrl || '', p.sdsUrl || '',
        Array.isArray(p.avoidGrasses) ? p.avoidGrasses.join(', ') : (p.avoidGrasses || ''),
      ])
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Chemical Library')
    XLSX.writeFile(wb, `chemical-library-${localDateISO()}.xlsx`)
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
    setOneAiMsg(null)
    setEditing(p.name)
    setDraft({ ...p })
  }
  const startNew = () => {
    setOneAiMsg(null)
    setEditing('new')
    setDraft({ name: '', type: 'Fungicide', rate: '', basis: 'oz / M', unit: 'oz', labelMaxM: '', labelMaxA: '', labelMinM: '', labelMinA: '', stock: '', lowStockThreshold: '', fertForm: 'granular', n: '', p: '', k: '', nPerGal: '', pPerGal: '', kPerGal: '', avoidGrasses: [], labelUrl: '', sdsUrl: '', activeIngredient: '', activePct: '', eiq: '', caseSize: '', ozPerCase: '', costPerCase: '', moaGroup: '', rotationDays: '', sprayInterval: '' })
  }
  const cancelEdit = () => { setOneAiMsg(null); setEditing(null); setDraft(null) }

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
      eiq: draft.eiq === '' || draft.eiq == null ? null : parseFloat(draft.eiq),
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
      <div className="flex items-start justify-between mb-1 gap-2 flex-wrap">
        <SectionHeader title="Chemical Library" subtitle="Manage products, rates, and label maximums" noMargin />
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button onClick={pickFile} className="font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5 border shrink-0" style={{ color: FOREST, borderColor: FOREST, backgroundColor: 'white' }}>
            <CloudUpload size={14} /> Import Excel
          </button>
          {products.length > 0 && (
            <button onClick={exportLibrary} className="font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5 border shrink-0" style={{ color: FOREST, borderColor: '#E2E8F0', backgroundColor: 'white' }}>
              <CloudUpload size={14} className="rotate-180" /> Export Excel
            </button>
          )}
          {products.length > 0 && (
            <button onClick={runAiEnrich} disabled={aiBusy} className="font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5 border shrink-0 disabled:opacity-50" style={{ color: '#6D4AC2', borderColor: '#D6C9F2', backgroundColor: '#F7F4FD' }}>
              {aiBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {aiBusy ? 'Reading…' : 'Auto-fill AI'}
            </button>
          )}
          <button onClick={startNew} className="font-body text-xs font-bold px-3.5 py-2 rounded-full text-white flex items-center gap-1.5 shrink-0" style={{ backgroundColor: FOREST }}>
            <Plus size={14} /> Add Product
          </button>
        </div>
      </div>

      {aiReview && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-3 sm:p-4" style={{ backgroundColor: 'rgba(26,26,22,0.5)' }} onClick={() => !aiApplying && setAiReview(null)}>
          <div className="bg-white rounded-2xl w-full sm:max-w-2xl shadow-2xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #EEF0EC' }}>
              <p className="font-display text-base font-bold flex items-center gap-1.5" style={{ color: FOREST }}><Sparkles size={16} style={{ color: '#6D4AC2' }} /> AI found details to fill</p>
              <button onClick={() => !aiApplying && setAiReview(null)} className="text-slate-400"><X size={18} /></button>
            </div>
            <div className="p-4 overflow-y-auto">
              {aiReview.error ? (
                <div className="rounded-xl px-4 py-3 font-body text-sm" style={{ backgroundColor: '#FEF2F2', color: '#B91C1C', border: '1px solid #FECACA' }}>
                  Couldn’t run the AI fill. <b>Reason:</b> {aiReview.error}
                  {/not set up|ANTHROPIC/i.test(aiReview.error) && <div className="mt-1 text-[12px]">This needs the AI key (ANTHROPIC_API_KEY) in Vercel — same steps as the other key. Say the word and I’ll walk you through it.</div>}
                </div>
              ) : aiReview.items.length === 0 ? (
                <p className="font-body text-sm text-slate-500">Nothing to add — your products already have these details filled in, or the AI wasn’t confident enough to suggest anything.</p>
              ) : (
                <>
                  <div className="rounded-lg px-3 py-2 mb-3 font-body text-[12px] flex items-start gap-1.5" style={{ backgroundColor: '#FBF2E4', border: '1px solid #F0DFC0', color: '#8A5A12' }}>
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <span>Only <b>blank fields</b> get filled — nothing you typed is touched. Values tagged <b style={{ color: '#B45309' }}>VERIFY</b> (EPA Reg # and rates) should be checked against the physical label before you rely on them.</span>
                  </div>
                  <div className="space-y-2.5">
                    {aiReview.items.map((it, idx) => (
                      <div key={it.product.name} className="rounded-xl border p-3" style={{ borderColor: it.include ? '#D6C9F2' : '#E2E8F0', backgroundColor: it.include ? '#FBFAFE' : 'white' }}>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={it.include} onChange={(e) => setAiReview((r) => ({ ...r, items: r.items.map((x, i) => i === idx ? { ...x, include: e.target.checked } : x) }))} className="w-4 h-4 rounded" style={{ accentColor: '#6D4AC2' }} />
                          <span className="font-body text-sm font-bold text-slate-800">{it.product.name}</span>
                          <span className="font-body text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full" style={{ backgroundColor: it.confidence === 'high' ? '#E8F3EC' : it.confidence === 'low' ? '#FEF2F2' : '#FEF3DD', color: it.confidence === 'high' ? FERN : it.confidence === 'low' ? '#B91C1C' : '#92660D' }}>{it.confidence}</span>
                        </label>
                        <div className="flex flex-wrap gap-1.5 mt-2 pl-6">
                          {Object.entries(it.fills).map(([f, { value, verify }]) => (
                            <span key={f} className="font-body text-[11px] px-2 py-1 rounded-lg" style={{ backgroundColor: '#F1F5F3', color: '#334155' }}>
                              <span className="text-slate-400">{AI_LABELS[f] || f}:</span> <b>{String(value)}</b>
                              {verify && <b className="ml-1 text-[9px] uppercase" style={{ color: '#B45309' }}>verify</b>}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            {!aiReview.error && aiReview.items.length > 0 && (
              <div className="px-4 py-3 flex items-center justify-between gap-2" style={{ borderTop: '1px solid #EEF0EC' }}>
                <span className="font-body text-[12px] text-slate-500">{aiReview.items.filter((i) => i.include).length} of {aiReview.items.length} products selected</span>
                <div className="flex gap-2">
                  <button onClick={() => setAiReview(null)} disabled={aiApplying} className="font-body text-xs font-bold px-3.5 py-2 rounded-full text-slate-500 border border-slate-200">Cancel</button>
                  <button onClick={applyAiReview} disabled={aiApplying || !aiReview.items.some((i) => i.include)} className="font-body text-xs font-bold px-3.5 py-2 rounded-full text-white flex items-center gap-1.5 disabled:opacity-40" style={{ backgroundColor: FOREST }}>{aiApplying ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Fill selected</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={onFile} className="hidden" />
      <p className="font-body text-[11px] text-slate-400 mt-1.5">
        First time importing? <button onClick={downloadTemplate} className="font-bold underline" style={{ color: FERN }}>Download a blank template</button> with the right columns, fill it in, then import it. The <span className="font-semibold">Mixing Order</span> column sets the tank fill order — enter a formulation like Dry, Flowable, EC, or Adjuvant (or leave it blank and we'll guess).
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

      <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar [&>*]:shrink-0 pb-1">
        {['All', ...PRODUCT_TYPES].map((t) => (
          <button key={t} onClick={() => setFilter(t)} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition" style={filter === t ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>
            {t}
          </button>
        ))}
      </div>

      {editing && draft && (
        <div ref={editRef} className="bg-white rounded-2xl border-2 p-4 mb-4 shadow-sm scroll-mt-4" style={{ borderColor: GOLD }}>
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <p className="font-display text-base font-semibold text-slate-900">{editing === 'new' ? 'Add New Chemical' : `Edit ${editing}`}</p>
            <button onClick={autofillOne} disabled={oneAiBusy} className="font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5 border disabled:opacity-50 shrink-0" style={{ color: '#6D4AC2', borderColor: '#D6C9F2', backgroundColor: '#F7F4FD' }}>
              {oneAiBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {oneAiBusy ? 'Reading…' : 'Autofill this product'}
            </button>
          </div>
          {oneAiMsg && (
            <div className="rounded-lg px-3 py-2 mb-3 font-body text-[12px] flex items-start gap-1.5" style={oneAiMsg.tone === 'err' ? { backgroundColor: '#FEF2F2', color: '#B91C1C', border: '1px solid #FECACA' } : oneAiMsg.tone === 'warn' ? { backgroundColor: '#FBF2E4', color: '#8A5A12', border: '1px solid #F0DFC0' } : { backgroundColor: '#F0F6F2', color: FERN, border: '1px solid #CFE3D6' }}>
              <span>{oneAiMsg.text}{/not set up|ANTHROPIC/i.test(oneAiMsg.text) ? ' — say the word and I’ll walk you through adding the AI key.' : ''}</span>
            </div>
          )}
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
            <div>
              <FieldLabel>Tank-mix formulation</FieldLabel>
              <SearchSelect value={draft.formulation || guessFormulation(draft)} options={FORMULATIONS.map((f) => ({ value: f.id, label: f.label }))} onPick={(v) => setDraft({ ...draft, formulation: v })} sort={false} />
              <p className="font-body text-[10px] text-slate-400 mt-1">Sets the tank fill order on spray sheets (dry first, adjuvants last).{!draft.formulation ? ' Auto-guessed — pick one to lock it in.' : ''}</p>
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
            {/* Container / jug size — drives the "measure out" note on spray sheets. */}
            <div className="rounded-xl p-3" style={{ backgroundColor: '#F1F5F3' }}>
              <FieldLabel noMargin>Container / jug size (optional)</FieldLabel>
              <div className="grid grid-cols-2 gap-3 mt-1.5">
                <input type="number" step="any" value={draft.jugSize ?? ''} onChange={(e) => setDraft({ ...draft, jugSize: e.target.value })} placeholder="e.g. 2.5" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" />
                <SearchSelect value={draft.jugUnit || 'gal'} options={['gal', 'oz', 'qt', 'L']} onPick={(v) => setDraft({ ...draft, jugUnit: v })} sort={false} />
              </div>
              <p className="font-body text-[10px] text-slate-400 mt-2">The biggest jug this product comes in. The spray sheet uses it to say how to measure the amount out — e.g. <b>“2 × 2.5 gal + 2 gal.”</b> Leave blank and it just breaks the amount into gallons + ounces (1-gal jug).</p>
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
                <div>
                  <FieldLabel>EIQ value (environmental impact)</FieldLabel>
                  <input type="number" step="any" value={draft.eiq ?? ''} onChange={(e) => setDraft({ ...draft, eiq: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="Cornell EIQ for the active ingredient" />
                  <p className="font-body text-[10px] text-slate-500 mt-1">Look up the active ingredient's EIQ at <span className="font-semibold">eiq.cornell-ipm.org</span>. With this + Active %, the Reports → Impact view scores your program's environmental load. Lower is better.</p>
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
                <div className="mt-3">
                  <FieldLabel>EPA Registration #</FieldLabel>
                  <input value={draft.epaReg ?? ''} onChange={(e) => setDraft({ ...draft, epaReg: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body bg-white" placeholder="e.g. 100-1234 (from the label — shows on the spray record)" />
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
              {(() => {
                // Live: the moment a product reads as a PGR or DMI (its type, its
                // active ingredient, or FRAC 3), tell the user it'll feed the
                // Growth-Reg model — so they know new products are recognized.
                const k = suppressionKind(draft)
                if (!k) return null
                const m = modelForProduct(draft, k)
                return (
                  <div className="mt-2 rounded-lg px-2.5 py-2" style={{ backgroundColor: k === 'dmi' ? '#F1ECFA' : '#E8F3EC' }}>
                    <p className="font-body text-[11px] font-bold" style={{ color: k === 'dmi' ? '#6D4AC2' : FERN }}>
                      ✓ {k === 'dmi' ? 'Recognized as a DMI (FRAC 3) — also regulates growth' : 'Recognized as a growth regulator (PGR)'}
                    </p>
                    <p className="font-body text-[10px] text-slate-500 mt-0.5">
                      Feeds the Growth-Reg model automatically{m ? ` — ${m.label.split(' (')[0]} curve (~${m.gdd.green} GDD on greens; tune it in Turf → Growing Degree Days)` : ''}.
                    </p>
                  </div>
                )
              })()}
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

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2 items-start">
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
  const [draft, setDraft] = useState({ product: '', qty: '', unit: 'oz', supplier: '', date: localDateISO() })
  const [filter, setFilter] = useState('All')

  const lowStock = products.filter((p) => p.lowStockThreshold > 0 && (p.stock || 0) <= p.lowStockThreshold)
  const filtered = filter === 'All' ? products : products.filter((p) => p.type === filter)

  const submitDelivery = () => {
    if (!draft.product || !draft.qty) return
    onAddDelivery(draft)
    setDraft({ product: '', qty: '', unit: 'oz', supplier: '', date: localDateISO() })
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
              <SearchSelect value={draft.product} options={products.map((p) => p.name)} onPick={handleProductPick} placeholder="Search products…" />
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
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2 mb-6 items-start">
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
function Reports({ sheets, products, areas, courseInfo = {}, fertSheets = [], onSaveSettings }) {
  const [view, setView] = useState('byArea')
  const [report, setReport] = useState('npk') // 'npk' | 'rotation'
  const npkData = aggregateNPK(sheets, products, areas)

  // Season Report: years that actually have sprays, newest first (default to this
  // year if it has any, else the most recent year with data).
  const years = [...new Set((sheets || []).map((s) => String(s.date || '').slice(0, 4)).filter((y) => y.length === 4))].sort().reverse()
  const thisYear = String(new Date().getFullYear())
  const [reportYear, setReportYear] = useState(years.includes(thisYear) ? thisYear : (years[0] || thisYear))
  const [pdfBusy, setPdfBusy] = useState(false)
  const makeSeasonReport = async () => {
    setPdfBusy(true)
    try {
      const safeClub = (courseInfo.clubName || 'Club').replace(/[^a-z0-9]+/gi, '-')
      await pdfRecordHTML(seasonReportHTML(sheets, products, areas, courseInfo, reportYear), `Season-Report_${safeClub}_${reportYear}.pdf`)
    } catch (e) { console.error(e) }
    setPdfBusy(false)
  }

  const totalN = Math.round(npkData.reduce((s, r) => s + r.n, 0) * 100) / 100
  const totalP = Math.round(npkData.reduce((s, r) => s + r.p, 0) * 100) / 100
  const totalK = Math.round(npkData.reduce((s, r) => s + r.k, 0) * 100) / 100

  const diag = npkDiagnostics(sheets, products, areas)
  const diagItems = [
    diag.missingAnalysis.length && { title: 'Missing N-P-K analysis', fix: 'Open Chemical Library → edit each product → fill in the N %, P %, K % from the bag (e.g. 21-0-0 = N 21). Until then it counts as zero.', items: diag.missingAnalysis },
    diag.notCountedSheets.length && { title: 'Sheets not counted yet', fix: 'Reports only count sprays that have actually gone out — the sheet must be submitted, the applicator signed, and every product checked into the tank. Finish those steps for their fertilizer to show.', items: diag.notCountedSheets },
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
    downloadCSV(rows, `NPK_Totals_${localDateISO()}.csv`)
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
        {[['npk', 'Nutrients'], ['nitrogen', 'Nitrogen vs Target'], ['reorder', 'Reorder'], ['cost', 'Cost'], ['impact', 'Impact (EIQ)'], ['rotation', 'Rotation'], ['usage', 'Product Usage'], ['history', 'Spray History'], ['since', 'Days Since']].map(([k, l]) => (
          <button key={k} onClick={() => setReport(k)} className="font-body text-xs font-bold px-3.5 py-2 rounded-full whitespace-nowrap transition" style={report === k ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>
            {l}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border p-3.5 mt-4 mb-1 flex items-center justify-between gap-3 flex-wrap" style={{ backgroundColor: '#F5FAF6', borderColor: '#D8E6DC' }}>
        <div className="min-w-0">
          <p className="font-body text-sm font-bold text-slate-800">Season Report</p>
          <p className="font-body text-[11px] text-slate-500">One PDF for the board — spend, environmental impact, rotation, nutrients &amp; the full spray log.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {years.length > 0 && (
            <div className="shrink-0" style={{ width: 110 }}>
              <SearchSelect value={reportYear} options={years} onPick={setReportYear} sort={false} placeholder="Year…" />
            </div>
          )}
          <button onClick={makeSeasonReport} disabled={pdfBusy} className="font-body text-xs font-bold px-3.5 py-2 rounded-full text-white flex items-center gap-1.5 disabled:opacity-50" style={{ backgroundColor: FOREST }}>
            <Package size={14} /> {pdfBusy ? 'Building…' : 'Season PDF'}
          </button>
        </div>
      </div>

      {report === 'nitrogen' && <NitrogenReport sheets={sheets} products={products} areas={areas} fertSheets={fertSheets} />}
      {report === 'reorder' && <ReorderReport sheets={sheets} products={products} areas={areas} />}
      {report === 'cost' && <CostReport sheets={sheets} products={products} areas={areas} courseInfo={courseInfo} onSaveSettings={onSaveSettings} />}
      {report === 'impact' && <ImpactReport sheets={sheets} products={products} areas={areas} />}
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

// ── NITROGEN vs TARGET ──────────────────────────────────────────────────────
// Per area, the nitrogen applied so far this season (lbs N / 1,000 sq ft) against
// a season target derived from that area's grasses (suggestedAnnualN). A spoon-
// feeding gauge: how much of the year's nitrogen budget you've put down, and how
// much is left.
function NitrogenReport({ sheets, products, areas, fertSheets = [] }) {
  const npkData = aggregateNPK(sheets, products, areas)
  // Spray-derived N per 1,000 sq ft, per area.
  const sprayByArea = {}
  npkData.forEach((r) => {
    if (!sprayByArea[r.area]) sprayByArea[r.area] = { n: 0, sqft: r.sqft }
    sprayByArea[r.area].n += r.n
  })
  const sprayM = {}
  Object.entries(sprayByArea).forEach(([area, a]) => { sprayM[area] = a.sqft > 0 ? a.n / (a.sqft / 1000) : null })
  // Granular fert N per 1,000 sq ft, per area (applied uniformly, so its lb N/M
  // is rate × N% — add it straight onto the spray total). Counts completed sheets.
  const fertM = {}
  ;(fertSheets || []).filter((f) => f.status === 'complete').forEach((f) => { const c = computeFert(f); fertM[f.area] = (fertM[f.area] || 0) + c.nPerM })
  const allAreas = [...new Set([...Object.keys(sprayM), ...Object.keys(fertM)])]

  const rows = allAreas.map((area) => {
    const sp = sprayM[area]; const fe = fertM[area] || 0
    const perM = (sp != null || fe) ? Math.round(((sp || 0) + fe) * 100) / 100 : null
    const grasses = (areas[area]?.grasses) || []
    const target = suggestedAnnualN(grasses).n || null
    const pct = perM != null && target ? Math.round((perM / target) * 100) : null
    return { area, appliedM: perM, fertM: Math.round(fe * 100) / 100, target, pct, remaining: perM != null && target ? Math.round((target - perM) * 100) / 100 : null }
  }).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))

  const exportCSV = () => {
    const out = [['Area', 'N applied (lb/M)', 'of which granular fert (lb/M)', 'Season target (lb/M)', '% of target', 'Remaining (lb/M)']]
    rows.forEach((r) => out.push([r.area, r.appliedM ?? '', r.fertM ?? '', r.target ?? '', r.pct ?? '', r.remaining ?? '']))
    downloadCSV(out, `Nitrogen_vs_Target_${localDateISO()}.csv`)
  }

  const barColor = (pct) => (pct == null ? '#CBD5E1' : pct > 110 ? '#DC2626' : pct >= 85 ? '#16A34A' : pct >= 50 ? '#CA8A04' : '#3A6B4A')

  return (
    <div className="mt-3">
      <div className="flex justify-end mb-2">
        <button onClick={exportCSV} className="font-body text-[11px] font-bold px-3 py-2 rounded-full border" style={{ color: FOREST, borderColor: '#E2E8F0' }}>Export CSV</button>
      </div>
      {rows.length === 0 ? (
        <Card><p className="font-body text-sm text-slate-400 text-center py-6">No fertilizer sprays counted yet.</p></Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-2 items-start">
          {rows.map((r) => (
            <div key={r.area} className="bg-white rounded-2xl border border-black/5 p-3 shadow-sm">
              <div className="flex items-center justify-between mb-1.5">
                <p className="font-body text-sm font-bold text-slate-900">{r.area}</p>
                <p className="font-body text-xs text-slate-500">
                  {r.appliedM != null ? <><b style={{ color: FOREST }}>{r.appliedM}</b> of {r.target ? `${r.target}` : '—'} lb N/M{r.pct != null ? ` · ${r.pct}%` : ''}{r.fertM > 0 ? <span className="text-slate-400"> (incl. {r.fertM} granular)</span> : ''}</> : 'No area size / grass set'}
                </p>
              </div>
              <div className="h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: '#EEF2F0' }}>
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, r.pct || 0)}%`, backgroundColor: barColor(r.pct) }} />
              </div>
              {r.remaining != null && (
                <p className="font-body text-[11px] mt-1" style={{ color: r.remaining < 0 ? '#DC2626' : '#64748B' }}>
                  {r.remaining < 0 ? `${Math.abs(r.remaining)} lb N/M over target` : `${r.remaining} lb N/M left this season`}
                </p>
              )}
            </div>
          ))}
          <p className="font-body text-[11px] text-slate-400 mt-1">Targets come from each area's grasses (Settings → Areas). Set area size and grasses to get a target.</p>
        </div>
      )}
    </div>
  )
}

// ── REORDER LIST ────────────────────────────────────────────────────────────
// Products at or below their low-stock level, with how much you've used this
// season and a suggested order quantity (par = twice the low-stock level).
function ReorderReport({ sheets, products, areas }) {
  const [showAll, setShowAll] = useState(false)
  const usage = productUsage(sheets, products, areas)
  const usedByName = {}
  usage.forEach((u) => { usedByName[u.name] = u })

  const rows = products
    .map((p) => {
      const stock = Number(p.stock) || 0
      const low = Number(p.lowStockThreshold) || 0
      const par = low > 0 ? low * 2 : 0
      const suggest = par > 0 ? Math.max(0, Math.round((par - stock) * 10) / 10) : 0
      const cases = (p.ozPerCase > 0 && suggest > 0) ? Math.ceil(suggest / p.ozPerCase) : null
      const u = usedByName[p.name]
      return { name: p.name, type: p.type, unit: p.unit || u?.unit || 'oz', stock, low, suggest, cases, used: u ? u.total : 0, usedUnit: u?.unit || p.unit || '', needs: low > 0 && stock <= low }
    })
    .filter((r) => r.low > 0)
    .sort((a, b) => (b.needs - a.needs) || (a.stock - a.low) - (b.stock - b.low) || a.name.localeCompare(b.name))

  const needing = rows.filter((r) => r.needs)
  const shown = showAll ? rows : needing

  const exportCSV = () => {
    const out = [['Product', 'Type', 'On hand', 'Low-stock level', 'Suggested order', 'Cases (if known)', 'Used this season', 'Unit']]
    shown.forEach((r) => out.push([r.name, r.type, r.stock, r.low, r.suggest, r.cases ?? '', r.used, r.unit]))
    downloadCSV(out, `Reorder_List_${localDateISO()}.csv`)
  }

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2 gap-2">
        <p className="font-body text-xs text-slate-500">{needing.length} product{needing.length !== 1 ? 's' : ''} at or below low-stock.</p>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => setShowAll((v) => !v)} className="font-body text-[11px] font-bold px-3 py-2 rounded-full border" style={{ color: '#64748B', borderColor: '#E2E8F0' }}>{showAll ? 'Only low' : 'Show all tracked'}</button>
          <button onClick={exportCSV} disabled={shown.length === 0} className="font-body text-[11px] font-bold px-3 py-2 rounded-full border disabled:opacity-40" style={{ color: FOREST, borderColor: '#E2E8F0' }}>Export CSV</button>
        </div>
      </div>
      {shown.length === 0 ? (
        <Card><p className="font-body text-sm text-slate-400 text-center py-6">{rows.length === 0 ? 'Set a low-stock level on products (Chemical Library) to build a reorder list.' : 'Nothing low right now — you\'re stocked up.'}</p></Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-2 items-start">
          {shown.map((r) => (
            <div key={r.name} className="bg-white rounded-2xl border border-black/5 p-3 shadow-sm flex items-center gap-3" style={r.needs ? { borderColor: '#FCA5A5' } : undefined}>
              <div className="min-w-0 flex-1">
                <p className="font-body text-sm font-bold text-slate-900 truncate">{r.name} {r.needs && <span className="font-body text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1" style={{ backgroundColor: '#FEE2E2', color: '#B91C1C' }}>LOW</span>}</p>
                <p className="font-body text-[11px] text-slate-400">On hand {r.stock} · low at {r.low} · used {Math.round(r.used * 10) / 10} {r.usedUnit} this season</p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-body text-sm font-bold" style={{ color: r.suggest > 0 ? FOREST : '#94A3B8' }}>{r.suggest > 0 ? `+${r.suggest} ${r.unit}` : '—'}</p>
                {r.cases != null && <p className="font-body text-[10px] text-slate-400">≈ {r.cases} case{r.cases !== 1 ? 's' : ''}</p>}
              </div>
            </div>
          ))}
          <p className="font-body text-[11px] text-slate-400 mt-1">Suggested order tops each item back up to twice its low-stock level. Cases show when a product has "Oz/Case" set.</p>
        </div>
      )}
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
function CostReport({ sheets, products, areas, courseInfo = {}, onSaveSettings }) {
  const [view, setView] = useState('product') // 'product' | 'area' | 'month'
  const data = productCosts(sheets, products, areas)
  const money = (n) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const money0 = (n) => `$${Math.round(n || 0).toLocaleString('en-US')}`
  const monthLabel = (m) => { const [y, mm] = m.split('-'); return new Date(Number(y), Number(mm) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }

  // ── Budget layer ───────────────────────────────────────────────────────────
  // One annual chemical budget (persisted in course settings) benchmarked
  // against THIS calendar year's spend, with a pace read and a year-end
  // projection so you know early if you're tracking over.
  const budget = Number(courseInfo.sprayBudget) || 0
  const nowY = new Date().getFullYear()
  const spentThisYear = data.byMonth
    .filter((r) => r.month.startsWith(String(nowY)))
    .reduce((s, r) => s + r.cost, 0)
  const totalApps = data.rows.reduce((s, r) => s + r.apps, 0)
  const costPerApp = totalApps > 0 ? data.totalCost / totalApps : null
  // Fraction of the year elapsed (day-of-year ÷ 365), for the pace comparison.
  const startY = new Date(nowY, 0, 1)
  const yearFrac = Math.min(1, Math.max(0.02, (Date.now() - startY.getTime()) / (365 * 86400000)))
  const projected = spentThisYear > 0 ? spentThisYear / yearFrac : 0
  const pctUsed = budget > 0 ? spentThisYear / budget : null
  // Pace: spend fraction vs year fraction. >1.1 over pace, <0.9 under, else on.
  const paceRatio = budget > 0 ? pctUsed / yearFrac : null
  const paceLabel = paceRatio == null ? '' : paceRatio > 1.1 ? 'Over pace' : paceRatio < 0.9 ? 'Under budget' : 'On pace'
  const paceColor = paceRatio == null ? FERN : paceRatio > 1.1 ? '#DC2626' : paceRatio < 0.9 ? FERN : '#92660D'
  const overBudget = budget > 0 && spentThisYear > budget

  const [editBudget, setEditBudget] = useState(false)
  const [budgetDraft, setBudgetDraft] = useState('')
  const [savingBudget, setSavingBudget] = useState(false)
  const openBudget = () => { setBudgetDraft(budget ? String(budget) : ''); setEditBudget(true) }
  async function commitBudget() {
    if (!onSaveSettings) { setEditBudget(false); return }
    setSavingBudget(true)
    const val = budgetDraft === '' ? null : Math.max(0, Math.round(Number(budgetDraft) || 0))
    try { await onSaveSettings({ courseInfo: { ...courseInfo, sprayBudget: val } }) } catch { /* parent toasts */ }
    setSavingBudget(false)
    setEditBudget(false)
  }

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
    downloadCSV(out, `Spray_Costs_${localDateISO()}.csv`)
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

      {/* Annual budget tracker */}
      <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4 mb-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="min-w-0">
            <p className="font-body text-[11px] font-bold uppercase tracking-wide text-slate-400">{nowY} Chemical Budget</p>
            {budget > 0 ? (
              <p className="font-display text-2xl font-bold text-slate-900 mt-0.5">
                {money0(spentThisYear)} <span className="font-body text-sm font-medium text-slate-400">of {money0(budget)}</span>
              </p>
            ) : (
              <p className="font-body text-sm text-slate-500 mt-1">Set a budget to track spend against it.</p>
            )}
          </div>
          {onSaveSettings && (
            <button onClick={openBudget} className="font-body text-xs font-bold px-3 py-1.5 rounded-full shrink-0 border" style={{ color: FOREST, borderColor: '#D8E6DC', backgroundColor: '#F5FAF6' }}>
              {budget > 0 ? 'Edit' : 'Set budget'}
            </button>
          )}
        </div>

        {budget > 0 && (
          <>
            <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden mb-2">
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, Math.round((pctUsed || 0) * 100))}%`, backgroundColor: overBudget ? '#DC2626' : paceColor }} />
            </div>
            <div className="flex items-center justify-between flex-wrap gap-x-4 gap-y-1">
              <span className="font-body text-[12px] font-bold" style={{ color: paceColor }}>
                {Math.round((pctUsed || 0) * 100)}% used · {paceLabel}
              </span>
              <span className="font-body text-[12px] text-slate-500">
                {overBudget ? <>Over by <b className="text-red-600">{money0(spentThisYear - budget)}</b></> : <>{money0(budget - spentThisYear)} left</>}
              </span>
            </div>
            <div className="flex items-center gap-4 mt-2.5 pt-2.5 border-t border-black/5">
              <div>
                <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400">Projected year-end</p>
                <p className="font-display text-base font-bold mt-0.5" style={{ color: projected > budget ? '#DC2626' : FOREST }}>{money0(projected)}</p>
              </div>
              {costPerApp != null && (
                <div className="pl-4 border-l border-black/5">
                  <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400">Avg cost / application</p>
                  <p className="font-display text-base font-bold text-slate-900 mt-0.5">{money(costPerApp)}</p>
                </div>
              )}
            </div>
            <p className="font-body text-[10px] text-slate-400 mt-2">Pace compares spend so far against how much of the year has passed ({Math.round(yearFrac * 100)}% in). Projection = this year's spend ÷ that fraction. Counts approved &amp; completed sprays only.</p>
          </>
        )}
        {budget === 0 && costPerApp != null && (
          <div className="mt-1 pt-2.5 border-t border-black/5">
            <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400">Avg cost / application</p>
            <p className="font-display text-base font-bold text-slate-900 mt-0.5">{money(costPerApp)}</p>
          </div>
        )}
      </div>

      {editBudget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(26,26,22,0.45)' }} onClick={() => setEditBudget(false)}>
          <div className="bg-white rounded-2xl border-2 p-4 shadow-2xl w-full max-w-xs" style={{ borderColor: FOREST }} onClick={(e) => e.stopPropagation()}>
            <p className="font-display text-base font-semibold text-slate-900 mb-1">{nowY} chemical budget</p>
            <p className="font-body text-xs text-slate-400 mb-3">Your target spend on spray products for the year. Leave blank to turn the tracker off.</p>
            <div className="flex items-center gap-2">
              <span className="font-body text-lg font-semibold text-slate-500">$</span>
              <input type="number" step="1" min="0" inputMode="numeric" autoFocus value={budgetDraft} onChange={(e) => setBudgetDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commitBudget() }} className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-base font-body" placeholder="e.g. 120000" />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setEditBudget(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold font-body text-slate-500 border border-slate-200">Cancel</button>
              <button onClick={commitBudget} disabled={savingBudget} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body text-white disabled:opacity-50" style={{ backgroundColor: FOREST }}>{savingBudget ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

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

// ── IMPACT (EIQ) REPORT ──────────────────────────────────────────────────────
// A relative environmental-load score for the pesticide program (Cornell EIQ
// Field Use Rating), rolled up by product / area / month. Lower is better.
function ImpactReport({ sheets, products, areas }) {
  const [view, setView] = useState('product') // 'product' | 'area' | 'month'
  const data = eiqLoad(sheets, products, areas)
  const num = (n) => (n || 0).toLocaleString('en-US')
  const monthLabel = (m) => { const [y, mm] = m.split('-'); return new Date(Number(y), Number(mm) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }

  const lists = {
    product: data.rows.map((r) => ({ key: r.name, label: r.name, sub: `${r.apps} application${r.apps !== 1 ? 's' : ''}${r.type ? ` · ${r.type}` : ''}`, load: r.load })),
    area: data.byArea.map((r) => ({ key: r.area, label: r.area, sub: '', load: r.load })),
    month: data.byMonth.map((r) => ({ key: r.month, label: monthLabel(r.month), sub: '', load: r.load })),
  }
  const rows = lists[view]
  const max = Math.max(1, ...rows.map((r) => r.load))

  const exportCSV = () => {
    const out = [['Product', 'Type', 'Applications', 'EIQ load']]
    data.rows.forEach((r) => out.push([r.name, r.type, r.apps, r.load]))
    out.push([]); out.push(['Area', 'EIQ load'])
    data.byArea.forEach((r) => out.push([r.area, r.load]))
    out.push([]); out.push(['Month', 'EIQ load'])
    data.byMonth.forEach((r) => out.push([r.month, r.load]))
    out.push([]); out.push(['Total', data.total])
    downloadCSV(out, `EIQ_Impact_${localDateISO()}.csv`)
  }

  const hasData = data.rows.length > 0
  return (
    <div className="mt-4">
      <div className="rounded-2xl p-4 text-white shadow-sm mb-4 flex items-end justify-between" style={{ backgroundColor: FERN }}>
        <div>
          <p className="font-body text-[11px] font-bold uppercase tracking-wide opacity-80">Season environmental load (EIQ)</p>
          <p className="font-display text-3xl font-bold mt-0.5">{num(data.total)}</p>
          <p className="font-body text-[10px] opacity-80 mt-0.5">Relative score — lower is better. Compare month to month and year to year.</p>
        </div>
        {hasData && (
          <button onClick={exportCSV} className="font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5 shrink-0" style={{ backgroundColor: GOLD, color: FOREST }}>
            <Package size={14} /> Export
          </button>
        )}
      </div>

      <div className="flex items-start gap-2 rounded-xl bg-slate-50 border border-slate-100 p-3 mb-3">
        <Info size={15} className="text-slate-400 shrink-0 mt-0.5" />
        <p className="font-body text-[11px] text-slate-500">EIQ = Cornell's Environmental Impact Quotient — a public measure of a pesticide's risk to applicators, consumers, and wildlife. The score here is <b>EIQ × active % × amount applied</b>, summed across your sprays. It's for comparison over time, not an absolute safety limit. Fertilizers and wetting agents aren't scored.</p>
      </div>

      {data.missing.length > 0 && (
        <div className="bg-amber-50 rounded-2xl border border-amber-200 p-4 mb-4">
          <div className="flex items-start gap-2 mb-1.5">
            <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={16} />
            <p className="font-body text-sm font-bold text-amber-800">Some products aren't scored yet</p>
          </div>
          <p className="font-body text-[11px] text-amber-700 mb-2">Add an EIQ value and Active % in Chemical Library (look the active ingredient up at eiq.cornell-ipm.org) so these count.</p>
          <div className="flex flex-wrap gap-1.5">
            {data.missing.map((m) => <span key={m} className="font-body text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white text-amber-700 border border-amber-200">{m}</span>)}
          </div>
        </div>
      )}

      {!hasData ? (
        <div className="bg-white rounded-2xl border border-black/5 p-10 text-center text-slate-400 font-body text-sm">
          No scored sprays yet. Add EIQ values in Chemical Library and approve a pesticide spray to see impact here.
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
                  <p className="font-display text-base font-bold text-slate-900 shrink-0">{num(r.load)}</p>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(3, Math.round((r.load / max) * 100))}%`, backgroundColor: GOLD }} />
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
    downloadCSV(out, `Product_Usage_${localDateISO()}.csv`)
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
    downloadCSV(out, `Spray_History_${localDateISO()}.csv`)
  }
  return (
    <div className="mt-4">
      <div className="flex gap-2 mb-3 overflow-x-auto pb-1 items-center">
        <div className="shrink-0" style={{ width: 170 }}>
          <SearchSelect value={area} options={[{ value: 'all', label: 'All areas' }, ...areaNames]} onPick={setArea} sort={false} placeholder="Area…" />
        </div>
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
function OnboardingWizard({ courseInfo = {}, grassTypes = [], areas = {}, soilTypes = [], onFinish, onSkip }) {
  const [step, setStep] = useState(0)
  const [clubName, setClubName] = useState(courseInfo.clubName || '')
  const [deptName, setDeptName] = useState(courseInfo.deptName || 'Golf Maintenance')
  const [courses, setCourses] = useState(
    Array.isArray(courseInfo.courses) && courseInfo.courses.length
      ? courseInfo.courses.map((c, i) => ({ name: c.name || '', holes: Number(c.holes) || 18, color: c.color || COURSE_COLORS[i % COURSE_COLORS.length].hex }))
      : [{ name: '', holes: 18, color: COURSE_COLORS[0].hex }]
  )
  const [aMap, setAMap] = useState(() => ({ ...areas }))
  const [siteGrasses, setSiteGrasses] = useState(courseInfo.siteGrasses || [])
  const [custom, setCustom] = useState('')
  const [customGrasses, setCustomGrasses] = useState([])
  const [saving, setSaving] = useState(false)

  const allGrasses = [...grassTypes, ...customGrasses.filter((g) => !grassTypes.includes(g))]
  const totalHoles = courses.reduce((s, c) => s + (Number(c.holes) || 0), 0)
  const cleanCourses = courses
    .map((c) => ({ name: String(c.name || '').trim(), holes: Number(c.holes) || 0, color: c.color }))
    .filter((c) => c.holes > 0)

  const setCourse = (i, patch) => setCourses((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const addCourse = () => setCourses((prev) => [...prev, { name: '', holes: 18, color: COURSE_COLORS[prev.length % COURSE_COLORS.length].hex }])
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
        areas: aMap,
        grassTypes: mergedLibrary,
      })
    } catch (e) { console.error(e) }
    setSaving(false)
  }

  const STEPS = ['Club', 'Courses', 'Areas', 'Grasses']
  const lastStep = STEPS.length - 1

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
          <p className="font-body text-[11px] mt-2" style={{ color: 'rgba(255,255,255,0.7)' }}>Step {step + 1} of {STEPS.length} · {STEPS[step]}</p>
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
                  <div key={i} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <input value={c.name} onChange={(e) => setCourse(i, { name: e.target.value })} placeholder={courses.length > 1 ? `Course ${i + 1} name` : 'Course name (optional)'} className="flex-1 min-w-0 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
                      <div className="shrink-0" style={{ width: 120 }}>
                        <SearchSelect value={Number(c.holes) || 18} options={[9, 18, 27].map((h) => ({ value: h, label: `${h} holes` }))} onPick={(v) => setCourse(i, { holes: Number(v) })} sort={false} />
                      </div>
                      {courses.length > 1 && (
                        <button type="button" onClick={() => removeCourse(i)} className="text-slate-300 hover:text-red-500 transition shrink-0" aria-label="Remove course"><Trash2 size={16} /></button>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 pl-1">
                      <span className="font-body text-[10px] font-bold uppercase tracking-wide" style={{ color: '#94A3B8' }}>Colour</span>
                      {COURSE_COLORS.map((col) => (
                        <button key={col.hex} type="button" onClick={() => setCourse(i, { color: col.hex })} title={col.name} className="w-5 h-5 rounded-full" style={{ backgroundColor: col.hex, outline: c.color === col.hex ? `2px solid ${FOREST}` : 'none', outlineOffset: 2 }} />
                      ))}
                    </div>
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
              <p className="font-body text-sm text-slate-500">What's on each course? Add the areas — greens, tees, fairways… — and their grass, size, height of cut and soil. You can change all of this later in Settings.</p>
              {cleanCourses.length === 0
                ? <p className="font-body text-[12px] text-slate-400">Add a course first (go back a step).</p>
                : <CourseAreaRows courses={cleanCourses} aMap={aMap} setAMap={setAMap} grassTypes={[...grassTypes, ...customGrasses].filter((g, i, a) => a.indexOf(g) === i)} soilTypes={soilTypes} />}
            </div>
          )}

          {step === 3 && (
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
          {step < lastStep ? (
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
        {[['property', 'Property Setup'], ['course', 'Course Info'], ['location', 'Location'], ['people', 'People'], ['areas', 'Sprayer Areas'], ['lists', 'Lists']].map(([k, l]) => (
          <button key={k} onClick={() => setSection(k)} className="font-body text-xs font-semibold px-3.5 py-1.5 rounded-full whitespace-nowrap transition" style={section === k ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>
            {l}
          </button>
        ))}
      </div>

      {section === 'property' && <PropertySetup courseInfo={courseInfo} areas={areas} grassTypes={grassChoices} soilTypes={soilTypes} onSave={onSave} />}
      {section === 'course' && <CourseInfoSettings courseInfo={courseInfo} grassTypes={grassTypes} onSave={onSave} />}
      {section === 'location' && <LocationSettings location={location} onSave={onSave} />}
      {section === 'people' && <PeopleSettings operators={operators} directors={directors} applicatorLicenses={applicatorLicenses} directorPins={directorPins} onSave={onSave} />}
      {section === 'areas' && <AreasSettings areas={areas} grassTypes={grassChoices} soilTypes={soilTypes} onSave={onSave} />}
      {section === 'lists' && <ListsSettings targets={targets} sheetTypes={sheetTypes} grassTypes={grassTypes} soilTypes={soilTypes} courseInfo={courseInfo} onSave={onSave} />}
    </div>
  )
}

// Palette a course can be tagged with — drives the course bar + section colours.
const COURSE_COLORS = [
  { hex: '#2563EB', name: 'Blue' }, { hex: '#C9A84C', name: 'Gold' }, { hex: '#3A6B4A', name: 'Green' },
  { hex: '#B23A2E', name: 'Red' }, { hex: '#7C3AED', name: 'Purple' }, { hex: '#0E7490', name: 'Teal' },
  { hex: '#B45309', name: 'Amber' }, { hex: '#1A1A16', name: 'Black' },
]
const ACRES_PER_SQFT = 1 / 43560
const areaTok = (s) => String(s || '').trim().split(/\s+/)[0].toLowerCase()
// Which course an area belongs to: an explicit tag wins, else guess by first word.
function areaCourseOf(area, name, courseNames) {
  if (area?.course) return area.course
  const t = areaTok(name)
  return courseNames.find((c) => areaTok(c) === t) || ''
}
const COMMON_AREAS = ['Greens', 'Tees', 'Fairways', 'Approaches', 'Collars', 'Rough', 'Bunkers', 'Practice Green', 'Range', 'Nursery']

// The per-course area editor — shared by Settings → Property Setup and the
// first-run wizard. Each area carries grass, size, height of cut and soil type,
// and is tagged to a course. Edits are held in a draft; the parent persists.
function CourseAreaRows({ courses, aMap, setAMap, grassTypes = [], soilTypes = [] }) {
  const courseNames = courses.map((c) => c.name).filter(Boolean)
  const setArea = (name, patch) => setAMap((m) => ({ ...m, [name]: { ...(m[name] || {}), ...patch } }))
  const addArea = (course, label) => {
    let base = label || 'New area'
    let nm = courseNames.length ? `${course} ${base}` : base
    let i = 2; while (aMap[nm]) { nm = `${(courseNames.length ? course + ' ' : '')}${base} ${i++}` }
    setAMap((m) => ({ ...m, [nm]: { course, grasses: [], acres: '', hoc: '', soilType: '', sqft: 0, tanks: 1 } }))
  }
  const removeArea = (name) => setAMap((m) => { const n = { ...m }; delete n[name]; return n })
  const renameArea = (oldName, newName) => {
    if (!newName.trim() || newName === oldName || aMap[newName]) return
    setAMap((m) => { const n = { ...m }; n[newName] = n[oldName]; delete n[oldName]; return n })
  }

  const groups = [...courseNames.map((c) => ({ course: c, color: (courses.find((x) => x.name === c) || {}).color })), { course: '', color: null }]

  return (
    <div className="space-y-5">
      {groups.map(({ course, color }) => {
        const names = Object.keys(aMap).filter((n) => areaCourseOf(aMap[n], n, courseNames) === course)
        if (course === '' && names.length === 0) return null
        return (
          <div key={course || '__un'}>
            <div className="flex items-center gap-2 mb-2">
              {course
                ? <><span className="w-3 h-3 rounded-full" style={{ backgroundColor: color || '#94A3B8' }} /><span className="font-display text-[15px] font-semibold" style={{ color: FOREST }}>{course}</span></>
                : <span className="font-body text-[12px] font-bold uppercase tracking-wide" style={{ color: '#B45309' }}>Unassigned — pick a course</span>}
            </div>
            <div className="space-y-1.5">
              {names.map((n) => {
                const a = aMap[n]
                const acres = a.acres !== undefined && a.acres !== '' ? a.acres : (a.sqft ? Math.round(a.sqft * ACRES_PER_SQFT * 10) / 10 : '')
                return (
                  <div key={n} className="rounded-xl p-2.5" style={{ border: `1px solid ${HAIR}`, backgroundColor: PAPER }}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <input defaultValue={n} onBlur={(e) => renameArea(n, e.target.value.trim())} className="font-body text-[13.5px] font-bold border-0 bg-transparent focus:bg-white rounded px-1 py-0.5 w-32" style={{ color: INK }} />
                      {!course && (
                        <select value="" onChange={(e) => e.target.value && setArea(n, { course: e.target.value })} className="text-[12px] rounded-lg px-2 py-1" style={{ border: `1px solid ${HAIR}` }}>
                          <option value="">Assign…</option>
                          {courseNames.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      )}
                      <button onClick={() => removeArea(n)} className="ml-auto" title="Remove area"><Trash2 size={14} style={{ color: INK_3 }} /></button>
                    </div>
                    <div className="grid gap-2 mt-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))' }}>
                      <div>
                        <span className="font-body text-[9.5px] font-bold uppercase tracking-wide block mb-0.5" style={{ color: INK_3 }}>Grass</span>
                        <MultiSelect selected={a.grasses || []} options={grassTypes} onToggle={(g) => setArea(n, { grasses: (a.grasses || []).includes(g) ? (a.grasses || []).filter((x) => x !== g) : [...(a.grasses || []), g] })} placeholder="Grass…" />
                      </div>
                      <div>
                        <span className="font-body text-[9.5px] font-bold uppercase tracking-wide block mb-0.5" style={{ color: INK_3 }}>Acres</span>
                        <input inputMode="decimal" defaultValue={acres} onBlur={(e) => { const ac = e.target.value; setArea(n, { acres: ac, sqft: ac ? Math.round(Number(ac) * 43560) : 0 }) }} className="w-full rounded-lg px-2.5 py-2 text-sm font-body tnum" style={{ border: `1px solid ${HAIR}`, backgroundColor: 'white' }} />
                      </div>
                      <div>
                        <span className="font-body text-[9.5px] font-bold uppercase tracking-wide block mb-0.5" style={{ color: INK_3 }}>Height of cut</span>
                        <input defaultValue={a.hoc || ''} onBlur={(e) => setArea(n, { hoc: e.target.value })} placeholder="0.105 in" className="w-full rounded-lg px-2.5 py-2 text-sm font-body" style={{ border: `1px solid ${HAIR}`, backgroundColor: 'white' }} />
                      </div>
                      <div>
                        <span className="font-body text-[9.5px] font-bold uppercase tracking-wide block mb-0.5" style={{ color: INK_3 }}>Soil</span>
                        <select value={a.soilType || ''} onChange={(e) => setArea(n, { soilType: e.target.value })} className="w-full rounded-lg px-2 py-2 text-sm font-body" style={{ border: `1px solid ${HAIR}`, backgroundColor: 'white' }}>
                          <option value="">—</option>
                          {(soilTypes.length ? soilTypes : ['Sand-based', 'Push-up', 'Native soil', 'Sand-capped']).map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                )
              })}
              {names.length === 0 && course && <p className="font-body text-[12px]" style={{ color: INK_3 }}>No areas yet.</p>}
            </div>
            {course && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {COMMON_AREAS.map((lbl) => (
                  <button key={lbl} onClick={() => addArea(course, lbl)} className="font-body text-[11px] font-bold px-2.5 py-1.5 rounded-full" style={{ border: `1px dashed ${GOLD}`, backgroundColor: '#FBF6E6', color: FOREST }}>+ {lbl}</button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Settings → Property Setup: the editable home for the whole multi-course
// backbone — courses (name, holes, colour) and each course's areas.
function PropertySetup({ courseInfo, areas, grassTypes = [], soilTypes = [], onSave }) {
  const [courses, setCourses] = useState(() =>
    (Array.isArray(courseInfo.courses) && courseInfo.courses.length ? courseInfo.courses : [{ name: '', holes: 18 }])
      .map((c, i) => ({ name: c.name || '', holes: Number(c.holes) || 18, color: c.color || COURSE_COLORS[i % COURSE_COLORS.length].hex }))
  )
  const [aMap, setAMap] = useState(() => ({ ...areas }))
  const [saved, setSaved] = useState(false)

  const dirty = JSON.stringify(courses) !== JSON.stringify((courseInfo.courses || []).map((c) => ({ name: c.name, holes: c.holes, color: c.color })))
    || JSON.stringify(aMap) !== JSON.stringify(areas)

  const setCourse = (i, patch) => setCourses((p) => p.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const addCourse = () => setCourses((p) => [...p, { name: '', holes: 18, color: COURSE_COLORS[p.length % COURSE_COLORS.length].hex }])
  const removeCourse = (i) => setCourses((p) => (p.length > 1 ? p.filter((_, j) => j !== i) : p))

  const save = () => {
    const clean = courses.map((c) => ({ name: c.name.trim(), holes: Number(c.holes) || 0, color: c.color })).filter((c) => c.name)
    onSave({ courseInfo: { ...courseInfo, courses: clean, holes: clean.reduce((s, c) => s + c.holes, 0) }, areas: aMap })
    setSaved(true); setTimeout(() => setSaved(false), 2200)
  }

  return (
    <div className="space-y-6">
      <Card>
        <p className="font-display text-base font-semibold text-slate-900 mb-1">Courses</p>
        <p className="font-body text-xs text-slate-500 mb-3">The courses on your property. The colour tags each one across the whole app.</p>
        <div className="space-y-2">
          {courses.map((c, i) => (
            <div key={i} className="flex items-center gap-2 flex-wrap">
              <input value={c.name} onChange={(e) => setCourse(i, { name: e.target.value })} placeholder="Course name" className="flex-1 min-w-[140px] border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
              <div className="flex items-center gap-1">
                <input type="number" value={c.holes} onChange={(e) => setCourse(i, { holes: e.target.value })} className="w-16 border border-slate-200 rounded-xl px-2 py-2.5 text-sm font-body tnum text-center" />
                <span className="font-body text-[11px] text-slate-400">holes</span>
              </div>
              <div className="flex items-center gap-1">
                {COURSE_COLORS.map((col) => (
                  <button key={col.hex} onClick={() => setCourse(i, { color: col.hex })} title={col.name} className="w-5 h-5 rounded-full" style={{ backgroundColor: col.hex, outline: c.color === col.hex ? `2px solid ${FOREST}` : 'none', outlineOffset: 2 }} />
                ))}
              </div>
              <button onClick={() => removeCourse(i)} title="Remove"><Trash2 size={15} style={{ color: INK_3 }} /></button>
            </div>
          ))}
        </div>
        <button onClick={addCourse} className="mt-3 font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5" style={{ border: `1px solid ${HAIR}`, color: FOREST }}><Plus size={14} /> Add course</button>
      </Card>

      <Card>
        <p className="font-display text-base font-semibold text-slate-900 mb-1">Areas on each course</p>
        <p className="font-body text-xs text-slate-500 mb-4">What's on each course — grass, size, height of cut and soil. This is the backbone every screen reads from.</p>
        <CourseAreaRows courses={courses} aMap={aMap} setAMap={setAMap} grassTypes={grassTypes} soilTypes={soilTypes} />
      </Card>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={!dirty} className="font-body text-sm font-bold px-5 py-2.5 rounded-full text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>{saved ? 'Saved ✓' : 'Save property setup'}</button>
        {dirty && <span className="font-body text-[12px]" style={{ color: INK_3 }}>Unsaved changes</span>}
      </div>
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

// Small inline add-a-name control (its own text state so typing never churns
// the parent draft). Used for practice greens per course.
function PracticeGreenAdder({ onAdd }) {
  const [v, setV] = useState('')
  const add = () => { const n = v.trim(); if (!n) return; onAdd(n); setV('') }
  return (
    <div className="flex items-center gap-2">
      <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} placeholder="e.g. Putting Green, Nursery" className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-body" />
      <button type="button" onClick={add} disabled={!v.trim()} className="font-body text-[11px] font-bold px-3 py-2 rounded-lg text-white disabled:opacity-40 shrink-0" style={{ backgroundColor: FERN }}>Add</button>
    </div>
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
    const cleanCourses = courses.map((c) => ({ name: String(c.name || '').trim(), holes: Number(c.holes) || 0, practiceGreens: (c.practiceGreens || []).map((x) => String(x).trim()).filter(Boolean) })).filter((c) => c.holes > 0)
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
        <p className="font-body text-[11px] text-slate-400 mt-1 mb-2">One row per course. This builds your greens lists (holes 1–N) for spraying, soil tests and mowing routes — add a course to grow from 18 to 36, 54 holes and beyond.</p>
        <div className="space-y-2 mb-2">
          {courses.map((c, i) => (
            <div key={i} className="border border-slate-200 rounded-xl p-2.5">
              <div className="flex items-center gap-2">
                <input value={c.name || ''} onChange={(e) => setCourse(i, { name: e.target.value })} placeholder={courses.length > 1 ? `Course ${i + 1} name` : 'Course name (optional)'} className="flex-1 min-w-0 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
                <div className="shrink-0" style={{ width: 120 }}>
                  <SearchSelect value={Number(c.holes) || 18} options={[9, 18, 27].map((h) => ({ value: h, label: `${h} holes` }))} onPick={(v) => setCourse(i, { holes: Number(v) })} sort={false} />
                </div>
                {courses.length > 1 && <button type="button" onClick={() => removeCourse(i)} className="text-slate-300 hover:text-red-500 transition shrink-0" aria-label="Remove course"><Trash2 size={16} /></button>}
              </div>
              <div className="mt-2 pl-0.5">
                <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Practice / putting greens (optional)</p>
                {(c.practiceGreens || []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    {(c.practiceGreens || []).map((pg, pi) => (
                      <span key={pi} className="font-body text-[11px] font-semibold px-2.5 py-1 rounded-full flex items-center gap-1" style={{ backgroundColor: '#EAF2EC', color: FERN }}>
                        {pg}<button type="button" onClick={() => setCourse(i, { practiceGreens: (c.practiceGreens || []).filter((_, x) => x !== pi) })} className="opacity-60 hover:opacity-100">×</button>
                      </span>
                    ))}
                  </div>
                )}
                <PracticeGreenAdder onAdd={(name) => { if (!(c.practiceGreens || []).includes(name)) setCourse(i, { practiceGreens: [...(c.practiceGreens || []), name] }) }} />
              </div>
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

function NameListEditor({ title, items, onSave, accent, presets }) {
  const [list, setList] = useState(items)
  const [newName, setNewName] = useState('')
  const dirty = JSON.stringify(list) !== JSON.stringify(items)
  // Standard entries not already in the list — offered as a one-tap top-up.
  const missing = (presets || []).filter((p) => !list.includes(p))

  const add = () => {
    if (!newName.trim() || list.includes(newName.trim())) return
    setList([...list, newName.trim()])
    setNewName('')
  }
  const addPresets = () => { const merged = [...list, ...missing]; setList(merged); onSave(merged) }
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
      {missing.length > 0 && (
        <button onClick={addPresets} className="font-body text-[11px] font-bold mt-2 flex items-center gap-1" style={{ color: accent }}>
          <Plus size={13} /> Add the standard list ({missing.length} more)
        </button>
      )}
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
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
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
              <input type="file" accept="image/*" className="hidden" onChange={onImg} />
            </label>
            <button type="button" onClick={() => onImg(null)} className="font-body text-[11px] font-bold text-slate-400">Remove</button>
          </>
        ) : (
          <label className="font-body text-[11px] font-bold cursor-pointer flex items-center gap-1" style={{ color: FERN }}>
            <CloudUpload size={12} /> Attach copy
            <input type="file" accept="image/*" className="hidden" onChange={onImg} />
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

function ListsSettings({ targets, sheetTypes, grassTypes, soilTypes, courseInfo = {}, onSave }) {
  return (
    <div className="space-y-4">
      <MixOrderEditor courseInfo={courseInfo} onSave={onSave} />
      <NameListEditor title="Spray Targets" items={targets} accent="#7C3AED" presets={DEFAULT_TARGETS} onSave={(list) => onSave({ targets: list })} />
      <NameListEditor title="Sheet Types" items={sheetTypes} accent={FOREST} onSave={(list) => onSave({ sheetTypes: list })} />
      <NameListEditor title="Grass Types" items={grassTypes || []} accent="#2E7D32" onSave={(list) => onSave({ grassTypes: list })} />
      <NameListEditor title="Soil Types" items={soilTypes || []} accent="#92660D" onSave={(list) => onSave({ soilTypes: list })} />
    </div>
  )
}

// Editable tank-mix fill order. Products on spray sheets and the annual planner
// sort by formulation into this "jar test" fill sequence (dry first, adjuvants
// last). Drag-free up/down reorder — friendly on an iPad. Saved to
// courseInfo.mixOrder (a list of formulation ids); empty = the sensible default.
function MixOrderEditor({ courseInfo = {}, onSave }) {
  const defaultOrder = FORMULATIONS.map((f) => f.id)
  // Start from the saved order, then append any formulations not yet listed
  // (so new formulation types never silently vanish from the list).
  const seed = () => {
    const saved = Array.isArray(courseInfo.mixOrder) ? courseInfo.mixOrder.filter((id) => defaultOrder.includes(id)) : []
    return [...saved, ...defaultOrder.filter((id) => !saved.includes(id))]
  }
  const [order, setOrder] = useState(seed)
  const savedOrder = Array.isArray(courseInfo.mixOrder) && courseInfo.mixOrder.length ? courseInfo.mixOrder : defaultOrder
  const dirty = JSON.stringify(order) !== JSON.stringify(savedOrder)

  const move = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= order.length) return
    const next = [...order]
    ;[next[i], next[j]] = [next[j], next[i]]
    setOrder(next)
  }

  return (
    <Card>
      <p className="font-display text-base font-semibold text-slate-900 mb-1">Tank-Mix Fill Order</p>
      <p className="font-body text-xs text-slate-500 mb-3">
        The order products fill the tank on your spray sheets — the classic "jar test" sequence. Move items up or down to match how you like to mix. Products sort into this order automatically everywhere.
      </p>
      <div className="space-y-2">
        {order.map((id, i) => {
          const f = FORMULATIONS.find((x) => x.id === id)
          if (!f) return null
          return (
            <div key={id} className="flex items-center gap-3 bg-white rounded-xl border border-slate-100 px-3 py-2.5">
              <span className="font-body text-sm font-bold w-6 text-center shrink-0" style={{ color: FERN }}>{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="font-body text-sm font-semibold text-slate-900 truncate">{f.label}</p>
                {f.short && <p className="font-body text-[11px] text-slate-400">{f.short}</p>}
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="p-2 rounded-lg disabled:opacity-25" style={{ backgroundColor: '#F0F6F2', color: FERN }} aria-label="Move up"><ChevronUp size={16} /></button>
                <button onClick={() => move(i, 1)} disabled={i === order.length - 1} className="p-2 rounded-lg disabled:opacity-25" style={{ backgroundColor: '#F0F6F2', color: FERN }} aria-label="Move down"><ChevronDown size={16} /></button>
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex gap-2 mt-4">
        <button onClick={() => onSave({ courseInfo: { ...courseInfo, mixOrder: order } })} disabled={!dirty} className="font-body text-xs font-bold px-4 py-2.5 rounded-full text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>
          Save Fill Order
        </button>
        <button onClick={() => setOrder(defaultOrder)} disabled={JSON.stringify(order) === JSON.stringify(defaultOrder)} className="font-body text-xs font-semibold px-4 py-2.5 rounded-full disabled:opacity-40" style={{ color: '#64748B', border: '1px solid #E2E8F0' }}>
          Reset to default
        </button>
      </div>
    </Card>
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

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2 mt-4 items-start">
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
//  CREW WHITEBOARD MODULE — the morning job board (who's doing what today).
//  Every row is one job for one day; it's the raw daily-jobs log the efficiency
//  and trend views will be built from once there's history to mine.
// ════════════════════════════════════════════════════════════════════════
const DEFAULT_JOBS = [
  'Mow Greens', 'Mow Tees', 'Mow Fairways', 'Mow Approaches', 'Mow Rough',
  'Roll Greens', 'Change Cups', 'Rake Bunkers', 'Fill Divots', 'Move Tee Markers',
  'Course Setup', 'Blow / Clean', 'Hand Water', 'Irrigation Check', 'Topdress',
  'Verticut', 'Spray Support', 'Detail / Trim',
]
const TASK_STATUS = { todo: { label: 'To do', bg: '#FFFFFF', fg: '#64748B', bd: '#E2E8F0' }, doing: { label: 'Doing', bg: '#FBF1D3', fg: '#92660D', bd: '#F0DFA6' }, done: { label: 'Done ✓', bg: FERN, fg: '#FFFFFF', bd: FERN } }
const nextStatus = (s) => (s === 'todo' ? 'doing' : s === 'doing' ? 'done' : 'todo')
const shiftDate = (d, days) => { const dt = new Date(`${d}T00:00:00`); dt.setDate(dt.getDate() + days); return dt.toISOString().slice(0, 10) }
const prettyDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

// A type-to-filter dropdown that also accepts free text — for lists that can grow
// to hundreds of entries (jobs, equipment) where a chip row would overwhelm. Type
// to narrow the list, tap a match, or keep your own words.
function Combobox({ value, onChange, options = [], placeholder, accent = FOREST, max = 8 }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState(value || '')
  const wrapRef = useRef(null)
  useEffect(() => { setQ(value || '') }, [value])
  useEffect(() => {
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  const query = q.trim().toLowerCase()
  const matches = options.filter((o) => o && String(o).toLowerCase().includes(query)).slice(0, max)
  const exact = options.some((o) => String(o).toLowerCase() === query)
  const pick = (v) => { onChange(v); setQ(v); setOpen(false) }
  return (
    <div ref={wrapRef} className="relative">
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base font-body"
      />
      {open && (matches.length > 0 || (query && !exact)) && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-y-auto overscroll-contain">
          {matches.map((o) => (
            <button key={o} type="button" onMouseDown={(e) => { e.preventDefault(); pick(o) }} className="w-full text-left px-3 py-2 text-sm font-body hover:bg-slate-50">{o}</button>
          ))}
          {query && !exact && (
            <button type="button" onMouseDown={(e) => { e.preventDefault(); pick(q.trim()) }} className="w-full text-left px-3 py-2 text-sm font-body font-semibold hover:bg-slate-50" style={{ color: accent }}>Use “{q.trim()}”</button>
          )}
        </div>
      )}
    </div>
  )
}

// Multi-select searchable picker — type to filter a list (crew), tap to add each
// as a chip. For "Assign to," where a job can go to several people at once.
function PeoplePicker({ options = [], selected = [], onToggle, placeholder, max = 8 }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  useEffect(() => {
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  // Match on all typed words in any order — so "blue 3" finds "Blue Course Green 3".
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matches = options.filter((o) => { const s = String(o).toLowerCase(); return !selected.includes(o) && terms.every((t) => s.includes(t)) }).slice(0, max)
  return (
    <div ref={wrapRef}>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((name) => (
            <span key={name} className="font-body text-[11px] font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5" style={{ backgroundColor: FERN, color: 'white' }}>{name}<button type="button" onClick={() => onToggle(name)} className="opacity-70 hover:opacity-100">×</button></span>
          ))}
        </div>
      )}
      <div className="relative">
        <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} placeholder={placeholder} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
        {open && matches.length > 0 && (
          <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-y-auto overscroll-contain">
            {matches.map((o) => (
              <button key={o} type="button" onMouseDown={(e) => { e.preventDefault(); onToggle(o); setQ('') }} className="w-full text-left px-3 py-2 text-sm font-body hover:bg-slate-50">{o}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Inline "add a job" slot that lives right in the board (taskTracker-style):
// type or pick a job, it commits and clears so the next blank line is ready.
function AddJobRow({ options = [], onAdd, placeholder = 'Add a job…', max = 100 }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  useEffect(() => {
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  const query = q.trim().toLowerCase()
  const matches = options.filter((o) => o && String(o).toLowerCase().includes(query)).slice(0, max)
  const exact = options.some((o) => String(o).toLowerCase() === query)
  const commit = (v) => { const name = (v || '').trim(); if (!name) return; onAdd(name); setQ(''); setOpen(false) }
  return (
    <div ref={wrapRef} className="relative flex items-center gap-2 px-2 py-1.5" style={{ borderTop: '1px dashed #E1E8E3' }}>
      <span className="shrink-0 inline-flex items-center justify-center rounded" style={{ width: 20, height: 20, backgroundColor: '#EAF2EC', color: FERN }}><Plus size={13} /></span>
      <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(q) } }}
        placeholder={placeholder} className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2.5 py-2.5 text-base font-body bg-white" />
      {open && (matches.length > 0 || (query && !exact)) && (
        <div className="absolute z-30 left-8 right-2 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-y-auto overscroll-contain">
          {matches.map((o) => (
            <button key={o} type="button" onMouseDown={(e) => { e.preventDefault(); commit(o) }} className="w-full text-left px-3 py-3 text-base font-body hover:bg-slate-50">{o}</button>
          ))}
          {query && !exact && (
            <button type="button" onMouseDown={(e) => { e.preventDefault(); commit(q) }} className="w-full text-left px-3 py-3 text-base font-body font-semibold hover:bg-slate-50" style={{ color: FERN }}>Use “{q.trim()}”</button>
          )}
        </div>
      )}
    </div>
  )
}

const WB_SECTIONS = [
  { key: 'workboard', label: 'Workboard', icon: ClipboardList },
  { key: 'mowing', label: 'Mowing', icon: Scissors },
  { key: 'insights', label: 'Time & Efficiency', icon: BarChart3 },
  { key: 'crew', label: 'Crew', icon: User },
  { key: 'equipment', label: 'Equipment', icon: Truck },
  { key: 'jobtypes', label: 'Job Types', icon: Check },
]
// Common crew languages (label + code) for the per-staff native-language pick.
const CREW_LANGS = [['en', 'English'], ['es', 'Spanish'], ['pt', 'Portuguese'], ['ht', 'Haitian Creole'], ['vi', 'Vietnamese'], ['zh', 'Chinese'], ['fr', 'French'], ['ko', 'Korean']]
// Job rounds through the day — 1st (morning), 2nd (afternoon), 3rd/4th (later).
const SLOTS = [['1', '1st Jobs'], ['2', '2nd Jobs'], ['3', '3rd Jobs'], ['4', '4th Jobs']]
const slotLabel = (s) => (SLOTS.find(([k]) => k === String(s)) || [])[1] || '1st Jobs'

// Shell for the Whiteboard: a side menu (persistent rail on wide screens, a
// slide-out drawer on iPad/phone) that switches between the daily board, the
// efficiency trends, and the two lists that feed the board (equipment, jobs).
function WhiteboardModule({ user, nav, hideChrome }) {
  const manage = canManage(user.role)
  const [settings, setSettings] = useState({ operators: [], areas: {}, courseInfo: {} })
  const [section, setSection] = useState(nav?.route || 'workboard')
  useEffect(() => { if (nav?.route) setSection(nav.route) }, [nav])
  const [mowSub, setMowSub] = useState('routes')
  const [drawer, setDrawer] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)

  const [wbLoaded, setWbLoaded] = useState(false)
  useEffect(() => { (async () => { try { setSettings(await db.fetchSettings()) } catch (e) { console.error(e) } finally { setWbLoaded(true) } })() }, [])

  const courseInfo = settings.courseInfo || {}
  const jobTypes = courseInfo.jobTypes && courseInfo.jobTypes.length ? courseInfo.jobTypes : DEFAULT_JOBS
  const equipment = courseInfo.equipment || []
  const courses = (Array.isArray(courseInfo.courses) ? courseInfo.courses : []).filter((c) => c && c.name && Number(c.holes) > 0)
  const crew = courseInfo.crew || {} // { 'Name': { course, lang } }
  // The board's own crew roster: Spray Ops names are pulled in automatically, plus
  // any grounds crew added here (stored separately so it doesn't touch Spray Ops).
  const operators = settings.operators || []
  const crewMembers = courseInfo.crewMembers || []
  const roster = [...new Set([...operators, ...crewMembers])]
  const saveCourse = async (patch) => {
    const next = { ...courseInfo, ...patch }
    setSettings((s) => ({ ...s, courseInfo: next }))
    try { await db.saveSettings({ courseInfo: next }) } catch (e) { console.error(e) }
  }
  const active = WB_SECTIONS.find((s) => s.key === section) || WB_SECTIONS[0]

  const Nav = ({ onPick }) => (
    <nav className="space-y-1">
      {WB_SECTIONS.map((s) => {
        const on = s.key === section
        const Icon = s.icon
        return (
          <button key={s.key} onClick={() => { setSection(s.key); onPick && onPick() }} className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl font-body text-sm font-semibold transition text-left" style={on ? { backgroundColor: FOREST, color: 'white' } : { color: '#4B5563' }}>
            <Icon size={16} style={{ color: on ? GOLD : '#94A3B8' }} /> {s.label}
          </button>
        )
      })}
    </nav>
  )

  return (
    <div className="min-h-screen" style={{ backgroundColor: CREAM }}>
      {!hideChrome && (
        <div style={{ backgroundColor: FOREST }} className="text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-5 pb-4 flex items-center gap-3">
            <button onClick={() => setDrawer(true)} className="md:hidden w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: 'rgba(255,255,255,0.12)' }} aria-label="Open menu"><Menu size={18} /></button>
            <div className="min-w-0">
              <p className="font-display text-[10px] tracking-[0.25em] uppercase" style={{ color: GOLD }}>{courseInfo.clubName || 'Golf Club'}</p>
              <h1 className="font-display text-2xl font-semibold mt-0.5 truncate">{active.label}</h1>
            </div>
            <div className="ml-auto flex items-center gap-1.5 shrink-0">
              {manage && (
                <button onClick={() => setQrOpen(true)} className="font-body text-[11px] font-bold px-3 py-2 rounded-full flex items-center gap-1.5" style={{ backgroundColor: 'rgba(255,255,255,0.12)', color: 'white' }} title="Print QR codes so the crew can see the board & routes on their phones">
                  <QrCode size={13} /> <span className="hidden sm:inline">Crew QR</span>
                </button>
              )}
              {courses.length >= 2 ? (
                <>
                  <span className="font-body text-[10px] font-bold uppercase tracking-wide hidden sm:inline" style={{ color: 'rgba(255,255,255,0.5)' }}>TV</span>
                  {courses.map((c) => (
                    <a key={c.name} href={`/board?course=${encodeURIComponent(c.name)}`} target="_blank" rel="noopener noreferrer" className="font-body text-[11px] font-bold px-2.5 py-2 rounded-full shrink-0" style={{ backgroundColor: 'rgba(255,255,255,0.12)', color: 'white' }} title={`Open the ${c.name} board for a shop TV`}>{c.name}</a>
                  ))}
                  <a href="/board" target="_blank" rel="noopener noreferrer" className="font-body text-[11px] font-bold px-2.5 py-2 rounded-full shrink-0" style={{ backgroundColor: 'rgba(255,255,255,0.12)', color: 'white' }} title="Open the whole-property board">All</a>
                </>
              ) : (
                <a href="/board" target="_blank" rel="noopener noreferrer" className="font-body text-[11px] font-bold px-3 py-2 rounded-full flex items-center gap-1.5" style={{ backgroundColor: 'rgba(255,255,255,0.12)', color: 'white' }} title="Open the live board for the shop TV">
                  <BarChart3 size={13} /> TV board
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {drawer && (
        <div className="md:hidden fixed inset-0 z-50 flex" onClick={() => setDrawer(false)}>
          <div className="absolute inset-0" style={{ backgroundColor: 'rgba(22,41,31,0.5)' }} />
          <div className="relative bg-white w-64 max-w-[80%] h-full p-4 shadow-xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <p className="font-display text-base font-semibold" style={{ color: FOREST }}>Whiteboard</p>
              <button onClick={() => setDrawer(false)} aria-label="Close menu"><X size={18} className="text-slate-400" /></button>
            </div>
            <Nav onPick={() => setDrawer(false)} />
          </div>
        </div>
      )}

      {hideChrome && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4 flex items-center gap-1.5">
          <button onClick={() => setDrawer(true)} className="md:hidden font-body text-[11px] font-bold px-3 py-2 rounded-full flex items-center gap-1.5" style={{ backgroundColor: PAPER, color: FOREST, border: `1px solid ${HAIR}` }} aria-label="Sections"><Menu size={15} /> Sections</button>
          <div className="ml-auto flex items-center gap-1.5">
            {manage && (
              <button onClick={() => setQrOpen(true)} className="font-body text-[11px] font-bold px-3 py-2 rounded-full flex items-center gap-1.5" style={{ backgroundColor: PAPER, color: FOREST, border: `1px solid ${HAIR}` }} title="Print QR codes so the crew can see the board & routes on their phones">
                <QrCode size={13} /> <span className="hidden sm:inline">Crew QR</span>
              </button>
            )}
            {courses.length >= 2 ? (
              <>
                <span className="font-body text-[10px] font-bold uppercase tracking-wide hidden sm:inline" style={{ color: INK_3 }}>TV</span>
                {courses.map((c) => (
                  <a key={c.name} href={`/board?course=${encodeURIComponent(c.name)}`} target="_blank" rel="noopener noreferrer" className="font-body text-[11px] font-bold px-2.5 py-2 rounded-full shrink-0" style={{ backgroundColor: PAPER, color: FOREST, border: `1px solid ${HAIR}` }} title={`Open the ${c.name} board for a shop TV`}>{c.name}</a>
                ))}
                <a href="/board" target="_blank" rel="noopener noreferrer" className="font-body text-[11px] font-bold px-2.5 py-2 rounded-full shrink-0" style={{ backgroundColor: PAPER, color: FOREST, border: `1px solid ${HAIR}` }} title="Open the whole-property board">All</a>
              </>
            ) : (
              <a href="/board" target="_blank" rel="noopener noreferrer" className="font-body text-[11px] font-bold px-3 py-2 rounded-full flex items-center gap-1.5" style={{ backgroundColor: PAPER, color: FOREST, border: `1px solid ${HAIR}` }} title="Open the live board for the shop TV">
                <BarChart3 size={13} /> TV board
              </a>
            )}
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-24 pt-5 md:flex md:gap-6">
        <aside className="hidden md:block w-52 shrink-0">
          <div className="bg-white rounded-2xl border border-black/5 p-2 shadow-sm sticky top-4"><Nav /></div>
        </aside>
        <div className="flex-1 min-w-0">
          {section === 'workboard' && <WorkboardView manage={manage} settings={settings} roster={roster} jobTypes={jobTypes} equipment={equipment} courses={courses} crew={crew} boardMessage={courseInfo.boardMessage || ''} onSaveMessage={(m) => saveCourse({ boardMessage: m })} />}
          {section === 'mowing' && (
            <div>
              <div className="flex gap-1.5 mb-4">
                {[['routes', 'Routes'], ['directions', 'Directions']].map(([k, lab]) => (
                  <button key={k} onClick={() => setMowSub(k)} className="font-body text-sm font-bold px-4 py-2 rounded-full transition"
                    style={mowSub === k ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: INK_2, border: `1px solid ${HAIR}` }}>{lab}</button>
                ))}
              </div>
              {!wbLoaded ? (
                <div className="pt-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={26} /></div>
              ) : mowSub === 'routes' ? (
                <MowingRoutes courses={courses} courseInfo={courseInfo} roster={roster} manage={manage} onSave={saveCourse} />
              ) : (
                <MowingDirections courses={courses} courseInfo={courseInfo} manage={manage} onSave={saveCourse} />
              )}
            </div>
          )}
          {section === 'insights' && <WhiteboardInsights />}
          {section === 'crew' && <WhiteboardCrew roster={roster} operators={operators} crewMembers={crewMembers} courses={courses} crew={crew} manage={manage} onSaveCrew={(next) => saveCourse({ crew: next })} onSaveMembers={(list) => saveCourse({ crewMembers: list })} />}
          {section === 'equipment' && <WhiteboardListSection title="Equipment" hint="The mowers, rollers, blowers and carts your crew runs. These become quick-pick chips when you add a job." items={equipment} manage={manage} accent={FERN} onSave={(list) => saveCourse({ equipment: list })} />}
          {section === 'jobtypes' && <WhiteboardListSection title="Job Types" hint="The everyday jobs that show as one-tap chips on the Workboard. Add the ones your crew runs each morning." items={jobTypes} manage={manage} accent={FOREST} onSave={(list) => saveCourse({ jobTypes: list })} />}
        </div>
      </div>
      {qrOpen && <CrewQRModal courseInfo={courseInfo} saveCourse={saveCourse} onClose={() => setQrOpen(false)} />}
    </div>
  )
}

// Print/scan QR codes that open the crew's phone views — the live job board and
// the mowing routes — with no login (the club key rides in the QR link).
function CrewQRModal({ courseInfo, saveCourse, onClose }) {
  const [board, setBoard] = useState('')
  const [routes, setRoutes] = useState('')
  const club = courseInfo?.clubName || 'Golf Course'
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let key = courseInfo?.partsKey
      if (!key) {
        key = (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '')
        try { await saveCourse({ partsKey: key }) } catch (e) { console.error(e) }
      }
      const origin = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin
      const [b, r] = await Promise.all([
        qrDataUrl(`${origin}/tv?k=${key}`, { width: 520 }),
        qrDataUrl(`${origin}/routes?k=${key}`, { width: 520 }),
      ])
      if (!cancelled) { setBoard(b); setRoutes(r) }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const printOne = (title, img) => {
    if (!img) return
    const iframe = document.createElement('iframe')
    Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
    document.body.appendChild(iframe)
    const doc = iframe.contentWindow.document
    doc.open()
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:0.5in}body{margin:0;font-family:Arial;text-align:center;padding:30px}h1{font-family:Georgia,serif;color:#16291F;font-size:26px;margin:0 0 4px}.sub{color:#3A6B4A;font-weight:700;font-size:14px;margin-bottom:20px}img{width:3.4in;height:3.4in}.foot{color:#888;font-size:12px;margin-top:14px}</style></head><body><h1>${club.replace(/[&<>"]/g, '')} — ${title}</h1><div class="sub">Scan with your phone camera</div><img src="${img}"><div class="foot">Point your phone camera at the code.</div></body></html>`)
    doc.close()
    setTimeout(() => { try { iframe.contentWindow.focus(); iframe.contentWindow.print() } finally { setTimeout(() => iframe.remove(), 1000) } }, 300)
  }

  const Card = ({ title, blurb, img }) => (
    <div className="rounded-2xl border border-slate-100 p-4 text-center flex flex-col items-center">
      <p className="font-body text-sm font-bold" style={{ color: FOREST }}>{title}</p>
      <p className="font-body text-[11px] text-slate-400 mb-2">{blurb}</p>
      {img ? <img src={img} alt="" className="w-40 h-40" /> : <div className="w-40 h-40 flex items-center justify-center"><Loader2 className="animate-spin text-slate-300" size={22} /></div>}
      <button onClick={() => printOne(title, img)} disabled={!img} className="mt-3 font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5 disabled:opacity-40" style={{ color: FOREST, border: '1px solid #CBD5E1' }}><Printer size={13} /> Print</button>
    </div>
  )

  return (
    <div className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center p-3 sm:p-4" style={{ backgroundColor: 'rgba(26,26,22,0.5)' }} onClick={onClose}>
      <div className="bg-white rounded-2xl w-full sm:max-w-xl shadow-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 sticky top-0 bg-white" style={{ borderBottom: '1px solid #EEF0EC' }}>
          <p className="font-display text-base font-bold" style={{ color: FOREST }}>Crew phone QR codes</p>
          <button onClick={onClose} className="text-slate-400"><X size={18} /></button>
        </div>
        <div className="p-4">
          <p className="font-body text-[12px] text-slate-500 mb-3">Print these and post them in the shop (or the crew can scan right off your screen). No login needed — they open straight to the board or routes on a phone.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Card title="Job Board" blurb="Today's live crew board" img={board} />
            <Card title="Mowing Routes" blurb="Locked greens routes per mower" img={routes} />
          </div>
        </div>
      </div>
    </div>
  )
}

// QR that opens the crew's no-login Field Data page — moisture, clippings,
// greens speed and scouting entry only. The club key rides in the link.
function DataQRModal({ courseInfo, saveCourse, onClose }) {
  const [img, setImg] = useState('')
  const [url, setUrl] = useState('')
  const club = courseInfo?.clubName || 'Golf Course'
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let key = courseInfo?.partsKey
      if (!key) {
        key = (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '')
        try { await saveCourse({ partsKey: key }) } catch (e) { console.error(e) }
      }
      const origin = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin
      // One code for everyone — the crew picks the course on the page itself.
      const link = `${origin}/data?k=${key}`
      const q = await qrDataUrl(link, { width: 520 })
      if (!cancelled) { setImg(q); setUrl(link) }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const print = () => {
    if (!img) return
    const iframe = document.createElement('iframe')
    Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
    document.body.appendChild(iframe)
    const doc = iframe.contentWindow.document
    doc.open()
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:0.5in}body{margin:0;font-family:Arial;text-align:center;padding:30px}h1{font-family:Georgia,serif;color:#16291F;font-size:26px;margin:0 0 4px}.sub{color:#3A6B4A;font-weight:700;font-size:14px;margin-bottom:20px}img{width:3.4in;height:3.4in}.foot{color:#888;font-size:12px;margin-top:14px}</style></head><body><h1>${club.replace(/[&<>"]/g, '')} — Field Data</h1><div class="sub">Scan with your phone camera</div><img src="${img}"><div class="foot">Pick your course on the page · Moisture · Clippings · Greens Speed · Scouting</div></body></html>`)
    doc.close()
    setTimeout(() => { try { iframe.contentWindow.focus(); iframe.contentWindow.print() } finally { setTimeout(() => iframe.remove(), 1000) } }, 300)
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center p-3 sm:p-4" style={{ backgroundColor: 'rgba(26,26,22,0.5)' }} onClick={onClose}>
      <div className="bg-white rounded-2xl w-full sm:max-w-md shadow-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 sticky top-0 bg-white" style={{ borderBottom: '1px solid #EEF0EC' }}>
          <p className="font-display text-base font-bold" style={{ color: FOREST }}>Crew data QR</p>
          <button onClick={onClose} className="text-slate-400"><X size={18} /></button>
        </div>
        <div className="p-4 text-center">
          <p className="font-body text-[12px] text-slate-500 mb-3">One code for the whole crew. They scan it, <b>pick their course at the top</b> (Blue / Gold), and record moisture, clippings, greens speed and scouting. No login, nothing else reachable.</p>
          {img ? <img src={img} alt="Field data QR" className="w-48 h-48 mx-auto" /> : <div className="w-48 h-48 mx-auto flex items-center justify-center"><Loader2 className="animate-spin text-slate-300" size={22} /></div>}
          {url && <p className="font-body text-[10.5px] text-slate-400 mt-2 break-all">{url}</p>}
          <button onClick={print} disabled={!img} className="mt-3 font-body text-xs font-bold px-4 py-2 rounded-full inline-flex items-center gap-1.5 disabled:opacity-40" style={{ color: FOREST, border: '1px solid #CBD5E1' }}><Printer size={13} /> Print</button>
        </div>
      </div>
    </div>
  )
}

// The daily job board — who's doing what today. Fetches its own tasks by date.
function WorkboardView({ manage, settings, roster = [], jobTypes, equipment, courses = [], crew = {}, boardMessage = '', onSaveMessage }) {
  const [date, setDate] = useState(localDateISO())
  const [msgDraft, setMsgDraft] = useState(boardMessage)
  useEffect(() => { setMsgDraft(boardMessage) }, [boardMessage])
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState(null)
  const [course, setCourse] = useState('')
  const [groupBy, setGroupBy] = useState('job') // 'job' | 'person'
  const [openJobs, setOpenJobs] = useState({}) // jobKey -> open? accordion — only one job box open at a time
  const [jobEquipDraft, setJobEquipDraft] = useState({}) // gk -> in-progress "add a tool" text
  const [confirmAssign, setConfirmAssign] = useState(null) // { name, jk, s, others } when adding someone already on a job
  const [crewAddJob, setCrewAddJob] = useState(null) // gk whose crew list the "+" popped straight open
  const [tx, setTx] = useState({})
  // Accordion: opening a job closes any other that's open, so the board stays tidy.
  const toggleJob = (jk) => { setCrewAddJob(null); setOpenJobs((p) => (p[jk] ? {} : { [jk]: true })) }

  const courseNames = courses.map((c) => c.name)
  const hasCourses = courseNames.length >= 2
  // Just the real courses (no "All") — and it stays data-driven, so adding a
  // course in Settings makes a new tab appear here on the next load.
  const activeCourse = hasCourses ? (courseNames.includes(course) ? course : courseNames[0]) : ''

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try { const t = await db.fetchCrewTasks(date, date); if (!cancelled) setTasks(t) }
      catch (e) { console.error(e); if (!cancelled) setMsg({ type: 'err', text: taskErrorText(e) }) }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [date])

  const reload = async () => { try { setTasks(await db.fetchCrewTasks(date, date)) } catch (e) { console.error(e) } }

  // Translate each person's jobs into their native language (AI, cached).
  const crewSig = JSON.stringify(crew || {})
  useEffect(() => {
    let cancelled = false
    loadTranslations(tasks, crew).then((m) => { if (!cancelled) setTx(m) }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, crewSig])

  // A "Mow Greens" job splits the locked greens route across whoever's on it —
  // so each person gets their own greens in their note. Recomputed whenever the
  // crew changes, so the split always matches the current head-count.
  const isGreensMow = (jk) => /mow\w*\s+greens/i.test(jk || '')
  const assignGreens = async (jk, s = '1') => {
    const fresh = await db.fetchCrewTasks(date, date)
    const group = fresh
      .filter((t) => (t.job || '—') === jk && (t.slot || '1') === s && (!activeCourse || t.course === activeCourse || !t.course) && t.assignee)
      .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    if (!group.length) return
    const course = courses.find((c) => c.name === activeCourse) || courses[0] || {}
    const cName = course.name || activeCourse || ''
    const lay = labelledLayout(settings.courseInfo || {}, cName, course, group.length)
    await Promise.all(group.map((t, i) => db.updateCrewTask({ ...t, notes: (lay[i] || []).join(', ') })))
  }
  const remove = async (id) => {
    const removed = tasks.find((x) => x.id === id)
    setTasks((prev) => prev.filter((x) => x.id !== id))
    try {
      await db.deleteCrewTask(id)
      if (removed && isGreensMow(removed.job)) await assignGreens(removed.job, removed.slot || '1')
      await reload()
    } catch (e) { console.error(e); reload() }
  }
  // Add a job to a round with no crew yet — a placeholder row you then fill.
  // Picking a job in the inline slot drops it onto the board; the slot clears.
  const quickAddJob = async (name, s = '1') => {
    const jobName = (name || '').trim()
    if (!jobName) return
    // Already on this round? Just open it instead of duplicating.
    if (view.some((t) => (t.job || '') === jobName && (t.slot || '1') === s)) {
      setOpenJobs({ [`${s}::${jobName}`]: true }); return
    }
    try {
      const sort = tasks.length ? Math.max(...tasks.map((t) => t.sort || 0)) + 1 : 0
      await db.addCrewTask({ date, job: jobName, assignee: '', course: activeCourse, status: 'todo', sort, slot: s })
      await reload()
    } catch (e) { console.error(e); setMsg({ type: 'err', text: taskErrorText(e) }) }
  }
  // Add one more person onto a job. If the job is still an empty placeholder
  // (one row, nobody on it), fill that row instead of adding a second.
  const addPersonToJob = async (jk, name, s = '1') => {
    try {
      const groupTasks = view.filter((t) => (t.job || '—') === jk && (t.slot || '1') === s)
      const placeholder = groupTasks.length === 1 && !groupTasks[0].assignee ? groupTasks[0] : null
      if (placeholder) {
        await db.updateCrewTask({ ...placeholder, assignee: name })
      } else {
        const sort = tasks.length ? Math.max(...tasks.map((t) => t.sort || 0)) + 1 : 0
        await db.addCrewTask({ date, job: jk, assignee: name, course: activeCourse, status: 'todo', sort, slot: s })
      }
      // Greens mow: re-split the route across everyone now on the job.
      if (isGreensMow(jk)) await assignGreens(jk, s)
      await reload()
    } catch (e) { console.error(e); setMsg({ type: 'err', text: taskErrorText(e) }) }
  }
  // Take a named person off a job (used by the crew checklist — unchecking).
  const removePersonFromJob = (jk, name, s = '1') => {
    const t = view.find((x) => (x.job || '—') === jk && (x.slot || '1') === s && x.assignee === name)
    if (t) remove(t.id)
  }
  // Move a person to this job — take them off every other job first, then add.
  const movePersonToJob = async (name, jk, s = '1') => {
    try {
      const others = view.filter((t) => t.assignee === name && !((t.job || '—') === jk && (t.slot || '1') === s))
      for (const t of others) {
        await db.deleteCrewTask(t.id)
        if (isGreensMow(t.job)) await assignGreens(t.job, t.slot || '1') // re-split the job they left
      }
      await addPersonToJob(jk, name, s) // this reloads at the end
    } catch (e) { console.error(e); setMsg({ type: 'err', text: taskErrorText(e) }) }
  }
  // Edit the note on a whole job group (the note is shared across its people).
  // Whole-crew note — the same message shown to everyone on the job (group_note).
  const saveJobNote = async (jk, text, s = '1') => {
    const inGroup = view.filter((t) => (t.job || '—') === jk && (t.slot || '1') === s)
    setTasks((prev) => prev.map((t) => (inGroup.some((g) => g.id === t.id) ? { ...t, groupNote: text } : t)))
    try { await Promise.all(inGroup.map((t) => db.updateCrewTask({ ...t, groupNote: text }))) } catch (e) { console.error(e); reload() }
  }
  // Individual note for one person on the job (their own `notes` line).
  const savePersonNote = async (id, text) => {
    const t = tasks.find((x) => x.id === id)
    if (!t) return
    setTasks((prev) => prev.map((x) => (x.id === id ? { ...x, notes: text } : x)))
    try { await db.updateCrewTask({ ...t, notes: text }) } catch (e) { console.error(e); reload() }
  }
  // Attach / change the equipment on a whole job group (shared across its people).
  const saveJobEquip = async (jk, tools, s = '1') => {
    const inGroup = view.filter((t) => (t.job || '—') === jk && (t.slot || '1') === s)
    const eq = tools.join(', ')
    setTasks((prev) => prev.map((t) => (inGroup.some((g) => g.id === t.id) ? { ...t, equipment: eq } : t)))
    try { await Promise.all(inGroup.map((t) => db.updateCrewTask({ ...t, equipment: eq }))) } catch (e) { console.error(e); reload() }
  }
  // Remove a whole job group (of one round) for the day (only rows in view).
  const removeJobGroup = async (jk, s = '1') => {
    const ids = tasks.filter((t) => (t.job || '—') === jk && (t.slot || '1') === s && (!activeCourse || t.course === activeCourse || !t.course)).map((t) => t.id)
    setTasks((prev) => prev.filter((t) => !ids.includes(t.id)))
    try { await Promise.all(ids.map((id) => db.deleteCrewTask(id))) } catch (e) { console.error(e); reload() }
  }

  // Course-scoped view: a course tab shows that course's jobs plus property-wide
  // (no-course) jobs; "All" shows everything.
  const view = activeCourse ? tasks.filter((t) => t.course === activeCourse || !t.course) : tasks
  const operators = roster
  // Staff for the assignee picker: everyone's available on both courses, but the
  // selected course's home crew is listed first.
  const orderedOps = activeCourse
    ? [...operators].sort((a, b) => (((crew[a]?.course === activeCourse) ? 0 : 1) - ((crew[b]?.course === activeCourse) ? 0 : 1)) || operators.indexOf(a) - operators.indexOf(b))
    : operators
  const isToday = date === localDateISO()

  const groups = {}
  view.forEach((t) => { const k = t.assignee || '__none'; (groups[k] = groups[k] || []).push(t) })
  const groupKeys = Object.keys(groups).sort((a, b) => (a === '__none' ? -1 : b === '__none' ? 1 : a.localeCompare(b)))

  // Group by job (default): everyone on the same job shares one bubble.
  // Group by job (default): everyone on the same job shares one bubble — split
  // into rounds (1st/2nd/3rd) so the day's later jobs are their own sections.
  const bySlot = {}
  view.forEach((t) => { const s = t.slot || '1'; const k = t.job || '—'; (bySlot[s] = bySlot[s] || {}); (bySlot[s][k] = bySlot[s][k] || []).push(t) })
  const slotsPresent = SLOTS.map(([k]) => k).filter((k) => bySlot[k] && Object.keys(bySlot[k]).length)
  // Everyone already on any job today — used to grey them in the crew checklist
  // so you can see who's spoken for (they're still selectable).
  const assignedToday = [...new Set(view.filter((t) => t.assignee).map((t) => t.assignee))]

  return (
    <div>
      <div className="bg-white rounded-2xl border border-black/5 p-2.5 shadow-sm mb-4 flex items-center gap-2">
        <button onClick={() => setDate(shiftDate(date, -1))} className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100" aria-label="Previous day"><ChevronRight size={16} className="text-slate-500" style={{ transform: 'rotate(180deg)' }} /></button>
        <div className="flex-1 text-center">
          <p className="font-body text-sm font-bold text-slate-800">{prettyDay(date)}</p>
          <p className="font-body text-[10px] text-slate-400">{view.length} job{view.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => setDate(shiftDate(date, 1))} className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100" aria-label="Next day"><ChevronRight size={16} className="text-slate-500" /></button>
        {!isToday && <button onClick={() => setDate(localDateISO())} className="font-body text-[11px] font-bold px-3 py-1.5 rounded-full text-white" style={{ backgroundColor: FERN }}>Today</button>}
      </div>

      {manage && (
        <div className="bg-white rounded-2xl border border-black/5 p-2.5 shadow-sm mb-4 flex items-center gap-2">
          <BarChart3 size={14} className="shrink-0 text-slate-400" />
          <input value={msgDraft} onChange={(e) => setMsgDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && onSaveMessage) onSaveMessage(msgDraft.trim()) }} placeholder="Shop message shown on the TV board (e.g. Please clean out carts)…" className="flex-1 min-w-0 border-0 text-sm font-body focus:outline-none" />
          {msgDraft.trim() !== boardMessage && <button onClick={() => onSaveMessage && onSaveMessage(msgDraft.trim())} className="font-body text-[11px] font-bold px-2.5 py-1.5 rounded-lg text-white shrink-0" style={{ backgroundColor: FOREST }}>Save</button>}
          {boardMessage && msgDraft.trim() === boardMessage && <button onClick={() => onSaveMessage && onSaveMessage('')} className="font-body text-[11px] font-bold px-2 py-1.5 rounded-lg shrink-0 text-slate-400">Clear</button>}
        </div>
      )}

      {hasCourses && (
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          {courseNames.map((c) => (
            <button key={c} onClick={() => setCourse(c)} className="font-body text-xs font-bold px-3.5 py-1.5 rounded-full whitespace-nowrap transition" style={activeCourse === c ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>{c}</button>
          ))}
        </div>
      )}

      {msg && <div className="rounded-xl px-3 py-2 mb-3 font-body text-[12px] font-semibold" style={msg.type === 'ok' ? { backgroundColor: '#E8F3EC', color: FERN } : { backgroundColor: '#FEE2E2', color: '#B91C1C' }}>{msg.text}</div>}

      {!loading && view.length > 0 && (
        <div className="flex gap-1.5 mb-3">
          {[['job', 'By job'], ['person', 'By person']].map(([k, l]) => (
            <button key={k} onClick={() => setGroupBy(k)} className="font-body text-[11px] font-bold px-3 py-1.5 rounded-full transition" style={groupBy === k ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>{l}</button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="pt-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={26} /></div>
      ) : (!manage && view.length === 0) ? (
        <div className="bg-white rounded-2xl border border-black/5 p-10 text-center text-slate-400 font-body text-sm">
          No jobs posted for this day yet.
        </div>
      ) : (groupBy === 'person' && view.length > 0) ? (
        <div className="space-y-3">
          {groupKeys.map((k) => (
            <div key={k} className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: k === '__none' ? '#EEF2F0' : '#E8F3EC' }}>
                  <User size={14} style={{ color: k === '__none' ? '#94A3B8' : FERN }} />
                </div>
                <p className="font-body font-semibold text-sm text-slate-900">{k === '__none' ? 'Unassigned' : k}</p>
                {hasCourses && crew[k]?.course && <span className="font-body text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#EEF4FF', color: '#3B5BA5' }}>{crew[k].course}</span>}
                {crew[k]?.lang && crew[k].lang !== 'en' && <span className="font-body text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#F1F5F3', color: '#57756A' }}>{(CREW_LANGS.find(([c]) => c === crew[k].lang) || [])[1] || crew[k].lang}</span>}
                <span className="font-body text-[10px] text-slate-400 ml-auto">{groups[k].length} job{groups[k].length !== 1 ? 's' : ''}</span>
              </div>
              <div className="space-y-1.5">
                {groups[k].map((t) => {
                  const tools = (t.equipment || '').split(',').map((s) => s.trim()).filter(Boolean)
                  const lang = crew[k]?.lang
                  const jobText = txGet(tx, lang, t.job) || t.job
                  return (
                    <div key={t.id} className="flex items-start gap-2 rounded-xl border px-2.5 py-2" style={{ borderColor: '#EEF2F0', backgroundColor: 'white' }}>
                      <div className="min-w-0 flex-1">
                        <p className="font-body text-[13px] font-semibold text-slate-800 truncate">{jobText}</p>
                        {jobText !== t.job && <p className="font-body text-[10px] text-slate-400 italic truncate">{t.job}</p>}
                        {t.notes && <p className="font-body text-[12px] font-semibold mt-0.5" style={{ color: FERN }}>{t.notes}</p>}
                        {tools.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {tools.map((tool, i) => <span key={i} className="font-body text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#F1F5F3', color: '#57756A' }}>{txGet(tx, lang, tool) || tool}</span>)}
                          </div>
                        )}
                      </div>
                      {manage && <button onClick={() => remove(t.id)} className="text-slate-300 hover:text-red-500 transition shrink-0 mt-0.5" aria-label="Remove"><Trash2 size={14} /></button>}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (() => {
        // Which rounds to show: managers always get 1st (with an inline add
        // slot), then each next round appears once the one before has a job —
        // 2nd after 1st, 3rd after 2nd, 4th after 3rd — so later rounds reveal
        // themselves instead of needing a round picker.
        const hasRound = (x) => bySlot[x] && Object.keys(bySlot[x]).length > 0
        let roundsToShow = manage ? ['1', ...(hasRound('1') ? ['2'] : []), ...(hasRound('2') ? ['3'] : []), ...(hasRound('3') ? ['4'] : [])] : [...slotsPresent]
        ;['2', '3', '4'].forEach((x) => { if (hasRound(x) && !roundsToShow.includes(x)) roundsToShow.push(x) })
        roundsToShow = [...new Set(roundsToShow)].sort()
        return (
        <div className="space-y-5">
          {roundsToShow.map((s) => {
          const sGroups = bySlot[s] || {}
          const sKeys = Object.keys(sGroups).sort((a, b) => sGroups[b].length - sGroups[a].length || a.localeCompare(b))
          const jobCount = Object.keys(sGroups).length
          const crewCount = Object.values(sGroups).reduce((n, g) => n + g.filter((t) => t.assignee).length, 0)
          return (
          <div key={s}>
          {/* Round header — a clear "1ST JOBS" bar, like a whiteboard section */}
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-t-xl" style={{ backgroundColor: FOREST }}>
            <span className="font-body text-[13px] font-extrabold uppercase tracking-wider text-white">{slotLabel(s)}</span>
            <span className="font-body text-[11px] font-semibold text-white/60">· {jobCount} job{jobCount !== 1 ? 's' : ''} · {crewCount} on</span>
            {s !== '1' && <span className="font-body text-[11px] font-bold ml-auto text-white/70">{s === '2' ? 'Afternoon' : 'Later'}</span>}
          </div>
          <div className="border border-t-0 rounded-b-xl bg-white" style={{ borderColor: '#E4EBE6' }}>
          {sKeys.map((jk, jobIdx) => {
            const gk = `${s}::${jk}`
            const list = sGroups[jk]
            const langs = [...new Set(list.map((t) => crew[t.assignee]?.lang).filter((l) => l && l !== 'en'))]
            const open = !!openJobs[gk] // each job is a drop-down box — closed by default so you scan your list, open to edit
            const alreadyOn = list.map((t) => t.assignee).filter(Boolean)
            const crewSummary = alreadyOn.length ? alreadyOn.join(', ') : 'No one assigned yet'
            const groupTools = [...new Set(list.flatMap((t) => (t.equipment || '').split(',').map((x) => x.trim()).filter(Boolean)))]
            // Two note levels: a whole-crew note (group_note, same for everyone)
            // and each person's own note (their `notes` line).
            const groupNoteVal = (list.find((t) => (t.groupNote || '').trim()) || {}).groupNote || ''
            const anyPersonNote = list.some((t) => t.assignee && (t.notes || '').trim())
            return (
              <div key={gk} style={{ borderTop: jobIdx > 0 ? '1px solid #EDF1EE' : 'none' }}>
                {/* Job drop-down header — tap to open the box and edit it */}
                <div className="flex items-start gap-2 pl-2 pr-1 py-2" style={{ backgroundColor: open ? '#EAF2EC' : '#F6FAF7' }}>
                  <span className="shrink-0 mt-0.5 inline-flex items-center justify-center font-body text-[11px] font-extrabold rounded" style={{ width: 20, height: 20, backgroundColor: '#E4EEE7', color: FOREST }}>{jobIdx + 1}</span>
                  <button onClick={() => toggleJob(gk)} className="flex-1 min-w-0 text-left">
                    <span className="flex items-center gap-2">
                      <span className="font-body font-bold text-sm text-slate-900">{jk}</span>
                      <span className="font-body text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0" style={{ backgroundColor: '#EEF4FF', color: '#3B5BA5' }}>{alreadyOn.length}</span>
                    </span>
                    {!open && <span className="block font-body text-[12px] text-slate-500 mt-0.5 leading-snug">{crewSummary}</span>}
                  </button>
                  {manage && <button onClick={() => { setOpenJobs({ [gk]: true }); setCrewAddJob(gk) }} className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition" style={{ color: FERN }} aria-label="Add crew to this job"><UserPlus size={18} /></button>}
                  {manage && <button onClick={() => removeJobGroup(jk, s)} className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-slate-300 hover:text-red-500 transition" aria-label="Remove job"><Trash2 size={16} /></button>}
                  <button onClick={() => toggleJob(gk)} className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" aria-label={open ? 'Collapse' : 'Expand'}><ChevronRight size={18} className="text-slate-400 transition-transform" style={{ transform: open ? 'rotate(90deg)' : 'none' }} /></button>
                </div>
                {open && (manage ? (
                <div className="px-2.5 pt-2.5 pb-3 space-y-3">
                  {/* Crew — add box on top, the names you pick fill in underneath */}
                  <div>
                    <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Crew</p>
                    <MultiSelect selected={alreadyOn} options={orderedOps} onToggle={(name) => {
                      if (alreadyOn.includes(name)) { removePersonFromJob(jk, name, s); return }
                      const others = [...new Set(view.filter((t) => t.assignee === name).map((t) => t.job).filter(Boolean))]
                      if (others.length) { setConfirmAssign({ name, jk, s, others }); return }
                      addPersonToJob(jk, name, s)
                    }} hideChips autoOpen={crewAddJob === gk} dimmed={assignedToday} dimmedLabel="on a job" placeholder="Add crew — tap to check people on…" />
                    <div className="mt-1.5">
                      {list.filter((t) => t.assignee).map((t, pi) => (
                        <div key={t.id} className="flex items-center gap-2.5 py-1.5" style={{ borderTop: pi > 0 ? '1px solid #F1F4F2' : 'none' }}>
                          <span className="shrink-0 self-stretch rounded-full" style={{ width: 3, backgroundColor: FERN }} />
                          <div className="min-w-0 flex-1">
                            <p className="font-body text-[13px] font-semibold text-slate-800 truncate">{t.assignee}</p>
                          </div>
                          <button onClick={() => remove(t.id)} className="w-10 h-10 -mr-1 flex items-center justify-center text-slate-300 hover:text-red-500 transition shrink-0" aria-label="Remove"><Trash2 size={16} /></button>
                        </div>
                      ))}
                      {alreadyOn.length === 0 && <p className="font-body text-[12px] text-slate-400 py-1">No one on this job yet — tap the box above to add crew.</p>}
                    </div>
                  </div>
                  {/* Crew note — one message for everyone on the job */}
                  <div>
                    <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Crew note <span className="font-normal normal-case tracking-normal">· everyone on this job</span></p>
                    <input key={`${gk}:gn:${groupNoteVal}`} defaultValue={groupNoteVal} onBlur={(e) => { const v = e.target.value.trim(); if (v !== groupNoteVal) saveJobNote(jk, v, s) }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} placeholder="A note for the whole crew on this job…" className="w-full border border-slate-200 rounded-lg px-2.5 py-2.5 text-base font-body" />
                  </div>
                  {/* Individual notes — one per person on the job */}
                  {alreadyOn.length > 0 && (
                    <div>
                      <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Individual notes</p>
                      <div className="space-y-1.5">
                        {list.filter((t) => t.assignee).map((t) => (
                          <div key={t.id} className="flex items-center gap-2">
                            <span className="font-body text-[12px] font-semibold text-slate-600 shrink-0 truncate" style={{ width: 92 }}>{t.assignee}</span>
                            <input key={`${t.id}:in:${t.notes}`} defaultValue={t.notes} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (t.notes || '')) savePersonNote(t.id, v) }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} placeholder={`Note for ${(t.assignee || '').split(' ')[0]}…`} className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2.5 py-2 text-base font-body" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Equipment — attach the tools for this job */}
                  <div>
                    <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Equipment</p>
                    {groupTools.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-1.5">
                        {groupTools.map((tool) => (
                          <span key={tool} className="font-body text-[11px] font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5" style={{ backgroundColor: '#F1F5F3', color: '#57756A' }}>{tool}<button type="button" onClick={() => saveJobEquip(jk, groupTools.filter((x) => x !== tool), s)} className="opacity-60 hover:opacity-100">×</button></span>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <div className="flex-1 min-w-0"><Combobox value={jobEquipDraft[gk] || ''} onChange={(v) => setJobEquipDraft((p) => ({ ...p, [gk]: v }))} options={equipment} accent={FERN} placeholder="Add a tool…" /></div>
                      <button type="button" onClick={() => { const v = (jobEquipDraft[gk] || '').trim(); if (v && !groupTools.includes(v)) saveJobEquip(jk, [...groupTools, v], s); setJobEquipDraft((p) => ({ ...p, [gk]: '' })) }} disabled={!(jobEquipDraft[gk] || '').trim()} className="font-body text-sm font-bold px-3.5 rounded-xl text-white disabled:opacity-40 shrink-0" style={{ backgroundColor: FERN }}>+</button>
                    </div>
                  </div>
                </div>
                ) : (
                <div className="px-2.5 pt-2 pb-2.5">
                  {/* Crew-facing read-only view keeps the direction badge, notes, tools */}
                  {langs.map((l) => <p key={l} className="font-body text-[11px] text-slate-400 italic mb-0.5 px-1">{txGet(tx, l, jk) || jk} <span className="not-italic">· {(CREW_LANGS.find(([c]) => c === l) || [])[1] || l}</span></p>)}
                  {(() => {
                    const cn = list[0]?.course || activeCourse || ''
                    const dir = directionForJob(settings.courseInfo || {}, cn, jk, date)
                    if (!dir) return null
                    return (
                      <div className="flex items-center gap-2 mb-2 rounded-lg" style={{ backgroundColor: '#F1F7F2', border: '1px solid #D9E7DD', padding: '6px 8px' }}>
                        <MowPattern step={dir.step} size={68} kind={surfaceKind(dir.surface)} />
                        <div>
                          <p className="font-body text-[10px] uppercase tracking-wide font-bold" style={{ color: FERN }}>Direction of cut</p>
                          <p className="font-body text-[13px] font-bold" style={{ color: FOREST }}>{stepLabel(dir.step)}</p>
                        </div>
                      </div>
                    )
                  })()}
                  {groupNoteVal && (() => {
                    const noteVariants = langs.map((l) => txGet(tx, l, groupNoteVal)).filter((v) => v && v !== groupNoteVal)
                    return (
                      <div className="flex items-start gap-1.5 mb-2 rounded-lg" style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE9C8', padding: '6px 8px' }}>
                        <Info size={13} style={{ color: '#B07A16' }} className="shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="font-body text-[11px]" style={{ color: '#8A5A12' }}>{groupNoteVal}</p>
                          {noteVariants.map((v, i) => <p key={i} className="font-body text-[11px] italic" style={{ color: '#A98547' }}>{v}</p>)}
                        </div>
                      </div>
                    )
                  })()}
                  <div>
                    {list.map((t, pi) => {
                      const tools = (t.equipment || '').split(',').map((x) => x.trim()).filter(Boolean)
                      const lang = crew[t.assignee]?.lang
                      return (
                        <div key={t.id} className="flex items-center gap-2.5 py-1.5" style={{ borderTop: pi > 0 ? '1px solid #F1F4F2' : 'none' }}>
                          <span className="shrink-0 self-stretch rounded-full" style={{ width: 3, backgroundColor: FERN }} />
                          <div className="min-w-0 flex-1">
                            <p className="font-body text-[13px] font-semibold text-slate-800 truncate">{t.assignee || 'Unassigned'}</p>
                            {t.notes && <p className="font-body text-[12px] font-semibold mt-0.5" style={{ color: FERN }}>{t.notes}</p>}
                            {tools.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-0.5 items-center">
                                {tools.map((tool, i) => <span key={i} className="font-body text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#F1F5F3', color: '#57756A' }}>{txGet(tx, lang, tool) || tool}</span>)}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
                ))}
              </div>
            )
          })}
          {manage && <AddJobRow options={jobTypes} onAdd={(name) => quickAddJob(name, s)} placeholder={`Add a job to ${slotLabel(s).toLowerCase()}…`} />}
          </div>
          </div>
          )
          })}
        </div>
        )
        })()}

      <p className="font-body text-[10px] text-slate-400 mt-4 text-center">Pick a job in the “Add a job” line and it drops onto the board; tap any job to open it and set the crew, note and equipment.</p>

      {confirmAssign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ backgroundColor: 'rgba(15,23,42,0.45)' }} onClick={() => setConfirmAssign(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-5" onClick={(e) => e.stopPropagation()}>
            <p className="font-body text-sm text-slate-700 text-center leading-relaxed">
              <b>{confirmAssign.name}</b> is on {confirmAssign.others.join(', ')}. Move {confirmAssign.name} to <b>{confirmAssign.jk}</b>?
            </p>
            <p className="font-body text-[11px] text-slate-400 text-center mt-1">They'll be taken off {confirmAssign.others.length > 1 ? 'those jobs' : 'that job'}.</p>
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => setConfirmAssign(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold font-body text-slate-600 border border-slate-200">Cancel</button>
              <button type="button" onClick={() => { const c = confirmAssign; setConfirmAssign(null); movePersonToJob(c.name, c.jk, c.s) }} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body text-white" style={{ backgroundColor: FOREST }}>Move here</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Crew section — the board's own roster. Add anyone on the grounds crew here
// (Spray Ops names come in automatically), and give each a home course (so they
// sort first on that course's board) and their native language (for translation).
function WhiteboardCrew({ roster = [], operators = [], crewMembers = [], courses = [], crew = {}, manage, onSaveCrew, onSaveMembers }) {
  const [name, setName] = useState('')
  const courseNames = courses.map((c) => c.name)
  const langLabel = (code) => (CREW_LANGS.find(([c]) => c === code) || [])[1] || ''
  const setField = (person, key, value) => onSaveCrew({ ...crew, [person]: { ...(crew[person] || {}), [key]: value } })
  const addMember = () => { const v = name.trim(); if (!v) { return } if (!roster.includes(v)) onSaveMembers([...crewMembers, v]); setName('') }
  const removeMember = (v) => onSaveMembers(crewMembers.filter((x) => x !== v))

  return (
    <div className="space-y-2">
      <p className="font-body text-[12px] text-slate-500 mb-1">Your grounds crew. Spray Ops people are pulled in automatically; add everyone else here. Set each person's home course (they sort first on it) and native language.</p>
      {manage && (
        <div className="flex gap-2 mb-2">
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMember() } }} placeholder="Add a crew member…" className="flex-1 min-w-0 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
          <button type="button" onClick={addMember} disabled={!name.trim()} className="font-body text-xs font-bold px-4 rounded-xl text-white disabled:opacity-40 shrink-0" style={{ backgroundColor: FOREST }}>Add</button>
        </div>
      )}
      {roster.length === 0 ? (
        <div className="bg-white rounded-2xl border border-black/5 p-8 text-center text-slate-400 font-body text-sm">No crew yet. Add your first crew member above.</div>
      ) : roster.map((person) => {
        const isOwn = !operators.includes(person) // added here, not from Spray Ops
        return (
          <div key={person} className="bg-white rounded-2xl border border-black/5 p-3 shadow-sm flex items-center gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: '#E8F3EC' }}><User size={15} style={{ color: FERN }} /></div>
            <p className="font-body text-sm font-semibold text-slate-800 flex-1 min-w-0 truncate">{person}</p>
            {manage ? (
              <div className="flex items-center gap-2 shrink-0">
                {courseNames.length >= 2 && (
                  <div className="shrink-0" style={{ width: 140 }}>
                    <SearchSelect value={crew[person]?.course || ''} options={[{ value: '', label: 'No home course' }, ...courseNames]} onPick={(v) => setField(person, 'course', v)} sort={false} />
                  </div>
                )}
                <div className="shrink-0" style={{ width: 130 }}>
                  <SearchSelect value={crew[person]?.lang || 'en'} options={CREW_LANGS.map(([code, label]) => ({ value: code, label }))} onPick={(v) => setField(person, 'lang', v)} sort={false} />
                </div>
                {isOwn && <button type="button" onClick={() => removeMember(person)} className="text-slate-300 hover:text-red-500 transition shrink-0" aria-label="Remove"><Trash2 size={15} /></button>}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 shrink-0">
                {crew[person]?.course && <span className="font-body text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#EEF4FF', color: '#3B5BA5' }}>{crew[person].course}</span>}
                <span className="font-body text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: '#F1F5F3', color: '#57756A' }}>{langLabel(crew[person]?.lang || 'en')}</span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Time & Efficiency — the trends the Workboard feeds: how many jobs, hours
// logged, average time per job type, and workload per person over a window.
function WhiteboardInsights() {
  const [range, setRange] = useState('30')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const to = localDateISO()
      const from = shiftDate(to, -(Number(range) - 1))
      try { const t = await db.fetchCrewTasks(from, to); if (!cancelled) setRows(t) } catch (e) { console.error(e) }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [range])

  const done = rows.filter((t) => t.status === 'done').length
  const totalMin = rows.reduce((s, t) => s + (Number(t.minutes) || 0), 0)
  const hours = Math.round((totalMin / 60) * 10) / 10

  const byJob = {}
  rows.forEach((t) => { const k = t.job || '—'; const g = (byJob[k] ||= { job: k, count: 0, min: 0, minCount: 0 }); g.count++; if (Number(t.minutes) > 0) { g.min += Number(t.minutes); g.minCount++ } })
  const jobRows = Object.values(byJob).map((g) => ({ ...g, avg: g.minCount ? Math.round(g.min / g.minCount) : null })).sort((a, b) => b.count - a.count)
  const jobMax = Math.max(1, ...jobRows.map((r) => r.count))

  const byPerson = {}
  rows.forEach((t) => { const k = t.assignee || 'Unassigned'; const g = (byPerson[k] ||= { name: k, count: 0, done: 0, min: 0 }); g.count++; if (t.status === 'done') g.done++; g.min += Number(t.minutes) || 0 })
  const personRows = Object.values(byPerson).sort((a, b) => b.count - a.count)

  const tile = (label, value) => (
    <div className="bg-white rounded-2xl border border-black/5 p-3 shadow-sm text-center">
      <p className="font-display text-2xl font-bold text-slate-900 leading-none">{value}</p>
      <p className="font-body text-[10px] uppercase tracking-wide text-slate-400 mt-1">{label}</p>
    </div>
  )

  return (
    <div>
      <div className="flex gap-2 mb-4">
        {[['30', '30 days'], ['90', '90 days'], ['365', 'Season']].map(([k, l]) => (
          <button key={k} onClick={() => setRange(k)} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full transition" style={range === k ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>{l}</button>
        ))}
      </div>

      {loading ? (
        <div className="pt-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={26} /></div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-black/5 p-10 text-center text-slate-400 font-body text-sm">No jobs logged in this window yet. As the crew works the board, trends build here.</div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {tile('Jobs', rows.length)}
            {tile('Completed', done)}
            {tile('Hours logged', hours)}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <div className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm">
            <p className="font-body font-semibold text-sm text-slate-900 mb-1">Time by job</p>
            <p className="font-body text-[10px] text-slate-400 mb-3">How often each job runs, and its average time when minutes are logged.</p>
            <div className="space-y-2">
              {jobRows.map((r) => (
                <div key={r.job}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="font-body text-[12px] font-semibold text-slate-700 truncate">{r.job}</p>
                    <p className="font-body text-[11px] text-slate-500 shrink-0 tabular-nums">{r.count}× {r.avg != null ? `· ${r.avg} min avg` : ''}</p>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.max(3, Math.round((r.count / jobMax) * 100))}%`, backgroundColor: FERN }} /></div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm">
            <p className="font-body font-semibold text-sm text-slate-900 mb-3">Workload by person</p>
            <div className="space-y-2">
              {personRows.map((p) => (
                <div key={p.name} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: '#E8F3EC' }}><User size={12} style={{ color: FERN }} /></div>
                    <p className="font-body text-[13px] font-semibold text-slate-700 truncate">{p.name}</p>
                  </div>
                  <p className="font-body text-[11px] text-slate-500 shrink-0 tabular-nums">{p.count} job{p.count !== 1 ? 's' : ''} · {p.done} done{p.min > 0 ? ` · ${Math.round((p.min / 60) * 10) / 10}h` : ''}</p>
                </div>
              ))}
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  )
}

// A managed list (equipment, job types) that feeds the Workboard's quick-picks.
function WhiteboardListSection({ title, hint, items, manage, accent, onSave }) {
  return (
    <div className="space-y-2">
      <p className="font-body text-[12px] text-slate-500">{hint}</p>
      {manage ? (
        <NameListEditor title={title} items={items} accent={accent} onSave={onSave} />
      ) : (
        <div className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm">
          <p className="font-display text-base font-semibold text-slate-900 mb-2">{title}</p>
          <div className="flex flex-wrap gap-2">
            {items.length ? items.map((i) => <span key={i} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full" style={{ backgroundColor: `${accent}15`, color: accent }}>{i}</span>) : <p className="font-body text-sm text-slate-400">Nothing set yet.</p>}
          </div>
        </div>
      )}
    </div>
  )
}

function taskErrorText(e) {
  return saveErrorText(e, 'supabase/phase13.sql')
}

// ════════════════════════════════════════════════════════════════════════
//  TURF PERFORMANCE MODULE — scaffold only (features come in a later phase).
// ════════════════════════════════════════════════════════════════════════
// ── FIELD DATA HUB ──────────────────────────────────────────────────────────
// One place for everything the crew collects on morning maintenance — moisture,
// clipping yields, greens speed, scouting. This is also what the crew's no-login
// QR page mirrors. Managers get a "Crew QR" button to print/share the link.
function FieldDataHub({ clippings, speeds, scouting, daily, turf, saveTurfCourse, course = '', onClip, onClipDel, onSpeed, onSpeedDel, onScout, onScoutUpd, onScoutDel }) {
  const [tab, setTab] = useState('moisture')
  const [qrOpen, setQrOpen] = useState(false)
  const tabs = [['moisture', 'Moisture'], ['clippings', 'Clipping Yields'], ['speed', 'Greens Speed'], ['scouting', 'Scouting']]

  // The course comes from the global course bar; scope the area pickers to it.
  const cTok = (s) => String(s || '').trim().split(/\s+/)[0].toLowerCase()
  const areas = !course ? turf.areas : Object.fromEntries(Object.entries(turf.areas || {}).filter(([name]) => cTok(name) === cTok(course)))

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <div>
          <h2 className="font-display text-lg font-semibold" style={{ color: '#1b2420' }}>Field Data{course ? ` — ${course}` : ''}</h2>
          <p className="font-body text-xs" style={{ color: INK_3 }}>Everything the crew records on morning rounds — in one place.</p>
        </div>
        <button onClick={() => setQrOpen(true)} className="font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5 text-white" style={{ backgroundColor: FOREST }}>
          <QrCode size={14} /> Crew QR
        </button>
      </div>

      <div className="flex gap-1.5 mt-4 mb-4 flex-wrap">
        {tabs.map(([k, lab]) => (
          <button key={k} onClick={() => setTab(k)} className="font-body text-sm font-bold px-4 py-2 rounded-full transition"
            style={tab === k ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: INK_2, border: `1px solid ${HAIR}` }}>{lab}</button>
        ))}
      </div>

      {tab === 'moisture' && <WettingAgent key={course || 'all'} daily={daily} areas={areas} courseInfo={turf.courseInfo} location={turf.location} onSaveCourse={saveTurfCourse} initialView="read" courseFilter={course} />}
      {tab === 'clippings' && <ClippingsTab key={course || 'all'} clippings={clippings} areas={areas} courseInfo={turf.courseInfo} onAddMany={onClip} onDelete={onClipDel} />}
      {tab === 'speed' && <GreensSpeedTab key={course || 'all'} speeds={speeds} courseInfo={turf.courseInfo} onAddMany={onSpeed} onDelete={onSpeedDel} />}
      {tab === 'scouting' && <ScoutingTab key={course || 'all'} scouting={scouting} areas={areas} courseInfo={turf.courseInfo} onAdd={onScout} onUpdate={onScoutUpd} onDelete={onScoutDel} />}

      {qrOpen && <DataQRModal courseInfo={turf.courseInfo} saveCourse={saveTurfCourse} onClose={() => setQrOpen(false)} />}
    </div>
  )
}

function TurfPerformanceModule({ user, nav, hideChrome, course = '' }) {
  const [route, setRoute] = useState(nav?.route || 'dashboard')
  useEffect(() => { if (nav?.route) setRoute(nav.route) }, [nav])
  // Scope the areas passed to each tab to the selected course (by first-word
  // match), so the course bar filters what the agronomy screens show and enter.
  const cTok = (s) => String(s || '').trim().split(/\s+/)[0].toLowerCase()
  const scopeAreas = (areas) => (!course ? areas : Object.fromEntries(Object.entries(areas || {}).filter(([n]) => cTok(n) === cTok(course))))
  const [turf, setTurf] = useState({ location: null, sheets: [], products: [], areas: {} })
  const [daily, setDaily] = useState([])
  const [clippings, setClippings] = useState([])
  const [practices, setPractices] = useState([])
  const [soilTests, setSoilTests] = useState([])
  const [speeds, setSpeeds] = useState([])
  const [scouting, setScouting] = useState([])
  const [soilSeries, setSoilSeries] = useState([])
  const [loadingTurf, setLoadingTurf] = useState(true)

  useEffect(() => {
    (async () => {
      setLoadingTurf(true)
      try {
        const [settings, sheets, products, clips, pracs, soils, spds, scts] = await Promise.all([db.fetchSettings(), db.fetchSheets(), db.fetchProducts(), db.fetchClippings().catch(() => []), db.fetchCulturalPractices().catch(() => []), db.fetchSoilTests().catch(() => []), db.fetchGreensSpeeds().catch(() => []), db.fetchScouting().catch(() => [])])
        // Prefer the grasses actually on site (from onboarding) for the pickers;
        // fall back to the full library when the club hasn't selected any yet.
        const siteGrasses = settings.courseInfo?.siteGrasses || []
        const grassChoices = siteGrasses.length ? siteGrasses : (settings.grassTypes || [])
        setTurf({ location: settings.location, sheets, products, areas: settings.areas, grassTypes: grassChoices, soilTypes: settings.soilTypes || [], courseInfo: settings.courseInfo || {} })
        setClippings(clips)
        setPractices(pracs)
        setSoilTests(soils)
        setSpeeds(spds)
        setScouting(scts)
        if (settings.location?.lat != null) {
          const { lat, lng } = settings.location
          // Season archive + forecast merged: the archive lags a few days and has
          // no future, so we patch it with the forecast (recent + next ~14 days).
          // That keeps season GDD current and lets Growth-Reg project a reapply date.
          try {
            const wxData = await fetchWeather(lat, lng)
            let season = []
            try { season = await fetchSeasonDaily(lat, lng) } catch { /* ignore */ }
            setDaily(mergeDaily(season, dailyFromForecastBlock(wxData)))
          } catch { try { setDaily(await fetchSeasonDaily(lat, lng)) } catch (e) { console.error(e) } }
          try { setSoilSeries(await fetchBreakdownTemps(lat, lng)) } catch (e) { console.error(e) }
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
  async function reloadSpeeds() {
    try { setSpeeds(await db.fetchGreensSpeeds()) } catch (e) { console.error(e) }
  }
  async function reloadScouting() {
    try { setScouting(await db.fetchScouting()) } catch (e) { console.error(e) }
  }
  // Save a patch onto courseInfo (e.g. tuned PGR curve targets) and persist.
  async function saveTurfCourse(patch) {
    const next = { ...(turf.courseInfo || {}), ...patch }
    setTurf((t) => ({ ...t, courseInfo: next }))
    try { await db.saveSettings({ courseInfo: next }) } catch (e) { console.error(e) }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: CREAM }}>
      {!hideChrome && (
        <div style={{ backgroundColor: FOREST }} className="text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-5 pb-4">
            <div className="mb-4">
              <p className="font-display text-[10px] tracking-[0.25em] uppercase" style={{ color: GOLD }}>{turf.courseInfo?.clubName || 'Golf Club'}</p>
              <h1 className="font-display text-2xl font-semibold mt-0.5">Turf Performance</h1>
            </div>
            <div className="flex gap-1 font-body text-sm overflow-x-auto">
              {[['dashboard', 'Dashboard'], ['report', 'Weekly Report'], ['gdd', 'Growing Degree Days'], ['timing', 'Timing'], ['soil', 'Soil Tests'], ['clippings', 'Clipping Yields'], ['practices', 'Practices'], ['speed', 'Greens Speed'], ['hoc', 'Height of Cut'], ['scouting', 'Scouting'], ['knowledge', 'Reference']].map(([key, label]) => (
                <button key={key} onClick={() => setRoute(key)} className="px-3.5 py-1.5 rounded-full font-medium transition whitespace-nowrap" style={route === key ? { backgroundColor: 'rgba(255,255,255,0.12)', color: 'white' } : { color: 'rgba(255,255,255,0.5)' }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-24 pt-6">
        {route === 'dashboard' && (
          loadingTurf ? <div className="pt-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={26} /></div>
          : <TurfDashboard daily={daily} sheets={turf.sheets} products={turf.products} areas={turf.areas} clippings={clippings} soilTests={soilTests} practices={practices} speeds={speeds} hasLocation={turf.location?.lat != null} onGo={setRoute} />
        )}
        {route === 'knowledge' && <KnowledgeTab courseInfo={turf.courseInfo} products={turf.products} />}
        {route === 'report' && (
          loadingTurf ? <div className="pt-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={26} /></div>
          : <WeeklyReport daily={daily} clippings={clippings} practices={practices} speeds={speeds} areas={turf.areas} courseInfo={turf.courseInfo} onSaveCourse={saveTurfCourse} userEmail={user?.email} userName={user?.fullName} courseFilter={course} />
        )}
        {route === 'hoc' && (
          loadingTurf ? <div className="pt-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={26} /></div>
          : <div className="max-w-3xl">
              <h2 className="font-display text-lg font-semibold text-slate-900 mb-1">Height of Cut</h2>
              <p className="font-body text-xs text-slate-400 mb-3">Your maintained height of cut per surface. Edited here or on the Weekly Report — both stay in sync.</p>
              <HocEditor courseInfo={turf.courseInfo} areas={scopeAreas(turf.areas)} practices={practices} onSaveCourse={saveTurfCourse} />
            </div>
        )}
        {route === 'gdd' && (
          loadingTurf ? <div className="pt-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={26} /></div>
          : <GddPgrTab daily={daily} sheets={turf.sheets} products={turf.products} areas={scopeAreas(turf.areas)} hasLocation={turf.location?.lat != null} courseInfo={turf.courseInfo} onSaveTargets={(pgrTargets) => saveTurfCourse({ pgrTargets })} />
        )}
        {route === 'wetting' && (
          loadingTurf ? <div className="pt-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={26} /></div>
          : <WettingAgent daily={daily} areas={scopeAreas(turf.areas)} courseInfo={turf.courseInfo} location={turf.location} onSaveCourse={saveTurfCourse} courseFilter={course} />
        )}
        {route === 'growth' && (
          loadingTurf ? <div className="pt-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={26} /></div>
          : <Growth daily={daily} clippings={clippings} sheets={turf.sheets} products={turf.products} areas={turf.areas} courseInfo={turf.courseInfo} onSaveCourse={saveTurfCourse} courseFilter={course} />
        )}
        {route === 'data' && (
          loadingTurf ? <div className="pt-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={26} /></div>
          : <FieldDataHub
              clippings={clippings} speeds={speeds} scouting={scouting} daily={daily} turf={turf} saveTurfCourse={saveTurfCourse} course={course}
              onClip={async (list) => { await db.addClippings(list); await reloadClippings() }}
              onClipDel={async (id) => { await db.deleteClipping(id); await reloadClippings() }}
              onSpeed={async (list) => { await db.addGreensSpeeds(list); await reloadSpeeds() }}
              onSpeedDel={async (id) => { await db.deleteGreensSpeed(id); await reloadSpeeds() }}
              onScout={async (s) => { await db.addScouting(s); await reloadScouting() }}
              onScoutUpd={async (id, patch) => { await db.updateScouting(id, patch); await reloadScouting() }}
              onScoutDel={async (id) => { await db.deleteScouting(id); await reloadScouting() }}
            />
        )}
        {route === 'clippings' && (
          loadingTurf ? <div className="pt-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={26} /></div>
          : <ClippingsTab clippings={clippings} areas={turf.areas} courseInfo={turf.courseInfo}
              onAddMany={async (list) => { await db.addClippings(list); await reloadClippings() }}
              onDelete={async (id) => { await db.deleteClipping(id); await reloadClippings() }} />
        )}
        {route === 'timing' && (
          loadingTurf ? <div className="pt-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={26} /></div>
          : <TimingTab soilSeries={soilSeries} hasLocation={turf.location?.lat != null} products={turf.products} />
        )}
        {route === 'soil' && (
          loadingTurf ? <div className="pt-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={26} /></div>
          : <SoilTestsTab soilTests={soilTests} areas={scopeAreas(turf.areas)} grassTypes={turf.grassTypes || []} soilTypes={turf.soilTypes || []} courseInfo={turf.courseInfo}
              onAdd={async (t) => { await db.addSoilTest(t); await reloadSoilTests() }}
              onUpdate={async (t) => { await db.updateSoilTest(t); await reloadSoilTests() }}
              onDelete={async (id) => { await db.deleteSoilTest(id); await reloadSoilTests() }} />
        )}
        {route === 'practices' && (
          loadingTurf ? <div className="pt-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={26} /></div>
          : <PracticesTab practices={practices} areas={scopeAreas(turf.areas)}
              onAddMany={async (list) => { await db.addCulturalPractices(list); await reloadPractices() }}
              onDelete={async (id) => { await db.deleteCulturalPractice(id); await reloadPractices() }} />
        )}
        {route === 'speed' && (
          loadingTurf ? <div className="pt-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={26} /></div>
          : <GreensSpeedTab speeds={speeds} courseInfo={turf.courseInfo}
              onAddMany={async (list) => { await db.addGreensSpeeds(list); await reloadSpeeds() }}
              onDelete={async (id) => { await db.deleteGreensSpeed(id); await reloadSpeeds() }} />
        )}
        {route === 'scouting' && (
          loadingTurf ? <div className="pt-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={26} /></div>
          : <ScoutingTab scouting={scouting} areas={turf.areas} courseInfo={turf.courseInfo}
              onAdd={async (s) => { await db.addScouting(s); await reloadScouting() }}
              onUpdate={async (id, patch) => { await db.updateScouting(id, patch); await reloadScouting() }}
              onDelete={async (id) => { await db.deleteScouting(id); await reloadScouting() }} />
        )}
      </div>
    </div>
  )
}

// ── SCOUTING LOG ────────────────────────────────────────────────────────────
// Snap and tag what you find on the course — disease, weeds, insects, wear —
// with a photo, area, date and notes. Builds a searchable scouting history.
const SCOUT_KINDS = ['Disease', 'Weed', 'Insect', 'Wear', 'Nutrient', 'Other']
const SCOUT_KIND_STYLE = {
  Disease: { bg: '#FDE7E4', fg: '#B23A2E' }, Weed: { bg: '#E4EFE5', fg: '#2E7D46' },
  Insect: { bg: '#FEF3DD', fg: '#92660D' }, Wear: { bg: '#EEF2F7', fg: '#475569' },
  Nutrient: { bg: '#E8EEF6', fg: '#3A6187' }, Other: { bg: '#F1F5F9', fg: '#64748B' },
}
// Downscale/compress a picked image file to a data URL (shared by add + edit).
function compressScoutPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new window.Image()
      img.onload = () => {
        const scale = Math.min(1, 1400 / img.width)
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

function ScoutingTab({ scouting = [], areas = {}, courseInfo = {}, onAdd, onUpdate, onDelete }) {
  const areaKeys = Object.keys(areas)
  const [form, setForm] = useState({ area: areaKeys[0] || '', date: localDateISO(), kind: 'Disease', target: '', severity: '', notes: '', photo: '' })
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('All')
  const [selected, setSelected] = useState(null) // observation open in the detail/edit modal
  const fileRef = useRef(null)

  const pickPhoto = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try { const url = await compressScoutPhoto(file); setForm((f) => ({ ...f, photo: url })) } catch (err) { console.error(err) }
  }

  const save = async () => {
    if (!form.area && areaKeys.length) { /* allow blank if no areas */ }
    setBusy(true)
    try { await onAdd(form); setForm({ area: form.area, date: localDateISO(), kind: form.kind, target: '', severity: '', notes: '', photo: '' }) }
    catch (e) { console.error(e) }
    setBusy(false)
  }

  const list = filter === 'All' ? scouting : scouting.filter((s) => s.kind === filter)

  return (
    <div className="pt-2 pb-10">
      <SectionHeader title="Scouting" subtitle="Photo-log what you find — disease, weeds, insects, wear — by area and date" />

      <Card className="mt-2">
        <p className="font-display text-base font-semibold text-slate-900 mb-3">Log an observation</p>
        <div className="grid grid-cols-2 gap-3">
          <div><FieldLabel>Area</FieldLabel><Select value={form.area} onChange={(v) => setForm({ ...form, area: v })} options={areaKeys} placeholder="Area…" /></div>
          <div><FieldLabel>Date</FieldLabel><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base font-body bg-white" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div><FieldLabel>Type</FieldLabel><SearchSelect value={form.kind} options={SCOUT_KINDS} onPick={(v) => setForm({ ...form, kind: v })} sort={false} /></div>
          <div><FieldLabel>Severity</FieldLabel><SearchSelect value={form.severity} options={['', 'Low', 'Moderate', 'High']} onPick={(v) => setForm({ ...form, severity: v })} sort={false} /></div>
        </div>
        <div className="mt-3"><FieldLabel>What is it? (e.g. Dollar Spot, Poa Annua)</FieldLabel><input value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base font-body bg-white" /></div>
        <div className="mt-3"><FieldLabel>Notes</FieldLabel><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base font-body bg-white" style={{ resize: 'vertical' }} /></div>
        <input ref={fileRef} type="file" accept="image/*" onChange={pickPhoto} className="hidden" />
        <div className="mt-3 flex items-center gap-3">
          {form.photo ? (
            <div className="relative">
              <img src={form.photo} alt="" className="w-20 h-20 rounded-lg object-cover border border-slate-200" />
              <button onClick={() => setForm({ ...form, photo: '' })} className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-slate-200 shadow flex items-center justify-center text-red-500"><X size={13} /></button>
            </div>
          ) : (
            <button onClick={() => fileRef.current?.click()} className="font-body text-xs font-bold px-3.5 py-2.5 rounded-xl border flex items-center gap-1.5" style={{ color: FERN, borderColor: '#E2E8F0' }}><ImageIcon size={14} /> Add photo</button>
          )}
          <button onClick={save} disabled={busy} className="ml-auto font-body text-sm font-bold px-5 py-2.5 rounded-full text-white disabled:opacity-50" style={{ backgroundColor: FOREST }}>{busy ? 'Saving…' : 'Log it'}</button>
        </div>
      </Card>

      <div className="flex gap-1.5 overflow-x-auto pb-1 mt-4">
        {['All', ...SCOUT_KINDS].map((k) => (
          <button key={k} onClick={() => setFilter(k)} className="font-body text-[11px] font-bold px-3 py-1.5 rounded-full whitespace-nowrap transition" style={filter === k ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid #E2E8F0' }}>{k}</button>
        ))}
      </div>

      {list.length === 0 ? (
        <Card><p className="font-body text-sm text-slate-400 text-center py-8">No observations yet. Snap a photo of anything you spot on the course.</p></Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {list.map((s) => {
            const st = SCOUT_KIND_STYLE[s.kind] || SCOUT_KIND_STYLE.Other
            return (
              <button key={s.id} onClick={() => setSelected(s)} className="text-left bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden hover:shadow-md transition">
                {s.photo && <img src={s.photo} alt="" className="w-full h-44 object-cover" />}
                <div className="p-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-body text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: st.bg, color: st.fg }}>{s.kind}</span>
                    {s.target && <span className="font-body text-sm font-bold text-slate-900">{s.target}</span>}
                    {s.severity && <span className="font-body text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#F1F5F9', color: '#64748B' }}>{s.severity}</span>}
                    <span className="ml-auto font-body text-[11px] font-bold shrink-0" style={{ color: FERN }}>Open ›</span>
                  </div>
                  <p className="font-body text-[11px] text-slate-400 mt-1">{[s.area, fmtDate(s.date)].filter(Boolean).join(' · ')}</p>
                  {s.notes && <p className="font-body text-[13px] text-slate-600 mt-1.5 whitespace-pre-wrap line-clamp-2">{s.notes}</p>}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {selected && (
        <ScoutingDetail obs={selected} areaKeys={areaKeys} onClose={() => setSelected(null)}
          onSave={async (patch) => { await onUpdate(selected.id, patch); setSelected((cur) => cur ? { ...cur, ...patch } : cur) }}
          onDelete={async () => { await onDelete(selected.id); setSelected(null) }} />
      )}
    </div>
  )
}

// Detail / edit view for one scouting observation — big photo, all fields
// editable, replace/remove the photo, or delete the observation.
function ScoutingDetail({ obs, areaKeys = [], onClose, onSave, onDelete }) {
  const [d, setD] = useState(obs)
  const [dirty, setDirty] = useState(false)
  // The photo is a big base64 string; only re-send it when it actually changed,
  // so editing just the notes doesn't re-upload a 1-2 MB image every time.
  const [photoDirty, setPhotoDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [zoom, setZoom] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const fileRef = useRef(null)
  const set = (patch) => { setD((p) => ({ ...p, ...patch })); setDirty(true) }
  const setPhoto = (url) => { set({ photo: url }); setPhotoDirty(true) }
  const replacePhoto = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    try { const url = await compressScoutPhoto(file); setPhoto(url) } catch (err) { console.error(err) }
  }
  const save = async () => {
    setSaving(true)
    try {
      const patch = { area: d.area, date: d.date, kind: d.kind, target: d.target, severity: d.severity, notes: d.notes }
      if (photoDirty) patch.photo = d.photo
      await onSave(patch)
      setDirty(false); setPhotoDirty(false)
    } catch (e) { console.error(e) }
    setSaving(false)
  }
  const inp = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-base font-body bg-white'

  return (
    <div className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center p-3 sm:p-4" style={{ backgroundColor: 'rgba(26,26,22,0.5)' }} onClick={onClose}>
      <div className="bg-white rounded-2xl w-full sm:max-w-2xl shadow-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 sticky top-0 bg-white z-10" style={{ borderBottom: '1px solid #EEF0EC' }}>
          <p className="font-display text-base font-bold" style={{ color: FOREST }}>Observation</p>
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={!dirty || saving} className="font-body text-xs font-bold px-3.5 py-1.5 rounded-full text-white flex items-center gap-1.5 disabled:opacity-40" style={{ backgroundColor: FOREST }}>{saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save</button>
            <button onClick={onClose} className="text-slate-400"><X size={18} /></button>
          </div>
        </div>
        <div className="p-4">
          {d.photo ? (
            <div className="relative mb-3">
              <img src={d.photo} alt="" onClick={() => setZoom(true)} className="w-full max-h-[46vh] object-contain rounded-xl bg-slate-50 cursor-zoom-in" />
              <div className="absolute top-2 right-2 flex gap-1.5">
                <button onClick={() => fileRef.current?.click()} className="font-body text-[11px] font-bold px-2.5 py-1 rounded-full bg-white/90 shadow" style={{ color: FOREST }}>Replace</button>
                <button onClick={() => setPhoto('')} className="font-body text-[11px] font-bold px-2.5 py-1 rounded-full bg-white/90 shadow text-red-500">Remove</button>
              </div>
              <p className="font-body text-[10px] text-slate-400 mt-1 text-center">Tap the photo to zoom in</p>
            </div>
          ) : (
            <button onClick={() => fileRef.current?.click()} className="w-full mb-3 py-8 rounded-xl border-2 border-dashed flex flex-col items-center gap-2" style={{ borderColor: '#E2E8F0', color: FERN }}><ImageIcon size={22} /> <span className="font-body text-sm font-bold">Add a photo</span></button>
          )}
          <input ref={fileRef} type="file" accept="image/*" onChange={replacePhoto} className="hidden" />

          <div className="grid grid-cols-2 gap-3">
            <div><FieldLabel>Area</FieldLabel><Select value={d.area} onChange={(v) => set({ area: v })} options={areaKeys} placeholder="Area…" /></div>
            <div><FieldLabel>Date</FieldLabel><input type="date" value={d.date || ''} onChange={(e) => set({ date: e.target.value })} className={inp} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div><FieldLabel>Type</FieldLabel><SearchSelect value={d.kind} options={SCOUT_KINDS} onPick={(v) => set({ kind: v })} sort={false} /></div>
            <div><FieldLabel>Severity</FieldLabel><SearchSelect value={d.severity} options={['', 'Low', 'Moderate', 'High']} onPick={(v) => set({ severity: v })} sort={false} /></div>
          </div>
          <div className="mt-3"><FieldLabel>What is it?</FieldLabel><input value={d.target} onChange={(e) => set({ target: e.target.value })} className={inp} placeholder="e.g. Dollar Spot" /></div>
          <div className="mt-3"><FieldLabel>Notes</FieldLabel><textarea value={d.notes} onChange={(e) => set({ notes: e.target.value })} rows={4} className={inp} style={{ resize: 'vertical' }} placeholder="Add detail — what you saw, conditions, what you did…" /></div>

          <div className="mt-4 flex items-center">
            {!confirmDel ? (
              <button onClick={() => setConfirmDel(true)} className="font-body text-xs font-bold px-3 py-2 rounded-full flex items-center gap-1.5" style={{ color: '#B91C1C', border: '1px solid #F3C6C6' }}><Trash2 size={13} /> Delete</button>
            ) : (
              <div className="flex items-center gap-2"><span className="font-body text-[12px] text-slate-500">Delete this observation?</span><button onClick={onDelete} className="font-body text-xs font-bold px-3 py-2 rounded-full text-white" style={{ backgroundColor: '#DC2626' }}>Yes, delete</button><button onClick={() => setConfirmDel(false)} className="font-body text-xs font-bold px-3 py-2 rounded-full text-slate-500 border border-slate-200">Keep</button></div>
            )}
            {dirty && <span className="ml-auto font-body text-[11px] text-amber-600">Unsaved changes</span>}
          </div>
        </div>
      </div>
      {zoom && d.photo && (
        // stopPropagation so tapping to zoom back out doesn't bubble to the
        // outer backdrop's onClose and exit the whole observation.
        <div className="fixed inset-0 z-[1100] flex items-center justify-center p-2 bg-black/90" onClick={(e) => { e.stopPropagation(); setZoom(false) }}>
          <img src={d.photo} alt="" className="max-w-full max-h-full object-contain" />
          <button onClick={(e) => { e.stopPropagation(); setZoom(false) }} className="absolute top-4 right-4 text-white/80"><X size={26} /></button>
        </div>
      )}
    </div>
  )
}

// ── GDD + GROWTH-REG TRACKER ────────────────────────────────────────────────
// ── Knowledge Center ─────────────────────────────────────────────────────────
// Reference library: turf disease/weed/insect profiles + the essential plant
// nutrients. Profiles share ids with the risk models so they can cross-link.
const KIND_STYLE = {
  Grass: { bg: '#E4EFE5', fg: '#2E7D46' },
  Disease: { bg: '#FDE7E4', fg: '#B23A2E' },
  Weed: { bg: '#FCEFD2', fg: '#9A6B12' },
  Insect: { bg: '#EDE6FA', fg: '#6D4AC2' },
}
// Field labels read differently for a grass than for a pest.
const KIND_LABELS = {
  Grass: { favoredBy: 'Adaptation & climate', identify: 'How to identify', manage: 'Management & culture' },
  _default: { favoredBy: 'Favored by', identify: 'How to identify', manage: 'How to manage' },
}
const TIER_STYLE = {
  Primary: { bg: '#E4EFE5', fg: FERN },
  Secondary: { bg: '#EAF1F6', fg: '#2B6C8F' },
  Micro: { bg: '#F1EEE6', fg: '#8A7A4C' },
}
function KnowledgeTab({ courseInfo, products = [] }) {
  const [sub, setSub] = useState('pests') // 'pests' | 'nutrients'
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('All')
  const [openId, setOpenId] = useState(null)
  const [fungAll, setFungAll] = useState(false)
  const [ownedOnly, setOwnedOnly] = useState(false)
  const openProfile = (id) => { setFungAll(false); setOwnedOnly(false); setOpenId(id) }
  const club = (courseInfo?.siteGrasses || []).map((g) => String(g).toLowerCase())
  const applies = (grasses) => !club.length || grasses.includes('any') || grasses.some((tok) => club.some((g) => g.includes(tok)))
  const term = q.trim().toLowerCase()

  const pests = PROFILES
    .filter((p) => kind === 'All' || p.kind === kind)
    .filter((p) => !term || `${p.name} ${p.pathogen} ${p.blurb}`.toLowerCase().includes(term))
  const nutrients = NUTRIENTS.filter((n) => !term || `${n.name} ${n.sym} ${n.role}`.toLowerCase().includes(term))

  return (
    <div className="space-y-4">
      <div>
        <p className="font-display text-lg font-semibold text-slate-900">Reference</p>
        <p className="font-body text-[11px] text-slate-400">Turfgrass, disease, weed &amp; insect profiles and the essential plant nutrients — what it is, what favors it, and what to do.</p>
      </div>

      <div className="flex gap-2">
        {[['pests', 'Diseases & Pests'], ['nutrients', 'Nutrients']].map(([k, label]) => (
          <button key={k} onClick={() => { setSub(k); setOpenId(null); setQ('') }} className="font-body text-xs font-bold px-3.5 py-2 rounded-full transition" style={sub === k ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>{label}</button>
        ))}
      </div>

      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={sub === 'pests' ? 'Search grasses, diseases, weeds, insects…' : 'Search nutrients…'} className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-sm font-body" />
      </div>

      {sub === 'pests' ? (
        <>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {['All', 'Grass', 'Disease', 'Weed', 'Insect'].map((k) => (
              <button key={k} onClick={() => setKind(k)} className="font-body text-[11px] font-bold px-3 py-1.5 rounded-full whitespace-nowrap transition" style={kind === k ? { backgroundColor: FERN, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>{k === 'All' ? 'All' : k === 'Grass' ? 'Grasses' : `${k}s`}</button>
            ))}
          </div>
          <div className="space-y-2.5">
            {pests.map((p) => {
              const open = openId === p.id
              const ks = KIND_STYLE[p.kind] || KIND_STYLE.Disease
              const relevant = applies(p.grasses)
              return (
                <div key={p.id} className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden" style={{ opacity: relevant ? 1 : 0.62 }}>
                  <button onClick={() => (open ? setOpenId(null) : openProfile(p.id))} className="w-full text-left p-4">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-display text-base font-semibold text-slate-900">{p.name}</span>
                      <span className="font-body text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ backgroundColor: ks.bg, color: ks.fg }}>{p.kind}</span>
                    </div>
                    <p className="font-body text-[12px] text-slate-500">{p.blurb}</p>
                    {!relevant && <p className="font-body text-[10px] text-slate-400 mt-1">Not your turf types</p>}
                  </button>
                  {open && (
                    <div className="px-4 pb-4 -mt-1 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-body text-[11px] italic text-slate-400 min-w-0 truncate">{p.pathogen}</p>
                        <a href={photoSearchUrl(p)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="font-body text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0 flex items-center gap-1" style={{ backgroundColor: '#EFF6FF', color: '#2563EB' }}>
                          <ImageIcon size={12} /> See photos ↗
                        </a>
                      </div>
                      {(() => { const kl = KIND_LABELS[p.kind] || KIND_LABELS._default; return (<>
                        <Kv label={kl.favoredBy} value={p.favoredBy} />
                        <Kv label={kl.identify} value={p.identify} />
                        <Kv label={kl.manage} value={p.manage} accent />
                      </>) })()}
                      {(() => {
                        const src = ratingsSourceFor(p.id)
                        if (!src) return null
                        const all = fungicidesFor(p.id, src).map((f) => ({ ...f, owned: ownedMatch(f, products) }))
                        const ownedCount = all.filter((f) => f.owned).length
                        const list = ownedOnly ? all.filter((f) => f.owned) : all
                        const shown = fungAll ? list : list.slice(0, 6)
                        return (
                          <div className="rounded-xl p-2.5" style={{ backgroundColor: '#F5F3FB' }}>
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <p className="font-body text-[10px] font-bold uppercase tracking-wide" style={{ color: '#6D4AC2' }}>Rated fungicides · {src === 'Rutgers' ? 'Rutgers PPA-1 (pro)' : 'NC State (home lawn)'}</p>
                              {ownedCount > 0 && (
                                <button onClick={(e) => { e.stopPropagation(); setOwnedOnly((v) => !v) }} className="font-body text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={ownedOnly ? { backgroundColor: '#2E7D46', color: 'white' } : { backgroundColor: '#DDEEDF', color: '#2E7D46' }}>{ownedOnly ? 'Showing yours' : `You have ${ownedCount}`}</button>
                              )}
                            </div>
                            <div className="space-y-1.5">
                              {shown.map((f, i) => {
                                const sc = f.score >= 3.5 ? { bg: '#DDEEDF', fg: '#2E7D46' } : f.score >= 2.5 ? { bg: '#FBF0D5', fg: '#9A6B12' } : { bg: '#EEF1F4', fg: '#64748B' }
                                return (
                                  <div key={i} className="flex items-center gap-2">
                                    <span className="font-body text-[11px] font-bold rounded px-1.5 py-0.5 shrink-0 w-9 text-center" style={{ backgroundColor: sc.bg, color: sc.fg }}>{f.rating}</span>
                                    <div className="min-w-0 flex-1">
                                      <p className="font-body text-[12px] font-semibold text-slate-800 truncate">{f.trade || f.ai}{f.owned && <span className="font-body text-[10px] font-bold ml-1.5" style={{ color: '#2E7D46' }}>✓ in library</span>}</p>
                                      <p className="font-body text-[10px] text-slate-400 truncate">{f.ai}{f.frac ? ` · FRAC ${f.frac}` : ''}{f.interval ? ` · every ${f.interval} d` : ''}</p>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                            {list.length > 6 && (
                              <button onClick={(e) => { e.stopPropagation(); setFungAll((v) => !v) }} className="font-body text-[11px] font-bold mt-2" style={{ color: '#6D4AC2' }}>{fungAll ? 'Show fewer' : `Show all ${list.length}`}</button>
                            )}
                            <p className="font-body text-[10px] text-slate-400 mt-2">{src === 'Rutgers' ? 'Scale 1–4 (4 best), L = limited data. ' : 'Scale ++++ (best) to +. '}Rotate FRAC codes to prevent resistance. Always follow the label.</p>
                          </div>
                        )
                      })()}
                    </div>
                  )}
                </div>
              )
            })}
            {pests.length === 0 && <p className="font-body text-sm text-slate-400 text-center py-6">No matches.</p>}
          </div>
        </>
      ) : (
        <div className="space-y-2.5">
          {['Primary', 'Secondary', 'Micro'].map((tier) => {
            const list = nutrients.filter((n) => n.tier === tier)
            if (list.length === 0) return null
            return (
              <div key={tier}>
                <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5 mt-1">{tier === 'Micro' ? 'Micronutrients' : tier === 'Primary' ? 'Primary macronutrients' : 'Secondary macronutrients'}</p>
                <div className="space-y-2">
                  {list.map((n) => {
                    const open = openId === n.sym
                    const ts = TIER_STYLE[n.tier]
                    return (
                      <div key={n.sym} className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
                        <button onClick={() => setOpenId(open ? null : n.sym)} className="w-full text-left p-3.5 flex items-center gap-3">
                          <span className="w-9 h-9 rounded-xl flex items-center justify-center font-display font-bold shrink-0" style={{ backgroundColor: ts.bg, color: ts.fg }}>{n.sym}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-body text-sm font-semibold text-slate-900">{n.name}</span>
                              <span className="font-body text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#F1F5F9', color: '#64748B' }}>{n.mobile ? 'mobile' : 'immobile'}</span>
                            </div>
                            <p className="font-body text-[11px] text-slate-500 truncate">{n.role}</p>
                          </div>
                        </button>
                        {open && (
                          <div className="px-3.5 pb-3.5 space-y-2.5">
                            <Kv label="What it does" value={n.role} />
                            <Kv label="Deficiency signs" value={n.deficiency} />
                            <Kv label="Common sources" value={n.sources} accent />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <p className="font-body text-[10px] text-slate-400">General agronomic reference — always follow the product label and your local extension recommendations.</p>
    </div>
  )
}
function Kv({ label, value, accent }) {
  return (
    <div className="rounded-xl p-2.5" style={{ backgroundColor: accent ? '#F0F6F2' : '#F8FAFC' }}>
      <p className="font-body text-[10px] font-bold uppercase tracking-wide mb-0.5" style={{ color: accent ? FERN : '#94A3B8' }}>{label}</p>
      <p className="font-body text-[12px] text-slate-700 leading-relaxed">{value}</p>
    </div>
  )
}

// Season GDD, plus GDD accumulated since each area's last growth-regulator
// application (base 32°F) against a reapply target — the Primo/Anuew model.
function GddPgrTab({ daily, sheets, products, areas, hasLocation, courseInfo = {}, onSaveTargets }) {
  const pgrTargets = courseInfo.pgrTargets || {}
  const [editTargets, setEditTargets] = useState(false)
  // The classic Primo model: 200 GDD, base 0°C. Temps are °F, so we accumulate
  // base 32°F and convert to °C (÷1.8) for display against this 200 target.
  const [target, setTarget] = useState(200)

  if (!hasLocation) {
    return <ComingSoonCard title="Set your location first" desc="Growing Degree Days come from your course location. Add your address in Spray Ops → Settings → Location, then come back." />
  }

  const gddSeries = gddFromDaily(daily)
  const seasonGdd = gddSeries.length ? gddSeries[gddSeries.length - 1].acc : 0

  // Both PGRs and DMI (FRAC 3) fungicides suppress growth, so either resets the
  // clock — but only for areas actually running a PGR program (a DMI on the rough
  // shouldn't create a growth-reg task there).
  const supMap = suppressionMap(products)
  const lastByArea = {}
  const areaHasPGR = {}
  ;(sheets || [])
    .filter((s) => sheetApplied(s) && s.date)
    .forEach((s) => {
      const sup = (s.products || []).filter((p) => supMap[p.product])
      if (sup.length === 0) return
      if (sup.some((p) => supMap[p.product] === 'pgr')) areaHasPGR[s.area] = true
      const dmiOnly = sup.every((p) => supMap[p.product] === 'dmi')
      if (!lastByArea[s.area] || s.date > lastByArea[s.area].date) lastByArea[s.area] = { date: s.date, products: sup.map((p) => p.product), dmiOnly }
    })
  Object.keys(lastByArea).forEach((a) => { if (!areaHasPGR[a]) delete lastByArea[a] })

  // For the curve model, track the LAST date EACH regulating product hit EACH
  // area — so a DMI and a PGR sprayed on different days each ride their own
  // curve, instead of the most recent spray hiding the earlier one.
  const regProdByArea = {} // { area: { productName: lastDate } }
  ;(sheets || []).filter((s) => sheetApplied(s) && s.date).forEach((s) => {
    ;(s.products || []).forEach((p) => {
      if (!supMap[p.product]) return
      const a = regProdByArea[s.area] = regProdByArea[s.area] || {}
      if (!a[p.product] || s.date > a[p.product]) a[p.product] = s.date
    })
  })

  const todayIso = localDateISO()
  const areaRows = Object.keys(areas).map((area) => {
    const last = lastByArea[area]
    const gddF = last ? gddSince(daily, last.date, 32) : null
    const gdd = gddF == null ? null : Math.round(gddF / 1.8) // °F-GDD → °C-GDD
    const pct = gdd != null && target > 0 ? Math.min(100, Math.round((gdd / target) * 100)) : 0
    let status = 'none'
    if (gdd != null) status = gdd >= target ? 'due' : gdd >= target * 0.8 ? 'soon' : 'ok'
    // Projected reapply date — remaining °C-GDD converted back to °F for the walker.
    const est = gdd == null ? null : projectGddReachDate((target - gdd) * 1.8, daily, 32, todayIso)
    return { area, last, gdd, pct, status, est }
  }).sort((a, b) => (b.gdd ?? -1) - (a.gdd ?? -1))

  const statusStyle = { due: { bg: '#FEE2E2', fg: '#B91C1C', label: 'Reapply now' }, soon: { bg: '#FEF3DD', fg: '#92660D', label: 'Soon' }, ok: { bg: '#E8F3EC', fg: FERN, label: 'On track' } }

  // Per-product suppression-curve model (GreenKeeper-style): for each area with a
  // regulating spray, walk each product's own curve at the area's GDD-since.
  const areaSurface = (name) => { const s = String(name || '').toLowerCase(); if (s.includes('green')) return 'green'; if (s.includes('tee')) return 'tee'; if (s.includes('fairway') || s.includes("f'way") || s.includes('fwy')) return 'fairway'; if (s.includes('rough')) return 'rough'; return 'green' }
  const modelRows = Object.keys(regProdByArea).map((area) => {
    const sk = areaSurface(area)
    const prods = Object.entries(regProdByArea[area]).map(([name, date]) => {
      const prod = (products || []).find((p) => p.name === name) || { name }
      const base = modelForProduct(prod, supMap[name])
      const model = withTargets(base, pgrTargets[base?.id])
      const gdd = gddSince(daily, date, 32)
      const st = model ? regulationStatus(model, gdd, sk) : null
      return { name, model, st, gdd, date, suppression: st ? st.suppression : 0 }
    }).filter((x) => x.model && x.st && x.st.pct < 2) // drop products fully worn off (past rebound)
      .sort((a, b) => (b.st.target || 0) - (a.st.target || 0))
    const combined = combinedSuppression(prods)
    const primary = prods[0]
    return { area, sk, prods, combined, primary }
  }).filter((r) => r.prods.length).sort((a, b) => b.combined - a.combined)

  // Save an edited reapply-GDD target (blank or "= default" reverts to default).
  const saveTarget = (modelId, surf, val, base) => {
    const num = val === '' ? null : Number(val)
    const forModel = { ...(pgrTargets[modelId] || {}) }
    if (num == null || isNaN(num) || num === base) delete forModel[surf]
    else forModel[surf] = num
    const next = { ...pgrTargets }
    if (Object.keys(forModel).length) next[modelId] = forModel; else delete next[modelId]
    onSaveTargets?.(next)
  }

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
            <span className="font-body text-[11px] text-slate-400">GDD °C</span>
          </div>
        </div>
        <p className="font-body text-[11px] text-slate-400 mb-3">GDD since each area's last growth-suppressing spray — a PGR <b>or</b> a DMI (FRAC 3) fungicide, which also regulates growth. <b>200 GDD, base 0°C</b> is the classic greens target (the Primo model); fairways run higher.</p>
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
              {r.last && <p className="font-body text-[10px] text-slate-400 mt-0.5">Last: {r.last.products.join(', ')}{r.last.dmiOnly && <span className="font-bold" style={{ color: '#6D4AC2' }}> · DMI (also regulates)</span>} · {fmtDate(r.last.date)}</p>}
              {r.est && (
                <p className="font-body text-[10px] font-semibold mt-0.5" style={{ color: r.status === 'due' ? '#B91C1C' : FERN }}>
                  {r.status === 'due' ? 'Reapply now — target reached' : `Est. reapply ~${fmtDate(r.est.date)} · ${r.est.days} days out (from forecast)`}
                </p>
              )}
            </div>
          ))}
          {areaRows.length === 0 && <p className="font-body text-sm text-slate-400">No areas set up yet.</p>}
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-1">
          <p className="font-display text-base font-semibold text-slate-900">Regulation model — by product</p>
          {onSaveTargets && <button onClick={() => setEditTargets((v) => !v)} className="font-body text-[11px] font-bold" style={{ color: FERN }}>{editTargets ? 'Done' : 'Adjust targets'}</button>}
        </div>
        <p className="font-body text-[11px] text-slate-400 mb-3">Each product on its own suppression curve (like the GreenKeeper GDD models): strong right after the spray, fading to zero at the reapply point, then a <b>rebound</b> growth surge if you run past it. Stacked products (a PGR + a DMI) read as intensified.</p>

        {editTargets && (
          <div className="rounded-xl p-3 mb-3" style={{ backgroundColor: '#F8FAF9' }}>
            <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">Reapply GDD by product &amp; surface (base 0°C)</p>
            <div className="space-y-2.5">
              {PGR_MODELS.map((m) => (
                <div key={m.id}>
                  <p className="font-body text-[12px] font-semibold text-slate-700 mb-1">{m.label}</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {['green', 'tee', 'fairway', 'rough'].map((surf) => (
                      <div key={surf}>
                        <label className="font-body text-[9px] uppercase tracking-wide text-slate-400 block mb-0.5">{surf}</label>
                        <input type="number" inputMode="numeric" key={`${m.id}:${surf}:${pgrTargets[m.id]?.[surf] ?? m.gdd[surf]}`} defaultValue={Math.round((pgrTargets[m.id]?.[surf] ?? m.gdd[surf]) / 1.8)}
                          onBlur={(e) => { const v = e.target.value.trim(); saveTarget(m.id, surf, v === '' ? '' : String(Math.round(Number(v) * 1.8)), m.gdd[surf]) }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                          className="w-full border border-slate-200 rounded-lg px-1.5 py-1.5 text-base font-body text-center" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="font-body text-[10px] text-slate-400 mt-2">Higher GDD = longer before reapply. Leave a box blank (or matching the default) to use the built-in estimate.</p>
          </div>
        )}

        {modelRows.length === 0 ? (
          <p className="font-body text-sm text-slate-400">Log a PGR or DMI spray on an area to see its curve here.</p>
        ) : (
          <div className="space-y-4">
            {modelRows.map((r) => (
              <div key={r.area} className="rounded-xl p-3" style={{ backgroundColor: '#F8FAF9' }}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-body text-sm font-semibold text-slate-800">{r.area}</span>
                  <span className="font-body text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#EAF2EC', color: FERN }}>~{Math.round(r.combined * 100)}% suppression now</span>
                </div>
                {r.primary && <SuppressionCurve model={r.primary.model} gdd={r.primary.gdd} surfaceKind={r.sk} />}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {r.prods.map((p) => {
                    const ph = PHASE_STYLE[p.st.phase] || PHASE_STYLE.regulated
                    return (
                      <span key={p.name} className="font-body text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: ph.bg, color: ph.fg }}>
                        {p.model.label.split(' (')[0]} · {ph.label} · {Math.round(p.gdd / 1.8)}/{Math.round(p.st.target / 1.8)}
                      </span>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="font-body text-[10px] text-slate-400">Weather is pulled from your course location (Open-Meteo). GDD updates daily.</p>
    </div>
  )
}

// Small suppression curve (the "sinewave"): plots a product's growth suppression
// across GDD from the spray out to 2× its reapply target, with a marker showing
// where you are today and the reapply line. Above the zero line = regulated,
// below = rebound growth.
function SuppressionCurve({ model, gdd, surfaceKind }) {
  if (!model) return null
  const target = model.gdd[surfaceCol(surfaceKind)] || model.gdd.green
  if (!target) return null
  const maxG = target * 2
  const W = 320, H = 66, padT = 8, padB = 16
  const midY = (padT + (H - padB)) / 2
  const amp = ((H - padB) - padT) / 2
  const xAt = (g) => (Math.min(g, maxG) / maxG) * W
  const yAt = (s) => midY - (s / model.peak) * amp
  const n = 48
  const path = Array.from({ length: n + 1 }, (_, i) => { const g = (maxG * i) / n; const s = suppressionAt(model, g, surfaceKind); return `${i ? 'L' : 'M'}${xAt(g).toFixed(1)},${yAt(s).toFixed(1)}` }).join(' ')
  const curX = xAt(gdd)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none" style={{ display: 'block' }}>
      {/* zero (regulation gone) line */}
      <line x1="0" y1={midY} x2={W} y2={midY} stroke="#E2E8F0" strokeWidth="1" strokeDasharray="3 3" />
      {/* reapply target line */}
      <line x1={xAt(target)} y1={padT} x2={xAt(target)} y2={H - padB} stroke="#CBD5E1" strokeWidth="1" />
      <text x={xAt(target)} y={H - 4} fontSize="8" fill="#94A3B8" textAnchor="middle" fontFamily="system-ui">reapply</text>
      {/* suppression curve */}
      <path d={path} fill="none" stroke={FERN} strokeWidth="2" />
      {/* you-are-here */}
      <line x1={curX} y1={padT} x2={curX} y2={H - padB} stroke="#B07A16" strokeWidth="1.5" />
      <circle cx={curX} cy={yAt(suppressionAt(model, gdd, surfaceKind))} r="3.5" fill="#B07A16" />
      <text x={Math.min(curX, W - 14)} y="7" fontSize="8" fill="#B07A16" textAnchor="middle" fontFamily="system-ui">today</text>
    </svg>
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
        <text x={X(n - 1)} y={Y(last.value) - 7} textAnchor="end" fontSize="11" fontWeight="700" fill={color} style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(last.value * 10) / 10}</text>
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
  const courseNames = (Array.isArray(courseInfo?.courses) ? courseInfo.courses : []).filter((c) => c && c.name && Number(c.holes) > 0).map((c) => c.name)
  const hasCourses = courseNames.length >= 2
  const [courseTab, setCourseTab] = useState(courseNames[0] || 'all')
  // Greens shown in the picker for the active course tab (kept fully separate so
  // Blue and Gold never mix). "Other" holds the practice/putting greens.
  const pickerGreens = !hasCourses ? greenOptions
    : courseTab === 'other' ? greenOptions.filter((g) => !courseNames.some((n) => g.startsWith(n)))
    : greenOptions.filter((g) => g.startsWith(courseTab))
  const [date, setDate] = useState(localDateISO())
  const [unit] = useState('L') // we log clippings in litres
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
        {hasCourses && (
          <div className="flex gap-2 mt-1 mb-2 overflow-x-auto pb-1">
            {[...courseNames, 'other'].map((c) => (
              <button key={c} type="button" onClick={() => setCourseTab(c)} className="font-body text-xs font-bold px-3.5 py-1.5 rounded-full whitespace-nowrap transition" style={courseTab === c ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>{c === 'other' ? 'Practice / Other' : c}</button>
            ))}
          </div>
        )}
        <div className="mt-1 mb-3">
          <PeoplePicker options={pickerGreens} selected={selected} onToggle={toggleGreen} placeholder={hasCourses ? `Search ${courseTab === 'other' ? 'practice' : courseTab} greens…` : 'Search greens — e.g. Blue 3, Gold, Putting…'} max={40} />
        </div>

        {selected.length > 0 && (
          <div className="rounded-xl p-3 mb-3" style={{ backgroundColor: '#F8FAF9' }}>
            <FieldLabel>Volume per green ({unit})</FieldLabel>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {[...selected].sort(sortGreens).map((g) => (
                <div key={g} className="flex items-center gap-2">
                  <span className="font-body text-xs font-semibold text-slate-600 w-28 shrink-0 truncate" title={g}>{g.replace('Green ', '')}</span>
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
            <div className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body bg-slate-50 text-slate-600">L (litres)</div>
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

const speedErrorText = (e) => saveErrorText(e, 'supabase/phase18.sql')

// ── GREENS SPEED (STIMPMETER) ───────────────────────────────────────────────
// Log each green's speed (feet) by date. The win is consistency: the day's
// spread across greens (fastest vs slowest) matters as much as the average.
function GreensSpeedTab({ speeds, courseInfo, onAddMany, onDelete }) {
  const greenOptions = greenOptionsFor(courseInfo)
  const courseNames = (Array.isArray(courseInfo?.courses) ? courseInfo.courses : []).filter((c) => c && c.name && Number(c.holes) > 0).map((c) => c.name)
  const hasCourses = courseNames.length >= 2
  const [courseTab, setCourseTab] = useState(courseNames[0] || 'all')
  const pickerGreens = !hasCourses ? greenOptions
    : courseTab === 'other' ? greenOptions.filter((g) => !courseNames.some((n) => g.startsWith(n)))
    : greenOptions.filter((g) => g.startsWith(courseTab))
  const [date, setDate] = useState(localDateISO())
  const [notes, setNotes] = useState('')
  const [selected, setSelected] = useState([])
  const [vals, setVals] = useState({}) // green -> speed (ft)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('all')
  const [msg, setMsg] = useState(null)

  const toggleGreen = (g) => setSelected((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]))
  const setVal = (g, v) => setVals((prev) => ({ ...prev, [g]: v }))

  const entries = selected.filter((g) => vals[g] !== '' && vals[g] != null)
  const save = async () => {
    if (entries.length === 0) return
    setBusy(true); setMsg(null)
    try {
      await onAddMany(entries.map((g) => ({ area: g, date, speed: Number(vals[g]), notes })))
      setVals({}); setNotes('')
      setMsg({ type: 'ok', text: `Logged ${entries.length} green${entries.length !== 1 ? 's' : ''}.` })
    } catch (e) { console.error(e); setMsg({ type: 'err', text: speedErrorText(e) }) }
    setBusy(false)
  }

  // Latest reading date and its spread across greens (consistency).
  const latestDate = speeds.length ? speeds.map((s) => s.date).sort().pop() : null
  const latestSet = latestDate ? speeds.filter((s) => s.date === latestDate && s.speed != null) : []
  const nums = latestSet.map((s) => Number(s.speed)).filter((n) => !isNaN(n))
  const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null
  const fast = nums.length ? Math.max(...nums) : null
  const slow = nums.length ? Math.min(...nums) : null
  const spread = fast != null ? Math.round((fast - slow) * 10) / 10 : null
  const fastGreen = latestSet.find((s) => Number(s.speed) === fast)
  const slowGreen = latestSet.find((s) => Number(s.speed) === slow)

  const shown = filter === 'all' ? speeds : speeds.filter((c) => c.area === filter)
  const byArea = {}
  speeds.forEach((c) => { (byArea[c.area] = byArea[c.area] || []).push(c) })

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border-2 p-4 shadow-sm" style={{ borderColor: GOLD }}>
        <p className="font-display text-base font-semibold text-slate-900 mb-1">Log greens speed</p>
        <p className="font-body text-[11px] text-slate-400 mb-3">Pick the greens you Stimped, then enter each one's reading in feet — logs them all at once.</p>

        <FieldLabel>Greens</FieldLabel>
        {hasCourses && (
          <div className="flex gap-2 mt-1 mb-2 overflow-x-auto pb-1">
            {[...courseNames, 'other'].map((c) => (
              <button key={c} type="button" onClick={() => setCourseTab(c)} className="font-body text-xs font-bold px-3.5 py-1.5 rounded-full whitespace-nowrap transition" style={courseTab === c ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>{c === 'other' ? 'Practice / Other' : c}</button>
            ))}
          </div>
        )}
        <div className="mt-1 mb-3">
          <PeoplePicker options={pickerGreens} selected={selected} onToggle={toggleGreen} placeholder={hasCourses ? `Search ${courseTab === 'other' ? 'practice' : courseTab} greens…` : 'Search greens — e.g. Blue 3, Gold, Putting…'} max={40} />
        </div>

        {selected.length > 0 && (
          <div className="rounded-xl p-3 mb-3" style={{ backgroundColor: '#F8FAF9' }}>
            <FieldLabel>Speed per green (feet)</FieldLabel>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {[...selected].sort(sortGreens).map((g) => (
                <div key={g} className="flex items-center gap-2">
                  <span className="font-body text-xs font-semibold text-slate-600 w-28 shrink-0 truncate" title={g}>{g.replace('Green ', '')}</span>
                  <input type="number" step="0.1" inputMode="decimal" value={vals[g] ?? ''} onChange={(e) => setVal(g, e.target.value)} className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2.5 py-2 text-base font-body bg-white" placeholder="10.5" />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mb-3">
          <FieldLabel>Date</FieldLabel>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base font-body" />
        </div>
        <div className="mb-3">
          <FieldLabel>Notes (optional)</FieldLabel>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base font-body" placeholder="e.g. morning, after roll, before tournament" />
        </div>
        {msg && (
          <div className="rounded-xl px-3 py-2 mb-2 font-body text-[12px] font-semibold" style={msg.type === 'ok' ? { backgroundColor: '#E8F3EC', color: FERN } : { backgroundColor: '#FEE2E2', color: '#B91C1C' }}>{msg.text}</div>
        )}
        <button onClick={save} disabled={busy || entries.length === 0} className="w-full py-2.5 rounded-xl text-sm font-bold font-body text-white disabled:opacity-50" style={{ backgroundColor: FOREST }}>
          {busy ? 'Saving…' : `Log ${entries.length || ''} green${entries.length !== 1 ? 's' : ''}`.trim()}
        </button>
        {entries.length === 0 && selected.length > 0 && (
          <p className="font-body text-[11px] text-slate-400 mt-1.5 text-center">Enter a reading for at least one green to save.</p>
        )}
      </div>

      {/* Latest-day consistency roll-up */}
      {nums.length > 0 && (
        <div className="rounded-2xl p-4 text-white shadow-sm" style={{ backgroundColor: FOREST }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-body text-[11px] font-bold uppercase tracking-wide opacity-70">Average speed · {fmtDate(latestDate)}</p>
              <p className="font-display text-3xl font-bold mt-0.5">{avg.toFixed(1)} <span className="text-lg font-semibold opacity-80">ft</span></p>
            </div>
            <div className="text-right">
              <p className="font-body text-[11px] font-bold uppercase tracking-wide opacity-70">Spread</p>
              <p className="font-display text-2xl font-bold mt-0.5">{spread === 0 ? 'Even' : `${spread} ft`}</p>
              <p className="font-body text-[10px] opacity-70">{nums.length} green{nums.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
          {spread > 0 && fastGreen && slowGreen && (
            <p className="font-body text-[11px] opacity-80 mt-2 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.15)' }}>
              Fastest {fastGreen.area.replace('Green ', '')} ({fast.toFixed(1)}) · Slowest {slowGreen.area.replace('Green ', '')} ({slow.toFixed(1)})
            </p>
          )}
        </div>
      )}

      {/* Trend graph per green */}
      {Object.keys(byArea).length > 0 && (
        <div className="space-y-3">
          {Object.entries(byArea).sort((a, b) => sortGreens(a[0], b[0])).map(([area, list]) => {
            const recent = [...list].sort((a, b) => (a.date || '').localeCompare(b.date || '')).slice(-12)
            const latest = recent[recent.length - 1]
            return (
              <div key={area} className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-body font-semibold text-sm text-slate-900">{area}</p>
                  <p className="font-body text-[10px] text-slate-400">{recent.length} reading{recent.length !== 1 ? 's' : ''} · latest {latest?.speed} ft</p>
                </div>
                <TrendChart points={recent.map((c) => ({ date: c.date, value: c.speed }))} unit="ft" />
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
            <button key={a} onClick={() => setFilter(a)} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap" style={filter === a ? { backgroundColor: FERN, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>{a.replace('Green ', '')}</button>
          ))}
        </div>
        {shown.length === 0 ? (
          <div className="bg-white rounded-2xl border border-black/5 p-8 text-center text-slate-400 font-body text-sm">No greens-speed readings yet.</div>
        ) : (
          <div className="space-y-2">
            {shown.map((c) => (
              <div key={c.id} className="bg-white rounded-2xl border border-black/5 p-3 shadow-sm flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-body text-sm font-semibold text-slate-800 truncate">{c.area}</p>
                  <p className="font-body text-[11px] text-slate-400">{fmtDate(c.date)}{c.notes ? ` · ${c.notes}` : ''}</p>
                </div>
                <p className="font-display text-base font-bold text-slate-900 shrink-0">{c.speed} <span className="font-body text-[11px] font-medium text-slate-400">ft</span></p>
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
  // Multi-course isolation: which course an area belongs to (by course name /
  // first word), so Blue and Gold tests never average together.
  const courseNames = (Array.isArray(courseInfo?.courses) ? courseInfo.courses : []).filter((c) => c && c.name && Number(c.holes) > 0).map((c) => c.name)
  const hasCourses = courseNames.length >= 2
  const [courseTab, setCourseTab] = useState(courseNames[0] || 'all')
  // Which course an area belongs to (legacy fallback). Greens from the picker are
  // prefixed with the course name; settings areas / generic names fall back to a
  // first-word match. Anything unmatched (practice greens, pre-multi-course
  // "Green 5" entries) is "other".
  const courseOf = (name) => {
    const a = String(name || '').toLowerCase()
    return courseNames.find((n) => a.startsWith(String(n).toLowerCase()))
      || courseNames.find((n) => a.includes(String(n).toLowerCase()))
      || courseNames.find((n) => a.includes(String(n).split(' ')[0].toLowerCase()))
      || ''
  }
  // The course a test is filed under. The course chosen when the test was saved
  // is authoritative (so a test never lands in the wrong tab because its area
  // name didn't match); older tests without one fall back to name inference.
  const courseOfTest = (t) => t.course || courseOf(t.area)

  // Grass + soil context for a chosen location. Settings areas carry it directly;
  // an individual green inherits from the course's greens settings-area so its
  // plan is still variety/soil-aware.
  const greensSeed = () => {
    const key = areaNames.find((a) => /green/i.test(a))
    return key ? { grasses: areas[key]?.grasses || [], soilType: areas[key]?.soilType || '' } : { grasses: [], soilType: '' }
  }
  const contextFor = (name) => (areas[name] ? { grasses: areas[name].grasses || [], soilType: areas[name].soilType || '' } : greensSeed())

  const seed0 = contextFor(areaOptions[0] || '')
  const blank = { area: areaOptions[0] || '', course: courseNames[0] || '', date: localDateISO(), annualN: String(suggestedAnnualN(seed0.grasses).n), units: 'ppm', ph: '', bufferPh: '', om: '', cec: '', p: '', k: '', ca: '', mg: '', s: '', na: '', fe: '', mn: '', cu: '', zn: '', b: '', bsCa: '', bsMg: '', bsK: '', bsNa: '', bsH: '', lab: '', notes: '', grasses: seed0.grasses, soilType: seed0.soilType }
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
      area: t.area, course: t.course || courseOf(t.area) || '', date: t.date || localDateISO(), units: 'ppm',
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
  // Seed a new test's course from the tab you're viewing (so a test added while
  // looking at Blue is filed under Blue), defaulting to the first course.
  const openNew = () => { setForm({ ...blank, course: hasCourses ? (courseTab === 'all' ? courseNames[0] : (courseTab === 'other' ? '' : courseTab)) : '' }); setEditingId(null); setShowForm(true); setMsg(null) }
  const toggleGrass = (g) => setForm((f) => ({ ...f, grasses: (f.grasses || []).includes(g) ? f.grasses.filter((x) => x !== g) : [...(f.grasses || []), g] }))

  const nSuggest = suggestedAnnualN(form.grasses || [])

  // When the location changes, pull in its grass + soil context and re-suggest N
  // (unless the user hand-typed an N value).
  const pickArea = (v) => setForm((f) => {
    const ctx = contextFor(v)
    const wasSuggested = f.annualN === '' || f.annualN === String(suggestedAnnualN(f.grasses || []).n)
    return { ...f, area: v, grasses: ctx.grasses, soilType: ctx.soilType, annualN: wasSuggested ? String(suggestedAnnualN(ctx.grasses).n) : f.annualN }
  })

  // Settings areas + greens available for the form's currently-selected course.
  // Picking a course here is what files the test — the area is just the spot.
  const belongsToForm = (name, course) => (course ? courseOf(name) === course : !courseOf(name))
  const formAreaNames = !hasCourses ? areaNames : areaNames.filter((a) => belongsToForm(a, form.course))
  const formGreens = !hasCourses ? greenOptions
    : form.course ? greenOptions.filter((g) => g.startsWith(form.course))
    : greenOptions.filter((g) => !courseNames.some((n) => g.startsWith(n)))
  // Switch the form to another course and jump to that course's first location.
  const pickCourse = (c) => {
    const course = c === 'other' ? '' : c
    const list = !hasCourses ? areaOptions
      : course ? [...areaNames.filter((a) => courseOf(a) === course), ...greenOptions.filter((g) => g.startsWith(course))]
      : [...areaNames.filter((a) => !courseOf(a)), ...greenOptions.filter((g) => !courseNames.some((n) => g.startsWith(n)))]
    const first = list[0] || ''
    const ctx = contextFor(first)
    setForm((f) => ({ ...f, course, area: first, grasses: ctx.grasses, soilType: ctx.soilType, annualN: String(suggestedAnnualN(ctx.grasses).n) }))
  }

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
      setForm((f) => ({ ...blank, area: f.area, course: f.course, grasses: f.grasses, soilType: f.soilType, annualN: f.annualN, units: f.units }))
      setShowForm(false)
      setMsg({ type: 'ok', text: editingId ? `Soil test updated for ${form.area}.` : `Soil test saved for ${form.area}.` })
      setEditingId(null)
    } catch (e) {
      console.error(e)
      setMsg({ type: 'err', text: saveErrorText(e, 'supabase/phase12.sql') })
    }
    setBusy(false)
  }

  // Only this course's tests feed the sections/averages/trends — full isolation.
  const courseTests = hasCourses && courseTab !== 'all'
    ? soilTests.filter((t) => (courseTab === 'other' ? !courseOfTest(t) : courseOfTest(t) === courseTab))
    : soilTests

  // Group everything by course section (Greens / Tees / Fairways / …) for tabs.
  // Always show the common sections, plus any others that have data.
  const presentSections = SECTION_ORDER.filter((sec) => courseTests.some((t) => soilSection(t.area) === sec))
  const sections = SECTION_ORDER.filter((sec) => DEFAULT_SECTIONS.includes(sec) || presentSections.includes(sec))
  const [section, setSection] = useState(null)
  const [trendKey, setTrendKey] = useState('k')
  const [areaPick, setAreaPick] = useState('all') // 'all' = whole section, else one hole
  const activeSection = section && sections.includes(section) ? section : (presentSections[0] || 'Greens')
  const sectionTests = courseTests.filter((t) => soilSection(t.area) === activeSection)

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
            {hasCourses && (
              <>
                <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400 mt-1 mb-1">Course</p>
                <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
                  {[...courseNames, 'other'].map((c) => {
                    const on = (form.course || 'other') === c
                    return <button key={c} type="button" onClick={() => pickCourse(c)} className="font-body text-xs font-bold px-3.5 py-1.5 rounded-full whitespace-nowrap transition" style={on ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>{c === 'other' ? 'Practice / Other' : c}</button>
                  })}
                </div>
              </>
            )}
            {formAreaNames.length > 0 && (
              <>
                <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400 mt-1 mb-1">Areas</p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {formAreaNames.map((a) => {
                    const on = form.area === a
                    return <button key={a} type="button" onClick={() => pickArea(a)} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full transition border" style={on ? { backgroundColor: FOREST, color: 'white', borderColor: FOREST } : { backgroundColor: 'white', color: '#64748B', borderColor: '#E2E8F0' }}>{a}</button>
                  })}
                </div>
              </>
            )}
            <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Greens / holes</p>
            <Combobox value={formGreens.includes(form.area) ? form.area : ''} onChange={(v) => pickArea(v)} options={formGreens} accent={FERN} placeholder={hasCourses ? `Search a ${form.course || 'practice'} green…` : 'Search a green — Blue 3, Gold 12, Putting…'} />
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

      {/* Course tabs — keep each course's tests fully separate */}
      {hasCourses && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[...courseNames, 'other'].map((c) => (
            <button key={c} onClick={() => { setCourseTab(c); setSection(null); setAreaPick('all') }} className="font-body text-xs font-bold px-3.5 py-2 rounded-full whitespace-nowrap transition" style={courseTab === c ? { backgroundColor: GOLD, color: FOREST } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>{c === 'other' ? 'Practice / Other' : c}</button>
          ))}
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
  const [date, setDate] = useState(localDateISO())
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
// Soil-temp timing window id → Knowledge/fungicide disease id (only disease
// windows with efficacy ratings).
const TIMING_DISEASE_ID = { dollarspot: 'dollar_spot', brownpatch: 'brown_patch', pythium: 'pythium', anthracnose: 'anthracnose', fairyring: 'fairy_ring' }
function TimingTab({ soilSeries, hasLocation, products = [] }) {
  const [openFung, setOpenFung] = useState(null)
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
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: st.dot }} />{t.status === 'offseason' ? monthRange(t.months) : st.label}
                  </span>
                </div>
                <p className="font-body text-[11px] text-slate-400">Trigger ~{t.threshold}°F ({t.direction === 'falling' ? 'cooling' : 'warming'}){t.months ? ` · ${monthRange(t.months)}` : ''} · {t.note}</p>
                {(() => {
                  const active = t.status === 'now' || t.status === 'soon'
                  const body = active ? t.control : t.watch
                  if (!body) return null
                  const did = TIMING_DISEASE_ID[t.id]
                  const src = active && did ? ratingsSourceFor(did) : null
                  const open = openFung === t.id
                  const list = src ? fungicidesFor(did, src).map((f) => ({ ...f, owned: !!ownedMatch(f, products) })).sort((a, b) => (b.owned ? 1 : 0) - (a.owned ? 1 : 0) || b.score - a.score) : []
                  return (
                    <div className="mt-1.5 rounded-lg p-2" style={{ backgroundColor: active ? '#F0F6F2' : '#F8FAFC' }}>
                      <p className="font-body text-[9px] font-bold uppercase tracking-wide mb-0.5" style={{ color: active ? FERN : '#94A3B8' }}>{active ? 'How to control' : 'Watch for'}</p>
                      <p className="font-body text-[11px] text-slate-600 leading-relaxed">{body}</p>
                      {src && list.length > 0 && (
                        <>
                          <button onClick={() => setOpenFung(open ? null : t.id)} className="font-body text-[11px] font-bold mt-1.5" style={{ color: '#6D4AC2' }}>{open ? 'Hide rated fungicides' : `See rated fungicides (${list.length})`}</button>
                          {open && (
                            <div className="space-y-1.5 mt-1.5">
                              {(list.slice(0, 6)).map((f, i) => {
                                const sc = f.score >= 3.5 ? { bg: '#DDEEDF', fg: '#2E7D46' } : f.score >= 2.5 ? { bg: '#FBF0D5', fg: '#9A6B12' } : { bg: '#EEF1F4', fg: '#64748B' }
                                return (
                                  <div key={i} className="flex items-center gap-2">
                                    <span className="font-body text-[11px] font-bold rounded px-1.5 py-0.5 shrink-0 w-9 text-center" style={{ backgroundColor: sc.bg, color: sc.fg }}>{f.rating}</span>
                                    <div className="min-w-0 flex-1">
                                      <p className="font-body text-[12px] font-semibold text-slate-800 truncate">{f.trade || f.ai}{f.owned && <span className="font-body text-[10px] font-bold ml-1.5" style={{ color: '#2E7D46' }}>✓ in library</span>}</p>
                                      <p className="font-body text-[10px] text-slate-400 truncate">{f.ai}{f.frac ? ` · FRAC ${f.frac}` : ''}{f.interval ? ` · every ${f.interval} d` : ''}</p>
                                    </div>
                                  </div>
                                )
                              })}
                              <p className="font-body text-[10px] text-slate-400">{src === 'Rutgers' ? 'Rutgers 1–4 (4 best)' : 'NC State ++'} · rotate FRAC codes · follow the label.</p>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )
                })()}
              </div>
            )
          })}
        </div>
      )}
      <p className="font-body text-[10px] text-slate-400">Soil temp is a 2-inch estimate from your location. Windows are published transition-zone starting points — pair with your own read and local extension guidance.</p>
    </div>
  )
}

// The Turf Performance home — an at-a-glance roll-up of everything the other
// tabs track (GDD, growth-reg timing, clippings, soil, practices), each tile
// tappable to jump into the detail tab.
function TurfDashboard({ daily = [], sheets = [], products = [], areas = {}, clippings = [], soilTests = [], practices = [], speeds = [], hasLocation, onGo }) {
  const PGR_TARGET = 360 // classic greens reapply target (base 32°F)
  const gddSeries = gddFromDaily(daily)
  const seasonGdd = gddSeries.length ? gddSeries[gddSeries.length - 1].acc : 0

  // Growth-reg timing — GDD since each area's last growth-suppressing spray.
  const supMap = suppressionMap(products)
  const lastByArea = {}
  const areaHasPGR = {}
  ;(sheets || []).filter((s) => sheetApplied(s) && s.date).forEach((s) => {
    const sup = (s.products || []).filter((p) => supMap[p.product])
    if (!sup.length) return
    if (sup.some((p) => supMap[p.product] === 'pgr')) areaHasPGR[s.area] = true
    if (!lastByArea[s.area] || s.date > lastByArea[s.area]) lastByArea[s.area] = s.date
  })
  const pgrRows = Object.keys(areaHasPGR).map((area) => {
    const gdd = gddSince(daily, lastByArea[area], 32)
    return { area, gdd, status: gdd >= PGR_TARGET ? 'due' : gdd >= PGR_TARGET * 0.8 ? 'soon' : 'ok' }
  }).sort((a, b) => b.gdd - a.gdd)
  const dueCount = pgrRows.filter((r) => r.status === 'due').length
  const soonCount = pgrRows.filter((r) => r.status === 'soon').length
  const topPgr = pgrRows[0]

  // Clippings — latest reading + direction against the one before it (same area).
  const clipsSorted = [...clippings].sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  const lastClip = clipsSorted[clipsSorted.length - 1]
  const prevSameArea = lastClip ? clipsSorted.filter((c) => c.area === lastClip.area && c.date < lastClip.date).pop() : null
  const clipDir = lastClip && prevSameArea ? (lastClip.volume > prevSameArea.volume ? 'up' : lastClip.volume < prevSameArea.volume ? 'down' : 'flat') : null

  const lastSoil = [...soilTests].sort((a, b) => (a.date || '').localeCompare(b.date || '')).pop()
  const lastPractice = [...practices].filter((p) => p.date).sort((a, b) => a.date.localeCompare(b.date)).pop()
  // Greens speed — average across the most recent reading date.
  const speedDate = speeds.length ? speeds.map((s) => s.date).sort().pop() : null
  const speedNums = speedDate ? speeds.filter((s) => s.date === speedDate && s.speed != null).map((s) => Number(s.speed)) : []
  const speedAvg = speedNums.length ? speedNums.reduce((a, b) => a + b, 0) / speedNums.length : null
  const daysAgo = (d) => { if (!d) return null; const n = Math.round((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86400000); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago` }

  const Tile = ({ onClick, icon, label, value, sub, tint = '#F0F6F2', fg = FERN }) => (
    <button onClick={onClick} className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm text-left w-full hover:shadow-md transition">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: tint, color: fg }}>{icon}</span>
        <span className="font-body text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</span>
      </div>
      <p className="font-display text-xl font-bold text-slate-900 leading-tight">{value}</p>
      {sub && <p className="font-body text-[12px] text-slate-400 mt-0.5">{sub}</p>}
    </button>
  )

  return (
    <div className="space-y-4">
      {/* Season GDD hero */}
      <button onClick={() => onGo('gdd')} className="w-full text-left rounded-2xl p-4 text-white shadow-sm" style={{ backgroundColor: FOREST }}>
        <p className="font-body text-[11px] font-bold uppercase tracking-wide opacity-70">Season GDD (base 50°F)</p>
        <p className="font-display text-3xl font-bold mt-0.5">{hasLocation ? Math.round(seasonGdd).toLocaleString() : '—'}</p>
        <p className="font-body text-[11px] opacity-70 mt-0.5">{hasLocation ? `Accumulated since Jan 1 · ${daily.length} days of weather` : 'Add your course location in Settings to track GDD'}</p>
      </button>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Tile
          onClick={() => onGo('gdd')}
          icon={<TrendingUp size={16} />}
          label="Growth-Reg Timing"
          tint={dueCount ? '#FEE2E2' : '#F0F6F2'} fg={dueCount ? '#B91C1C' : FERN}
          value={pgrRows.length === 0 ? 'No PGR logged' : dueCount ? `${dueCount} area${dueCount !== 1 ? 's' : ''} due` : soonCount ? `${soonCount} due soon` : 'All on track'}
          sub={topPgr ? `${topPgr.area}: ${topPgr.gdd} / ${PGR_TARGET} GDD` : 'Log a growth-reg spray to start the clock'}
        />
        <Tile
          onClick={() => onGo('clippings')}
          icon={<ClipboardList size={16} />}
          label="Clipping Yield"
          value={lastClip ? `${lastClip.volume} ${lastClip.unit || ''}`.trim() : 'No logs yet'}
          sub={lastClip ? `${lastClip.area} · ${daysAgo(lastClip.date)}${clipDir ? ` · ${clipDir === 'up' ? '▲ up' : clipDir === 'down' ? '▼ down' : '– flat'}` : ''}` : 'Log clipping volumes to track growth'}
        />
        <Tile
          onClick={() => onGo('soil')}
          icon={<Droplet size={16} />}
          label="Soil Tests"
          value={soilTests.length ? `${soilTests.length} on file` : 'No tests yet'}
          sub={lastSoil ? `Last: ${lastSoil.area || 'test'} · ${daysAgo(lastSoil.date)}` : 'Add a soil test to track nutrients'}
        />
        <Tile
          onClick={() => onGo('practices')}
          icon={<Scissors size={16} />}
          label="Cultural Practices"
          value={lastPractice ? lastPractice.practice : 'None logged'}
          sub={lastPractice ? `${lastPractice.area || ''}${lastPractice.area ? ' · ' : ''}${daysAgo(lastPractice.date)}` : 'Log aeration, topdressing, rolling…'}
        />
      </div>

      <button onClick={() => onGo('speed')} className="w-full bg-white rounded-2xl border border-black/5 p-4 shadow-sm flex items-center gap-3 text-left hover:shadow-md transition">
        <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: '#F0F6F2', color: FERN }}><Gauge size={16} /></span>
        <div className="min-w-0 flex-1">
          <p className="font-body text-sm font-semibold text-slate-800">Greens Speed{speedAvg != null ? ` · ${speedAvg.toFixed(1)} ft avg` : ''}</p>
          <p className="font-body text-[12px] text-slate-400">{speedAvg != null ? `${speedNums.length} green${speedNums.length !== 1 ? 's' : ''} · ${daysAgo(speedDate)}` : 'Log Stimpmeter readings to track consistency'}</p>
        </div>
        <ChevronRight size={18} className="text-slate-300 shrink-0" />
      </button>
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
