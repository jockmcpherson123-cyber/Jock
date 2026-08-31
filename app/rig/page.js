'use client'

// Public, no-login sprayer page — the target of a rig's QR sticker. Shows what's
// currently mixed in that sprayer (set from a spray record) and links to each
// product's label. The club key rides in the link (?k=), the rig id in (?r=).
import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

const FOREST = '#16291F'
const GOLD = '#C9A84C'
const MUT = '#8A8984'
const HAIR = '#E2E0DB'

function fmtDate(d) {
  if (!d) return ''
  try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) } catch { return d }
}
const rank = { Danger: 3, Warning: 2, Caution: 1 }

function Rig() {
  const sp = useSearchParams()
  const k = sp.get('k')
  const rigId = sp.get('r')
  const [data, setData] = useState(null)
  const [state, setState] = useState('loading') // loading | ok | denied | error

  const load = useCallback(async () => {
    if (!k) { setState('denied'); return }
    try {
      const r = await fetch(`/api/crew?view=rig&k=${encodeURIComponent(k)}`, { cache: 'no-store' })
      if (r.status === 401) { setState('denied'); return }
      if (!r.ok) throw new Error()
      setData(await r.json())
      setState('ok')
    } catch { setState('error') }
  }, [k])
  useEffect(() => { load() }, [load])

  if (state === 'loading') return <Center>Loading…</Center>
  if (state === 'denied') return <Center>This sprayer link is invalid or expired.<br />Ask a manager for a fresh QR code.</Center>
  if (state === 'error') return <Center>Couldn’t load. Try again.</Center>

  const rig = (data.sprayers || []).find((s) => s.id === rigId)
  const mix = (data.rigMix || {})[rigId]
  if (!rig) return <Center>This sprayer isn’t set up.<br />Ask a manager to add it in Settings → Sprayers.</Center>

  let signal = ''
  ;(mix?.products || []).forEach((p) => { if ((rank[p.signalWord] || 0) > (rank[signal] || 0)) signal = p.signalWord })
  const signalColor = signal === 'Danger' ? '#B3261E' : signal === 'Warning' ? '#9A6B12' : '#2E7D46'
  const reiList = (mix?.products || []).map((p) => p.rei).filter(Boolean)

  return (
    <div style={{ minHeight: '100vh', background: '#EEF1EE' }}>
      <div style={{ background: FOREST }} className="text-white px-4 py-3 sticky top-0 z-10">
        {data.club && <p className="text-[10px] tracking-[0.22em] uppercase" style={{ color: GOLD }}>{data.club} · Sprayer</p>}
        <p className="text-lg font-semibold">{rig.name}{rig.tank ? <span className="opacity-60 font-normal"> · {rig.tank}</span> : ''}</p>
      </div>

      <div className="max-w-md mx-auto px-3 py-4">
        {!mix ? (
          <div className="bg-white rounded-2xl border shadow-sm p-5 text-center" style={{ borderColor: HAIR }}>
            <p className="text-sm" style={{ color: MUT }}>No mix has been assigned to this sprayer yet.</p>
            <p className="text-[12px] mt-1" style={{ color: MUT }}>From a spray record, a manager taps “Set as sprayer mix.”</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border shadow-sm p-4" style={{ borderColor: HAIR }}>
            <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUT }}>Currently loaded</p>
            <p className="text-xl font-bold" style={{ color: FOREST }}>{mix.area || 'Spray mix'}</p>
            <p className="text-[12px]" style={{ color: MUT }}>
              {(mix.targets || []).length ? `For ${(mix.targets || []).join(', ')} · ` : ''}
              {fmtDate(mix.date)}{mix.applicator ? ` · ${mix.applicator}` : ''}
            </p>

            {signal && <span className="inline-block mt-2 text-[11px] font-bold uppercase tracking-wide text-white rounded px-2.5 py-1" style={{ background: signalColor }}>Signal word: {signal}</span>}

            <div className="mt-3 divide-y" style={{ borderColor: '#EEE' }}>
              {(mix.products || []).map((p, i) => (
                <div key={i} className="py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[15px] font-bold" style={{ color: FOREST }}>{p.name}</span>
                    {p.labelUrl ? <a href={p.labelUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0" style={{ background: '#EFF6FF', color: '#2563EB' }}>Label ↗</a> : null}
                  </div>
                  <p className="text-[11px]" style={{ color: MUT }}>
                    {p.activeIngredient ? p.activeIngredient : ''}{p.activeIngredient && p.epaReg ? ' · ' : ''}{p.epaReg ? `EPA ${p.epaReg}` : ''}{p.rei ? ` · REI ${p.rei}` : ''}
                  </p>
                </div>
              ))}
            </div>

            {reiList.length > 0 && (
              <div className="mt-3 rounded-lg px-3 py-2 text-[12px]" style={{ background: '#FBF1E5', color: '#7A4E1E' }}>
                <b>Restricted entry.</b> Keep people off treated areas until the interval has passed.
              </div>
            )}
            <p className="text-[10px] mt-3" style={{ color: MUT }}>Always confirm against the physical product label before handling. Set {fmtDate(mix.date)}.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function Center({ children }) {
  return <div style={{ minHeight: '100vh', background: '#EEF1EE' }} className="flex items-center justify-center text-center px-6"><p className="text-sm text-slate-400">{children}</p></div>
}

export default function Page() {
  return <Suspense fallback={<Center>Loading…</Center>}><Rig /></Suspense>
}
