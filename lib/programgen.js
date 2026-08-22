// ── Model-driven spray-program generator ─────────────────────────────────────
// Builds a full-season, gap-free TEMPLATE program for a cool-season / transition-
// zone golf course, PER SURFACE. Each surface (greens, tees, fairways, roughs…)
// is generated as its own piece, and each disease/pest/weed only lands on a
// surface when that surface's GRASS is susceptible — so bentgrass greens get the
// intensive fungicide backbone while a bluegrass rough gets grubs, billbug and
// pre-emergents. Windows are anchored to the course's own averaged soil-
// temperature curve (climate) or Bethesda regional normals.
//
// IMPORTANT — a STARTING TEMPLATE to review, not a prescription. Fungicides are
// chosen from published university EFFICACY RATINGS (Rutgers PPA-1 / NC State),
// rotated across FRAC groups for resistance, and named by trade product; where
// the club owns a matching product it is used. Insecticides/herbicides name a
// common brand. No rates — the label + a licensed applicator set those.
import { FUNGICIDE_RATINGS, ownedMatch } from './fungicides'

// Trade-name examples for non-fungicide actives (insecticides, herbicides, PGRs),
// which don't have an efficacy-rating table. Keyed by active-ingredient token.
const BRANDS = {
  // insecticides
  chlorantraniliprole: 'Acelepryn', cyantraniliprole: 'Ference', imidacloprid: 'Merit', clothianidin: 'Arena', thiamethoxam: 'Meridian', trichlorfon: 'Dylox', bifenthrin: 'Talstar', 'lambda-cyhalothrin': 'Scimitar', deltamethrin: 'DeltaGard', spinosad: 'Conserve', indoxacarb: 'Provaunt', 'bacillus thuringiensis': 'DiPel', carbaryl: 'Sevin',
  // herbicides
  prodiamine: 'Barricade', dithiopyr: 'Dimension', pendimethalin: 'Pendulum', oxadiazon: 'Ronstar', indaziflam: 'Specticle', bensulide: 'Bensumec', halosulfuron: 'SedgeHammer', sulfentrazone: 'Dismiss', imazosulfuron: 'Celero', '2,4-d': 'Trimec (3-way)', mecoprop: 'Trimec', dicamba: 'Trimec', triclopyr: 'Turflon',
  // PGRs
  ethephon: 'Proxy', trinexapac: 'Primo Maxx', 'prohexadione': 'Anuew', paclobutrazol: 'Trimmit', flurprimidol: 'Cutless', mefluidide: 'Embark',
}
// Off-patent actives with widely available generics — used to flag "generic
// available" and to bias fairway/rough (cost-sensitive) product choice.
const GENERIC_ACTIVES = new Set([
  'chlorothalonil', 'propiconazole', 'azoxystrobin', 'iprodione', 'thiophanate-methyl', 'mancozeb', 'myclobutanil', 'tebuconazole', 'trifloxystrobin', 'mefenoxam', 'fosetyl',
  'prodiamine', 'pendimethalin', 'dithiopyr', '2,4-d', 'mecoprop', 'dicamba', 'imidacloprid', 'bifenthrin', 'lambda-cyhalothrin', 'carbaryl', 'trichlorfon', 'halosulfuron',
])
const isGeneric = (ai) => { const a = norm(ai); if (!a || a.includes('+')) return false; for (const g of GENERIC_ACTIVES) if (a.includes(g)) return true; return false }

// Typical label rate RANGES (product per 1,000 sq ft on greens unless noted) —
// REFERENCE ONLY, wide spans; the product label is authoritative. Keyed by active
// ingredient token. Missing → "per label".
const RATES = {
  // fungicides (oz product / 1,000 sq ft)
  chlorothalonil: '3.2–5.5 oz/M', propiconazole: '1–2 oz/M', azoxystrobin: '0.2–0.4 oz/M', pyraclostrobin: '0.4–0.7 oz/M', fluxapyroxad: '0.18–0.36 oz/M', boscalid: '0.28–0.5 oz/M', penthiopyrad: '0.7–1.4 oz/M', metconazole: '0.5–0.9 oz/M', triticonazole: '0.5–1 oz/M', fluazinam: '0.4–0.8 oz/M', iprodione: '2–4 oz/M', fludioxonil: '0.28–0.55 oz/M', flutolanil: '2.2–4.4 oz/M', mefenoxam: '1–2 oz/M', cyazofamid: '0.5 oz/M', fosetyl: '4–8 oz/M', prothioconazole: '0.4–0.75 oz/M', isofetamid: '0.9–1.8 oz/M',
  // insecticides
  chlorantraniliprole: '0.2–0.4 oz/M (greens) · 8–18 oz/A', cyantraniliprole: '0.2–0.4 oz/M', imidacloprid: '0.4 lb ai/A (label)', clothianidin: '0.2–0.4 lb/A', trichlorfon: '3–6 oz/M', bifenthrin: '0.25–0.5 oz/M', 'lambda-cyhalothrin': '0.18–0.36 oz/M', spinosad: 'per label', 'bacillus thuringiensis': 'per label',
  // herbicides
  prodiamine: '0.5–0.75 oz/M', dithiopyr: '0.25–0.5 oz/M', pendimethalin: 'per label', oxadiazon: '1.5–3 oz/M', indaziflam: 'per label', '2,4-d': 'per label (3-way)', halosulfuron: '0.45–0.9 oz/M', sulfentrazone: 'per label',
  // PGRs
  trinexapac: '0.125–0.25 oz/M (greens)', ethephon: '5 oz/M (Proxy)', paclobutrazol: 'per label',
}
function rateFor(actives = []) {
  for (const a of actives) { const k = Object.keys(RATES).find((key) => a.includes(key) || key.includes(a)); if (k) return RATES[k] }
  return 'per label'
}

// First brand name found among a rule's actives.
function brandFor(actives = []) {
  for (const a of actives) {
    if (BRANDS[a]) return BRANDS[a]
    const k = Object.keys(BRANDS).find((key) => a.includes(key) || key.includes(a))
    if (k) return BRANDS[k]
  }
  return null
}
// Clean a trade string to its lead brand, e.g. "Heritage (WG/TL/G)" → "Heritage",
// "Prostar / Pedigree" → "Prostar".
function brandName(trade) {
  return String(trade || '').replace(/\(.*?\)/g, '').split(/[/,]/)[0].trim()
}
// ── Consolidated fungicide program ───────────────────────────────────────────
// A real greens program is ONE rotation of broad-spectrum products — each spray
// timed so it covers whatever diseases are active that week — not a separate
// spray per disease. These windows drive it: for each date we find the active
// diseases (window + grass + surface), then pick the product covering the most
// of them at high efficacy, rotating FRAC groups.
function fungWindows(soil) {
  return [
    // Bentgrass root diseases (take-all patch, Pythium root dysfunction, summer
    // decline) — a real bent/sand-greens target. Bookended spring + fall drenches;
    // not in the efficacy table, handled like summer patch with a product note.
    { id: 'root_disease', label: 'take-all / root disease', start: soil.spring65, end: '06-15', grasses: ['bent'], surfaces: ['greens', 'tees'] },
    { id: 'root_disease_fall', label: 'take-all / root disease (fall)', start: '09-15', end: '10-25', grasses: ['bent'], surfaces: ['greens', 'tees'] },
    { id: 'summer_patch', label: 'summer patch', start: soil.spring65, end: '06-30', grasses: ['poa', 'bluegrass', 'fescue'], surfaces: ['greens', 'tees', 'fairways'] },
    { id: 'fairy_ring', label: 'fairy ring', start: '05-01', end: '06-30', grasses: ['any'], surfaces: ['greens', 'tees'] },
    { id: 'dollar_spot', label: 'dollar spot', start: '05-05', end: '10-10', grasses: ['any'], surfaces: ['greens', 'tees', 'approaches', 'fairways'] },
    { id: 'anthracnose', label: 'anthracnose', start: '06-01', end: '09-10', grasses: ['poa'], surfaces: ['greens', 'tees', 'approaches'] },
    { id: 'brown_patch', label: 'brown patch', start: '06-15', end: '09-05', grasses: ['any'], surfaces: ['greens', 'tees', 'approaches', 'fairways', 'roughs'] },
    { id: 'gray_leaf', label: 'gray leaf spot', start: '07-15', end: '09-15', grasses: ['rye', 'fescue'], surfaces: ['fairways', 'tees', 'roughs'] },
    // Pythium is a full summer program on bent/Poa greens, not just heat insurance
    // — a phosphonate anchor plus a mefenoxam/cyazofamid rotation.
    { id: 'pythium', label: 'Pythium', start: '06-15', end: '09-05', grasses: ['bent', 'poa', 'rye'], surfaces: ['greens', 'tees', 'fairways'] },
  ]
}
const ROOT_DISEASE_IDS = ['root_disease', 'root_disease_fall']

// Rotate on the first FRAC group of a (possibly premix) code, e.g. "11 + 3" → "11".
const fracRoot = (f) => String(f || '').split('+')[0].trim()

// Product → { trade, brand, ai, frac, source, diseases:{id:score} } coverage index
// from the efficacy ratings, keeping the best score per disease and preferring
// the Rutgers (professional) source label.
let _coverage = null
function coverage() {
  if (_coverage) return _coverage
  const m = {}
  for (const r of FUNGICIDE_RATINGS) {
    const k = r.trade
    if (!m[k]) m[k] = { trade: r.trade, brand: brandName(r.trade), ai: r.ai, frac: r.frac, source: r.source, diseases: {} }
    m[k].diseases[r.diseaseId] = Math.max(m[k].diseases[r.diseaseId] || 0, r.score)
    if (r.source === 'Rutgers') m[k].source = 'Rutgers'
  }
  _coverage = Object.values(m)
  return _coverage
}

// Pick the broad-spectrum product for a set of active diseases: covers the most
// of them at score ≥3, rotates off the previous FRAC group, prefers an owned
// product, and (for generic surfaces) prefers a cheaper single-active.
function pickFungicide(activeIds, prevFrac, products, generic) {
  let best = null, bestScore = -1
  for (const c of coverage()) {
    let covered = 0, sum = 0
    for (const id of activeIds) { const s = c.diseases[id] || 0; if (s >= 3) { covered++; sum += s } }
    if (covered === 0) continue
    const single = !String(c.ai).includes('+')
    const owned = ownedMatch({ trade: c.trade, ai: c.ai }, products)
    let score = covered * 100 + sum * 5
    if (fracRoot(c.frac) !== prevFrac) score += 30
    if (owned) score += 40
    if (generic && single) score += 15
    if (generic && isGeneric(c.ai)) score += 20 // cost-sensitive surfaces: favor true off-patent generics
    if (!generic && !single) score += 8
    if (score > bestScore) { bestScore = score; best = { ...c, owned, single } }
  }
  return best
}

// One consolidated fungicide rotation for a surface: a single dated chain where
// each spray's product is chosen to cover that week's active diseases.
function buildFungicideChain(surf, year, soil, products) {
  const opts = surf.surface === 'fairways' ? { interval: 21, generic: true }
    : surf.surface === 'roughs' ? { interval: 28, generic: true }
      : { interval: 14, generic: false } // greens / tees / approaches
  const wins = fungWindows(soil).filter((w) =>
    w.surfaces.includes(surf.surface) && (w.grasses[0] === 'any' || w.grasses.some((g) => surf.grasses.includes(g))),
  )
  if (!wins.length) return []
  const seasonStart = wins.map((w) => w.start).sort()[0]
  const seasonEnd = wins.map((w) => w.end).sort().slice(-1)[0]
  const apps = []
  let prevFrac = null
  chain(year, seasonStart, seasonEnd, opts.interval).forEach((date) => {
    const md = date.slice(5)
    const active = wins.filter((w) => md >= w.start && md <= w.end)
    if (!active.length) return
    // Summer patch and bent root diseases aren't in the ratings table — score
    // the pick on the rated diseases active that week and add a product note.
    const ratedIds = active.map((w) => w.id).filter((id) => id !== 'summer_patch' && !ROOT_DISEASE_IDS.includes(id))
    const pick = pickFungicide(ratedIds.length ? ratedIds : ['dollar_spot'], prevFrac, products, opts.generic)
    if (!pick) return
    prevFrac = fracRoot(pick.frac)
    const sand = surf.surface === 'greens' || surf.surface === 'tees' || surf.surface === 'approaches'
    const covers = active.map((w) => w.label)
    const needPythium = active.some((w) => w.id === 'pythium') && !((pick.diseases['pythium'] || 0) >= 3)
    const summerPatch = active.some((w) => w.id === 'summer_patch')
    const rootDisease = active.some((w) => ROOT_DISEASE_IDS.includes(w.id))
    const fairyRing = active.some((w) => w.id === 'fairy_ring')
    let extra = ''
    if (needPythium) extra += ' Pythium window — anchor a phosphonate (Signature-type) and rotate a mefenoxam / cyazofamid partner in.'
    if (summerPatch && !String(pick.frac).includes('3')) extra += ' Summer-patch window — favor a DMI (FRAC 3) drench, watered in.'
    if (rootDisease) extra += ' Bent root-disease window — use a DMI/QoI + phosphonate (e.g. prothioconazole or pyraclostrobin), watered in to the roots.'
    // Sand-based greens: root drenches must be watered in, and fairy ring / LDS
    // are common in sand — pair with a wetting agent.
    if (sand && (summerPatch || fairyRing)) extra += ' Sand-based greens: water this in to the root zone; fairy ring / localized dry spot run high in sand — apply with a wetting agent.'
    const lib = pick.owned
      ? [{ name: pick.owned.name, matched: pick.ai, stock: pick.owned.stock == null || pick.owned.stock === '' ? null : Number(pick.owned.stock), unit: pick.owned.unit || '' }]
      : libraryFor([pick.ai], products)
    const gen = isGeneric(pick.ai)
    apps.push({
      area: surf.name, surface: surf.surface, cat: 'fungicide', type: 'Fungicide',
      target: 'Fungicide rotation', date, interval: opts.interval,
      chemistry: `FRAC ${pick.frac} · covers ${covers.join(', ')}${pick.owned ? ' · in your stock' : gen && opts.generic ? ' · generic available' : ''}`,
      actives: [pick.ai], frac: pick.frac, generic: gen, rate: rateFor([pick.ai]), covers,
      reason: `Broad-spectrum preventive covering ${covers.join(', ')} — one rotation, FRAC rotated.${extra}`,
      source: `${pick.source} efficacy rating`, rank: pick.diseases,
      product: pick.owned ? pick.owned.name : pick.brand, library: lib,
    })
  })
  // One late-fall snow-mold combination on cool-season playing surfaces.
  if (['greens', 'tees', 'fairways', 'approaches'].includes(surf.surface)) {
    const owned = ownedMatch({ trade: 'Instrata, Interface, Daconil', ai: 'chlorothalonil' }, products)
    apps.push({
      area: surf.name, surface: surf.surface, cat: 'fungicide', type: 'Fungicide',
      target: 'Snow mold', date: `${year}-11-15`, interval: null,
      chemistry: 'Combination — FRAC 3 + 11 + contact', actives: ['chlorothalonil'], rate: 'per label (combo)', generic: false, covers: ['snow mold'],
      reason: 'One combination spray before persistent snow carries protection through winter (Microdochium + gray snow mold).',
      source: 'Penn State / Wisconsin.', rank: null,
      product: owned ? owned.name : 'Instrata / Interface (combo)',
      library: owned ? [{ name: owned.name, matched: 'chlorothalonil', stock: owned.stock == null || owned.stock === '' ? null : Number(owned.stock), unit: owned.unit || '' }] : [],
    })
  }
  return apps
}

// Bethesda / DC-metro soil-temperature crossing dates (regional-normal fallback).
const BETHESDA_SOIL = { spring55: '04-01', spring65: '05-01', fall70: '09-20', fall55: '11-05' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const norm = (s) => String(s || '').toLowerCase()

// Classify a surface from its area name.
export function classifySurface(name) {
  const n = norm(name)
  if (/green/.test(n)) return 'greens'
  if (/fairway/.test(n)) return 'fairways' // "Fairways and Tees" reads as fairways (broadcast)
  if (/rough/.test(n)) return 'roughs'
  if (/tee/.test(n)) return 'tees'
  if (/approach|collar|intermediate|surround/.test(n)) return 'approaches'
  if (/range/.test(n)) return 'range'
  return 'fairways'
}
export const SURFACE_LABEL = { greens: 'Greens', tees: 'Tees', fairways: 'Fairways', roughs: 'Roughs', approaches: 'Approaches / intermediate', range: 'Driving range' }
// Default grasses if a surface hasn't had its grass set on the area.
const DEFAULT_GRASS = {
  greens: ['bent', 'poa'], tees: ['bent', 'rye', 'bluegrass'], fairways: ['rye', 'bluegrass', 'bent'],
  roughs: ['fescue', 'bluegrass'], approaches: ['bent', 'poa'], range: ['rye', 'bluegrass', 'fescue'],
}

// Normalize free-text grass names to model tokens.
export function grassTokens(list) {
  const out = new Set()
  ;(list || []).forEach((g) => {
    const s = norm(g)
    if (s.includes('poa') || s.includes('annual blue')) out.add('poa')
    else if (s.includes('blue')) out.add('bluegrass')
    if (s.includes('bent')) out.add('bent')
    if (s.includes('rye')) out.add('rye')
    if (s.includes('fescue')) out.add('fescue')
    if (s.includes('bermuda')) out.add('bermuda')
    if (s.includes('zoysia')) out.add('zoysia')
  })
  return [...out]
}
export function grassesForSurface(surface, rawGrasses) {
  const toks = grassTokens(rawGrasses)
  return toks.length ? toks : (DEFAULT_GRASS[surface] || ['bent', 'poa'])
}

// Expand a chain (start→end MM-DD at interval) into dated apps for the year.
function chain(year, startMD, endMD, intervalDays) {
  const out = []
  if (!startMD || !endMD) return out
  const start = new Date(`${year}-${startMD}T00:00:00`)
  const end = new Date(`${year}-${endMD}T00:00:00`)
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + intervalDays)) out.push(d.toISOString().slice(0, 10))
  return out
}
const rotate = (list, i) => list[i % list.length]

// ── Growing-degree-day timing ────────────────────────────────────────────────
// Bethesda GDD normals — average GDD per day by month at base 32°F (PGR / Poa
// seedhead) and base 50°F (insects, crabgrass). Lets the program place GDD-driven
// applications on real heat accumulation, not a fixed calendar interval, so they
// tighten in summer and stretch in spring/fall the way the biology does.
const GDD_RATE = {
  32: [3, 5, 12, 22, 33, 42, 47, 45, 37, 24, 12, 4], // Jan..Dec, GDD/day base 32°F
  50: [0, 0, 2, 6, 15, 24, 29, 27, 19, 8, 2, 0], //             base 50°F
}
const DIM = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
// GDD accumulated Jan 1 → MM-DD at a base.
function gddThrough(base, md) {
  const [m, d] = md.split('-').map(Number)
  let g = 0
  for (let i = 0; i < m - 1; i++) g += GDD_RATE[base][i] * DIM[i]
  return Math.round(g + GDD_RATE[base][m - 1] * d)
}
// The MM-DD at which `target` more GDD accrue after `fromMD`, walking the normals.
function dateAtGdd(base, target, fromMD = '01-01') {
  const goal = gddThrough(base, fromMD) + target
  for (let m = 0; m < 12; m++) {
    for (let d = 1; d <= DIM[m]; d++) {
      const md = `${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      if (md < fromMD) continue
      if (gddThrough(base, md) >= goal) return md
    }
  }
  return null
}
const clampMD = (md, lo, hi) => (md == null ? hi : md < lo ? lo : md > hi ? hi : md)
const daysBetweenMD = (year, a, b) => Math.round((new Date(`${year}-${b}T00:00:00`) - new Date(`${year}-${a}T00:00:00`)) / 86400000)

// Resolve a rule's schedule into dated apps. Supports: at (fixed date), gdd
// (single app at a GDD target, clamped to a window), gddStep (a chain stepped by
// GDD), or a plain calendar interval.
function ruleDates(r, y) {
  const s = r.sched
  if (s.at) return [{ date: `${y}-${s.at}`, interval: null }]
  if (s.gdd) {
    const md = clampMD(dateAtGdd(s.gdd.base, s.gdd.target, s.gdd.from || '01-01'), s.gdd.after || '01-01', s.gdd.before || '12-31')
    return [{ date: `${y}-${md}`, interval: null }]
  }
  if (s.gddStep) {
    const out = []
    let cur = s.start
    while (cur && cur <= s.end) {
      const next = dateAtGdd(s.gddStep.base, s.gddStep.target, cur)
      const gap = next ? daysBetweenMD(y, cur, next) : s.gddStep.fallback || 14
      out.push({ date: `${y}-${cur}`, interval: gap })
      cur = next
    }
    return out
  }
  return chain(y, s.start, s.end, s.interval).map((date) => ({ date, interval: s.interval || null }))
}

// Library match by active ingredient (or product name), sorted by stock.
function libraryFor(actives, products = []) {
  if (!actives || !actives.length) return []
  return (products || [])
    .map((p) => {
      const ai = norm(p.activeIngredient), nm = norm(p.name)
      const hit = actives.find((a) => (ai && ai.includes(a)) || (nm && nm.includes(a)))
      if (!hit) return null
      const stock = p.stock == null || p.stock === '' ? null : Number(p.stock)
      return { name: p.name, matched: hit, stock, unit: p.unit || '' }
    })
    .filter(Boolean)
    .sort((a, b) => (b.stock || 0) - (a.stock || 0))
}

// FRAC rotation for the dollar-spot backbone (no MOA repeats back-to-back).
const DS_ROT = [
  { group: 'FRAC 3 (DMI)', actives: ['propiconazole', 'metconazole', 'triticonazole'] },
  { group: 'FRAC 7 (SDHI)', actives: ['penthiopyrad', 'boscalid', 'fluxapyroxad', 'isofetamid'] },
  { group: 'FRAC M05', actives: ['chlorothalonil'] },
  { group: 'FRAC 7+11', actives: ['fluxapyroxad', 'pyraclostrobin'] },
  { group: 'FRAC 29 / 19', actives: ['fluazinam', 'polyoxin'] },
]

const CAT_TYPE = { fungicide: 'Fungicide', insecticide: 'Insecticide', herbicide: 'Herbicide', pgr: 'Growth Regulator' }

// ── The rule set ─────────────────────────────────────────────────────────────
// Each rule: which surfaces + (optional) grasses it applies to, how it schedules,
// and the chemistry. `soilKey`/`interval` let a rule read a climate crossing.
function rules(soil) {
  return [
    // Fungicides
    { cat: 'fungicide', diseaseId: 'dollar_spot', target: 'Dollar spot (backbone)', surfaces: ['greens', 'tees', 'approaches'], sched: { start: '05-05', end: '10-10', interval: 14, rotation: DS_ROT }, product: 'Dollar spot fungicide (rotate FRAC)', actives: DS_ROT.flatMap((r) => r.actives), reason: 'Smith-Kerns pressure climbs through the warm season; rotated 14-day preventives keep it from breaking through.', source: 'Univ. of Wisconsin Smith-Kerns; Rutgers/Penn State.' },
    { cat: 'fungicide', diseaseId: 'dollar_spot', target: 'Dollar spot (fairway)', surfaces: ['fairways', 'range'], sched: { start: '05-20', end: '09-25', interval: 28, rotation: DS_ROT }, product: 'Dollar spot fungicide (rotate FRAC)', actives: DS_ROT.flatMap((r) => r.actives), reason: 'Dollar spot hits fairways too; a 28-day rotated preventive covers the pressure season.', source: 'Rutgers / Penn State.' },
    { cat: 'fungicide', diseaseId: 'brown_patch', target: 'Brown patch', surfaces: ['greens', 'tees', 'fairways', 'approaches'], sched: { start: '06-15', end: '09-01', interval: 21 }, chemistry: 'FRAC 11 (QoI) / 7 — azoxystrobin, flutolanil', product: 'Brown patch fungicide (QoI/SDHI)', actives: ['azoxystrobin', 'flutolanil', 'pyraclostrobin'], reason: 'Warm humid nights (Jun–Aug) favor Rhizoctonia.', source: 'Penn State / Rutgers.' },
    { cat: 'fungicide', diseaseId: 'pythium', target: 'Pythium blight (heat)', surfaces: ['greens', 'tees', 'fairways'], grasses: ['bent', 'poa', 'rye'], sched: { start: '07-01', end: '08-20', interval: 21 }, chemistry: 'FRAC 4 (mefenoxam) / 21 (cyazofamid) + phosphonate', product: 'Pythium fungicide', actives: ['mefenoxam', 'cyazofamid', 'phosphon', 'fosetyl', 'ethazol'], reason: 'Hot days + warm humid nights can blow up overnight; keep a preventive down through the heat.', source: 'Rutgers / Penn State.' },
    { cat: 'fungicide', diseaseId: 'anthracnose', target: 'Anthracnose', surfaces: ['greens', 'tees'], grasses: ['poa'], sched: { start: '06-01', end: '09-10', interval: 21 }, chemistry: 'FRAC 3/11/7 + phosphonate — rotate with DS', product: 'Anthracnose fungicide', actives: ['propiconazole', 'azoxystrobin', 'phosphon', 'fosetyl', 'chlorothalonil'], reason: 'Summer heat + leaf wetness on stressed Poa; raise mowing/N and keep a rotated preventive down.', source: 'Rutgers / Penn State BMPs.' },
    { cat: 'fungicide', diseaseId: 'gray_leaf', target: 'Gray leaf spot', surfaces: ['fairways', 'tees', 'roughs', 'range'], grasses: ['rye', 'fescue'], sched: { start: '07-15', end: '09-15', interval: 21 }, chemistry: 'FRAC 3/11 — azoxystrobin, propiconazole', product: 'Gray leaf spot fungicide', actives: ['azoxystrobin', 'propiconazole', 'pyraclostrobin', 'trifloxystrobin'], reason: 'Devastates perennial ryegrass in warm humid August nights above ~65°F.', source: 'UGA / Ohio State.' },
    { cat: 'fungicide', target: 'Summer patch (spring)', surfaces: ['greens', 'tees', 'fairways'], grasses: ['poa', 'bluegrass', 'bent', 'fescue'], sched: { start: soil.spring65, end: '06-30', interval: 28 }, chemistry: 'FRAC 3 (DMI) or 11 (QoI) — drench in', product: 'Summer patch fungicide (DMI/QoI)', actives: ['propiconazole', 'azoxystrobin', 'pyraclostrobin', 'metconazole'], reason: `Root infection starts as 2" soil warms through ~65°F (~${soil.spring65}); the ONLY effective window is spring, watered in.`, source: 'Penn State / NC State.' },
    { cat: 'fungicide', diseaseId: 'fairy_ring', target: 'Fairy ring', surfaces: ['greens', 'tees'], sched: { start: '05-15', end: '06-30', interval: 28 }, chemistry: 'FRAC 3 / 7+11 — drench with wetting agent', product: 'Fairy ring fungicide', actives: ['triticonazole', 'metconazole', 'flutolanil', 'azoxystrobin'], reason: 'Preventive as soil hits ~60–65°F; a wetting agent moves it into the ring zone.', source: 'NC State / Rutgers.' },
    { cat: 'fungicide', target: 'Snow mold', surfaces: ['greens', 'tees', 'fairways'], sched: { at: '11-15' }, chemistry: 'Combination — FRAC 3 + 11 + PCNB', product: 'Snow mold combination', actives: ['propiconazole', 'azoxystrobin', 'pcnb', 'chlorothalonil', 'iprodione', 'fludioxonil'], reason: 'One combination spray before persistent snow carries protection through winter.', source: 'Penn State / Wisconsin.' },
    // Insecticides
    { cat: 'insecticide', target: 'ABW — adults', surfaces: ['greens', 'tees', 'approaches', 'fairways'], grasses: ['poa'], sched: { gdd: { base: 50, target: 100, after: '03-25', before: '05-05' } }, chemistry: 'Pyrethroid (IRAC 3) — bifenthrin, lambda-cyhalothrin', product: 'ABW adulticide (pyrethroid)', actives: ['bifenthrin', 'lambda-cyhalothrin', 'deltamethrin'], reason: 'GDD-timed to overwintered adult migration (~100 GDD base 50°F ≈ forsythia bloom), before they lay into Poa.', source: 'Rutgers / Cornell.' },
    { cat: 'insecticide', target: 'ABW — larvae', surfaces: ['greens', 'tees', 'approaches', 'fairways'], grasses: ['poa'], sched: { start: '05-10', end: '08-15', interval: 35 }, chemistry: 'Diamide (IRAC 28) — chlorantraniliprole / cyantraniliprole', product: 'ABW larvicide (diamide)', actives: ['chlorantraniliprole', 'cyantraniliprole', 'spinosad', 'indoxacarb'], reason: '2–3 overlapping generations run into late summer; rotate off pyrethroids for resistance.', source: 'Rutgers / Cornell.' },
    { cat: 'insecticide', target: 'White grubs — preventive', surfaces: ['fairways', 'tees', 'roughs', 'range', 'approaches'], sched: { gdd: { base: 50, target: 1030, after: '06-10', before: '07-15' } }, chemistry: 'IRAC 28 (chlorantraniliprole) or 4A (imidacloprid)', product: 'Grub preventive', actives: ['chlorantraniliprole', 'imidacloprid', 'clothianidin', 'thiamethoxam'], reason: 'GDD-timed to adult flight / early egg hatch (~1,030 GDD base 50°F); water in. A diamide here also gives long fall-armyworm residual.', source: 'UMD / UMass.' },
    { cat: 'insecticide', target: 'Fall armyworm / caterpillars', surfaces: ['greens', 'tees', 'fairways', 'roughs'], sched: { start: '07-15', end: '09-30', interval: 30 }, chemistry: 'Diamide (IRAC 28) or spinosad/Bt on small larvae', product: 'Caterpillar control', actives: ['chlorantraniliprole', 'spinosad', 'bacillus thuringiensis', 'indoxacarb', 'bifenthrin'], reason: 'Late-summer caterpillars strip turf overnight — soap-flush and treat SMALL larvae.', source: 'UMD.' },
    { cat: 'insecticide', target: 'Bluegrass billbug', surfaces: ['roughs', 'fairways'], grasses: ['bluegrass'], sched: { gdd: { base: 50, target: 280, after: '04-15', before: '05-25' } }, chemistry: 'Pyrethroid (adults) / systemic ahead of larvae', product: 'Billbug control', actives: ['bifenthrin', 'lambda-cyhalothrin', 'chlorantraniliprole', 'imidacloprid'], reason: 'GDD-timed to spring adult activity (~280 GDD base 50°F), before eggs are laid.', source: 'Ohio State / Purdue.' },
    // Herbicides
    { cat: 'herbicide', target: 'Crabgrass pre-emergent (1st)', surfaces: ['fairways', 'tees', 'roughs', 'range'], sched: { at: soil.spring55 }, chemistry: 'HRAC 3 — prodiamine or dithiopyr', product: 'Pre-emergent (prodiamine/dithiopyr)', actives: ['prodiamine', 'dithiopyr', 'pendimethalin'], reason: `Down BEFORE soil reaches 55°F (~${soil.spring55}, forsythia bloom) — a PRE won't stop germinated crabgrass. NOT on greens/approaches. On sand-based bent tees use a reduced rate or a non-DNA option (oxadiazon/Ronstar) — DNA pre-emergents can prune roots on shallow sand turf.`, source: 'UMD / Purdue.' },
    { cat: 'herbicide', target: 'Goosegrass + crabgrass PRE (2nd)', surfaces: ['fairways', 'tees', 'roughs'], sched: { at: '05-15' }, chemistry: 'HRAC 3 (dithiopyr) ± oxadiazon', product: 'Pre-emergent (2nd)', actives: ['dithiopyr', 'oxadiazon', 'prodiamine'], reason: 'A second app ~6–8 weeks after the first — goosegrass germinates later and over a long window, so it routinely outlasts a single PRE. Oxadiazon (Ronstar) is the goosegrass workhorse and is safer on sand rooting than the DNAs.', source: 'NC State / Purdue.' },
    { cat: 'herbicide', target: 'Goosegrass pre-emergent (3rd)', surfaces: ['fairways', 'roughs'], sched: { at: '06-25' }, chemistry: 'HRAC 3 (oxadiazon) / 14 (topramezone rescue)', product: 'Goosegrass PRE (3rd)', actives: ['oxadiazon', 'dithiopyr'], reason: 'Goosegrass keeps germinating into midsummer; a third band ~6 weeks out holds it where pressure is high. Follow with a post-emergent rescue if it escapes.', source: 'NC State goosegrass.' },
    { cat: 'herbicide', target: 'Broadleaf weeds (spring)', surfaces: ['fairways', 'roughs', 'range'], sched: { at: '05-01' }, chemistry: 'HRAC 4 three-way — 2,4-D + mecoprop + dicamba', product: 'Three-way broadleaf', actives: ['2,4-d', 'mecoprop', 'dicamba', 'triclopyr'], reason: 'Actively growing spring broadleaves take up systemic three-ways well.', source: 'UMD.' },
    { cat: 'herbicide', target: 'Nutsedge / sedges', surfaces: ['fairways', 'tees', 'roughs'], sched: { start: '06-15', end: '08-01', interval: 21 }, chemistry: 'HRAC 2 (halosulfuron) / 14 (sulfentrazone)', product: 'Sedge control', actives: ['halosulfuron', 'sulfentrazone', 'imazosulfuron'], reason: 'Sedges surge in summer heat/moisture; treat young plants.', source: 'UMD / Purdue.' },
    { cat: 'herbicide', target: 'Broadleaf weeds (fall)', surfaces: ['fairways', 'roughs', 'range'], sched: { at: '09-25' }, chemistry: 'HRAC 4 three-way — 2,4-D + mecoprop + dicamba', product: 'Three-way broadleaf', actives: ['2,4-d', 'mecoprop', 'dicamba', 'triclopyr'], reason: 'Fall is the BEST window for perennial broadleaves — they move herbicide to the roots.', source: 'UMD.' },
    { cat: 'herbicide', target: 'Poa annua fall pre-emergent', surfaces: ['fairways', 'roughs'], sched: { at: soil.fall70 }, chemistry: 'HRAC 3 (prodiamine) / 29 (indaziflam)', product: 'Fall Poa pre-emergent', actives: ['prodiamine', 'indaziflam', 'bensulide'], reason: `Poa germinates as soil cools below ~70°F (~${soil.fall70}); a fall PRE cuts the flush.`, source: 'UMD / NC State.' },
    // PGR
    { cat: 'pgr', target: 'Poa seedhead suppression', surfaces: ['greens', 'tees'], grasses: ['poa'], sched: { start: '03-25', end: '05-10', gddStep: { base: 32, target: 300, fallback: 18 } }, chemistry: 'Proxy (ethephon) + Primo (trinexapac) — GDD-timed', product: 'Poa seedhead (Proxy + Primo)', actives: ['ethephon', 'trinexapac', 'mefluidide'], reason: 'Start before the seedhead flush and repeat on GDD (base 32°F) through spring — three apps suppress the Poa seedhead peak on greens/tees.', source: 'Rutgers / Purdue.' },
    { cat: 'pgr', target: 'Growth regulation', surfaces: ['greens', 'tees', 'fairways', 'approaches'], sched: { start: '05-05', end: '10-10', gddStep: { base: 32, target: 360, fallback: 14 } }, chemistry: 'Trinexapac (Primo Maxx) ± prohexadione-Ca (Anuew) — ~200 GDD (base 0°C)', product: 'PGR (trinexapac ± prohexadione)', actives: ['trinexapac', 'prohexadione', 'paclobutrazol', 'flurprimidol'], reason: 'GDD-timed PGR: reapply every ~200 GDD (base 0°C) so regulation never rebounds — intervals tighten to ~8 days in summer heat and stretch to ~2 weeks in spring/fall. High-end greens stack trinexapac (Primo) with prohexadione (Anuew) and dial the rate to clipping yield. On sand greens improves density, cuts clippings and firms surfaces.', source: 'Kreuser/Soldat GDD model.' },
  ]
}

const grassMatch = (ruleGrasses, surfaceGrasses) => !ruleGrasses || ruleGrasses.some((g) => surfaceGrasses.includes(g))

// Build the program. `areas` is an array of { name, grasses:[rawStrings] } — the
// SELECTED surfaces. Each becomes its own set of dated applications.
export function buildProgram(year, { areas = [], products = [], climate = null } = {}) {
  const y = Number(year)
  const soil = {
    spring55: (climate && climate.spring55) || BETHESDA_SOIL.spring55,
    spring65: (climate && climate.spring65) || BETHESDA_SOIL.spring65,
    fall70: (climate && climate.fall70) || BETHESDA_SOIL.fall70,
    fall55: (climate && climate.fall55) || BETHESDA_SOIL.fall55,
  }
  const RULES = rules(soil)

  // Normalize the selected surfaces.
  const surfaces = (areas || []).map((a) => {
    const surface = a.surface || classifySurface(a.name)
    return { name: a.name, surface, grasses: grassesForSurface(surface, a.grasses) }
  })

  const apps = [] // flat list of dated apps, each tagged with its real surface
  surfaces.forEach((surf) => {
    // Fungicides: ONE consolidated broad-spectrum rotation per surface.
    apps.push(...buildFungicideChain(surf, y, soil, products))

    // Insecticides, herbicides and PGRs are genuinely separate targets — keep
    // them per-rule, naming a common brand and preferring owned stock.
    RULES.filter((r) => r.cat !== 'fungicide').forEach((r) => {
      if (!r.surfaces.includes(surf.surface)) return
      if (!grassMatch(r.grasses, surf.grasses)) return
      ruleDates(r, y).forEach(({ date, interval }, i) => {
        const rot = r.sched.rotation ? rotate(r.sched.rotation, i) : null
        const actives = rot ? rot.actives : r.actives
        const chemistry = rot ? `${rot.group} — e.g. ${rot.actives.slice(0, 2).join(', ')}` : r.chemistry
        const lib = libraryFor(actives, products)
        const stockHit = lib.find((l) => l.stock > 0) || lib[0] || null
        const product = stockHit ? stockHit.name : (brandFor(actives) || r.product)
        apps.push({
          area: surf.name, surface: surf.surface, cat: r.cat, type: CAT_TYPE[r.cat],
          target: r.target, date, interval,
          chemistry, actives, rate: rateFor(actives), generic: (actives || []).some(isGeneric),
          reason: r.reason, source: r.source, rank: null,
          product, library: lib,
        })
      })
    })
  })

  // Group into sections by category for display.
  const order = ['fungicide', 'insecticide', 'herbicide', 'pgr']
  const titles = { fungicide: 'Fungicides', insecticide: 'Insecticides', herbicide: 'Herbicides', pgr: 'Plant growth regulators' }
  const sections = order.map((key) => ({ key, title: titles[key], apps: apps.filter((a) => a.cat === key).sort((a, b) => a.date.localeCompare(b.date) || a.area.localeCompare(b.area)) })).filter((s) => s.apps.length)

  return {
    year: y,
    zone: 'Cool-season / transition zone (Bethesda, MD)',
    surfaces: surfaces.map((s) => ({ name: s.name, surface: s.surface, grasses: s.grasses })),
    sections,
    apps,
    gaps: findGaps(apps),
    total: apps.length,
    soil,
    climate: climate && climate.tuned ? { tuned: true, source: climate.source, years: climate.years } : { tuned: false, source: 'Bethesda, MD regional normals' },
  }
}

// Convert the program to saveable applications (db.bulkInsertApplications shape).
export function toApplications(program) {
  return (program.apps || []).map((a) => ({
    area: a.area,
    product: a.product,
    type: a.type,
    target: a.target,
    plannedDate: a.date,
    templateDate: a.date,
    basis: a.surface === 'greens' || a.surface === 'tees' || a.surface === 'approaches' ? 'oz / M' : 'oz / A',
    trigger: a.interval ? { mode: 'interval', days: a.interval } : { mode: 'date' },
    // The model's reasoning rides in the JSONB `data` column so the coverage grid
    // can show why/what/how without extra columns.
    data: {
      chemistry: a.chemistry || null,
      reason: a.reason || null,
      rate: a.rate || null,
      frac: a.frac || null,
      generic: a.generic || false,
      source: a.source || null,
      fromModel: true,
    },
  }))
}

// Gap check: for each surface+target chain, flag any interior uncovered stretch.
function findGaps(apps) {
  const gaps = []
  const groups = {}
  apps.forEach((a) => { if (a.interval) (groups[`${a.area}||${a.target}`] ||= []).push(a) })
  Object.entries(groups).forEach(([key, list]) => {
    const [area, target] = key.split('||')
    const sorted = list.slice().sort((a, b) => a.date.localeCompare(b.date))
    for (let i = 1; i < sorted.length; i++) {
      const days = Math.round((new Date(sorted[i].date) - new Date(sorted[i - 1].date)) / 86400000)
      if (days > sorted[i - 1].interval + 3) gaps.push({ area, target, from: sorted[i - 1].date, to: sorted[i].date, days })
    }
  })
  return gaps
}

export { MONTHS }
