// Serves the irrigation overlay image — but only to a signed-in staff member,
// so the as-built stays behind the login (it's sensitive). The image itself
// lives outside /public (which would be world-readable); this route reads it
// from the bundled asset and streams it back after checking the session.
import fs from 'fs'
import path from 'path'
import { getUser } from '@/lib/getUser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })
  try {
    const p = path.join(process.cwd(), 'assets', 'course', 'irrigation-overlay.png')
    const buf = fs.readFileSync(p)
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, max-age=86400',
      },
    })
  } catch {
    return new Response('Overlay not found', { status: 404 })
  }
}
