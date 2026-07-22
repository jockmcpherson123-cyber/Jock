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
