// ── Living Calendar: application triggers ────────────────────────────────────
// An application in the annual program can fire on a fixed date OR on a growth
// condition. This module defines that trigger model and, given this year's
// weather + the spray records, tells you where each application stands right now:
// on track, coming up, due, or overdue — with a projected date when we can guess
// one. The Coverage grid (concept 2) reads the same engine.

import { gddSince } from './weather'
import { currentSoilTemp, soilTrend } from './soiltiming'

// The trigger kinds offered in the editor. `date` is the classic fixed day.
export const TRIGGER_MODES = [
  { key: 'date', label: 'On a set date', hint: 'Runs on the calendar date you pick.' },
  { key: 'gdd', label: 'Growth (GDD) since last spray', hint: 'Fires once enough growing-degree-days build up since the last time this product hit this area. Great for growth regulators.' },
  { key: 'interval', label: 'Every so many days', hint: 'A steady interval since the last spray — e.g. a 14-day fungicide cycle.' },
  { key: 'soil', label: 'Soil temperature', hint: 'Waits until soil temperature crosses a threshold — e.g. a pre-emergent before soil hits 55°F.' },
]

// GDD base choices (°F). 32 is the turf growth-regulator standard; 50 is the
// classic "growing degree" base used for pest/insect timing.
export const GDD_BASES = [32, 50]

// A sensible starting trigger for a freshly-picked product: growth regulators
// lean on GDD, everything else defaults to a set date (what the program already
// did), so nothing changes until the user opts into a smarter trigger.
export function defaultTrigger(type) {
  if (String(type || '').toLowerCase().includes('growth')) {
    // Classic Primo greens model: 200 GDD at base 0°C = 360 GDD at base 32°F.
    return { mode: 'gdd', base: 32, target: 360 }
  }
  return { mode: 'date' }
}

// Fill in any missing fields so the rest of the engine can trust the shape.
export function normalizeTrigger(t, type) {
  const base = t && t.mode ? { ...t } : defaultTrigger(type)
  if (base.mode === 'gdd') {
    base.base = GDD_BASES.includes(Number(base.base)) ? Number(base.base) : 32
    // 360 GDD at base 32°F = the classic 200-GDD (base 0°C) Primo greens model.
    // Fall back to 360, not 200 — a 200 target at base 32°F would fire ~2× too often.
    base.target = Number(base.target) > 0 ? Number(base.target) : 360
  } else if (base.mode === 'interval') {
    base.days = Number(base.days) > 0 ? Number(base.days) : 14
  } else if (base.mode === 'soil') {
    base.temp = Number(base.temp) > 0 ? Number(base.temp) : 55
    base.dir = base.dir === 'falling' ? 'falling' : 'rising'
  }
  return base
}

// Plain-English one-liner for a trigger, shown under an application.
export function describeTrigger(t, type) {
  const n = normalizeTrigger(t, type)
  if (n.mode === 'gdd') return `${n.target} GDD (base ${n.base}°F) since last spray`
  if (n.mode === 'interval') return `Every ${n.days} days`
  if (n.mode === 'soil') return `Soil ${n.dir === 'falling' ? '≤' : '≥'} ${n.temp}°F & ${n.dir}`
  return 'On a set date'
}

// ── date helpers (all on plain YYYY-MM-DD strings, no timezone drift) ────────
export function isoAddDays(iso, days) {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
export function daysBetween(fromIso, toIso) {
  const a = new Date(fromIso + 'T00:00:00')
  const b = new Date(toIso + 'T00:00:00')
  return Math.round((b - a) / 86400000)
}

const norm = (s) => String(s || '').trim().toLowerCase()
// A record's area and a program area rarely read identically ("Blue Greens" vs
// "Blue Greens SprayBug 1.67gpm"), so match if either name contains the other.
function areaMatches(sheetArea, appArea) {
  const a = norm(sheetArea)
  const b = norm(appArea)
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a)
}
function sheetHasProduct(sheet, product) {
  return (sheet.products || []).some((p) => norm(p.product) === norm(product))
}
// A sheet counts as an actual spray once it's been approved or completed (a
// still-pending draft hasn't happened yet).
function sheetDone(s) {
  return s.completed === true || !!s.completedAt || s.status === 'approved' || s.status === 'completed' || s.status === 'logged'
}

// Most recent date (≤ asOf) this product actually hit this area, from the
// records — the anchor for GDD-since and interval triggers.
export function lastSprayDate(sheets = [], appArea, product, asOf) {
  let best = null
  for (const s of sheets) {
    if (!s.date || s.date > asOf) continue
    if (!sheetDone(s)) continue
    if (!areaMatches(s.area, appArea)) continue
    if (product && !sheetHasProduct(s, product)) continue
    if (!best || s.date > best) best = s.date
  }
  return best
}

// Most recent date (≤ asOf) that ANY growth-suppressing product hit this area —
// a true PGR or a DMI fungicide. `suppressors` is a Set of lowercased product
// names (from lib/pgr suppressionMap). Lets a DMI spray reset a PGR's GDD clock.
export function lastSuppressionDate(sheets = [], appArea, suppressors, asOf) {
  if (!suppressors || !suppressors.size) return null
  let best = null
  for (const s of sheets) {
    if (!s.date || s.date > asOf) continue
    if (!sheetDone(s)) continue
    if (!areaMatches(s.area, appArea)) continue
    if (!(s.products || []).some((p) => suppressors.has(norm(p.product)))) continue
    if (!best || s.date > best) best = s.date
  }
  return best
}
const isGrowthRegType = (type) => /growth/i.test(String(type || ''))

// Recent GDD accumulated per day (from the last ~10 days of season data), used
// to project when a GDD target will be reached. null if we can't tell.
function gddPerDay(season, today, base) {
  const start = isoAddDays(today, -10)
  const total = gddSince(season, start, base)
  if (total == null || total <= 0) return null
  return total / 10
}

// Roughly how many days one application keeps its area protected — used to draw
// the Coverage grid. An interval trigger states it outright; otherwise fall back
// to a sensible residual by product type.
export function coverageDays(app) {
  const t = normalizeTrigger(app.trigger, app.type)
  if (t.mode === 'interval') return t.days
  const type = String(app.type || '').toLowerCase()
  if (t.mode === 'gdd' || type.includes('growth')) return 21
  if (type.includes('fung') || type.includes('herb') || type.includes('insect') || app.target) return 21
  return 14
}

// The four rungs, most urgent first. `done` = already executed this season.
const RANK = { overdue: 0, due: 1, soon: 2, ok: 3, none: 4, done: 5 }
export function statusRank(state) { return RANK[state] ?? 4 }

// ── the engine ───────────────────────────────────────────────────────────────
// ctx: { season: dailyWeather[], soilSeries: breakdownTemps[], sheets, today }
// Returns { state, headline, detail, projectedDate, progress }.
export function triggerStatus(app, ctx = {}) {
  const today = ctx.today || new Date().toISOString().slice(0, 10)
  const t = normalizeTrigger(app.trigger, app.type)

  // Executed already? Nothing left to chase.
  if (app.linkedSheetId) {
    return { state: 'done', headline: 'Done', detail: 'Logged this season', projectedDate: null, progress: 1 }
  }

  if (t.mode === 'gdd') {
    // For a growth-reg trigger, the clock also resets on a DMI fungicide (which
    // regulates growth), so anchor on the most recent PGR-or-DMI spray.
    let anchor = lastSprayDate(ctx.sheets, app.area, app.product, today)
    if (isGrowthRegType(app.type) && ctx.suppressors) {
      const sup = lastSuppressionDate(ctx.sheets, app.area, ctx.suppressors, today)
      if (sup && (!anchor || sup > anchor)) anchor = sup
    }
    anchor = anchor || app.templateDate || app.plannedDate || null
    const gdd = anchor ? gddSince(ctx.season || [], anchor, t.base) : null
    if (gdd == null) {
      return { state: 'none', headline: 'Waiting on data', detail: `${t.target} GDD after last spray · no baseline yet`, projectedDate: null, progress: 0 }
    }
    const progress = Math.max(0, Math.min(1, gdd / t.target))
    const perDay = gddPerDay(ctx.season, today, t.base)
    let projectedDate = null
    if (gdd < t.target && perDay) projectedDate = isoAddDays(today, Math.max(1, Math.ceil((t.target - gdd) / perDay)))
    const detail = `${gdd} of ${t.target} GDD (base ${t.base}°F)`
    if (gdd >= t.target) {
      const over = gdd - t.target
      return { state: over >= t.target * 0.15 ? 'overdue' : 'due', headline: over >= t.target * 0.15 ? 'Overdue' : 'Due now', detail, projectedDate: today, progress }
    }
    if (progress >= 0.8) return { state: 'soon', headline: projectedDate ? `In ~${daysBetween(today, projectedDate)} days` : 'Coming up', detail, projectedDate, progress }
    return { state: 'ok', headline: projectedDate ? `~${daysBetween(today, projectedDate)} days out` : 'On track', detail, projectedDate, progress }
  }

  if (t.mode === 'interval') {
    const last = lastSprayDate(ctx.sheets, app.area, app.product, today) || app.plannedDate || app.templateDate || null
    if (!last) return { state: 'none', headline: 'Waiting on data', detail: `Every ${t.days} days · no last spray yet`, projectedDate: null, progress: 0 }
    const next = isoAddDays(last, t.days)
    const left = daysBetween(today, next)
    const progress = Math.max(0, Math.min(1, (t.days - left) / t.days))
    const detail = `Every ${t.days} days · last ${last}`
    if (left < 0) return { state: left <= -Math.ceil(t.days * 0.5) ? 'overdue' : 'due', headline: `Overdue ${-left} day${left === -1 ? '' : 's'}`, detail, projectedDate: next, progress: 1 }
    if (left === 0) return { state: 'due', headline: 'Due today', detail, projectedDate: next, progress: 1 }
    if (left <= Math.max(2, Math.round(t.days * 0.2))) return { state: 'soon', headline: `In ${left} day${left === 1 ? '' : 's'}`, detail, projectedDate: next, progress }
    return { state: 'ok', headline: `In ${left} days`, detail, projectedDate: next, progress }
  }

  if (t.mode === 'soil') {
    const soil = currentSoilTemp(ctx.soilSeries || [])
    const trend = soilTrend(ctx.soilSeries || [])
    if (soil == null) return { state: 'none', headline: 'Waiting on data', detail: `Soil target ${t.dir === 'falling' ? '≤' : '≥'} ${t.temp}°F`, projectedDate: null, progress: 0 }
    const detail = `Soil ${soil}°F ${trend} · target ${t.dir === 'falling' ? '≤' : '≥'} ${t.temp}°F`
    const met = t.dir === 'falling' ? (soil <= t.temp && trend !== 'rising') : (soil >= t.temp && trend !== 'falling')
    if (met) return { state: 'due', headline: 'Window open', detail, projectedDate: today, progress: 1 }
    const near = t.dir === 'falling' ? (soil <= t.temp + 8) : (soil >= t.temp - 8)
    const movingToward = t.dir === 'falling' ? trend === 'falling' : trend === 'rising'
    if (near && movingToward) return { state: 'soon', headline: 'Approaching', detail, projectedDate: null, progress: 0.75 }
    return { state: 'ok', headline: 'Not yet', detail, projectedDate: null, progress: 0.3 }
  }

  // date mode (default)
  const d = app.plannedDate
  if (!d) return { state: 'none', headline: 'No date set', detail: 'Add a date or a trigger', projectedDate: null, progress: 0 }
  const left = daysBetween(today, d)
  const detail = `Set date · ${d}`
  if (left < 0) return { state: left <= -7 ? 'overdue' : 'due', headline: `Overdue ${-left} day${left === -1 ? '' : 's'}`, detail, projectedDate: d, progress: 1 }
  if (left === 0) return { state: 'due', headline: 'Due today', detail, projectedDate: d, progress: 1 }
  if (left <= 7) return { state: 'soon', headline: `In ${left} day${left === 1 ? '' : 's'}`, detail, projectedDate: d, progress: 1 - left / 7 }
  return { state: 'ok', headline: `In ${left} days`, detail, projectedDate: d, progress: 0 }
}
