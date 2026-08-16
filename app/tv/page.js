'use client'

// Public, no-login phone view of the live crew job board — the target of the
// "Crew Board" QR. Reuses the TV board component in its public (polling) mode.
// The club key rides in the link (?k=); an optional ?course= scopes it.
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import CrewBoard from '@/components/CrewBoard'

function TV() {
  const k = useSearchParams().get('k')
  if (!k) {
    return <div style={{ minHeight: '100vh', background: '#16291F', color: '#E7C9C9', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24, fontFamily: 'system-ui' }}>This board link is invalid. Ask for a fresh QR code.</div>
  }
  return <CrewBoard pub={k} />
}

export default function Page() {
  return <Suspense fallback={<div style={{ minHeight: '100vh', background: '#16291F' }} />}><TV /></Suspense>
}
