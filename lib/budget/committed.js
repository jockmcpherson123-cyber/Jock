// ============================================================================
//  Committed spend — the department's own approved-but-not-yet-invoiced work.
//
//  An approved spray sheet whose chemicals haven't been invoiced yet is money
//  already promised, so it shows as COMMITTED on Chemicals (612800-13); approved
//  fert sheets do the same on Fertilizer (612810-13). Committed is shown
//  separately and is NEVER added into actuals. A commitment drops off once a
//  matching invoice posts or after 60 days (we can't line an invoice up to a
//  sheet reliably, so the 60-day window is what clears it).
//
//  Reuses the app's own cost math (costPerOzOf / calcAmount / computeFert) so a
//  committed figure reconciles with what Season Reports shows. Returns cents.
// ============================================================================
import { calcAmount, costPerOzOf } from '../calc.js'
import { computeFert } from '../fert.js'

export const GL_CHEMICALS = '612800-13'
export const GL_FERTILIZER = '612810-13'

const toAppliedOz = (total, unit) =>
  unit === 'gal' ? total * 128 : unit === 'lbs' ? total * 16 : unit === 'g' ? total / 28.3495
    : (unit === 'oz' || unit === 'fl oz') ? total : null

function daysBetween(a, b) {
  const da = new Date(a), db = new Date(b)
  if (isNaN(da) || isNaN(db)) return Infinity
  return Math.abs((da - db) / 86400000)
}

// One spray sheet's whole-job product cost, in cents — the same per-applied-ounce
// basis used everywhere else in the app.
export function spraySheetCostCents(sheet, prodByName, areas) {
  const area = areas[sheet.area] || {}
  let cost = 0
  for (const p of (sheet.products || [])) {
    if (!p.product) continue
    const prod = prodByName[p.product]
    const { value: amt, unit } = calcAmount(parseFloat(p.rate), p.basis, area.sqft, p.forceGal)
    if (amt == null) continue
    const oz = toAppliedOz(amt * (sheet.tanks || 1), unit)
    const cpo = costPerOzOf(prod)
    if (oz == null || cpo == null) continue
    cost += oz * cpo
  }
  return Math.round(cost * 100)
}

// Committed cents by GL code. Spray → Chemicals, Fert → Fertilizer.
export function committedByGl({ sheets = [], fertSheets = [], products = [], areas = {}, today = new Date(), windowDays = 60 }) {
  const prodByName = {}
  for (const p of products) prodByName[p.name] = p

  let chem = 0
  for (const s of sheets) {
    if (s.status !== 'approved') continue           // director-approved, heading out
    if (s.date && daysBetween(today, s.date) > windowDays) continue
    chem += spraySheetCostCents(s, prodByName, areas)
  }

  let fert = 0
  for (const f of fertSheets) {
    if (f.appDate && daysBetween(today, f.appDate) > windowDays) continue
    const dollars = computeFert(f)?.cost || 0
    fert += Math.round(dollars * 100)
  }

  return { [GL_CHEMICALS]: chem, [GL_FERTILIZER]: fert }
}
