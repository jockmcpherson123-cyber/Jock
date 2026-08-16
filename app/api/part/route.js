// Public, unauthenticated endpoint for a single irrigation part — the target of
// the per-part QR labels the crew scan in the shop. It uses the Supabase service
// role (server-side only) so we never loosen row-level security for anonymous
// visitors, and it is deliberately narrow: it can read ONE part by id and adjust
// only that part's stock count. Nothing else in the database is reachable.
//
//   GET  ?id=<partId>            → the part's public fields (no cost/supplier)
//   POST { id, delta } | { id, stock } → bump or set that part's stock, returns it
import { createClient } from '@supabase/supabase-js'

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

// Public fields only — cost, supplier and notes are intentionally left off.
const PUBLIC = 'id, part_number, name, category, brand, size, photo, stock, low_stock, unit, location'
function shape(r) {
  return {
    id: r.id, partNumber: r.part_number || '', name: r.name || '', category: r.category || '',
    brand: r.brand || '', size: r.size || '', photo: r.photo || '', stock: Number(r.stock) || 0,
    lowStock: Number(r.low_stock) || 0, unit: r.unit || 'each', location: r.location || '',
  }
}
const noStore = { 'Cache-Control': 'no-store' }

export async function GET(request) {
  const supabase = admin()
  if (!supabase) return Response.json({ error: 'Not configured' }, { status: 500 })
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })
  const { data, error } = await supabase.from('irrigation_parts').select(PUBLIC).eq('id', id).maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'Part not found' }, { status: 404 })
  return Response.json(shape(data), { headers: noStore })
}

export async function POST(request) {
  const supabase = admin()
  if (!supabase) return Response.json({ error: 'Not configured' }, { status: 500 })
  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Bad request' }, { status: 400 }) }
  const { id, delta, stock } = body || {}
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })

  const { data: cur, error: e1 } = await supabase.from('irrigation_parts').select('stock').eq('id', id).maybeSingle()
  if (e1) return Response.json({ error: e1.message }, { status: 500 })
  if (!cur) return Response.json({ error: 'Part not found' }, { status: 404 })

  let next = typeof stock === 'number' ? stock : (Number(cur.stock) || 0) + (Number(delta) || 0)
  next = Math.max(0, Math.round(next * 100) / 100)

  // Try with updated_at; retry without if the column isn't there.
  let res = await supabase.from('irrigation_parts').update({ stock: next, updated_at: new Date().toISOString() }).eq('id', id).select(PUBLIC).maybeSingle()
  if (res.error && /updated_at/.test(res.error.message || '')) {
    res = await supabase.from('irrigation_parts').update({ stock: next }).eq('id', id).select(PUBLIC).maybeSingle()
  }
  if (res.error) return Response.json({ error: res.error.message }, { status: 500 })
  return Response.json(shape(res.data), { headers: noStore })
}
