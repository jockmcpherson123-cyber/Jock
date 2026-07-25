// Pure calculation helpers — the working spray/fertilizer math from the
// prototype, unchanged. These have no database or UI dependencies, so the app,
// reports, and (later) the annual program builder can all share one source of
// truth for the numbers.

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
  const isGalLbs = basis.startsWith('gal') || basis.startsWith('lbs')
  if (isGalLbs)
    return {
      value: Math.round(raw * 10) / 10,
      unit: basis.startsWith('gal') ? 'gal' : 'lbs',
    }
  return { value: Math.round(raw), unit: 'oz' }
}

export function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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
  if (unit === 'gal' || unit === 'ml') return { n: 0, p: 0, k: 0 }
  return {
    n: Math.round(totalLbs * ((prod.n || 0) / 100) * 1000) / 1000,
    p: Math.round(totalLbs * ((prod.p || 0) / 100) * 1000) / 1000,
    k: Math.round(totalLbs * ((prod.k || 0) / 100) * 1000) / 1000,
  }
}

// Aggregate N/P/K across all approved sheets, grouped by area + month.
export function aggregateNPK(sheets, products, areas) {
  const groups = {}
  sheets
    .filter((s) => s.status === 'approved')
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
  const unapprovedSheets = new Set()
  const missingSqft = new Set()
  const basisIssue = new Set()

  ;(sheets || []).forEach((sheet) => {
    const fertLines = (sheet.products || []).filter((l) => {
      const p = prodByName[l.product]
      return p && p.type === 'Fertilizer' && l.rate
    })
    if (fertLines.length === 0) return
    if (sheet.status !== 'approved') {
      unapprovedSheets.add(`${sheet.area || 'Sheet'}${sheet.date ? ` · ${fmtDate(sheet.date)}` : ''}`)
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
    unapprovedSheets: [...unapprovedSheets],
    missingSqft: [...missingSqft],
    basisIssue: [...basisIssue],
  }
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
