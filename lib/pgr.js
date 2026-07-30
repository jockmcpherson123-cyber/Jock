// ── Growth suppression: PGRs + DMI fungicides ────────────────────────────────
// DMI (FRAC group 3, the triazoles) fungicides inhibit gibberellin biosynthesis,
// so they regulate growth much like a true PGR — the "DMI regulation" turf
// managers watch for, especially in summer heat. This module lets the Growth-Reg
// timing count a DMI application as a growth-suppression event, and lets the
// spray sheet warn when a DMI stacks on top of a PGR.

// Common turf DMI (FRAC 3) active ingredients — used when a product's FRAC code
// isn't filled in. All are demethylation inhibitors that suppress growth.
const DMI_ACTIVES = [
  'propiconazole', 'tebuconazole', 'myclobutanil', 'triadimefon', 'metconazole',
  'difenoconazole', 'mefentrifluconazole', 'triticonazole', 'flutriafol', 'fenarimol',
  'prothioconazole', 'ipconazole', 'tetraconazole', 'penconazole', 'fluquinconazole',
]

// FRAC codes on a product ("11 + 3", "M3", "3") → distinct tokens. Note "M3"
// (mancozeb, multi-site) is NOT FRAC 3 — only a bare "3" token is a DMI.
function fracTokens(moaGroup) {
  return String(moaGroup || '').split(/[^0-9A-Za-z]+/).filter(Boolean)
}

export function isPGR(product) {
  return String(product?.type || '').toLowerCase().includes('growth')
}
export function isDMI(product) {
  if (!product) return false
  if (fracTokens(product.moaGroup).includes('3')) return true
  const ai = String(product.activeIngredient || '').toLowerCase()
  return DMI_ACTIVES.some((a) => ai.includes(a))
}
// 'pgr' | 'dmi' | null — how (if at all) a product suppresses growth.
export function suppressionKind(product) {
  if (isPGR(product)) return 'pgr'
  if (isDMI(product)) return 'dmi'
  return null
}
export function isGrowthSuppressing(product) {
  return !!suppressionKind(product)
}
// Product name → suppression kind, for looking up sheet products (which store
// only the product name) against the full library.
export function suppressionMap(products = []) {
  const m = {}
  products.forEach((p) => { const k = suppressionKind(p); if (k && p.name) m[p.name] = k })
  return m
}
