// Serves the extracted control-wire paths (in calibration pixel space) to
// signed-in staff only — same privacy stance as the raster overlay.
import fs from 'fs'
import path from 'path'
import { getUser } from '@/lib/getUser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })
  try {
    const p = path.join(process.cwd(), 'assets', 'course', 'wires.json')
    const buf = fs.readFileSync(p)
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  } catch {
    return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
  }
}
