// Sensor / DEACON readings ingest — a server-side batch endpoint so moisture,
// clipping, green speed and firmness readings can be POSTed straight into Field
// Data from DEACON, POGO, Spiio or a scheduled job, instead of scraping through
// a fragile headless browser. Same auth as /api/crew (the club parts key).
//
//   POST /api/readings            Content-Type: application/json
//     { "k": "KEY", "readings": [
//        { "type": "firmness",   "area": "Blue Greens", "date": "2026-10-11", "value": 142, "unit": "Gravities" },
//        { "type": "greenspeed", "area": "Blue Greens", "date": "2026-10-11", "value": 10.5 },
//        { "type": "clipping",   "area": "Gold Greens", "date": "2026-10-11", "value": 320, "unit": "mL" },
//        { "type": "moisture",   "greenId": "g3", "date": "2026-10-11", "values": [18,21,19] }
//     ] }
//
//   POST /api/readings?k=KEY      Content-Type: text/csv
//     type,area,date,value,unit
//     firmness,Blue Greens,2026-10-11,142,Gravities
//
//   GET  /api/readings?k=KEY  → accepted types + the app's area names (so an
//                               integrator can map sensor zones to areas).
import { createClient } from '@supabase/supabase-js'

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}
async function settings(supabase) {
  const { data } = await supabase.from('app_settings').select('course_info, areas').eq('id', 1).maybeSingle()
  return { courseInfo: data?.course_info || {}, areas: data?.areas || {} }
}
function keyOk(courseInfo, k) {
  // A dedicated sensorKey if the club sets one, else the shared parts key.
  const want = courseInfo?.sensorKey || courseInfo?.partsKey
  return !!k && !!want && want === k
}
const noStore = { 'Cache-Control': 'no-store' }
const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10)
const todayIso = () => new Date().toISOString().slice(0, 10)
const okDate = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') && d <= tomorrow() ? d : todayIso())
const num = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(/,/g, '').trim()); return Number.isFinite(n) ? n : null }
const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))
const stats = (values) => {
  const v = (values || []).map(Number).filter(Number.isFinite)
  if (!v.length) return { avg: null, cv: null }
  const avg = v.reduce((s, x) => s + x, 0) / v.length
  if (v.length < 2 || avg === 0) return { avg: Math.round(avg * 10) / 10, cv: 0 }
  const variance = v.reduce((s, x) => s + (x - avg) ** 2, 0) / v.length
  return { avg: Math.round(avg * 10) / 10, cv: Math.round((Math.sqrt(variance) / avg) * 100 * 10) / 10 }
}

function parseCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return []
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase())
  return lines.slice(1).map((line) => {
    const cells = line.split(',')
    const row = {}
    header.forEach((h, i) => { row[h] = (cells[i] ?? '').trim() })
    return row
  })
}

export async function GET(request) {
  const supabase = admin()
  if (!supabase) return Response.json({ error: 'Not configured' }, { status: 500 })
  const sp = new URL(request.url).searchParams
  const { courseInfo, areas } = await settings(supabase)
  if (!keyOk(courseInfo, sp.get('k'))) return Response.json({ error: 'Not authorized' }, { status: 401 })
  return Response.json({
    ok: true,
    types: ['moisture', 'clipping', 'greenspeed', 'firmness'],
    areas: Object.keys(areas || {}),
    note: 'POST readings as JSON {k, readings:[{type, area|greenId, date, value, unit}]} or CSV with ?k=.',
  }, { headers: noStore })
}

export async function POST(request) {
  const supabase = admin()
  if (!supabase) return Response.json({ error: 'Not configured' }, { status: 500 })
  const sp = new URL(request.url).searchParams
  const ct = request.headers.get('content-type') || ''
  let k = sp.get('k') || request.headers.get('x-api-key')
  let readings = []
  try {
    if (ct.includes('csv') || ct.includes('text/plain')) {
      readings = parseCsv(await request.text())
    } else {
      const body = await request.json()
      k = body?.k || k
      readings = Array.isArray(body?.readings) ? body.readings : []
    }
  } catch { return Response.json({ error: 'bad_request' }, { status: 400 }) }

  const { courseInfo } = await settings(supabase)
  if (!keyOk(courseInfo, k)) return Response.json({ error: 'Not authorized' }, { status: 401 })
  if (!readings.length) return Response.json({ error: 'no_readings' }, { status: 400 })

  const clip = []; const speed = []; const firm = []; const moisture = []; const errors = []
  readings.forEach((r, i) => {
    const type = String(r.type || '').toLowerCase()
    const date = okDate(r.date)
    const area = String(r.area || '').trim()
    if (type === 'clipping' || type === 'clip') {
      const v = num(r.value ?? r.volume)
      if (!area || v == null) errors.push({ i, error: 'clipping needs area + value' })
      else clip.push({ area, clip_date: date, volume: v, unit: r.unit || 'mL', notes: r.notes || 'sensor import' })
    } else if (type === 'greenspeed' || type === 'speed') {
      const v = num(r.value ?? r.speed)
      if (!area || v == null) errors.push({ i, error: 'greenspeed needs area + value' })
      else speed.push({ area, reading_date: date, speed: v, notes: r.notes || 'sensor import' })
    } else if (type === 'firmness' || type === 'firm') {
      const v = num(r.value ?? r.firmness)
      if (!area || v == null) errors.push({ i, error: 'firmness needs area + value' })
      else firm.push({ area, reading_date: date, firmness: v, unit: r.unit || 'Gravities', notes: r.notes || 'sensor import' })
    } else if (type === 'moisture') {
      const greenId = r.greenId || r.greenid
      let values = Array.isArray(r.values) ? r.values : (r.value != null ? [r.value] : [])
      if (typeof values === 'string') values = values.split(/[;|]/)
      values = values.map(num).filter((x) => x != null)
      if (!greenId || !values.length) errors.push({ i, error: 'moisture needs greenId + values' })
      else moisture.push({ greenId, date, values })
    } else {
      errors.push({ i, error: `unknown type "${r.type}"` })
    }
  })

  const inserted = { clipping: 0, greenspeed: 0, firmness: 0, moisture: 0 }
  try {
    if (clip.length) { const { error } = await supabase.from('clippings').insert(clip); if (error) throw error; inserted.clipping = clip.length }
    if (speed.length) { const { error } = await supabase.from('greens_speeds').insert(speed); if (error) throw error; inserted.greenspeed = speed.length }
    if (firm.length) { const { error } = await supabase.from('greens_firmness').insert(firm); if (error) throw error; inserted.firmness = firm.length }
    if (moisture.length) {
      const { data } = await supabase.from('app_settings').select('course_info').eq('id', 1).maybeSingle()
      const ci = data?.course_info || {}
      const wetting = ci.wetting || {}
      const add = moisture.map((m) => { const { avg, cv } = stats(m.values); return { id: newId(), greenId: m.greenId, date: m.date, values: m.values, avg, cv } })
      const nextCi = { ...ci, wetting: { ...wetting, readings: [...(wetting.readings || []), ...add] } }
      const { error } = await supabase.from('app_settings').update({ course_info: nextCi }).eq('id', 1)
      if (error) throw error
      inserted.moisture = add.length
    }
  } catch (e) {
    return Response.json({ error: e?.message || 'save_failed', inserted }, { status: 500 })
  }
  return Response.json({ ok: true, inserted, errors }, { headers: noStore })
}
