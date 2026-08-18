// Mixing / tank helper — turns a spray sheet's product list into: the correct
// fill ORDER (by formulation), the amount + measure-out per tank, each liquid's
// share of the tank, the total spray solution, and a stock check (are we short
// for the whole job?). Pure and testable; the sheet view and the editor both
// render from it.
import { calcAmount, measureOut } from './calc'
import { effectiveFormulation, FORMULATION_LABEL, mixRank, DEFAULT_MIX_ORDER } from './defaults'

const OZ = { oz: 1, 'fl oz': 1, floz: 1, gal: 128, gals: 128, gallon: 128, qt: 32, pt: 16, cup: 8, l: 33.814, ml: 0.033814 }
const toOz = (v, u) => { const k = OZ[String(u || '').toLowerCase().trim()]; return k != null ? v * k : null }
const round = (n, d = 1) => { const f = 10 ** d; return Math.round(n * f) / f }

export function mixPlan(sheet, area, productsLib, mixOrder = DEFAULT_MIX_ORDER) {
  const tanks = Math.max(1, Number(sheet?.tanks) || 1)
  const tankGal = Number(area?.galTank) || 0
  const sqft = Number(area?.sqft) || 0
  const byName = {}
  ;(productsLib || []).forEach((p) => { byName[p.name] = p })

  const lines = (sheet?.products || []).filter((p) => p.product).map((p) => {
    const prod = byName[p.product] || {}
    const { value: perTank, unit } = calcAmount(parseFloat(p.rate), p.basis, sqft, p.forceGal)
    const total = perTank != null ? round(perTank * tanks) : null
    const form = effectiveFormulation(prod)
    const jug = prod.jugSize > 0 ? { size: Number(prod.jugSize), unit: prod.jugUnit || 'gal' } : null
    const oz = perTank != null ? toOz(perTank, unit) : null // per-tank in fl oz; null = dry
    const pctOfTank = (oz != null && tankGal > 0) ? round((oz / (tankGal * 128)) * 100, 1) : null
    const stock = prod.stock != null && prod.stock !== '' ? Number(prod.stock) : null
    const short = stock != null && total != null && stock < total
    return {
      id: p.id, name: p.product, rate: p.rate, basis: p.basis,
      form, formLabel: FORMULATION_LABEL[form] || 'Other', rank: mixRank(form, mixOrder),
      perTank, unit, total, measure: measureOut(perTank, unit, jug),
      pctOfTank, dry: oz == null, ozPerTank: oz,
      stock, need: total, short, stockUnit: prod.stockUnit || unit,
    }
  })

  const steps = [...lines].sort((a, b) => (a.rank - b.rank) || 0)
  const liquidOzPerTank = lines.reduce((s, l) => s + (l.ozPerTank || 0), 0)
  const totalLiquidPct = tankGal > 0 ? round((liquidOzPerTank / (tankGal * 128)) * 100, 1) : null
  const stockIssues = lines.filter((l) => l.short)

  return {
    steps,
    tanks,
    tankGal,
    totalSolutionGal: round(tankGal * tanks),
    totalLiquidPct,
    stockIssues,
    hasProducts: lines.length > 0,
  }
}
