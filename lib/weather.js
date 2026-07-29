// Weather + agronomic model helpers.
//
// Weather comes from Open-Meteo (https://open-meteo.com) — free, no API key,
// global coverage, CORS-enabled so the browser can call it directly. Give it a
// latitude/longitude and it returns recent history + a forecast for the nearest
// station. Everything downstream (GDD, disease risk) is computed from that.

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive'
const GEOCODE_URL = 'https://nominatim.openstreetmap.org/search'

// Fetch hourly + daily weather for a location, covering recent past and a
// forecast window.
export async function fetchWeather(lat, lng, { pastDays = 92, forecastDays = 14 } = {}) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    hourly: 'temperature_2m,relative_humidity_2m,dew_point_2m,precipitation,precipitation_probability,wind_speed_10m,et0_fao_evapotranspiration',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
    temperature_unit: 'fahrenheit',
    precipitation_unit: 'inch',
    wind_speed_unit: 'mph',
    timezone: 'auto',
    past_days: String(pastDays),
    forecast_days: String(forecastDays),
  })
  const res = await fetch(`${FORECAST_URL}?${params.toString()}`)
  if (!res.ok) throw new Error(`Weather service returned ${res.status}`)
  return res.json()
}

// Current conditions right now, for stamping onto a spray sheet.
export async function fetchCurrent(lat, lng) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: 'auto',
  })
  const res = await fetch(`${FORECAST_URL}?${params.toString()}`)
  if (!res.ok) throw new Error(`Weather service returned ${res.status}`)
  const j = await res.json()
  const c = j?.current || {}
  return {
    temp: c.temperature_2m != null ? String(Math.round(c.temperature_2m)) : '',
    humidity: c.relative_humidity_2m != null ? String(Math.round(c.relative_humidity_2m)) : '',
    wind: c.wind_speed_10m != null ? String(Math.round(c.wind_speed_10m)) : '',
    windDir: degToCompass(c.wind_direction_10m),
  }
}

// Recent daily mean temperatures for the fungicide-breakdown clock: soil
// temperature (0–7 cm, what the chemical actually sits in) preferred, air
// temperature as a fallback. Only the last `pastDays` are needed since the model
// only looks back to the most recent spray. Returns [{ date, soil, air, temp }].
export async function fetchBreakdownTemps(lat, lng, pastDays = 45) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    hourly: 'soil_temperature_0_to_7cm,temperature_2m',
    past_days: String(pastDays),
    forecast_days: '1',
    temperature_unit: 'fahrenheit',
    timezone: 'auto',
  })
  const res = await fetch(`${FORECAST_URL}?${params.toString()}`)
  if (!res.ok) throw new Error(`Weather service returned ${res.status}`)
  const j = await res.json()
  const h = j?.hourly
  if (!h?.time) return []
  const byDay = {}
  h.time.forEach((iso, i) => {
    const day = iso.slice(0, 10)
    const soil = h.soil_temperature_0_to_7cm?.[i]
    const air = h.temperature_2m?.[i]
    ;(byDay[day] ||= { soil: [], air: [] })
    if (soil != null) byDay[day].soil.push(soil)
    if (air != null) byDay[day].air.push(air)
  })
  const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null)
  return Object.entries(byDay)
    .map(([date, v]) => {
      const soil = mean(v.soil)
      const air = mean(v.air)
      return { date, soil: soil != null ? Math.round(soil * 10) / 10 : null, air: air != null ? Math.round(air * 10) / 10 : null, temp: soil != null ? soil : air }
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}

// Wind direction in degrees → 16-point compass label (e.g. 200 → "SSW").
export function degToCompass(deg) {
  if (deg == null) return ''
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  return dirs[Math.round(deg / 22.5) % 16]
}

// Historical daily weather for the current season (Jan 1 → today), from the
// archive API. This is what makes season-to-date GDD accurate — the live
// forecast endpoint only reaches back ~90 days. The archive lags real time by a
// few days, so we backfill the gap with the forecast endpoint's recent history.
export async function fetchSeasonDaily(lat, lng) {
  return fetchYearDaily(lat, lng, new Date().getFullYear())
}

// Daily archive (temps + precip) for a whole calendar year — the current year
// runs Jan 1 → today; a past year runs the full Jan 1 → Dec 31. Used for the
// rainfall tracker's year-over-year comparison.
export async function fetchYearDaily(lat, lng, year) {
  const today = todayISO()
  const thisYear = Number(today.slice(0, 4))
  const end = Number(year) < thisYear ? `${year}-12-31` : today
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    start_date: `${year}-01-01`,
    end_date: end,
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
    temperature_unit: 'fahrenheit',
    precipitation_unit: 'inch',
    timezone: 'auto',
  })
  const res = await fetch(`${ARCHIVE_URL}?${params.toString()}`)
  if (!res.ok) throw new Error(`Archive returned ${res.status}`)
  const j = await res.json()
  const d = j?.daily
  if (!d?.time) return []
  return d.time.map((date, i) => ({
    date,
    tMax: d.temperature_2m_max?.[i] ?? null,
    tMin: d.temperature_2m_min?.[i] ?? null,
    precip: d.precipitation_sum?.[i] ?? 0,
  }))
}

// Total this year's rainfall from every source: the season archive (Jan 1 →
// ~5 days ago) is authoritative for the past, the forecast daily fills the last
// few days the archive hasn't published, and manual rain-gauge entries win over
// both. Returns YTD + last-30-day totals, per-month totals, and the rainy days,
// up to `today`.
export function buildRainYear(season, forecast, overrides, today) {
  const year = today.slice(0, 4)
  const map = {}
  ;[...(forecast || []), ...(season || [])].forEach((d) => {
    if (d?.date && d.precip != null) map[d.date] = Math.round(Number(d.precip) * 100) / 100
  })
  Object.entries(overrides || {}).forEach(([date, v]) => { if (v != null) map[date] = Math.round(Number(v) * 100) / 100 })
  const days = Object.entries(map)
    .filter(([date]) => date.startsWith(year) && date <= today)
    .map(([date, precip]) => ({ date, precip, manual: overrides?.[date] != null }))
    .sort((a, b) => a.date.localeCompare(b.date))
  const ytd = days.reduce((s, d) => s + d.precip, 0)
  const byMonth = {}
  days.forEach((d) => { const m = d.date.slice(0, 7); byMonth[m] = Math.round(((byMonth[m] || 0) + d.precip) * 100) / 100 })
  const cut = new Date(today + 'T00:00:00'); cut.setDate(cut.getDate() - 30)
  const cutIso = cut.toISOString().slice(0, 10)
  const last30 = days.filter((d) => d.date > cutIso).reduce((s, d) => s + d.precip, 0)
  const wettest = days.reduce((a, d) => (d.precip > (a?.precip || 0) ? d : a), null)
  return { ytd: Math.round(ytd * 100) / 100, last30: Math.round(last30 * 100) / 100, byMonth, days, wettest, year }
}

// Pull the daily block straight out of a forecast response.
export function dailyFromForecastBlock(data) {
  const d = data?.daily
  if (!d?.time) return []
  return d.time.map((date, i) => ({
    date,
    tMax: d.temperature_2m_max?.[i] ?? null,
    tMin: d.temperature_2m_min?.[i] ?? null,
    precip: d.precipitation_sum?.[i] ?? 0,
  }))
}

// Merge two daily lists, preferring `override` wherever it has real values
// (used to patch the archive's few-day lag with recent forecast data).
export function mergeDaily(primary, override) {
  const map = new Map(primary.map((x) => [x.date, x]))
  override.forEach((x) => { if (x.tMax != null && x.tMin != null) map.set(x.date, x) })
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
}

// GDD (base 50°F) accumulated from Jan 1 of the current year up to today, from a
// list of daily {date, tMax, tMin}.
export function gddFromDaily(list) {
  const year = String(new Date().getFullYear())
  const today = todayISO()
  let acc = 0
  return list
    .filter((x) => x.date.startsWith(year) && x.date <= today && x.tMax != null && x.tMin != null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((x) => {
      const g = Math.max(0, (x.tMax + x.tMin) / 2 - 50)
      acc += g
      return { date: x.date, daily: Math.round(g * 10) / 10, acc: Math.round(acc * 10) / 10 }
    })
}

// GDD accumulated SINCE a given date (exclusive) up to today, at a chosen base
// temperature. The turf growth-regulator model uses base 32°F (0°C). Returns the
// rounded total, or null if no start date.
export function gddSince(list, startDate, base = 32) {
  if (!startDate) return null
  const today = todayISO()
  let acc = 0
  list
    .filter((x) => x.date > startDate && x.date <= today && x.tMax != null && x.tMin != null)
    .forEach((x) => { acc += Math.max(0, (x.tMax + x.tMin) / 2 - base) })
  return Math.round(acc)
}

// Estimate the calendar date when `remaining` growing-degree-days will accrue,
// walking the forecast day by day from `asOf`. Beyond the forecast horizon it
// extrapolates at the forecast's average daily GDD. Returns { date, days } or
// null when there's no usable forecast. `daily` should include future rows.
export function projectGddReachDate(remaining, daily = [], base = 32, asOf) {
  const to = asOf || todayISO()
  if (remaining <= 0) return { date: to, days: 0 }
  const future = (daily || [])
    .filter((d) => d.date > to && d.tMax != null && d.tMin != null)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (future.length === 0) return null
  const dayG = (d) => Math.max(0, (d.tMax + d.tMin) / 2 - base)
  let acc = 0
  for (const d of future) {
    acc += dayG(d)
    if (acc >= remaining) return { date: d.date, days: daysBetweenISO(to, d.date) }
  }
  // Past the forecast window — extrapolate at the average forecast rate.
  const avg = future.reduce((s, d) => s + dayG(d), 0) / future.length
  if (avg <= 0) return null
  const extra = Math.ceil((remaining - acc) / avg)
  const last = new Date(future[future.length - 1].date + 'T00:00:00')
  last.setDate(last.getDate() + extra)
  const date = last.toISOString().slice(0, 10)
  return { date, days: daysBetweenISO(to, date) }
}
function daysBetweenISO(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000)
}

// Best-effort geocode of a street address → { lat, lng }. Uses OpenStreetMap's
// free Nominatim service. Returns null if nothing was found.
export async function geocodeAddress(address) {
  const params = new URLSearchParams({ format: 'json', limit: '1', q: address })
  const res = await fetch(`${GEOCODE_URL}?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Lookup returned ${res.status}`)
  const list = await res.json()
  if (!list || list.length === 0) return null
  return { lat: Number(list[0].lat), lng: Number(list[0].lon) }
}

// Collapse the hourly series into one record per day with the aggregates the
// models need: mean temp / RH / dew point, daily high/low, total precip, and a
// count of "brown patch favourable" hours (warm + very humid).
export function dailyFromHourly(data) {
  const h = data?.hourly
  if (!h?.time) return []
  const byDay = {}
  h.time.forEach((t, i) => {
    const day = t.slice(0, 10)
    const hour = Number(t.slice(11, 13))
    const b = (byDay[day] ||= { tSum: 0, rhSum: 0, dpSum: 0, n: 0, tMax: -Infinity, tMin: Infinity, precip: 0, bpHours: 0, windDayMax: 0, probDayMax: 0, et: 0 })
    const temp = h.temperature_2m?.[i]
    const rh = h.relative_humidity_2m?.[i]
    const dp = h.dew_point_2m?.[i]
    const pr = h.precipitation?.[i]
    const wind = h.wind_speed_10m?.[i]
    const prob = h.precipitation_probability?.[i]
    const et = h.et0_fao_evapotranspiration?.[i]
    if (et != null) b.et += et
    if (temp != null) { b.tSum += temp; b.tMax = Math.max(b.tMax, temp); b.tMin = Math.min(b.tMin, temp); b.n++ }
    if (rh != null) b.rhSum += rh
    if (dp != null) b.dpSum += dp
    if (pr != null) b.precip += pr
    if (temp != null && rh != null && temp > 70 && rh > 95) b.bpHours++
    // Morning spray window (6am–noon) wind + rain-probability peaks drive the
    // spray-window rating — that's when this crew mainly sprays.
    if (hour >= 6 && hour <= 12) {
      if (wind != null) b.windDayMax = Math.max(b.windDayMax, wind)
      if (prob != null) b.probDayMax = Math.max(b.probDayMax, prob)
    }
  })
  return Object.entries(byDay)
    .map(([date, b]) => ({
      date,
      tMean: b.n ? b.tSum / b.n : null,
      rhMean: b.n ? b.rhSum / b.n : null,
      dpMean: b.n ? b.dpSum / b.n : null,
      tMax: isFinite(b.tMax) ? b.tMax : null,
      tMin: isFinite(b.tMin) ? b.tMin : null,
      precip: Math.round(b.precip * 100) / 100,
      bpHours: b.bpHours,
      windMax: Math.round(b.windDayMax),
      precipProb: Math.round(b.probDayMax),
      et: Math.round(b.et * 1000) / 1000,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// Suggested irrigation to replace the day's water loss: reference ET × a
// replacement factor (turf managers commonly put back 60–100% of ET), minus any
// rain. In inches. `factor` is 0–1.
export function irrigationNeed(day, factor = 0.8) {
  if (day.et == null) return null
  const need = day.et * factor - (day.precip || 0)
  return Math.round(Math.max(0, need) * 100) / 100
}

// A rough turf-stress read for the day from heat + ET demand.
export function turfStress(day) {
  const t = day.tMax
  const et = day.et
  if ((et != null && et >= 0.25) || (t != null && t >= 90)) return { level: 'high', label: 'High — heat/ET stress midday; consider syringing' }
  if ((et != null && et >= 0.18) || (t != null && t >= 82)) return { level: 'moderate', label: 'Moderate — watch greens midday' }
  return { level: 'low', label: 'Low — comfortable' }
}

// The hour-by-hour series for one date, for the interactive daily graph.
export function hourlyForDay(data, date) {
  const h = data?.hourly
  if (!h?.time) return []
  const out = []
  h.time.forEach((t, i) => {
    if (t.slice(0, 10) !== date) return
    out.push({
      time: t,
      hour: Number(t.slice(11, 13)),
      temp: h.temperature_2m?.[i] ?? null,
      rh: h.relative_humidity_2m?.[i] ?? null,
      prob: h.precipitation_probability?.[i] ?? null,
      precip: h.precipitation?.[i] ?? null,
      wind: h.wind_speed_10m?.[i] ?? null,
      et: h.et0_fao_evapotranspiration?.[i] ?? null,
    })
  })
  return out.sort((a, b) => a.hour - b.hour)
}

// Rate a day for spraying from its morning (6am–noon) wind + rain outlook.
// Returns { level: 'good'|'caution'|'poor', reasons: [] }.
export function sprayWindow(day) {
  const reasons = []
  let level = 'good'
  const bump = (l) => { if (l === 'poor') level = 'poor'; else if (l === 'caution' && level !== 'poor') level = 'caution' }
  const wind = day.windMax
  const prob = day.precipProb
  const rain = day.precip
  if (wind != null) {
    if (wind >= 15) { bump('poor'); reasons.push(`Windy — ${wind} mph (drift)`) }
    else if (wind >= 10) { bump('caution'); reasons.push(`Breezy — ${wind} mph`) }
  }
  if (rain >= 0.1 || prob >= 70) { bump('poor'); reasons.push(prob >= 70 ? `Rain likely — ${prob}%` : `Rain — ${rain}"`) }
  else if (prob >= 40 || rain > 0) { bump('caution'); reasons.push(prob >= 40 ? `Rain possible — ${prob}%` : `Light rain — ${rain}"`) }
  if (reasons.length === 0) reasons.push('Calm and dry')
  return { level, reasons }
}

// Smith-Kerns Dollar Spot index (University of Wisconsin), per the brief:
//   DSI = -4.5719 + 0.1732·RH + 0.0894·T + 0.1458·DPT
// Risk is "elevated" when DSI > 0 on 3+ consecutive days.
export function smithKernsDSI(day) {
  if (day.rhMean == null || day.tMean == null || day.dpMean == null) return null
  return -4.5719 + 0.1732 * day.rhMean + 0.0894 * day.tMean + 0.1458 * day.dpMean
}

// Growing Degree Days, base 50°F, accumulated from Jan 1 of the current year.
export function gddSeries(daily) {
  const year = String(new Date().getFullYear())
  let acc = 0
  return daily
    .filter((d) => d.date.startsWith(year) && d.tMax != null && d.tMin != null)
    .map((d) => {
      const g = Math.max(0, (d.tMax + d.tMin) / 2 - 50)
      acc += g
      return { date: d.date, daily: Math.round(g * 10) / 10, acc: Math.round(acc * 10) / 10 }
    })
}

const todayISO = () => new Date().toISOString().slice(0, 10)

// Roll the daily series up into a "what's the situation right now" summary used
// by the Weather page and (later) the command-center cards.
export function summarize(daily) {
  const today = todayISO()
  const past = daily.filter((d) => d.date <= today)
  const withDSI = past.map((d) => ({ ...d, dsi: smithKernsDSI(d) }))

  // Dollar spot: consecutive days (ending today) with DSI > 0.
  let dsStreak = 0
  for (let i = withDSI.length - 1; i >= 0; i--) {
    if (withDSI[i].dsi != null && withDSI[i].dsi > 0) dsStreak++
    else break
  }
  const latestDSI = withDSI.length ? withDSI[withDSI.length - 1].dsi : null
  const dollarSpot = {
    dsi: latestDSI,
    streak: dsStreak,
    level: dsStreak >= 3 ? 'high' : dsStreak >= 1 ? 'moderate' : 'low',
  }

  // Brown patch: favourable hours over the last day or two.
  const recent = past.slice(-2)
  const bpHours = recent.reduce((m, d) => Math.max(m, d.bpHours || 0), 0)
  const brownPatch = {
    hours: bpHours,
    level: bpHours >= 10 ? 'high' : bpHours >= 5 ? 'moderate' : 'low',
  }

  const gdd = gddSeries(daily)
  const gddNow = gdd.length ? gdd[gdd.length - 1].acc : 0

  return { dollarSpot, brownPatch, gddNow, gdd }
}
