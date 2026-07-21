// The home page. A Server Component that reads who is logged in (and their
// role) from the database, then hands off to the interactive Spray Ops app.
//
// The proxy guarantees nobody reaches this page without logging in, so `user`
// is always present here.
import { getUser } from '@/lib/getUser'
import SprayApp from '@/components/SprayApp'

export default async function HomePage() {
  const user = await getUser()
  return <SprayApp user={user} />
}
