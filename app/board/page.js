// The live crew board for the shop TV. A Server Component that just checks
// someone is signed in (the TV signs in once), then hands off to the read-only
// live board. Reuses the same login as the rest of the app so Realtime and RLS
// work with a real session.
import { redirect } from 'next/navigation'
import { getUser } from '@/lib/getUser'
import CrewBoard from '@/components/CrewBoard'

export const metadata = { title: 'Crew Board' }

export default async function BoardPage() {
  const user = await getUser()
  if (!user) redirect('/login')
  return <CrewBoard />
}
