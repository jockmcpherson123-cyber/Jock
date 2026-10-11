'use client'

// ── Product Performance ──────────────────────────────────────────────────────
// One unified tracker for how much "life" each product has left, by area. Every
// product fills toward its own 100% and then flags Reapply:
//   • Fungicides / fertilizers run on DAYS vs their label reapply interval
//     (lib/fungicides intervalDaysForProduct).
//   • PGRs and DMI fungicides run on GDD accumulated from the weather since the
//     spray (gddSince) vs the per-product regulation target (lib/pgrmodel).
// Replaces the old split "Recent Fungicide Sprays" + "Growth-Reg Timing" cards.

import { useEffect, useMemo, useState } from 'react'
import { fmtDate } from '@/lib/calc'
import { localDateISO } from '@/lib/dates'
import { gddSince, fetchSeasonDaily } from '@/lib/weather'
import { suppressionMap } from '@/lib/pgr'
import { modelForProduct, regulationStatus, withTargets, surfaceCol } from '@/lib/pgrmodel'
import { intervalDaysForProduct } from '@/lib/fungicides'
import { sheetApplied } from '@/lib/applied'
import { classifySurface } from '@/lib/programgen'
import { FOREST, FERN, GOLD, PAPER, PAPER_2, HAIR, INK, INK_2, INK_3, RED, AMBER } from '@/lib/theme'

const DAY = 86400000
const LOOKBACK = 120
const dBetween = (iso, today) => Math.max(0, Math.round((Date.parse(today + 'T00:00:00') - Date.parse(iso + 'T00:00:00')) / DAY))
const addDaysIso = (iso, n) => new Date(Date.parse(iso + 'T00:00:00') + n * DAY).toISOString().slice(0, 10)
const defaultInterval = (prod) => ((prod?.type || '').toLowerCase().includes('fert') ? { lower: 14, upper: 21 } : { lower: 10, upper: 14 })

const STATUS = {
  ok: { color: FERN, label: 'On program' },
  soon: { color: AMBER, label: 'Due soon' },
  reapply: { color: RED, label: '＋ Reapply now' },
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
      const rows = Object.entries(last[area]).map(([name, date]) => {
        const prod = prodByName[name]
        const kind = supMap[name] // 'pgr' | 'dmi' | undefined
        if (kind) {
          let model = modelForProduct(prod, kind)
          if (!model) return null
          model = withTargets(model, courseInfo?.pgrTargets?.[model.id])
          const gddF = gddSince(season, date, 32)
          if (gddF == null) return null
          const st = regulationStatus(model, gddF, sk)
          const pct = st.pct
          return {
            name, tag: kind === 'pgr' ? 'Growth Reg' : 'DMI · regulates too',
            metric: `GDD ${Math.round(gddF / 1.8)} / ${Math.round(st.target / 1.8)}`,
            life: `Down ${fmtDate(date)}`,
            pct, status: pct >= 1 ? 'reapply' : pct >= 0.8 ? 'soon' : 'ok',
          }
        }
        const iv = intervalDaysForProduct(prod) || defaultInterval(prod)
        const elapsed = dBetween(date, today)
        const target = iv.upper || 14
        const pct = target > 0 ? elapsed / target : 0
        return {
          name, tag: prod?.type || 'Product',
          metric: `Days ${elapsed} / ${target}`,
          life: `Down ${fmtDate(date)} → due ${fmtDate(addDaysIso(date, target))}`,
          pct, status: pct >= 1 ? 'reapply' : elapsed >= iv.lower ? 'soon' : 'ok',
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

  const MARK = 82 // the 100% dashed line sits here, leaving room for Reapply
  return (
    <section>
      <SectionTitle title={title} subtitle="How much residual each product has left, by area. Fungicides run on days, growth regulators on GDD — the dashed line is 100% (reapply)." />
      <div className="paper-card px-4 pt-3 pb-1">
        {/* area tabs */}
        <div className="flex gap-5 overflow-x-auto border-b" style={{ borderColor: HAIR }}>
          {areaNames.map((a) => (
            <button key={a} onClick={() => setTab(a)} className="relative font-body text-sm font-bold whitespace-nowrap pb-2.5" style={{ color: a === tab ? FOREST : INK_3 }}>
              {a} <span style={{ color: INK_3 }}>({byArea[a].length})</span>
              {a === tab && <span style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 2.5, background: GOLD, borderRadius: 2 }} />}
            </button>
          ))}
        </div>

        {rows.map((r, i) => {
          const s = STATUS[r.status]
          const fillW = Math.min(r.pct, 1.18) * MARK
          return (
            <div key={r.name} className="py-3.5" style={{ borderBottom: i < rows.length - 1 ? `1px solid #EFEDE8` : 'none' }}>
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className="font-display text-[17px] font-bold" style={{ color: FOREST }}>{r.name}</span>
                <span className="font-body text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full" style={{ background: PAPER_2, color: INK_2 }}>{r.tag}</span>
                <span className="font-body text-[12px] font-semibold px-2.5 py-1 rounded-full" style={{ background: '#fff', border: `1px solid ${HAIR}`, color: INK_2 }}>{r.life}</span>
                <span className="font-body text-[12px] px-2.5 py-1 rounded-full" style={{ background: '#fff', border: `1px solid ${HAIR}`, color: FOREST, fontWeight: 700 }}>{r.metric}</span>
                <span className="flex-1" />
                <span className="font-body text-[13px] font-bold" style={{ color: s.color }}>{s.label}</span>
              </div>
              <div className="relative" style={{ height: 16 }}>
                <div style={{ position: 'absolute', inset: 0, height: 16, borderRadius: 8, background: '#E7E5DF' }} />
                <div style={{ position: 'absolute', left: 0, top: 0, height: 16, width: `${Math.max(3, fillW)}%`, borderRadius: 8, background: s.color }} />
                <div style={{ position: 'absolute', top: -5, bottom: -5, left: `${MARK}%`, borderLeft: '2px dashed #B9B6AE' }} />
              </div>
            </div>
          )
        })}
      </div>
      <p className="font-body text-[10px] mt-1.5" style={{ color: INK_3 }}>
        Day intervals come from the product label; GDD comes from your weather. A memory aid for reapply timing, not a lab test — the label is the law.
      </p>
    </section>
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
