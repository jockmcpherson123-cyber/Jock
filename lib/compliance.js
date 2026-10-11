// ── Library compliance completeness ─────────────────────────────────────────
// A whole-library version of the per-sheet "missing for an inspection record"
// check: scans every product and applicator for the paperwork an inspector or
// EMS crew expects, so the gaps can be fixed before anyone asks. Products used
// in the last 12 months lead the list.

import { sheetApplied } from '@/lib/applied'
import { localDateISO } from '@/lib/dates'

// EPA reg #, signal word and REI are pesticide-record fields; label + SDS are
// expected for every product in the library.
const PESTICIDE_TYPES = ['Fungicide', 'Herbicide', 'Insecticide', 'Growth Reg']
const DAY = 86400000
const has = (v) => !!String(v ?? '').trim()

export function libraryComplianceGaps(products = [], sheets = [], licenses = {}, today = localDateISO()) {
  const cutoff = new Date(Date.parse(today + 'T00:00:00') - 365 * DAY).toISOString().slice(0, 10)
  const recent = new Set()
  ;(sheets || []).filter((s) => sheetApplied(s) && s.date && s.date >= cutoff && s.date <= today)
    .forEach((s) => (s.products || []).forEach((p) => p.product && recent.add(p.product)))

  const productGaps = []
  ;(products || []).forEach((p) => {
    const isPest = PESTICIDE_TYPES.includes(p.type)
    const missing = []
    if (isPest && !has(p.epaReg)) missing.push('EPA Reg #')
    if (isPest && !has(p.signalWord)) missing.push('Signal word')
    if (isPest && !has(p.rei)) missing.push('REI')
    if (!has(p.labelUrl)) missing.push('Label')
    if (!has(p.sdsUrl)) missing.push('SDS')
    if (missing.length) productGaps.push({ name: p.name, type: p.type || 'Product', used: recent.has(p.name), missing })
  })
  // Recently-used first, then the most-incomplete, then alphabetical.
  productGaps.sort((a, b) => (Number(b.used) - Number(a.used)) || (b.missing.length - a.missing.length) || a.name.localeCompare(b.name))

  const peopleGaps = []
  Object.entries(licenses || {}).forEach(([name, lic]) => {
    if (!has(lic?.pesticide)) peopleGaps.push({ name, missing: ['Pesticide license #'] })
  })
  peopleGaps.sort((a, b) => a.name.localeCompare(b.name))

  return {
    productGaps,
    peopleGaps,
    recentGapCount: productGaps.filter((g) => g.used).length,
    total: productGaps.length + peopleGaps.length,
  }
}
