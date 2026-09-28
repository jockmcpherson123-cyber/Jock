'use client'

// Spray batch calculator for a sheet: punch in the area (acres or sq ft) and a
// water/carrier rate (gal per 1,000 sq ft, or per acre), and it works out the
// total spray water, tanks needed, and each product's total + per-tank amount.
// Reuses the app's calcAmount so the numbers match the rest of the sheet.
import { Calculator } from 'lucide-react'
import { calcAmount, measureOut } from '@/lib/calc'
import { FOREST, FERN, GOLD, INK, INK_2, INK_3, HAIR } from '@/lib/theme'

const numOf = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n }
const fmt = (n, d = 0) => (n == null || isNaN(n) ? '—' : (Math.round(n * 10 ** d) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: d }))

export default function SprayBatchCalc({ products = [], area = {}, value = {}, onChange }) {
  const v = value || {}
  const areaUnit = v.areaUnit || 'sqft'
  const derivedRate = area?.galTank && area?.sqft ? Math.round((Number(area.galTank) / (Number(area.sqft) / 1000)) * 100) / 100 : ''
  // effective (with sensible defaults) values used for the math
  const areaValStr = v.areaVal ?? (area?.sqft ? String(area.sqft) : '')
  const waterRateStr = v.waterRate ?? (derivedRate ? String(derivedRate) : '')
  const waterUnit = v.waterUnit || 'gal/M'
  const tankGalStr = v.tankGal ?? (area?.galTank ? String(area.galTank) : '')

  const set = (patch) => onChange?.({ areaUnit, areaVal: areaValStr, waterRate: waterRateStr, waterUnit, tankGal: tankGalStr, ...patch })

  const areaSqft = areaUnit === 'acres' ? numOf(areaValStr) * 43560 : numOf(areaValStr)
  const M = areaSqft / 1000, acres = areaSqft / 43560
  const rate = numOf(waterRateStr)
  const totalWater = waterUnit === 'gal/A' ? rate * acres : rate * M
  const tankGal = numOf(tankGalStr)
  const tanks = tankGal > 0 && totalWater > 0 ? Math.ceil(totalWater / tankGal) : null
  // area one full tank covers, from the water rate
  const sqftPerTank = tankGal > 0 && rate > 0 ? (waterUnit === 'gal/A' ? (tankGal / rate) * 43560 : (tankGal / rate) * 1000) : null

  const rows = (products || []).filter((p) => p.product).map((p) => {
    const r = p.rate !== '' && p.rate != null ? p.rate : p.defaultRate
    const total = calcAmount(parseFloat(r), p.basis, areaSqft, p.forceGal)
    const per = sqftPerTank ? calcAmount(parseFloat(r), p.basis, Math.min(areaSqft, sqftPerTank), p.forceGal) : { value: null, unit: null }
    return { name: p.product, basis: p.basis, rate: r, total, per }
  })

  // Liquid products (oz = fluid oz, or gal) take up room in the tank; dry ones
  // (lbs/g) dissolve, so we don't subtract them. Water to meter = spray volume
  // minus the liquid product volume.
  const liquidGal = (res) => res.value == null ? 0 : res.unit === 'gal' ? res.value : res.unit === 'oz' ? res.value / 128 : 0
  const totalLiquidGal = rows.reduce((s, r) => s + liquidGal(r.total), 0)
  const perTankLiquidGal = rows.reduce((s, r) => s + liquidGal(r.per), 0)
  const waterTotal = totalWater > 0 ? Math.max(0, totalWater - totalLiquidGal) : 0
  const waterPerFullTank = tanks && tanks > 1 && tankGal > 0 ? Math.max(0, tankGal - perTankLiquidGal) : null

  const box = { border: `1px solid ${HAIR}`, borderRadius: 10, padding: '8px 10px', background: '#fff' }
  const lbl = { fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: INK_3, marginBottom: 3 }
  const inputCls = 'w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-body'
  const pill = (on) => ({ fontSize: 12, fontWeight: 700, padding: '6px 10px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${on ? FOREST : HAIR}`, background: on ? FOREST : '#fff', color: on ? '#fff' : INK_2 })

  return (
    <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4">
      <div className="flex items-center gap-2 mb-3">
        <span style={{ width: 24, height: 24, borderRadius: 7, background: FOREST, color: GOLD, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Calculator size={13} /></span>
        <p className="font-display text-base font-semibold" style={{ color: INK }}>Batch calculator</p>
      </div>

      {/* inputs */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
        <div>
          <div style={lbl}>Area treated</div>
          <div className="flex items-center gap-1.5">
            <input inputMode="decimal" value={areaValStr} onChange={(e) => set({ areaVal: e.target.value.replace(/[^\d.]/g, '') })} placeholder={areaUnit === 'acres' ? '2.5' : '30000'} className={inputCls} />
            <div className="flex gap-1 shrink-0">
              <span onClick={() => set({ areaUnit: 'sqft' })} style={pill(areaUnit === 'sqft')}>ft²</span>
              <span onClick={() => set({ areaUnit: 'acres' })} style={pill(areaUnit === 'acres')}>ac</span>
            </div>
          </div>
        </div>
        <div>
          <div style={lbl}>Water rate</div>
          <div className="flex items-center gap-1.5">
            <input inputMode="decimal" value={waterRateStr} onChange={(e) => set({ waterRate: e.target.value.replace(/[^\d.]/g, '') })} placeholder="1.44" className={inputCls} />
            <div className="flex gap-1 shrink-0">
              <span onClick={() => set({ waterUnit: 'gal/M' })} style={pill(waterUnit === 'gal/M')}>gal/M</span>
              <span onClick={() => set({ waterUnit: 'gal/A' })} style={pill(waterUnit === 'gal/A')}>gal/ac</span>
            </div>
          </div>
          {waterUnit === 'gal/M' && (
            <div className="flex gap-1.5 mt-1.5">
              {[1, 1.44, 2].map((r) => <span key={r} onClick={() => set({ waterRate: String(r) })} className="font-body" style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${HAIR}`, color: FERN }}>{r} gal</span>)}
            </div>
          )}
        </div>
        <div>
          <div style={lbl}>Tank size (gal)</div>
          <input inputMode="decimal" value={tankGalStr} onChange={(e) => set({ tankGal: e.target.value.replace(/[^\d.]/g, '') })} placeholder="300" className={inputCls} />
        </div>
      </div>

      {/* headline results */}
      <div className="grid gap-2 mt-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))' }}>
        <div style={box}><div style={lbl}>Area</div><div style={{ fontSize: 15, fontWeight: 700, color: INK }}>{fmt(acres, 2)} ac</div><div style={{ fontSize: 11, color: INK_3 }}>{fmt(areaSqft)} ft² · {fmt(M, 1)} M</div></div>
        <div style={box}><div style={lbl}>Total spray mix</div><div style={{ fontSize: 15, fontWeight: 700, color: INK }}>{fmt(totalWater, 1)} gal</div><div style={{ fontSize: 11, color: INK_3 }}>at {waterRateStr || '—'} {waterUnit === 'gal/A' ? 'gal/ac' : 'gal/1000'}</div></div>
        <div style={{ ...box, borderColor: FERN, background: '#F4F8F5' }}><div style={{ ...lbl, color: FERN }}>Water to meter in</div><div style={{ fontSize: 15, fontWeight: 800, color: FOREST }}>{fmt(waterTotal, 1)} gal</div><div style={{ fontSize: 11, color: INK_3 }}>mix − {fmt(totalLiquidGal, 1)} gal product</div></div>
        <div style={box}><div style={lbl}>Tanks</div><div style={{ fontSize: 15, fontWeight: 700, color: INK }}>{tanks != null ? `${tanks}` : '—'}</div><div style={{ fontSize: 11, color: INK_3 }}>{tankGal > 0 ? `× ${fmt(tankGal)} gal` : 'set tank size'}</div></div>
      </div>

      {waterPerFullTank != null && (
        <div className="mt-2 rounded-lg px-3 py-2" style={{ background: '#F4F8F5', border: `1px solid ${HAIR}` }}>
          <span className="font-body" style={{ fontSize: 12.5, color: INK_2 }}>Per full tank: meter in <b style={{ color: FOREST }}>{fmt(waterPerFullTank, 1)} gal water</b> + {fmt(perTankLiquidGal, 1)} gal product = {fmt(tankGal)} gal.</span>
        </div>
      )}

      {/* per-product */}
      {rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: INK_3, textAlign: 'left' }}>
                <th className="font-body font-bold py-1 pr-2" style={{ fontSize: 10, letterSpacing: '.05em', textTransform: 'uppercase' }}>Product</th>
                <th className="font-body font-bold py-1 px-2" style={{ fontSize: 10, letterSpacing: '.05em', textTransform: 'uppercase' }}>Rate</th>
                <th className="font-body font-bold py-1 px-2 text-right" style={{ fontSize: 10, letterSpacing: '.05em', textTransform: 'uppercase' }}>Per tank</th>
                <th className="font-body font-bold py-1 pl-2 text-right" style={{ fontSize: 10, letterSpacing: '.05em', textTransform: 'uppercase' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const totalStr = r.total.value != null ? `${fmt(r.total.value, r.total.unit === 'oz' ? 0 : 1)} ${r.total.unit}` : '—'
                const perStr = r.per.value != null ? `${fmt(r.per.value, r.per.unit === 'oz' ? 0 : 1)} ${r.per.unit}` : '—'
                const mo = r.total.value != null ? measureOut(r.total.value, r.total.unit) : null
                return (
                  <tr key={i} style={{ borderTop: `1px solid ${HAIR}` }}>
                    <td className="font-body py-1.5 pr-2" style={{ color: INK, fontWeight: 600 }}>{r.name}</td>
                    <td className="font-body py-1.5 px-2" style={{ color: INK_2 }}>{r.rate ? `${r.rate} ${r.basis || ''}` : '—'}</td>
                    <td className="font-body py-1.5 px-2 text-right tabular-nums" style={{ color: INK_2 }}>{perStr}</td>
                    <td className="font-body py-1.5 pl-2 text-right tabular-nums" style={{ color: INK, fontWeight: 700 }}>{totalStr}{mo ? <span style={{ display: 'block', fontSize: 10, fontWeight: 400, color: INK_3 }}>{mo}</span> : null}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="font-body mt-2" style={{ fontSize: 10.5, color: INK_3 }}>Water to meter in = spray volume minus the liquid product volume (dry products dissolve, so they're not subtracted). Per-tank is one full tank; a job under one tank shows the whole amount. Always verify against the label.</p>
    </div>
  )
}
