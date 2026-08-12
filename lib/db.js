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
  DEFAULT_SOIL_TYPES,
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
    // How many partial-fill gallons have already been pulled from inventory, so
    // editing the partial only deducts the difference (never double-counts).
    partialStockDeducted: d.partialStockDeducted ?? 0,
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
      partialStockDeducted: s.partialStockDeducted ?? 0,
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

// ── Clipping yields ──────────────────────────────────────────────────────────
function rowToClipping(r) {
  return { id: r.id, area: r.area, date: r.clip_date, volume: r.volume, unit: r.unit || 'L', notes: r.notes || '', createdAt: r.created_at }
}

export async function fetchClippings() {
  const { data, error } = await supabase.from('clippings').select('*').order('clip_date', { ascending: false })
  if (error) throw error
  return (data || []).map(rowToClipping)
}

export async function addClipping(c) {
  const { data, error } = await supabase
    .from('clippings')
    .insert({ area: c.area, clip_date: c.date, volume: c.volume ?? null, unit: c.unit || 'L', notes: c.notes || '' })
    .select()
    .single()
  if (error) throw error
  return rowToClipping(data)
}

// Log several greens at once (same date/unit, per-green volume).
export async function addClippings(list) {
  const rows = list.map((c) => ({ area: c.area, clip_date: c.date, volume: c.volume ?? null, unit: c.unit || 'L', notes: c.notes || '' }))
  const { error } = await supabase.from('clippings').insert(rows)
  if (error) throw error
}

export async function deleteClipping(id) {
  const { error } = await supabase.from('clippings').delete().eq('id', id)
  if (error) throw error
}

// ── Cultural practices (mow / roll / topdress / aerify …) ────────────────────
function rowToPractice(r) {
  return { id: r.id, area: r.area, practice: r.practice, date: r.practice_date, value: r.value, unit: r.unit || '', notes: r.notes || '', createdAt: r.created_at }
}

export async function fetchCulturalPractices() {
  const { data, error } = await supabase.from('cultural_practices').select('*').order('practice_date', { ascending: false })
  if (error) throw error
  return (data || []).map(rowToPractice)
}

// Log a practice across several areas at once (same practice/date/value).
export async function addCulturalPractices(list) {
  const rows = list.map((c) => ({
    area: c.area, practice: c.practice, practice_date: c.date,
    value: c.value ?? null, unit: c.unit || '', notes: c.notes || '',
  }))
  const { error } = await supabase.from('cultural_practices').insert(rows)
  if (error) throw error
}

export async function deleteCulturalPractice(id) {
  const { error } = await supabase.from('cultural_practices').delete().eq('id', id)
  if (error) throw error
}

// ── Greens speed (Stimpmeter) ────────────────────────────────────────────────
function rowToSpeed(r) {
  return { id: r.id, area: r.area, date: r.reading_date, speed: r.speed, notes: r.notes || '', createdAt: r.created_at }
}

export async function fetchGreensSpeeds() {
  const { data, error } = await supabase.from('greens_speeds').select('*').order('reading_date', { ascending: false })
  if (error) throw error
  return (data || []).map(rowToSpeed)
}

// Log several greens at once (same date, per-green speed in feet).
export async function addGreensSpeeds(list) {
  const rows = list.map((c) => ({ area: c.area, reading_date: c.date, speed: c.speed ?? null, notes: c.notes || '' }))
  const { error } = await supabase.from('greens_speeds').insert(rows)
  if (error) throw error
}

export async function deleteGreensSpeed(id) {
  const { error } = await supabase.from('greens_speeds').delete().eq('id', id)
  if (error) throw error
}

// ── Scouting log (photo observations) ────────────────────────────────────────
function rowToScout(r) {
  return { id: r.id, area: r.area || '', date: r.observed_date, kind: r.kind || 'Other', target: r.target || '', severity: r.severity || '', notes: r.notes || '', photo: r.photo || '', createdAt: r.created_at }
}
export async function fetchScouting() {
  const { data, error } = await supabase.from('scouting').select('*').order('observed_date', { ascending: false })
  if (error) throw error
  return (data || []).map(rowToScout)
}
export async function addScouting(s) {
  const row = { area: s.area || '', observed_date: s.date, kind: s.kind || 'Other', target: s.target || '', severity: s.severity || '', notes: s.notes || '', photo: s.photo || '' }
  const { data, error } = await supabase.from('scouting').insert(row).select().single()
  if (error) throw error
  return rowToScout(data)
}
export async function deleteScouting(id) {
  const { error } = await supabase.from('scouting').delete().eq('id', id)
  if (error) throw error
}

// ── Irrigation features (editable heads/valves on the Course Map) ─────────────
function rowToFeature(r) {
  return {
    id: r.id, kind: r.kind || 'head', lat: r.lat, lng: r.lng, label: r.label || '',
    zone: r.zone || '', size: r.size || '', status: r.status || 'ok', notes: r.notes || '',
    photo: r.photo || '', source: r.source || 'manual', symbol: r.symbol || '',
    arc: r.arc ?? null, arcStart: r.arc_start ?? null, radius: r.radius ?? null,
    createdAt: r.created_at,
  }
}
export async function fetchIrrigation() {
  // Supabase caps a single select at 1,000 rows — there can be thousands of
  // heads, so page through with .range() until we've got them all.
  const all = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('irrigation_features').select('*')
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    all.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return all.map(rowToFeature)
}
export async function addIrrigationFeature(f) {
  const row = {
    kind: f.kind || 'head', lat: f.lat, lng: f.lng, label: f.label || '', zone: f.zone || '',
    size: f.size || '', status: f.status || 'ok', notes: f.notes || '', photo: f.photo || '', source: f.source || 'manual',
  }
  if (f.symbol) row.symbol = f.symbol
  let res = await supabase.from('irrigation_features').insert(row).select().single()
  if (res.error && /symbol/.test(res.error.message || '')) { // phase23 not run yet
    delete row.symbol
    res = await supabase.from('irrigation_features').insert(row).select().single()
  }
  if (res.error) throw res.error
  return rowToFeature(res.data)
}
// Bulk-add many features (e.g. importing the as-built) in batches.
export async function addIrrigationFeatures(list) {
  const rows = (list || []).map((f) => ({
    kind: f.kind || 'head', lat: f.lat, lng: f.lng, label: f.label || '', zone: f.zone || '',
    size: f.size || '', status: f.status || 'ok', notes: f.notes || '', photo: '', source: f.source || 'import',
    symbol: f.symbol || '',
  }))
  // Drop the symbol column up-front if phase23 hasn't been run (detected on the
  // first chunk), so imports still work on an un-migrated database.
  let stripSymbol = false
  let inserted = 0
  for (let i = 0; i < rows.length; i += 500) {
    let chunk = rows.slice(i, i + 500)
    if (stripSymbol) chunk = chunk.map(({ symbol, ...r }) => r)
    let { error } = await supabase.from('irrigation_features').insert(chunk)
    if (error && /symbol/.test(error.message || '')) {
      stripSymbol = true
      chunk = chunk.map(({ symbol, ...r }) => r)
      ;({ error } = await supabase.from('irrigation_features').insert(chunk))
    }
    if (error) throw error
    inserted += chunk.length
  }
  return inserted
}
export async function updateIrrigationFeature(id, patch) {
  const row = { updated_at: new Date().toISOString() }
  ;['kind', 'lat', 'lng', 'label', 'zone', 'size', 'status', 'notes', 'photo', 'source', 'symbol'].forEach((k) => { if (patch[k] !== undefined) row[k] = patch[k] })
  // arc / radius ship in phase22, symbol in phase23 — strip and retry if those
  // columns aren't there yet.
  if (patch.arc !== undefined) row.arc = patch.arc
  if (patch.arcStart !== undefined) row.arc_start = patch.arcStart
  if (patch.radius !== undefined) row.radius = patch.radius
  let res = await supabase.from('irrigation_features').update(row).eq('id', id).select().single()
  if (res.error && /arc|radius|symbol/.test(res.error.message || '')) {
    delete row.arc; delete row.arc_start; delete row.radius; delete row.symbol
    res = await supabase.from('irrigation_features').update(row).eq('id', id).select().single()
  }
  if (res.error) throw res.error
  return rowToFeature(res.data)
}
export async function deleteIrrigationFeature(id) {
  const { error } = await supabase.from('irrigation_features').delete().eq('id', id)
  if (error) throw error
}
// Remove only the auto-imported (untouched) features — so a re-import refreshes
// them without wiping heads you placed or hand-edited (those become 'manual').
export async function clearImportedIrrigation() {
  const { error } = await supabase.from('irrigation_features').delete().eq('source', 'import')
  if (error) throw error
}

// ── Crew whiteboard (daily jobs) ─────────────────────────────────────────────
function rowToTask(r) {
  return {
    id: r.id, date: r.task_date, job: r.job, area: r.area || '', assignee: r.assignee || '',
    equipment: r.equipment || '', course: r.course || '', status: r.status || 'todo',
    minutes: r.minutes ?? null, sort: r.sort ?? 0, notes: r.notes || '', groupNote: r.group_note || '', slot: r.slot || '1', createdAt: r.created_at,
  }
}
function taskToRow(t) {
  return {
    task_date: t.date, job: t.job, area: t.area || '', assignee: t.assignee || '',
    equipment: t.equipment || '', course: t.course || '', status: t.status || 'todo',
    minutes: t.minutes === '' || t.minutes == null ? null : Number(t.minutes),
    sort: t.sort ?? 0, notes: t.notes || '', group_note: t.groupNote || '', slot: t.slot || '1',
  }
}
// Optional columns that ship in later migrations — `slot` (phase16, 1st/2nd/3rd
// jobs) and `group_note` (phase17, whole-crew note). Until a migration is run,
// its column is missing, so a write that names it errors; we strip just that
// column and retry, so everything keeps working (that field simply doesn't
// persist until the SQL is run).
const OPTIONAL_COLS = ['slot', 'group_note']
const badCol = (e) => (e ? OPTIONAL_COLS.find((c) => new RegExp(`\\b${c}\\b`, 'i').test(e.message || '')) : null)
const stripCol = (row, c) => (Array.isArray(row) ? row.map((r) => stripCol(r, c)) : (() => { const { [c]: _, ...rest } = row; return rest })())
// Run a Supabase write, retrying with the offending optional column stripped
// (up to the number of optional columns) whenever the column doesn't exist yet.
async function resilientWrite(run, row) {
  let res = await run(row)
  let guard = OPTIONAL_COLS.length
  while (res.error && badCol(res.error) && guard-- > 0) {
    row = stripCol(row, badCol(res.error))
    res = await run(row)
  }
  return res
}

// Fetch tasks, optionally within a [from, to] date window (YYYY-MM-DD). No window
// returns everything — fine for the board; the trend views pass a range.
export async function fetchCrewTasks(from, to) {
  let q = supabase.from('crew_tasks').select('*')
  if (from) q = q.gte('task_date', from)
  if (to) q = q.lte('task_date', to)
  const { data, error } = await q.order('task_date', { ascending: false }).order('sort', { ascending: true })
  if (error) throw error
  return (data || []).map(rowToTask)
}

export async function addCrewTask(t) {
  const { data, error } = await resilientWrite((row) => supabase.from('crew_tasks').insert(row).select().single(), taskToRow(t))
  if (error) throw error
  return rowToTask(data)
}

export async function addCrewTasks(list) {
  const { error } = await resilientWrite((rows) => supabase.from('crew_tasks').insert(rows), list.map(taskToRow))
  if (error) throw error
}

export async function updateCrewTask(t) {
  const { data, error } = await resilientWrite((row) => supabase.from('crew_tasks').update(row).eq('id', t.id).select().single(), taskToRow(t))
  if (error) throw error
  return rowToTask(data)
}

export async function deleteCrewTask(id) {
  const { error } = await supabase.from('crew_tasks').delete().eq('id', id)
  if (error) throw error
}

// ── Soil tests ───────────────────────────────────────────────────────────────
function rowToSoilTest(r) {
  const extras = r.extras || {}
  return {
    id: r.id, area: r.area, date: r.test_date,
    ph: r.ph, bufferPh: r.buffer_ph, om: r.om_pct, cec: r.cec,
    p: r.p_ppm, k: r.k_ppm, ca: r.ca_ppm, mg: r.mg_ppm, s: r.s_ppm,
    annualN: r.annual_n, lab: r.lab || '', notes: r.notes || '',
    // The course this test was filed under (chosen at save time). Empty for
    // practice/other and for legacy tests saved before course-stamping.
    course: extras.course || '',
    // Grass + soil context is captured on the test itself, so a per-green test
    // (not tied to a settings area) still gets a variety/soil-aware plan.
    grasses: extras.grasses || [], soilType: extras.soilType || '',
    // Sodium + micronutrients ride in extras (record-keeping, not MLSN inputs).
    na: extras.na ?? null,
    micros: { fe: extras.fe ?? null, mn: extras.mn ?? null, cu: extras.cu ?? null, zn: extras.zn ?? null, b: extras.b ?? null },
    baseSat: extras.baseSat || {},
    extras, createdAt: r.created_at,
  }
}

export async function fetchSoilTests() {
  const { data, error } = await supabase.from('soil_tests').select('*').order('test_date', { ascending: false })
  if (error) throw error
  return (data || []).map(rowToSoilTest)
}

const numOrNull = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v))

function soilTestFields(t) {
  return {
    area: t.area, test_date: t.date,
    ph: numOrNull(t.ph), buffer_ph: numOrNull(t.bufferPh), om_pct: numOrNull(t.om), cec: numOrNull(t.cec),
    p_ppm: numOrNull(t.p), k_ppm: numOrNull(t.k), ca_ppm: numOrNull(t.ca), mg_ppm: numOrNull(t.mg), s_ppm: numOrNull(t.s),
    annual_n: numOrNull(t.annualN), lab: t.lab || '', notes: t.notes || '',
    extras: { ...(t.extras || {}), grasses: t.grasses || [], soilType: t.soilType || '', course: t.course || '' },
  }
}

export async function addSoilTest(t) {
  const { data, error } = await supabase.from('soil_tests').insert(soilTestFields(t)).select().single()
  if (error) throw error
  return rowToSoilTest(data)
}

export async function updateSoilTest(t) {
  const { data, error } = await supabase.from('soil_tests').update(soilTestFields(t)).eq('id', t.id).select().single()
  if (error) throw error
  return rowToSoilTest(data)
}

export async function deleteSoilTest(id) {
  const { error } = await supabase.from('soil_tests').delete().eq('id', id)
  if (error) throw error
}

// ── Playbook (SOPs, emergency procedures, contacts, supplies) ────────────────
function rowToPlaybook(r) {
  return {
    id: r.id, kind: r.kind || 'sop', title: r.title || '', category: r.category || '',
    notes: r.notes || '', data: r.data || {}, attachments: Array.isArray(r.attachments) ? r.attachments : [],
    emergency: !!r.emergency, sort: r.sort ?? 0, createdAt: r.created_at,
  }
}
function playbookToRow(x) {
  return {
    kind: x.kind || 'sop', title: x.title || '', category: x.category || '', notes: x.notes || '',
    data: x.data || {}, attachments: Array.isArray(x.attachments) ? x.attachments : [],
    emergency: !!x.emergency, sort: x.sort ?? 0, updated_at: new Date().toISOString(),
  }
}

export async function fetchPlaybookItems() {
  const { data, error } = await supabase.from('playbook_items').select('*')
    .order('sort', { ascending: true }).order('created_at', { ascending: true })
  if (error) throw error
  return (data || []).map(rowToPlaybook)
}

export async function addPlaybookItem(x) {
  const { data, error } = await supabase.from('playbook_items').insert(playbookToRow(x)).select().single()
  if (error) throw error
  return rowToPlaybook(data)
}

export async function updatePlaybookItem(x) {
  const { data, error } = await supabase.from('playbook_items').update(playbookToRow(x)).eq('id', x.id).select().single()
  if (error) throw error
  return rowToPlaybook(data)
}

export async function deletePlaybookItem(id) {
  const { error } = await supabase.from('playbook_items').delete().eq('id', id)
  if (error) throw error
}

// Upload one attachment (manual PDF, photo, or other file) to the public
// "playbook" bucket. Returns the attachment record to store on the item.
export async function uploadPlaybookFile(file) {
  const ext = (file.name.split('.').pop() || 'dat').toLowerCase().replace(/[^a-z0-9]/g, '')
  const path = `${crypto.randomUUID()}.${ext || 'dat'}`
  const { error } = await supabase.storage.from('playbook').upload(path, file, {
    upsert: false, contentType: file.type || undefined,
  })
  if (error) throw error
  const { data } = supabase.storage.from('playbook').getPublicUrl(path)
  const kind = (file.type || '').startsWith('image/') ? 'image' : (ext === 'pdf' ? 'pdf' : 'file')
  return { name: file.name, url: data.publicUrl, path, kind }
}

// Best-effort remove of a stored file (when an attachment is deleted).
export async function deletePlaybookFile(path) {
  if (!path) return
  try { await supabase.storage.from('playbook').remove([path]) } catch { /* ignore */ }
}

// Bulk-insert historical spray records (backfill). Each gets a fresh id and is
// stored as an approved + completed sheet so it feeds every report.
export async function bulkInsertSheets(sheets) {
  const rows = sheets.map((s) => sheetToRow({ ...s, id: crypto.randomUUID(), createdAt: new Date().toISOString() }))
  const CHUNK = 200
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from('spray_sheets').insert(rows.slice(i, i + CHUNK))
    if (error) throw error
  }
  return rows.length
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

// Subscribe to any change on the crew board (insert/update/delete). Calls
// onChange (no args) whenever a row changes, so the live TV board can refetch
// the day. Returns an unsubscribe function. Needs crew_tasks in the
// supabase_realtime publication (phase13.sql handles that).
export function subscribeCrewTasks(onChange) {
  const channel = supabase
    .channel('crew-tasks-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'crew_tasks' }, () => {
      try { onChange() } catch (e) { console.error('crew realtime handler failed', e) }
    })
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}

// ── Translation cache ────────────────────────────────────────────────────────
const txKey = (lang, source) => `${lang} ${source}`

// Fetch cached translations for the given language codes. Returns a map keyed by
// `${lang} ${source}` → translation.
export async function fetchTranslations(langs = []) {
  const want = (langs || []).filter(Boolean)
  if (want.length === 0) return {}
  const { data, error } = await supabase.from('translations').select('source, lang, translation').in('lang', want)
  if (error) throw error
  const map = {}
  ;(data || []).forEach((r) => { map[txKey(r.lang, r.source)] = r.translation })
  return map
}

// Upsert freshly-translated phrases so they're never re-translated.
export async function saveTranslations(rows = []) {
  const clean = (rows || []).filter((r) => r && r.source && r.lang && r.translation)
  if (clean.length === 0) return
  const { error } = await supabase.from('translations').upsert(clean, { onConflict: 'source,lang' })
  if (error) throw error
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
      soilTypes: DEFAULT_SOIL_TYPES,
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
    // `soil_types` may be absent until the Phase 9 migration has been run.
    soilTypes: data.soil_types && data.soil_types.length ? data.soil_types : DEFAULT_SOIL_TYPES,
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
  if (patch.soilTypes !== undefined) row.soil_types = patch.soilTypes
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
    // Living Calendar: how this application fires (fixed date / GDD / interval /
    // soil temp). Rides in the JSONB `data` column — no migration needed.
    trigger: r.data?.trigger || null,
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
    data: { ...(a.data || {}), ...(a.trigger ? { trigger: a.trigger } : {}) },
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
    data: { ...(app.data || {}), trigger: app.trigger ?? app.data?.trigger ?? null },
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

// ── Tournament Operations ─────────────────────────────────────────────────────
// Tournaments, the people working them, and public sign-ups. Same real-columns
// + jsonb-blob shape as the rest of the app.
function rowToTournament(r) {
  return {
    id: r.id,
    name: r.name,
    startDate: r.start_date || '',
    endDate: r.end_date || '',
    location: r.location || '',
    isActive: !!r.is_active,
    signupOpen: !!r.signup_open,
    data: r.data || {},
  }
}
function rowToPerson(r) {
  const d = r.data || {}
  return {
    id: r.id,
    tournamentId: r.tournament_id,
    name: r.name,
    code: r.code,
    role: d.role || 'Volunteer',
    committee: d.committee || '',
    shift: d.shift || '',
    phone: d.phone || '',
    email: d.email || '',
    org: d.org || '',
    shirt: d.shirt || '',
    emergencyName: d.emergencyName || '',
    emergencyPhone: d.emergencyPhone || '',
    notes: d.notes || '',
    title: d.title || '',
    years: d.years ?? '',
    photo: d.photo || '',
    checkedInAt: d.checkedInAt || null,
    checkedOutAt: d.checkedOutAt || null,
    data: d,
  }
}
// Fold a person object back into a jsonb blob (everything but the real columns).
function personToData(p) {
  return {
    role: p.role || 'Volunteer',
    committee: p.committee || '',
    shift: p.shift || '',
    phone: p.phone || '',
    email: p.email || '',
    org: p.org || '',
    shirt: p.shirt || '',
    emergencyName: p.emergencyName || '',
    emergencyPhone: p.emergencyPhone || '',
    notes: p.notes || '',
    title: p.title || '',
    years: p.years === '' || p.years == null ? '' : Number(p.years),
    photo: p.photo || '',
    // Preserve fields set elsewhere (check-in, answers, source) on update.
    ...(p.checkedInAt !== undefined ? { checkedInAt: p.checkedInAt || null } : {}),
    ...(p.checkedOutAt !== undefined ? { checkedOutAt: p.checkedOutAt || null } : {}),
    ...(p.data?.answers ? { answers: p.data.answers } : {}),
    ...(p.data?.source ? { source: p.data.source } : {}),
  }
}

export async function fetchTournaments() {
  const { data, error } = await supabase.from('tournaments').select('*').order('start_date', { ascending: false })
  if (error) throw error
  return (data || []).map(rowToTournament)
}

export async function createTournament(t) {
  const row = {
    name: t.name,
    start_date: t.startDate || null,
    end_date: t.endDate || null,
    location: t.location || '',
    is_active: !!t.isActive,
    signup_open: !!t.signupOpen,
    data: t.data || {},
  }
  const { data, error } = await supabase.from('tournaments').insert(row).select().single()
  if (error) throw error
  return rowToTournament(data)
}

export async function updateTournament(t) {
  const row = {
    name: t.name,
    start_date: t.startDate || null,
    end_date: t.endDate || null,
    location: t.location || '',
    is_active: !!t.isActive,
    signup_open: !!t.signupOpen,
    data: t.data || {},
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabase.from('tournaments').update(row).eq('id', t.id).select().single()
  if (error) throw error
  return rowToTournament(data)
}

// Make one tournament the active one (clears the flag on all the others).
export async function setActiveTournament(id) {
  let e1 = (await supabase.from('tournaments').update({ is_active: false }).neq('id', id)).error
  if (e1) throw e1
  const { error } = await supabase.from('tournaments').update({ is_active: true }).eq('id', id)
  if (error) throw error
}

export async function deleteTournament(id) {
  const { error } = await supabase.from('tournaments').delete().eq('id', id)
  if (error) throw error
}

export async function fetchPeople(tournamentId) {
  if (!tournamentId) return []
  const { data, error } = await supabase.from('tournament_people').select('*').eq('tournament_id', tournamentId).order('name')
  if (error) throw error
  return (data || []).map(rowToPerson)
}

export async function addPerson(tournamentId, p) {
  const row = { tournament_id: tournamentId, name: p.name, code: p.code, data: personToData(p) }
  const { data, error } = await supabase.from('tournament_people').insert(row).select().single()
  if (error) throw error
  return rowToPerson(data)
}

// Bulk insert (roster import / approving sign-ups). Codes must be set already.
export async function addPeople(tournamentId, list) {
  const rows = list.map((p) => ({ tournament_id: tournamentId, name: p.name, code: p.code, data: personToData(p) }))
  if (rows.length === 0) return 0
  const { error } = await supabase.from('tournament_people').insert(rows)
  if (error) throw error
  return rows.length
}

export async function updatePerson(p) {
  const row = { name: p.name, code: p.code, data: personToData(p), updated_at: new Date().toISOString() }
  const { data, error } = await supabase.from('tournament_people').update(row).eq('id', p.id).select().single()
  if (error) throw error
  return rowToPerson(data)
}

// Check a person in / out by their id — a lightweight jsonb patch so the desk is
// snappy. Reads the row, flips the timestamp, writes it back.
export async function setCheckIn(id, checkedIn) {
  const { data: cur, error: e1 } = await supabase.from('tournament_people').select('data').eq('id', id).single()
  if (e1) throw e1
  const d = cur?.data || {}
  const now = new Date().toISOString()
  if (checkedIn) { d.checkedInAt = now; d.checkedOutAt = null }
  else { d.checkedOutAt = now }
  const { data, error } = await supabase.from('tournament_people').update({ data: d, updated_at: now }).eq('id', id).select().single()
  if (error) throw error
  return rowToPerson(data)
}

// Check someone in by scanning their badge code. Returns { person } or
// { error } so the scanner can show a clear message.
export async function checkInByCode(tournamentId, code) {
  const clean = String(code || '').trim().toUpperCase()
  if (!clean) return { error: 'Empty code' }
  const { data, error } = await supabase.from('tournament_people')
    .select('*').eq('tournament_id', tournamentId).eq('code', clean).maybeSingle()
  if (error) throw error
  if (!data) return { error: `No one on the roster with code ${clean}` }
  const person = rowToPerson(data)
  if (person.checkedInAt && !person.checkedOutAt) return { person, already: true }
  const updated = await setCheckIn(person.id, true)
  return { person: updated }
}

export async function deletePerson(id) {
  const { error } = await supabase.from('tournament_people').delete().eq('id', id)
  if (error) throw error
}

// Live updates for the check-in desk and the TV board.
export function subscribeTournamentPeople(tournamentId, onChange) {
  const channel = supabase
    .channel(`tournament-people-${tournamentId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_people', filter: `tournament_id=eq.${tournamentId}` }, () => {
      try { onChange() } catch (e) { console.error('tournament realtime handler failed', e) }
    })
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}

// Public sign-ups awaiting review.
export async function fetchSignups(tournamentId, status = 'pending') {
  if (!tournamentId) return []
  let q = supabase.from('tournament_signups').select('*').eq('tournament_id', tournamentId)
  if (status) q = q.eq('status', status)
  const { data, error } = await q.order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map((r) => ({ id: r.id, name: r.name, email: r.email, phone: r.phone, status: r.status, data: r.data || {}, createdAt: r.created_at }))
}

export async function updateSignupStatus(id, status) {
  const { error } = await supabase.from('tournament_signups').update({ status }).eq('id', id)
  if (error) throw error
}

export async function deleteSignup(id) {
  const { error } = await supabase.from('tournament_signups').delete().eq('id', id)
  if (error) throw error
}
