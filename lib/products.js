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
// Canonical names match the 2026 plan (import spec §7, first-listed spelling)
// and the phase30 merge, so imports, the resolver and the library all agree.
export const BUILTIN_ALIASES = {
  'Primo MAXX': ['Primo Maxx'],
  'Subdue MAXX': ['Subdue Maxx', 'Subdue Maxx (Generic)'],
  'Exteris StressGard': ['Exteris Stressgard'],
  'Dedicate Stressgard': ['Dedicate Stressguard'],
  'Signature Xtra Stressgard': ['Signature XTRA Stressguard', 'Chipco Signature Xtra Stressgard'],
  'Azoxy D Select': ['AzoxyD Select'],
  'Acelepryn Extra': ['Acelepryn Xtra'],
  'Briskway': ['Brsikway'],
  'Fame + C': ['Fame +C'],
  'Quick Silver': ['QuickSilver'],
  'Triton FLO': ['Triton Flo'],
  'Trefinti': ['Trefinti SC'],
  'Flex-guard': ['Flexguard'],
  'Insignia SC': ['Insignia'],
  'Tech Mangan': ['Tecmangam'],
  'Thiophanate-Methyl': ['Thiophanate-Methyl (Generic)'],
  'Triclopyr': ['Triclopyr (Generic)'],
  'Torque': ['Torque (Generic)'],
  'Chlorothalonil WS (Generic)': ['Chlorathalonil WS (Generic)', 'Chlorathalonil'],
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

// ── Merge near-duplicate library records (import spec §7) ─────────────────────
// All pure + side-effect free, so the risky part (what moves where) is testable
// on its own; db.mergeProducts composes these with the actual writes.

// The merged library record when folding `drop` into `keep`: keep's values win,
// and any key only `drop` had is carried over so no data is lost. Area rates are
// unioned (keep wins per area). `name`/`aliases` stay keep's.
export function mergeProductData(keep = {}, drop = {}) {
  const merged = { ...drop, ...keep }
  merged.name = keep.name
  if (drop.areaRates || keep.areaRates) merged.areaRates = { ...(drop.areaRates || {}), ...(keep.areaRates || {}) }
  // Record the dropped spelling as an alias so old references still resolve.
  const aliases = new Set([...(Array.isArray(keep.aliases) ? keep.aliases : []), ...(Array.isArray(drop.aliases) ? drop.aliases : [])])
  if (drop.name && normName(drop.name) !== normName(keep.name)) aliases.add(drop.name)
  if (aliases.size) merged.aliases = [...aliases]
  return merged
}

// Repoint a spray sheet's product lines from `dropName` to `keepName`. Returns a
// new sheet object if anything changed, else null (so the caller only writes the
// sheets that actually reference the duplicate).
export function repointSheetProducts(sheet, dropName, keepName) {
  const list = Array.isArray(sheet?.products) ? sheet.products : null
  if (!list) return null
  let changed = false
  const products = list.map((p) => {
    if (p && p.product === dropName) { changed = true; return { ...p, product: keepName } }
    return p
  })
  return changed ? { ...sheet, products } : null
}

// Find near-duplicate pairs in the library to flag for merging: records that
// fold to the same normalized name, or that a built-in alias ties together.
// Returns [{ keep, drop }] where `keep` is the canonical spelling when known,
// else the longer-established (first-seen) name.
export function duplicateCandidates(products = []) {
  const aliasToCanon = new Map() // normalized alias -> canonical name
  Object.entries(BUILTIN_ALIASES).forEach(([canon, alts]) => {
    ;(alts || []).forEach((a) => aliasToCanon.set(normName(a), canon))
    aliasToCanon.set(normName(canon), canon)
  })
  const byNorm = new Map()
  const pairs = []
  const present = new Map()
  ;(products || []).forEach((p) => { if (p?.name) present.set(p.name, p) })

  ;(products || []).forEach((p) => {
    if (!p?.name) return
    const nk = normName(p.name)
    if (byNorm.has(nk)) {
      // Same normalized name → trivial duplicate (case/spacing/punctuation).
      const first = byNorm.get(nk)
      pairs.push({ keep: first.name, drop: p.name })
    } else {
      byNorm.set(nk, p)
    }
  })
  // Alias-tied duplicates (different words, e.g. a known typo). Only flag when
  // BOTH spellings are actually in the library.
  Object.entries(BUILTIN_ALIASES).forEach(([canon, alts]) => {
    ;(alts || []).forEach((alt) => {
      const keepP = present.get(canon) || [...present.values()].find((p) => normName(p.name) === normName(canon))
      const dropP = present.get(alt) || [...present.values()].find((p) => normName(p.name) === normName(alt))
      if (keepP && dropP && keepP.name !== dropP.name && !pairs.some((x) => x.drop === dropP.name)) {
        pairs.push({ keep: keepP.name, drop: dropP.name })
      }
    })
  })
  return pairs
}
