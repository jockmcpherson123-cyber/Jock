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
  ethephon: 'Proxy', trinexapac: 'Primo Maxx', paclobutrazol: 'Trimmit', flurprimidol: 'Cutless', mefluidide: 'Embark',
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
    { id: 'summer_patch', label: 'summer patch', start: soil.spring65, end: '06-30', grasses: ['poa', 'bluegrass', 'bent', 'fescue'], surfaces: ['greens', 'tees', 'fairways'] },
    { id: 'fairy_ring', label: 'fairy ring', start: '05-15', end: '06-30', grasses: ['any'], surfaces: ['greens', 'tees'] },
    { id: 'dollar_spot', label: 'dollar spot', start: '05-05', end: '10-10', grasses: ['any'], surfaces: ['greens', 'tees', 'approaches', 'fairways'] },
    { id: 'anthracnose', label: 'anthracnose', start: '06-01', end: '09-10', grasses: ['poa'], surfaces: ['greens', 'tees', 'approaches'] },
    { id: 'brown_patch', label: 'brown patch', start: '06-15', end: '09-05', grasses: ['any'], surfaces: ['greens', 'tees', 'approaches', 'fairways', 'roughs'] },
    { id: 'gray_leaf', label: 'gray leaf spot', start: '07-15', end: '09-15', grasses: ['rye', 'fescue'], surfaces: ['fairways', 'tees', 'roughs'] },
    { id: 'pythium', label: 'Pythium', start: '07-01', end: '08-25', grasses: ['bent', 'poa', 'rye'], surfaces: ['greens', 'tees', 'fairways'] },
  ]
}

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
    if (generic && single) score += 20
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
    // Summer patch isn't in the ratings table — bias to a DMI in its window and
    // note it; the pick is scored on the rated diseases active that week.
    const ratedIds = active.map((w) => w.id).filter((id) => id !== 'summer_patch')
    const pick = pickFungicide(ratedIds.length ? ratedIds : ['dollar_spot'], prevFrac, products, opts.generic)
    if (!pick) return
    prevFrac = fracRoot(pick.frac)
    const covers = active.map((w) => w.label)
    const needPythium = active.some((w) => w.id === 'pythium') && !((pick.diseases['pythium'] || 0) >= 3)
    const summerPatch = active.some((w) => w.id === 'summer_patch')
    let extra = ''
    if (needPythium) extra += ' Tank-mix a Pythium partner (mefenoxam / cyazofamid) this week.'
    if (summerPatch && !String(pick.frac).includes('3')) extra += ' Summer-patch window — favor a DMI (FRAC 3) drench, watered in.'
    const lib = pick.owned
      ? [{ name: pick.owned.name, matched: pick.ai, stock: pick.owned.stock == null || pick.owned.stock === '' ? null : Number(pick.owned.stock), unit: pick.owned.unit || '' }]
      : libraryFor([pick.ai], products)
    apps.push({
      area: surf.name, surface: surf.surface, cat: 'fungicide', type: 'Fungicide',
      target: 'Fungicide rotation', date, interval: opts.interval,
      chemistry: `FRAC ${pick.frac} · covers ${covers.join(', ')}${pick.owned ? ' · in your stock' : ''}`,
      actives: [pick.ai],
      reason: `Broad-spectrum preventive covering ${covers.join(', ')} — one rotation, FRAC rotated.${extra}`,
      source: `${pick.source} efficacy rating`, rank: null,
      product: pick.owned ? pick.owned.name : pick.brand, library: lib,
    })
  })
  // One late-fall snow-mold combination on cool-season playing surfaces.
  if (['greens', 'tees', 'fairways', 'approaches'].includes(surf.surface)) {
    const owned = ownedMatch({ trade: 'Instrata, Interface, Daconil', ai: 'chlorothalonil' }, products)
    apps.push({
      area: surf.name, surface: surf.surface, cat: 'fungicide', type: 'Fungicide',
      target: 'Snow mold', date: `${year}-11-15`, interval: null,
      chemistry: 'Combination — FRAC 3 + 11 + contact', actives: ['chlorothalonil'],
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
    { cat: 'insecticide', target: 'ABW — adults', surfaces: ['greens', 'tees', 'approaches', 'fairways'], grasses: ['poa'], sched: { at: '04-15' }, chemistry: 'Pyrethroid (IRAC 3) — bifenthrin, lambda-cyhalothrin', product: 'ABW adulticide (pyrethroid)', actives: ['bifenthrin', 'lambda-cyhalothrin', 'deltamethrin'], reason: 'Target overwintered adults at forsythia bloom, before they lay into Poa.', source: 'Rutgers / Cornell.' },
    { cat: 'insecticide', target: 'ABW — larvae', surfaces: ['greens', 'tees', 'approaches', 'fairways'], grasses: ['poa'], sched: { start: '05-10', end: '08-15', interval: 35 }, chemistry: 'Diamide (IRAC 28) — chlorantraniliprole / cyantraniliprole', product: 'ABW larvicide (diamide)', actives: ['chlorantraniliprole', 'cyantraniliprole', 'spinosad', 'indoxacarb'], reason: '2–3 overlapping generations run into late summer; rotate off pyrethroids for resistance.', source: 'Rutgers / Cornell.' },
    { cat: 'insecticide', target: 'White grubs — preventive', surfaces: ['fairways', 'tees', 'roughs', 'range', 'approaches'], sched: { at: '06-20' }, chemistry: 'IRAC 28 (chlorantraniliprole) or 4A (imidacloprid)', product: 'Grub preventive', actives: ['chlorantraniliprole', 'imidacloprid', 'clothianidin', 'thiamethoxam'], reason: 'Best control at/just before egg hatch (Jun–mid-Jul); water in. Also covers fall armyworm.', source: 'UMD / UMass.' },
    { cat: 'insecticide', target: 'Fall armyworm / caterpillars', surfaces: ['greens', 'tees', 'fairways', 'roughs'], sched: { start: '07-15', end: '09-30', interval: 30 }, chemistry: 'Diamide (IRAC 28) or spinosad/Bt on small larvae', product: 'Caterpillar control', actives: ['chlorantraniliprole', 'spinosad', 'bacillus thuringiensis', 'indoxacarb', 'bifenthrin'], reason: 'Late-summer caterpillars strip turf overnight — soap-flush and treat SMALL larvae.', source: 'UMD.' },
    { cat: 'insecticide', target: 'Bluegrass billbug', surfaces: ['roughs', 'fairways'], grasses: ['bluegrass'], sched: { at: '04-20' }, chemistry: 'Pyrethroid (adults) / systemic ahead of larvae', product: 'Billbug control', actives: ['bifenthrin', 'lambda-cyhalothrin', 'chlorantraniliprole', 'imidacloprid'], reason: 'Target adults in spring before eggs are laid.', source: 'Ohio State / Purdue.' },
    // Herbicides
    { cat: 'herbicide', target: 'Crabgrass pre-emergent (1st)', surfaces: ['fairways', 'tees', 'roughs', 'range', 'approaches'], sched: { at: soil.spring55 }, chemistry: 'HRAC 3 — prodiamine or dithiopyr', product: 'Pre-emergent (prodiamine/dithiopyr)', actives: ['prodiamine', 'dithiopyr', 'pendimethalin'], reason: `Down BEFORE soil reaches 55°F (~${soil.spring55}, forsythia bloom) — a PRE won't stop germinated crabgrass.`, source: 'UMD / Purdue.' },
    { cat: 'herbicide', target: 'Goosegrass + crabgrass PRE (2nd)', surfaces: ['fairways', 'tees', 'roughs'], sched: { at: '05-15' }, chemistry: 'HRAC 3 (dithiopyr) ± oxadiazon', product: 'Pre-emergent (2nd)', actives: ['dithiopyr', 'oxadiazon', 'prodiamine'], reason: 'A second app ~6–8 weeks later covers later-germinating goosegrass and extends crabgrass control.', source: 'NC State / Purdue.' },
    { cat: 'herbicide', target: 'Broadleaf weeds (spring)', surfaces: ['fairways', 'roughs', 'range'], sched: { at: '05-01' }, chemistry: 'HRAC 4 three-way — 2,4-D + mecoprop + dicamba', product: 'Three-way broadleaf', actives: ['2,4-d', 'mecoprop', 'dicamba', 'triclopyr'], reason: 'Actively growing spring broadleaves take up systemic three-ways well.', source: 'UMD.' },
    { cat: 'herbicide', target: 'Nutsedge / sedges', surfaces: ['fairways', 'tees', 'roughs'], sched: { start: '06-15', end: '08-01', interval: 21 }, chemistry: 'HRAC 2 (halosulfuron) / 14 (sulfentrazone)', product: 'Sedge control', actives: ['halosulfuron', 'sulfentrazone', 'imazosulfuron'], reason: 'Sedges surge in summer heat/moisture; treat young plants.', source: 'UMD / Purdue.' },
    { cat: 'herbicide', target: 'Broadleaf weeds (fall)', surfaces: ['fairways', 'roughs', 'range'], sched: { at: '09-25' }, chemistry: 'HRAC 4 three-way — 2,4-D + mecoprop + dicamba', product: 'Three-way broadleaf', actives: ['2,4-d', 'mecoprop', 'dicamba', 'triclopyr'], reason: 'Fall is the BEST window for perennial broadleaves — they move herbicide to the roots.', source: 'UMD.' },
    { cat: 'herbicide', target: 'Poa annua fall pre-emergent', surfaces: ['fairways', 'roughs'], sched: { at: soil.fall70 }, chemistry: 'HRAC 3 (prodiamine) / 29 (indaziflam)', product: 'Fall Poa pre-emergent', actives: ['prodiamine', 'indaziflam', 'bensulide'], reason: `Poa germinates as soil cools below ~70°F (~${soil.fall70}); a fall PRE cuts the flush.`, source: 'UMD / NC State.' },
    // PGR
    { cat: 'pgr', target: 'Poa seedhead suppression', surfaces: ['greens', 'tees'], grasses: ['poa'], sched: { start: '03-25', end: '05-10', interval: 21 }, chemistry: 'Proxy (ethephon) + Primo (trinexapac) — GDD-timed', product: 'Poa seedhead (Proxy + Primo)', actives: ['ethephon', 'trinexapac', 'mefluidide'], reason: 'Time the first app to early seedhead GDD; two follow-ups cut the spring Poa flush.', source: 'Rutgers / Purdue.' },
    { cat: 'pgr', target: 'Growth regulation', surfaces: ['greens', 'tees', 'fairways', 'approaches'], sched: { start: '05-05', end: '10-10', interval: 14 }, chemistry: 'Trinexapac (Primo) — reapply on ~200 GDD (base 0°C)', product: 'PGR (trinexapac)', actives: ['trinexapac', 'paclobutrazol', 'flurprimidol'], reason: 'A steady GDD-timed PGR chain improves density, cuts clippings and firms surfaces all season.', source: 'Kreuser/Soldat GDD model.' },
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
      const dates = r.sched.at ? [`${y}-${r.sched.at}`] : chain(y, r.sched.start, r.sched.end, r.sched.interval)
      dates.forEach((date, i) => {
        const rot = r.sched.rotation ? rotate(r.sched.rotation, i) : null
        const actives = rot ? rot.actives : r.actives
        const chemistry = rot ? `${rot.group} — e.g. ${rot.actives.slice(0, 2).join(', ')}` : r.chemistry
        const lib = libraryFor(actives, products)
        const stockHit = lib.find((l) => l.stock > 0) || lib[0] || null
        const product = stockHit ? stockHit.name : (brandFor(actives) || r.product)
        apps.push({
          area: surf.name, surface: surf.surface, cat: r.cat, type: CAT_TYPE[r.cat],
          target: r.target, date, interval: r.sched.interval || null,
          chemistry, actives, reason: r.reason, source: r.source, rank: null,
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
