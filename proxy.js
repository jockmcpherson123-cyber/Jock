// Proxy (formerly "middleware" in older Next.js versions).
//
// This runs on the server before every matching page request. It does two
// things:
//   1. Refreshes the Supabase login session so it never silently expires.
//   2. Redirects anyone who is NOT logged in to the /login page.
//
// This is the layer that makes the whole app private — the core requirement
// from the brief (the old prototype had no logins at all).
import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'

export async function proxy(request) {
  // Start with a response that passes the request through unchanged.
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Write refreshed session cookies onto both the incoming request
          // (so this request sees them) and the outgoing response (so the
          // browser stores them).
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: getUser() must be called here to refresh the session token.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Paths that a logged-out visitor is allowed to reach.
  const isPublicPath =
    pathname.startsWith('/login') || pathname.startsWith('/auth')

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // If a logged-in user lands on the login page, send them home.
  if (user && pathname.startsWith('/login')) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  // Always return the `response` object so refreshed cookies reach the browser.
  return response
}

export const config = {
  // Run on everything EXCEPT Next.js internals and static image files, so the
  // proxy never blocks CSS, JS, or images from loading.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
