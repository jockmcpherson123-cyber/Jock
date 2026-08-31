// Pure calculation helpers — the working spray/fertilizer math from the
// prototype, unchanged. These have no database or UI dependencies, so the app,
// reports, and (later) the annual program builder can all share one source of
// truth for the numbers.

import { localDateISO } from './dates'
import { sheetApplied } from './applied'

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

// Convert a quantity from one unit to another.
// Volume units convert through milliliters; weight units convert through grams.
// "oz" is treated as a volume (fluid ounce) unit here, matching how the spray
// math uses it. Cross-converting weight <-> volume needs density, so that case
// is returned unchanged and flagged in the UI.
const ML_PER_UNIT = { 'fl oz': 29.5735, oz: 29.5735, pt: 473.176, qt: 946.353, gal: 3785.41, ml: 1, L: 1000 }
const G_PER_UNIT = { lbs: 453.592, kg: 1000, g: 1 }

const VOLUME_UNITS = Object.keys(ML_PER_UNIT)
const WEIGHT_UNITS = Object.keys(G_PER_UNIT)

export function convertUnits(qty, fromUnit, toUnit) {
  if (!qty || fromUnit === toUnit) return qty
  if (VOLUME_UNITS.includes(fromUnit) && VOLUME_UNITS.includes(toUnit)) {
    const ml = qty * ML_PER_UNIT[fromUnit]
    return Math.round((ml / ML_PER_UNIT[toUnit]) * 1000) / 1000
  }
  if (WEIGHT_UNITS.includes(fromUnit) && WEIGHT_UNITS.includes(toUnit)) {
    const g = qty * G_PER_UNIT[fromUnit]
    return Math.round((g / G_PER_UNIT[toUnit]) * 1000) / 1000
  }
  // weight <-> volume can't be converted without density — log as-is
  return qty
}

export function unitsAreCompatible(unitA, unitB) {
  const aIsVolume = VOLUME_UNITS.includes(unitA)
  const bIsVolume = VOLUME_UNITS.includes(unitB)
  const aIsWeight = WEIGHT_UNITS.includes(unitA)
  const bIsWeight = WEIGHT_UNITS.includes(unitB)
  return (aIsVolume && bIsVolume) || (aIsWeight && bIsWeight)
}

export function calcAmount(rate, basis, areaSqft, forceGal) {
  if (!rate || !areaSqft) return { value: null, unit: null }
  const divisor = basis.includes('/ M') ? 1000 : 43560
  const raw = (rate * areaSqft) / divisor
  if (forceGal) {
    return { value: Math.round((raw / 128) * 10) / 10, unit: 'gal' }
  }
  if (basis.startsWith('gal')) return { value: Math.round(raw * 10) / 10, unit: 'gal' }
  if (basis.startsWith('lbs')) return { value: Math.round(raw * 10) / 10, unit: 'lbs' }
  // Grams basis ("g / M", "g / A"). Checked after "gal" so it isn't shadowed.
  if (basis.startsWith('g ') || basis.startsWith('g/')) return { value: Math.round(raw * 10) / 10, unit: 'g' }
  return { value: Math.round(raw), unit: 'oz' }
}

export function fmtDate(d) {
  // A "YYYY-MM-DD" string parses as UTC midnight, which in US timezones renders
  // as the PREVIOUS day. Parse date-only strings as LOCAL midnight so the date
  // shown matches the date entered.
  const dt = (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) ? new Date(d + 'T00:00:00') : new Date(d)
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Measure-out helper ───────────────────────────────────────────────────────
// Turn a liquid amount into how to physically pour it: whole jugs of the
// product's container size, then a gallon + ounce remainder (measured with a
// 1-gal jug). e.g. 150 oz → "1 gal + 22 oz"; 7 gal in 2.5-gal jugs →
// "2 × 2.5 gal + 2 gal". `jug` is optional: { size, unit } of the product's
// bottle. Returns null when a plain readout (e.g. "40 oz") is already clear.
const OZ_PER = { oz: 1, 'fl oz': 1, floz: 1, gal: 128, gals: 128, gallon: 128, qt: 32, pt: 16, cup: 8, l: 33.814, ml: 0.033814 }
function toFlOz(v, unit) { const k = OZ_PER[String(unit || '').toLowerCase().trim()]; return k ? v * k : null }
function trimNum(n) { return (Math.round(n * 100) / 100).toString() }
function galOzStr(oz) {
  let g = Math.floor((oz + 0.001) / 128)
  let o = Math.round(oz - g * 128)
  // Rounding the remainder up can land on a full 128 oz (e.g. 383.6 → "2 gal +
  // 128 oz"); roll that into the next gallon so it reads "3 gal".
  if (o >= 128) { g += 1; o -= 128 }
  const parts = []
  if (g > 0) parts.push(`${g} gal`)
  if (o > 0) parts.push(`${o} oz`)
  return parts.length ? parts.join(' + ') : '0 oz'
}
export function measureOut(value, unit, jug) {
  if (value == null || value <= 0) return null
  const oz = toFlOz(value, unit)
  if (oz == null) return null // dry (lbs/g) or unknown — no liquid breakdown
  const jugOz = jug && jug.size > 0 ? toFlOz(jug.size, jug.unit || 'gal') : null
  // Product has its own jug/bottle and we've got at least one full one to pour.
  if (jugOz && jugOz > 0 && oz >= jugOz && Math.abs(jugOz - 128) > 0.5) {
    const whole = Math.floor(oz / jugOz)
    const rem = oz - whole * jugOz
    const parts = [`${whole} × ${trimNum(jug.size)} ${jug.unit || 'gal'}`]
    if (rem >= 1) parts.push(galOzStr(rem))
    return parts.join(' + ')
  }
  // Otherwise measure with a 1-gallon jug — only worth saying once it's a gallon+.
  if (oz < 128) return null
  return galOzStr(oz)
}

// Calculate lbs of N, P, K delivered by one product line on a sheet.
// Granular ferts: % of product WEIGHT (lbs). Liquid ferts: lbs of nutrient PER
// GALLON applied — % alone is meaningless for liquids since it ignores density.
export function calcNPK(p, products, areaSqft, tanks) {
  const prod = products.find((pr) => pr.name === p.product)
  if (!prod || prod.type !== 'Fertilizer') return { n: 0, p: 0, k: 0 }
  if (!areaSqft) return { n: 0, p: 0, k: 0 }
  const { value: amt, unit } = calcAmount(parseFloat(p.rate), p.basis, areaSqft, false)
  if (amt === null) return { n: 0, p: 0, k: 0 }
  const total = amt * tanks

  if (prod.fertForm === 'liquid') {
    let totalGal = total
    if (unit === 'oz' || unit === 'fl oz') totalGal = convertUnits(total, unit, 'gal')
    if (unit === 'ml') totalGal = convertUnits(total, 'ml', 'gal')
    if (unit === 'lbs') return { n: 0, p: 0, k: 0 }
    return {
      n: Math.round(totalGal * (prod.nPerGal || 0) * 1000) / 1000,
      p: Math.round(totalGal * (prod.pPerGal || 0) * 1000) / 1000,
      k: Math.round(totalGal * (prod.kPerGal || 0) * 1000) / 1000,
    }
  }

  // Granular — percentage of product weight
  let totalLbs = total
  if (unit === 'oz' || unit === 'fl oz') totalLbs = total / 16
  if (unit === 'g') totalLbs = total / 453.592
  if (unit === 'gal' || unit === 'ml') return { n: 0, p: 0, k: 0 }
  return {
    n: Math.round(totalLbs * ((prod.n || 0) / 100) * 1000) / 1000,
    p: Math.round(totalLbs * ((prod.p || 0) / 100) * 1000) / 1000,
    k: Math.round(totalLbs * ((prod.k || 0) / 100) * 1000) / 1000,
  }
}

// Aggregate N/P/K across all APPLIED sheets (signed off in the field, not just
// approved), grouped by area + month.
export function aggregateNPK(sheets, products, areas) {
  const groups = {}
  sheets
    .filter((s) => sheetApplied(s))
    .forEach((sheet) => {
      const area = areas[sheet.area] || {}
      const month = sheet.date?.slice(0, 7) || 'unknown'
      const key = `${sheet.area}|${month}`
      if (!groups[key])
        groups[key] = { area: sheet.area, month, n: 0, p: 0, k: 0, sheetCount: 0, sqft: area.sqft || 0 }
      let hasFert = false
      ;(sheet.products || [])
        .filter((p) => p.product)
        .forEach((p) => {
          const { n, p: pVal, k } = calcNPK(p, products, area.sqft, sheet.tanks)
          if (n || pVal || k) hasFert = true
          groups[key].n += n
          groups[key].p += pVal
          groups[key].k += k
        })
      if (hasFert) groups[key].sheetCount += 1
    })
  return Object.values(groups)
    .filter((g) => g.n > 0 || g.p > 0 || g.k > 0)
    .map((g) => {
      const perM = g.sqft > 0 ? g.sqft / 1000 : 0
      return {
        ...g,
        n: Math.round(g.n * 1000) / 1000,
        p: Math.round(g.p * 1000) / 1000,
        k: Math.round(g.k * 1000) / 1000,
        nPerM: perM > 0 ? Math.round((g.n / perM) * 1000) / 1000 : null,
        pPerM: perM > 0 ? Math.round((g.p / perM) * 1000) / 1000 : null,
        kPerM: perM > 0 ? Math.round((g.k / perM) * 1000) / 1000 : null,
      }
    })
    .sort((a, b) => b.month.localeCompare(a.month) || a.area.localeCompare(b.area))
}

// Explain, in plain terms, why fertilizer usage might NOT be showing up in the
// N-P-K report. Walks the same path aggregateNPK uses and collects the reasons
// a fertilizer line contributes zero, so the Reports page can tell the user what
// to fix instead of silently showing nothing.
export function npkDiagnostics(sheets, products, areas) {
  const prodByName = {}
  products.forEach((p) => { prodByName[p.name] = p })
  const hasAnalysis = (p) =>
    p.fertForm === 'liquid'
      ? !!((p.nPerGal || 0) || (p.pPerGal || 0) || (p.kPerGal || 0))
      : !!((p.n || 0) || (p.p || 0) || (p.k || 0))

  const missingAnalysis = new Set()
  const notCountedSheets = new Set()
  const missingSqft = new Set()
  const basisIssue = new Set()

  ;(sheets || []).forEach((sheet) => {
    const fertLines = (sheet.products || []).filter((l) => {
      const p = prodByName[l.product]
      return p && p.type === 'Fertilizer' && l.rate
    })
    if (fertLines.length === 0) return
    // Mirror aggregateNPK: only applied sheets (submitted + signed + tanks
    // checked, or imported) count. Anything else is why the fertilizer is
    // missing from the report.
    if (!sheetApplied(sheet)) {
      notCountedSheets.add(`${sheet.area || 'Sheet'}${sheet.date ? ` · ${fmtDate(sheet.date)}` : ''}`)
      return
    }
    const area = areas[sheet.area] || {}
    fertLines.forEach((l) => {
      const p = prodByName[l.product]
      if (!hasAnalysis(p)) { missingAnalysis.add(p.name); return }
      if (!area.sqft) { missingSqft.add(sheet.area); return }
      const { n, p: pv, k } = calcNPK(l, products, area.sqft, sheet.tanks)
      if (!n && !pv && !k) basisIssue.add(p.name)
    })
  })

  return {
    missingAnalysis: [...missingAnalysis],
    notCountedSheets: [...notCountedSheets],
    missingSqft: [...missingSqft],
    basisIssue: [...basisIssue],
  }
}

// ── Resistance / rotation ───────────────────────────────────────────────────
const ROTATION_DEFAULT_DAYS = 21

function toTime(d) { return d ? new Date(`${d}T00:00:00`).getTime() : null }
export function daysBetween(a, b) {
  const ta = toTime(a)
  const tb = toTime(b)
  if (ta == null || tb == null) return null
  return Math.round((tb - ta) / 86400000)
}

// Build a rotation timeline per area from the sprays that actually happened
// (approved or completed). Each entry is flagged `tooSoon` when the same
// chemical group hit that area again inside the product's rotation window.
export function rotationByArea(sheets, products) {
  const groupOf = {}
  const rotOf = {}
  products.forEach((p) => { groupOf[p.name] = (p.moaGroup || '').trim(); rotOf[p.name] = p.rotationDays || null })

  const byArea = {}
  ;(sheets || [])
    .filter((s) => s.status === 'approved' || s.completed)
    .forEach((s) => {
      ;(s.products || []).forEach((pr) => {
        const g = groupOf[pr.product]
        if (!g) return
        const area = s.area || 'Unassigned'
        ;(byArea[area] = byArea[area] || []).push({ date: s.date, group: g, product: pr.product, rotationDays: rotOf[pr.product] })
      })
    })

  Object.values(byArea).forEach((list) => {
    list.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
    list.forEach((e, i) => {
      for (let j = i - 1; j >= 0; j--) {
        if (list[j].group === e.group) {
          const days = daysBetween(list[j].date, e.date)
          const win = e.rotationDays || ROTATION_DEFAULT_DAYS
          e.prev = { date: list[j].date, product: list[j].product, days }
          e.tooSoon = days != null && days <= win
          break
        }
      }
    })
  })
  return byArea
}

// For one sheet being built: which of its products repeat a chemical group that
// already hit this area recently (from other approved/completed sheets)?
export function rotationWarnings(sheet, sheets, products) {
  const groupOf = {}
  const rotOf = {}
  products.forEach((p) => { groupOf[p.name] = (p.moaGroup || '').trim(); rotOf[p.name] = p.rotationDays || null })

  const priors = (sheets || [])
    .filter((s) => s.id !== sheet.id && (s.status === 'approved' || s.completed) && s.area === sheet.area && s.date && (!sheet.date || s.date <= sheet.date))

  const out = []
  const seen = new Set()
  ;(sheet.products || []).forEach((pr) => {
    const g = groupOf[pr.product]
    if (!g || seen.has(pr.product)) return
    seen.add(pr.product)
    let best = null
    priors.forEach((s) => {
      ;(s.products || []).forEach((p2) => {
        if (groupOf[p2.product] !== g) return
        const days = daysBetween(s.date, sheet.date || s.date)
        if (days == null || days < 0) return
        if (!best || days < best.days) best = { days, date: s.date, product: p2.product }
      })
    })
    if (best) {
      const win = rotOf[pr.product] || ROTATION_DEFAULT_DAYS
      if (best.days <= win) out.push({ product: pr.product, group: g, days: best.days, window: win, prevProduct: best.product, prevDate: best.date })
    }
  })
  return out
}

// ── Reports hub ─────────────────────────────────────────────────────────────
// How much of each product was ACTUALLY applied (from approved/completed
// sheets), with per-area breakdown and application count.
export function productUsage(sheets, products, areas) {
  const prodType = {}
  products.forEach((p) => { prodType[p.name] = p.type })
  const map = {}
  ;(sheets || [])
    .filter((s) => s.status === 'approved' || s.completed)
    .forEach((s) => {
      const area = areas[s.area] || {}
      ;(s.products || []).filter((p) => p.product).forEach((p) => {
        const { value: amt, unit } = calcAmount(parseFloat(p.rate), p.basis, area.sqft, p.forceGal)
        if (amt == null) return
        const total = amt * (s.tanks || 1)
        if (!map[p.product]) map[p.product] = { name: p.product, type: prodType[p.product] || p.type || '', total: 0, unit, apps: 0, byArea: {} }
        map[p.product].total += total
        map[p.product].apps += 1
        map[p.product].unit = unit
        map[p.product].byArea[s.area] = (map[p.product].byArea[s.area] || 0) + total
      })
    })
  return Object.values(map).map((r) => ({ ...r, total: Math.round(r.total * 10) / 10 })).sort((a, b) => b.apps - a.apps || b.total - a.total)
}

// ── Cost / budget ────────────────────────────────────────────────────────────
// Cost per applied ounce for a product, derived from its case price and case
// size (costPerCase / ozPerCase). ozPerCase is stored in the same "ounce" the
// spray math applies in — fluid ounces for liquids, weight ounces for granular —
// so the division lines up. Returns null when the product has no pricing.
export function costPerOzOf(prod) {
  if (!prod) return null
  const cpc = Number(prod.costPerCase)
  const opc = Number(prod.ozPerCase)
  if (cpc > 0 && opc > 0) return cpc / opc
  return null
}

// Convert an applied amount to the ounce convention used by ozPerCase so the two
// can be multiplied. gal → fl oz (×128), lbs → weight oz (×16), oz stays as-is.
function toAppliedOz(total, unit) {
  if (unit === 'gal') return total * 128
  if (unit === 'lbs') return total * 16
  if (unit === 'g') return total / 28.3495
  if (unit === 'oz' || unit === 'fl oz') return total
  return null
}

// Dose a fertilizer by nitrogen: given a target lb N per 1,000 sq ft, work out the
// product rate that delivers it, from the product's own N analysis.
//   Granular: rate (lb/M)  = targetN ÷ (N% ÷ 100)
//   Liquid:   rate (gal/M) = targetN ÷ (lb N per gallon)
// Returns { rate, basis } rounded for entry, or null if the product has no usable
// N figure.
export function productRateForN(targetNperM, product) {
  const t = Number(targetNperM)
  if (!t || t <= 0 || !product) return null
  if (product.fertForm === 'liquid') {
    const npg = Number(product.nPerGal)
    if (!npg || npg <= 0) return null
    return { rate: Math.round((t / npg) * 1000) / 1000, basis: 'gal / M' }
  }
  const pct = Number(product.n)
  if (!pct || pct <= 0) return null
  return { rate: Math.round((t / (pct / 100)) * 1000) / 1000, basis: 'lbs / M' }
}

// What every spray has cost, from applied amount × cost-per-ounce. Rolls up per
// product, per area, and per month, and lists any products missing a case price
// so the report can tell the user exactly what to fill in — same pattern as the
// N-P-K diagnostics.
export function productCosts(sheets, products, areas) {
  const prodByName = {}
  ;(products || []).forEach((p) => { prodByName[p.name] = p })

  const perProduct = {}
  const byArea = {}
  const byMonth = {}
  const missing = new Set()
  let totalCost = 0

  ;(sheets || [])
    .filter((s) => s.status === 'approved' || s.completed)
    .forEach((s) => {
      const area = areas[s.area] || {}
      const month = (s.date || '').slice(0, 7)
      ;(s.products || []).filter((p) => p.product).forEach((p) => {
        const prod = prodByName[p.product]
        const { value: amt, unit } = calcAmount(parseFloat(p.rate), p.basis, area.sqft, p.forceGal)
        if (amt == null) return
        const total = amt * (s.tanks || 1)
        const cpo = costPerOzOf(prod)
        const oz = toAppliedOz(total, unit)
        if (cpo == null || oz == null) { missing.add(p.product); return }
        const cost = oz * cpo
        totalCost += cost
        if (!perProduct[p.product]) perProduct[p.product] = { name: p.product, type: prod?.type || p.type || '', cost: 0, apps: 0 }
        perProduct[p.product].cost += cost
        perProduct[p.product].apps += 1
        if (s.area) byArea[s.area] = (byArea[s.area] || 0) + cost
        if (month) byMonth[month] = (byMonth[month] || 0) + cost
      })
    })

  const round2 = (n) => Math.round(n * 100) / 100
  return {
    totalCost: round2(totalCost),
    rows: Object.values(perProduct).map((r) => ({ ...r, cost: round2(r.cost) })).sort((a, b) => b.cost - a.cost),
    byArea: Object.entries(byArea).map(([area, cost]) => ({ area, cost: round2(cost) })).sort((a, b) => b.cost - a.cost),
    byMonth: Object.entries(byMonth).map(([month, cost]) => ({ month, cost: round2(cost) })).sort((a, b) => b.month.localeCompare(a.month)),
    missing: [...missing],
  }
}

// ── EIQ (Environmental Impact Quotient) ──────────────────────────────────────
// A relative environmental-load score for the spray program, using Cornell's
// public EIQ Field Use Rating: EIQ value × (% active ingredient) × amount of
// product applied. We store the EIQ value and % active ingredient per product;
// the applied amount comes from the same math the cost/usage reports use, so a
// product only scores once you've filled in its EIQ. Lower is better.
//
// The applied amount is converted to pounds of formulated product. Liquid gallons
// use a density (default 8.34 lb/gal — water) since the label rate is by volume;
// a product can override it with `densityLbGal`. It's an approximation, and the
// score is only ever meant to be read RELATIVELY (product vs product, month vs
// month), never as an absolute safety threshold.
const DEFAULT_DENSITY_LB_GAL = 8.34

export function toAppliedLbs(total, unit, densityLbGal = DEFAULT_DENSITY_LB_GAL) {
  if (total == null) return null
  const d = Number(densityLbGal) > 0 ? Number(densityLbGal) : DEFAULT_DENSITY_LB_GAL
  if (unit === 'lbs') return total
  if (unit === 'oz' || unit === 'fl oz') return total / 16   // weight-oz basis; fl oz ≈ same at ~water density
  if (unit === 'g') return total / 453.592
  if (unit === 'gal') return total * d
  if (unit === 'ml') return (total / 3785.41) * d
  return null
}

// EIQ field-use load for one applied amount of a product. Returns null when the
// product has no EIQ value or no % active ingredient set.
export function eiqLoadForAmount(prod, totalAmount, unit) {
  if (!prod) return null
  const eiq = Number(prod.eiq)
  const pct = Number(prod.activePct)
  if (!(eiq > 0) || !(pct > 0)) return null
  const lbs = toAppliedLbs(totalAmount, unit, prod.densityLbGal)
  if (lbs == null) return null
  return eiq * (pct / 100) * lbs
}

// Roll up the program's EIQ load from approved/completed sheets — total, per
// product, per area, per month — plus the pesticide products still missing an
// EIQ value or % active ingredient (so the report can say what to fill in).
// Mirrors productCosts so the two read the same way. Fertilizers and wetting
// agents are skipped — EIQ is a pesticide metric.
const NON_PESTICIDE = new Set(['Fertilizer', 'Wetting Agent', 'Biological'])

export function eiqLoad(sheets, products, areas) {
  const prodByName = {}
  ;(products || []).forEach((p) => { prodByName[p.name] = p })

  const perProduct = {}
  const byArea = {}
  const byMonth = {}
  const missing = new Set()
  let total = 0

  ;(sheets || [])
    .filter((s) => s.status === 'approved' || s.completed)
    .forEach((s) => {
      const area = areas[s.area] || {}
      const month = (s.date || '').slice(0, 7)
      ;(s.products || []).filter((p) => p.product).forEach((p) => {
        const prod = prodByName[p.product]
        const type = prod?.type || p.type || ''
        if (NON_PESTICIDE.has(type)) return
        const { value: amt, unit } = calcAmount(parseFloat(p.rate), p.basis, area.sqft, p.forceGal)
        if (amt == null) return
        const applied = amt * (s.tanks || 1)
        const load = eiqLoadForAmount(prod, applied, unit)
        if (load == null) { missing.add(p.product); return }
        total += load
        if (!perProduct[p.product]) perProduct[p.product] = { name: p.product, type, load: 0, apps: 0 }
        perProduct[p.product].load += load
        perProduct[p.product].apps += 1
        if (s.area) byArea[s.area] = (byArea[s.area] || 0) + load
        if (month) byMonth[month] = (byMonth[month] || 0) + load
      })
    })

  const r0 = (n) => Math.round(n)
  return {
    total: r0(total),
    rows: Object.values(perProduct).map((r) => ({ ...r, load: r0(r.load) })).sort((a, b) => b.load - a.load),
    byArea: Object.entries(byArea).map(([area, load]) => ({ area, load: r0(load) })).sort((a, b) => b.load - a.load),
    byMonth: Object.entries(byMonth).map(([month, load]) => ({ month, load: r0(load) })).sort((a, b) => b.month.localeCompare(a.month)),
    missing: [...missing],
  }
}

// Chronological log of every spray sheet, newest first.
export function sprayHistory(sheets) {
  return [...(sheets || [])]
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .map((s) => ({
      id: s.id,
      date: s.date,
      area: s.area,
      operator: s.completedBy || s.operator || '',
      status: s.completed ? 'Sprayed' : s.status,
      products: (s.products || []).filter((p) => p.product).map((p) => p.product),
      tanks: s.tanks,
    }))
}

// Days since each area was last sprayed (approved or completed).
export function daysSinceByArea(sheets) {
  const last = {}
  ;(sheets || [])
    .filter((s) => (s.status === 'approved' || s.completed) && s.date)
    .forEach((s) => { if (!last[s.area] || s.date > last[s.area]) last[s.area] = s.date })
  const today = localDateISO()
  return Object.entries(last)
    .map(([area, date]) => ({ area, date, days: daysBetween(date, today) }))
    .sort((a, b) => (b.days ?? -1) - (a.days ?? -1))
}

export function downloadCSV(rows, filename) {
  const csv = rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
