// ── Product name resolution (aliases) ────────────────────────────────────────
// Playbooks, old spreadsheets and the crew all spell products slightly
// differently — "Primo Maxx" vs "Primo MAXX", "Tecmangam" vs "Tech Mangan".
// This module resolves any spelling to the one canonical library product, so
// imports, spray-sheet entry and every report line up on the same record.
//
// Two layers:
//   • normName() folds away case, spacing and punctuation, so trivial variants
//     ("Primo Maxx" ↔ "Primo MAXX") match with no configuration.
//   • Explicit aliases (BUILTIN_ALIASES here, plus a product's own
//     data.aliases) catch the ones normalization can't — different words for
//     the same product ("Tecmangam" ↔ "Tech Mangan").
//
// Ambiguous bare tokens (e.g. "Stressgard", which appears in three different
// products) are deliberately NOT aliased here — those are handled as library
// record merges, reviewed by a director before anything is changed.

export const normName = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')

// Canonical library name → alternate spellings seen in the wild. Only safe,
// unambiguous variants belong here. Keep canonical names exactly as the
// Chemical Library stores them.
export const BUILTIN_ALIASES = {
  'Primo MAXX': ['Primo Maxx'],
  'Subdue MAXX': ['Subdue Maxx'],
  'Signature XTRA Stressguard': ['Signature Xtra Stressgard', 'Chipco Signature Xtra Stressgard', 'Signature XTRA Stressgard'],
  'AzoxyD Select': ['Azoxy D Select'],
  'Briskway': ['Brsikway'],
  'Fame + C': ['Fame +C'],
  'QuickSilver': ['Quick Silver'],
  'Triton Flo': ['Triton FLO'],
  'Trefinti SC': ['Trefinti'],
  'Flexguard': ['Flex-guard'],
  'Insignia SC': ['Insignia'],
  'Tech Mangan': ['Tecmangam'],
  'Chlorothalonil WS (Generic)': ['Chlorathalonil'],
}

// Build a fast lookup over a product library. Returns { get(name) } where get
// resolves exact name → normalized name → alias (built-in or product.data).
export function indexProducts(products = []) {
  const byExact = new Map()
  const byNorm = new Map()
  const byAlias = new Map() // normalized alias -> product

  const addAlias = (alias, prod) => {
    const k = normName(alias)
    if (k && !byAlias.has(k)) byAlias.set(k, prod)
  }

  for (const p of products) {
    if (!p?.name) continue
    byExact.set(p.name, p)
    const nk = normName(p.name)
    if (nk && !byNorm.has(nk)) byNorm.set(nk, p)
    ;(BUILTIN_ALIASES[p.name] || []).forEach((a) => addAlias(a, p))
    ;(Array.isArray(p.aliases) ? p.aliases : []).forEach((a) => addAlias(a, p))
  }

  const get = (name) => {
    if (name == null) return undefined
    if (byExact.has(name)) return byExact.get(name)
    const nk = normName(name)
    return byNorm.get(nk) || byAlias.get(nk) || undefined
  }
  return { get }
}

// Resolve a product name against a library (array of products or a prebuilt
// index). Returns the matched product, or undefined.
export function resolveProduct(name, productsOrIndex) {
  const idx = Array.isArray(productsOrIndex) ? indexProducts(productsOrIndex) : productsOrIndex
  return idx?.get ? idx.get(name) : undefined
}

// The canonical library name for a spelling, or the original name unchanged
// when nothing matches (so unknown products are still kept, just flagged).
export function canonicalName(name, productsOrIndex) {
  const p = resolveProduct(name, productsOrIndex)
  return p?.name || name
}
