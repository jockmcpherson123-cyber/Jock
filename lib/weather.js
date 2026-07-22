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
    hourly: 'temperature_2m,relative_humidity_2m,dew_point_2m,precipitation',
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
  const year = new Date().getFullYear()
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    start_date: `${year}-01-01`,
    end_date: new Date().toISOString().slice(0, 10),
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
    const b = (byDay[day] ||= { tSum: 0, rhSum: 0, dpSum: 0, n: 0, tMax: -Infinity, tMin: Infinity, precip: 0, bpHours: 0 })
    const temp = h.temperature_2m?.[i]
    const rh = h.relative_humidity_2m?.[i]
    const dp = h.dew_point_2m?.[i]
    const pr = h.precipitation?.[i]
    if (temp != null) { b.tSum += temp; b.tMax = Math.max(b.tMax, temp); b.tMin = Math.min(b.tMin, temp); b.n++ }
    if (rh != null) b.rhSum += rh
    if (dp != null) b.dpSum += dp
    if (pr != null) b.precip += pr
    if (temp != null && rh != null && temp > 70 && rh > 95) b.bpHours++
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
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
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
