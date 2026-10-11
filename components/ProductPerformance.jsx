'use client'

// ── Product Performance ──────────────────────────────────────────────────────
// One unified tracker for how much "life" each product has left, by area. Every
// product fills toward its own 100% and then flags Reapply:
//   • Fungicides / fertilizers run on DAYS vs their label reapply interval
//     (lib/fungicides intervalDaysForProduct).
//   • PGRs and DMI fungicides run on GDD accumulated from the weather since the
//     spray (gddSince) vs the per-product regulation target (lib/pgrmodel).
//
// Products are grouped BY JOB, not by SKU. A newer application that does the
// same job (growth regulation, the same disease, or the same nutrient) resets
// the clock and HIDES the older product it fully covers — so you see the one
// product actually protecting the turf, not a stack of overlapping timers.

import { useEffect, useMemo, useState } from 'react'
import { fmtDate } from '@/lib/calc'
import { localDateISO } from '@/lib/dates'
import { gddSince, fetchSeasonDaily } from '@/lib/weather'
import { suppressionMap } from '@/lib/pgr'
import { modelForProduct, regulationStatus, withTargets, surfaceCol } from '@/lib/pgrmodel'
import { intervalDaysForProduct, diseaseJobsForProduct } from '@/lib/fungicides'
import { sheetApplied } from '@/lib/applied'
import { classifySurface } from '@/lib/programgen'
import { FOREST, FERN, GOLD, PAPER_2, HAIR, INK_2, INK_3, RED, AMBER } from '@/lib/theme'

const DAY = 86400000
const LOOKBACK = 120
const dBetween = (iso, today) => Math.max(0, Math.round((Date.parse(today + 'T00:00:00') - Date.parse(iso + 'T00:00:00')) / DAY))
const addDaysIso = (iso, n) => new Date(Date.parse(iso + 'T00:00:00') + n * DAY).toISOString().slice(0, 10)
const defaultInterval = (prod) => ((prod?.type || '').toLowerCase().includes('fert') ? { lower: 14, upper: 21 } : { lower: 10, upper: 14 })
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

const STATUS = {
  ok: { color: FERN, label: 'On program' },
  soon: { color: AMBER, label: 'Due soon' },
  reapply: { color: RED, label: 'Reapply' },
}

// The jobs a product does — used to decide when a newer spray supersedes it.
// An empty list means "we can't classify it", so it never hides and is never
// hidden by anything but a fresh application of the same product.
function jobsForProduct(prod, kind) {
  const jobs = []
  if (kind) jobs.push('growth') // true PGR or growth-suppressing DMI — one clock
  diseaseJobsForProduct(prod).forEach((id) => jobs.push('dis:' + id))
  if (num(prod?.n) > 0) jobs.push('nut:N')
  if (num(prod?.p) > 0) jobs.push('nut:P')
  if (num(prod?.k) > 0) jobs.push('nut:K')
  return jobs
}

export default function ProductPerformance({ sheets = [], products = [], daily = [], location = null, courseInfo = {}, title = 'Product Performance' }) {
  const [season, setSeason] = useState(daily)
  useEffect(() => { if (daily && daily.length) setSeason(daily) }, [daily])
  useEffect(() => {
    if ((daily && daily.length) || !location?.lat) return
    let off = false
    ;(async () => { try { const s = await fetchSeasonDaily(location.lat, location.lng); if (!off) setSeason(s) } catch { /* ignore */ } })()
    return () => { off = true }
  }, [daily, location])

  const prodByName = useMemo(() => Object.fromEntries((products || []).map((p) => [p.name, p])), [products])
  const supMap = useMemo(() => suppressionMap(products), [products])
  const today = localDateISO()

  const byArea = useMemo(() => {
    const cutoff = addDaysIso(today, -LOOKBACK)
    const last = {} // area -> product -> most recent applied date
    ;(sheets || [])
      .filter((s) => sheetApplied(s) && s.date && s.area && s.date <= today && s.date >= cutoff)
      .forEach((s) => (s.products || []).filter((p) => p.product && prodByName[p.product]).forEach((p) => {
        const a = (last[s.area] ||= {})
        if (!a[p.product] || s.date > a[p.product]) a[p.product] = s.date
      }))

    const out = {}
    Object.keys(last).forEach((area) => {
      const sk = surfaceCol(classifySurface(area))

      // Build a raw record per product, with its most-recent date and jobs.
      const raws = Object.entries(last[area]).map(([name, date]) => {
        const prod = prodByName[name]
        const kind = supMap[name] // 'pgr' | 'dmi' | undefined
        return { name, date, prod, kind, jobs: jobsForProduct(prod, kind) }
      })

      // Newest application date seen for each job across this area.
      const newestByJob = {}
      raws.forEach((r) => r.jobs.forEach((j) => { if (!newestByJob[j] || r.date > newestByJob[j]) newestByJob[j] = r.date }))

      // Keep a product only if it is the newest (or tied) in at least one of its
      // jobs. If every job it does has a newer product covering it, it's fully
      // superseded and drops off.
      const kept = raws.filter((r) => r.jobs.length === 0 || r.jobs.some((j) => newestByJob[j] <= r.date))

      const rows = kept.map((r) => {
        const { name, date, prod, kind } = r
        if (kind) {
          let model = modelForProduct(prod, kind)
          if (!model) return null
          model = withTargets(model, courseInfo?.pgrTargets?.[model.id])
          const gddF = gddSince(season, date, 32)
          if (gddF == null) return null
          const st = regulationStatus(model, gddF, sk)
          const have = Math.round(gddF / 1.8)
          const target = Math.round(st.target / 1.8)
          const pct = st.pct
          const status = pct >= 1 ? 'reapply' : pct >= 0.8 ? 'soon' : 'ok'
          const diff = Math.abs(have - target)
          return {
            name, tag: kind === 'pgr' ? 'Growth Reg' : (prod?.type || 'Fungicide'),
            have, target, unit: 'GDD', pct, status, down: date,
            delta: status === 'reapply' ? `${diff} GDD over` : `${diff} GDD to go`,
          }
        }
        const iv = intervalDaysForProduct(prod) || defaultInterval(prod)
        const elapsed = dBetween(date, today)
        const target = iv.upper || 14
        const pct = target > 0 ? elapsed / target : 0
        const status = pct >= 1 ? 'reapply' : elapsed >= iv.lower ? 'soon' : 'ok'
        const over = elapsed - target
        const left = Math.max(0, target - elapsed)
        return {
          name, tag: prod?.type || 'Product',
          have: elapsed, target, unit: 'd', pct, status, down: date,
          delta: status === 'reapply'
            ? `${over} day${over === 1 ? '' : 's'} over`
            : `${left} day${left === 1 ? '' : 's'} left`,
        }
      }).filter(Boolean).sort((a, b) => b.pct - a.pct)

      if (rows.length) out[area] = rows
    })
    return out
  }, [sheets, prodByName, supMap, season, courseInfo, today])

  const areaNames = Object.keys(byArea)
  const [tab, setTab] = useState('')
  useEffect(() => { if (areaNames.length && !byArea[tab]) setTab(areaNames[0]) }, [areaNames, byArea, tab])
  const rows = byArea[tab] || []

  if (!areaNames.length) {
    return (
      <section>
        <SectionTitle title={title} />
        <div className="paper-card p-5 text-center font-body text-sm" style={{ color: INK_3 }}>
          No applications logged in the last {LOOKBACK} days yet — approve a spray and products will show up here.
        </div>
      </section>
    )
  }

  const counts = { reapply: 0, soon: 0, ok: 0 }
  rows.forEach((r) => { counts[r.status]++ })
  const MARK = 82 // the 100% dashed line sits here, leaving room for an over-bar

  return (
    <section>
      <SectionTitle title={title} subtitle="Residual left per product, by area. Days from the label, GDD from your weather — the dashed line is reapply." />
      <div className="paper-card px-4 pt-3 pb-2">
        {/* area tabs */}
        <div className="flex gap-5 overflow-x-auto border-b" style={{ borderColor: HAIR }}>
          {areaNames.map((a) => (
            <button key={a} onClick={() => setTab(a)} className="relative font-body text-sm font-bold whitespace-nowrap pb-2.5" style={{ color: a === tab ? FOREST : INK_3 }}>
              {a} <span style={{ color: INK_3 }}>({byArea[a].length})</span>
              {a === tab && <span style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 2.5, background: GOLD, borderRadius: 2 }} />}
            </button>
          ))}
        </div>

        {/* at-a-glance summary for this area */}
        <div className="flex gap-2 flex-wrap mt-3 mb-1">
          <SummaryChip n={counts.reapply} label="reapply" color={RED} bg="#F6E7E4" />
          <SummaryChip n={counts.soon} label="due soon" color={AMBER} bg="#F6EEDC" />
          <SummaryChip n={counts.ok} label="on program" color={FERN} bg="#E6EFE8" />
        </div>

        {rows.map((r, i) => {
          const s = STATUS[r.status]
          const fillW = Math.min(r.pct, 1.18) * MARK
          return (
            <div key={r.name} className="py-2.5" style={{ borderBottom: i < rows.length - 1 ? '1px solid #EFEDE8' : 'none' }}>
              <div className="flex items-baseline gap-2">
                <span className="font-display text-[16px] font-bold leading-tight" style={{ color: FOREST }}>{r.name}</span>
                <span className="font-body text-[9.5px] font-bold uppercase tracking-wider" style={{ color: INK_3 }}>{r.tag}</span>
                <span className="flex-1" />
                <span className="font-body text-[12px] font-bold whitespace-nowrap" style={{ color: INK_2, fontVariantNumeric: 'tabular-nums' }}>
                  {r.have} / {r.target}<span style={{ color: INK_3, fontWeight: 600 }}> {r.unit}</span>
                </span>
              </div>
              <div className="relative" style={{ height: 9, margin: '7px 0 6px' }}>
                <div style={{ position: 'absolute', inset: 0, borderRadius: 6, background: '#E6E4DE' }} />
                <div style={{ position: 'absolute', left: 0, top: 0, height: 9, width: `${Math.max(3, fillW)}%`, borderRadius: 6, background: s.color }} />
                <div style={{ position: 'absolute', top: -3, bottom: -3, left: `${MARK}%`, borderLeft: '1.5px dashed #BDBAB2' }} />
              </div>
              <div className="flex items-center gap-2">
                <span className="font-body text-[11px] whitespace-nowrap" style={{ color: INK_3 }}>down {fmtDate(r.down)}</span>
                <span className="flex-1" />
                <span className="font-body text-[11.5px] font-extrabold whitespace-nowrap" style={{ color: s.color }}>{r.delta}</span>
              </div>
            </div>
          )
        })}
      </div>
      <p className="font-body text-[10px] mt-1.5" style={{ color: INK_3 }}>
        A newer spray that does the same job (growth reg, the same disease, or the same nutrient) resets the clock and hides the product it replaced. A memory aid for reapply timing, not a lab test — the label is the law.
      </p>
    </section>
  )
}

function SummaryChip({ n, label, color, bg }) {
  if (!n) return null
  return (
    <span className="font-body text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5" style={{ background: bg, color }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
      {n} {label}
    </span>
  )
}

function SectionTitle({ title, subtitle }) {
  return (
    <div className="mb-2">
      <h2 className="font-display text-lg font-bold" style={{ color: FOREST }}>{title}</h2>
      {subtitle && <p className="font-body text-xs mt-0.5" style={{ color: INK_2 }}>{subtitle}</p>}
    </div>
  )
}
