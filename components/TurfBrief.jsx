'use client'

// ── Weekly AI Reports · "The Grounds Dispatch" ───────────────────────────────
// A bespoke weekly agronomy brief: researches recent turf science far and wide,
// targeted to this course's weather-station region and grass types, avoids
// repeating past editions, and reads it aloud. On-demand — generate any time.
import { useState, useEffect, useRef } from 'react'
import { Play, Pause, Loader2, RotateCcw, Sparkles } from 'lucide-react'
import { sheetApplied } from '@/lib/applied'
import { FERN } from '@/lib/theme'

// editorial palette (paper-luxury, restrained)
const PAPER = '#F4F0E7', CARD = '#FBF9F3', INK = '#1B1B17', INK2 = '#57544a', INK3 = '#8f8b7d'
const HAIR = '#D9D3C4', HAIR2 = '#E7E2D5', FOREST = '#14251C', EMBER = '#A83C2C', GOLDD = '#9A7A16'
const DISP = "'Fraunces', Georgia, serif", MONO = "'IBM Plex Mono', ui-monospace, monospace"
const iso = (d) => String(d || '').slice(0, 10)

function dailyAvg(rows, field, days = 30) {
  const by = {}
  ;(rows || []).forEach((r) => { const v = Number(r?.[field]); if (!r?.date || isNaN(v)) return; (by[iso(r.date)] = by[iso(r.date)] || { s: 0, n: 0 }); by[iso(r.date)].s += v; by[iso(r.date)].n++ })
  return Object.keys(by).sort().slice(-days).map((d) => ({ date: d, avg: Math.round((by[d].s / by[d].n) * 100) / 100 }))
}

export default function TurfBrief({ daily = [], clippings = [], speeds = [], soilTests = [], sheets = [], practices = [], products = [], areas = {}, courseInfo = {}, course = '', location = null, onSaveCourse }) {
  const saved = courseInfo?.aiBrief && typeof courseInfo.aiBrief === 'object' && courseInfo.aiBrief.brief ? courseInfo.aiBrief : null
  const [brief, setBrief] = useState(saved?.brief || null)
  const [at, setAt] = useState(saved?.generatedAt || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [speaking, setSpeaking] = useState(false)
  const uRef = useRef(null)

  useEffect(() => () => { try { window.speechSynthesis?.cancel() } catch {} }, [])

  function buildContext() {
    const todayIso = new Date().toISOString().slice(0, 10)
    const areaGrasses = {}; Object.entries(areas || {}).forEach(([n, a]) => { if (a?.grasses?.length) areaGrasses[n] = a.grasses })
    const grasses = [...new Set([...(courseInfo?.siteGrasses || []), ...Object.values(areaGrasses).flat()])]
    const applied = (sheets || []).filter((s) => sheetApplied(s) && s.date)
    return {
      course: course || null,
      region: location ? { lat: location.lat, lng: location.lng, name: location.name || location.address || null } : (courseInfo?.location || null),
      grasses,
      areaGrasses,
      data: {
        clipVolume: dailyAvg(clippings, 'volume', 30),
        greenSpeed: dailyAvg(speeds, 'speed', 30),
        soilTests: (soilTests || []).slice(-4).map((s) => ({ date: iso(s.date), area: s.area })),
      },
      products: (products || []).slice(0, 50).map((p) => ({ name: p?.name, type: p?.type, frac: p?.frac || p?.fracGroup || null })),
      recentSprays: applied.sort((a, b) => String(b.date).localeCompare(a.date)).slice(0, 10).map((s) => ({ date: iso(s.date), area: s.area, products: (s.products || []).map((p) => p.product).filter(Boolean) })),
      plannedApplications: (sheets || []).filter((s) => !sheetApplied(s)).slice(0, 12).map((s) => ({ date: iso(s.plannedDate || s.date), area: s.area, products: (s.products || []).map((p) => p.product).filter(Boolean) })),
      forecast: (daily || []).filter((d) => iso(d.date) >= todayIso && d.tMax != null).slice(0, 10).map((d) => ({ date: iso(d.date), hi: d.tMax, lo: d.tMin, precip: d.precip ?? d.rain ?? null })),
    }
  }

  async function generate() {
    try { window.speechSynthesis?.cancel() } catch {}; setSpeaking(false)
    setBusy(true); setErr('')
    try {
      const covered = Array.isArray(courseInfo?.aiBriefKeys) ? courseInfo.aiBriefKeys : []
      const res = await fetch('/api/turf-brief', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: buildContext(), covered }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Could not generate the brief.')
      setBrief(data.brief); setAt(data.generatedAt)
      const newKeys = Array.isArray(data.brief?.keys) ? data.brief.keys : []
      onSaveCourse?.({ aiBrief: { brief: data.brief, generatedAt: data.generatedAt }, aiBriefKeys: [...covered, ...newKeys].slice(-80) })
    } catch (e) { setErr(e.message || 'Something went wrong.') }
    setBusy(false)
  }

  function toggleAudio() {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : null
    if (!synth || !brief?.audioScript) return
    if (speaking) { synth.cancel(); setSpeaking(false); return }
    synth.cancel()
    const u = new SpeechSynthesisUtterance(brief.audioScript)
    u.rate = 1; u.pitch = 1
    u.onend = () => setSpeaking(false); u.onerror = () => setSpeaking(false)
    uRef.current = u; synth.speak(u); setSpeaking(true)
  }

  const monthDay = at ? new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
  const S = { paper: PAPER }

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', background: PAPER, borderRadius: 18, padding: '26px 22px 28px', border: `1px solid ${HAIR}` }}>
      {/* masthead */}
      <div style={{ textAlign: 'center', fontFamily: MONO, fontSize: 9.5, letterSpacing: '.3em', textTransform: 'uppercase', color: GOLDD }}>Weekly AI Report</div>
      <div style={{ fontFamily: DISP, fontWeight: 600, fontSize: 34, lineHeight: 1, textAlign: 'center', letterSpacing: '-.02em', margin: '8px 0 10px', color: INK }}>The Grounds Dispatch</div>
      <div style={{ height: 1, background: INK, opacity: .85 }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 9, letterSpacing: '.12em', textTransform: 'uppercase', color: INK3, padding: '7px 1px' }}>
        <span>{brief?.dateline || (course ? `${course}` : 'Your course')}</span>
        <span>{at ? new Date(at).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</span>
      </div>
      <div style={{ height: 1, background: HAIR }} />

      {/* controls / audio */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', margin: '14px 0 4px', border: `1px solid ${HAIR}`, borderRadius: 12, background: CARD }}>
        {brief && (
          <button onClick={toggleAudio} style={{ width: 36, height: 36, borderRadius: '50%', background: FOREST, color: '#fff', border: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', cursor: 'pointer' }}>
            {speaking ? <Pause size={15} /> : <Play size={15} style={{ marginLeft: 1 }} />}
          </button>
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: INK }}>{brief ? (speaking ? 'Reading aloud…' : 'Listen to this brief') : 'Weekly AI research brief'}</div>
          <div style={{ fontFamily: MONO, fontSize: 9.5, color: INK3, marginTop: 1, letterSpacing: '.04em' }}>{brief ? 'READ ALOUD FOR THE CART' : 'FAR-AND-WIDE · TARGETED TO YOUR REGION & GRASS'}</div>
        </div>
        <button onClick={generate} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 700, color: '#fff', background: FOREST, border: 0, borderRadius: 10, padding: '9px 13px', cursor: busy ? 'default' : 'pointer', opacity: busy ? .6 : 1 }}>
          {busy ? <><Loader2 size={14} className="animate-spin" /> Compiling…</> : brief ? <><RotateCcw size={13} /> New brief</> : <><Sparkles size={13} /> Generate</>}
        </button>
      </div>
      {busy && <p style={{ fontFamily: MONO, fontSize: 10, color: INK3, margin: '6px 2px' }}>Researching across extension, USGA and the journals for your region &amp; grasses…</p>}
      {err && <p style={{ fontSize: 12.5, color: EMBER, margin: '8px 2px' }}>{err}</p>}

      {brief ? (
        <>
          <div style={{ padding: '18px 0 6px' }}>
            <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '.24em', textTransform: 'uppercase', color: EMBER, marginBottom: 9 }}>{brief.hero?.eyebrow || "This week's call"}</div>
            <div style={{ fontFamily: DISP, fontWeight: 600, fontSize: 26, lineHeight: 1.1, letterSpacing: '-.015em', color: INK, textWrap: 'balance' }}>{brief.hero?.headline}</div>
            {brief.hero?.standfirst && <p style={{ fontSize: 14.5, lineHeight: 1.6, color: '#33322b', marginTop: 12 }}>{brief.hero.standfirst}</p>}
          </div>

          <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '.24em', textTransform: 'uppercase', color: INK3, textAlign: 'center', margin: '22px 0 2px' }}>The Field · this week's findings</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 0 2px' }}><span style={{ flex: 1, height: 1, background: HAIR }} /><span style={{ color: GOLDD, fontSize: 9 }}>✦</span><span style={{ flex: 1, height: 1, background: HAIR }} /></div>

          {(brief.findings || []).map((f, i) => (
            <div key={i} style={{ padding: '18px 0', borderTop: i ? `1px solid ${HAIR2}` : 0 }}>
              <span style={{ fontFamily: DISP, fontStyle: 'italic', fontSize: 15, color: GOLDD, fontWeight: 500 }}>{f.n || `${i + 1}.`}</span>
              <div style={{ fontFamily: DISP, fontWeight: 600, fontSize: 18.5, lineHeight: 1.2, letterSpacing: '-.01em', margin: '3px 0 7px', color: INK }}>{f.subhead}</div>
              <p style={{ fontSize: 13.5, lineHeight: 1.58, color: '#3a382f', margin: 0 }}>{f.body}</p>
              {f.take && <p style={{ fontFamily: DISP, fontStyle: 'italic', fontSize: 14, lineHeight: 1.5, color: FOREST, margin: '9px 0 0', paddingLeft: 12, borderLeft: `2px solid ${FERN}` }}>{f.take}</p>}
              {Array.isArray(f.sources) && f.sources.length > 0 && (
                <p style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.06em', color: INK3, marginTop: 9 }}>SOURCE · {f.sources.map((s) => s.name).filter(Boolean).join(' · ')}</p>
              )}
            </div>
          ))}

          <p style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '.05em', color: INK3, textAlign: 'center', marginTop: 18, lineHeight: 1.6 }}>
            Compiled from your {course || 'course'} data + this week's research, targeted to your region &amp; grass.<br />Verify rates against the label and local conditions before acting.
          </p>
        </>
      ) : !busy && (
        <p style={{ fontSize: 13, color: INK3, textAlign: 'center', padding: '26px 10px' }}>Tap <b style={{ color: INK }}>Generate</b> for this week's brief — researched far and wide, targeted to your weather-station region and grass types, and it won't repeat what it's told you before.</p>
      )}
    </div>
  )
}
