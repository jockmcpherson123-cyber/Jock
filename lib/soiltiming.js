// Soil-temperature application timing — "when should I pull the trigger?"
//
// Many turf applications are best timed to soil temperature (2" / 0–7cm) and its
// direction (warming in spring, cooling in fall): pre-emergents go down BEFORE a
// weed's germination temp, summer-patch preventives START at a warming threshold,
// fall products go down as the soil COOLS through a threshold. This is a pure
// engine over the current soil temp + trend; thresholds are published, transition-
// zone starting points the user can tune.

// months are 1-indexed (Jan = 1). `type` picks the timing logic:
//   preEmRising    — apply BEFORE the soil reaches `threshold` (rising season)
//   startRising    — START the program when soil reaches `threshold` (rising)
//   coolingFalling — apply as soil COOLS through `threshold` (falling season)
//   watchWarm      — a risk watch that's active once soil is above `threshold`
export const TIMING_WINDOWS = [
  // ── Spring ────────────────────────────────────────────────────────────────
  { id: 'crabgrass', label: 'Crabgrass pre-emergent', type: 'preEmRising', threshold: 55, band: 6, months: [2, 3, 4, 5], lead: 10, split: true, phenology: 'Forsythia gold fading → lilac (or redbud) in full bloom marks germination.', note: 'Apply before 2" soil holds ~55°F — that’s when crabgrass germinates.',
    watch: 'Germinates as soil warms past ~55°F in early spring (≈ forsythia bloom). Thin, sunny, compacted turf is most at risk.',
    control: 'Get a pre-emergent down BEFORE germination; a split application extends control. Overlap thin areas. Post-emergents only work on young plants.' },
  { id: 'poaseedhead', label: 'Poa seedhead (Proxy/Primo)', type: 'startRising', threshold: 55, band: 5, high: 8, months: [3, 4, 5], note: 'Start Proxy/Primo seedhead suppression as soil warms through ~55°F.',
    watch: 'Annual bluegrass pushes seedheads as soil warms through ~55°F in spring, making greens bumpy.',
    control: 'Time Proxy (± Primo) to the ~55°F / GDD window, with a second app ~14–21 days later. Miss the window and suppression is lost for the year.' },
  { id: 'goosegrass', label: 'Goosegrass pre-emergent', type: 'preEmRising', threshold: 62, band: 6, months: [3, 4, 5, 6], lead: 10, split: true, phenology: 'Roughly 2 weeks behind crabgrass — dogwood / horsechestnut bloom.', note: 'Germinates later than crabgrass; get it down before ~60–65°F.',
    watch: 'Germinates ~2 weeks after crabgrass as soil passes ~60–65°F — worst in compacted, wet, worn areas.',
    control: 'Pre-emergent timed a bit later than crabgrass; relieve compaction and improve drainage. Post-emergent control is difficult — treat young plants.' },
  { id: 'summerpatch', label: 'Summer patch preventive', type: 'startRising', threshold: 65, band: 5, high: 8, months: [4, 5, 6], note: 'Begin the preventive program when 2" soil first reaches ~65°F.',
    watch: 'Roots infect as soil warms through ~65°F in spring; damage appears later under summer heat/drought on Poa & bluegrass.',
    control: 'Preventive DMI/QoI/SDHI drenched to the roots at the ~65°F window — curative summer sprays are far weaker. Raise HOC, avoid drought stress, use acidifying N.' },
  { id: 'fairyring', label: 'Fairy ring preventive', type: 'startRising', threshold: 60, band: 5, high: 12, months: [4, 5, 6, 7], note: 'Preventive apps as the soil warms through ~60–70°F.',
    watch: 'Rings of dark-green, dead arcs or mushrooms appear as soil warms through ~60–70°F, worse in thatchy/hydrophobic soils.',
    control: 'Preventive DMI/QoI drench + wetting agents and deep watering; core-aerate. Mask stimulated rings with nitrogen/iron.' },
  // ── Summer (active once soil holds the threshold) ──────────────────────────
  { id: 'dollarspot', label: 'Dollar spot cover', type: 'watchWarm', threshold: 60, months: [5, 6, 7, 8, 9, 10], note: 'Pressure builds once soil holds ~60°F.',
    watch: 'The most common summer disease — silver-dollar spots once soil holds ~60°F with heavy dew and low nitrogen.',
    control: 'Keep nitrogen adequate, remove morning dew (mow/roll/drag), and rotate FRAC groups (DMI, SDHI, nitrile) — resistance develops fast. See the rated fungicide list on the Dollar spot profile.' },
  { id: 'brownpatch', label: 'Brown patch cover', type: 'watchWarm', threshold: 65, months: [6, 7, 8, 9], note: 'Warm nights + soil ≥65°F keep it active.',
    watch: 'Circular patches with a grey "smoke ring" in hot, humid weather once soil is ≥65°F with warm nights — worst on lush, high-N turf.',
    control: 'Ease off summer nitrogen, improve airflow and drainage, water early so leaves dry by evening. Preventive SDHI/QoI/DMI on a rotation.' },
  { id: 'pythium', label: 'Pythium watch', type: 'watchWarm', threshold: 68, months: [6, 7, 8, 9], note: 'High risk once soil is above ~68°F with warm, humid nights.',
    watch: 'Can wipe out turf overnight when soil is ≥68°F with warm nights and saturated soil; spreads along drainage and mowing lines.',
    control: 'Improve drainage/airflow, avoid evening irrigation and mowing wet turf. Needs Pythium-specific chemistry (mefenoxam, cyazofamid, phosphonates) — most fungicides don’t touch it.' },
  { id: 'anthracnose', label: 'Anthracnose / heat stress', type: 'watchWarm', threshold: 68, months: [6, 7, 8], note: 'Stress disease of summer Poa greens.',
    watch: 'Annual bluegrass greens under summer stress (heat, low N, low mowing, compaction) once soil is ~68°F+.',
    control: 'Reduce stress FIRST — raise HOC slightly, keep nitrogen up, relieve compaction, manage moisture. Rotate preventive fungicides (QoI/DMI/SDHI/benzimidazole).' },
  { id: 'wetting', label: 'Wetting agent / dry spot', type: 'watchWarm', threshold: 70, months: [6, 7, 8, 9], note: 'Hydrophobic soils shed water in summer heat.',
    watch: 'Localized dry spot appears in hot, dry spells (soil ≥70°F) where the rootzone turns hydrophobic and repels water — greens go off-color in patches.',
    control: 'Run wetting agents on a program, hand-water hot spots, and syringe to cool. Core-aerate to break through the water-repellent layer.' },
  // ── Fall ───────────────────────────────────────────────────────────────────
  { id: 'fallpreem', label: 'Fall Poa / goosegrass pre-em', type: 'coolingFalling', threshold: 70, band: 6, months: [7, 8, 9], lead: 10, phenology: 'Late-summer cool-down — the fall Poa flush follows the first break in the heat.', note: 'Apply as the soil cools to ~70°F in late summer.',
    watch: 'The fall Poa/goosegrass flush germinates as soil cools back through ~70°F in late summer.',
    control: 'Apply a pre-emergent as soil cools through ~70°F; reduce compaction and surface moisture to slow the flush.' },
  { id: 'overseed', label: 'Overseeding window', type: 'coolingFalling', threshold: 75, band: 6, months: [8, 9, 10], note: 'Seed as soil cools through ~70–75°F.',
    watch: 'Fall seed establishes best as soil cools through ~70–75°F — too warm and heat/disease kill the seedlings.',
    control: 'Seed at the ~75°F cooling window; keep the surface moist, feed lightly, and HOLD any pre-emergent that would block germination.' },
  { id: 'takeall', label: 'Take-all / fall fungicide', type: 'coolingFalling', threshold: 65, band: 8, months: [8, 9, 10], note: 'Fall preventive as the soil cools through ~60–70°F.',
    watch: 'Take-all patch infects bentgrass in fall as soil cools through ~55–70°F; the damage only shows next spring.',
    control: 'Fall fungicide (DMI/QoI) at the cooling window; acidify with ammonium N + manganese, avoid liming, improve drainage.' },
  { id: 'fallfert', label: 'Fall fertilization / recovery', type: 'coolingFalling', threshold: 70, band: 8, months: [9, 10, 11], note: 'Prime rooting/recovery window as soil cools through ~65–75°F.',
    watch: 'The best rooting and carbohydrate-storage window of the year opens as soil cools through ~65–75°F.',
    control: 'Feed for rooting and recovery, core-aerate and topdress into the window, and keep growth going while soil is still warm.' },
  { id: 'snowmold', label: 'Snow mold preventive', type: 'coolingFalling', threshold: 48, band: 6, months: [10, 11, 12], note: 'Apply as soil cools below ~50°F, before snow cover.',
    watch: 'Pink/grey snow mold develops under cold, wet conditions and snow cover once soil drops below ~50°F.',
    control: 'Preventive fungicide before consistent snow cover; avoid late-fall nitrogen flushes, keep mowing until dormancy, and manage drainage/drifting.' },
]

// Rising / falling / flat from a daily soil-temp series: mean of the last 7 days
// vs the 7 before that.
export function soilTrend(series = []) {
  const temps = (series || []).map((d) => (d.temp != null ? Number(d.temp) : (d.soil != null ? Number(d.soil) : null))).filter((v) => v != null && !isNaN(v))
  if (temps.length < 4) return 'flat'
  const last = temps.slice(-7)
  const prev = temps.slice(-14, -7)
  if (prev.length === 0) return 'flat'
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length
  const diff = mean(last) - mean(prev)
  if (diff >= 1) return 'rising'
  if (diff <= -1) return 'falling'
  return 'flat'
}

// Current soil temp = mean of the most recent up-to-3 days in the series.
export function currentSoilTemp(series = []) {
  const temps = (series || []).map((d) => (d.temp != null ? Number(d.temp) : (d.soil != null ? Number(d.soil) : null))).filter((v) => v != null && !isNaN(v))
  if (temps.length === 0) return null
  const recent = temps.slice(-3)
  return Math.round((recent.reduce((s, v) => s + v, 0) / recent.length) * 10) / 10
}

function statusFor(w, soil, trend, month) {
  if (!w.months.includes(month)) return 'offseason'
  if (soil == null) return 'unknown'
  if (w.type === 'preEmRising') {
    if (soil >= w.threshold) return 'passed'                             // germination underway
    if (trend !== 'falling' && soil >= w.threshold - w.band) return 'now'
    if (trend !== 'falling' && soil >= w.threshold - w.band - 8) return 'soon'
    return 'later'
  }
  if (w.type === 'startRising') {
    const top = w.threshold + (w.high || 8)
    if (soil > top) return 'passed'
    if (soil >= w.threshold) return 'now'
    if (soil >= w.threshold - w.band) return 'soon'
    return 'later'
  }
  if (w.type === 'coolingFalling') {
    if (soil <= w.threshold - w.band) return 'passed'                    // cooled past it
    if (soil <= w.threshold + w.band) return 'now'
    if (soil <= w.threshold + w.band + 8) return 'soon'
    return 'later'                                                       // still too warm
  }
  if (w.type === 'watchWarm') return soil >= w.threshold ? 'now' : 'later'
  return 'later'
}

// Score every window against the current soil temp + trend. `overrides` maps a
// window id to a custom threshold. Returns rows sorted now → soon → later, with
// off-season windows dropped — unless `includeOffseason` is true (Turf tab shows
// the full list).
export function applicationTimings(soil, trend, date = new Date(), overrides = {}, includeOffseason = false) {
  const month = date.getMonth() + 1
  const order = { now: 0, soon: 1, later: 2, unknown: 3, offseason: 4 }
  return TIMING_WINDOWS
    .map((w) => {
      const threshold = overrides[w.id] != null ? Number(overrides[w.id]) : w.threshold
      const ww = { ...w, threshold }
      const status = statusFor(ww, soil, trend, month)
      return { id: w.id, label: w.label, type: w.type, threshold, note: w.note, watch: w.watch, control: w.control, status, direction: w.type === 'coolingFalling' ? 'falling' : 'rising', months: w.months }
    })
    .filter((r) => includeOffseason || r.status !== 'offseason')
    .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))
}

// Windows that are open right now — for the dashboard nudge.
export function openWindows(soil, trend, date = new Date(), overrides = {}) {
  return applicationTimings(soil, trend, date, overrides).filter((r) => r.status === 'now')
}

// ── Predictive timing ────────────────────────────────────────────────────────
// How fast the soil is moving, in °F/day, from a daily soil-temp series:
// (mean of the last 7 days − mean of the 7 before that) / 7. Positive = warming,
// negative = cooling. Returns null when there isn't enough history.
export function soilRate(series = []) {
  const temps = (series || [])
    .map((d) => (d.temp != null ? Number(d.temp) : (d.soil != null ? Number(d.soil) : null)))
    .filter((v) => v != null && !isNaN(v))
  if (temps.length < 8) return null
  const last = temps.slice(-7)
  const prev = temps.slice(-14, -7)
  if (prev.length < 3) return null
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length
  return Math.round(((mean(last) - mean(prev)) / 7) * 100) / 100
}

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + Math.round(n))
  return d
}

// Project when the soil will cross a window's threshold, and the apply-by date
// (threshold date minus the product's lead time so it's watered in before
// germination). Works for rising pre-emergents and the fall cooling flush.
// Returns null for windows without a directional threshold (watch-only), or when
// the soil isn't moving toward the threshold fast enough to project.
//   { crossed, daysToThreshold, thresholdDate, applyByDate, applyDays, overdue }
export function projectWindow(w, soil, rate, date = new Date(), leadDefault = 10) {
  if (!w || soil == null || rate == null) return null
  if (w.type !== 'preEmRising' && w.type !== 'coolingFalling') return null
  const lead = w.lead || leadDefault
  const rising = w.type === 'preEmRising'
  const crossed = rising ? soil >= w.threshold : soil <= w.threshold
  if (crossed) {
    return { crossed: true, daysToThreshold: 0, thresholdDate: date, applyByDate: null, applyDays: null, overdue: true }
  }
  // Need the soil moving toward the threshold: warming for spring, cooling for fall.
  if (rising && rate <= 0.05) return { crossed: false, daysToThreshold: null, stalled: true }
  if (!rising && rate >= -0.05) return { crossed: false, daysToThreshold: null, stalled: true }
  const daysToThreshold = (w.threshold - soil) / rate // sign of (Δtemp) matches sign of rate
  if (!(daysToThreshold > 0) || daysToThreshold > 120) return { crossed: false, daysToThreshold: null, stalled: true }
  const thresholdDate = addDays(date, daysToThreshold)
  const applyDays = daysToThreshold - lead
  const applyByDate = addDays(date, applyDays)
  return {
    crossed: false,
    daysToThreshold: Math.round(daysToThreshold),
    thresholdDate,
    applyByDate,
    applyDays: Math.round(applyDays),
    overdue: applyDays <= 0,
    lead,
  }
}
