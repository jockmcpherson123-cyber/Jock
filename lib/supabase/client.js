// Browser-side Supabase client.
//
// This is used by Client Components (anything with "use client" at the top)
// that need to talk to Supabase directly from the user's browser — for
// example, a form that reads or writes data after the page has loaded.
//
// It reads two values from the environment: the project URL and the public
// "anon" key. Both are safe to expose to the browser (that's why they start
// with NEXT_PUBLIC_) — real security comes from Supabase Row Level Security,
// not from hiding these values.
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}
