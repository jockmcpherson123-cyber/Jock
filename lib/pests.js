// Turf disease-risk indices, GDD, and GDD-based pest stages.
//
// These are GENERAL, directional models built from published temperature /
// humidity / soil-temperature thresholds — they point you at what to watch, and
// should be calibrated to your own region and history. Weather comes in as the
// Fahrenheit daily aggregates from lib/weather (tMax, tMin, tMean, rhMean,
// dpMean, bpHours, precip) plus 2" soil temps (fetchBreakdownTemps). Every risk
// score is 0–100 with a colour band and a one-line "why".
const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v))
export const cToF = (c) => (c * 9) / 5 + 32

// 0 at/below `off`, 100 at/above `full`; linear between. Handles a falling ramp
// when off > full (e.g. cold-favoured disease).
function ramp(v, off, full) {
  if (v == null || isNaN(v)) return 0
  if (off === full) return v >= full ? 100 : 0
  return clamp(((v - off) / (full - off)) * 100)
}
const mean = (xs) => { const a = (xs || []).filter((v) => v != null && !isNaN(v)); return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null }
const band = (s) => (s >= 70 ? 'high' : s >= 40 ? 'moderate' : s >= 15 ? 'low' : 'none')

// Grass relevance: each model lists the turf it can affect as lowercase tokens
// ('bent', 'poa', 'rye', 'bluegrass', 'fescue', 'bermuda', 'zoysia'), or 'any'
// for weed-timing/universal models. Keep a model when the club grows a matching
// grass — or when no grasses are set (can't filter, so show everything).
function grassApplies(modelGrasses, club) {
  if (!club || club.length === 0) return true
  if (!modelGrasses || modelGrasses.includes('any')) return true
  const c = club.map((g) => String(g).toLowerCase())
  return modelGrasses.some((tok) => c.some((g) => g.includes(tok)))
}

// ── Air-temperature / humidity disease models ────────────────────────────────
// Built from the last few days of daily weather. Combine drivers with a
// geometric-style min so a model only lights up when ALL of its conditions line
// up (warm nights AND warm days AND humidity, etc.).
export function airDiseaseRisks(daily = [], asOf, grasses = []) {
  const to = asOf || new Date().toISOString().slice(0, 10)
  const past = (daily || []).filter((d) => d.date <= to)
  if (past.length === 0) return []
  const last3 = past.slice(-3)
  const nightMin = mean(last3.map((d) => d.tMin))
  const dayMax = mean(last3.map((d) => d.tMax))
  const rh = mean(last3.map((d) => d.rhMean))
  const dp = mean(last3.map((d) => d.dpMean))
  const wetHrs = Math.max(0, ...last3.map((d) => d.bpHours || 0))
  // Moisture / leaf-wetness driver. Dew point is the most reliable signal — heavy
  // dew forms when it's high — because *average* daily RH rarely tops ~75% even
  // in humid weather (daytime lows drag it down). Backed by mean RH and measured
  // wet hours so any one strong signal is enough.
  const moisture = Math.max(ramp(dp, 58, 70), ramp(rh, 66, 86), ramp(wetHrs, 4, 10))

  const models = [
    // Dollar spot — warm days (60–85°F), mild nights with dew, and humidity/leaf
    // wetness. A general temperature+moisture model (not the Smith-Kerns logistic,
    // which needs °C inputs we don't reliably have here).
    { id: 'dollar_spot', label: 'Dollar spot', grasses: ['any'], desc: 'Warm days (≥~70°F), mild humid nights with heavy dew, and prolonged leaf wetness — the classic warm-day/cool-humid-night pattern.', score: Math.round(Math.min(ramp(dayMax, 60, 77), ramp(nightMin, 46, 58), moisture)) },
    { id: 'brown_patch', label: 'Brown patch', grasses: ['any'], desc: 'Warm nights (≥60°F), warm days (≥80°F) and high humidity over the last few days.', score: Math.round(Math.min(ramp(nightMin, 58, 68), ramp(dayMax, 78, 88), moisture)) },
    { id: 'pythium', label: 'Pythium blight', grasses: ['bent', 'poa', 'rye', 'bluegrass', 'fescue'], desc: 'Hot days (≥86°F), warm nights (≥68°F) and high humidity/leaf wetness. Can develop rapidly.', score: Math.round(Math.min(ramp(dayMax, 82, 90), ramp(nightMin, 65, 73), moisture)) },
    { id: 'anthracnose', label: 'Anthracnose', grasses: ['poa', 'bent'], desc: 'Warm days (≥82°F), warm nights (≥68°F) and high humidity/leaf wetness on stressed annual bluegrass.', score: Math.round(Math.min(ramp(dayMax, 80, 90), ramp(nightMin, 66, 74), moisture)) },
    { id: 'gray_leaf', label: 'Gray leaf spot', grasses: ['rye', 'fescue'], desc: 'Hot days (≥86°F), warm nights (≥70°F) and prolonged humidity/leaf wetness; worst on perennial ryegrass.', score: Math.round(Math.min(ramp(dayMax, 84, 92), ramp(nightMin, 68, 76), moisture)) },
    { id: 'microdochium', label: 'Microdochium patch', grasses: ['bent', 'poa', 'rye', 'fescue', 'bluegrass'], desc: 'Favoured by cool (≤55°F), high humidity/leaf wetness and prolonged wetness/rain.', score: Math.round(Math.min(ramp(dayMax, 60, 45), moisture)) },
  ]
  return models.filter((m) => grassApplies(m.grasses, grasses)).map((m) => ({ ...m, score: clamp(Math.round(m.score)), band: band(m.score), driver: 'air' }))
}

// ── Soil-temperature disease / weed models ───────────────────────────────────
// Driven by current 2" soil temp + its direction (rising/falling), so spring and
// fall windows read correctly.
export function soilDiseaseRisks(soil, trend, asOf, grasses = []) {
  if (soil == null) return []
  const rising = trend === 'rising'
  const falling = trend === 'falling'
  // A "band" score: 100 inside [lo,hi], ramping off outside by `edge` degrees.
  const inBand = (v, lo, hi, edge = 6) => {
    if (v >= lo && v <= hi) return 100
    if (v < lo) return ramp(v, lo - edge, lo)
    return ramp(v, hi + edge, hi)
  }
  const models = [
    { id: 'poa_germ', label: 'Annual bluegrass germination', grasses: ['any'], desc: 'Germinates as soil cools below ~70°F; favoured 50–64°F, mainly a fall flush.', score: falling ? inBand(soil, 50, 64) : inBand(soil, 50, 64) * 0.5 },
    { id: 'goosegrass_germ', label: 'Goosegrass germination', grasses: ['any'], desc: 'Germinates as soil warms past ~60–65°F, ~2 weeks after crabgrass. Apply pre-emergent before this window.', score: rising ? ramp(soil, 58, 66) : ramp(soil, 58, 66) * 0.6 },
    { id: 'large_patch', label: 'Large patch', grasses: ['zoysia', 'bermuda'], desc: 'Warm-season turf (zoysia, bermuda): active when soil is ~50–70°F with moisture, in spring and fall.', score: inBand(soil, 50, 70) },
    { id: 'summer_patch', label: 'Summer patch', grasses: ['poa', 'bluegrass', 'fescue', 'bent'], desc: 'Root infection begins as soil warms through ~65°F at 2" in spring — the preventive fungicide window.', score: rising ? ramp(soil, 60, 70) : ramp(soil, 60, 70) * 0.7 },
    { id: 'spring_dead_spot', label: 'Spring dead spot', grasses: ['bermuda'], desc: 'Bermudagrass only: best controlled by fall fungicides as soil cools through ~55–70°F — the preventive window.', score: falling ? inBand(soil, 55, 70) : inBand(soil, 55, 70) * 0.4 },
  ]
  return models.filter((m) => grassApplies(m.grasses, grasses)).map((m) => ({ ...m, score: clamp(Math.round(m.score)), band: band(m.score), driver: 'soil' }))
}

// All disease/weed risks, worst-first. Pass the club's site grasses to hide
// diseases that can't affect the turf you grow.
export function diseaseRisks(daily, soil, trend, asOf, grasses = []) {
  const rows = [...airDiseaseRisks(daily, asOf, grasses), ...soilDiseaseRisks(soil, trend, asOf, grasses)]
  return rows.sort((a, b) => b.score - a.score)
}

// ── Growing Degree Days (base 50°F, from Jan 1) + 7-day forecast ──────────────
// `daily` should include forecast days (fetchWeather gives ~14). Returns the
// accumulated GDD to today and the projected total a week out.
export function gddSummary(daily = [], asOf) {
  const to = asOf || new Date().toISOString().slice(0, 10)
  const year = String((to || '').slice(0, 4) || new Date().getFullYear())
  const yr = (daily || []).filter((d) => d.date.startsWith(year) && d.tMax != null && d.tMin != null)
  const dayGdd = (d) => Math.max(0, (d.tMax + d.tMin) / 2 - 50)
  let toDate = 0
  yr.filter((d) => d.date <= to).forEach((d) => { toDate += dayGdd(d) })
  const next7 = yr.filter((d) => d.date > to).slice(0, 7)
  const fc = next7.reduce((s, d) => s + dayGdd(d), 0)
  return { toDate: Math.round(toDate), forecast7: Math.round(fc), projected: Math.round(toDate + fc), base: '50°F' }
}

// ── GDD-based pest stages (base 50°F from Jan 1) ──────────────────────────────
// Each pest has ordered stages with a GDD window [start,end]. Given the current
// GDD we report the active stage, the next one, or "all passed".
export const PEST_STAGES = [
  { id: 'crabgrass', label: 'Crabgrass germination', stages: [{ name: 'First germination (apply PRE before)', start: 55, end: 160 }, { name: 'Peak germination', start: 160, end: 400 }] },
  { id: 'abw', label: 'Annual bluegrass weevil', stages: [{ name: 'Adult migration', start: 20, end: 120 }, { name: 'Egg-laying / small larvae (target)', start: 120, end: 350 }, { name: 'Large larvae / pupae', start: 350, end: 600 }] },
  { id: 'white_grub', label: 'White grub egg hatch', stages: [{ name: 'Adult flight', start: 700, end: 900 }, { name: 'Egg hatch (curative window)', start: 900, end: 1200 }] },
  { id: 'billbug', label: 'Bluegrass billbug', stages: [{ name: 'Adult activity (target adults)', start: 280, end: 560 }, { name: 'Larvae (curative)', start: 560, end: 925 }] },
]

export function pestStages(gdd, list = PEST_STAGES) {
  return (list || []).map((p) => {
    const active = p.stages.find((s) => gdd >= s.start && gdd < s.end)
    const upcoming = p.stages.find((s) => gdd < s.start)
    let status, tone
    if (active) { status = `In window: ${active.name}`; tone = 'now' }
    else if (upcoming) { status = `Next: ${upcoming.name} at ${upcoming.start} GDD`; tone = 'soon' }
    else { status = 'All windows passed for the season'; tone = 'passed' }
    return { id: p.id, label: p.label, status, tone }
  })
}
