'use client'

// ── AI Turf Brief ───────────────────────────────────────────────────────────
// On-demand weekly brief. Assembles a compact summary of the club's own data
// (trends, products + FRAC groups, recent & planned sprays, forecast, soil,
// program) and asks /api/turf-brief to research recent turf findings and write
// a decision brief grounded in THIS course. Phase 1: generate & review in-app.
import { useState } from 'react'
import { Sparkles, Loader2, RefreshCw, Copy, Check } from 'lucide-react'
import { sheetApplied } from '@/lib/applied'
import { FOREST, FERN, GOLD, INK, INK_2, INK_3, HAIR, PAPER } from '@/lib/theme'

const iso = (d) => String(d || '').slice(0, 10)

// average a metric to one point per day, keep the most recent `days` days
function dailyAvg(rows, field, days = 30) {
  const byDay = {}
  ;(rows || []).forEach((r) => { const v = Number(r?.[field]); if (!r?.date || isNaN(v)) return; (byDay[iso(r.date)] = byDay[iso(r.date)] || { s: 0, n: 0 }); byDay[iso(r.date)].s += v; byDay[iso(r.date)].n++ })
  return Object.keys(byDay).sort().slice(-days).map((d) => ({ date: d, avg: Math.round((byDay[d].s / byDay[d].n) * 100) / 100 }))
}
function soilNums(s) {
  const out = {}
  Object.entries(s || {}).forEach(([k, v]) => { if (['id', 'date', 'area', 'course', 'createdAt'].includes(k)) return; if (v != null && v !== '' && !isNaN(Number(v))) out[k] = Number(v) })
  return out
}

// tiny markdown → React (headings, bold, bullet/numbered lists, paragraphs)
function md(text) {
  const lines = String(text || '').split('\n')
  const out = []; let list = null; let key = 0
  const flush = () => { if (list) { out.push(<ul key={key++} style={{ margin: '6px 0 10px', paddingLeft: 18 }}>{list}</ul>); list = null } }
  const inline = (s) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : p)
  for (const raw of lines) {
    const l = raw.trimEnd()
    if (/^#{1,6}\s/.test(l)) { flush(); const t = l.replace(/^#+\s/, ''); out.push(<p key={key++} className="font-display" style={{ color: FOREST, fontWeight: 600, fontSize: 15, margin: '14px 0 4px' }}>{inline(t)}</p>); continue }
    if (/^\s*[-*]\s+/.test(l)) { list = list || []; list.push(<li key={key++} style={{ margin: '2px 0', color: INK_2, fontSize: 13.5 }}>{inline(l.replace(/^\s*[-*]\s+/, ''))}</li>); continue }
    if (/^\s*\d+\.\s+/.test(l)) { list = list || []; list.push(<li key={key++} style={{ margin: '2px 0', color: INK_2, fontSize: 13.5 }}>{inline(l.replace(/^\s*\d+\.\s+/, ''))}</li>); continue }
    if (!l.trim()) { flush(); continue }
    flush(); out.push(<p key={key++} style={{ color: INK_2, fontSize: 13.5, lineHeight: 1.55, margin: '4px 0' }}>{inline(l)}</p>)
  }
  flush(); return out
}

export default function TurfBrief({ daily = [], clippings = [], speeds = [], soilTests = [], sheets = [], practices = [], products = [], areas = {}, courseInfo = {}, course = '', onSaveCourse }) {
  const saved = courseInfo?.aiBrief && typeof courseInfo.aiBrief === 'object' ? courseInfo.aiBrief : null
  const [brief, setBrief] = useState(saved?.text || '')
  const [at, setAt] = useState(saved?.generatedAt || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)

  function buildContext() {
    const today = new Date().toISOString().slice(0, 10)
    const courses = (Array.isArray(courseInfo?.courses) ? courseInfo.courses : []).map((c) => ({ name: c?.name, holes: c?.holes, grasses: c?.grasses }))
    const areaGrasses = {}; Object.entries(areas || {}).forEach(([n, a]) => { if (a?.grasses?.length) areaGrasses[n] = a.grasses })
    const applied = (sheets || []).filter((s) => sheetApplied(s) && s.date)
    return {
      course: course || null,
      courses,
      siteGrasses: courseInfo?.siteGrasses || [],
      areaGrasses,
      dataTrends: {
        clipVolume: dailyAvg(clippings, 'volume', 30),
        greenSpeed: dailyAvg(speeds, 'speed', 30),
        soilTests: (soilTests || []).slice(-6).map((s) => ({ date: iso(s.date), area: s.area, ...soilNums(s) })),
      },
      products: (products || []).slice(0, 60).map((p) => ({ name: p?.name, type: p?.type, frac: p?.frac || p?.fracGroup || p?.frac_group || null, ai: p?.ai || p?.activeIngredient || null, rei: p?.rei ?? null, phi: p?.phi ?? null })),
      recentSprays: applied.sort((a, b) => String(b.date).localeCompare(a.date)).slice(0, 12).map((s) => ({ date: iso(s.date), area: s.area, products: (s.products || []).map((p) => p.product).filter(Boolean) })),
      plannedApplications: (sheets || []).filter((s) => !sheetApplied(s)).slice(0, 15).map((s) => ({ date: iso(s.plannedDate || s.date), area: s.area, products: (s.products || []).map((p) => p.product).filter(Boolean) })),
      recentPractices: (practices || []).slice(-8).map((p) => ({ date: iso(p.date), area: p.area, type: p.type || p.kind, notes: p.notes })),
      forecast: (daily || []).filter((d) => iso(d.date) >= today && d.tMax != null).slice(0, 10).map((d) => ({ date: iso(d.date), hi: d.tMax, lo: d.tMin, precip: d.precip ?? d.rain ?? null })),
      recentWeather: (daily || []).filter((d) => iso(d.date) < today && d.tMax != null).slice(-7).map((d) => ({ date: iso(d.date), hi: d.tMax, lo: d.tMin })),
    }
  }

  async function generate() {
    setBusy(true); setErr('')
    try {
      const res = await fetch('/api/turf-brief', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: buildContext() }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Could not generate the brief.')
      setBrief(data.brief); setAt(data.generatedAt)
      onSaveCourse?.({ aiBrief: { text: data.brief, generatedAt: data.generatedAt } })
    } catch (e) { setErr(e.message || 'Something went wrong.') }
    setBusy(false)
  }

  const copy = async () => { try { await navigator.clipboard.writeText(brief); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {} }
  const whenTxt = at ? new Date(at).toLocaleString() : ''

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles size={18} style={{ color: GOLD }} />
        <h2 className="font-display text-lg font-semibold" style={{ color: INK }}>AI Turf Brief</h2>
      </div>
      <p className="font-body text-xs mb-3" style={{ color: INK_3 }}>A weekly read on your own data, spray program, incoming weather and recent turf research — grounded in this course{course ? ` (${course})` : ''}. Research items are AI-gathered: verify against the label and local conditions before acting.</p>

      <div className="rounded-2xl border p-4 shadow-sm" style={{ borderColor: HAIR, background: PAPER }}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button onClick={generate} disabled={busy} className="inline-flex items-center gap-2 font-body text-sm font-bold px-4 py-2.5 rounded-xl text-white disabled:opacity-60" style={{ backgroundColor: FOREST }}>
            {busy ? <><Loader2 size={16} className="animate-spin" /> Researching &amp; writing…</> : brief ? <><RefreshCw size={15} /> Regenerate this week's brief</> : <><Sparkles size={15} /> Generate this week's brief</>}
          </button>
          {brief && !busy && (
            <button onClick={copy} className="inline-flex items-center gap-1.5 font-body text-xs font-bold px-3 py-2 rounded-lg" style={{ color: FERN, border: `1px solid ${HAIR}` }}>
              {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
            </button>
          )}
        </div>
        {busy && <p className="font-body text-[11px] mt-2" style={{ color: INK_3 }}>This takes up to a minute or two — it's searching current research and reading your data.</p>}
        {err && <p className="font-body text-[12px] mt-3" style={{ color: '#B23A2E' }}>{err}</p>}
      </div>

      {brief && (
        <div className="rounded-2xl border p-5 shadow-sm mt-4" style={{ borderColor: HAIR, background: '#fff' }}>
          {whenTxt && <p className="font-body text-[10px] uppercase tracking-wide mb-2" style={{ color: INK_3 }}>Generated {whenTxt}</p>}
          {md(brief)}
        </div>
      )}
      {!brief && !busy && (
        <p className="font-body text-[12px] mt-4" style={{ color: INK_3 }}>No brief yet. Tap generate — it works best once you've logged some field data and set up your program.</p>
      )}
    </div>
  )
}
