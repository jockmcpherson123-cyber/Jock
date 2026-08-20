// Turf disease-risk indices, GDD, and GDD-based pest stages.
//
// These are GENERAL, directional models built from published temperature /
// humidity / soil-temperature thresholds — they point you at what to watch, and
// should be calibrated to your own region and history. Weather comes in as the
// Fahrenheit daily aggregates from lib/weather (tMax, tMin, tMean, rhMean,
// dpMean, bpHours, precip) plus 2" soil temps (fetchBreakdownTemps). Every risk
// score is 0–100 with a colour band and a one-line "why".
import { localDateISO } from './dates'

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
  const to = asOf || localDateISO()
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
    { id: 'dollar_spot', label: 'Dollar spot', grasses: ['any'], desc: 'Warm days (≥~70°F), mild humid nights with heavy dew, and prolonged leaf wetness — the classic warm-day/cool-humid-night pattern.', source: 'Risk index from published dollar-spot temperature/leaf-wetness thresholds; the app’s headline dollar-spot number uses the validated Univ. of Wisconsin Smith-Kerns model.', score: Math.round(Math.min(ramp(dayMax, 60, 77), ramp(nightMin, 46, 58), moisture)) },
    { id: 'brown_patch', label: 'Brown patch', grasses: ['any'], desc: 'Warm nights (≥60°F), warm days (≥80°F) and high humidity over the last few days.', source: 'Risk index from Rhizoctonia brown patch temperature/humidity thresholds (Penn State & Rutgers turf extension).', score: Math.round(Math.min(ramp(nightMin, 58, 68), ramp(dayMax, 78, 88), moisture)) },
    { id: 'pythium', label: 'Pythium blight', grasses: ['bent', 'poa', 'rye', 'bluegrass', 'fescue'], desc: 'Hot days (≥86°F), warm nights (≥68°F) and high humidity/leaf wetness. Can develop rapidly.', source: 'Risk index from Pythium blight hot-night/leaf-wetness forecasting thresholds (Rutgers & Penn State turf extension).', score: Math.round(Math.min(ramp(dayMax, 82, 90), ramp(nightMin, 65, 73), moisture)) },
    // Anthracnose foliar blight is a DAYTIME heat-stress (80–95°F) + leaf-wetness
    // + plant-stress disease on annual bluegrass — it is not gated by night lows,
    // so day heat × moisture drives it, with warm nights only nudging it up.
    // (Penn State / Rutgers BMPs.)
    { id: 'anthracnose', label: 'Anthracnose', grasses: ['poa', 'bent'], desc: 'Daytime heat stress (80–95°F) with prolonged leaf wetness on stressed annual bluegrass — worst late summer under low mowing / low nitrogen.', source: 'Risk index from anthracnose (Colletotrichum cereale) BMPs — Rutgers & Penn State turf extension.', score: Math.round(Math.min(ramp(dayMax, 78, 92), moisture) * (0.7 + 0.3 * ramp(nightMin, 60, 72) / 100)) },
    // Gray leaf spot: warm days (80–90°F), nights ABOVE ~65°F, and long leaf
    // wetness in August; devastating on perennial ryegrass. (UGA / Ohio State.)
    { id: 'gray_leaf', label: 'Gray leaf spot', grasses: ['rye', 'fescue'], desc: 'Warm days (80–90°F), nights above ~65°F and prolonged humidity/leaf wetness in August; worst on perennial ryegrass.', source: 'Risk index from gray leaf spot (Pyricularia) thresholds — UGA & Ohio State turf extension.', score: Math.round(Math.min(ramp(dayMax, 80, 90), ramp(nightMin, 64, 72), moisture)) },
    { id: 'microdochium', label: 'Microdochium patch', grasses: ['bent', 'poa', 'rye', 'fescue', 'bluegrass'], desc: 'Favoured by cool (≤55°F), high humidity/leaf wetness and prolonged wetness/rain.', source: 'Risk index from Microdochium patch cool-wet thresholds (Oregon State & Washington State turf extension).', score: Math.round(Math.min(ramp(dayMax, 60, 45), moisture)) },
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
    { id: 'poa_germ', label: 'Annual bluegrass germination', grasses: ['any'], desc: 'Germinates as soil cools below ~70°F; favoured 50–64°F, mainly a fall flush.', source: 'Soil-temperature germination timing — Poa annua extension guidance (Penn State & Purdue).', score: falling ? inBand(soil, 50, 64) : inBand(soil, 50, 64) * 0.5 },
    // Goosegrass germinates in SPRING as soil warms THROUGH ~58–66°F (a band that
    // peaks at the threshold and closes once soil is well past it). Only a real
    // window while soil is rising — near-zero when cooling in late summer/fall.
    { id: 'goosegrass_germ', label: 'Goosegrass germination', grasses: ['any'], desc: 'Germinates in spring as soil warms through ~60–65°F, ~2 weeks after crabgrass. Apply pre-emergent before this window; the window closes once soil is warm and cooling.', source: 'Goosegrass germination soil-temperature timing — NC State & Purdue turf extension.', score: rising ? inBand(soil, 58, 68) : inBand(soil, 58, 68) * 0.25 },
    { id: 'large_patch', label: 'Large patch', grasses: ['zoysia', 'bermuda'], desc: 'Warm-season turf (zoysia, bermuda): active when soil is ~50–70°F with moisture, in spring and fall.', source: 'Large patch (Rhizoctonia solani AG 2-2) soil-temperature window — NC State turf extension.', score: inBand(soil, 50, 70) },
    // Summer patch root infection begins in SPRING as soil warms through ~64–70°F
    // at 2" — that rising window is the preventive-fungicide timing. Symptoms show
    // in summer, but by then the preventive window has closed, so this reads high
    // only while soil is rising through the band. (Penn State / NC State.)
    { id: 'summer_patch', label: 'Summer patch', grasses: ['poa', 'bluegrass', 'fescue', 'bent'], desc: 'Root infection begins in spring as soil warms through ~64–70°F at 2" — the preventive fungicide window. Symptoms appear in summer, but the spraying window is spring.', source: 'Summer patch (Magnaporthiopsis poae) spring preventive timing — Penn State & NC State turf extension.', score: rising ? inBand(soil, 62, 72) : inBand(soil, 62, 72) * 0.3 },
    { id: 'spring_dead_spot', label: 'Spring dead spot', grasses: ['bermuda'], desc: 'Bermudagrass only: best controlled by fall fungicides as soil cools through ~55–70°F — the preventive window.', source: 'Spring dead spot fall preventive window — Oklahoma State & NC State turf extension.', score: falling ? inBand(soil, 55, 70) : inBand(soil, 55, 70) * 0.4 },
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
  const to = asOf || localDateISO()
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
// GDD windows are base 50°F accumulated from Jan 1. These are published
// transition-zone starting points — calibrate to your own scouting history.
export const PEST_STAGES = [
  // Smooth crabgrass germinates ~150 GDD50, large crabgrass ~300+; the PRE has to
  // be down BEFORE that. (Purdue / Michigan State.)
  { id: 'crabgrass', label: 'Crabgrass germination', source: 'Crabgrass germination GDD — Purdue & Michigan State turf extension.', stages: [{ name: 'First germination (apply PRE before)', start: 120, end: 300 }, { name: 'Peak germination', start: 300, end: 600 }] },
  { id: 'abw', label: 'Annual bluegrass weevil', source: 'ABW degree-day development model — Cornell & Rutgers turf entomology (first generation).', stages: [{ name: 'Adult migration', start: 20, end: 120 }, { name: 'Egg-laying / small larvae (target)', start: 120, end: 350 }, { name: 'Large larvae / pupae', start: 350, end: 600 }] },
  // Japanese-beetle-type white grubs: adults emerge ~1,030–2,150 GDD50, then
  // eggs hatch and young grubs (the curative window) run into late summer/early
  // fall — the mid-Atlantic grub-control window. (UMass / Iowa State.)
  { id: 'white_grub', label: 'White grub egg hatch', source: 'White grub / Japanese beetle degree-day timing — UMass & Iowa State extension.', stages: [{ name: 'Adult flight / egg-laying', start: 1030, end: 2000 }, { name: 'Egg hatch — young grubs (curative window)', start: 2000, end: 2600 }] },
  { id: 'billbug', label: 'Bluegrass billbug', source: 'Bluegrass billbug degree-day model — Ohio State & Univ. of Nebraska extension.', stages: [{ name: 'Adult activity (target adults)', start: 280, end: 560 }, { name: 'Larvae (curative)', start: 560, end: 925 }] },
]

export function pestStages(gdd, list = PEST_STAGES) {
  return (list || []).map((p) => {
    const active = p.stages.find((s) => gdd >= s.start && gdd < s.end)
    const upcoming = p.stages.find((s) => gdd < s.start)
    let status, tone
    if (active) { status = `In window: ${active.name}`; tone = 'now' }
    else if (upcoming) { status = `Next: ${upcoming.name} at ${upcoming.start} GDD`; tone = 'soon' }
    else { status = 'All windows passed for the season'; tone = 'passed' }
    return { id: p.id, label: p.label, status, tone, source: p.source }
  })
}

// ── Pest Watch (transition-zone scouting calendar) ───────────────────────────
// A GDD-from-Jan-1 readout is only useful in spring, when windows are
// approaching; by late summer every window has "passed" and it says nothing.
// It also ports northern GDD numbers onto warm Maryland, which mis-times them.
// This calendar answers the real question — WHEN do I watch for each pest, and
// WHAT do I look for — using transition-zone (mid-Atlantic) month windows plus a
// soil-temp / adult-sighting cue, so it stays useful and honest year-round.
// Each pest: months [start,end] (1–12), a plain window label, the trigger cue,
// a scouting method, the control-timing note, and a cited source.
const WATCH_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const PEST_WATCH = [
  { id: 'fall_armyworm', label: 'Fall armyworm', months: [7, 10], window: 'Late Jul – Oct',
    cue: 'Migrates north in mid–late summer; damage can appear almost overnight.',
    scout: 'Soap-flush suspicious patches (1–2 oz dish soap per gallon of water) — small green/brown caterpillars come to the surface. Watch for sudden brown areas, moths at dusk and birds feeding.',
    stage: 'Small (young) caterpillars — greenish and under ~¾". Controls drop off fast once they’re large.',
    action: 'Treat within a day or two of confirming small caterpillars — they strip turf fast. Spray late in the day and don’t water in right away.',
    products: 'Diamides (chlorantraniliprole, cyantraniliprole) or spinosad / Bt on small larvae; a pyrethroid (bifenthrin, lambda-cyhalothrin) for fast knockdown.',
    source: 'University of Maryland & Alabama Extension — target small larvae; diamides/neonics/spinosad.' },
  { id: 'white_grub', label: 'White grubs', months: [8, 10], window: 'Late Aug – Oct (curative)',
    cue: 'Japanese beetle / masked chafer adults flew Jun–Jul; eggs are hatching to young grubs now. (Preventives go down Jun–mid-Jul.)',
    scout: 'Cut a 1 sq ft flap and peel it back — count grubs. Roughly 5–10+ per sq ft on greens/tees warrants treatment. Look for spongy turf and birds/skunks digging.',
    stage: 'Young grubs (1st–2nd instar) — small and feeding near the surface. Large grubs in fall are hard to kill.',
    action: 'Curative window is late Aug–Sept while grubs are small. Water in ~½" right after applying to move it to the root zone.',
    products: 'Curative: trichlorfon (fast) or clothianidin on young grubs. Preventives (imidacloprid, chlorantraniliprole) go down Jun–mid-Jul, before hatch.',
    source: 'University of Maryland Extension — curative ~September on young larvae.' },
  { id: 'chinch_bug', label: 'Chinch bugs', months: [6, 9], window: 'Jun – Sept',
    cue: 'Hot, dry, sunny turf in summer — worst on full-sun banks and fairways.',
    scout: 'Part the turf at the green/brown edge and watch for small black-and-white bugs; or press an open-ended can into the soil and flood it.',
    stage: 'Nymphs and adults living down in the thatch.',
    action: 'Spot-treat the hot, dry, sunny areas where damage shows; treat the thatch, not just the surface.',
    products: 'Pyrethroids (bifenthrin, lambda-cyhalothrin) or clothianidin for a quick hit; chlorantraniliprole for longer residual.',
    source: 'University of Maryland Extension — hairy chinch bug.' },
  { id: 'cutworm_webworm', label: 'Cutworms & sod webworms', months: [5, 9], window: 'May – Sept',
    cue: 'Night-feeding caterpillars through the warm months; damage shows on greens and tees.',
    scout: 'Soap-flush at dusk; look for pencil-width holes, chewed leaf tips and ball-mark-sized scars on greens.',
    stage: 'Small larvae, active at night.',
    action: 'Treat small larvae in the evening when they surface; hold off mowing/irrigation afterward.',
    products: 'Diamides (chlorantraniliprole), spinosad or Bt on small larvae; indoxacarb or a pyrethroid for knockdown.',
    source: 'Rutgers / University of Maryland — soap-flush scouting; evening larvicide.' },
  { id: 'abw', label: 'Annual bluegrass weevil', months: [4, 8], window: 'Apr – Aug (multiple gens)',
    cue: 'Adults move to short turf at forsythia bloom; 2–3 overlapping generations run into late summer.',
    scout: 'Soap-flush or vacuum green/fairway edges for adults; watch Poa collars and cleanup laps for yellowing from larvae.',
    stage: 'Adults early in the window; then small larvae (1st–3rd instar) feeding inside Poa stems.',
    action: 'Hit adults at forsythia bloom, or small larvae by degree-day timing. Rotate modes of action — ABW resists pyrethroids in many areas.',
    products: 'Adults: pyrethroids (bifenthrin, lambda-cyhalothrin). Larvae: cyantraniliprole, chlorantraniliprole, spinosad or indoxacarb.',
    source: 'Rutgers / Cornell turf entomology — cyantraniliprole controls all larval stages.' },
  { id: 'billbug', label: 'Bluegrass billbug', months: [4, 7], window: 'Spring – early summer',
    cue: 'Adults walk paths and cart paths on warm spring days; larvae tunnel stems into early summer.',
    scout: 'Look for adults on paths in spring; “tug test” thinning turf — billbug-killed stems pull free with sawdust-like frass.',
    stage: 'Adults in spring (before egg-laying); larvae tunnel stems in early summer.',
    action: 'Target adults in spring before eggs are laid, or use a systemic ahead of the larvae.',
    products: 'Adults: pyrethroids. Preventive/systemic: chlorantraniliprole or imidacloprid ahead of larvae.',
    source: 'Ohio State / Purdue turf entomology.' },
  { id: 'crabgrass', label: 'Crabgrass (pre-emergent)', months: [3, 4], window: 'Early spring',
    cue: 'Germinates as soil warms through ~55°F (forsythia bloom) — the pre-emergent must be down BEFORE that.',
    scout: 'This one is timing, not scouting: apply pre-emergent before soil reaches 55°F; a second app 6–8 weeks later covers the long germination window.',
    stage: 'Pre-germination — you’re stopping the seed before it emerges.',
    action: 'Pre-emergent down at or just before forsythia bloom; split/second application 6–8 weeks later extends control.',
    products: 'Pre-emergent herbicides: prodiamine, dithiopyr or pendimethalin. (Dithiopyr also has early post-emergent activity on small seedlings.)',
    source: 'UMD / Purdue — crabgrass pre-emergent timing.' },
]

// Status of each watch item for a given date: 'now' (in window), 'soon' (window
// opens next month), or 'off' (past for this year, or returns later). Sorted
// active-first so what matters today is on top.
export function pestWatch(dateISO) {
  const d = dateISO ? new Date(dateISO + 'T00:00:00') : new Date()
  const m = d.getMonth() + 1
  const rank = { now: 0, soon: 1, off: 2 }
  return PEST_WATCH
    .map((p) => {
      const [start, end] = p.months
      let tone, status
      if (m >= start && m <= end) { tone = 'now'; status = 'Watch now' }
      else if (m < start && start - m === 1) { tone = 'soon'; status = `Coming up · ${WATCH_MONTHS[start - 1]}` }
      else if (m > end) { tone = 'off'; status = 'Past for this year' }
      else { tone = 'off'; status = `Returns ${p.window}` }
      return { ...p, tone, status }
    })
    .sort((a, b) => rank[a.tone] - rank[b.tone])
}
