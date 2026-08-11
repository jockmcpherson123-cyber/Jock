// Serves the head/valve symbols extracted from the as-built (in calibration
// pixel space) to signed-in staff — used once to seed the editable layer.
import fs from 'fs'
import path from 'path'
import { getUser } from '@/lib/getUser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })
  try {
    const p = path.join(process.cwd(), 'assets', 'course', 'heads.json')
    const buf = fs.readFileSync(p)
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=86400' },
    })
  } catch {
    return new Response('{"heads":[]}', { status: 404, headers: { 'Content-Type': 'application/json' } })
  }
}
