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
  return null
}
