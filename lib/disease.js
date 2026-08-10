// Fungicide protection tracking — the "how much cover is left?" model.
//
// This mirrors GreenKeeper's Pest View: after you spray a fungicide, it protects
// the turf for a window of days. As that window runs down, the bar shrinks and
// the app flags you BEFORE the grass is exposed again — instead of only telling
// you today's disease risk. It reuses data you already store (approved/completed
// sheets + product type), so nothing new has to be entered to make it work.

import { localDateISO } from './dates'
import { sheetApplied } from './applied'
import { diseasesForProduct } from './fungicides'

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

const todayISO = () => localDateISO()

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


// ── Per-DISEASE coverage ─────────────────────────────────────────────────────
// The richer model the superintendent asked for. Instead of only reading the
// LAST tank, this tracks each disease on its own: for every disease you've been
// spraying for lately (in a given area), it finds the MOST RECENT spray whose
// product actually controls that disease, and counts down THAT product's
// residual. So an earlier fungicide can still be "covering" dollar spot even
// after a newer tank that only targeted, say, pythium — nothing gets dropped
// just because a different product went out on top of it.
//
// Returns one row per area: { area, worst, counts, diseases: [ { disease,
// product, date, since, window, remaining, pct, status, mode } ] }, sorted so
// the areas (and diseases) that need attention float to the top. `status` is
// 'ok' | 'soon' | 'expired'. The disease list is built automatically from the
// products actually sprayed within `lookbackDays`.
export function diseaseCoverageByArea(sheets, products, areas, asOf, tempSeries = null, { lookbackDays = 45 } = {}) {
  const prodByName = {}
  ;(products || []).forEach((p) => { prodByName[p.name] = p })
  const isFungicide = (name) => prodByName[name]?.type === 'Fungicide'
  const asOfISO = asOf || todayISO()
  const cutoff = new Date(new Date(`${asOfISO}T00:00:00`).getTime() - lookbackDays * 86400000).toISOString().slice(0, 10)

  // Applied fungicide sprays grouped by area (each: { date, products:[names] }).
  const byArea = {}
  ;(sheets || [])
    .filter((s) => sheetApplied(s) && s.date && s.area)
    .forEach((s) => {
      const fung = (s.products || []).filter((p) => isFungicide(p.product)).map((p) => p.product)
      if (fung.length === 0) return
      ;(byArea[s.area] ||= []).push({ date: s.date, products: fung })
    })

  const order = { expired: 0, soon: 1, ok: 2 }

  const areaRows = Object.keys(byArea).map((area) => {
    const sprays = byArea[area].slice().sort((a, b) => b.date.localeCompare(a.date)) // newest first

    // For each disease, the most recent spray+product that controls it (walk
    // newest→oldest, first hit wins). Keyed by lowercased label.
    const cover = new Map()
    for (const sp of sprays) {
      for (const pname of sp.products) {
        for (const d of diseasesForProduct(prodByName[pname] || pname)) {
          const key = d.toLowerCase()
          if (!cover.has(key)) cover.set(key, { disease: d, product: pname, date: sp.date })
        }
      }
    }

    // Only list diseases we've actually been spraying for recently.
    const universe = new Set()
    for (const sp of sprays) {
      if (sp.date < cutoff) continue
      for (const pname of sp.products) {
        for (const d of diseasesForProduct(prodByName[pname] || pname)) universe.add(d.toLowerCase())
      }
    }

    const diseases = [...cover.entries()]
      .filter(([key]) => universe.has(key))
      .map(([, c]) => {
        const prod = prodByName[c.product]
        const window = protectionWindow(prod)
        const since = daysSince(c.date, asOfISO)
        const bd = tempSeries && tempSeries.length ? temperatureBreakdown(c.date, window, tempSeries, asOfISO) : null
        let remaining, pct, status
        if (bd) {
          remaining = bd.daysLeft == null ? 0 : bd.daysLeft
          pct = bd.pct
          status = bd.remaining <= 0 ? 'expired' : ((bd.daysLeft != null && bd.daysLeft <= 3) || bd.pct <= 20 ? 'soon' : 'ok')
        } else {
          remaining = window - since
          pct = window > 0 ? Math.max(0, Math.min(100, Math.round((remaining / window) * 100))) : 0
          status = remaining <= 0 ? 'expired' : (remaining <= Math.max(2, Math.round(window * 0.2)) ? 'soon' : 'ok')
        }
        return { disease: c.disease, product: c.product, date: c.date, since, window, remaining, pct, status, mode: bd ? 'temp' : 'days' }
      })
      .sort((a, b) => order[a.status] - order[b.status] || (a.remaining ?? 9999) - (b.remaining ?? 9999) || a.disease.localeCompare(b.disease))

    const counts = { expired: 0, soon: 0, ok: 0 }
    diseases.forEach((d) => { counts[d.status]++ })
    const worst = diseases.length === 0 ? 'ok' : diseases[0].status
    return { area, diseases, counts, worst }
  })

  return areaRows
    .filter((r) => r.diseases.length > 0)
    .sort((a, b) => order[a.worst] - order[b.worst] || a.area.localeCompare(b.area))
}

// How many diseases (across all areas) are exposed or running out — for the
// dashboard's "needs attention" rollup.
export function coverageGapCount(areaRows) {
  return (areaRows || []).reduce((n, r) => n + r.counts.expired + r.counts.soon, 0)
}
