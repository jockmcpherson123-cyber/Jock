// ── PGR / DMI growth-suppression CURVE model ─────────────────────────────────
// A per-product growth-regulation model in the spirit of the GreenKeeper /
// Kreuser GDD approach: instead of one flat "reapply at X GDD" target, each
// regulating active ingredient gets a suppression CURVE that rises, wanes, and
// then rebounds (growth surges above normal) as GDD accumulate after the spray.
//
// Everything here is in GDD base 32 °F (to match lib/weather gddSince(...,32)),
// because the app already accumulates season GDD that way. For reference the
// classic trinexapac model is ~200 GDD base 0 °C on greens ≈ ~360 GDD base 32 °F.
//
// These curves are transparent ESTIMATES seeded from published trends (TE/Primo,
// paclobutrazol, flurprimidol, prohexadione, ethephon, and the modest growth
// footprint of DMI fungicides). They are not GreenKeeper's proprietary trial
// dataset — treat them as a starting point and tune the reapply GDD to your turf.

// Reapply GDD (base 32 °F) by surface + peak clipping suppression (fraction).
// class: 'A' foliar (trinexapac-type, GDD-driven) · 'B' root-absorbed (longer,
// paclobutrazol/flurprimidol) · 'dmi' triazole fungicide side-effect.
export const PGR_MODELS = [
  { id: 'trinexapac', label: 'Trinexapac-ethyl (Primo Maxx)', match: ['trinexapac', 'primo'], kind: 'pgr', pgrClass: 'A', peak: 0.50, gdd: { green: 360, tee: 450, fairway: 550, rough: 650 } },
  { id: 'paclobutrazol', label: 'Paclobutrazol (Trimmit)', match: ['paclobutrazol', 'trimmit'], kind: 'pgr', pgrClass: 'B', peak: 0.45, gdd: { green: 450, tee: 550, fairway: 700, rough: 800 } },
  { id: 'flurprimidol', label: 'Flurprimidol (Cutless)', match: ['flurprimidol', 'cutless'], kind: 'pgr', pgrClass: 'B', peak: 0.45, gdd: { green: 450, tee: 550, fairway: 700, rough: 800 } },
  { id: 'prohexadione', label: 'Prohexadione-Ca (Anuew)', match: ['prohexadione', 'anuew'], kind: 'pgr', pgrClass: 'A', peak: 0.42, gdd: { green: 270, tee: 340, fairway: 430, rough: 500 } },
  { id: 'ethephon', label: 'Ethephon (Proxy)', match: ['ethephon', 'proxy'], kind: 'pgr', pgrClass: 'A', peak: 0.30, gdd: { green: 500, tee: 550, fairway: 650, rough: 700 } },
  { id: 'mefluidide', label: 'Mefluidide (Embark)', match: ['mefluidide', 'embark'], kind: 'pgr', pgrClass: 'A', peak: 0.35, gdd: { green: 500, tee: 550, fairway: 650, rough: 700 } },
  // DMI (FRAC 3) fungicides — real but modest growth suppression, shorter footprint.
  { id: 'propiconazole', label: 'Propiconazole (DMI)', match: ['propiconazole', 'banner'], kind: 'dmi', peak: 0.22, gdd: { green: 250, tee: 300, fairway: 360, rough: 400 } },
  { id: 'dmi_generic', label: 'DMI fungicide (FRAC 3)', match: [], kind: 'dmi', peak: 0.18, gdd: { green: 250, tee: 300, fairway: 360, rough: 400 } },
]

// Match a product to a model by active ingredient, then product name. `kind`
// (from lib/pgr suppressionKind) picks the right generic fallback.
export function modelForProduct(product, kind) {
  const hay = `${product?.activeIngredient || ''} ${product?.name || ''}`.toLowerCase()
  const hit = PGR_MODELS.find((m) => m.match.length && m.match.some((t) => hay.includes(t)))
  if (hit) return hit
  if (kind === 'dmi') return PGR_MODELS.find((m) => m.id === 'dmi_generic')
  if (kind === 'pgr') return PGR_MODELS.find((m) => m.id === 'trinexapac') // sensible default PGR
  return null
}

// Surface → the curve's target column.
export function surfaceCol(surfaceKind) {
  return ['green', 'tee', 'fairway', 'rough'].includes(surfaceKind) ? surfaceKind : 'green'
}

// Apply a club's saved reapply-GDD overrides (courseInfo.pgrTargets[model.id])
// onto a model, so the curves use their tuned numbers. Only valid numbers win.
export function withTargets(model, override) {
  if (!model || !override) return model
  const gdd = { ...model.gdd }
  for (const k of ['green', 'tee', 'fairway', 'rough']) {
    const v = Number(override[k])
    if (v > 0) gdd[k] = v
  }
  return { ...model, gdd }
}

// The suppression curve. Clipping suppression is greatest right after the spray
// and falls to zero at the reapply target, then goes negative (rebound growth)
// out to ~2× target. Modeled as a cosine (the "sinewave" shape):
//   suppression(gdd) = peak · cos( (π/2) · gdd/target )
// → +peak at gdd 0, 0 at gdd=target, −peak at gdd=2·target (rebound trough).
export function suppressionAt(model, gdd, surfaceKind) {
  if (!model) return 0
  const target = model.gdd[surfaceCol(surfaceKind)] || model.gdd.green
  if (!target) return 0
  const x = Math.max(0, gdd) / target
  if (x >= 2) return 0
  return model.peak * Math.cos((Math.PI / 2) * x)
}

// Where a single product sits on its curve right now.
//   phase: 'regulated' (fresh) · 'waning' (reapply soon) · 'due' · 'rebound' (overdue,
//   growth surging) · 'expired'. pct = fraction of the interval used.
export function regulationStatus(model, gdd, surfaceKind) {
  if (!model) return null
  const target = model.gdd[surfaceCol(surfaceKind)] || model.gdd.green
  const pct = target > 0 ? gdd / target : 0
  const suppression = suppressionAt(model, gdd, surfaceKind)
  let phase = 'regulated'
  if (pct >= 2) phase = 'expired'
  else if (pct >= 1.15) phase = 'rebound'
  else if (pct >= 1) phase = 'due'
  else if (pct >= 0.8) phase = 'waning'
  return { target, pct, suppression, phase, remaining: Math.max(0, Math.round(target - gdd)) }
}

// Combined suppression from several products stacked in the same window
// (GreenKeeper v2.0 idea): each acts on its own curve, summed and capped so a
// PGR + DMI mix reads as intensified — but never an unrealistic 100 %.
export function combinedSuppression(entries) {
  const total = entries.reduce((s, e) => s + Math.max(0, e.suppression || 0), 0)
  return Math.min(0.75, total)
}

export const PHASE_STYLE = {
  regulated: { bg: '#E8F3EC', fg: '#2E7D46', label: 'Regulated' },
  waning: { bg: '#FEF3DD', fg: '#92660D', label: 'Reapply soon' },
  due: { bg: '#FEE2E2', fg: '#B91C1C', label: 'Reapply now' },
  rebound: { bg: '#FDE7E4', fg: '#B23A2E', label: 'Rebound — overdue' },
  expired: { bg: '#F1F5F9', fg: '#64748B', label: 'Worn off' },
}
