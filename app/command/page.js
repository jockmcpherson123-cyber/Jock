// The Command Center — a wide, edge-to-edge overview dashboard for a monitor,
// shop TV, or landscape iPad. A Server Component that checks a signed-in session
// (so weather/data load with real RLS), then renders the client dashboard.
import { redirect } from 'next/navigation'
import { getUser } from '@/lib/getUser'
import CommandCenter from '@/components/CommandCenter'

export const metadata = { title: 'Command Center' }

export default async function CommandPage() {
  const user = await getUser()
  if (!user) redirect('/login')
  return <CommandCenter />
}
