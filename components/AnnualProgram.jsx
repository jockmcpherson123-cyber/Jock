'use client'

// ── Annual Program ──────────────────────────────────────────────────────────
// The season-long spray plan: import it from the existing Excel pesticide plan,
// then browse it by area. (Editing individual applications, the early-order
// calculator and auto-populating spray sheets come in the next phase.)
import { useState, useEffect, useRef } from 'react'
import { Upload, Calendar, Trash2, Loader2, AlertTriangle, Check, FileSpreadsheet } from 'lucide-react'
import * as db from '@/lib/db'
import { parseWorkbook } from '@/lib/importXlsx'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#C9A84C'

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function AnnualProgram({ areas, onProductsChanged }) {
  const [programs, setPrograms] = useState([])
  const [activeProgram, setActiveProgram] = useState(null)
  const [apps, setApps] = useState([])
  const [loading, setLoading] = useState(true)
  const [areaFilter, setAreaFilter] = useState('all')
  const [imp, setImp] = useState(null) // import flow state
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const fileRef = useRef(null)

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
  const areaNames = Object.keys(areaCounts)
  const visibleApps = areaFilter === 'all' ? apps : apps.filter((a) => a.area === areaFilter)

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
        <div className="flex items-center gap-2">
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

      {/* No program yet */}
      {programs.length === 0 && !imp && (
        <div className="bg-white rounded-2xl border border-black/5 p-10 text-center shadow-sm mt-4">
          <FileSpreadsheet className="mx-auto mb-3 text-slate-300" size={30} />
          <p className="font-display text-lg font-semibold text-slate-900 mb-1">No program yet</p>
          <p className="font-body text-sm text-slate-400 max-w-sm mx-auto mb-5">
            Import your existing Excel pesticide plan to load the whole season at once — every area's planned applications, plus your full product list.
          </p>
          <button onClick={() => fileRef.current?.click()} className="font-body text-xs font-bold px-4 py-2.5 rounded-full text-white inline-flex items-center gap-1.5" style={{ backgroundColor: FOREST }}>
            <Upload size={14} /> Import from Excel
          </button>
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

          {/* Applications list */}
          {visibleApps.length === 0 ? (
            <div className="bg-white rounded-2xl border border-black/5 p-8 text-center text-slate-400 font-body text-sm">No applications in this program.</div>
          ) : (
            <div className="bg-white rounded-2xl border border-black/5 overflow-hidden shadow-sm">
              {visibleApps.map((a, i) => (
                <div key={a.id} className={`flex items-center gap-3 px-4 py-3 ${i !== 0 ? 'border-t border-black/5' : ''}`}>
                  <div className="w-14 shrink-0 text-center">
                    <p className="font-body text-[11px] font-bold text-slate-500 flex items-center justify-center gap-1"><Calendar size={10} />{fmtDate(a.plannedDate)}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-body text-sm font-semibold text-slate-800 truncate">{a.product}</p>
                    <p className="font-body text-[11px] text-slate-400 truncate">
                      {areaFilter === 'all' ? `${a.area} · ` : ''}{a.rateOzM} oz/M{a.target ? ` · ${a.target}` : ''}
                    </p>
                  </div>
                  {a.type && (
                    <span className="font-body text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0" style={{ backgroundColor: '#F0F6F2', color: FERN }}>{a.type}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
