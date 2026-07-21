// Helper: get the currently logged-in user together with their profile row
// (which holds their name and role). Returns null if nobody is logged in.
//
// Used on protected pages to decide what a person is allowed to see and do:
//   - operator:       view approved sheets only (read-only)
//   - superintendent: create/edit sheets, manage library/inventory/settings
//   - director:       everything a superintendent can do, plus approvals
import { createClient } from '@/lib/supabase/server'

export async function getUser() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('id', user.id)
    .single()

  return {
    id: user.id,
    email: user.email,
    fullName: profile?.full_name || user.email,
    // Default to the most restrictive role if the profile row is missing.
    role: profile?.role || 'operator',
  }
}
