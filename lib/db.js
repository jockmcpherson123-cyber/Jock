// Data-access layer for Spray Ops.
//
// This is the replacement for the prototype's `window.storage`. Every function
// here reads or writes the real Supabase database from the browser, using the
// logged-in user's session — so the database's row-level security decides what
// each person is actually allowed to do.
//
// The database stores each entity with a few real columns plus a `data` jsonb
// blob. These functions translate between that shape and the plain objects the
// UI components already expect, so the ported screens barely change.
import { createClient } from '@/lib/supabase/client'
import {
  DEFAULT_AREAS,
  DEFAULT_OPERATORS,
  DEFAULT_DIRECTORS,
  DEFAULT_TARGETS,
  DEFAULT_SHEET_TYPES,
  DEFAULT_COURSE_INFO,
  DEFAULT_GRASS_TYPES,
} from '@/lib/defaults'

const supabase = createClient()

// ── Products (Chemical Library) ─────────────────────────────────────────────
export async function fetchProducts() {
  const { data, error } = await supabase.from('products').select('name, type, data')
  if (error) throw error
  // The full product object lives in `data`; name/type columns are authoritative.
  return (data || []).map((r) => ({ ...r.data, name: r.name, type: r.type }))
}

export async function upsertProduct(product) {
  const { error } = await supabase
    .from('products')
    .upsert(
      { name: product.name, type: product.type, data: product, updated_at: new Date().toISOString() },
      { onConflict: 'name' }
    )
  if (error) throw error
}

export async function deleteProduct(name) {
  const { error } = await supabase.from('products').delete().eq('name', name)
  if (error) throw error
}

// ── Spray sheets ────────────────────────────────────────────────────────────
// Map a database row to the sheet object the UI uses.
function rowToSheet(r) {
  const d = r.data || {}
  return {
    id: r.id,
    sheetType: r.sheet_type,
    date: r.spray_date,
    area: r.area,
    operator: r.operator || '',
    status: r.status,
    directorSig: r.director_sig || '',
    directorDate: r.director_date || '',
    tanks: d.tanks ?? 1,
    weather: d.weather || { temp: '', wind: '', humidity: '', windDir: '' },
    products: d.products || [],
    targets: d.targets || [],
    // Field-workflow flags (live in jsonb — no schema change needed).
    completed: d.completed || false,
    completedAt: d.completedAt || null,
    completedBy: d.completedBy || '',
    instructions: d.instructions || '',
    ppe: d.ppe || [],
    // Optional extra partial-fill spray (gallons). Separate from the main sheet.
    partialGallons: d.partialGallons ?? null,
    // Sign-off: the applicator's drawn signature (data URL) and a snapshot of
    // their license numbers at the time they signed.
    applicatorSignature: d.applicatorSignature || '',
    applicatorPesticideLicense: d.applicatorPesticideLicense || '',
    applicatorFertilizerLicense: d.applicatorFertilizerLicense || '',
    // Director's drawn sign-off signature (data URL).
    directorSignature: d.directorSignature || '',
    // Live field check-off state (synced across iPads): which products are in
    // each tank, keyed by tank number. Migrates the old single-list format.
    tankChecks:
      d.tankChecks ||
      (Array.isArray(d.checkedProducts) && d.checkedProducts.length
        ? { [String(d.currentTank || 1)]: d.checkedProducts }
        : {}),
    createdAt: r.created_at,
  }
}

// Map a UI sheet object to a database row for saving.
function sheetToRow(s) {
  return {
    id: s.id,
    sheet_type: s.sheetType,
    spray_date: s.date || null,
    area: s.area,
    operator: s.operator || null,
    status: s.status,
    director_sig: s.directorSig || null,
    director_date: s.directorDate || null,
    data: {
      tanks: s.tanks,
      weather: s.weather,
      products: s.products,
      targets: s.targets,
      completed: s.completed || false,
      completedAt: s.completedAt || null,
      completedBy: s.completedBy || '',
      instructions: s.instructions || '',
      ppe: s.ppe || [],
      partialGallons: s.partialGallons ?? null,
      tankChecks: s.tankChecks || {},
      applicatorSignature: s.applicatorSignature || '',
      applicatorPesticideLicense: s.applicatorPesticideLicense || '',
      applicatorFertilizerLicense: s.applicatorFertilizerLicense || '',
      directorSignature: s.directorSignature || '',
    },
    updated_at: new Date().toISOString(),
  }
}

export async function fetchSheets() {
  const { data, error } = await supabase
    .from('spray_sheets')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map(rowToSheet)
}

export async function saveSheet(sheet) {
  const { data, error } = await supabase
    .from('spray_sheets')
    .upsert(sheetToRow(sheet), { onConflict: 'id' })
    .select()
    .single()
  if (error) throw error
  return rowToSheet(data)
}

// Update an EXISTING sheet (no insert). This is what the field/live actions use
// so the crew — who can update an approved sheet but not create one — can log
// weather, tick products, change tanks, etc. without an insert-permission error.
export async function updateSheet(sheet) {
  const row = sheetToRow(sheet)
  delete row.id // don't try to change the primary key on update
  const { data, error } = await supabase
    .from('spray_sheets')
    .update(row)
    .eq('id', sheet.id)
    .select()
    .single()
  if (error) throw error
  return rowToSheet(data)
}

// Permanently delete a spray sheet.
export async function deleteSheet(id) {
  const { error } = await supabase.from('spray_sheets').delete().eq('id', id)
  if (error) throw error
}

// Subscribe to live updates for one sheet (multi-iPad collaboration). Calls
// onChange with the fresh sheet whenever anyone updates it. Returns an
// unsubscribe function.
export function subscribeSheet(id, onChange) {
  const channel = supabase
    .channel(`sheet-${id}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'spray_sheets', filter: `id=eq.${id}` },
      (payload) => {
        try {
          onChange(rowToSheet(payload.new))
        } catch (e) {
          console.error('realtime handler failed', e)
        }
      }
    )
    .subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}

// ── Deliveries ──────────────────────────────────────────────────────────────
export async function fetchDeliveries() {
  const { data, error } = await supabase
    .from('deliveries')
    .select('*')
    .order('delivered', { ascending: false })
  if (error) throw error
  return (data || []).map((r) => ({
    id: r.id,
    product: r.product,
    qty: r.qty,
    unit: r.unit,
    supplier: r.supplier || '',
    date: r.delivered,
  }))
}

export async function addDelivery(delivery) {
  const { error } = await supabase.from('deliveries').insert({
    product: delivery.product,
    qty: Number(delivery.qty),
    unit: delivery.unit,
    supplier: delivery.supplier || null,
    delivered: delivery.date || null,
  })
  if (error) throw error
}

// ── Settings ────────────────────────────────────────────────────────────────
export async function fetchSettings() {
  const { data, error } = await supabase.from('app_settings').select('*').eq('id', 1).maybeSingle()
  if (error) throw error
  const DEFAULT_LOCATION = { address: '', lat: null, lng: null, timezone: 'America/New_York' }
  if (!data) {
    // No settings row yet — fall back to the built-in Congressional defaults.
    return {
      areas: DEFAULT_AREAS,
      operators: DEFAULT_OPERATORS,
      directors: DEFAULT_DIRECTORS,
      targets: DEFAULT_TARGETS,
      sheetTypes: DEFAULT_SHEET_TYPES,
      courseInfo: DEFAULT_COURSE_INFO,
      location: DEFAULT_LOCATION,
      grassTypes: DEFAULT_GRASS_TYPES,
      applicatorLicenses: {},
      directorPins: {},
    }
  }
  return {
    areas: data.areas || DEFAULT_AREAS,
    operators: data.operators || DEFAULT_OPERATORS,
    directors: data.directors || DEFAULT_DIRECTORS,
    targets: data.targets || DEFAULT_TARGETS,
    sheetTypes: data.sheet_types || DEFAULT_SHEET_TYPES,
    courseInfo: data.course_info || DEFAULT_COURSE_INFO,
    // `location` may be absent until the Phase 3 migration has been run.
    location: data.location && Object.keys(data.location).length ? data.location : DEFAULT_LOCATION,
    // `grass_types` may be absent until the Phase 6 migration has been run.
    grassTypes: data.grass_types && data.grass_types.length ? data.grass_types : DEFAULT_GRASS_TYPES,
    // `applicator_licenses` may be absent until the Phase 7 migration has been run.
    applicatorLicenses: data.applicator_licenses || {},
    // `director_pins` may be absent until the Phase 8 migration has been run.
    directorPins: data.director_pins || {},
  }
}

// Persist one or more settings sections. `patch` uses the same camelCase keys
// the UI uses; we translate the two that differ to their column names.
export async function saveSettings(patch) {
  const row = { id: 1, updated_at: new Date().toISOString() }
  if (patch.areas !== undefined) row.areas = patch.areas
  if (patch.operators !== undefined) row.operators = patch.operators
  if (patch.directors !== undefined) row.directors = patch.directors
  if (patch.targets !== undefined) row.targets = patch.targets
  if (patch.sheetTypes !== undefined) row.sheet_types = patch.sheetTypes
  if (patch.courseInfo !== undefined) row.course_info = patch.courseInfo
  if (patch.location !== undefined) row.location = patch.location
  if (patch.grassTypes !== undefined) row.grass_types = patch.grassTypes
  if (patch.applicatorLicenses !== undefined) row.applicator_licenses = patch.applicatorLicenses
  if (patch.directorPins !== undefined) row.director_pins = patch.directorPins
  const { error } = await supabase.from('app_settings').upsert(row, { onConflict: 'id' })
  if (error) throw error
}

// ── Annual Program: season programs ─────────────────────────────────────────
export async function fetchPrograms() {
  const { data, error } = await supabase
    .from('season_programs')
    .select('*')
    .order('year', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createProgram({ year, name, status = 'active' }) {
  const { data, error } = await supabase
    .from('season_programs')
    .insert({ year, name, status })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateProgram(id, { year, name }) {
  const patch = {}
  if (year !== undefined) patch.year = year
  if (name !== undefined) patch.name = name
  const { data, error } = await supabase
    .from('season_programs')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteProgram(id) {
  // Cascades to its applications.
  const { error } = await supabase.from('season_programs').delete().eq('id', id)
  if (error) throw error
}

// ── Annual Program: applications ────────────────────────────────────────────
function rowToApplication(r) {
  return {
    id: r.id,
    programId: r.program_id,
    area: r.area,
    product: r.product,
    rateOzM: r.rate_oz_m,
    rateOzA: r.rate_oz_a,
    basis: r.basis || 'oz / M',
    type: r.type,
    target: r.target || '',
    plannedDate: r.planned_date,
    templateDate: r.template_date,
    linkedSheetId: r.linked_sheet_id,
  }
}

export async function fetchApplications(programId) {
  const { data, error } = await supabase
    .from('program_applications')
    .select('*')
    .eq('program_id', programId)
    .order('planned_date', { ascending: true })
  if (error) throw error
  return (data || []).map(rowToApplication)
}

// Insert many applications at once (used by the Excel importer). Chunked to
// stay well within request limits.
export async function bulkInsertApplications(programId, apps) {
  const rows = apps.map((a) => ({
    program_id: programId,
    area: a.area,
    product: a.product,
    rate_oz_m: a.rateOzM ?? null,
    rate_oz_a: a.rateOzA ?? null,
    basis: a.basis || 'oz / M',
    type: a.type || null,
    target: a.target || null,
    planned_date: a.plannedDate || null,
    template_date: a.templateDate || null,
  }))
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from('program_applications').insert(rows.slice(i, i + CHUNK))
    if (error) throw error
  }
}

// Create, update or delete a single planned application.
export async function upsertApplication(app) {
  const row = {
    program_id: app.programId,
    area: app.area || null,
    product: app.product || null,
    rate_oz_m: app.rateOzM ?? null,
    rate_oz_a: app.rateOzA ?? null,
    basis: app.basis || 'oz / M',
    type: app.type || null,
    target: app.target || null,
    planned_date: app.plannedDate || null,
    template_date: app.templateDate || null,
  }
  if (app.id) row.id = app.id
  const { data, error } = await supabase
    .from('program_applications')
    .upsert(row, { onConflict: 'id' })
    .select()
    .single()
  if (error) throw error
  return rowToApplication(data)
}

export async function deleteApplication(id) {
  const { error } = await supabase.from('program_applications').delete().eq('id', id)
  if (error) throw error
}

// Mark planned applications as executed by linking them to the spray sheet they
// produced, so they drop off the "still to do" list.
export async function markApplicationsLinked(ids, sheetId) {
  if (!ids || ids.length === 0) return
  const { error } = await supabase
    .from('program_applications')
    .update({ linked_sheet_id: sheetId })
    .in('id', ids)
  if (error) throw error
}

// Roll a whole program forward: create a new program and copy every application
// into it with each planned date shifted by `shiftDays`. The old planned date
// becomes the new template date, so the sequence/intervals are preserved.
export async function copyProgram(sourceProgramId, { year, name, shiftDays = 0 }) {
  const prog = await createProgram({ year, name })
  const source = await fetchApplications(sourceProgramId)
  const shift = (iso) => {
    if (!iso) return null
    const d = new Date(iso + 'T00:00:00')
    d.setDate(d.getDate() + Number(shiftDays))
    return d.toISOString().slice(0, 10)
  }
  const copies = source.map((a) => ({
    ...a,
    plannedDate: shift(a.plannedDate),
    templateDate: a.plannedDate || a.templateDate,
  }))
  await bulkInsertApplications(prog.id, copies)
  return prog
}

// Upsert many products at once (used by the Excel importer). Preserves stock on
// products that already exist by merging onto the current row's data.
export async function bulkUpsertProducts(products) {
  // Fetch existing so an import doesn't wipe stock/thresholds already set.
  const existing = await fetchProducts()
  const byName = new Map(existing.map((p) => [p.name, p]))
  const rows = products.map((p) => {
    const prev = byName.get(p.name)
    // Keep existing stock/threshold/rate if the import doesn't provide them.
    const merged = prev
      ? { ...p, stock: prev.stock ?? 0, lowStockThreshold: prev.lowStockThreshold ?? 0, rate: p.rate ?? prev.rate ?? null }
      : p
    return { name: merged.name, type: merged.type, data: merged, updated_at: new Date().toISOString() }
  })
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from('products').upsert(rows.slice(i, i + CHUNK), { onConflict: 'name' })
    if (error) throw error
  }
}

// Import products from a user's spreadsheet into the Chemical Library. Each
// partial holds ONLY the fields the sheet actually provided; those overwrite,
// and every field left out of the sheet is preserved from the existing product.
// New products get sensible defaults. Returns { added, updated }.
export async function importProducts(partials) {
  const existing = await fetchProducts()
  const byName = new Map(existing.map((p) => [p.name, p]))
  let added = 0
  let updated = 0
  const rows = partials.map((partial) => {
    const prev = byName.get(partial.name)
    if (prev) updated++
    else added++
    const merged = { ...(prev || {}), ...partial }
    if (!merged.type) merged.type = 'Fungicide'
    merged.stock = merged.stock ?? 0
    merged.lowStockThreshold = merged.lowStockThreshold ?? 0
    return { name: merged.name, type: merged.type, data: merged, updated_at: new Date().toISOString() }
  })
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from('products').upsert(rows.slice(i, i + CHUNK), { onConflict: 'name' })
    if (error) throw error
  }
  return { added, updated }
}
