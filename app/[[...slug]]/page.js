// The whole manager app is one client app, but every page has its own URL so it
// can be bookmarked and a refresh lands on the same page. This optional catch-all
// renders the app for "/" and any manager path (e.g. /spray, /data/green-
// speeds, /irrigation/greens-today). More specific routes — the keyed /data QR,
// /command, /board, the /api/* handlers — still take precedence, so this never
// shadows them. The proxy keeps every non-public path behind a login.
import { getUser } from '@/lib/getUser'
import SprayApp from '@/components/SprayApp'

// The manager app shows the same desktop layout on every device, scaled to fit
// (pinch to zoom in). Pinning a desktop-width viewport here renders it right
// from the first paint — no mobile→desktop flash. Crew/kiosk pages have their
// own routes and keep the root layout's finger-friendly device-width viewport.
export const viewport = { width: 1280, viewportFit: 'cover' }

export default async function Page({ params }) {
  const user = await getUser()
  const { slug } = await params
  const path = '/' + (Array.isArray(slug) ? slug.join('/') : '')
  return <SprayApp user={user} initialPath={path} />
}
