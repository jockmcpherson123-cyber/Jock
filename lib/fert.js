// Fertilizer sheet math — mirrors the club's Excel fert sheets.
//
// A sheet applies ONE granular product to the sections of ONE area at a set
// rate (lbs product / 1,000 sq ft). Greens etc. carry a small area adjustment
// (spreader overlap), stored as adjustPct. From each section's square footage
// we get lbs of product, bags (by bag weight), a running bag total, and cost.

export function computeFert(sheet) {
  const rate = num(sheet?.rate)                 // lbs product per 1,000 sq ft
  const bag = num(sheet?.bag) || 50             // lb per bag
  const adj = 1 + num(sheet?.adjustPct) / 100   // area overlap factor
  const price = num(sheet?.pricePerBag)
  const a = sheet?.analysis || {}
  const nPct = num(a.n), pPct = num(a.p), kPct = num(a.k)

  let cum = 0, totalSqft = 0, totalLbs = 0, totalActual = 0
  const rows = (sheet?.sections || []).map((s) => {
    const sqft = num(s.sqft)
    const adjSqft = sqft * adj
    const lbs = (adjSqft / 1000) * rate
    const bags = bag > 0 ? lbs / bag : 0
    cum += bags
    totalSqft += sqft
    totalLbs += lbs
    totalActual += num(s.actual)
    return { name: s.name, sqft, adjSqft, lbs, bags, cumBags: cum, actual: s.actual }
  })
  const totalBags = cum
  return {
    rows,
    totalSqft,
    totalLbs,
    totalBags,
    totalActualBags: totalActual,
    cost: totalBags * price,
    // Nutrient delivered at this rate (lb / 1,000 sq ft) and season total (lb).
    nPerM: rate * nPct / 100,
    pPerM: rate * pPct / 100,
    kPerM: rate * kPct / 100,
    totalN: totalLbs * nPct / 100,
    totalP: totalLbs * pPct / 100,
    totalK: totalLbs * kPct / 100,
  }
}

// Parse an "N-P-K" analysis string like "24-6-6" into {n,p,k}. Returns null if
// it doesn't look like an analysis.
export function parseAnalysis(str) {
  const m = String(str || '').match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/)
  if (!m) return null
  return { n: Number(m[1]), p: Number(m[2]), k: Number(m[3]) }
}

export const fmtNum = (n, d = 1) => (n == null || isNaN(n) ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d }))
const num = (v) => { const n = Number(v); return isNaN(n) ? 0 : n }
