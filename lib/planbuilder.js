// ── Build From Last Year ─────────────────────────────────────────────────────
// Turn a season of actual spray records into a draft plan for next year: same
// products, areas and cadence you really ran, shifted onto matching dates, with
// smart triggers picked from what the records show (growth regulators → GDD,
// steady cycles → an interval) and a resistance check that flags back-to-back
// same-group sprays. The user reviews, then it becomes a real program.

import { daysBetween } from './triggers'

function sheetDone(s) {
  return s.completed === true || !!s.completedAt || s.status === 'approved' || s.status === 'completed' || s.status === 'logged'
}
function median(nums) {
  if (!nums.length) return null
  const a = [...nums].sort((x, y) => x - y)
  const m = Math.floor(a.length / 2)
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))
const round10 = (n) => Math.round(n / 10) * 10
const isGrowthReg = (type) => /growth/i.test(String(type || ''))
// Same MM-DD, next year — keeps the season's shape.
function shiftYear(dateIso, targetYear) {
  return `${targetYear}${String(dateIso).slice(4)}`
}

// The years that have any completed spray records, newest first — for the picker.
export function recordYears(sheets = []) {
  const set = new Set()
  sheets.forEach((s) => { if (sheetDone(s) && s.date) set.add(s.date.slice(0, 4)) })
  return [...set].sort().reverse().map(Number)
}

// Build the draft. opts: { sourceYear, targetYear, gddPerDay? }
export function buildPlanFromRecords(sheets = [], products = [], opts = {}) {
  const sourceYear = String(opts.sourceYear)
  const targetYear = String(opts.targetYear)
  const gddPerDay = Number(opts.gddPerDay) > 0 ? Number(opts.gddPerDay) : null

  const typeOf = {}, moaOf = {}, basisOf = {}, rateOf = {}
  products.forEach((p) => { typeOf[p.name] = p.type || ''; moaOf[p.name] = (p.moaGroup || '').trim(); basisOf[p.name] = p.basis || ''; rateOf[p.name] = p.rate ?? null })

  const src = sheets
    .filter((s) => sheetDone(s) && String(s.date || '').startsWith(sourceYear) && (s.products || []).some((p) => p.product))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))

  // Per area+product spray dates → cadence (how often you really ran it).
  const dates = {}
  src.forEach((s) => (s.products || []).forEach((pr) => {
    if (!pr.product) return
    const k = `${s.area}||${pr.product}`
    ;(dates[k] = dates[k] || []).push(s.date)
  }))
  const cadence = (area, product) => {
    const ds = (dates[`${area}||${product}`] || []).slice().sort()
    const gaps = []
    for (let i = 1; i < ds.length; i++) gaps.push(daysBetween(ds[i - 1], ds[i]))
    return { count: ds.length, medianGap: gaps.length ? median(gaps) : null }
  }

  const prodType = (pr) => typeOf[pr.product] || pr.type || ''
  const events = src.map((s) => {
    const items = (s.products || []).filter((p) => p.product)
    const lead = items.find((i) => isGrowthReg(prodType(i))) || items[0]
    const cad = cadence(s.area, lead.product)
    let trigger
    if (isGrowthReg(prodType(lead))) {
      const target = cad.medianGap && gddPerDay ? clamp(round10(cad.medianGap * gddPerDay), 100, 400) : 200
      trigger = { mode: 'gdd', base: 32, target }
    } else if (cad.count >= 3 && cad.medianGap) {
      trigger = { mode: 'interval', days: Math.round(cad.medianGap) }
    } else {
      trigger = { mode: 'date' }
    }
    const target0 = (s.targets && s.targets[0]) || ''
    return {
      area: s.area,
      date: shiftYear(s.date, targetYear),
      sourceDate: s.date,
      trigger,
      items: items.map((i) => {
        const basis = i.basis || basisOf[i.product] || 'oz / M'
        const rate = i.rate != null && i.rate !== '' ? Number(i.rate) : (rateOf[i.product] ?? null)
        const perAcre = /a/i.test(String(basis).replace(/[^a-z]/gi, '').slice(-1)) // ".../ A"
        return {
          product: i.product,
          rateOzM: perAcre ? null : rate,
          rateOzA: perAcre ? rate : null,
          basis,
          type: prodType(i),
          target: i.target || target0 || '',
          moaGroup: moaOf[i.product] || '',
        }
      }),
    }
  })

  // Resistance check: per area, in date order, flag when a product's MoA group
  // matches the previous grouped spray on that area (rotate to avoid resistance).
  const reviews = []
  const lastGroup = {} // area -> { group, product }
  events.forEach((ev) => {
    ev.items.forEach((it) => {
      if (!it.moaGroup) return
      const prev = lastGroup[ev.area]
      if (prev && prev.group === it.moaGroup) {
        reviews.push({ area: ev.area, date: ev.date, product: it.product, group: it.moaGroup, prevProduct: prev.product, note: `Same MoA group ${it.moaGroup} as ${prev.product} just before it — rotate to protect against resistance.` })
      }
      lastGroup[ev.area] = { group: it.moaGroup, product: it.product }
    })
  })

  const stats = {
    sprays: events.length,
    areas: new Set(events.map((e) => e.area)).size,
    products: new Set(events.flatMap((e) => e.items.map((i) => i.product))).size,
    gddTriggers: events.filter((e) => e.trigger.mode === 'gdd').length,
    intervalTriggers: events.filter((e) => e.trigger.mode === 'interval').length,
    dateTriggers: events.filter((e) => e.trigger.mode === 'date').length,
  }

  return { events, reviews, stats, sourceYear: Number(sourceYear), targetYear: Number(targetYear) }
}

// Flatten the draft events into per-product applications ready for
// bulkInsertApplications (one row per product, sharing the event's trigger).
export function planToApplications(plan) {
  const out = []
  plan.events.forEach((ev) => {
    ev.items.forEach((it) => {
      out.push({
        area: ev.area,
        product: it.product,
        rateOzM: it.rateOzM,
        rateOzA: it.rateOzA,
        basis: it.basis,
        type: it.type || null,
        target: it.target || null,
        plannedDate: ev.date,
        templateDate: ev.date,
        trigger: ev.trigger,
      })
    })
  })
  return out
}
