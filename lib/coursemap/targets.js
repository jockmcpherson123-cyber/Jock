// ============================================================================
//  Course Map — moisture targets (seasonal ranges) resolution.
//
//  A target is a season (start_md..end_md, possibly wrapping the new year) with
//  a low/high/aim. A round is judged against the target active ON ITS DATE, so
//  past readings keep their colors when a target changes. A green exception
//  overrides the season range for one green.
// ============================================================================

// A target is a season RANGE: a low and a high %VWC to hold, with an aim
// (default: the midpoint). targetFields keeps the old single-value call working
// (±band); targetRangeFields saves an explicit low/high the user typed.
export const TARGET_BAND = 5
export const targetFields = (avg) => ({ vwcLo: Number(avg) - TARGET_BAND, vwcHi: Number(avg) + TARGET_BAND, aim: Number(avg) })
export const targetRangeFields = (lo, hi) => { const L = Number(lo), H = Number(hi); const a = Math.min(L, H), b = Math.max(L, H); return { vwcLo: a, vwcHi: b, aim: Math.round(((a + b) / 2) * 10) / 10 } }
export const targetAvg = (t) => t?.aim != null ? Number(t.aim) : (t ? (Number(t.vwcLo) + Number(t.vwcHi)) / 2 : null)

// A short "16–22%" label for a resolved target (or a raw row with vwcLo/vwcHi).
export function targetRangeLabel(t) {
  if (!t) return ''
  const lo = Number(t.lo ?? t.vwcLo), hi = Number(t.hi ?? t.vwcHi)
  if (!isFinite(lo) || !isFinite(hi)) return ''
  return `${Math.round(lo * 10) / 10}–${Math.round(hi * 10) / 10}%`
}

// The ONE status + colour used on every page that shows a moisture reading
// against the target: below the range is red→orange, inside is green, above is
// blue. `t` is a resolved target ({lo,hi}) or a raw row ({vwcLo,vwcHi}).
export function moistureStatus(avg, t) {
  if (avg == null || t == null) return { label: '—', zone: 'none', color: '#8A8984' }
  const lo = Number(t.lo ?? t.vwcLo), hi = Number(t.hi ?? t.vwcHi)
  const v = Number(avg)
  if (!isFinite(lo) || !isFinite(hi)) return { label: '—', zone: 'none', color: '#8A8984' }
  if (v < lo) return { label: `${(lo - v).toFixed(1)} below`, zone: 'below', color: v <= lo - 3 ? '#B23A2E' : '#D97706' } // red → orange
  if (v > hi) return { label: `${(v - hi).toFixed(1)} over`, zone: 'above', color: '#2563EB' } // blue
  return { label: 'in range', zone: 'in', color: '#1E7A46' } // green
}

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
