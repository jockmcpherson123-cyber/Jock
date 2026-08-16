'use client'

// Public per-part page — the target of a shop QR label. No login: it shows one
// irrigation part and lets whoever scanned it bump the stock count up or down.
// Everything goes through /api/part, which can only ever touch this one part.
import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

const FOREST = '#16291F'
const FERN = '#3A6B4A'

function PartView() {
  const id = useSearchParams().get('id')
  const [part, setPart] = useState(null)
  const [state, setState] = useState('loading') // loading | ok | error
  const [busy, setBusy] = useState(false)
  const [setMode, setSetMode] = useState(false)
  const [setVal, setSetVal] = useState('')

  const loadPart = useCallback(async () => {
    if (!id) { setState('error'); return }
    try {
      const r = await fetch(`/api/part?id=${encodeURIComponent(id)}`, { cache: 'no-store' })
      if (!r.ok) throw new Error('not found')
      setPart(await r.json()); setState('ok')
    } catch { setState('error') }
  }, [id])
  useEffect(() => { loadPart() }, [loadPart])

  const send = async (payload) => {
    setBusy(true)
    try {
      const r = await fetch('/api/part', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...payload }) })
      if (r.ok) setPart(await r.json())
    } catch { /* ignore */ }
    setBusy(false)
  }
  const bump = (delta) => send({ delta })
  const saveExact = () => { const n = Number(setVal); if (!isNaN(n)) send({ stock: Math.max(0, n) }); setSetMode(false); setSetVal('') }

  if (state === 'loading') return <Shell><p style={{ color: '#94A3A0', fontFamily: 'Inter, sans-serif' }}>Loading…</p></Shell>
  if (state === 'error') return <Shell><p style={{ color: '#94A3A0', fontFamily: 'Inter, sans-serif', textAlign: 'center' }}>Part not found. The QR label may be out of date.</p></Shell>

  const low = part.lowStock > 0 && part.stock <= part.lowStock
  return (
    <Shell>
      <div style={{ background: '#fff', borderRadius: 20, boxShadow: '0 2px 16px rgba(0,0,0,0.08)', overflow: 'hidden', width: '100%', maxWidth: 420 }}>
        {part.photo
          ? <img src={part.photo} alt="" style={{ width: '100%', height: 220, objectFit: 'contain', background: '#F4F6F4' }} />
          : <div style={{ width: '100%', height: 120, background: '#F0F6F2' }} />}
        <div style={{ padding: 20 }}>
          {part.partNumber && <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', color: FERN, margin: 0 }}>{part.partNumber}</p>}
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 600, color: FOREST, margin: '2px 0 4px' }}>{part.name || 'Irrigation part'}</h1>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#8A8984', margin: 0 }}>{[part.brand, part.size, part.category].filter(Boolean).join(' · ')}</p>
          {part.location && <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#8A8984', margin: '4px 0 0' }}>📍 {part.location}</p>}

          <div style={{ marginTop: 18, background: low ? '#FEF2F2' : '#F8FAF8', borderRadius: 14, padding: '14px 16px', textAlign: 'center' }}>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#8A8984', margin: 0 }}>In stock</p>
            <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 52, fontWeight: 700, lineHeight: 1.05, color: low ? '#DC2626' : FOREST }}>{part.stock}<span style={{ fontFamily: 'Inter, sans-serif', fontSize: 16, fontWeight: 600, color: '#8A8984' }}> {part.unit}</span></div>
            {low && <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 700, color: '#DC2626', margin: 0 }}>Low — at or below {part.lowStock}</p>}
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <button onClick={() => bump(-1)} disabled={busy} style={btn('#fff', FOREST, '2px solid #E2E8F0')}>−1</button>
            <button onClick={() => bump(1)} disabled={busy} style={btn(FERN, '#fff')}>+1</button>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
            <button onClick={() => bump(-5)} disabled={busy} style={btnSm()}>−5</button>
            <button onClick={() => bump(5)} disabled={busy} style={btnSm()}>+5</button>
            {!setMode
              ? <button onClick={() => { setSetMode(true); setSetVal(String(part.stock)) }} disabled={busy} style={btnSm()}>Set count</button>
              : null}
          </div>
          {setMode && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input value={setVal} onChange={(e) => setSetVal(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" autoFocus style={{ flex: 1, border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 12px', fontSize: 16, fontFamily: 'Inter, sans-serif' }} />
              <button onClick={saveExact} disabled={busy} style={{ ...btnSm(), background: FOREST, color: '#fff', border: 'none', flex: 'none', padding: '0 16px' }}>Save</button>
              <button onClick={() => setSetMode(false)} style={{ ...btnSm(), flex: 'none', padding: '0 14px' }}>Cancel</button>
            </div>
          )}
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#B0AFA9', textAlign: 'center', margin: '16px 0 0' }}>Updates the shop inventory instantly.</p>
        </div>
      </div>
    </Shell>
  )
}

const btn = (bg, color, border = 'none') => ({ flex: 1, padding: '16px 0', borderRadius: 14, border, background: bg, color, fontSize: 22, fontWeight: 700, fontFamily: 'Inter, sans-serif', cursor: 'pointer' })
const btnSm = () => ({ flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid #E2E8F0', background: '#fff', color: '#475569', fontSize: 14, fontWeight: 700, fontFamily: 'Inter, sans-serif', cursor: 'pointer' })

function Shell({ children }) {
  return <div style={{ minHeight: '100vh', background: '#EEF1EE', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>{children}</div>
}

export default function Page() {
  return <Suspense fallback={<Shell><p style={{ color: '#94A3A0' }}>Loading…</p></Shell>}><PartView /></Suspense>
}
