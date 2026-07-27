// Soil-test interpretation + fertilizer guidance, built on the MLSN approach
// (Minimum Levels for Sustainable Nutrition — Woods, Kreuser & Soldat). MLSN is
// the modern turf standard: keep each nutrient in the soil at or above a proven
// minimum, and apply enough to cover what the plant uses over the year without
// letting the soil drop below that minimum.
//
//   apply = plant use + MLSN minimum − what the soil already holds
//
// Everything here is a pure calculation over numbers you type in, so it can be
// unit-tested and shared by the UI. It never touches the database.

// MLSN guideline minimums, Mehlich-3 ppm (the values published by PACE Turf).
export const MLSN = { P: 21, K: 37, Ca: 331, Mg: 47, S: 6 }

// Typical turfgrass nutrient use as a fraction of nitrogen used, from clipping
// tissue analysis. Multiplying by the season's N rate estimates annual uptake.
export const USE_RATIO = { P: 0.13, K: 0.55, Ca: 0.10, Mg: 0.08, S: 0.08 }

// Convert a soil-test concentration (ppm, Mehlich-3) to pounds per 1,000 sq ft
// held in the rootzone, assuming a ~4-inch sample at typical bulk density. This
// is the standard MLSN-spreadsheet conversion.
export const PPM_TO_LB_M = 0.031

const NUTRIENTS = [
  { key: 'P', label: 'Phosphorus (P)' },
  { key: 'K', label: 'Potassium (K)' },
  { key: 'Ca', label: 'Calcium (Ca)' },
  { key: 'Mg', label: 'Magnesium (Mg)' },
  { key: 'S', label: 'Sulfur (S)' },
]

function round(n, dp = 2) {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

// pH guidance for cool-season turf (ideal band ~6.0–6.5).
export function phAdvice(ph) {
  if (ph == null || ph === '' || isNaN(Number(ph))) return null
  const v = Number(ph)
  if (v < 5.5) return { status: 'low', text: `pH ${v} is quite acidic — consider a lime application to raise it toward 6.0–6.5.` }
  if (v < 6.0) return { status: 'low', text: `pH ${v} is on the low side — a light lime application would move it into the ideal 6.0–6.5 band.` }
  if (v <= 6.5) return { status: 'ok', text: `pH ${v} is in the ideal 6.0–6.5 range.` }
  if (v <= 7.0) return { status: 'ok', text: `pH ${v} is slightly high but generally fine for turf.` }
  return { status: 'high', text: `pH ${v} is high — elemental sulfur can lower it over time if micronutrient availability becomes a problem.` }
}

// Build a per-nutrient recommendation for one soil test.
//   test:    { p, k, ca, mg, s, ph, ... } in ppm (blank/absent = skip)
//   annualN: planned pounds of N per 1,000 sq ft for the year on this area
export function recommend(test = {}, annualN = 4) {
  const N = Number(annualN) || 0
  const readPpm = (k) => {
    const v = test[k.toLowerCase()]
    return v === '' || v == null || isNaN(Number(v)) ? null : Number(v)
  }

  const rows = NUTRIENTS.map(({ key, label }) => {
    const soilPpm = readPpm(key)
    const mlsnPpm = MLSN[key]
    if (soilPpm == null) return { key, label, soilPpm: null, mlsnPpm, status: 'notest', applyLbM: null }

    const useLb = N * (USE_RATIO[key] || 0)
    const soilLb = soilPpm * PPM_TO_LB_M
    const mlsnLb = mlsnPpm * PPM_TO_LB_M
    const applyLbM = Math.max(0, round(useLb + mlsnLb - soilLb, 2))

    let status
    if (soilPpm < mlsnPpm) status = 'deficient'          // below the floor — build it up
    else if (applyLbM > 0) status = 'maintain'           // fine now, feed to hold the level
    else status = 'adequate'                             // plenty in reserve, no need this year
    return { key, label, soilPpm, mlsnPpm, useLb: round(useLb, 2), applyLbM, status }
  })

  return { rows, ph: phAdvice(test.ph), annualN: N }
}

// A one-line headline for a test — how many nutrients need attention.
export function recommendSummary(test = {}, annualN = 4) {
  const { rows } = recommend(test, annualN)
  const tested = rows.filter((r) => r.status !== 'notest')
  const low = tested.filter((r) => r.status === 'deficient')
  const feed = tested.filter((r) => r.status === 'maintain')
  return { testedCount: tested.length, deficient: low.map((r) => r.key), maintain: feed.map((r) => r.key) }
}
