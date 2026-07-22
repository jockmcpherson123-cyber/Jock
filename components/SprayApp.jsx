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

import React, { useState, useEffect } from 'react'
import {
  Plus, Trash2, Calendar, User, ShieldCheck, Loader2, Droplet, CloudUpload,
  Check, ChevronRight, Cloud, Sprout, ClipboardList, TrendingUp, AlertTriangle,
  Package, Truck,
} from 'lucide-react'
import {
  uid, convertUnits, unitsAreCompatible, calcAmount, fmtDate, aggregateNPK, downloadCSV,
} from '@/lib/calc'
import { PRODUCT_TYPES } from '@/lib/defaults'
import * as db from '@/lib/db'
import { logout } from '@/app/actions/auth'
import AnnualProgram from '@/components/AnnualProgram'

// ── PALETTE ───────────────────────────────────────────────────────────────
const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#C9A84C'
const CREAM = '#F7F5EF'
const INK = '#1A1A16'

// ── ROLE HELPERS ────────────────────────────────────────────────────────────
const canManage = (role) => role === 'superintendent' || role === 'director'
const canApprove = (role) => role === 'director'

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
  const [route, setRoute] = useState('dashboard')
  const [sheets, setSheets] = useState([])
  const [products, setProducts] = useState([])
  const [activeSheet, setActiveSheet] = useState(null)
  const [deliveries, setDeliveries] = useState([])
  const [areas, setAreas] = useState({})
  const [operators, setOperators] = useState([])
  const [directors, setDirectors] = useState([])
  const [targets, setTargets] = useState([])
  const [sheetTypes, setSheetTypes] = useState([])
  const [courseInfo, setCourseInfo] = useState({ clubName: 'Congressional Country Club', deptName: 'Golf Maintenance' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)

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
      const [s, p, d, settings] = await Promise.all([
        db.fetchSheets(),
        db.fetchProducts(),
        db.fetchDeliveries(),
        db.fetchSettings(),
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

  async function reloadProducts() {
    try {
      setProducts(await db.fetchProducts())
    } catch (e) {
      console.error(e)
    }
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

  async function approveSheet(sig) {
    const updated = { ...activeSheet, status: 'approved', directorSig: sig, directorDate: new Date().toISOString() }
    const saved = await saveSheet(updated)
    if (!saved) return

    // Auto-deduct stock for every product used on this sheet.
    const area = areas[saved.area] || {}
    const deductions = []
    ;(saved.products || [])
      .filter((p) => p.product)
      .forEach((p) => {
        const { value: amt } = calcAmount(parseFloat(p.rate), p.basis, area.sqft, p.forceGal)
        if (amt === null) return
        const total = Math.round(amt * saved.tanks * 10) / 10
        deductions.push({ name: p.product, total })
      })

    let nextProducts = [...products]
    for (const ded of deductions) {
      const prod = nextProducts.find((pr) => pr.name === ded.name)
      if (!prod) continue
      const newStock = Math.max(0, Math.round(((prod.stock || 0) - ded.total) * 100) / 100)
      const updatedProd = { ...prod, stock: newStock }
      nextProducts = nextProducts.map((pr) => (pr.name === ded.name ? updatedProd : pr))
      try {
        await db.upsertProduct(updatedProd)
      } catch (e) {
        console.error('Stock update failed', e)
      }
    }
    setProducts(nextProducts)
    setActiveSheet(saved)
    showToast('Approved — stock deducted, now live on all iPads')
  }

  function newSheet() {
    const areaKeys = Object.keys(areas)
    const firstArea = areaKeys[0]
    setActiveSheet({
      id: crypto.randomUUID(),
      sheetType: sheetTypes[0] || 'Greens Spray',
      date: new Date().toISOString().slice(0, 10),
      operator: '',
      area: firstArea,
      tanks: firstArea ? areas[firstArea].tanks : 1,
      weather: { temp: '', wind: '', humidity: '', windDir: '' },
      products: [{ id: uid(), product: '', rate: '', basis: '', forceGal: false }],
      targets: [],
      status: 'pending',
      directorSig: '',
      directorDate: '',
      createdAt: new Date().toISOString(),
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

      <TopNav route={route} setRoute={setRoute} onNew={newSheet} courseInfo={courseInfo} manage={manage} />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 pb-24">
        {route === 'dashboard' && (
          <Dashboard
            sheets={sheets} pending={pending} approved={approved} todaySheets={todaySheets} products={products} areas={areas}
            manage={manage}
            onOpen={(s) => { setActiveSheet(s); setRoute('view') }}
            onNew={newSheet}
            onSeeAll={() => setRoute('list')}
          />
        )}
        {route === 'list' && (
          <SheetList sheets={sheets} manage={manage} onOpen={(s) => { setActiveSheet(s); setRoute('view') }} onNew={newSheet} />
        )}
        {route === 'edit' && activeSheet && manage && (
          <SheetEditor
            sheet={activeSheet} saving={saving} products={products}
            areas={areas} operators={operators} targets={targets} sheetTypes={sheetTypes}
            onSave={async (s) => {
              const saved = await saveSheet(s)
              if (saved) { setActiveSheet(saved); setRoute('view'); showToast('Spray sheet saved') }
            }}
            onCancel={() => setRoute('dashboard')}
          />
        )}
        {route === 'view' && activeSheet && (
          <SheetViewer
            sheet={activeSheet} products={products} areas={areas} directors={directors} courseInfo={courseInfo}
            manage={manage} approve={canApprove(user.role)}
            onBack={() => setRoute('dashboard')}
            onEdit={() => setRoute('edit')}
            onApprove={approveSheet}
          />
        )}
        {route === 'chemicals' && manage && (
          <ChemicalLibrary products={products} onSaveProduct={saveProduct} onDeleteProduct={removeProduct} />
        )}
        {route === 'inventory' && manage && (
          <Inventory products={products} deliveries={deliveries} onAddDelivery={addDelivery} />
        )}
        {route === 'program' && manage && <AnnualProgram areas={areas} onProductsChanged={reloadProducts} />}
        {route === 'reports' && manage && <Reports sheets={sheets} products={products} areas={areas} />}
        {route === 'settings' && manage && (
          <SettingsPage
            areas={areas} operators={operators} directors={directors} targets={targets}
            sheetTypes={sheetTypes} courseInfo={courseInfo}
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
    ? [['dashboard', 'Dashboard'], ['list', 'All Sheets'], ['program', 'Annual Program'], ['inventory', 'Inventory'], ['reports', 'Reports'], ['chemicals', 'Chemical Library'], ['settings', 'Settings']]
    : [['dashboard', 'Dashboard'], ['list', 'All Sheets']]

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
function Dashboard({ sheets, pending, approved, todaySheets, products, areas, onOpen, onNew, onSeeAll, manage }) {
  const lowStock = (products || []).filter((p) => p.lowStockThreshold > 0 && (p.stock || 0) <= p.lowStockThreshold)
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="pt-6 space-y-6">
      {/* Stats strip */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard icon={<ClipboardList size={16} />} label="Pending Approval" value={pending.length} accent={pending.length > 0 ? '#B45309' : FERN} />
        <StatCard icon={<ShieldCheck size={16} />} label="Approved" value={approved.length} accent={FERN} />
        <StatCard icon={<Droplet size={16} />} label="Today" value={todaySheets.length} accent={GOLD} />
        <StatCard icon={<AlertTriangle size={16} />} label="Low Stock" value={lowStock.length} accent={lowStock.length > 0 ? '#DC2626' : FERN} />
      </div>

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
        <SectionHeader title="Today's Spray Status" subtitle={new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} />
        <div className="bg-white rounded-2xl border border-black/5 overflow-hidden shadow-sm">
          {Object.keys(areas).map((area, i) => {
            const sheet = sheets.find((s) => s.area === area && s.date === today)
            return (
              <div key={area} className={`flex items-center justify-between px-4 py-3 ${i !== 0 ? 'border-t border-black/5' : ''}`}>
                <div className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: !sheet ? '#D1D5DB' : sheet.status === 'approved' ? FERN : '#D97706' }} />
                  <span className="font-body text-sm text-slate-700 truncate max-w-[160px] sm:max-w-none">{area}</span>
                </div>
                <span className="font-body text-xs font-medium text-slate-400">
                  {!sheet ? 'Not scheduled' : sheet.status === 'approved' ? 'Approved' : 'Pending'}
                </span>
              </div>
            )
          })}
          {Object.keys(areas).length === 0 && (
            <div className="px-4 py-6 text-center font-body text-sm text-slate-400">No spray areas configured yet.</div>
          )}
        </div>
      </section>

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
          <p className="font-body font-semibold text-sm text-slate-900 truncate">{sheet.sheetType}</p>
          <StatusPill status={sheet.status} />
        </div>
        <p className="font-body text-xs text-slate-400 truncate">{sheet.area}</p>
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
function SheetList({ sheets, onOpen, onNew, manage }) {
  const [filter, setFilter] = useState('all')
  const filtered = filter === 'all' ? sheets : sheets.filter((s) => s.status === filter)

  return (
    <div className="pt-6">
      <SectionHeader title="All Spray Sheets" />
      <div className="flex gap-2 mb-4">
        {['all', 'pending', 'approved'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="font-body text-xs font-semibold px-3 py-1.5 rounded-full transition"
            style={filter === f ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}
          >
            {f === 'all' ? 'All' : f === 'pending' ? 'Pending' : 'Approved'}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? <EmptyState onNew={onNew} manage={manage} /> : (
        <div className="space-y-2">
          {filtered.map((s) => <SheetRow key={s.id} sheet={s} onClick={() => onOpen(s)} />)}
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
function SheetEditor({ sheet, onSave, onCancel, saving, products, areas, operators, targets: targetOptions, sheetTypes }) {
  const [s, setS] = useState({ ...sheet, targets: sheet.targets || (sheet.target ? [sheet.target] : []) })
  const area = areas[s.area] || areas[Object.keys(areas)[0]] || { tanks: 1, nozzle: '', psi: '', galTank: 0, sqft: 0 }
  const update = (patch) => setS((prev) => ({ ...prev, ...patch }))
  const updateProduct = (id, patch) => setS((prev) => ({ ...prev, products: prev.products.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
  const addRow = () => setS((prev) => ({ ...prev, products: [...prev.products, { id: uid(), product: '', rate: '', basis: '', forceGal: false }] }))
  const removeRow = (id) => setS((prev) => ({ ...prev, products: prev.products.filter((p) => p.id !== id) }))

  const handleAreaChange = (areaName) => update({ area: areaName, tanks: areas[areaName].tanks })
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
          <FieldLabel>Sheet Type</FieldLabel>
          <Select value={s.sheetType} onChange={(v) => update({ sheetType: v })} options={sheetTypes} />

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

          <div className="mt-3">
            <FieldLabel>Area</FieldLabel>
            <Select value={s.area} onChange={handleAreaChange} options={Object.keys(areas)} />
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

        <Card>
          <FieldLabel>Weather</FieldLabel>
          <div className="grid grid-cols-2 gap-2 mt-1">
            {[['temp', 'Temp °F'], ['wind', 'Wind mph'], ['humidity', 'Humidity %'], ['windDir', 'Wind dir']].map(([k, ph]) => (
              <input key={k} placeholder={ph} value={s.weather[k]} onChange={(e) => update({ weather: { ...s.weather, [k]: e.target.value } })} className="border border-slate-200 rounded-xl px-3 py-2 text-sm font-body" />
            ))}
          </div>
        </Card>

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
                          {['oz / M', 'oz / A', 'lbs / M', 'lbs / A', 'gal / M', 'gal / A'].map((b) => <option key={b}>{b}</option>)}
                        </select>
                      </div>

                      {overLimit && (
                        <p className="font-body text-[11px] font-semibold text-red-600 mb-2 flex items-center gap-1">⚠ Over label maximum — limit is {labelMax} {p.basis}</p>
                      )}
                      {underLimit && (
                        <p className="font-body text-[11px] font-semibold text-red-600 mb-2 flex items-center gap-1">⚠ Under label minimum — minimum is {labelMin} {p.basis}</p>
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
      </div>
    </div>
  )
}

// ── PRINTABLE SHEET ───────────────────────────────────────────────────────
function PrintableSheet({ sheet, area, products, sheetTargets, courseInfo }) {
  const totalRows = sheet.products.filter((p) => p.product).map((p) => {
    const { value: amt, unit } = calcAmount(parseFloat(p.rate), p.basis, area.sqft, p.forceGal)
    const total = amt !== null ? Math.round(amt * sheet.tanks * 10) / 10 : null
    return { ...p, amt, total, unit }
  })

  return (
    <div className="print-only" style={{ display: 'none' }}>
      <style>{`
        @media print {
          @page { margin: 0.5in; size: portrait; }
          body * { visibility: hidden; }
          .print-only, .print-only * { visibility: visible; }
          .print-only { display: block !important; position: absolute; top: 0; left: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div style={{ fontFamily: 'Arial, sans-serif', color: '#111', padding: '0' }}>
        <div style={{ textAlign: 'center', borderBottom: '2px solid #16291F', paddingBottom: 10, marginBottom: 14 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{courseInfo?.clubName || 'Golf Club'}</div>
          <div style={{ fontSize: 12, color: '#555' }}>{courseInfo?.deptName || 'Grounds Operations'} — Spray Record</div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginBottom: 12 }}>
          <tbody>
            <tr>
              <td style={tdLabel}>Sheet Type</td><td style={tdVal}>{sheet.sheetType}</td>
              <td style={tdLabel}>Date</td><td style={tdVal}>{sheet.date}</td>
            </tr>
            <tr>
              <td style={tdLabel}>Area</td><td style={tdVal}>{sheet.area}</td>
              <td style={tdLabel}>Operator</td><td style={tdVal}>{sheet.operator || '—'}</td>
            </tr>
            <tr>
              <td style={tdLabel}>Tanks</td><td style={tdVal}>{sheet.tanks}</td>
              <td style={tdLabel}>Nozzle</td><td style={tdVal}>{area.nozzle || '—'}</td>
            </tr>
            <tr>
              <td style={tdLabel}>PSI</td><td style={tdVal}>{area.psi || '—'}</td>
              <td style={tdLabel}>Target</td><td style={tdVal}>{sheetTargets.join(', ') || '—'}</td>
            </tr>
            <tr>
              <td style={tdLabel}>Weather</td>
              <td style={tdVal} colSpan={3}>
                {sheet.weather?.temp ? `${sheet.weather.temp}°F` : '—'} ·
                {' '}{sheet.weather?.wind ? `${sheet.weather.wind} mph wind` : '—'} ·
                {' '}{sheet.weather?.humidity ? `${sheet.weather.humidity}% humidity` : '—'} ·
                {' '}{sheet.weather?.windDir || '—'}
              </td>
            </tr>
          </tbody>
        </table>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginBottom: 12 }}>
          <thead>
            <tr style={{ backgroundColor: '#16291F', color: 'white' }}>
              <th style={thStyle}>Product</th>
              <th style={thStyle}>Rate</th>
              <th style={thStyle}>Basis</th>
              <th style={thStyle}>Amt/Tank</th>
              <th style={thStyle}>Total</th>
            </tr>
          </thead>
          <tbody>
            {totalRows.map((p, i) => (
              <tr key={p.id} style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#F5F5F0' }}>
                <td style={tdRow}>{p.product}</td>
                <td style={tdRow}>{p.rate}</td>
                <td style={tdRow}>{p.basis}</td>
                <td style={tdRow}>{p.amt ?? '—'} {p.unit}</td>
                <td style={{ ...tdRow, fontWeight: 700 }}>{p.total ?? '—'} {p.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginBottom: 16 }}>
          <tbody>
            <tr>
              <td style={{ ...tdLabel, backgroundColor: '#FEF2F2' }}>Safety Notice</td>
              <td style={tdVal} colSpan={3}>
                Check ALL nozzles before leaving maintenance area. Calculate rates BEFORE filling sprayer.
              </td>
            </tr>
          </tbody>
        </table>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <tbody>
            <tr>
              <td style={tdLabel}>Superintendent</td>
              <td style={tdVal}>{sheet.operator || '_______________________'}</td>
              <td style={tdLabel}>Date Submitted</td>
              <td style={tdVal}>{sheet.createdAt ? new Date(sheet.createdAt).toLocaleDateString() : '_______________________'}</td>
            </tr>
            <tr>
              <td style={tdLabel}>Director Approval</td>
              <td style={tdVal}>{sheet.directorSig || '_______________________'}</td>
              <td style={tdLabel}>Date Approved</td>
              <td style={tdVal}>{sheet.directorDate ? new Date(sheet.directorDate).toLocaleString() : '_______________________'}</td>
            </tr>
            <tr>
              <td style={tdLabel}>Status</td>
              <td style={tdVal} colSpan={3}>{sheet.status === 'approved' ? 'APPROVED' : 'PENDING APPROVAL'}</td>
            </tr>
          </tbody>
        </table>

        <p style={{ fontSize: 9, color: '#888', marginTop: 20, textAlign: 'center' }}>
          Printed {new Date().toLocaleString()} — Sheet ID: {sheet.id}
        </p>
      </div>
    </div>
  )
}

const tdLabel = { border: '1px solid #ccc', padding: '5px 8px', backgroundColor: '#F0F0EA', fontWeight: 700, width: '15%' }
const tdVal = { border: '1px solid #ccc', padding: '5px 8px', width: '35%' }
const thStyle = { border: '1px solid #16291F', padding: '6px 8px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase' }
const tdRow = { border: '1px solid #ccc', padding: '5px 8px' }

// ── SHEET VIEWER ──────────────────────────────────────────────────────────
function SheetViewer({ sheet, onBack, onEdit, onApprove, products, areas, directors, courseInfo, manage, approve }) {
  const [sig, setSig] = useState('')
  const area = areas[sheet.area] || {}
  const sheetTargets = sheet.targets || (sheet.target ? [sheet.target] : [])

  return (
    <div className="pt-6 pb-10 max-w-2xl mx-auto">
      <div className="no-print flex items-center justify-between mb-5">
        <button onClick={onBack} className="font-body text-sm font-medium text-slate-400">← Back</button>
        <div className="flex items-center gap-3">
          <StatusPill status={sheet.status} />
          <button onClick={() => window.print()} className="font-body text-sm font-medium" style={{ color: FOREST }}>Print</button>
          {manage && sheet.status === 'pending' && (
            <button onClick={onEdit} className="font-body text-sm font-medium" style={{ color: FERN }}>Edit</button>
          )}
        </div>
      </div>

      <PrintableSheet sheet={sheet} area={area} products={products} sheetTargets={sheetTargets} courseInfo={courseInfo} />

      <div className="no-print">
        <h2 className="font-display text-2xl font-semibold text-slate-900 mb-1">{sheet.sheetType}</h2>
        <p className="font-body text-sm text-slate-400 mb-5">{fmtDate(sheet.date)} · {sheet.area}</p>

        <div className="space-y-4">
          <Card>
            <div className="grid grid-cols-2 gap-3 font-body text-sm">
              <Row label="Operator" value={sheet.operator || '—'} />
              <Row label="Tanks" value={sheet.tanks} />
              <Row label="Nozzle" value={area.nozzle} />
              <Row label="PSI" value={area.psi} />
              {sheetTargets.length > 0 && <Row label="Target" value={sheetTargets.join(', ')} />}
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

          <Card>
            <FieldLabel>Products</FieldLabel>
            <div className="mt-2 divide-y divide-slate-100">
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
                return (
                  <div key={p.id} className="py-2.5 flex items-center justify-between font-body">
                    <div>
                      <p className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                        {p.product}
                        {overLimit && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">OVER LIMIT</span>}
                        {underLimit && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">UNDER MIN</span>}
                      </p>
                      <p className="text-xs text-slate-400">{p.rate} {p.basis}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold" style={{ color: outOfRange ? '#DC2626' : FERN }}>{total} {unit}</p>
                      <p className="text-[10px] text-slate-400">{amt} {unit}/tank</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>

          {sheet.products.filter((p) => p.product).length > 0 && (
            <Card>
              <FieldLabel>Total Needed for This Spray</FieldLabel>
              <p className="font-body text-[11px] text-slate-400 mb-3">Pull these quantities from stock before you start</p>
              <div className="space-y-2">
                {sheet.products.filter((p) => p.product).map((p) => {
                  const { value: amt, unit } = calcAmount(parseFloat(p.rate), p.basis, area.sqft, p.forceGal)
                  const total = amt !== null ? Math.round(amt * sheet.tanks * 10) / 10 : null
                  const prodInfo = products?.find((pr) => pr.name === p.product)
                  const stock = prodInfo?.stock ?? null
                  const insufficient = stock !== null && total !== null && stock < total
                  return (
                    <div key={p.id} className="flex items-center justify-between rounded-xl px-3 py-2.5 font-body" style={{ backgroundColor: insufficient ? '#FEF2F2' : '#F0F6F2' }}>
                      <span className="text-sm font-semibold text-slate-800">{p.product}</span>
                      <div className="text-right">
                        <span className="text-sm font-bold" style={{ color: insufficient ? '#DC2626' : FERN }}>{total} {unit}</span>
                        {stock !== null && (
                          <p className="text-[10px] mt-0.5" style={{ color: insufficient ? '#DC2626' : '#94A3B8' }}>
                            {insufficient ? `Only ${stock} ${unit} in stock` : `${stock} ${unit} in stock`}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

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
                <Select value={sig} onChange={setSig} options={directors} placeholder="Select director to approve..." />
                <button onClick={() => sig && onApprove(sig)} disabled={!sig} className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40 flex items-center justify-center gap-2" style={{ backgroundColor: FOREST }}>
                  <CloudUpload size={15} /> Approve &amp; Push to iPads
                </button>
              </div>
            )}
            {sheet.status === 'pending' && !approve && (
              <p className="mt-4 pt-4 border-t border-slate-100 font-body text-xs text-slate-400">
                Only the Director of Grounds can approve. This sheet is waiting for sign-off.
              </p>
            )}
          </Card>
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

// ── CHEMICAL LIBRARY ──────────────────────────────────────────────────────
function ChemicalLibrary({ products, onSaveProduct, onDeleteProduct }) {
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState(null)
  const [filter, setFilter] = useState('All')

  const startEdit = (p) => {
    setEditing(p.name)
    setDraft({ ...p })
  }
  const startNew = () => {
    setEditing('new')
    setDraft({ name: '', type: 'Fungicide', rate: '', basis: 'oz / M', unit: 'oz', labelMaxM: '', labelMaxA: '', labelMinM: '', labelMinA: '', stock: '', lowStockThreshold: '', fertForm: 'granular', n: '', p: '', k: '', nPerGal: '', pPerGal: '', kPerGal: '' })
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
    }
    onSaveProduct(cleaned)
    cancelEdit()
  }

  const filtered = filter === 'All' ? products : products.filter((p) => p.type === filter)

  return (
    <div className="pt-6 pb-10">
      <div className="flex items-center justify-between mb-1">
        <SectionHeader title="Chemical Library" subtitle="Manage products, rates, and label maximums" noMargin />
        <button onClick={startNew} className="font-body text-xs font-bold px-3.5 py-2 rounded-full text-white flex items-center gap-1.5 shrink-0" style={{ backgroundColor: FOREST }}>
          <Plus size={14} /> Add Product
        </button>
      </div>

      <div className="flex gap-2 mt-4 mb-4 overflow-x-auto pb-1">
        {['All', ...PRODUCT_TYPES].map((t) => (
          <button key={t} onClick={() => setFilter(t)} className="font-body text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition" style={filter === t ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>
            {t}
          </button>
        ))}
      </div>

      {editing && draft && (
        <div className="bg-white rounded-2xl border-2 p-4 mb-4 shadow-sm" style={{ borderColor: GOLD }}>
          <p className="font-display text-base font-semibold text-slate-900 mb-3">{editing === 'new' ? 'Add New Chemical' : `Edit ${editing}`}</p>
          <div className="space-y-3">
            <div>
              <FieldLabel>Product Name</FieldLabel>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} disabled={editing !== 'new'} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body disabled:bg-slate-50 disabled:text-slate-400" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><FieldLabel>Type</FieldLabel><Select value={draft.type} onChange={(v) => setDraft({ ...draft, type: v })} options={PRODUCT_TYPES} /></div>
              <div><FieldLabel>Default Unit</FieldLabel><Select value={draft.unit} onChange={(v) => setDraft({ ...draft, unit: v })} options={['oz', 'fl oz', 'lbs', 'gal', 'ml']} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>Default Rate</FieldLabel>
                <input type="number" step="any" value={draft.rate ?? ''} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" placeholder="e.g. 1.8" />
              </div>
              <div><FieldLabel>Default Basis</FieldLabel><Select value={draft.basis} onChange={(v) => setDraft({ ...draft, basis: v })} options={['oz / M', 'oz / A', 'lbs / M', 'lbs / A', 'gal / M', 'gal / A']} /></div>
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
          <div className="bg-white rounded-2xl border border-black/5 p-10 text-center text-slate-400 font-body text-sm">No products in this category yet.</div>
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
                <Select value={draft.unit} onChange={(v) => setDraft({ ...draft, unit: v })} options={['oz', 'fl oz', 'lbs', 'gal', 'ml']} />
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
  const npkData = aggregateNPK(sheets, products, areas)

  const totalN = Math.round(npkData.reduce((s, r) => s + r.n, 0) * 100) / 100
  const totalP = Math.round(npkData.reduce((s, r) => s + r.p, 0) * 100) / 100
  const totalK = Math.round(npkData.reduce((s, r) => s + r.k, 0) * 100) / 100

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
        <SectionHeader title="N-P-K Reports" subtitle="Pulled automatically from every approved spray sheet" noMargin />
        <button onClick={exportCSV} className="font-body text-xs font-bold px-3.5 py-2 rounded-full text-white flex items-center gap-1.5 shrink-0" style={{ backgroundColor: FOREST }}>
          <Package size={14} /> Export Spreadsheet
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 mt-5 mb-5">
        <NPKStat label="Total N" value={totalN} color="#2563EB" />
        <NPKStat label="Total P" value={totalP} color="#D97706" />
        <NPKStat label="Total K" value={totalK} color="#7C3AED" />
      </div>

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

// ── SETTINGS ──────────────────────────────────────────────────────────────
function SettingsPage({ areas, operators, directors, targets, sheetTypes, courseInfo, onSave }) {
  const [section, setSection] = useState('course')

  return (
    <div className="pt-6 pb-10">
      <SectionHeader title="Settings" subtitle="Manage people, areas, and club details — changes apply everywhere instantly" />

      <div className="flex gap-2 mt-4 mb-5 overflow-x-auto pb-1">
        {[['course', 'Course Info'], ['people', 'People'], ['areas', 'Sprayer Areas'], ['lists', 'Lists']].map(([k, l]) => (
          <button key={k} onClick={() => setSection(k)} className="font-body text-xs font-semibold px-3.5 py-1.5 rounded-full whitespace-nowrap transition" style={section === k ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>
            {l}
          </button>
        ))}
      </div>

      {section === 'course' && <CourseInfoSettings courseInfo={courseInfo} onSave={onSave} />}
      {section === 'people' && <PeopleSettings operators={operators} directors={directors} onSave={onSave} />}
      {section === 'areas' && <AreasSettings areas={areas} onSave={onSave} />}
      {section === 'lists' && <ListsSettings targets={targets} sheetTypes={sheetTypes} onSave={onSave} />}
    </div>
  )
}

function CourseInfoSettings({ courseInfo, onSave }) {
  const [draft, setDraft] = useState(courseInfo)
  const dirty = JSON.stringify(draft) !== JSON.stringify(courseInfo)

  return (
    <Card>
      <FieldLabel>Club Name</FieldLabel>
      <input value={draft.clubName} onChange={(e) => setDraft({ ...draft, clubName: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body mb-3" />
      <FieldLabel>Department Name</FieldLabel>
      <input value={draft.deptName} onChange={(e) => setDraft({ ...draft, deptName: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body mb-3" />
      <button onClick={() => onSave({ courseInfo: draft })} disabled={!dirty} className="font-body text-xs font-bold px-4 py-2.5 rounded-full text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>
        Save Changes
      </button>
    </Card>
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

function PeopleSettings({ operators, directors, onSave }) {
  return (
    <div className="space-y-4">
      <NameListEditor title="Applicators" items={operators} accent={FERN} onSave={(list) => onSave({ operators: list })} />
      <NameListEditor title="Directors / Approvers" items={directors} accent="#92660D" onSave={(list) => onSave({ directors: list })} />
    </div>
  )
}

function ListsSettings({ targets, sheetTypes, onSave }) {
  return (
    <div className="space-y-4">
      <NameListEditor title="Spray Targets" items={targets} accent="#7C3AED" onSave={(list) => onSave({ targets: list })} />
      <NameListEditor title="Sheet Types" items={sheetTypes} accent={FOREST} onSave={(list) => onSave({ sheetTypes: list })} />
    </div>
  )
}

function AreasSettings({ areas, onSave }) {
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState(null)

  const startEdit = (name) => { setEditing(name); setDraft({ name, ...areas[name] }) }
  const startNew = () => {
    setEditing('__new__')
    setDraft({ name: '', gear: '', psi: '', tanks: 1, galTank: 0, sprayRate: 0, nozzle: '', sqft: 0 })
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

  return (
    <div className="min-h-screen" style={{ backgroundColor: CREAM }}>
      <div style={{ backgroundColor: FOREST }} className="text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-5 pb-4">
          <div className="mb-4">
            <p className="font-display text-[10px] tracking-[0.25em] uppercase" style={{ color: GOLD }}>Congressional Country Club</p>
            <h1 className="font-display text-2xl font-semibold mt-0.5">Turf Performance</h1>
          </div>
          <div className="flex gap-1 font-body text-sm overflow-x-auto">
            {[['dashboard', 'Dashboard'], ['gdd', 'Growing Degree Days'], ['clippings', 'Clipping Yields'], ['speed', 'Greens Speed']].map(([key, label]) => (
              <button key={key} onClick={() => setRoute(key)} className="px-3.5 py-1.5 rounded-full font-medium transition whitespace-nowrap" style={route === key ? { backgroundColor: 'rgba(255,255,255,0.12)', color: 'white' } : { color: 'rgba(255,255,255,0.5)' }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 pb-24 pt-6">
        {route === 'dashboard' && <TurfDashboardPlaceholder />}
        {route === 'gdd' && <ComingSoonCard title="Growing Degree Days" desc="Daily GDD pulled automatically from a nearby weather station, accumulated by base temperature — the foundation for PGR timing." />}
        {route === 'clippings' && <ComingSoonCard title="Clipping Yields" desc="Log clipping volume by green and date. This is measured manually on the course and entered here." />}
        {route === 'speed' && <ComingSoonCard title="Greens Speed" desc="Log Stimpmeter readings by green and date to track consistency over time." />}
      </div>
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
