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
  { id: 'crabgrass', label: 'Crabgrass pre-emergent', type: 'preEmRising', threshold: 55, band: 6, months: [2, 3, 4, 5], note: 'Apply before 2" soil holds ~55°F — that’s when crabgrass germinates.' },
  { id: 'goosegrass', label: 'Goosegrass pre-emergent', type: 'preEmRising', threshold: 62, band: 6, months: [3, 4, 5, 6], note: 'Germinates later than crabgrass; get it down before ~60–65°F.' },
  { id: 'summerpatch', label: 'Summer patch preventive', type: 'startRising', threshold: 65, band: 5, high: 8, months: [4, 5, 6], note: 'Begin the preventive program when 2" soil first reaches ~65°F.' },
  { id: 'fairyring', label: 'Fairy ring preventive', type: 'startRising', threshold: 60, band: 5, high: 12, months: [4, 5, 6], note: 'Preventive apps as the soil warms through ~60–70°F.' },
  { id: 'pythium', label: 'Pythium watch', type: 'watchWarm', threshold: 68, months: [6, 7, 8, 9], note: 'High risk once soil is above ~68°F with warm, humid nights.' },
  { id: 'fallpreem', label: 'Fall Poa / goosegrass pre-em', type: 'coolingFalling', threshold: 70, band: 6, months: [7, 8, 9], note: 'Apply as the soil cools to ~70°F in late summer.' },
  { id: 'takeall', label: 'Take-all / fall fungicide', type: 'coolingFalling', threshold: 65, band: 8, months: [8, 9, 10], note: 'Fall preventive as the soil cools through ~60–70°F.' },
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
// off-season windows dropped.
export function applicationTimings(soil, trend, date = new Date(), overrides = {}) {
  const month = date.getMonth() + 1
  const order = { now: 0, soon: 1, later: 2, unknown: 3 }
  return TIMING_WINDOWS
    .map((w) => {
      const threshold = overrides[w.id] != null ? Number(overrides[w.id]) : w.threshold
      const ww = { ...w, threshold }
      const status = statusFor(ww, soil, trend, month)
      return { id: w.id, label: w.label, type: w.type, threshold, note: w.note, status, direction: w.type === 'coolingFalling' ? 'falling' : 'rising' }
    })
    .filter((r) => r.status !== 'offseason')
    .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))
}

// Windows that are open right now — for the dashboard nudge.
export function openWindows(soil, trend, date = new Date(), overrides = {}) {
  return applicationTimings(soil, trend, date, overrides).filter((r) => r.status === 'now')
}
