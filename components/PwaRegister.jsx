'use client'

// Registers the service worker (public/sw.js) once, on the client, so the app
// installs as a PWA and gains offline resilience. No UI — it just wires up the
// worker after the page loads.
import { useEffect } from 'react'

export default function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    const onLoad = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {})
    }
    if (document.readyState === 'complete') onLoad()
    else window.addEventListener('load', onLoad, { once: true })
    return () => window.removeEventListener('load', onLoad)
  }, [])

  // Self-heal the "deployed while your tab was open" crash: when a JS chunk the
  // app tries to load has been replaced by a newer deploy, the import fails and
  // the page can't render. Catch that specific failure and reload ONCE to pull
  // the fresh files (guarded so it can never loop).
  useEffect(() => {
    const KEY = 'chunkReloadAt'
    const isChunkError = (m) => /Loading chunk [\w./-]+ failed|ChunkLoadError|loading (dynamically imported module|chunk)|Importing a module script failed|Failed to fetch dynamically imported module|'text\/html' is not a valid JavaScript MIME type/i.test(String(m || ''))
    const heal = (msg) => {
      if (!isChunkError(msg)) return
      let last = 0
      try { last = Number(sessionStorage.getItem(KEY)) || 0 } catch { /* ignore */ }
      if (Date.now() - last < 15000) return // already tried very recently — don't loop
      try { sessionStorage.setItem(KEY, String(Date.now())) } catch { /* ignore */ }
      window.location.reload()
    }
    const onErr = (e) => heal(e?.message || e?.error?.message || e?.error)
    const onRej = (e) => heal(e?.reason?.message || e?.reason)
    window.addEventListener('error', onErr, true)
    window.addEventListener('unhandledrejection', onRej)
    return () => { window.removeEventListener('error', onErr, true); window.removeEventListener('unhandledrejection', onRej) }
  }, [])

  return null
}
