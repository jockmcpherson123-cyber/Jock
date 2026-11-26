'use client'

// Tank Planner — work out the right number of tanks (whole or half) for an area
// so the water rate lands where you want, you keep a little spare in the tank so
// you don't run short mid-pass, and the Early Order quantities fall out of the
// tank count. Lives on the Annual Program; can push the chosen tank count onto
// every planned spray in the area.
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Beaker } from 'lucide-react'
import { FOREST, FERN, GOLD, HAIR, INK, INK_2, INK_3, RED, AMBER, PAPER } from '@/lib/theme'

const SQFT_PER_ACRE = 43560
const r2 = (n) => Math.round(n * 100) / 100
const fmtInt = (n) => (isFinite(n) ? Math.round(n).toLocaleString() : '0')
const GOLD_WASH = '#FBF4DF'
const BAND = '#EEF3EE'

export default function TankPlanner({ areas = [], onApplyTanks, defaultTankGal = 300, selectedArea = '' }) {
  const [open, setOpen] = useState(true)
  const areaList = (areas || []).filter((a) => a && a.name)
  const [areaName, setAreaName] = useState(areaList[0]?.name || '')
  const [areaUnit, setAreaUnit] = useState('ac')
  const [areaInput, setAreaInput] = useState('') // the TOTAL area for this spot, editable
  const [tankGal, setTankGal] = useState(String(defaultTankGal))
  const [target, setTarget] = useState('1.0')
  const [spare, setSpare] = useState('10')
  const [tanks, setTanks] = useState(1)
  const [applied, setApplied] = useState(null)

  const picked = areaList.find((a) => a.name === areaName)
  const areaSqft = areaUnit === 'ac' ? (Number(areaInput) || 0) * SQFT_PER_ACRE : (Number(areaInput) || 0)

  // Each area remembers its own setup: when the area changes, seed the total-area
  // box and the tank count from that area's current plan (editable). Stops one
  // area's tank count from bleeding onto the others.
  useEffect(() => {
    const ar = areaList.find((a) => a.name === areaName)
    const sqft = Number(ar?.sqft) || 0
    setAreaInput(sqft ? String(areaUnit === 'ac' ? Math.round((sqft / SQFT_PER_ACRE) * 100) / 100 : Math.round(sqft)) : '')
    if (ar && ar.tanks != null && isFinite(Number(ar.tanks)) && Number(ar.tanks) > 0) setTanks(Number(ar.tanks))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaName])

  // Follow the area chips at the top of the program — click Natives, then Rough,
  // and the planner moves with you.
  useEffect(() => {
    if (selectedArea && selectedArea !== 'all' && areaList.some((a) => a.name === selectedArea) && selectedArea !== areaName) {
      setAreaName(selectedArea)
      setApplied(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedArea])

  const switchUnit = (u) => {
    if (u === areaUnit) return
    const sqft = areaSqft
    setAreaUnit(u)
    setAreaInput(sqft ? String(u === 'ac' ? Math.round((sqft / SQFT_PER_ACRE) * 100) / 100 : Math.round(sqft)) : '')
  }
  const ts = Number(tankGal) || 0
  const tgt = Number(target) || 0
  const cushion = Number(spare) || 0

  const areaM = areaSqft / 1000
  const totGal = tanks * ts
  const applyGal = Math.max(0, totGal - cushion)          // water actually sprayed
  // The water rate to SET so you finish the area with the cushion still in the
  // tank. The rate flexes; the cushion is what stays fixed.
  const waterRate = areaM > 0 ? applyGal / areaM : 0
  const areaPerTank = tanks > 0 ? areaSqft / tanks : 0

  const options = useMemo(() => {
    if (!(areaSqft > 0 && ts > 0 && tgt > 0)) return []
    const am = areaSqft / 1000
    // tanks needed to apply the area at the target rate AND keep the cushion
    const needTotal = tgt * am + cushion
    const base = Math.max(0.5, Math.floor((needTotal / ts) * 2) / 2)
    const cands = []
    for (let k = 0; k <= 4; k++) cands.push(Math.round((base + k * 0.5) * 2) / 2)
    const uniq = [...new Set(cands.filter((x) => x >= 0.5))].sort((a, b) => a - b)
    return uniq.map((t) => {
      const total = t * ts
      const apply = Math.max(0, total - cushion)
      const rate = am > 0 ? apply / am : 0         // spray rate that leaves the cushion
      const delta = tgt > 0 ? rate - tgt : 0
      const partial = t % 1 !== 0
      return { t, total, apply, rate, delta, partial }
    })
  }, [areaSqft, ts, tgt, cushion])

  // best = the tank count whose spray rate (leaving the cushion) is closest to
  // your target rate; prefer a whole tank on a near tie.
  const best = useMemo(() => {
    let b = null
    options.forEach((r) => {
      if (!b || Math.abs(r.delta) < Math.abs(b.delta) - 0.0005 || (Math.abs(r.delta) < Math.abs(b.delta) + 0.0005 && !r.partial && b.partial)) b = r
    })
    return b
  }, [options])

  const tagFor = (r, isBest) => {
    if (isBest) return { label: 'Best fit', tone: 'good' }
    const pct = tgt > 0 ? (r.delta / tgt) * 100 : 0
    if (Math.abs(pct) <= 5) return { label: 'On target', tone: 'good' }
    return { label: pct < 0 ? 'Lighter' : 'Heavier', tone: Math.abs(pct) <= 15 ? 'warn' : 'bad' }
  }

  const toneColor = { good: FERN, warn: AMBER, bad: RED }
  const toneBg = { good: BAND, warn: GOLD_WASH, bad: '#FBEAE7' }

  const apply = () => {
    if (!onApplyTanks || !picked || !(tanks > 0)) return
    const perTank = tanks > 0 ? Math.round(areaSqft / tanks) : 0
    onApplyTanks(picked.name, tanks, r2(waterRate), perTank)
    setApplied(`${tanks % 1 === 0 ? tanks : tanks.toFixed(1)} tank${tanks === 1 ? '' : 's'} set on ${picked.name}`)
    setTimeout(() => setApplied(null), 3500)
  }

  const label10 = { fontSize: 9.5, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: INK_3 }
  const numInput = { border: `1px solid ${HAIR}`, borderRadius: 10, padding: '7px 10px', fontSize: 15, fontWeight: 600, color: INK, background: 'white', width: '100%' }

  return (
    <div className="rounded-2xl border shadow-sm mb-4" style={{ borderColor: HAIR, backgroundColor: 'white' }}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-4 py-3">
        <span className="inline-flex items-center gap-2 font-display text-base font-semibold" style={{ color: FOREST }}>
          <Beaker size={16} style={{ color: FERN }} /> Tank Planner
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="font-body text-[11px]" style={{ color: INK_3 }}>area → tanks → water rate → order</span>
          {open ? <ChevronUp size={16} style={{ color: INK_3 }} /> : <ChevronDown size={16} style={{ color: INK_3 }} />}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4">
          {/* inputs */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="block mb-1" style={label10}>Area</label>
              <select value={areaName} onChange={(e) => { setAreaName(e.target.value); setApplied(null) }} style={{ ...numInput }}>
                {areaList.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block mb-1" style={label10}>Total area <span className="normal-case tracking-normal" style={{ color: INK_3, fontWeight: 500 }}>· the whole spot</span></label>
              <div className="flex items-center gap-2">
                <input inputMode="decimal" value={areaInput} onChange={(e) => { setAreaInput(e.target.value); setApplied(null) }} placeholder={areaUnit === 'ac' ? 'e.g. 42.7' : 'e.g. 1859000'} style={{ ...numInput }} />
                <div className="inline-flex rounded-lg overflow-hidden shrink-0" style={{ border: `1px solid ${HAIR}` }}>
                  {['ac', 'ft'].map((u) => (
                    <button key={u} type="button" onClick={() => switchUnit(u)} className="font-body text-[11px] font-bold px-2.5 py-2" style={areaUnit === u ? { backgroundColor: FOREST, color: PAPER } : { backgroundColor: 'white', color: INK_3 }}>{u === 'ft' ? 'sq ft' : 'acres'}</button>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <label className="block mb-1" style={label10}>Tank size (gal)</label>
              <input inputMode="decimal" value={tankGal} onChange={(e) => setTankGal(e.target.value)} style={{ ...numInput }} />
            </div>
            <div>
              <label className="block mb-1" style={label10}>Number of tanks</label>
              <div className="inline-flex items-center gap-2 rounded-xl p-1" style={{ backgroundColor: '#E8E7E2' }}>
                <button type="button" onClick={() => setTanks((t) => Math.max(0.5, r2(t - 0.5)))} className="w-9 h-9 rounded-lg font-bold text-lg" style={{ backgroundColor: 'white', color: FOREST }}>−</button>
                <span className="font-display text-xl font-bold tabular-nums text-center" style={{ color: FOREST, minWidth: 46 }}>{tanks % 1 === 0 ? tanks : tanks.toFixed(1)}</span>
                <button type="button" onClick={() => setTanks((t) => r2(t + 0.5))} className="w-9 h-9 rounded-lg font-bold text-lg" style={{ backgroundColor: 'white', color: FOREST }}>+</button>
              </div>
            </div>
          </div>

          {/* set your target + cushion */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-3">
            <label className="flex items-center gap-1.5"><span style={label10}>Target rate</span>
              <input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} className="tabular-nums text-center" style={{ width: 60, border: 'none', borderBottom: `1.5px solid ${GOLD}`, padding: '2px 0', fontSize: 15, fontWeight: 600, color: INK, background: 'transparent' }} />
              <span className="font-body text-[11px]" style={{ color: INK_2 }}>gal/1000</span></label>
            <label className="flex items-center gap-1.5"><span style={label10}>Leave in tank</span>
              <input inputMode="decimal" value={spare} onChange={(e) => setSpare(e.target.value)} className="tabular-nums text-center" style={{ width: 52, border: 'none', borderBottom: `1.5px solid ${GOLD}`, padding: '2px 0', fontSize: 15, fontWeight: 600, color: INK, background: 'transparent' }} />
              <span className="font-body text-[11px]" style={{ color: INK_2 }}>gal left over</span></label>
          </div>

          {/* result — the rate to SET so you finish with the cushion left */}
          <div className="grid gap-2.5 mt-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' }}>
            <div className="rounded-xl p-3" style={{ backgroundColor: GOLD_WASH, border: `1px solid ${GOLD}` }}>
              <div style={label10}>Spray at this rate</div>
              <div className="font-display font-bold tabular-nums" style={{ color: FOREST, fontSize: 26 }}>{r2(waterRate).toFixed(2)}<span className="font-body text-[12px] font-semibold" style={{ color: INK_3 }}> gal/1000</span></div>
              <div className="font-body text-[10.5px] font-semibold mt-0.5" style={{ color: FERN }}>finishes with {fmtInt(cushion)} gal left in the tank</div>
            </div>
            <div className="rounded-xl p-3" style={{ border: `1px solid ${HAIR}` }}>
              <div style={label10}>Total mixed</div>
              <div className="font-display font-bold tabular-nums" style={{ color: FOREST, fontSize: 21 }}>{fmtInt(totGal)}<span className="font-body text-[12px] font-semibold" style={{ color: INK_3 }}> gal</span></div>
              <div className="font-body text-[10.5px] mt-0.5" style={{ color: INK_3 }}>{fmtInt(applyGal)} gal sprayed</div>
            </div>
            <div className="rounded-xl p-3" style={{ border: `1px solid ${HAIR}` }}>
              <div style={label10}>Area / tank</div>
              <div className="font-display font-bold tabular-nums" style={{ color: FOREST, fontSize: 21 }}>{fmtInt(areaPerTank)}<span className="font-body text-[12px] font-semibold" style={{ color: INK_3 }}> sq ft</span></div>
            </div>
          </div>

          {/* options — each tank count's spray rate (all leave your cushion) */}
          <div className="mt-4 pt-3 border-t" style={{ borderColor: HAIR }}>
            <p className="font-body text-[12px] mb-2.5" style={{ color: INK_2 }}>Each option already <b>covers the whole area</b> and leaves your {fmtInt(cushion)}‑gal cushion — only the <b>water rate changes</b>. Pick the tank count whose rate you like.</p>
            <div className="flex flex-col gap-2">
              {options.length === 0 && <p className="font-body text-[12px]" style={{ color: INK_3 }}>Enter area, tank size and a target rate.</p>}
              {options.map((r) => {
                const isBest = best && r.t === best.t
                const tg = tagFor(r, isBest)
                const pct = tgt > 0 ? (r.delta / tgt) * 100 : 0
                return (
                  <button key={r.t} type="button" onClick={() => setTanks(r.t)} className="grid items-center gap-3 rounded-xl px-3 py-2.5 text-left" style={{ gridTemplateColumns: 'auto 1fr auto', border: `1px solid ${isBest ? FERN : HAIR}`, backgroundColor: isBest ? BAND : 'white' }}>
                    <span className="font-display text-lg font-bold tabular-nums" style={{ color: FOREST }}>{r.t % 1 === 0 ? r.t : r.t.toFixed(1)}<span className="font-body text-[10px] font-semibold block -mt-0.5" style={{ color: INK_3 }}>tanks</span></span>
                    <span className="min-w-0">
                      <span className="font-body text-[14px] font-bold tabular-nums" style={{ color: INK }}>spray at {r2(r.rate).toFixed(2)} gal/1000</span>
                      <span className="font-body text-[11px] block" style={{ color: INK_3 }}>{fmtInt(r.total)} gal mixed · leaves {fmtInt(cushion)} gal · {Math.abs(pct) < 0.5 ? 'on target' : `${pct > 0 ? '+' : ''}${pct.toFixed(0)}% vs target`}</span>
                    </span>
                    <span className="font-body text-[10px] font-extrabold uppercase tracking-wide px-2 py-1 rounded-full whitespace-nowrap" style={{ color: toneColor[tg.tone], backgroundColor: toneBg[tg.tone] }}>{tg.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* apply */}
          {onApplyTanks && (
            <div className="mt-4 flex items-center gap-3 flex-wrap">
              <button type="button" onClick={apply} disabled={!picked || !(tanks > 0) || !(areaSqft > 0)} className="font-body text-[13px] font-bold px-4 py-2.5 rounded-full text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>
                Set {tanks % 1 === 0 ? tanks : tanks.toFixed(1)} tank{tanks === 1 ? '' : 's'} on {areaName}
              </button>
              <span className="font-body text-[11px]" style={{ color: INK_3 }}>Writes the tank count and area‑per‑tank onto every planned spray in the area, so the Early Order orders for the whole acreage.</span>
              {applied && <span className="font-body text-[12px] font-bold" style={{ color: FERN }}>✓ {applied}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
