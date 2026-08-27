'use client'

// ── GROWTH MANAGEMENT ───────────────────────────────────────────────────────
// Manage the growth the plant can afford (Kreuser / GreenKeeper), for any
// surface:
//   • Greens (and other small surfaces) — MEASURED: clip volume vs a target
//     range, with Growth Potential as backdrop and program suppression.
//   • Fairways / rough — MODELED (no data collection): a growth index from
//     temperature (Growth Potential) × how much the PGR program is holding back.
//     It reads the trend — when the surface is surging vs. easing — without a
//     single clipping measured, the same way GreenKeeper estimates potential
//     clip volume without a check plot.
//
// Reuses what the app already has: clipping yields, the PGR/DMI suppression
// curves (lib/pgrmodel), spray history and the daily weather. Course-aware.
import { useState } from 'react'
import { TrendingUp, TrendingDown, Info, Leaf, Activity } from 'lucide-react'
import { gddSince } from '@/lib/weather'
import { localDateISO } from '@/lib/dates'
import { suppressionKind } from '@/lib/pgr'
import { modelForProduct, suppressionAt, combinedSuppression, withTargets } from '@/lib/pgrmodel'
import { sheetApplied } from '@/lib/applied'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#B9982F'
const RED = '#B23A2E'
const AMBER = '#B7791F'
const BLUE = '#2563EB'
const PAPER = '#F9F8F5'
const HAIR = '#E2E0DB'
const INK = '#1b2420'
const INK_2 = '#5B6160'
const INK_3 = '#8A8984'
const BAND = '#EEF3EE'

const tok = (s) => String(s || '').trim().split(/\s+/)[0].toLowerCase()
const round1 = (n) => Math.round(n * 10) / 10
const WARM = ['bermuda', 'zoysia', 'paspalum', 'seashore', 'kikuyu', 'st. augustine', 'buffalo']

// Surfaces the growth read can run on. `measured` = you collect clippings there;
// otherwise it's modeled from weather + PGR only. `sk` maps to the PGR curve.
const SURFACES = [
  { key: 'greens', label: 'Greens', re: /green/i, sk: 'green', measured: true },
  { key: 'tees', label: 'Tees', re: /\btee/i, sk: 'tee', measured: true },
  { key: 'approaches', label: 'Approaches', re: /approach|collar/i, sk: 'green', measured: true },
  { key: 'fairways', label: 'Fairways', re: /fairway|fwy|f'?way/i, sk: 'fairway', measured: false },
  { key: 'rough', label: 'Rough', re: /rough/i, sk: 'rough', measured: false },
]

// PACE Growth Potential: a 0–1 index of the plant's theoretical ability to make
// sugar at a given mean temperature. Bell curve around the species' optimum.
function growthPotential(meanC, warm) {
  const [topt, variance] = warm ? [31, 7] : [20, 5.5]
  return Math.exp(-0.5 * ((meanC - topt) / variance) ** 2)
}
const meanC = (d) => (d.tMax != null && d.tMin != null ? ((d.tMax + d.tMin) / 2 - 32) / 1.8 : null)
function avgDailyGdd(daily) {
  const rows = (daily || []).filter((d) => d.tMax != null && d.tMin != null).slice(-10)
  if (!rows.length) return 15
  const g = rows.reduce((s, d) => s + Math.max(0, (d.tMax + d.tMin) / 2 - 32), 0) / rows.length
  return g || 15
}

export default function Growth({ daily = [], clippings = [], sheets = [], products = [], areas = {}, courseInfo = {}, onSaveCourse, courseFilter = '' }) {
  const growth = courseInfo.growth || {}
  const pgrTargets = courseInfo.pgrTargets || {}
  const inCourse = (n) => !courseFilter || tok(n) === tok(courseFilter)

  // Which surfaces this course actually has areas for.
  const availSurfs = SURFACES.filter((s) => Object.keys(areas).some((n) => s.re.test(n) && inCourse(n)))
  const surfList = availSurfs.length ? availSurfs : [SURFACES[0]]
  const [surfaceKey, setSurfaceKey] = useState(surfList[0].key)
  const surf = surfList.find((s) => s.key === surfaceKey) || surfList[0]
  const isSurf = (n) => surf.re.test(n) && inCourse(n)
  const surfAreas = Object.keys(areas).filter(isSurf)

  // Cool- vs warm-season curve, judged by THIS surface's grass.
  const surfGrasses = surfAreas.flatMap((n) => areas[n]?.grasses || [])
  const grassPool = surfGrasses.length ? surfGrasses : (courseInfo.siteGrasses || [])
  const warm = grassPool.some((g) => WARM.some((w) => String(g).toLowerCase().includes(w)))

  // ── Growth Potential series (this year → today) ──────────────────────────
  const year = String(new Date().getFullYear())
  const today = localDateISO()
  const gpSeries = (daily || [])
    .filter((d) => d.date && d.date.startsWith(year) && d.date <= today && meanC(d) != null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ date: d.date, gp: growthPotential(meanC(d), warm) }))
  const gpNow = gpSeries.length ? gpSeries[gpSeries.length - 1].gp : null
  const gpPct = gpNow == null ? null : Math.round(gpNow * 100)

  // ── Measured clip volume for this surface (may be empty on big areas) ─────
  const clipRows = (clippings || [])
    .filter((c) => c.date && c.volume != null && isSurf(c.area))
    .sort((a, b) => b.date.localeCompare(a.date))
  const hasClip = clipRows.length > 0
  const unit = clipRows[0]?.unit || 'mL'
  const recent = clipRows.slice(0, 5)
  const clipAvg = recent.length ? round1(recent.reduce((s, c) => s + Number(c.volume || 0), 0) / recent.length) : null
  const range = growth[surf.key] || {}
  const clipLow = range.clipLow ?? (surf.key === 'greens' ? (growth.clipLow ?? '') : '')
  const clipHigh = range.clipHigh ?? (surf.key === 'greens' ? (growth.clipHigh ?? '') : '')
  let clipStatus = 'none'
  if (clipAvg != null && (clipLow !== '' || clipHigh !== '')) {
    if (clipHigh !== '' && clipAvg > Number(clipHigh)) clipStatus = 'above'
    else if (clipLow !== '' && clipAvg < Number(clipLow)) clipStatus = 'below'
    else clipStatus = 'in'
  }

  // ── Program suppression on this surface (PGR/DMI curve engine) ────────────
  const supMap = {}
  ;(products || []).forEach((p) => { const k = suppressionKind(p); if (k) supMap[p.name] = k })
  const regByArea = {}
  ;(sheets || []).filter((s) => sheetApplied(s) && s.date && isSurf(s.area)).forEach((s) => {
    ;(s.products || []).forEach((p) => {
      if (!supMap[p.product]) return
      const a = regByArea[s.area] = regByArea[s.area] || {}
      if (!a[p.product] || s.date > a[p.product]) a[p.product] = s.date
    })
  })
  const prodMap = {}
  Object.values(regByArea).forEach((byProd) => Object.entries(byProd).forEach(([name, date]) => {
    if (!prodMap[name] || date > prodMap[name]) prodMap[name] = date
  }))
  const prodRows = Object.entries(prodMap).map(([name, date]) => {
    const prod = (products || []).find((p) => p.name === name) || { name }
    const base = modelForProduct(prod, supMap[name])
    const model = withTargets(base, pgrTargets[base?.id])
    const gdd = gddSince(daily, date, 32) || 0
    const sup = model ? suppressionAt(model, gdd, surf.sk) : 0
    const gddPrev = Math.max(0, gdd - avgDailyGdd(daily) * 5)
    const supPrev = model ? suppressionAt(model, gddPrev, surf.sk) : 0
    return { name, kind: supMap[name], sup, up: sup >= supPrev }
  }).filter((r) => r.sup > 0.005).sort((a, b) => b.sup - a.sup)

  const combined = combinedSuppression(prodRows.map((r) => ({ suppression: r.sup })))
  const combinedPct = Math.round(combined * 100)
  const potential = hasClip && clipAvg != null && combined < 1 ? round1(clipAvg / (1 - combined)) : null

  // Modeled growth index (0–100): how hard the surface is pushing right now =
  // its sugar-making capacity (GP) net of how much the program is holding back.
  const modeled = gpNow != null ? Math.round(gpNow * (1 - combined) * 100) : null
  const modeledSeries = gpSeries.map((d) => ({ date: d.date, v: d.gp * (1 - combined) }))

  const save = (patch) => onSaveCourse && onSaveCourse({ growth: { ...growth, [surf.key]: { ...(growth[surf.key] || {}), ...patch } } })

  return (
    <div className="max-w-5xl">
      <h2 className="font-display text-lg font-semibold" style={{ color: INK }}>Growth Management{courseFilter ? ` — ${courseFilter}` : ''}</h2>
      <p className="font-body text-xs mb-4" style={{ color: INK_3 }}>Growth Potential is the backdrop; the PGR program is the read-out. Measured on greens, modeled on the big areas.</p>

      {/* Surface selector */}
      {surfList.length > 1 && (
        <div className="flex gap-1.5 mb-4 flex-wrap">
          {surfList.map((s) => (
            <button key={s.key} onClick={() => setSurfaceKey(s.key)} className="font-body text-xs font-bold px-3.5 py-2 rounded-full transition"
              style={s.key === surf.key ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: INK_2, border: `1px solid ${HAIR}` }}>
              {s.label}{!s.measured && <span style={{ opacity: 0.6, fontWeight: 500 }}> · modeled</span>}
            </button>
          ))}
        </div>
      )}

      {/* Headline tiles */}
      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(215px,1fr))' }}>
        {surf.measured && (
          <QuestionTile
            label="Clip volume · 5-day avg" value={clipAvg != null ? `${clipAvg}` : '—'} unit={clipAvg != null ? unit : ''}
            status={clipStatus}
            range={clipLow !== '' || clipHigh !== '' ? `target ${clipLow || '—'}–${clipHigh || '—'} ${unit}` : (hasClip ? 'set a target range below' : 'log a few greens to start')}
          />
        )}
        <ModeledTile modeled={modeled} measured={surf.measured} label={surf.label} />
        <GpTile gpPct={gpPct} warm={warm} />
      </div>

      {/* Program suppression card */}
      <div className="paper-card overflow-hidden mb-4" style={{ padding: 0 }}>
        <div className="px-4 py-3" style={{ borderBottom: `1px solid ${HAIR}` }}>
          <span className="font-body text-sm font-bold" style={{ color: INK }}>Program suppression · {surf.label.toLowerCase()}</span>
        </div>
        <div className="flex gap-7 px-4 py-3 flex-wrap" style={{ borderBottom: `1px solid ${HAIR}` }}>
          <div>
            <div className="font-body text-[10px] font-bold uppercase tracking-widest" style={{ color: INK_3 }}>Total clip-yield suppression</div>
            <div className="font-display text-[24px] font-semibold tnum" style={{ color: FOREST }}>{prodRows.length ? `${combinedPct}%` : '—'}</div>
          </div>
          {surf.measured && (
            <div>
              <div className="font-body text-[10px] font-bold uppercase tracking-widest" style={{ color: INK_3 }}>Est. clippings without PGRs</div>
              <div className="font-display text-[24px] font-semibold tnum" style={{ color: FOREST }}>{potential != null ? `${potential}` : '—'}<span className="font-body text-[12px] font-semibold" style={{ color: INK_2 }}>{potential != null ? ` ${unit}` : ''}</span></div>
            </div>
          )}
        </div>
        {prodRows.length === 0 ? (
          <div className="px-4 py-4 font-body text-[12.5px]" style={{ color: INK_3 }}>No regulating sprays logged on {surf.label.toLowerCase()} yet — log a PGR on a {surf.label.toLowerCase()} spray sheet and this fills in.</div>
        ) : (
          <table className="w-full" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th className="text-left font-body text-[10px] font-bold uppercase tracking-wide px-4 py-2" style={{ color: INK_3 }}>Product</th>
                <th className="text-right font-body text-[10px] font-bold uppercase tracking-wide px-4 py-2" style={{ color: INK_3 }}>Suppression</th>
                <th className="text-right font-body text-[10px] font-bold uppercase tracking-wide px-4 py-2" style={{ color: INK_3 }}>Trending</th>
              </tr>
            </thead>
            <tbody>
              {prodRows.map((r) => (
                <tr key={r.name} style={{ borderTop: `1px solid ${HAIR}` }}>
                  <td className="px-4 py-2.5 font-body text-[13.5px] font-semibold" style={{ color: INK }}>
                    {r.name}{r.kind === 'dmi' && <span className="font-body text-[11px] font-normal" style={{ color: INK_3 }}> · growth-reg fungicide</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-body text-[13.5px] tnum" style={{ color: INK }}>{Math.round(r.sup * 100)}%</td>
                  <td className="px-4 py-2.5 text-right">
                    {r.up ? <TrendingUp size={15} style={{ color: FERN, display: 'inline' }} /> : <TrendingDown size={15} style={{ color: RED, display: 'inline' }} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Trend chart */}
      {gpSeries.length > 3 && (
        <div className="paper-card p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="font-body text-sm font-bold" style={{ color: INK }}>{surf.measured ? 'Growth Potential · this season' : `Modeled ${surf.label.toLowerCase()} growth · this season`}</span>
            <span className="font-body text-[11px]" style={{ color: INK_3 }}>
              <span style={{ color: FERN }}>■</span> Growth Potential
              {!surf.measured && <><span style={{ color: GOLD, marginLeft: 8 }}>■</span> after PGR</>}
              {hasClip && <><span style={{ color: BLUE, marginLeft: 8 }}>●</span> clip readings</>}
            </span>
          </div>
          <GrowthChart gpSeries={gpSeries} modeledSeries={surf.measured ? null : modeledSeries} clipRows={clipRows} />
        </div>
      )}

      {/* Guidance */}
      <div className="paper-card p-4 mb-4" style={{ borderLeft: `3px solid ${flagColor(surf, clipStatus, gpPct, modeled)}` }}>
        <div className="flex gap-2.5 items-start">
          <Info size={16} className="shrink-0 mt-0.5" style={{ color: flagColor(surf, clipStatus, gpPct, modeled) }} />
          <p className="font-body text-[13.5px]" style={{ color: INK }}>{guidance(surf, { clipStatus, gpPct, combinedPct, modeled, hasProgram: prodRows.length > 0, hasClip })}</p>
        </div>
      </div>

      {/* Target range — only for surfaces you measure */}
      {surf.measured && (
        <div className="paper-card p-4">
          <p className="font-display text-base font-semibold mb-1" style={{ color: INK }}>{surf.label} clip-volume target range</p>
          <p className="font-body text-[12.5px] mb-3" style={{ color: INK_3 }}>The 5-day average you want to hold on {surf.label.toLowerCase()} — the balance of speed, recovery and stress tolerance. In {unit} per reading.</p>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="font-body text-[10px] font-bold uppercase tracking-wide block mb-0.5" style={{ color: INK_3 }}>Low</label>
              <input inputMode="decimal" defaultValue={clipLow} onBlur={(e) => save({ clipLow: e.target.value })} placeholder="e.g. 250" className="w-28 rounded-lg px-3 py-2 text-sm font-body tnum" style={{ border: `1px solid ${HAIR}`, backgroundColor: 'white' }} />
            </div>
            <span className="font-body text-sm pb-2" style={{ color: INK_3 }}>to</span>
            <div>
              <label className="font-body text-[10px] font-bold uppercase tracking-wide block mb-0.5" style={{ color: INK_3 }}>High</label>
              <input inputMode="decimal" defaultValue={clipHigh} onBlur={(e) => save({ clipHigh: e.target.value })} placeholder="e.g. 400" className="w-28 rounded-lg px-3 py-2 text-sm font-body tnum" style={{ border: `1px solid ${HAIR}`, backgroundColor: 'white' }} />
            </div>
            <span className="font-body text-[12px] pb-2" style={{ color: INK_3 }}>{unit} per reading</span>
          </div>
        </div>
      )}
    </div>
  )
}

function QuestionTile({ label, value, unit, status, range }) {
  const style = {
    in: { color: FERN, chip: 'In range', bg: BAND },
    above: { color: RED, chip: 'Above range', bg: '#FBEAE7' },
    below: { color: AMBER, chip: 'Below range', bg: '#FBF3E2' },
    none: { color: INK, chip: null, bg: BAND },
  }[status] || { color: INK, chip: null, bg: BAND }
  return (
    <div className="paper-card p-4">
      <div className="font-body text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: INK_3 }}>{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[30px] font-semibold tnum" style={{ color: style.color }}>{value}</span>
        <span className="font-body text-[13px] font-semibold" style={{ color: INK_2 }}>{unit}</span>
        {style.chip && <span className="ml-auto font-body text-[11px] font-extrabold uppercase tracking-wide px-2.5 py-1 rounded-full" style={{ color: style.color, backgroundColor: style.bg }}>{style.chip}</span>}
      </div>
      <div className="font-body text-[12px] mt-1" style={{ color: INK_3 }}>{range}</div>
    </div>
  )
}

// Modeled growth index — the headline for surfaces you don't measure.
function ModeledTile({ modeled, measured, label }) {
  const high = modeled != null && modeled >= 55
  const easing = modeled != null && modeled < 30
  const color = high ? AMBER : easing ? FERN : INK
  const chip = modeled == null ? null : high ? 'Pushing hard' : easing ? 'Easing off' : 'Moderate'
  return (
    <div className="paper-card p-4">
      <div className="font-body text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: INK_3 }}>Modeled growth · {measured ? 'now' : label.toLowerCase()}</div>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[30px] font-semibold tnum" style={{ color }}>{modeled != null ? `${modeled}%` : '—'}</span>
        <Activity size={15} style={{ color }} />
        {chip && <span className="ml-auto font-body text-[11px] font-extrabold uppercase tracking-wide px-2.5 py-1 rounded-full" style={{ color, backgroundColor: high ? '#FBF3E2' : easing ? BAND : BAND }}>{chip}</span>}
      </div>
      <div className="font-body text-[12px] mt-1" style={{ color: INK_3 }}>temperature × PGR{measured ? '' : ' · no data needed'}</div>
    </div>
  )
}

function GpTile({ gpPct, warm }) {
  const low = gpPct != null && gpPct < 50
  return (
    <div className="paper-card p-4">
      <div className="font-body text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: INK_3 }}>Growth Potential · today</div>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[30px] font-semibold tnum" style={{ color: low ? AMBER : FERN }}>{gpPct != null ? `${gpPct}%` : '—'}</span>
        <Leaf size={16} style={{ color: low ? AMBER : FERN }} />
        {low && <span className="ml-auto font-body text-[11px] font-extrabold uppercase tracking-wide px-2.5 py-1 rounded-full" style={{ color: AMBER, backgroundColor: '#FBF3E2' }}>Low sugar</span>}
      </div>
      <div className="font-body text-[12px] mt-1" style={{ color: INK_3 }}>{warm ? 'Warm-season curve' : 'Cool-season curve'} · theoretical sugar production</div>
    </div>
  )
}

// GP area (0–100%) over the season; optional modeled "after PGR" line and clip dots.
function GrowthChart({ gpSeries, modeledSeries, clipRows }) {
  const W = 640, H = 150, padL = 4, padR = 4, padT = 8, padB = 18
  const iw = W - padL - padR, ih = H - padT - padB
  const dates = gpSeries.map((d) => d.date)
  const t0 = new Date(dates[0] + 'T00:00:00').getTime()
  const t1 = new Date(dates[dates.length - 1] + 'T00:00:00').getTime()
  const span = Math.max(1, t1 - t0)
  const x = (iso) => padL + ((new Date(iso + 'T00:00:00').getTime() - t0) / span) * iw
  const yv = (v) => padT + (1 - v) * ih
  const area = `M${x(dates[0]).toFixed(1)},${(padT + ih).toFixed(1)} ` +
    gpSeries.map((d) => `L${x(d.date).toFixed(1)},${yv(d.gp).toFixed(1)}`).join(' ') +
    ` L${x(dates[dates.length - 1]).toFixed(1)},${(padT + ih).toFixed(1)} Z`
  const line = gpSeries.map((d, i) => `${i ? 'L' : 'M'}${x(d.date).toFixed(1)},${yv(d.gp).toFixed(1)}`).join(' ')
  const mLine = modeledSeries ? modeledSeries.map((d, i) => `${i ? 'L' : 'M'}${x(d.date).toFixed(1)},${yv(d.v).toFixed(1)}`).join(' ') : null
  const clipMax = Math.max(1, ...clipRows.map((c) => Number(c.volume) || 0))
  const monthTicks = []
  let cur = new Date(t0); cur.setDate(1)
  while (cur.getTime() <= t1) {
    const iso = cur.toISOString().slice(0, 10)
    if (cur.getTime() >= t0) monthTicks.push({ x: x(iso), label: cur.toLocaleDateString('en-US', { month: 'short' }) })
    cur.setMonth(cur.getMonth() + 1)
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 420, maxWidth: 760, display: 'block' }}>
        {[0, 0.5, 1].map((g) => <line key={g} x1={padL} x2={W - padR} y1={yv(g)} y2={yv(g)} stroke={HAIR} strokeWidth="1" />)}
        <path d={area} fill="rgba(58,107,74,0.13)" />
        <path d={line} fill="none" stroke={FERN} strokeWidth="2" strokeLinejoin="round" />
        {mLine && <path d={mLine} fill="none" stroke={GOLD} strokeWidth="2" strokeLinejoin="round" />}
        {clipRows.map((c, i) => {
          const cy = padT + (1 - (Number(c.volume) || 0) / clipMax) * ih
          return <circle key={i} cx={x(c.date)} cy={cy} r="2.6" fill={BLUE} fillOpacity="0.8" />
        })}
        {monthTicks.map((t, i) => <text key={i} x={t.x} y={H - 5} fontSize="9" fill={INK_3} textAnchor="middle" fontFamily="Inter,sans-serif">{t.label}</text>)}
      </svg>
    </div>
  )
}

function flagColor(surf, clipStatus, gpPct, modeled) {
  if (!surf.measured) return modeled != null && modeled >= 55 ? AMBER : FERN
  if (clipStatus === 'above' && gpPct != null && gpPct < 50) return RED
  if (clipStatus === 'above' || clipStatus === 'below') return AMBER
  if (clipStatus === 'in') return FERN
  return INK_3
}

function guidance(surf, { clipStatus, gpPct, combinedPct, modeled, hasProgram, hasClip }) {
  // Modeled surfaces (fairways / rough) — no clipping collection.
  if (!surf.measured) {
    const s = surf.label
    if (modeled == null) return `Set your course location in Settings so the weather can drive the ${s.toLowerCase()} growth model.`
    if (modeled >= 55) return `${s} are pushing hard right now (modeled growth ${modeled}%). Expect heavy mowing and clippings. ${hasProgram ? `The PGR is holding ~${combinedPct}%, but ` : ''}a shorter interval or higher rate would keep it in check — and go easy on nitrogen.`
    if (modeled >= 30) return `${s} growing at a moderate pace (modeled ${modeled}%).${hasProgram ? ` Program holding ~${combinedPct}%.` : ''} Normal mowing; keep the PGR on schedule.`
    return `${s} growth is easing (modeled ${modeled}%) — cooler temperatures${hasProgram ? ' plus the PGR' : ''} are slowing it down. A good time to stretch intervals and ramp the program back.`
  }
  // Measured surfaces (greens etc.).
  const lowGp = gpPct != null && gpPct < 50
  if (clipStatus === 'above' && lowGp) return `Growth is above your range while Growth Potential is low (${gpPct}%) — the plant is making leaves on stored sugar it can't replace. Tighten the PGR interval, raise the rate, or combine active ingredients. Hold nitrogen.`
  if (clipStatus === 'above') return `Clip volume is above your target range. ${hasProgram ? `Your program is holding back ~${combinedPct}% already — ` : ''}more regulation is usually a better first move than nitrogen.`
  if (clipStatus === 'below') return `Clip volume is below your target range — growth may be over-regulated. As it cools, PGRs last longer and stack; consider easing the rate.`
  if (clipStatus === 'in') return `Growth is in your target range — the program is doing its job.${hasProgram ? ` It's holding back about ${combinedPct}% right now.` : ''}`
  if (!hasClip) return `Log a few days of ${surf.label.toLowerCase()} clipping volume and set a target range, and this will tell you whether growth is where you want it — and how much the PGR program is holding back. The modeled read above works right now with no data.`
  return `Set a target range below and this will read whether growth is where you want it.`
}
