// Excel importer for the annual pesticide plan.
//
// Works on both the server (Node) and the browser (SheetJS runs in both). It
// reads the two things we need out of the workbook:
//   1. The "Pesticide List" sheet  → Chemical Library products
//   2. Each per-area sheet          → planned program applications
//
// The per-area tabs are NOT uniformly laid out (columns shift, some have extra
// sequence/notes columns, some split headers across two rows), so we never rely
// on fixed column positions. Instead we find the header row and map columns by
// matching their text. This makes the importer robust to the real-world mess.
import * as XLSX from 'xlsx'
import { FORMULATIONS } from '@/lib/defaults'
import { indexProducts, canonicalName, normName } from '@/lib/products'

const AREA_SHEETS = [
  'Blue Greens', 'Gold Greens', 'Natives', 'Gold Fairways', 'Rough',
  'Blue Fairways', 'Gold Intermediate', 'Driving Range', 'Gold Tees',
]

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

// Map the spreadsheet's plural type names to the app's product types.
const TYPE_MAP = {
  herbicides: 'Herbicide',
  fungicides: 'Fungicide',
  insecticides: 'Insecticide',
  growthregulators: 'Growth Reg',
  wettingagents: 'Wetting Agent',
  fertilizers: 'Fertilizer',
  phosphites: 'Biological',
  pigments: 'Biological',
}
function mapType(raw) {
  return TYPE_MAP[norm(raw)] || 'Fungicide'
}

// Excel stores dates as a serial number (days since 1899-12-30). Convert to an
// ISO date string. Strings like "Mar 2013" or "5/4/23" are parsed best-effort.
function toISODate(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number' && isFinite(v)) {
    if (v < 1 || v > 80000) return null // out of a sensible date range
    const ms = Date.UTC(1899, 11, 30) + Math.round(v) * 86400000
    return new Date(ms).toISOString().slice(0, 10)
  }
  const t = Date.parse(String(v))
  if (!isNaN(t)) return new Date(t).toISOString().slice(0, 10)
  return null
}

// Parse a label-rate string like "3-3.5 oz/A", "1-2oz/M", ".6-1.2oz/M", "5 oz/M"
// into { min, max, per } where per is 'M' or 'A'.
function parseLabelRate(s) {
  if (!s) return null
  const str = String(s)
  const per = /\/\s*A/i.test(str) ? 'A' : /\/\s*M/i.test(str) ? 'M' : null
  const nums = (str.match(/\d*\.?\d+/g) || []).map(Number).filter((n) => !isNaN(n))
  if (nums.length === 0) return null
  return { min: nums[0], max: nums.length > 1 ? nums[1] : null, per }
}

function mapUnit(raw) {
  const n = norm(raw)
  if (n === 'gal') return 'gal'
  if (n === 'lbs' || n === 'lb') return 'lbs'
  if (n === 'ml') return 'ml'
  if (n === 'floz' || n === 'oz') return 'oz'
  return 'oz'
}

// ── Pesticide List → products ───────────────────────────────────────────────
export function parsePesticideList(wb) {
  const ws = wb.Sheets['Pesticide List']
  if (!ws) return []
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
  // Header is row 0; columns are fixed on this sheet.
  return rows
    .slice(1)
    .filter((r) => r[0] && String(r[0]).trim())
    .map((r) => {
      const lr = parseLabelRate(r[7])
      const product = {
        name: String(r[0]).trim(),
        type: mapType(r[6]),
        rate: null,
        basis: lr?.per === 'M' ? 'oz / M' : 'oz / A',
        unit: mapUnit(r[10]),
        labelMinM: lr?.per === 'M' ? lr.min : null,
        labelMaxM: lr?.per === 'M' ? lr.max : null,
        labelMinA: lr?.per === 'A' ? lr.min : null,
        labelMaxA: lr?.per === 'A' ? lr.max : null,
        stock: 0,
        lowStockThreshold: 0,
        // Extended fields (from the Pesticide List)
        manufacturer: r[1] ? String(r[1]).trim() : '',
        activeIngredient: r[2] ? String(r[2]).trim() : '',
        pctFormulation: r[3] ?? null,
        signalWord: r[4] ? String(r[4]).trim() : '',
        defaultTarget: r[5] ? String(r[5]).trim() : '',
        caseSize: r[8] ? String(r[8]).trim() : '',
        ozPerCase: r[9] ?? null,
        costPerCase: r[13] ?? null,
        vendor: r[14] ? String(r[14]).trim() : '',
        labelUrl: r[15] ? String(r[15]).trim() : '',
        resistanceGroup: '',
      }
      return product
    })
}

// ── Header detection for area sheets ────────────────────────────────────────
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const cells = rows[i].map(norm)
    if (cells.includes('chemicalapplied') || cells.includes('chemical')) return i
  }
  return 1
}

// A cell counts as part of a (possibly two-line) header only if it's short
// non-numeric text — this lets us stitch split headers like "Rate" + "oz/M"
// without accidentally swallowing a data value like 0.2 on single-line sheets.
function isHeaderish(x) {
  return typeof x === 'string' && x.trim() !== '' && isNaN(Number(x)) && x.length < 14
}

function mapColumns(rows, hr) {
  const m = {}
  const header = rows[hr] || []
  const below = rows[hr + 1] || []
  // Per-column header text = this row's text, plus the row below ONLY when that
  // cell is itself header-like (the split-header case).
  const combined = header.map((h, i) => norm(`${h ?? ''}${isHeaderish(below[i]) ? below[i] : ''}`))

  const consider = (idx, n) => {
    if (m.chemical == null && (n === 'chemicalapplied' || n === 'chemical')) m.chemical = idx
    if (m.type == null && n === 'type') m.type = idx
    if (m.target == null && (n === 'targetpest' || n === 'target')) m.target = idx
    if (m.rateOzM == null && (n === 'rateozm' || n === 'ozm')) m.rateOzM = idx
    if (m.rateOzA == null && (n === 'rateoza' || n === 'oza')) m.rateOzA = idx
    if (n === 'date') {
      if (m.date1 == null) m.date1 = idx
      else if (m.date2 == null && idx !== m.date1) m.date2 = idx
    }
  }
  // Match on the header row first, then on the combined split-header text.
  header.forEach((h, idx) => consider(idx, norm(h)))
  combined.forEach((n, idx) => consider(idx, n))
  return m
}

// Header tokens that must never be treated as a product name (they appear when
// a sheet's header spans two rows).
const HEADER_TOKENS = new Set(['applied', 'chemical', 'chemicalapplied', 'product'])

// ── Area sheets → applications ──────────────────────────────────────────────
export function parseAreaPrograms(wb) {
  const applications = []
  const areaCounts = {}
  for (const name of AREA_SHEETS) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
    const hr = findHeaderRow(rows)
    const m = mapColumns(rows, hr)
    if (m.chemical == null || m.rateOzM == null) {
      areaCounts[name] = 0
      continue
    }
    let count = 0
    rows.slice(hr + 1).forEach((r) => {
      const chem = r[m.chemical] != null ? String(r[m.chemical]).trim() : ''
      const rate = Number(r[m.rateOzM])
      // Skip blanks, header-continuation rows, and non-numeric/zero rates.
      if (!chem || HEADER_TOKENS.has(norm(chem)) || !isFinite(rate) || rate <= 0) return
      const rateOzM = rate
      const templateDate = toISODate(r[m.date1])
      const plannedDate = toISODate(r[m.date2]) || templateDate
      applications.push({
        area: name,
        product: chem,
        rateOzM: Number(rateOzM),
        rateOzA: r[m.rateOzA] != null ? Number(r[m.rateOzA]) : null,
        basis: 'oz / M',
        type: m.type != null && r[m.type] ? mapType(r[m.type]) : null,
        templateDate,
        plannedDate,
        target: m.target != null && r[m.target] ? String(r[m.target]).trim() : '',
      })
      count++
    })
    areaCounts[name] = count
  }
  return { applications, areaCounts }
}

// ════════════════════════════════════════════════════════════════════════
//  Chemical Library import — a FLEXIBLE, header-driven importer for a
//  spreadsheet the user builds themselves. We never rely on column position;
//  we match each column's header text against a list of accepted names, so the
//  user can lay the sheet out however they like as long as the headers are
//  recognizable (Name, Type, Rate, Stock, Label link, SDS link, N, P, K, …).
// ════════════════════════════════════════════════════════════════════════

// field → the header words that map to it (all normalized: lowercase, letters
// and digits only). First matching column wins.
const FIELD_TOKENS = {
  name: ['name', 'product', 'productname', 'chemical', 'chemicalapplied', 'chemicalname'],
  type: ['type', 'category', 'producttype', 'class'],
  rate: ['rate', 'defaultrate', 'raterate'],
  basis: ['basis', 'ratebasis'],
  unit: ['unit', 'units', 'defaultunit'],
  labelMinM: ['labelminm', 'minm', 'minratem', 'labelminimumm', 'minozm'],
  labelMaxM: ['labelmaxm', 'maxm', 'maxratem', 'labelmaximumm', 'maxozm'],
  labelMinA: ['labelmina', 'mina', 'minratea', 'minoza'],
  labelMaxA: ['labelmaxa', 'maxa', 'maxratea', 'maxoza'],
  labelRate: ['labelrate', 'labelrange', 'raterange', 'labelraterange'],
  stock: ['stock', 'onhand', 'currentstock', 'inventory', 'qty', 'quantity', 'instock'],
  lowStockThreshold: ['lowstock', 'lowstockalert', 'lowstockthreshold', 'reorder', 'reorderpoint', 'threshold', 'lowstocklevel'],
  n: ['n', 'npct', 'nitrogen', 'npercent'],
  p: ['p', 'ppct', 'phosphorus', 'ppercent'],
  k: ['k', 'kpct', 'potassium', 'kpercent'],
  nPerGal: ['npergal', 'nlbsgal', 'nlbspergal'],
  pPerGal: ['ppergal', 'plbsgal', 'plbspergal'],
  kPerGal: ['kpergal', 'klbsgal', 'klbspergal'],
  fertForm: ['form', 'fertform', 'fertilizerform'],
  // Tank-mix fill order (dry first, adjuvants last). Stored as a formulation id.
  formulation: ['mixingorder', 'mixorder', 'tankmixorder', 'fillorder', 'tankorder', 'formulation', 'formulationclass', 'mixgroup'],
  labelUrl: ['labelurl', 'labellink', 'label', 'labelweblink'],
  sdsUrl: ['sdsurl', 'sdslink', 'sds', 'msds', 'safetydatasheet'],
  moaGroup: ['moagroup', 'resistancegroup', 'chemicalgroup', 'fracgroup', 'fraccode', 'frac', 'hrac', 'irac', 'moa', 'group', 'class'],
  rotationDays: ['rotationdays', 'rotateafter', 'rotateafterdays', 'rotationinterval', 'rotatedays', 'rotation'],
  sprayInterval: ['sprayinterval', 'sprayintervaldays', 'reapply', 'reapplydays', 'repeatinterval', 'reapplyinterval', 'interval'],
  eiq: ['eiq', 'eiqvalue', 'environmentalimpactquotient', 'impactquotient'],
  caseSize: ['casesize', 'case', 'packsize', 'packagesize'],
  ozPerCase: ['ozpercase', 'ozcase', 'ozspercase', 'ouncespercase', 'ozunit'],
  costPerCase: ['costpercase', 'pricepercase', 'casecost', 'cost', 'price', 'costcase'],
  manufacturer: ['manufacturer', 'maker', 'brand', 'mfr'],
  activeIngredient: ['activeingredient', 'ai', 'active', 'activeingredients'],
  activePct: ['activepct', 'activepercent', 'pctactive', 'percentactive', 'formulationpct', 'aistrength', 'activestrength', 'activeai', 'concentration', 'strength'],
  signalWord: ['signalword', 'signal'],
  rei: ['rei', 'reentry', 'restrictedentry', 'reentryinterval', 'reihrs', 'reihours'],
  avoidGrasses: ['avoidgrasses', 'avoid', 'grasssafety', 'damagesgrasses', 'avoidon', 'grassavoid'],
  epaReg: ['epareg', 'eparegno', 'eparegnumber', 'eparegistration', 'eparegistrationnumber', 'epa'],
  containerSize: ['containersize', 'container', 'jug', 'jugsize', 'packagesizeunit', 'containerjug'],
  pulaUrl: ['pula', 'pulaurl', 'pulalink', 'pulabulletin', 'bulletin', 'esplink', 'esabulletin'],
}

// Cells that mean "blank" even though they aren't empty — spreadsheet error
// markers and em-dashes. Treated as "leave as is" on an update.
const BLANK_CELLS = new Set(['na', 'n/a', '#n/a', '#na', '—', '-', 'none', 'null'])
const isBlankCell = (cell) => {
  if (cell == null) return true
  const s = String(cell).trim()
  return s === '' || BLANK_CELLS.has(s.toLowerCase())
}
// Clean a number that may carry commas (1,092.06) or units; blank markers → null.
function cleanNum(cell) {
  if (isBlankCell(cell)) return null
  const n = Number(String(cell).replace(/,/g, '').replace(/[^0-9.-]/g, ''))
  return isFinite(n) ? n : null
}
// "2.5 gal" / "50 lb" / "1.33 oz" → { jugSize, jugUnit }. Unit normalized to the
// stock units the form uses (gal / lbs / oz / fl oz).
function parseContainerSize(cell) {
  if (isBlankCell(cell)) return null
  const m = String(cell).trim().match(/([\d.,]+)\s*(fl\s*oz|floz|oz|gal|gallons?|lbs?|lb|pounds?|kg|g)?/i)
  if (!m) return null
  const size = Number(m[1].replace(/,/g, ''))
  if (!isFinite(size)) return null
  const u = norm(m[2] || '')
  const unit = u.startsWith('floz') ? 'fl oz' : u.startsWith('gal') ? 'gal' : (u === 'lb' || u.startsWith('lbs') || u.startsWith('pound')) ? 'lbs' : u === 'oz' ? 'oz' : (m[2] || '').trim() || 'gal'
  return { jugSize: size, jugUnit: unit }
}
// Split a " + "-joined cell (multi active ingredient / multi %).
const splitPlus = (cell) => String(cell == null ? '' : cell).split('+').map((s) => s.trim()).filter((s) => s !== '')
// A "Rate <Area> /M" column header → the area text, matched to a real area name.
function areaRateHeader(rawHeader, areaNames = []) {
  const m = String(rawHeader || '').match(/^\s*rate\s+(.+?)\s*\/\s*m\s*$/i)
  if (!m) return null
  const areaRaw = m[1].trim()
  const hit = (areaNames || []).find((a) => norm(a) === norm(areaRaw))
  return { areaRaw, area: hit || null }
}

const NUMERIC_FIELDS = new Set(['rate', 'labelMinM', 'labelMaxM', 'labelMinA', 'labelMaxA', 'stock', 'lowStockThreshold', 'n', 'p', 'k', 'nPerGal', 'pPerGal', 'kPerGal', 'activePct', 'ozPerCase', 'costPerCase', 'rotationDays', 'sprayInterval', 'eiq', 'rei'])

// Turn a "Mixing Order" cell into a formulation id. Accepts our ids
// ("flowable"), short/long labels ("Flowable (SC)"), or the everyday
// abbreviations off a product label (WDG, WP, SC, EC, SL, WSP…).
const FORMULATION_ALIASES = {
  conditioner: 'conditioner', compatibility: 'conditioner', buffer: 'conditioner', acidifier: 'conditioner', conditioneragent: 'conditioner',
  dry: 'dry', wdg: 'dry', wg: 'dry', dg: 'dry', df: 'dry', wp: 'dry', wettablepowder: 'dry', wettablegranule: 'dry', granule: 'dry', granular: 'dry', powder: 'dry',
  wsp: 'wsp', solublepacket: 'wsp', packet: 'wsp', watersolublepacket: 'wsp',
  flowable: 'flowable', sc: 'flowable', suspensionconcentrate: 'flowable', fl: 'flowable', f: 'flowable',
  soluble: 'soluble', sl: 'soluble', solubleliquid: 'soluble',
  ec: 'ec', emulsifiable: 'ec', emulsifiableconcentrate: 'ec',
  fertilizer: 'fertilizer', fert: 'fertilizer', fertiliser: 'fertilizer', micros: 'fertilizer', liquidfertilizer: 'fertilizer',
  adjuvant: 'adjuvant', surfactant: 'adjuvant', oil: 'adjuvant', nis: 'adjuvant', mso: 'adjuvant', wettingagent: 'adjuvant',
  other: 'other', notsure: 'other',
}
function normalizeFormulation(raw) {
  const s = norm(raw)
  if (!s) return ''
  if (FORMULATIONS.some((f) => f.id === s)) return s
  if (FORMULATION_ALIASES[s]) return FORMULATION_ALIASES[s]
  const byLabel = FORMULATIONS.find((f) => norm(f.short) === s || norm(f.label) === s)
  if (byLabel) return byLabel.id
  const bySub = FORMULATIONS.find((f) => s.includes(f.id) && f.id !== 'other')
  return bySub ? bySub.id : ''
}

function mapTypeFlexible(raw) {
  const t = norm(raw)
  const map = {
    fungicide: 'Fungicide', fungicides: 'Fungicide',
    herbicide: 'Herbicide', herbicides: 'Herbicide',
    insecticide: 'Insecticide', insecticides: 'Insecticide',
    growthreg: 'Growth Reg', growthregulator: 'Growth Reg', growthregulators: 'Growth Reg', pgr: 'Growth Reg',
    biological: 'Biological', biologicals: 'Biological', phosphite: 'Biological', pigment: 'Biological',
    wettingagent: 'Wetting Agent', wettingagents: 'Wetting Agent', surfactant: 'Wetting Agent',
    fertilizer: 'Fertilizer', fertilizers: 'Fertilizer', fert: 'Fertilizer',
  }
  return map[t] || ''
}

// Find the header row (first row that has a name column plus at least one other
// recognized column) and return { headerRow, colMap } where colMap is field→index.
function detectLibraryHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i] || []
    const cells = row.map(norm)
    const colMap = {}
    cells.forEach((c, idx) => {
      if (!c) return
      // Special case: a "% active" style header (e.g. "Active %", "% AI",
      // "Formulation %") is the strength, not the ingredient name. Route it to
      // activePct before the plain "active"/"ai" tokens claim it as the name.
      const raw = String(row[idx] ?? '').toLowerCase()
      if (colMap.activePct == null && raw.includes('%') && /(active|\bai\b|formulation)/.test(raw)) {
        colMap.activePct = idx
        return
      }
      for (const [field, tokens] of Object.entries(FIELD_TOKENS)) {
        if (colMap[field] == null && tokens.includes(c)) { colMap[field] = idx; break }
      }
    })
    if (colMap.name != null && Object.keys(colMap).length >= 2) return { headerRow: i, colMap }
  }
  return { headerRow: -1, colMap: {} }
}

// Parse a Chemical Library spreadsheet (browser ArrayBuffer). Returns
// { products, columns, count } where products are PARTIALs (only provided
// fields) ready for db.importProducts. `columns` is the human list of what we
// recognized, for the confirmation screen.
export function parseChemicalLibrary(dataArrayBuffer) {
  const wb = XLSX.read(dataArrayBuffer, { type: 'array' })
  const preferred = wb.SheetNames.find((n) => /chemical|product|pesticide|library/i.test(n))
  const ws = wb.Sheets[preferred || wb.SheetNames[0]]
  if (!ws) return { products: [], columns: [], count: 0, error: 'The file has no sheets.' }

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
  const { headerRow, colMap } = detectLibraryHeader(rows)
  if (headerRow < 0) {
    return { products: [], columns: [], count: 0, error: 'Could not find a header row. Make sure the top row has a "Name" column (plus Type, Rate, Stock, etc.).' }
  }

  const products = []
  rows.slice(headerRow + 1).forEach((r) => {
    if (!r) return
    const rawName = colMap.name != null ? r[colMap.name] : null
    const name = rawName != null ? String(rawName).trim() : ''
    if (!name || HEADER_TOKENS.has(norm(name))) return

    const partial = { name }
    for (const [field, idx] of Object.entries(colMap)) {
      if (field === 'name') continue
      const cell = r[idx]
      if (cell == null || String(cell).trim() === '') continue

      if (field === 'type') {
        const t = mapTypeFlexible(cell)
        if (t) partial.type = t
      } else if (field === 'labelRate') {
        const lr = parseLabelRate(cell)
        if (lr) {
          if (lr.per === 'A') { partial.labelMinA = lr.min; partial.labelMaxA = lr.max }
          else { partial.labelMinM = lr.min; partial.labelMaxM = lr.max }
        }
      } else if (field === 'unit') {
        partial.unit = mapUnit(cell)
      } else if (field === 'fertForm') {
        partial.fertForm = /liq/i.test(String(cell)) ? 'liquid' : 'granular'
      } else if (field === 'formulation') {
        const f = normalizeFormulation(cell)
        if (f) partial.formulation = f
      } else if (field === 'avoidGrasses') {
        partial.avoidGrasses = String(cell).split(/[,;|]/).map((s) => s.trim()).filter(Boolean)
      } else if (field === 'labelUrl' || field === 'sdsUrl' || field === 'pulaUrl') {
        partial[field] = String(cell).trim()
      } else if (NUMERIC_FIELDS.has(field)) {
        const num = Number(String(cell).replace(/[^0-9.-]/g, ''))
        if (isFinite(num)) partial[field] = num
      } else {
        partial[field] = String(cell).trim()
      }
    }
    products.push(partial)
  })

  const columns = Object.keys(colMap).filter((f) => f !== 'labelRate')
  return { products, columns, count: products.length }
}

// ── Chemical Library UPSERT workbook (the Playbooks import) ──────────────────
// Reads named sheets ('Chemical Library' = create/update, 'Updates - Existing'
// = update only), ignores everything else. Returns PARTIAL products — only the
// cells that were filled — so a blank cell means "leave as is" on an update.
// Also parses EPA Reg #, Container Size, per-area rate columns ("Rate <Area>
// /M"), and multi-active ingredient/% cells. areaNames drives the per-area
// columns so a new area just needs a new column (no code change).
const LIB_SHEET = 'Chemical Library'
const UPDATE_SHEET = 'Updates - Existing'

function buildPartial(row, colMap, areaCols) {
  const name = String(row[colMap.name] ?? '').trim()
  if (!name || HEADER_TOKENS.has(norm(name))) return null
  const partial = { name }
  const take = (field, idx) => {
    const cell = row[idx]
    if (isBlankCell(cell)) return
    if (field === 'type') { const t = mapTypeFlexible(cell); if (t) partial.type = t }
    else if (field === 'labelRate') { const lr = parseLabelRate(cell); if (lr) { if (lr.per === 'A') { partial.labelMinA = lr.min; partial.labelMaxA = lr.max } else { partial.labelMinM = lr.min; partial.labelMaxM = lr.max } } }
    else if (field === 'unit') partial.unit = mapUnit(cell)
    else if (field === 'fertForm') partial.fertForm = /liq/i.test(String(cell)) ? 'liquid' : 'granular'
    else if (field === 'formulation') { const f = normalizeFormulation(cell); if (f) partial.formulation = f }
    else if (field === 'avoidGrasses') partial.avoidGrasses = String(cell).split(/[,;|]/).map((s) => s.trim()).filter(Boolean)
    else if (field === 'containerSize') { const c = parseContainerSize(cell); if (c) { partial.jugSize = c.jugSize; partial.jugUnit = c.jugUnit } }
    else if (field === 'activeIngredient') partial._aiRaw = String(cell).trim()
    else if (field === 'activePct') partial._aiPctRaw = String(cell).trim()
    else if (field === 'labelUrl' || field === 'sdsUrl' || field === 'pulaUrl' || field === 'epaReg' || field === 'moaGroup' || field === 'manufacturer' || field === 'signalWord') partial[field] = String(cell).trim()
    else if (NUMERIC_FIELDS.has(field)) { const n = cleanNum(cell); if (n != null) partial[field] = n }
    else partial[field] = String(cell).trim()
  }
  for (const [field, idx] of Object.entries(colMap)) { if (field !== 'name') take(field, idx) }

  // Multi active ingredient: split name + % on '+', pair by position.
  if (partial._aiRaw != null) {
    const names = splitPlus(partial._aiRaw)
    const pcts = partial._aiPctRaw != null ? splitPlus(partial._aiPctRaw).map((x) => cleanNum(x)) : []
    partial.activeIngredient = partial._aiRaw
    if (names.length > 1) {
      // count mismatch or single % → % on the first active only
      const paired = pcts.length === names.length
      partial.actives = names.map((nm, i) => ({ name: nm, pct: paired ? (pcts[i] ?? '') : (i === 0 ? (pcts[0] ?? '') : '') }))
    } else if (partial._aiPctRaw != null) {
      partial.actives = [{ name: partial._aiRaw, pct: pcts[0] ?? '' }]
    }
    if (partial._aiPctRaw != null) partial.activePct = pcts[0] ?? undefined
  } else if (partial._aiPctRaw != null) {
    const n = cleanNum(partial._aiPctRaw); if (n != null) partial.activePct = n
  }
  delete partial._aiRaw; delete partial._aiPctRaw

  // Per-area rates (oz product / 1,000 sq ft).
  const areaRates = {}
  areaCols.forEach(({ area, idx }) => { if (!area) return; const n = cleanNum(row[idx]); if (n != null) areaRates[area] = n })
  if (Object.keys(areaRates).length) partial.areaRates = areaRates
  return partial
}

export function parseChemicalWorkbook(dataArrayBuffer, areaNames = []) {
  const wb = XLSX.read(dataArrayBuffer, { type: 'array' })
  const sheetsSeen = []
  const rowsOut = []
  const areaWarnings = new Set()
  let anyHeader = false

  for (const [sheetName, updateOnly] of [[LIB_SHEET, false], [UPDATE_SHEET, true]]) {
    const actual = wb.SheetNames.find((n) => norm(n) === norm(sheetName))
    if (!actual) continue
    sheetsSeen.push(actual)
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[actual], { header: 1, defval: null })
    const { headerRow, colMap } = detectLibraryHeader(rows)
    if (headerRow < 0) continue
    anyHeader = true
    // Per-area rate columns from the header row (not claimed by a field).
    const headerCells = rows[headerRow] || []
    const claimed = new Set(Object.values(colMap))
    const areaCols = []
    headerCells.forEach((h, idx) => {
      if (claimed.has(idx)) return
      const hit = areaRateHeader(h, areaNames)
      if (!hit) return
      if (hit.area) areaCols.push({ area: hit.area, idx })
      else areaWarnings.add(String(h).trim())
    })
    rows.slice(headerRow + 1).forEach((r) => {
      if (!r) return
      const partial = buildPartial(r, colMap, areaCols)
      if (partial) rowsOut.push({ ...partial, _updateOnly: updateOnly })
    })
  }

  if (!sheetsSeen.length) return { rows: [], areaWarnings: [], sheets: [], error: `No '${LIB_SHEET}' or '${UPDATE_SHEET}' sheet found in the file.` }
  if (!anyHeader) return { rows: [], areaWarnings: [], sheets: sheetsSeen, error: 'Found the sheets but no header row with a Name column.' }
  return { rows: rowsOut, areaWarnings: [...areaWarnings], sheets: sheetsSeen }
}

// Turn parsed workbook rows into a create/update plan against the current
// library. Match by normalized name. Update = only the fields the row fills
// (never clears). Returns { creates, updates:[{name, changes, merged}], errors }.
export function buildProductUpsertPlan(rows = [], existing = []) {
  const byNorm = new Map()
  ;(existing || []).forEach((p) => { if (p?.name) byNorm.set(normName(p.name), p) })
  const creates = []; const updates = []; const errors = []
  const seen = new Set()
  rows.forEach((row) => {
    const { _updateOnly, ...partial } = row
    const key = normName(partial.name)
    if (!key) { errors.push({ name: partial.name || '(blank)', error: 'missing name' }); return }
    if (seen.has(key)) return // dedupe within the file (last wins would double-apply)
    seen.add(key)
    const cur = byNorm.get(key)
    if (!cur) {
      if (_updateOnly) { errors.push({ name: partial.name, error: 'not in library (update-only sheet)' }); return }
      creates.push({ ...partial, name: partial.name.trim() })
      return
    }
    // Merge non-blank fields only; record what actually changes.
    const merged = { ...cur }
    const changes = []
    Object.entries(partial).forEach(([f, v]) => {
      if (f === 'name') return
      if (f === 'areaRates') { merged.areaRates = { ...(cur.areaRates || {}), ...v }; changes.push('areaRates'); return }
      const before = cur[f]
      const same = Array.isArray(v) ? JSON.stringify(before) === JSON.stringify(v) : String(before ?? '') === String(v ?? '')
      if (!same) { merged[f] = v; changes.push(f) }
    })
    if (changes.length) updates.push({ name: cur.name, changes, merged })
  })
  return { creates, updates, errors }
}

// ════════════════════════════════════════════════════════════════════════
//  Spray history import — backfill past applications so the reports, rotation,
//  usage and GDD-since-last-PGR all have data from day one. Header-driven; one
//  row per product, grouped into a spray record by date + area (a tank mix).
// ════════════════════════════════════════════════════════════════════════
const HIST_TOKENS = {
  date: ['date', 'sprayed', 'applieddate', 'applicationdate', 'dateapplied'],
  area: ['area', 'location', 'section'],
  product: ['product', 'chemical', 'chemicalapplied', 'productname', 'chemicalname'],
  rate: ['rate', 'rateozm', 'ratem', 'rateoza', 'ratea'],
  basis: ['basis', 'ratebasis'],
  target: ['target', 'targetpest', 'pest', 'reason'],
  applicator: ['applicator', 'operator', 'sprayedby', 'sprayer', 'appliedby'],
  tanks: ['tanks', 'numberoftanks', 'tank', 'oftanks'],
}
const BASES = ['oz / M', 'oz / A', 'lbs / M', 'lbs / A', 'gal / M', 'gal / A']
const BASIS_MAP = {}
BASES.forEach((b) => { BASIS_MAP[norm(b)] = b })
function mapBasis(raw) { return BASIS_MAP[norm(raw)] || 'oz / M' }

let _histSeq = 0
const histId = () => `h${Date.now()}_${_histSeq++}`

// Same flat template, but read as PLANNED applications for the Annual Program
// (one row per product). Feeds db.bulkInsertApplications.
export function parseProgramFlat(dataArrayBuffer) {
  const wb = XLSX.read(dataArrayBuffer, { type: 'array' })
  const preferred = wb.SheetNames.find((n) => /history|spray|application|program|plan|log/i.test(n))
  const ws = wb.Sheets[preferred || wb.SheetNames[0]]
  if (!ws) return { apps: [], count: 0, error: 'The file has no sheets.' }
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

  let headerRow = -1
  let col = {}
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = (rows[i] || []).map(norm)
    const m = {}
    cells.forEach((c, idx) => {
      if (!c) return
      for (const [field, toks] of Object.entries(HIST_TOKENS)) {
        if (m[field] == null && toks.includes(c)) { m[field] = idx; break }
      }
    })
    if (m.area != null && m.product != null) { headerRow = i; col = m; break }
  }
  if (headerRow < 0) return { apps: [], count: 0, error: 'Could not find the header row — needs at least Area and Product columns (Date recommended).' }

  const apps = []
  rows.slice(headerRow + 1).forEach((r) => {
    if (!r) return
    const area = col.area != null && r[col.area] != null ? String(r[col.area]).trim() : ''
    const product = col.product != null && r[col.product] != null ? String(r[col.product]).trim() : ''
    if (!area || !product || HEADER_TOKENS.has(norm(product))) return
    const date = col.date != null ? toISODate(r[col.date]) : null
    const basis = col.basis != null ? mapBasis(r[col.basis]) : 'oz / M'
    const rate = col.rate != null && r[col.rate] != null && String(r[col.rate]).trim() !== '' ? Number(r[col.rate]) : null
    const perAcre = /\/\s*A/i.test(basis)
    const target = col.target != null && r[col.target] != null ? String(r[col.target]).trim() : ''
    apps.push({
      area,
      product,
      rateOzM: perAcre ? null : (isFinite(rate) ? rate : null),
      rateOzA: perAcre ? (isFinite(rate) ? rate : null) : null,
      basis,
      type: null,
      target,
      plannedDate: date,
    })
  })
  return { apps, count: apps.length }
}

export function parseSprayHistory(dataArrayBuffer) {
  const wb = XLSX.read(dataArrayBuffer, { type: 'array' })
  const preferred = wb.SheetNames.find((n) => /history|spray|application|log/i.test(n))
  const ws = wb.Sheets[preferred || wb.SheetNames[0]]
  if (!ws) return { sheets: [], count: 0, rowCount: 0, error: 'The file has no sheets.' }
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

  // Find the header row (has date + area + product) and map columns.
  let headerRow = -1
  let col = {}
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = (rows[i] || []).map(norm)
    const m = {}
    cells.forEach((c, idx) => {
      if (!c) return
      for (const [field, toks] of Object.entries(HIST_TOKENS)) {
        if (m[field] == null && toks.includes(c)) { m[field] = idx; break }
      }
    })
    if (m.date != null && m.area != null && m.product != null) { headerRow = i; col = m; break }
  }
  if (headerRow < 0) return { sheets: [], count: 0, rowCount: 0, error: 'Could not find the header row — the top row needs Date, Area and Product columns.' }

  const byEvent = {}
  const order = []
  let rowCount = 0
  rows.slice(headerRow + 1).forEach((r) => {
    if (!r) return
    const rawDate = col.date != null ? r[col.date] : null
    const date = toISODate(rawDate)
    const area = col.area != null && r[col.area] != null ? String(r[col.area]).trim() : ''
    const product = col.product != null && r[col.product] != null ? String(r[col.product]).trim() : ''
    if (!date || !area || !product || HEADER_TOKENS.has(norm(product))) return
    const rate = col.rate != null && r[col.rate] != null && String(r[col.rate]).trim() !== '' ? String(r[col.rate]).trim() : ''
    const basis = col.basis != null ? mapBasis(r[col.basis]) : 'oz / M'
    const target = col.target != null && r[col.target] != null ? String(r[col.target]).trim() : ''
    const applicator = col.applicator != null && r[col.applicator] != null ? String(r[col.applicator]).trim() : ''
    const tanks = col.tanks != null && r[col.tanks] != null && isFinite(Number(r[col.tanks])) ? Number(r[col.tanks]) : 1

    // Group one tank mix per date + area + applicator, so two different sprays
    // on the same area and day (different operators or rigs) stay separate
    // sheets instead of merging into one.
    const key = `${date}||${norm(area)}||${norm(applicator)}`
    if (!byEvent[key]) { byEvent[key] = { date, area, operator: applicator, tanks, products: [], targets: [] }; order.push(key) }
    const ev = byEvent[key]
    ev.products.push({ id: histId(), product, rate, basis, forceGal: false, target })
    if (applicator && !ev.operator) ev.operator = applicator
    if (target && !ev.targets.includes(target)) ev.targets.push(target)
    rowCount++
  })

  const sheets = order.map((k) => {
    const ev = byEvent[k]
    return {
      sheetType: ev.area,
      date: ev.date,
      area: ev.area,
      operator: ev.operator || '',
      status: 'approved',
      directorSig: 'Imported (history)',
      directorDate: `${ev.date}T12:00:00.000Z`,
      tanks: ev.tanks || 1,
      weather: { temp: '', wind: '', humidity: '', windDir: '' },
      products: ev.products,
      targets: ev.targets,
      completed: true,
      completedBy: ev.operator || '',
      completedAt: `${ev.date}T12:00:00.000Z`,
      instructions: '',
      ppe: [],
    }
  })

  const columns = Object.keys(col)
  return { sheets, count: sheets.length, rowCount, columns }
}

// ── Import annotation: canonicalize product names + flag duplicates ──────────
// Run after parseSprayHistory, with the app's current library and sheets.
//  • Rewrites each product name to its canonical library spelling (aliases).
//  • Marks products not found in the library (so the user can add them).
//  • Flags any imported sheet that looks like one already in the app: same area
//    within ±3 days, with ≥50% of its products overlapping. Those default to
//    skip so a re-import inserts nothing.
// Returns the sheets with _dup / _dupOf / _unknown / _skip fields added, plus a
// summary. Pure — no I/O — so it's unit-testable.
const DUP_DAYS = 3
function dayIdx(iso) { return Math.round(Date.parse(iso + 'T00:00:00') / 86400000) }

export function annotateSprayImport(importedSheets = [], existingSheets = [], products = []) {
  const idx = indexProducts(products)
  const canon = (n) => canonicalName(n, idx)

  // Index existing sheets by normalized area for a quick date-window scan.
  const existingByArea = new Map()
  ;(existingSheets || []).forEach((s) => {
    if (!s?.date || !s?.area) return
    const k = norm(s.area)
    if (!existingByArea.has(k)) existingByArea.set(k, [])
    existingByArea.get(k).push({
      di: dayIdx(s.date),
      prods: new Set((s.products || []).map((p) => normName(canon(p.product))).filter(Boolean)),
    })
  })

  let dupCount = 0
  const unknownNames = new Set()

  const sheets = (importedSheets || []).map((sh) => {
    const prods = (sh.products || []).map((p) => {
      const match = idx.get(p.product)
      if (!match) unknownNames.add(p.product)
      return { ...p, product: match ? match.name : p.product, _unknown: !match }
    })
    const mine = new Set(prods.map((p) => normName(p.product)).filter(Boolean))

    // Does an existing sheet cover the same area/day-window with ≥50% overlap?
    let dupOf = null
    const cand = existingByArea.get(norm(sh.area)) || []
    const di = dayIdx(sh.date)
    for (const e of cand) {
      if (Math.abs(e.di - di) > DUP_DAYS) continue
      if (!mine.size) { if (!e.prods.size) { dupOf = e; break } continue }
      let hit = 0
      mine.forEach((n) => { if (e.prods.has(n)) hit++ })
      if (hit / mine.size >= 0.5) { dupOf = e; break }
    }
    const isDup = !!dupOf
    if (isDup) dupCount++
    return { ...sh, products: prods, _dup: isDup, _skip: isDup, _unknown: prods.some((p) => p._unknown) }
  })

  return {
    sheets,
    dupCount,
    newCount: sheets.length - dupCount,
    unknownNames: [...unknownNames].sort(),
  }
}

// ── Top-level: parse an ArrayBuffer (browser) or Buffer (node) ──────────────
export function parseWorkbook(dataArrayBuffer) {
  const wb = XLSX.read(dataArrayBuffer, { type: 'array' })
  const products = parsePesticideList(wb)
  const { applications, areaCounts } = parseAreaPrograms(wb)

  // Which application product names don't match a product we parsed?
  const productNames = new Set(products.map((p) => norm(p.name)))
  const unmatched = [...new Set(
    applications.filter((a) => !productNames.has(norm(a.product))).map((a) => a.product)
  )]

  return { products, applications, areaCounts, unmatched }
}

// ════════════════════════════════════════════════════════════════════════
//  Tournament roster import — a volunteer/crew list from the PGA or a
//  spreadsheet. Header-driven and forgiving; one row per person. Returns
//  partial people (no codes yet — db.addPeople assigns them).
// ════════════════════════════════════════════════════════════════════════
const ROSTER_TOKENS = {
  name: ['name', 'fullname', 'volunteer', 'volunteername', 'person', 'firstlast'],
  firstName: ['first', 'firstname', 'fname', 'givenname'],
  lastName: ['last', 'lastname', 'lname', 'surname', 'familyname'],
  role: ['role', 'type', 'group', 'category'],
  committee: ['committee', 'assignment', 'station', 'job', 'team', 'crew', 'area'],
  shift: ['shift', 'session', 'time', 'wave'],
  phone: ['phone', 'cell', 'mobile', 'phonenumber', 'contact'],
  email: ['email', 'emailaddress', 'mail'],
  org: ['org', 'organization', 'organisation', 'company', 'club', 'affiliation', 'employer'],
  shirt: ['shirt', 'shirtsize', 'size', 'tshirt', 'tshirtsize', 'apparel'],
  emergencyName: ['emergencyname', 'emergencycontact', 'ecname', 'emergency'],
  emergencyPhone: ['emergencyphone', 'ecphone', 'emergencynumber'],
  notes: ['notes', 'note', 'comments', 'comment'],
}

function detectRosterHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = (rows[i] || []).map(norm)
    const m = {}
    cells.forEach((c, idx) => {
      if (!c) return
      for (const [field, toks] of Object.entries(ROSTER_TOKENS)) {
        if (m[field] == null && toks.includes(c)) { m[field] = idx; break }
      }
    })
    if (m.name != null || (m.firstName != null && m.lastName != null)) return { headerRow: i, colMap: m }
  }
  return { headerRow: -1, colMap: {} }
}

const ROSTER_ROLE_MAP = {
  volunteer: 'Volunteer', volunteers: 'Volunteer',
  crew: 'Crew', staff: 'Staff', employee: 'Crew',
  lead: 'Team Lead', teamlead: 'Team Lead', captain: 'Team Lead', chair: 'Team Lead', committeechair: 'Team Lead',
}

export function parseRoster(dataArrayBuffer) {
  const wb = XLSX.read(dataArrayBuffer, { type: 'array' })
  const preferred = wb.SheetNames.find((n) => /roster|volunteer|crew|people|staff|list/i.test(n))
  const ws = wb.Sheets[preferred || wb.SheetNames[0]]
  if (!ws) return { people: [], columns: [], count: 0, error: 'The file has no sheets.' }

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
  const { headerRow, colMap } = detectRosterHeader(rows)
  if (headerRow < 0) return { people: [], columns: [], count: 0, error: 'Could not find a header row — needs a "Name" column (or First + Last).' }

  const people = []
  rows.slice(headerRow + 1).forEach((r) => {
    if (!r) return
    let name = colMap.name != null && r[colMap.name] != null ? String(r[colMap.name]).trim() : ''
    if (!name && colMap.firstName != null) {
      const f = r[colMap.firstName] != null ? String(r[colMap.firstName]).trim() : ''
      const l = colMap.lastName != null && r[colMap.lastName] != null ? String(r[colMap.lastName]).trim() : ''
      name = `${f} ${l}`.trim()
    }
    if (!name || HEADER_TOKENS.has(norm(name))) return

    const get = (f) => (colMap[f] != null && r[colMap[f]] != null ? String(r[colMap[f]]).trim() : '')
    const roleRaw = norm(get('role'))
    const person = {
      name,
      role: ROSTER_ROLE_MAP[roleRaw] || (get('role') ? 'Volunteer' : 'Volunteer'),
      committee: get('committee'),
      shift: get('shift'),
      phone: get('phone'),
      email: get('email'),
      org: get('org'),
      shirt: get('shirt').toUpperCase(),
      emergencyName: get('emergencyName'),
      emergencyPhone: get('emergencyPhone'),
      notes: get('notes'),
    }
    people.push(person)
  })

  const columns = Object.keys(colMap)
  return { people, columns, count: people.length }
}
