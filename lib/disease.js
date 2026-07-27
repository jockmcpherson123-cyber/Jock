// Fungicide protection tracking — the "how much cover is left?" model.
//
// This mirrors GreenKeeper's Pest View: after you spray a fungicide, it protects
// the turf for a window of days. As that window runs down, the bar shrinks and
// the app flags you BEFORE the grass is exposed again — instead of only telling
// you today's disease risk. It reuses data you already store (approved/completed
// sheets + product type), so nothing new has to be entered to make it work.

const DEFAULT_INTERVAL_DAYS = 14

function toTime(d) {
  return d ? new Date(`${d}T00:00:00`).getTime() : null
}

// Whole days between a spray date and "now" (or an explicit asOf date, for tests).
export function daysSince(dateStr, asOf) {
  const t = toTime(dateStr)
  if (t == null) return null
  const now = asOf != null ? toTime(asOf) : Date.now()
  return Math.floor((now - t) / 86400000)
}

// The protective window, in days, for one fungicide product. Prefers an explicit
// spray interval set in the Chemical Library; falls back to the rotation window,
// then a sensible 14-day default so the model still works before anything is set.
export function protectionWindow(prod) {
  if (!prod) return DEFAULT_INTERVAL_DAYS
  const iv = Number(prod.sprayInterval)
  if (iv > 0) return iv
  const rot = Number(prod.rotationDays)
  if (rot > 0) return rot
  return DEFAULT_INTERVAL_DAYS
}

const todayISO = () => new Date().toISOString().slice(0, 10)

// ── Temperature-driven breakdown ─────────────────────────────────────────────
// Fungicides degrade faster when it's warm (microbial + chemical breakdown), so
// the protective window shrinks in heat. Instead of counting calendar days, we
// count HEAT: accumulate degree-days since the spray and burn the protection
// down faster on hot days.
//
//   BASE_F  — below this, breakdown is negligible (dormant biology)
//   REF_F   — the temperature at which the label's spray interval is assumed true
//
// At REF_F a day contributes (REF_F - BASE_F) degree-days, so the threshold is
// reached in exactly `windowDays`. Hotter days contribute more → expires sooner;
// cooler days contribute less → protection lasts longer.
export const BREAKDOWN_BASE_F = 40
export const BREAKDOWN_REF_F = 68

// series: daily mean temperatures [{ date:'YYYY-MM-DD', temp:Number }] — soil
// temperature preferred, air temperature as a fallback.
export function temperatureBreakdown(lastDate, windowDays, series = [], asOf) {
  const threshold = windowDays * (BREAKDOWN_REF_F - BREAKDOWN_BASE_F)
  const to = asOf || todayISO()
  const days = (series || []).filter((d) => d && d.date > lastDate && d.date <= to && d.temp != null && !isNaN(Number(d.temp)))
  if (days.length === 0) return null // no temperature data — caller falls back to days
  let ddd = 0
  days.forEach((d) => { ddd += Math.max(0, Number(d.temp) - BREAKDOWN_BASE_F) })
  const remaining = threshold - ddd
  const pct = threshold > 0 ? Math.max(0, Math.min(100, Math.round((remaining / threshold) * 100))) : 0
  // Recent daily heat (last 7 logged days) to project how many days are left.
  const recent = days.slice(-7)
  const rate = recent.reduce((s, d) => s + Math.max(0, Number(d.temp) - BREAKDOWN_BASE_F), 0) / recent.length
  const daysLeft = rate > 0 ? Math.max(0, Math.round(remaining / rate)) : null
  return { threshold: Math.round(threshold), ddd: Math.round(ddd), remaining: Math.round(remaining), pct, daysLeft, rate: Math.round(rate * 10) / 10, days: days.length }
}

// Build a per-area protection summary from the sprays that actually happened
// (approved or completed). For each area we take its most recent fungicide
// application and count how much of the protective window remains.
//
// If `tempSeries` (daily mean temps) is provided, protection burns down by HEAT
// (temperature-driven breakdown) instead of calendar days; otherwise it falls
// back to plain days. Returns one row per area, sorted worst-first.
export function protectionByArea(sheets, products, areas, asOf, tempSeries = null) {
  const prodByName = {}
  ;(products || []).forEach((p) => { prodByName[p.name] = p })
  const isFungicide = (name) => prodByName[name]?.type === 'Fungicide'

  const lastByArea = {}
  ;(sheets || [])
    .filter((s) => (s.status === 'approved' || s.completed) && s.date && s.area)
    .forEach((s) => {
      const fung = (s.products || [])
        .filter((p) => isFungicide(p.product))
        .map((p) => p.product)
      if (fung.length === 0) return
      if (!lastByArea[s.area] || s.date > lastByArea[s.area].date) {
        lastByArea[s.area] = { date: s.date, products: fung }
      }
    })

  const areaKeys = areas && Object.keys(areas).length ? Object.keys(areas) : Object.keys(lastByArea)

  const rows = areaKeys.map((area) => {
    const last = lastByArea[area]
    if (!last) return { area, last: null, status: 'none', remaining: null, window: null, since: null, pct: 0, mode: 'none' }
    // If several fungicides went out together, the most persistent one sets the
    // window (you're covered until the longest-lasting product wears off).
    const window = Math.max(...last.products.map((n) => protectionWindow(prodByName[n])))
    const since = daysSince(last.date, asOf)

    // Temperature-driven breakdown when we have the temps; else plain calendar days.
    const bd = tempSeries && tempSeries.length ? temperatureBreakdown(last.date, window, tempSeries, asOf) : null
    if (bd) {
      const remaining = bd.daysLeft == null ? 0 : bd.daysLeft
      let status = 'ok'
      if (bd.remaining <= 0) status = 'expired'
      else if ((bd.daysLeft != null && bd.daysLeft <= 3) || bd.pct <= 20) status = 'soon'
      return { area, last, since, window, mode: 'temp', remaining, pct: bd.pct, status, ddd: bd.ddd, threshold: bd.threshold, daysLeft: bd.daysLeft, rate: bd.rate }
    }

    const remaining = window - since
    const pct = window > 0 ? Math.max(0, Math.min(100, Math.round((remaining / window) * 100))) : 0
    let status = 'ok'
    if (remaining <= 0) status = 'expired'
    else if (remaining <= Math.max(2, Math.round(window * 0.2))) status = 'soon'
    return { area, last, since, window, mode: 'days', remaining, pct, status }
  })

  const order = { expired: 0, soon: 1, ok: 2, none: 3 }
  return rows.sort(
    (a, b) => order[a.status] - order[b.status] || (a.remaining ?? 9999) - (b.remaining ?? 9999)
  )
}

// Count how many areas are exposed (protection gone) or nearly so — for the
// dashboard's "needs attention" rollup.
export function protectionAlertCount(rows) {
  return (rows || []).filter((r) => r.status === 'expired' || r.status === 'soon').length
}
