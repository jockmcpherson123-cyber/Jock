// ============================================================================
//  Course Map — tonight's watering depth suggestion.
//
//  suggested = round_to_0.05( max(0, ET + (aim − latestAvg) × inchesPerPoint) ),
//  capped at maxDepth. inchesPerPoint and maxDepth are club settings.
// ============================================================================

export function roundTo05(x) { return Math.round(x / 0.05) * 5 / 100 } // exact multiples of 0.05

export function suggestDepth({ et = 0, aim, latestAvg, inchesPerPoint = 0.03, maxDepth = 0.25 }) {
  if (aim == null || latestAvg == null) return null
  const raw = Math.max(0, Number(et || 0) + (aim - latestAvg) * inchesPerPoint)
  return Math.min(maxDepth, roundTo05(raw))
}

// Group greens by their chosen depth, for the "Tonight's plan" bar:
// [{ depth: 0.15, greens: [4,7,12] }, …], skip-depth (0) listed as "Skip".
export function planByDepth(greenDepths) {
  const by = {}
  for (const g of greenDepths) {
    const key = g.depth == null ? 'none' : String(g.depth)
    ;(by[key] ||= []).push(g.green)
  }
  return Object.entries(by)
    .map(([k, greens]) => ({ depth: k === 'none' ? null : Number(k), greens: greens.sort((a, b) => a - b) }))
    .sort((a, b) => (a.depth ?? -1) - (b.depth ?? -1))
}
