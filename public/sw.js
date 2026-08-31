// Service worker — gives the app offline resilience on the course.
//
// Strategy:
//  • App shell + pages (navigations): network-first, fall back to the last
//    cached copy of that page, then to a simple offline page. So a page you've
//    opened before still loads with no signal.
//  • Static assets (/_next/static, icons, images): cache-first — instant, and
//    they never change once hashed.
//  • Everything dynamic (Supabase data, API calls, Mapbox): straight to the
//    network, never cached — so you never see stale spray data. Offline, those
//    simply won't load, and the page says so.
//
// Bump CACHE to force every client to refresh its cached shell.
const CACHE = 'grounds-v1'
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.add(OFFLINE_URL)).catch(() => {}),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  )
  self.clients.claim()
})

function isStaticAsset(url) {
  return url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icon') ||
    /\.(png|jpg|jpeg|svg|webp|woff2?|ttf|ico)$/.test(url.pathname)
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  // Only handle our own origin; let cross-origin (Supabase, Mapbox, fonts) pass through.
  if (url.origin !== self.location.origin) return

  // Page navigations: network-first with cache + offline fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match(OFFLINE_URL))),
    )
    return
  }

  // Static assets: cache-first, then network (and cache it).
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
        return res
      }).catch(() => cached)),
    )
    return
  }

  // Everything else (data/API): network, fall back to cache only if present.
  event.respondWith(fetch(req).catch(() => caches.match(req)))
})
