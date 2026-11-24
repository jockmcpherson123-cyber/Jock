// ============================================================================
//  Course Map — moisture targets (seasonal ranges) resolution.
//
//  A target is a season (start_md..end_md, possibly wrapping the new year) with
//  a low/high/aim. A round is judged against the target active ON ITS DATE, so
//  past readings keep their colors when a target changes. A green exception
//  overrides the season range for one green.
// ============================================================================

// The target is a single average %. We keep a band around it only so the
// heatmap has a dry→target→wet gradient; the user never sets low/high.
export const TARGET_BAND = 5
export const targetFields = (avg) => ({ vwcLo: Number(avg) - TARGET_BAND, vwcHi: Number(avg) + TARGET_BAND, aim: Number(avg) })
export const targetAvg = (t) => t?.aim != null ? Number(t.aim) : (t ? (Number(t.vwcLo) + Number(t.vwcHi)) / 2 : null)

const mdNum = (md) => { const [m, d] = String(md).split('-').map(Number); return m * 100 + d }
export const mdOf = (dateISO) => String(dateISO).slice(5, 10) // 'MM-DD'

// Does a date fall in a season? Handles wrap (e.g. 11-01 … 03-31).
export function dateInSeason(dateISO, startMd, endMd) {
  const x = mdNum(mdOf(dateISO)), s = mdNum(startMd), e = mdNum(endMd)
  return s <= e ? (x >= s && x <= e) : (x >= s || x <= e)
}

// The target active on a date for a surface, normalized.
export function resolveTarget(targets, dateISO, surface = 'green') {
  const t = (targets || []).find((x) => (x.surface || 'green') === surface && dateInSeason(dateISO, x.startMd, x.endMd))
  if (!t) return null
  const lo = Number(t.vwcLo), hi = Number(t.vwcHi)
  return { id: t.id, name: t.name, lo, hi, aim: t.aim != null ? Number(t.aim) : (lo + hi) / 2, salinityMax: t.salinityMax }
}

// Apply a green's exception (if any) over a resolved target.
export function withException(base, exceptions, areaId) {
  if (!base) return base
  const ex = (exceptions || []).find((e) => e.areaId === areaId && (e.targetId == null || e.targetId === base.id))
  if (!ex) return base
  return {
    ...base,
    lo: ex.vwcLo != null ? Number(ex.vwcLo) : base.lo,
    hi: ex.vwcHi != null ? Number(ex.vwcHi) : base.hi,
    aim: ex.aim != null ? Number(ex.aim) : base.aim,
    exception: true,
  }
}

// Warn if the year isn't covered by exactly one season everywhere (gaps/overlaps).
// Samples the 1st and 15th of each month — enough to catch real mistakes.
export function coverageIssues(targets, surface = 'green') {
  const seasons = (targets || []).filter((t) => (t.surface || 'green') === surface)
  if (!seasons.length) return ['No seasons yet — add one covering the whole year.']
  const issues = []
  const samples = []
  for (let m = 1; m <= 12; m++) for (const d of [1, 15]) samples.push(`2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  let gap = 0, overlap = 0
  for (const day of samples) {
    const n = seasons.filter((s) => dateInSeason(day, s.startMd, s.endMd)).length
    if (n === 0) gap++
    if (n > 1) overlap++
  }
  if (gap) issues.push('Some dates have no season — the whole year should be covered.')
  if (overlap) issues.push('Some dates are in more than one season — seasons can’t overlap.')
  return issues
}

// Build a Nov→Oct timeline (12 month segments) marking which season covers each,
// for the colored year bar. Returns [{ md, target }] at month starts.
export function timelineMonths(targets) {
  const order = ['11', '12', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10']
  return order.map((mm) => {
    const day = `2026-${mm}-15`
    const t = resolveTarget(targets, day)
    return { month: mm, target: t }
  })
}
