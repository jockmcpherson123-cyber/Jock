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

// Typical annual nitrogen (lb N / 1,000 sq ft / yr) by grass variety. These are
// mid-range maintenance figures — a starting point the user can override per
// area. Matching is keyword-based so it works with free-text grass names.
const GRASS_N = [
  { match: /bent/i, n: 3 },
  { match: /poa|annual blue/i, n: 3.5 },
  { match: /bermuda/i, n: 5 },
  { match: /zoysia/i, n: 3 },
  { match: /paspalum|seashore/i, n: 5 },
  { match: /ken.*blue|kbg|blue ?grass/i, n: 3.5 },
  { match: /rye/i, n: 3.5 },
  { match: /fine fescue|creeping red|chewings|hard fescue/i, n: 1.5 },
  { match: /fescue/i, n: 3 },
]

// Suggested annual N for an area from its grass variety(ies). Averages when an
// area carries more than one grass; falls back to 4 when nothing is recognized.
export function suggestedAnnualN(grasses = []) {
  const list = (grasses || []).map((g) => {
    const hit = GRASS_N.find((r) => r.match.test(String(g)))
    return hit ? hit.n : null
  }).filter((n) => n != null)
  if (list.length === 0) return { n: 4, matched: false, grasses: grasses || [] }
  const avg = list.reduce((s, n) => s + n, 0) / list.length
  return { n: Math.round(avg * 2) / 2, matched: true, grasses: grasses || [] }
}

// Read soil behaviour from the area's soil type and (if available) its measured
// CEC. Sandy / USGA rootzones (or a low CEC) leach mobile nutrients, so they
// want a modest buffer on K and S and lighter, more frequent feeding.
export function soilLeaching(soilType = '', cec = null) {
  const sandy = /sand|usga|rootzone/i.test(String(soilType || '')) || (cec != null && cec !== '' && !isNaN(Number(cec)) && Number(cec) < 6)
  if (sandy) {
    return { sandy: true, mobileFactor: 1.2, note: 'Sandy / low-CEC rootzone — nutrients leach, so K and S are bumped and it’s best to spoon-feed (little and often).' }
  }
  const holds = /clay|loam|native|push/i.test(String(soilType || '')) || (cec != null && cec !== '' && !isNaN(Number(cec)) && Number(cec) >= 12)
  if (holds) return { sandy: false, mobileFactor: 1.0, note: 'Higher-CEC soil holds nutrients well — you can feed less often.' }
  return { sandy: false, mobileFactor: 1.0, note: null }
}

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
//   annualN: planned pounds of N per 1,000 sq ft for the year on this area.
//            Pass null/'' to have it inferred from opts.grasses.
//   opts:    { grasses:[…], soilType:'…' } from the area — grass sets the N
//            target when none is given; soil type adjusts mobile nutrients.
export function recommend(test = {}, annualN = 4, opts = {}) {
  const { grasses = [], soilType = '' } = opts
  let N = Number(annualN)
  let nSource = 'entered'
  if (annualN == null || annualN === '' || isNaN(N)) {
    N = suggestedAnnualN(grasses).n
    nSource = 'grass'
  }
  N = N || 0

  const leach = soilLeaching(soilType, test.cec)
  const mobile = new Set(['K', 'S']) // nutrients that leach from sand

  const readPpm = (k) => {
    const v = test[k.toLowerCase()]
    return v === '' || v == null || isNaN(Number(v)) ? null : Number(v)
  }

  const rows = NUTRIENTS.map(({ key, label }) => {
    const soilPpm = readPpm(key)
    const mlsnPpm = MLSN[key]
    if (soilPpm == null) return { key, label, soilPpm: null, mlsnPpm, status: 'notest', applyLbM: null }

    const factor = mobile.has(key) ? leach.mobileFactor : 1
    const useLb = N * (USE_RATIO[key] || 0) * factor
    const soilLb = soilPpm * PPM_TO_LB_M
    const mlsnLb = mlsnPpm * PPM_TO_LB_M
    const applyLbM = Math.max(0, round(useLb + mlsnLb - soilLb, 2))

    let status
    if (soilPpm < mlsnPpm) status = 'deficient'          // below the floor — build it up
    else if (applyLbM > 0) status = 'maintain'           // fine now, feed to hold the level
    else status = 'adequate'                             // plenty in reserve, no need this year
    return { key, label, soilPpm, mlsnPpm, useLb: round(useLb, 2), applyLbM, status }
  })

  return { rows, ph: phAdvice(test.ph), annualN: N, nSource, grasses, soilType, soil: leach }
}

// A one-line headline for a test — how many nutrients need attention.
export function recommendSummary(test = {}, annualN = 4, opts = {}) {
  const { rows } = recommend(test, annualN, opts)
  const tested = rows.filter((r) => r.status !== 'notest')
  const low = tested.filter((r) => r.status === 'deficient')
  const feed = tested.filter((r) => r.status === 'maintain')
  return { testedCount: tested.length, deficient: low.map((r) => r.key), maintain: feed.map((r) => r.key) }
}
