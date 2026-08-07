// Congressional Country Club starter data, carried over verbatim from the
// prototype. These are used to seed the database the first time (see
// supabase/phase1.sql) so the app is useful on day one. Everything here is
// fully editable in the app afterwards — nothing is hardcoded in production.

// Units a product's stock can be tracked in, and that deliveries can be logged
// in. Volume and weight units auto-convert within their own family (see
// lib/calc.js convertUnits). "oz" here means fluid ounce, matching the spray math.
export const UNITS = ['oz', 'fl oz', 'pt', 'qt', 'gal', 'ml', 'L', 'lbs', 'kg', 'g']

export const PRODUCT_TYPES = [
  'Fungicide',
  'Herbicide',
  'Insecticide',
  'Growth Reg',
  'Biological',
  'Wetting Agent',
  'Fertilizer',
]

// ── Tank-mix fill order ──────────────────────────────────────────────────────
// Products go into the tank by FORMULATION, in the accepted "jar test" sequence:
// dry products first, then flowables, solubles, emulsifiables, nutrients, and
// surfactants/adjuvants last. Each product carries a `formulation` id; sheets and
// the planner sort by this so the crew fills the tank in the right order.
export const FORMULATIONS = [
  { id: 'conditioner', label: 'Water conditioner / compatibility agent', short: 'Conditioner' },
  { id: 'dry', label: 'Dry — WP / WDG / DF (wettable powder or granule)', short: 'Dry (WDG/WP)' },
  { id: 'wsp', label: 'Water-soluble packet (WSP)', short: 'Soluble packet' },
  { id: 'flowable', label: 'Flowable / SC (suspension concentrate)', short: 'Flowable (SC)' },
  { id: 'soluble', label: 'Soluble liquid (SL)', short: 'Soluble liquid (SL)' },
  { id: 'ec', label: 'Emulsifiable concentrate (EC)', short: 'Emulsifiable (EC)' },
  { id: 'fertilizer', label: 'Soluble / liquid fertilizer, micros', short: 'Fertilizer / micros' },
  { id: 'adjuvant', label: 'Surfactant / adjuvant / oil (goes in last)', short: 'Adjuvant' },
  { id: 'other', label: 'Other / not sure', short: 'Other' },
]
// Default fill sequence (top → bottom). Editable later via courseInfo.mixOrder.
export const DEFAULT_MIX_ORDER = ['conditioner', 'dry', 'wsp', 'flowable', 'soluble', 'ec', 'fertilizer', 'adjuvant', 'other']
export const FORMULATION_LABEL = Object.fromEntries(FORMULATIONS.map((f) => [f.id, f.short]))

// Best-guess a product's formulation from its type and name, so existing
// products slot into the mix order without anyone tagging them by hand.
export function guessFormulation(product = {}) {
  const type = String(product.type || '').toLowerCase()
  const n = ` ${String(product.name || '').toLowerCase()} `
  if (type.includes('fert')) return 'fertilizer'
  if (type.includes('wetting') || /\b(surfactant|adjuvant|oil|nis|mso)\b/.test(n)) return 'adjuvant'
  if (/\b(wdg|wg|dg|df|wp|wsp)\b/.test(n) || n.includes('wettable') || n.includes('granul')) return n.includes('wsp') || n.includes('packet') ? 'wsp' : 'dry'
  if (/\bec\b/.test(n) || n.includes('emulsifiable')) return 'ec'
  if (/\b(sc|fl|f)\b/.test(n) || n.includes('flowable')) return 'flowable'
  if (/\bsl\b/.test(n) || n.includes('soluble')) return 'soluble'
  return 'other'
}
// The formulation to use for sorting — the product's saved tag, or a guess.
export function effectiveFormulation(product = {}) {
  return product.formulation || guessFormulation(product)
}
export function mixRank(formId, order = DEFAULT_MIX_ORDER) {
  const i = order.indexOf(formId || 'other')
  return i === -1 ? order.length : i
}
// Stable sort of items into tank-fill order. `getProduct(item)` returns the
// library product (for its formulation); ties keep their original order.
export function sortByMixOrder(items, getProduct, order = DEFAULT_MIX_ORDER) {
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => (mixRank(effectiveFormulation(getProduct(a.it)), order) - mixRank(effectiveFormulation(getProduct(b.it)), order)) || (a.i - b.i))
    .map((x) => x.it)
}

export const DEFAULT_PRODUCTS = [
  { name: 'Ascernity', type: 'Fungicide', rate: 1.0, basis: 'oz / M', unit: 'oz', labelMaxM: 1.2, labelMaxA: null, labelMinM: 0.8, labelMinA: null, stock: 0, lowStockThreshold: 0 },
  { name: 'Azoxy D', type: 'Fungicide', rate: 0.65, basis: 'oz / M', unit: 'oz', labelMaxM: 0.8, labelMaxA: null, labelMinM: null, labelMinA: null, stock: 0, lowStockThreshold: 0 },
  { name: 'Banol', type: 'Fungicide', rate: 1.0, basis: 'oz / M', unit: 'oz', labelMaxM: 1.5, labelMaxA: null, labelMinM: null, labelMinA: null, stock: 0, lowStockThreshold: 0 },
  { name: 'Daconil Action', type: 'Fungicide', rate: 1.8, basis: 'oz / M', unit: 'oz', labelMaxM: 3.6, labelMaxA: null, labelMinM: 1.8, labelMinA: null, stock: 0, lowStockThreshold: 0 },
  { name: 'Daconil ZN', type: 'Fungicide', rate: 3.2, basis: 'oz / M', unit: 'oz', labelMaxM: 5.5, labelMaxA: null, labelMinM: null, labelMinA: null, stock: 0, lowStockThreshold: 0 },
  { name: 'Heritage TL', type: 'Fungicide', rate: 2.0, basis: 'oz / M', unit: 'oz', labelMaxM: 2.0, labelMaxA: null, labelMinM: null, labelMinA: null, stock: 0, lowStockThreshold: 0 },
  { name: 'Insignia SC', type: 'Fungicide', rate: 0.71, basis: 'oz / M', unit: 'oz', labelMaxM: 0.9, labelMaxA: null, labelMinM: null, labelMinA: null, stock: 0, lowStockThreshold: 0 },
  { name: 'Secure Action', type: 'Fungicide', rate: 0.5, basis: 'oz / M', unit: 'oz', labelMaxM: 0.5, labelMaxA: null, labelMinM: null, labelMinA: null, stock: 0, lowStockThreshold: 0 },
  { name: 'Subdue Maxx', type: 'Fungicide', rate: 0.7, basis: 'oz / M', unit: 'oz', labelMaxM: 1.0, labelMaxA: null, labelMinM: null, labelMinA: null, stock: 0, lowStockThreshold: 0 },
  { name: 'Velista', type: 'Fungicide', rate: 0.4, basis: 'lbs / M', unit: 'lbs', labelMaxM: 0.5, labelMaxA: null, labelMinM: null, labelMinA: null, stock: 0, lowStockThreshold: 0 },
  { name: 'Acclaim Extra', type: 'Herbicide', rate: 3.5, basis: 'oz / A', unit: 'oz', labelMaxM: null, labelMaxA: 4.5, labelMinM: null, labelMinA: null, stock: 0, lowStockThreshold: 0 },
  { name: 'Arkon', type: 'Herbicide', rate: 65.0, basis: 'oz / A', unit: 'oz', labelMaxM: null, labelMaxA: 87, labelMinM: null, labelMinA: null, stock: 0, lowStockThreshold: 0 },
  { name: 'Confront', type: 'Herbicide', rate: 16.0, basis: 'oz / A', unit: 'oz', labelMaxM: null, labelMaxA: 24, labelMinM: null, labelMinA: null, stock: 0, lowStockThreshold: 0 },
  { name: 'Tenacity', type: 'Herbicide', rate: 4.0, basis: 'oz / A', unit: 'oz', labelMaxM: null, labelMaxA: 8, labelMinM: null, labelMinA: 4, stock: 0, lowStockThreshold: 0 },
  { name: 'Acelepryn', type: 'Insecticide', rate: 8.0, basis: 'oz / A', unit: 'oz', labelMaxM: null, labelMaxA: 12, labelMinM: null, labelMinA: 8, stock: 0, lowStockThreshold: 0 },
  { name: 'Scimitar', type: 'Insecticide', rate: 10.0, basis: 'oz / A', unit: 'oz', labelMaxM: null, labelMaxA: 14, labelMinM: null, labelMinA: null, stock: 0, lowStockThreshold: 0 },
  { name: 'Anuew', type: 'Growth Reg', rate: 2.0, basis: 'lbs / A', unit: 'lbs', labelMaxM: null, labelMaxA: 2.6, labelMinM: null, labelMinA: null, stock: 0, lowStockThreshold: 0 },
  { name: 'Primo MAXX', type: 'Growth Reg', rate: 8.0, basis: 'oz / A', unit: 'oz', labelMaxM: null, labelMaxA: 16, labelMinM: null, labelMinA: 4, stock: 0, lowStockThreshold: 0 },
  { name: 'Earthworks Kick', type: 'Biological', rate: 8.19, basis: 'oz / M', unit: 'oz', labelMaxM: null, labelMaxA: null, labelMinM: null, labelMinA: null, stock: 0, lowStockThreshold: 0 },
  { name: 'Hydra-Cal', type: 'Biological', rate: 1.78, basis: 'oz / M', unit: 'oz', labelMaxM: null, labelMaxA: null, labelMinM: null, labelMinA: null, stock: 0, lowStockThreshold: 0 },
  { name: 'Hydra-Kace 0-0-29', type: 'Biological', rate: 1.78, basis: 'oz / M', unit: 'oz', labelMaxM: null, labelMaxA: null, labelMinM: null, labelMinA: null, stock: 0, lowStockThreshold: 0 },
  { name: 'Hydra-Mn Combo', type: 'Biological', rate: 1.78, basis: 'oz / M', unit: 'oz', labelMaxM: null, labelMaxA: null, labelMinM: null, labelMinA: null, stock: 0, lowStockThreshold: 0 },
  { name: 'Protein Plus', type: 'Biological', rate: 5.0, basis: 'oz / M', unit: 'oz', labelMaxM: null, labelMaxA: null, labelMinM: null, labelMinA: null, stock: 0, lowStockThreshold: 0 },
  { name: 'Cascade Plus', type: 'Wetting Agent', rate: 4.0, basis: 'oz / M', unit: 'oz', labelMaxM: null, labelMaxA: null, labelMinM: null, labelMinA: null, stock: 0, lowStockThreshold: 0 },
  { name: '21-0-0 Ammonium Sulfate', type: 'Fertilizer', rate: null, basis: 'lbs / M', unit: 'lbs', labelMaxM: null, labelMaxA: null, labelMinM: null, labelMinA: null, stock: 0, lowStockThreshold: 0 },
  { name: '46-0-0 Urea', type: 'Fertilizer', rate: null, basis: 'lbs / M', unit: 'lbs', labelMaxM: null, labelMaxA: null, labelMinM: null, labelMinA: null, stock: 0, lowStockThreshold: 0 },
]

export const DEFAULT_AREAS = {
  'Blue Greens SprayBug 1.67gpm': { gear: 'Spray Bug 2.6 MPH', psi: '~45 PSI', tanks: 1, galTank: 300, sprayRate: 1.67, nozzle: 'Blue Nozzle', sqft: 179640 },
  'Blue Fairways HD300': { gear: '2nd Gear, 5.0 MPH', psi: '~45 PSI', tanks: 6, galTank: 300, sprayRate: 44, nozzle: 'White Nozzle', sqft: 300000 },
  'Blue Rough HD300': { gear: '2nd Gear, 5.0 MPH', psi: '~45 PSI', tanks: 8, galTank: 300, sprayRate: 44, nozzle: 'White Nozzle', sqft: 300000 },
  'Gold Greens HD200': { gear: '1st Gear, 3.5 MPH', psi: '~45 PSI', tanks: 2, galTank: 150, sprayRate: 78.41, nozzle: 'Light Blue Nozzle', sqft: 83333 },
  'Gold Greens SprayBug 1.67gpm': { gear: 'Spray Bug 2.6 MPH', psi: '41 PSI', tanks: 1, galTank: 250, sprayRate: 1.67, nozzle: 'Blue Nozzle', sqft: 149700 },
  'Gold Fairways and Tees HD300': { gear: '2nd Gear, 5.0 MPH', psi: '~45 PSI', tanks: 4, galTank: 300, sprayRate: 44, nozzle: 'White Nozzle', sqft: 300000 },
  'Gold Intermediate HD300': { gear: '2nd Gear, 5.0 MPH', psi: '~45 PSI', tanks: 1, galTank: 300, sprayRate: 44, nozzle: 'White Nozzle', sqft: 300000 },
  'Gold Rough HD300': { gear: '2nd Gear, 5.0 MPH', psi: '~45 PSI', tanks: 9, galTank: 300, sprayRate: 44, nozzle: 'White Nozzle', sqft: 300000 },
  'Driving Range HD300': { gear: '2nd Gear, 5.0 MPH', psi: '~45 PSI', tanks: 1, galTank: 200, sprayRate: 44, nozzle: 'White Nozzle', sqft: 200000 },
}

export const DEFAULT_OPERATORS = ['Ryan Geils', 'Kevin Johnson', 'Jock McPherson', 'Mitch Penn', 'Kyle Zumwinkel', 'Mark Gates', 'Josh Muldowney', 'Mitchell Vesper']
export const DEFAULT_DIRECTORS = ['Mark Gates', 'Ryan Geils', 'Kevin Johnson']
export const DEFAULT_TARGETS = [
  // Diseases
  'Dollar Spot', 'Brown Patch', 'Pythium', 'Anthracnose', 'Fairy Ring',
  'Gray Leaf Spot', 'Summer Patch', 'Take-all Patch', 'Snow Mold', 'Red Thread',
  'Rust', 'Leaf Spot / Melting Out', 'Preventative Fungicide',
  // Weeds
  'Poa Annua', 'Crabgrass', 'Goosegrass', 'Nutsedge', 'Broadleaf Weeds',
  // Insects
  'Grubs', 'Annual Bluegrass Weevil', 'Cutworms', 'Chinch Bugs', 'Nematodes',
  // Growth / cultural / other
  'Growth Regulation', 'Seedhead Suppression', 'Nutrition', 'Iron / Color', 'Wetting Agent / Dry Spot',
]
export const DEFAULT_SHEET_TYPES = ['Greens Spray', 'Fairway Spray', 'Intermediate Spray', 'Rough Spray']
export const DEFAULT_COURSE_INFO = { clubName: 'Congressional Country Club', deptName: 'Golf Maintenance' }
export const DEFAULT_GRASS_TYPES = ['Bentgrass', 'Poa Annua', 'Perennial Ryegrass', 'Kentucky Bluegrass', 'Tall Fescue', 'Fine Fescue', 'Bermudagrass', 'Zoysiagrass']
export const DEFAULT_SOIL_TYPES = ['Sand-based', 'Native/Push-up', 'Sandy Loam', 'Loam', 'Clay Loam', 'Clay']
