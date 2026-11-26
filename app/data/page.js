// The /data route serves two audiences:
//   • the crew — when the link carries a club key (?k=), this is the public,
//     no-login Field Data page (the QR target); the key is checked by /api/crew.
//   • managers — without a key, this is the manager "Data" section of the app
//     (green speeds, clipping yields, moisture, firmness, scouting…). The proxy
//     only treats /data as public when ?k is present, so a keyless /data still
//     requires a login. The old /agronomy paths now redirect here.
import { getUser } from '@/lib/getUser'
import SprayApp from '@/components/SprayApp'
import FieldData from '@/components/FieldData'

export default async function Page({ searchParams }) {
  const sp = await searchParams
  if (sp?.k) return <FieldData />
  const user = await getUser()
  return <SprayApp user={user} initialPath="/data" />
}
