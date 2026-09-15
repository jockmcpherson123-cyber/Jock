'use client'

// ── Weekly Report · "The Grounds Dispatch" ──────────────────────────────────
// A weekly read built entirely from THIS course's own data — clip yield, green
// speed, spray program / FRAC rotation, soil tests and the forecast. No web
// call, no API cost, instant. Reads itself aloud with the device voice (free).
import { useState, useEffect, useRef } from 'react'
import { Play, Pause, RotateCcw, Sparkles } from 'lucide-react'
import { sheetApplied } from '@/lib/applied'
import { FERN } from '@/lib/theme'

// editorial palette (paper-luxury, restrained)
const PAPER = '#F4F0E7', CARD = '#FBF9F3', INK = '#1B1B17', INK2 = '#57544a', INK3 = '#8f8b7d'
const HAIR = '#D9D3C4', HAIR2 = '#E7E2D5', FOREST = '#14251C', EMBER = '#A83C2C', GOLDD = '#9A7A16'
const DISP = "'Fraunces', Georgia, serif", MONO = "'IBM Plex Mono', ui-monospace, monospace"
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']
const iso = (d) => String(d || '').slice(0, 10)

function dailyAvg(rows, field, days = 30) {
  const by = {}
  ;(rows || []).forEach((r) => { const v = Number(r?.[field]); if (!r?.date || isNaN(v)) return; (by[iso(r.date)] = by[iso(r.date)] || { s: 0, n: 0 }); by[iso(r.date)].s += v; by[iso(r.date)].n++ })
  return Object.keys(by).sort().slice(-days).map((d) => ({ date: d, avg: Math.round((by[d].s / by[d].n) * 100) / 100 }))
}
function meanSlice(arr, a, b) { const s = arr.slice(a, b); if (!s.length) return null; return s.reduce((x, y) => x + y.avg, 0) / s.length }
function fmt(n, d = 0) { if (n == null || isNaN(n)) return '—'; const p = 10 ** d; return (Math.round(n * p) / p).toLocaleString() }

export default function TurfBrief({ daily = [], clippings = [], speeds = [], soilTests = [], sheets = [], practices = [], products = [], areas = {}, courseInfo = {}, course = '', location = null, onSaveCourse }) {
  const saved = courseInfo?.aiBrief && typeof courseInfo.aiBrief === 'object' && courseInfo.aiBrief.brief ? courseInfo.aiBrief : null
  const [brief, setBrief] = useState(saved?.brief || null)
  const [at, setAt] = useState(saved?.generatedAt || '')
  const [err, setErr] = useState('')
  const [speaking, setSpeaking] = useState(false)
  const uRef = useRef(null)

  useEffect(() => () => { try { window.speechSynthesis?.cancel() } catch {} }, [])

  // ── Build the whole brief from the course's own data ──────────────────────
  function buildLocalBrief() {
    const todayIso = new Date().toISOString().slice(0, 10)
    const region = location?.name || location?.address || courseInfo?.location?.name || null
    const areaGrasses = {}; Object.entries(areas || {}).forEach(([n, a]) => { if (a?.grasses?.length) areaGrasses[n] = a.grasses })
    const grasses = [...new Set([...(courseInfo?.siteGrasses || []), ...Object.values(areaGrasses).flat()])]

    const findings = []
    const alerts = [] // { sev, headline, standfirst }

    // Clip yield & growth trend
    const clipDaily = dailyAvg(clippings, 'volume', 30)
    const clipNow = meanSlice(clipDaily, -7), clipPrev = meanSlice(clipDaily, -14, -7)
    if (clipNow != null) {
      let body, take
      if (clipPrev != null && clipPrev > 0) {
        const pct = Math.round(((clipNow - clipPrev) / clipPrev) * 100)
        const dir = pct > 3 ? 'up' : pct < -3 ? 'down' : 'flat'
        body = `Greens clip yield is averaging ${fmt(clipNow, 1)} over the last week` + (dir === 'flat' ? `, holding steady on the week before.` : `, ${Math.abs(pct)}% ${dir} on the previous week.`)
        if (dir === 'up') { take = `Growth is climbing — tighten the growth-reg interval or rate before you chase it with mowing, and hold the nitrogen.`; alerts.push({ sev: 2, headline: `Growth is climbing — clip yield up ${pct}% on the week.`, standfirst: `Your greens are outrunning last week by ${pct}%. Tighten the growth-reg interval or rate before it turns into extra mowing, and ease off the nitrogen.` }) }
        else if (dir === 'down') { take = `Growth is easing — a good window to stretch intervals and let the program ride.` }
        else { take = `Growth is right where you want it. Keep the program on schedule.` }
      } else {
        body = `Greens clip yield is averaging ${fmt(clipNow, 1)} over the last week.`
        take = `Log another week or two and this will call the trend and the growth-reg move for you.`
      }
      findings.push({ subhead: 'Clip yield & growth', body, take, sources: [{ name: 'Your clipping log' }] })
    }

    // Green speed trend
    const spDaily = dailyAvg(speeds, 'speed', 30)
    const spNow = meanSlice(spDaily, -7), spPrev = meanSlice(spDaily, -14, -7)
    if (spNow != null) {
      let body, take
      if (spPrev != null) {
        const diff = Math.round((spNow - spPrev) * 10) / 10
        body = `Green speed is averaging ${fmt(spNow, 1)}′ this week` + (Math.abs(diff) < 0.15 ? `, steady on last week.` : `, ${diff > 0 ? 'up' : 'down'} ${Math.abs(diff)}′ on last week.`)
        take = diff > 0.3 ? `Trending fast — keep an eye on plant health if you keep pushing.` : diff < -0.3 ? `Off the pace — a light roll or groom brings it back without stressing the turf.` : `Right in the zone.`
      } else { body = `Green speed is averaging ${fmt(spNow, 1)}′ this week.`; take = `Keep logging and the trend fills in.` }
      findings.push({ subhead: 'Green speed', body, take, sources: [{ name: 'Your green-speed log' }] })
    }

    // FRAC rotation check
    const fracOf = (name) => { const p = (products || []).find((p) => p?.name === name); const f = p?.frac || p?.fracGroup; return f ? String(f) : null }
    const applied = (sheets || []).filter((s) => sheetApplied(s) && s.date).sort((a, b) => String(b.date).localeCompare(a.date))
    const byArea = {}
    applied.forEach((s) => { const a = s.area || 'the course'; (byArea[a] = byArea[a] || []).push(s) })
    let fracFlag = null
    for (const [area, list] of Object.entries(byArea)) {
      if (list.length < 2) continue
      const fr = (s) => new Set((s.products || []).map((p) => fracOf(p.product || p.name)).filter(Boolean))
      const a = fr(list[0]), b = fr(list[1]); const common = [...a].filter((x) => b.has(x))
      if (common.length) { fracFlag = { area, frac: common }; break }
    }
    if (fracFlag) {
      findings.push({ subhead: 'Fungicide rotation', body: `Your last two sprays on ${fracFlag.area} both leaned on FRAC group ${fracFlag.frac.join(', ')}.`, take: `Rotate the mode of action next round to keep resistance in check.`, sources: [{ name: 'Your spray sheets' }] })
      alerts.push({ sev: 2, headline: `Rotate your ${fracFlag.area} fungicide group next round.`, standfirst: `Your last two ${fracFlag.area} sprays both used FRAC ${fracFlag.frac.join(', ')}. Switch the mode of action on the next application before you build resistance.` })
    }

    // The week ahead (forecast)
    const fc = (daily || []).filter((d) => iso(d.date) >= todayIso && d.tMax != null).slice(0, 6)
    if (fc.length) {
      const his = fc.map((d) => Number(d.tMax)).filter((n) => !isNaN(n))
      const peak = his.length ? Math.max(...his) : null
      const wetDays = fc.filter((d) => { const p = Number(d.precip ?? d.rain); return !isNaN(p) && p >= 2 }).length
      let body = `Next few days: highs to ${fmt(peak)}°.` + (wetDays ? ` ${wetDays} day${wetDays > 1 ? 's' : ''} with rain in the window.` : ' Dry through the window.')
      let take
      if (peak != null && peak >= 28 && wetDays) { take = `Warm and wet — dollar spot and Pythium pressure will build. Keep the preventive interval tight; don't stretch it.`; alerts.push({ sev: 3, headline: `Warm and wet ahead — disease pressure is building.`, standfirst: `Highs near ${fmt(peak)}° with rain in the window is textbook dollar-spot and Pythium weather. Hold your preventive interval tight this week rather than stretching it.` }) }
      else if (peak != null && peak >= 28) take = `Heat's on — growth reg burns off faster, so the reapply clock speeds up. Watch the GDD & Growth tab.`
      else if (wetDays) take = `Rain coming — get any planned sprays down in the dry window, and expect a growth bump after.`
      else take = `Mild and settled — a clean window for whatever's planned.`
      findings.push({ subhead: 'The week ahead', body, take, sources: [{ name: 'Your weather-station forecast' }] })
    }

    // Soil test recency
    const lastSoil = (soilTests || []).map((s) => iso(s.date)).filter(Boolean).sort().slice(-1)[0]
    if (lastSoil) {
      const days = Math.round((Date.now() - new Date(lastSoil + 'T00:00:00').getTime()) / 86400000)
      if (days > 120) findings.push({ subhead: 'Soil testing', body: `Your last soil test was ${days} days ago.`, take: `You're due — a fresh test now keeps the fert program honest for the season ahead.`, sources: [{ name: 'Your soil tests' }] })
    }

    // Hero from the most urgent alert, else a steady-week read
    alerts.sort((a, b) => b.sev - a.sev)
    const top = alerts[0]
    const hero = top
      ? { eyebrow: "This week's call", headline: top.headline, standfirst: top.standfirst }
      : { eyebrow: "This week's read", headline: 'Steady week — the program is holding.', standfirst: `Nothing in your ${course || 'course'} data is flashing red this week.${findings.length ? ' The notes below are the fine-tuning.' : ' Log a bit more and the weekly read sharpens up.'}` }

    // Spoken version (device text-to-speech)
    const audioParts = [hero.headline.replace(/\.$/, '') + '.']
    if (hero.standfirst) audioParts.push(hero.standfirst)
    findings.slice(0, 3).forEach((f) => { if (f.take) audioParts.push(f.take) })
    audioParts.push(`That's your week. Verify rates against the label and local conditions before acting.`)

    const dateline = [course || null, region || (grasses.length ? grasses.join('/') : null)].filter(Boolean).join(' · ') || 'Your course'
    const title = `Weekly Report — ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`
    return { title, dateline, hero, findings: findings.map((f, i) => ({ n: ROMAN[i] || `${i + 1}`, ...f })), audioScript: audioParts.join(' ') }
  }

  function generate() {
    try { window.speechSynthesis?.cancel() } catch {}; setSpeaking(false)
    setErr('')
    try {
      const b = buildLocalBrief()
      if (!b.findings.length) { setErr('Log a few readings (clippings, green speed, sprays) and your weekly read will fill in.'); return }
      const generatedAt = new Date().toISOString()
      setBrief(b); setAt(generatedAt)
      onSaveCourse?.({ aiBrief: { brief: b, generatedAt } })
    } catch (e) { setErr(e.message || 'Something went wrong building the report.') }
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

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', background: PAPER, borderRadius: 18, padding: '26px 22px 28px', border: `1px solid ${HAIR}` }}>
      {/* masthead */}
      <div style={{ textAlign: 'center', fontFamily: MONO, fontSize: 9.5, letterSpacing: '.3em', textTransform: 'uppercase', color: GOLDD }}>Weekly Report · from your data</div>
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
          <div style={{ fontSize: 12.5, fontWeight: 600, color: INK }}>{brief ? (speaking ? 'Reading aloud…' : 'Listen to this report') : 'Weekly report from your data'}</div>
          <div style={{ fontFamily: MONO, fontSize: 9.5, color: INK3, marginTop: 1, letterSpacing: '.04em' }}>{brief ? 'READ ALOUD FOR THE CART' : 'CLIPPINGS · SPEED · PROGRAM · FORECAST'}</div>
        </div>
        <button onClick={generate} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 700, color: '#fff', background: FOREST, border: 0, borderRadius: 10, padding: '9px 13px', cursor: 'pointer' }}>
          {brief ? <><RotateCcw size={13} /> Refresh</> : <><Sparkles size={13} /> Generate</>}
        </button>
      </div>
      {err && <p style={{ fontSize: 12.5, color: EMBER, margin: '8px 2px' }}>{err}</p>}

      {brief ? (
        <>
          <div style={{ padding: '18px 0 6px' }}>
            <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '.24em', textTransform: 'uppercase', color: EMBER, marginBottom: 9 }}>{brief.hero?.eyebrow || "This week's call"}</div>
            <div style={{ fontFamily: DISP, fontWeight: 600, fontSize: 26, lineHeight: 1.1, letterSpacing: '-.015em', color: INK, textWrap: 'balance' }}>{brief.hero?.headline}</div>
            {brief.hero?.standfirst && <p style={{ fontSize: 14.5, lineHeight: 1.6, color: '#33322b', marginTop: 12 }}>{brief.hero.standfirst}</p>}
          </div>

          <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '.24em', textTransform: 'uppercase', color: INK3, textAlign: 'center', margin: '22px 0 2px' }}>The Field · this week's notes</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 0 2px' }}><span style={{ flex: 1, height: 1, background: HAIR }} /><span style={{ color: GOLDD, fontSize: 9 }}>✦</span><span style={{ flex: 1, height: 1, background: HAIR }} /></div>

          {(brief.findings || []).map((f, i) => (
            <div key={i} style={{ padding: '18px 0', borderTop: i ? `1px solid ${HAIR2}` : 0 }}>
              <span style={{ fontFamily: DISP, fontStyle: 'italic', fontSize: 15, color: GOLDD, fontWeight: 500 }}>{f.n || `${i + 1}.`}</span>
              <div style={{ fontFamily: DISP, fontWeight: 600, fontSize: 18.5, lineHeight: 1.2, letterSpacing: '-.01em', margin: '3px 0 7px', color: INK }}>{f.subhead}</div>
              <p style={{ fontSize: 13.5, lineHeight: 1.58, color: '#3a382f', margin: 0 }}>{f.body}</p>
              {f.take && <p style={{ fontFamily: DISP, fontStyle: 'italic', fontSize: 14, lineHeight: 1.5, color: FOREST, margin: '9px 0 0', paddingLeft: 12, borderLeft: `2px solid ${FERN}` }}>{f.take}</p>}
              {Array.isArray(f.sources) && f.sources.length > 0 && (
                <p style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.06em', color: INK3, marginTop: 9 }}>FROM · {f.sources.map((s) => s.name).filter(Boolean).join(' · ')}</p>
              )}
            </div>
          ))}

          <p style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '.05em', color: INK3, textAlign: 'center', marginTop: 18, lineHeight: 1.6 }}>
            Built from your {course || 'course'} data — clippings, green speed, spray program and forecast.<br />Verify rates against the label and local conditions before acting.
          </p>
        </>
      ) : (
        <p style={{ fontSize: 13, color: INK3, textAlign: 'center', padding: '26px 10px' }}>Tap <b style={{ color: INK }}>Generate</b> for this week's read — built straight from your own data: clip yield, green speed, spray program and the forecast. Instant, and free.</p>
      )}
    </div>
  )
}
