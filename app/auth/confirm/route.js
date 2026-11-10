// Handles the one-time link from an invite / password-reset email.
//
// The link carries a `token_hash`. We verify it (which signs the person in by
// setting the session cookie), then send them to the page named in `next`
// (normally /set-password, where they choose their own password). On a bad or
// expired link we bounce to /login with a flag.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function GET(request) {
  const url = new URL(request.url)
  const token_hash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type') || 'invite'
  const next = url.searchParams.get('next') || '/set-password'
  // Only allow redirecting to a path on this app, never an external URL.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/set-password'

  if (token_hash) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash })
    if (!error) redirect(safeNext)
  }
  redirect('/login?error=link')
}
