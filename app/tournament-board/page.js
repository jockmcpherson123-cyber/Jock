// The live tournament board for a shop / clubhouse TV. A Server Component that
// checks someone is signed in (the TV signs in once), then hands off to the
// read-only live board so Realtime and RLS work with a real session.
import { redirect } from 'next/navigation'
import { getUser } from '@/lib/getUser'
import TournamentBoard from '@/components/TournamentBoard'

export const metadata = { title: 'Tournament Board' }

export default async function TournamentBoardPage() {
  const user = await getUser()
  if (!user) redirect('/login')
  return <TournamentBoard />
}
