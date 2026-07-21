// Pure calculation helpers — the working spray/fertilizer math from the
// prototype, unchanged. These have no database or UI dependencies, so the app,
// reports, and (later) the annual program builder can all share one source of
// truth for the numbers.

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

// Convert a quantity from one unit to another.
// Volume units (oz, fl oz, gal, ml) all convert through milliliters. Weight
// (lbs) converts through ounces. "oz" is treated as a volume unit here, matching
// how the spray math uses it. Cross-converting weight <-> volume needs density,
// so that case is returned unchanged and flagged in the UI.
const ML_PER_UNIT = { 'fl oz': 29.5735, oz: 29.5735, gal: 3785.41, ml: 1 }

export function convertUnits(qty, fromUnit, toUnit) {
  if (!qty || fromUnit === toUnit) return qty
  const volumeUnits = ['oz', 'fl oz', 'gal', 'ml']
  if (volumeUnits.includes(fromUnit) && volumeUnits.includes(toUnit)) {
    const ml = qty * ML_PER_UNIT[fromUnit]
    return Math.round((ml / ML_PER_UNIT[toUnit]) * 1000) / 1000
  }
  // weight <-> volume can't be converted without density — log as-is
  return qty
}

export function unitsAreCompatible(unitA, unitB) {
  const volumeUnits = ['oz', 'fl oz', 'gal', 'ml']
  const weightUnits = ['lbs']
  const aIsVolume = volumeUnits.includes(unitA)
  const bIsVolume = volumeUnits.includes(unitB)
  const aIsWeight = weightUnits.includes(unitA)
  const bIsWeight = weightUnits.includes(unitB)
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
