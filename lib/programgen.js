// ── Model-driven spray-program generator ─────────────────────────────────────
// Builds a full-season, gap-free TEMPLATE program for a cool-season / transition-
// zone golf course (bentgrass + Poa greens & tees, cool-season fairways/roughs),
// driven by the same agronomy the app already models: the Smith-Kerns dollar spot
// season, the disease-risk thresholds, the transition-zone Pest Watch calendar,
// and soil-temperature germination/infection windows — anchored to Bethesda, MD
// climate normals (Congressional, 8500 River Rd).
//
// IMPORTANT — this is a STARTING TEMPLATE to review, not a prescription. It names
// chemistry CLASSES and example active ingredients with resistance-group rotation,
// never rates (the label and a licensed applicator set those). Windows come from
// published extension programs; a superintendent adjusts them to their turf,
// budget, and the in-season models. The live models in the app fine-tune the
// timing week to week.
//
// matchLibraryForPest-style matching lets each line show what the club already
// stocks. Everything is generated for a target year as real dated applications so
// it drops onto the app's coverage grid, which flags any gap.

// Bethesda / DC-metro soil-temperature crossing dates (2" soil), from climate
// normals — these anchor the soil-driven windows (PRE timing, summer patch, Poa).
// Approximate day-of-year the 5-day mean 2" soil temp crosses each mark.
const BETHESDA_SOIL = {
  spring55: '04-01', // crabgrass PRE must be down by here (forsythia bloom)
  spring65: '05-01', // summer patch root-infection window opens
  fall70: '09-20', // Poa annua germination flush begins as soil cools < 70°F
  fall55: '11-05', // soil cooling through 55°F — snow-mold / dormancy approaches
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Expand a preventive CHAIN (start→end MM-DD at an interval) into dated apps for
// the target year, so a continuous fungicide backbone becomes real calendar rows.
function chain(year, startMD, endMD, intervalDays) {
  const out = []
  const start = new Date(`${year}-${startMD}T00:00:00`)
  const end = new Date(`${year}-${endMD}T00:00:00`)
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + intervalDays)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}
// A single dated app.
function once(year, md) { return [`${year}-${md}`] }

// Rotate a resistance-group list across a chain so consecutive sprays differ.
function rotate(list, i) { return list[i % list.length] }

const norm = (s) => String(s || '').toLowerCase()
// Reuse the Chemical Library by active ingredient (or product name) so each line
// shows what's on the shelf. `actives` is a list of lowercase ingredient tokens.
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

// Is the course cool-season (drives which diseases/weeds apply)? Defaults true
// for the transition zone unless the club only grows warm-season grasses.
function isCoolSeason(grasses = []) {
  if (!grasses.length) return true
  const g = grasses.map(norm)
  const cool = ['bent', 'poa', 'rye', 'bluegrass', 'fescue']
  return g.some((x) => cool.some((c) => x.includes(c)))
}

// ── The template program ─────────────────────────────────────────────────────
// Each block: how to schedule (chain or once), the target, area, chemistry class
// with example actives + resistance-group rotation, the reason (which model/window
// drives it), and the ingredient tokens used to match the library.
export function buildProgram(year, { grasses = [], products = [] } = {}) {
  const y = Number(year)
  const cool = isCoolSeason(grasses)

  // Resistance-group rotations for the dollar-spot backbone (FRAC groups), so
  // consecutive sprays never repeat a mode of action.
  const DS_ROT = [
    { group: 'FRAC 3 (DMI)', actives: ['propiconazole', 'metconazole', 'triticonazole'] },
    { group: 'FRAC 7 (SDHI)', actives: ['penthiopyrad', 'boscalid', 'fluxapyroxad', 'isofetamid'] },
    { group: 'FRAC M05', actives: ['chlorothalonil'] },
    { group: 'FRAC 7+11', actives: ['fluxapyroxad', 'pyraclostrobin'] },
    { group: 'FRAC 29 / 19', actives: ['fluazinam', 'polyoxin'] },
  ]

  const sections = []
  const push = (key, title, apps) => sections.push({ key, title, apps: apps.filter(Boolean) })

  // Helper to build a chain of app rows sharing chemistry rotation.
  const mkChain = (opts) => {
    const dates = chain(y, opts.start, opts.end, opts.interval)
    return dates.map((date, i) => {
      const rot = opts.rotation ? rotate(opts.rotation, i) : null
      const actives = rot ? rot.actives : opts.actives
      return {
        date, target: opts.target, area: opts.area,
        chemistry: rot ? `${rot.group} — e.g. ${rot.actives.slice(0, 2).join(', ')}` : opts.chemistry,
        actives, interval: opts.interval, reason: opts.reason, source: opts.source,
        library: libraryFor(actives, products),
      }
    })
  }
  const mkOnce = (opts) => {
    const rows = (opts.dates || once(y, opts.at)).map((date) => ({
      date, target: opts.target, area: opts.area, chemistry: opts.chemistry, actives: opts.actives,
      reason: opts.reason, source: opts.source, library: libraryFor(opts.actives, products),
    }))
    return rows
  }

  if (cool) {
    // ── FUNGICIDES — greens & tees (the intensive program) ──────────────────
    const fung = []
    // Dollar spot backbone: Smith-Kerns pressure builds May–Oct; 14-day chain
    // with full FRAC rotation is the no-gap spine of the whole program.
    fung.push(...mkChain({ target: 'Dollar spot (backbone)', area: 'Greens & tees', start: '05-05', end: '10-10', interval: 14, rotation: DS_ROT,
      reason: 'Smith-Kerns probability climbs through the warm season; back-to-back 14-day preventives with rotated FRAC groups keep it from ever breaking through.',
      source: 'Univ. of Wisconsin Smith-Kerns model; Rutgers/Penn State DS programs.' }))
    // Brown patch overlays mid-summer (usually covered by the SDHI/QoI slots).
    fung.push(...mkOnce({ dates: chain(y, '06-15', '09-01', 21), target: 'Brown patch overlay', area: 'Greens & tees',
      chemistry: 'FRAC 11 (QoI) / 7 — azoxystrobin, flutolanil', actives: ['azoxystrobin', 'flutolanil', 'pyraclostrobin'],
      reason: 'Warm humid nights (Jun–Aug) favor Rhizoctonia; align an SDHI/QoI slot in the DS rotation to cover it.',
      source: 'Penn State / Rutgers brown patch.' }))
    // Pythium — heat insurance, Jul–Aug.
    fung.push(...mkOnce({ dates: chain(y, '07-01', '08-20', 21), target: 'Pythium blight (heat)', area: 'Greens & tees',
      chemistry: 'FRAC 4 (mefenoxam) / 21 (cyazofamid) + phosphonate', actives: ['mefenoxam', 'cyazofamid', 'phosphon', 'fosetyl', 'ethazol'],
      reason: 'Hot days (86°F+) with warm humid nights can blow up overnight; keep a preventive down through the heat.',
      source: 'Rutgers / Penn State Pythium forecasting.' }))
    // Anthracnose on Poa — Jun–Sep.
    fung.push(...mkOnce({ dates: chain(y, '06-01', '09-10', 21), target: 'Anthracnose (Poa)', area: 'Greens & tees',
      chemistry: 'FRAC 3/11/7 + phosphonate — rotate with DS slots', actives: ['propiconazole', 'azoxystrobin', 'phosphon', 'fosetyl', 'chlorothalonil'],
      reason: 'Summer heat + leaf wetness on stressed annual bluegrass; raise mowing/N and keep a rotated preventive down.',
      source: 'Rutgers / Penn State anthracnose BMPs.' }))
    // Summer patch — SPRING preventive at soil 65°F, drench, 28-day x3.
    fung.push(...mkOnce({ dates: chain(y, BETHESDA_SOIL.spring65, '06-30', 28), target: 'Summer patch (spring preventive)', area: 'Greens, tees & Poa fairways',
      chemistry: 'FRAC 3 (DMI) or 11 (QoI) — drench in', actives: ['propiconazole', 'azoxystrobin', 'pyraclostrobin', 'metconazole'],
      reason: `Root infection starts as 2" soil warms through ~65°F (~${BETHESDA_SOIL.spring65}); the ONLY effective window is spring, watered in.`,
      source: 'Penn State / NC State summer patch.' }))
    // Fairy ring — late spring soil 60-65°F drench.
    fung.push(...mkOnce({ dates: chain(y, '05-15', '06-30', 28), target: 'Fairy ring', area: 'Greens & tees',
      chemistry: 'FRAC 3 (DMI) / 7+11 — drench with wetting agent', actives: ['triticonazole', 'metconazole', 'flutolanil', 'azoxystrobin'],
      reason: 'Preventive as soil hits ~60–65°F; a wetting agent moves it into the ring zone.',
      source: 'NC State / Rutgers fairy ring.' }))
    // Snow mold — late fall, before persistent snow (Microdochium + gray).
    fung.push(...mkOnce({ dates: once(y, '11-15'), target: 'Snow mold (Microdochium + gray)', area: 'Greens, tees & fairways',
      chemistry: 'Combination — FRAC 3 + 11 + PCNB/others', actives: ['propiconazole', 'azoxystrobin', 'pcnb', 'chlorothalonil', 'iprodione', 'fludioxonil'],
      reason: 'One combination spray on greens/tees/fairways before persistent snow cover carries protection through winter.',
      source: 'Penn State / Wisconsin snow mold.' }))
    push('fungicide', 'Fungicides — greens, tees & fairways', fung)

    // ── INSECTICIDES (Pest Watch) ───────────────────────────────────────────
    const ins = []
    ins.push(...mkOnce({ dates: once(y, '04-15'), target: 'Annual bluegrass weevil — adults', area: 'Greens, tees, collars & Poa fairways',
      chemistry: 'Pyrethroid (IRAC 3) — bifenthrin, lambda-cyhalothrin', actives: ['bifenthrin', 'lambda-cyhalothrin', 'deltamethrin'],
      reason: 'Target overwintered adults at forsythia full bloom, before they lay into Poa.',
      source: 'Rutgers / Cornell ABW.' }))
    ins.push(...mkOnce({ dates: chain(y, '05-10', '08-15', 35), target: 'Annual bluegrass weevil — larvae', area: 'Greens, tees, collars & Poa fairways',
      chemistry: 'Diamide (IRAC 28) — chlorantraniliprole / cyantraniliprole', actives: ['chlorantraniliprole', 'cyantraniliprole', 'spinosad', 'indoxacarb'],
      reason: '2–3 overlapping generations run into late summer; a diamide covers all larval stages — rotate off pyrethroids for resistance.',
      source: 'Rutgers / Cornell ABW.' }))
    ins.push(...mkOnce({ dates: once(y, '06-20'), target: 'White grubs — preventive', area: 'Fairways, tees & roughs',
      chemistry: 'IRAC 28 (chlorantraniliprole) or 4A (imidacloprid/clothianidin)', actives: ['chlorantraniliprole', 'imidacloprid', 'clothianidin', 'thiamethoxam'],
      reason: 'Best control is at/just before egg hatch (Jun–mid-Jul); water in. Also gives long fall-armyworm residual.',
      source: 'UMD / UMass grub timing.' }))
    ins.push(...mkOnce({ dates: chain(y, '07-15', '09-30', 30), target: 'Fall armyworm / cutworm / webworm — scout & treat', area: 'Greens, tees & fairways',
      chemistry: 'Diamide (IRAC 28) or spinosad/Bt on small larvae', actives: ['chlorantraniliprole', 'spinosad', 'bacillus thuringiensis', 'indoxacarb', 'bifenthrin'],
      reason: 'Late-summer caterpillars can strip turf overnight — soap-flush and treat SMALL larvae; the June grub diamide already covers much of this.',
      source: 'UMD fall armyworm.' }))
    push('insecticide', 'Insecticides', ins)

    // ── HERBICIDES — pre & post-emergent ────────────────────────────────────
    const herb = []
    herb.push(...mkOnce({ dates: once(y, '03-20'), target: 'Crabgrass — pre-emergent (1st)', area: 'Fairways, tees & roughs',
      chemistry: 'HRAC 3 — prodiamine or dithiopyr', actives: ['prodiamine', 'dithiopyr', 'pendimethalin'],
      reason: `Down BEFORE soil reaches 55°F (~${BETHESDA_SOIL.spring55}, forsythia bloom) — once crabgrass germinates a PRE won't stop it.`,
      source: 'UMD / Purdue crabgrass PRE.' }))
    herb.push(...mkOnce({ dates: once(y, '05-15'), target: 'Goosegrass + crabgrass — pre-emergent (2nd)', area: 'Fairways, tees & roughs',
      chemistry: 'HRAC 3 (dithiopyr) ± oxadiazon', actives: ['dithiopyr', 'oxadiazon', 'prodiamine'],
      reason: 'A second app ~6–8 weeks after the first covers goosegrass (germinates later) and extends the crabgrass window.',
      source: 'NC State / Purdue goosegrass.' }))
    herb.push(...mkOnce({ dates: once(y, '05-01'), target: 'Broadleaf weeds — post-emergent (spring)', area: 'Fairways & roughs',
      chemistry: 'HRAC 4 three-way — 2,4-D + mecoprop + dicamba', actives: ['2,4-d', 'mecoprop', 'dicamba', 'triclopyr'],
      reason: 'Actively growing spring broadleaves take up systemic three-ways well.',
      source: 'UMD broadleaf control.' }))
    herb.push(...mkOnce({ dates: chain(y, '06-15', '08-01', 21), target: 'Nutsedge / sedges', area: 'Fairways, tees & roughs',
      chemistry: 'HRAC 2 (halosulfuron) / 14 (sulfentrazone)', actives: ['halosulfuron', 'sulfentrazone', 'imazosulfuron'],
      reason: 'Sedges surge in summer heat/moisture; treat young, actively growing plants.',
      source: 'UMD / Purdue sedge control.' }))
    herb.push(...mkOnce({ dates: once(y, '09-25'), target: 'Broadleaf weeds — post-emergent (fall)', area: 'Fairways & roughs',
      chemistry: 'HRAC 4 three-way — 2,4-D + mecoprop + dicamba', actives: ['2,4-d', 'mecoprop', 'dicamba', 'triclopyr'],
      reason: 'Fall is the BEST window for perennial broadleaves — they move herbicide to the roots ahead of winter.',
      source: 'UMD broadleaf control.' }))
    herb.push(...mkOnce({ dates: once(y, BETHESDA_SOIL.fall70), target: 'Poa annua — fall pre-emergent', area: 'Fairways & roughs (not greens)',
      chemistry: 'HRAC 3 (prodiamine) / 29 (indaziflam)', actives: ['prodiamine', 'indaziflam', 'bensulide'],
      reason: `Poa germinates as soil cools below ~70°F (~${BETHESDA_SOIL.fall70}); a fall PRE on fairways/roughs cuts the fall flush.`,
      source: 'UMD / NC State Poa management.' }))
    push('herbicide', 'Herbicides — pre & post-emergent', herb)

    // ── PGR ─────────────────────────────────────────────────────────────────
    const pgr = []
    pgr.push(...mkOnce({ dates: chain(y, '03-25', '05-10', 21), target: 'Poa seedhead suppression', area: 'Greens & tees',
      chemistry: 'Proxy (ethephon) + Primo (trinexapac) — GDD-timed', actives: ['ethephon', 'trinexapac', 'mefluidide'],
      reason: 'Time the first app to early seedhead GDD; two follow-ups 3 weeks apart cut the spring Poa seedhead flush.',
      source: 'Rutgers / Purdue Poa seedhead.' }))
    pgr.push(...mkChain({ target: 'Growth regulation', area: 'Greens, tees & fairways', start: '05-05', end: '10-10', interval: 14,
      chemistry: 'Trinexapac (Primo) — reapply on ~200 GDD (base 0°C)', actives: ['trinexapac', 'paclobutrazol', 'flurprimidol'],
      reason: 'A steady PGR chain (reapply as growth regulation wears off by GDD) improves density, reduces clippings, and firms surfaces all season.',
      source: 'Kreuser/Soldat GDD PGR model.' }))
    push('pgr', 'Plant growth regulators', pgr)
  } else {
    // Warm-season fallback (bermuda/zoysia) — a lighter template.
    push('note', 'Warm-season turf', [{ date: `${y}-01-01`, target: 'Warm-season program', area: 'All',
      chemistry: 'Spring dead spot (fall DMI), large patch (spring/fall), grub & mole cricket timing differ from cool-season',
      reason: 'Your configured grasses are warm-season; this generator is tuned for cool-season/transition-zone golf. Ask for a warm-season build.',
      source: 'NC State / Oklahoma State warm-season programs.', library: [] }])
  }

  // ── Gap analysis — walk the dollar-spot backbone week by week ─────────────
  // The DS chain is the spine; if any interior week between its first and last
  // spray is uncovered (each app protects `interval` days), flag it.
  const gaps = findGaps(sections)

  return {
    year: y,
    zone: 'Cool-season / transition zone (Bethesda, MD)',
    grasses,
    sections,
    gaps,
    total: sections.reduce((n, s) => n + s.apps.length, 0),
  }
}

// Walk each chained target and report any interior uncovered stretch (a gap in
// continuous protection). Single-shot apps (once) aren't chains, so skip them.
function findGaps(sections) {
  const gaps = []
  sections.forEach((sec) => {
    const byTarget = {}
    sec.apps.forEach((a) => { if (a.interval) (byTarget[a.target] ||= []).push(a) })
    Object.entries(byTarget).forEach(([target, apps]) => {
      const sorted = apps.slice().sort((a, b) => a.date.localeCompare(b.date))
      for (let i = 1; i < sorted.length; i++) {
        const prev = new Date(sorted[i - 1].date + 'T00:00:00')
        const cur = new Date(sorted[i].date + 'T00:00:00')
        const days = Math.round((cur - prev) / 86400000)
        if (days > sorted[i - 1].interval + 3) {
          gaps.push({ target, from: sorted[i - 1].date, to: sorted[i].date, days })
        }
      }
    })
  })
  return gaps
}

export { MONTHS }
