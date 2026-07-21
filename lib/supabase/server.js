// Server-side Supabase client.
//
// This is used by Server Components, Server Actions, and Route Handlers —
// code that runs on the server, not in the browser. It reads and writes the
// login session through cookies so the server always knows who is signed in.
//
// In Next.js 16 the cookies() function is async, so this factory is async too
// and every caller must `await createClient()`.
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          // This can throw when called from a Server Component (which is not
          // allowed to set cookies). That's fine — the proxy layer refreshes
          // the session cookie on every request, so we can safely ignore it.
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component — safe to ignore.
          }
        },
      },
    }
  )
}
