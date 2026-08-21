// ── Site climate normals ─────────────────────────────────────────────────────
// Pulls several years of the course's own archive weather (Open-Meteo ERA5) and
// averages the 2" soil-temperature curve to find the dates that actually drive
// program timing at THIS site — when soil crosses 55°F and 65°F in spring, and
// falls back through 70°F and 55°F in fall. Those crossings anchor the crabgrass
// pre-emergent, the spring summer-patch window, and the fall Poa pre-emergent, so
// the generated program is tuned to the course instead of a regional average.
//
// Runs in the browser (Open-Meteo is CORS-enabled, no key). One archive request
// covers the whole multi-year range; we aggregate hourly soil temps to a daily
// mean, average each calendar day across the years, smooth, and read the
// crossings off the smoothed curve.

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive'

// An ordered list of MM-DD for a non-leap reference year (365 days).
function calendarDays() {
  const out = []
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  for (let m = 0; m < 12; m++) for (let d = 1; d <= days[m]; d++) out.push(`${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  return out
}

// Fetch the multi-year hourly 2" soil temp and reduce to a per-calendar-day mean
// averaged across all the years pulled.
export async function fetchSiteClimate(lat, lng, { years = 5 } = {}) {
  const endYear = new Date().getFullYear() - 1 // last complete year
  const startYear = endYear - years + 1
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    start_date: `${startYear}-01-01`,
    end_date: `${endYear}-12-31`,
    hourly: 'soil_temperature_0_to_7cm',
    temperature_unit: 'fahrenheit',
    timezone: 'auto',
  })
  const res = await fetch(`${ARCHIVE_URL}?${params.toString()}`)
  if (!res.ok) throw new Error(`Archive returned ${res.status}`)
  const j = await res.json()
  const times = j?.hourly?.time
  const soil = j?.hourly?.soil_temperature_0_to_7cm
  if (!times || !soil) throw new Error('No soil data for this location')

  // Hourly → daily mean (keyed by full date).
  const dayAgg = {}
  times.forEach((t, i) => {
    const v = soil[i]
    if (v == null) return
    const date = t.slice(0, 10)
    ;(dayAgg[date] ||= { sum: 0, n: 0 })
    dayAgg[date].sum += v
    dayAgg[date].n += 1
  })
  // Daily mean → averaged across years by MM-DD.
  const byMD = {}
  Object.entries(dayAgg).forEach(([date, a]) => {
    if (!a.n) return
    const md = date.slice(5) // MM-DD
    if (md === '02-29') return // drop leap day
    ;(byMD[md] ||= []).push(a.sum / a.n)
  })

  const cal = calendarDays()
  const avg = cal.map((md) => {
    const xs = byMD[md]
    return { md, temp: xs && xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null }
  })
  // 7-day smoothing so a single warm/cold day doesn't move a crossing.
  const smooth = avg.map((row, i) => {
    const win = avg.slice(Math.max(0, i - 3), i + 4).map((r) => r.temp).filter((v) => v != null)
    return { md: row.md, temp: win.length ? win.reduce((s, v) => s + v, 0) / win.length : null }
  })

  // Read the crossings off the smoothed curve.
  const idx = (md) => cal.indexOf(md)
  const inRange = (i, loMD, hiMD) => i >= idx(loMD) && i <= idx(hiMD)
  const firstRising = (mark, loMD, hiMD) => {
    for (let i = 0; i < smooth.length; i++) {
      if (!inRange(i, loMD, hiMD)) continue
      if (smooth[i].temp != null && smooth[i].temp >= mark) return smooth[i].md
    }
    return null
  }
  const firstFalling = (mark, loMD, hiMD) => {
    for (let i = 0; i < smooth.length; i++) {
      if (!inRange(i, loMD, hiMD)) continue
      if (smooth[i].temp != null && smooth[i].temp < mark) return smooth[i].md
    }
    return null
  }

  const climate = {
    spring55: firstRising(55, '02-15', '05-31'),
    spring65: firstRising(65, '03-15', '06-30'),
    fall70: firstFalling(70, '08-15', '11-30'),
    fall55: firstFalling(55, '09-15', '12-15'),
    years: [startYear, endYear],
    source: `Open-Meteo ERA5 archive, ${startYear}–${endYear} average`,
    tuned: true,
  }
  // If any crossing couldn't be found (odd climate/location), null it so the
  // caller can fall back to the regional default for that one field.
  return climate
}
