// ── Recommendations engine ───────────────────────────────────────────────────
// Turns data the app already has — the PGR program, the disease-risk models, and
// the spray-window forecast — into a short, ranked list of plain-English action
// items for the Command Center's "What Needs Attention" feed.
//
// Nothing new has to be entered to make this work: it reads approved/completed
// spray history, the weather forecast/season series, and the club's grasses.
//
// Each item: { kind, sev, title, detail }  where sev is 3 (act now / red),
// 2 (plan soon / amber), or 1 (heads-up / green-blue). Sorted worst-first.

export const PGR_TARGET = 200 // GDD, base 0°C (classic Primo model; °F GDD ÷ 1.8)

// Loose disease-name key so "Dollar spot" (risk model) lines up with "Dollar
// Spot" (fungicide coverage label) regardless of spacing/case.
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '')

// The set of disease-name keys that a recent fungicide (within `days`) covers,
// pulled straight from the fungicide log (which already lists, per spray, the
// diseases the products typically control).
function recentlyCoveredKeys(fungLog = [], days = 14) {
  const keys = new Set()
  fungLog.forEach((area) => {
    ;(area.sprays || []).forEach((s) => {
      if (s.since != null && s.since <= days) {
        ;(s.diseases || []).forEach((d) => keys.add(norm(d)))
      }
    })
  })
  return keys
}

// Is this disease covered by a recent preventive? Match loosely both ways so
// "pythium" ⊂ "pythiumblight" and vice-versa both count.
function isCovered(risk, coveredKeys) {
  const k = norm(risk.label)
  if (!k) return false
  for (const c of coveredKeys) {
    if (!c) continue
    if (c === k) return true
    // Allow a partial match only when the shorter name is long enough to be
    // specific — so a generic covered token like "spot"/"patch" can't falsely
    // mark an unrelated disease as covered and hide a real alert.
    const shorter = c.length < k.length ? c : k
    if (shorter.length >= 6 && (c.includes(k) || k.includes(c))) return true
  }
  return false
}

const fmtDay = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' }) } catch { return d } }

// The next favourable spray window in the forecast. `forecast` rows must each
// carry a `spray` object ({ level: 'good'|'caution'|'poor', reasons: [] }).
function sprayWindowRec(forecast = []) {
  if (!forecast.length) return null
  const today = forecast[0]
  if (today.spray?.level === 'good') {
    return { kind: 'spray', sev: 1, title: 'Good spray window today', detail: `Conditions look favourable on your morning window${today.spray.reasons?.length ? ` — ${today.spray.reasons.join(', ')}` : ''}.` }
  }
  const nextGood = forecast.slice(1).find((d) => d.spray?.level === 'good')
  if (nextGood) {
    return { kind: 'spray', sev: 1, title: `Next good spray window: ${fmtDay(nextGood.date)}`, detail: `Today is ${today.spray?.level === 'poor' ? 'a hold' : 'marginal'} — ${fmtDay(nextGood.date)} morning looks favourable.` }
  }
  // Nothing clearly good — surface the least-bad day so he can plan around it.
  const marginal = forecast.find((d) => d.spray?.level === 'caution')
  if (marginal) {
    return { kind: 'spray', sev: 1, title: 'No clear spray window this week', detail: `Best of a mediocre stretch is ${fmtDay(marginal.date)} (marginal). Watch wind and rain.` }
  }
  return null
}

// Build the ranked recommendation list.
//  pgr      — [{ area, gdd, pct, status: 'due'|'soon'|'ok' }]  (Command Center's PGR calc)
//  forecast — [{ date, spray:{level,reasons} }, …]             (7-day, today first)
//  risks    — airDiseaseRisks(...) output [{ id, label, score, band }]
//  fungLog  — fungicideLogByArea(...) output
export function buildRecommendations({ pgr = [], forecast = [], risks = [], fungLog = [] } = {}) {
  const recs = []

  // 1. Growth-regulator re-apply timing.
  pgr.forEach((r) => {
    if (r.status === 'due') {
      recs.push({ kind: 'pgr', sev: 3, title: `${r.area}: growth regulator has worn off`, detail: `About ${r.gdd} GDD since the last app (target ${PGR_TARGET}). Reapply soon to head off a growth surge.` })
    } else if (r.status === 'soon') {
      recs.push({ kind: 'pgr', sev: 2, title: `${r.area}: growth regulator due soon`, detail: `${r.pct}% through the window (~${r.gdd} of ${PGR_TARGET} GDD). Line up the next PGR pass.` })
    }
  })

  // 2. Disease pressure — only flag when it's climbing AND not already covered
  //    by a recent preventive (so we don't nag about something you just sprayed).
  const coveredKeys = recentlyCoveredKeys(fungLog, 14)
  ;(risks || [])
    .filter((d) => d.score >= 40)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .forEach((d) => {
      if (isCovered(d, coveredKeys)) return // a recent spray likely still has it covered
      const high = d.score >= 70
      recs.push({
        kind: 'disease',
        sev: high ? 3 : 2,
        title: `${d.label} pressure is ${d.band}`,
        detail: `Recent weather favours ${d.label.toLowerCase()} and there's no preventive down in the last 14 days. Consider a fungicide before it shows.`,
      })
    })

  // 3. Best spray window (planning heads-up).
  const sw = sprayWindowRec(forecast)
  if (sw) recs.push(sw)

  return recs.sort((a, b) => b.sev - a.sev)
}
