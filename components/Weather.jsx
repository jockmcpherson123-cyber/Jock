'use client'

// Weather tab: live local conditions, a short forecast, GDD accumulation, and
// disease-risk readouts (Dollar Spot, Brown Patch) computed from the weather.
// All from Open-Meteo using the club's saved location — no API key required.
import { useState, useEffect, useRef } from 'react'
import { Loader2, CloudRain, Thermometer, Droplets, TrendingUp, AlertTriangle, MapPin, Wind, Info } from 'lucide-react'
import { fetchWeather, dailyFromHourly, summarize, fetchSeasonDaily, fetchYearDaily, dailyFromForecastBlock, mergeDaily, gddFromDaily, fetchCurrent, sprayWindow, hourlyForDay, irrigationNeed, turfStress, fetchBreakdownTemps, buildRainYear, smithKernsModel, SK_THRESHOLD } from '@/lib/weather'
import { applicationTimings, soilTrend, currentSoilTemp } from '@/lib/soiltiming'
import { diseaseRisks, pestWatch } from '@/lib/pests'
import { profileById, photoSearchUrl } from '@/lib/knowledge'
import { localDateISO } from '@/lib/dates'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#C9A84C'

const RISK_STYLES = {
  low: { bg: '#E8F3EC', fg: FERN, label: 'Low' },
  moderate: { bg: '#FEF3DD', fg: '#92660D', label: 'Moderate' },
  high: { bg: '#FEE2E2', fg: '#DC2626', label: 'Elevated' },
}
const SPRAY_STYLES = {
  good: { bg: '#E8F3EC', fg: FERN, label: 'Good' },
  caution: { bg: '#FEF3DD', fg: '#92660D', label: 'Caution' },
  poor: { bg: '#FEE2E2', fg: '#DC2626', label: 'Poor' },
}

function fmtDay(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
function fmtMonth(mk) {
  const [y, m] = mk.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' })
}


// Colour for a dollar-spot probability against the 20% action threshold.
function dsColor(prob, threshold = 20) {
  if (prob >= threshold) return '#DC2626' // at/above threshold — spray
  if (prob >= threshold - 6) return '#EA580C' // approaching
  return '#16A34A' // low
}

// Smith-Kerns dollar spot model card: today's probability, a plain-English call,
// and a 5-day-past → 7-day-forecast probability curve with the action threshold
// drawn in. This is the turf industry's standard dollar-spot forecaster.
function DollarSpotCard({ model }) {
  const { series, today, level, threshold, trend, streak, crossing } = model
  const pastPoints = series.filter((s) => !s.future)
  const todayDate = pastPoints.length ? pastPoints[pastPoints.length - 1].date : null
  const CH = 64 // chart height in px
  const c = dsColor(today, threshold)
  const st = level === 'high' ? RISK_STYLES.high : level === 'watch' ? RISK_STYLES.moderate : RISK_STYLES.low
  const bandLabel = level === 'high' ? 'At / above threshold' : level === 'watch' ? 'Approaching threshold' : 'Below threshold'

  // Plain-English guidance.
  let guide
  if (level === 'high') {
    guide = streak >= 1
      ? `Risk has been at or above the ${threshold}% spray threshold for ${streak} day${streak > 1 ? 's' : ''}. The model supports a preventive fungicide${crossing ? `; it looks to ease back by ${fmtDay(crossing.date)}.` : ' now.'}`
      : `Risk has reached the ${threshold}% spray threshold today. The model supports a preventive fungicide.`
  } else if (crossing && crossing.dir === 'up') {
    guide = `Low today, but the model has risk crossing the ${threshold}% threshold around ${fmtDay(crossing.date)} (${crossing.prob}%). Line up a preventive so you're ahead of it.`
  } else if (level === 'watch') {
    guide = `Climbing toward the ${threshold}% threshold. Keep an eye on it over the next few days.`
  } else {
    guide = `Below the ${threshold}% action threshold and ${trend === 'up' ? 'rising slowly' : 'not building'}. No dollar-spot spray indicated by the model right now.`
  }

  return (
    <div>
      <p className="font-body text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Dollar Spot · Smith-Kerns Model</p>
      <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4" style={{ borderLeft: `5px solid ${c}` }}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <p className="font-display text-3xl font-bold text-slate-900 leading-none">
              {today}<span className="text-lg font-medium text-slate-400">%</span>
            </p>
            <p className="font-body text-[11px] font-bold uppercase tracking-wide mt-1" style={{ color: st.fg }}>
              {bandLabel}{trend !== 'flat' ? ` · ${trend === 'up' ? '↑ rising' : '↓ easing'}` : ''}
            </p>
          </div>
          <span className="font-body text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0" style={{ backgroundColor: st.bg, color: st.fg }}>
            Spray at {threshold}%+
          </span>
        </div>

        {/* Probability curve: past 5 days → 7-day forecast, with threshold line */}
        <div className="relative mt-1" style={{ height: CH }}>
          {/* threshold line */}
          <div className="absolute left-0 right-0 border-t border-dashed" style={{ bottom: (threshold / 100) * CH, borderColor: '#DC262666' }} />
          <div className="absolute right-0 font-body text-[9px] font-bold" style={{ color: '#DC2626', bottom: (threshold / 100) * CH + 1 }}>{threshold}%</div>
          <div className="flex items-end gap-[3px] h-full">
            {series.map((p) => {
              const h = Math.max(3, (p.prob / 100) * CH)
              const isToday = p.date === todayDate
              return (
                <div key={p.date} className="flex-1 flex flex-col justify-end items-center h-full" title={`${fmtDay(p.date)}: ${p.prob}%`}>
                  <div
                    className="w-full rounded-t"
                    style={{
                      height: h,
                      backgroundColor: dsColor(p.prob, threshold),
                      opacity: p.future ? 0.45 : 1,
                      outline: isToday ? `2px solid ${FOREST}` : 'none',
                      outlineOffset: isToday ? 1 : 0,
                    }}
                  />
                </div>
              )
            })}
          </div>
        </div>
        <div className="flex items-center justify-between mt-1.5 font-body text-[10px] text-slate-400">
          <span>{series.length ? fmtDay(series[0].date) : ''}</span>
          <span className="font-bold" style={{ color: FOREST }}>▲ Today</span>
          <span>{series.length ? fmtDay(series[series.length - 1].date) : ''} (forecast)</span>
        </div>

        <p className="font-body text-[12px] text-slate-600 leading-relaxed mt-3">{guide}</p>
        <p className="font-body text-[10px] text-slate-400 mt-2">
          University of Wisconsin Smith-Kerns model — 5-day average humidity + air temperature. {threshold}% is the validated spray threshold; the fungus is dormant below 50°F / above 95°F. Decision-support — pair with scouting.
        </p>
      </div>
    </div>
  )
}

const RAIN_BLUE = '#2563EB'

// Year-to-date rainfall: a running total, per-month bars you can tap to see the
// days, and the wettest day. Manual gauge entries are folded in and marked.
function RainfallYearCard({ rain, prev, canEdit, onEditDay }) {
  const [openMonth, setOpenMonth] = useState(null)
  const now = new Date()
  const curMonth = Number(rain.year) === now.getFullYear() ? now.getMonth() + 1 : 12
  const months = Array.from({ length: curMonth }, (_, i) => `${rain.year}-${String(i + 1).padStart(2, '0')}`)
  const prevOf = (mk) => (prev ? prev.byMonth[`${Number(rain.year) - 1}-${mk.slice(5)}`] || 0 : 0)
  const maxM = Math.max(0.01, ...months.map((m) => Math.max(rain.byMonth[m] || 0, prevOf(m))))
  // Year-over-year: this year vs last year to the same date.
  const delta = prev ? Math.round((rain.ytd - prev.ytd) * 100) / 100 : null
  return (
    <div>
      <p className="font-body text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Rainfall · {rain.year}</p>
      <div className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm">
        <div className="flex items-end justify-between mb-2 flex-wrap gap-2">
          <div>
            <p className="font-display font-bold text-slate-900" style={{ fontSize: 34, lineHeight: 1 }}>{rain.ytd.toFixed(2)}<span className="font-body text-base font-semibold text-slate-400">&nbsp;in</span></p>
            <p className="font-body text-[11px] text-slate-400 mt-0.5">Year to date</p>
          </div>
          <div className="text-right">
            <p className="font-body text-sm font-bold text-slate-700">{rain.last30.toFixed(2)} in</p>
            <p className="font-body text-[11px] text-slate-400">Last 30 days</p>
            {rain.wettest && <p className="font-body text-[10px] text-slate-400 mt-1">Wettest: {fmtDay(rain.wettest.date)} · {rain.wettest.precip.toFixed(2)}"</p>}
          </div>
        </div>

        {prev && (
          <div className="rounded-xl px-3 py-2 mb-3 flex items-center justify-between" style={{ backgroundColor: delta >= 0 ? '#EFF6FF' : '#FEF6EC' }}>
            <span className="font-body text-[11px] text-slate-500">vs {Number(rain.year) - 1} to date · {prev.ytd.toFixed(2)}"</span>
            <span className="font-body text-[12px] font-bold" style={{ color: delta >= 0 ? RAIN_BLUE : '#B45309' }}>
              {delta >= 0 ? '+' : ''}{delta.toFixed(2)}" {Math.abs(delta) < 0.05 ? 'about the same' : delta > 0 ? 'wetter' : 'drier'}
            </span>
          </div>
        )}

        <div className="space-y-1">
          {months.map((mk) => {
            const total = rain.byMonth[mk] || 0
            const pv = prevOf(mk)
            const open = openMonth === mk
            const rainyDays = rain.days.filter((d) => d.date.slice(0, 7) === mk && d.precip > 0)
            return (
              <div key={mk}>
                <button onClick={() => setOpenMonth(open ? null : mk)} className="w-full flex items-center gap-2 py-1 group">
                  <span className="font-body text-[11px] font-bold text-slate-500 w-9 text-left shrink-0">{fmtMonth(mk)}</span>
                  <span className="flex-1 h-4 rounded bg-slate-100 overflow-hidden relative">
                    {/* Last year (faint) behind this year (solid). */}
                    {prev && pv > 0 && <span className="absolute inset-y-0 left-0 rounded" style={{ width: `${(pv / maxM) * 100}%`, backgroundColor: '#94A3B8', opacity: 0.35 }} />}
                    <span className="absolute inset-y-0 left-0 rounded transition-all" style={{ width: `${Math.max(total > 0 ? 4 : 0, (total / maxM) * 100)}%`, backgroundColor: RAIN_BLUE, opacity: open ? 1 : 0.85 }} />
                  </span>
                  <span className="font-body text-[11px] font-semibold text-slate-600 w-12 text-right shrink-0" style={{ fontVariantNumeric: 'tabular-nums' }}>{total.toFixed(2)}"</span>
                </button>
                {open && (
                  <div className="pl-11 pr-1 pb-2">
                    {rainyDays.length === 0 ? (
                      <p className="font-body text-[11px] text-slate-400 py-1">No rain recorded this month.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {rainyDays.map((d) => (
                          canEdit ? (
                            <button key={d.date} onClick={() => onEditDay(d.date, d.precip)} className="font-body text-[11px] px-2 py-1 rounded-lg border" style={{ borderColor: '#DBEAFE', backgroundColor: '#F0F6FF', color: d.manual ? RAIN_BLUE : '#475569' }}>
                              {fmtDay(d.date).replace(/^\w+, /, '')} · {d.precip.toFixed(2)}"{d.manual ? ' •' : ''}
                            </button>
                          ) : (
                            <span key={d.date} className="font-body text-[11px] px-2 py-1 rounded-lg" style={{ backgroundColor: '#F0F6FF', color: '#475569' }}>{fmtDay(d.date).replace(/^\w+, /, '')} · {d.precip.toFixed(2)}"</span>
                          )
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <p className="font-body text-[10px] text-slate-400 mt-3">Tap a month to see its rainy days{canEdit ? ' — tap a day to correct it from your gauge' : ''}.{prev ? ' Faint grey bar = same month last year.' : ''} Manual entries are marked •. Archive data via Open-Meteo; verify against your on-site gauge.</p>
      </div>
    </div>
  )
}

export default function Weather({ location, courseInfo, manage = false, onSaveRain, onGoToSettings }) {
  const [state, setState] = useState({ loading: true, error: null, daily: null, summary: null })
  const [current, setCurrent] = useState(null)
  const [soilSeries, setSoilSeries] = useState([]) // recent daily soil temps
  const [etPct, setEtPct] = useState(80) // % of ET to replace with irrigation
  // Manual rainfall corrections { 'YYYY-MM-DD': inches } — for when the modeled
  // rain is off and you want your rain-gauge reading to drive ET + disease.
  const rainOverrides = courseInfo?.rainOverrides || {}
  const [editRain, setEditRain] = useState(null) // { date, draft } while editing
  const [savingRain, setSavingRain] = useState(false)
  const [openRisk, setOpenRisk] = useState(null) // disease id whose profile is expanded
  const [openWatch, setOpenWatch] = useState(null) // pest-watch id whose scouting detail is expanded
  const canEditRain = manage && typeof onSaveRain === 'function'
  const openRainEdit = (date, cur) => setEditRain({ date, draft: cur != null ? String(cur) : '' })
  // Prefill the box for a chosen date: your saved value if any, else the forecast.
  const precipForDate = (date) => {
    if (rainOverrides[date] != null) return rainOverrides[date]
    const row = (state.daily || []).find((d) => d.date === date)
    return row ? row.precip : null
  }
  const changeRainDate = (date) => setEditRain(() => { const p = precipForDate(date); return { date, draft: p != null ? String(p) : '' } })
  async function commitRain() {
    if (!editRain) return
    setSavingRain(true)
    const map = { ...rainOverrides }
    if (editRain.draft === '' || editRain.draft == null) delete map[editRain.date]
    else map[editRain.date] = Math.max(0, Math.round(Number(editRain.draft) * 100) / 100 || 0)
    try { await onSaveRain(map) } catch { /* parent shows a toast */ }
    setSavingRain(false)
    setEditRain(null)
  }

  const hasLocation = location && location.lat != null && location.lng != null

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!hasLocation) { setState({ loading: false, error: null, daily: null, summary: null }); return }
      setState((s) => ({ ...s, loading: true, error: null }))
      try {
        // Forecast (drives conditions, forecast, disease models) + season
        // archive (drives accurate Jan-1 GDD). Archive is best-effort.
        const data = await fetchWeather(location.lat, location.lng)
        const daily = dailyFromHourly(data)
        const summary = summarize(daily)

        // Live current conditions (best-effort — doesn't block the page).
        try { const c = await fetchCurrent(location.lat, location.lng); if (!cancelled) setCurrent(c) } catch { /* ignore */ }
        // Recent soil temperatures (drive the soil-temp readout + timing windows).
        try { const bt = await fetchBreakdownTemps(location.lat, location.lng); if (!cancelled) setSoilSeries(bt) } catch { /* ignore */ }

        let season = []
        try { season = await fetchSeasonDaily(location.lat, location.lng) } catch { season = [] }
        const merged = mergeDaily(season, dailyFromForecastBlock(data))
        const gdd = gddFromDaily(merged.length ? merged : dailyFromForecastBlock(data))
        const gddNow = gdd.length ? gdd[gdd.length - 1].acc : summary.gddNow
        const fullSeason = merged.length > 0

        if (!cancelled) setState({ loading: false, error: null, daily, summary: { ...summary, gddNow }, fullSeason, raw: data, season })

        // Last year's archive, for the rainfall year-over-year comparison (best-effort).
        try {
          const prevSeason = await fetchYearDaily(location.lat, location.lng, new Date().getFullYear() - 1)
          if (!cancelled) setState((s) => ({ ...s, prevSeason }))
        } catch { /* ignore */ }
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e.message || 'Could not load weather', daily: null, summary: null })
      }
    }
    run()
    return () => { cancelled = true }
  }, [hasLocation, location?.lat, location?.lng])

  if (!hasLocation) {
    return (
      <div className="pt-6 pb-10">
        <div className="bg-white rounded-2xl border border-black/5 p-10 text-center shadow-sm">
          <MapPin className="mx-auto mb-3 text-slate-300" size={30} />
          <p className="font-display text-lg font-semibold text-slate-900 mb-1">Set your course location</p>
          <p className="font-body text-sm text-slate-400 max-w-sm mx-auto mb-5">
            Weather, Growing Degree Days and disease models all run from your course's coordinates. Add your address in Settings to switch this on.
          </p>
          <button onClick={onGoToSettings} className="font-body text-xs font-bold px-4 py-2.5 rounded-full text-white inline-flex items-center gap-1.5" style={{ backgroundColor: FOREST }}>
            <MapPin size={14} /> Set location in Settings
          </button>
        </div>
      </div>
    )
  }

  if (state.loading) {
    return <div className="pt-16 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={26} /></div>
  }

  if (state.error) {
    return (
      <div className="pt-6">
        <div className="bg-red-50 rounded-2xl border border-red-100 p-6 flex items-start gap-3">
          <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={18} />
          <div>
            <p className="font-body text-sm font-semibold text-red-700">Couldn't load weather</p>
            <p className="font-body text-xs text-red-500 mt-0.5">{state.error}</p>
          </div>
        </div>
      </div>
    )
  }

  const { daily: rawDaily, summary, fullSeason } = state
  // Apply any manual rainfall corrections so every readout below — the Rain stat,
  // the forecast, ET "put back tonight", and the disease models — uses them.
  const daily = rawDaily.map((d) => (rainOverrides[d.date] != null ? { ...d, precip: rainOverrides[d.date], rainManual: true } : d))
  const today = localDateISO()
  const todayRow = daily.find((d) => d.date === today) || daily[daily.length - 1]
  const forecast = daily.filter((d) => d.date >= today).slice(0, 7)
  const recentDays = daily.filter((d) => d.date < today).slice(-7).reverse()

  // Soil temperature (2" / 0–7cm) + trend, and the application-timing windows.
  const soilNow = currentSoilTemp(soilSeries)
  const trend = soilTrend(soilSeries)
  const timings = soilNow != null ? applicationTimings(soilNow, trend) : []

  // Smith-Kerns dollar spot forecast (its own card below). The directional
  // dollar_spot row is dropped from the general list since this supersedes it.
  const dollarSpot = smithKernsModel(daily, today)
  // Full disease-risk model list + GDD (base 50°F) + transition-zone pest watch.
  const risks = diseaseRisks(daily, soilNow, trend, today, courseInfo?.siteGrasses || [])
    .filter((r) => !(r.id === 'dollar_spot' && dollarSpot.hasData))
  // Year-to-date rainfall from the season archive + forecast + manual entries,
  // plus last year to the same date for a fair comparison.
  const rain = buildRainYear(state.season, rawDaily, rainOverrides, today)
  const prevRain = state.prevSeason?.length
    ? buildRainYear(state.prevSeason, [], {}, `${Number(today.slice(0, 4)) - 1}-${today.slice(5)}`)
    : null
  const gddToDate = Math.round(summary.gddNow || 0)
  const gddForecast7 = Math.round(daily.filter((d) => d.date > today).slice(0, 7).reduce((s, d) => s + (d.tMax != null && d.tMin != null ? Math.max(0, (d.tMax + d.tMin) / 2 - 50) : 0), 0))
  const watch = pestWatch(today)

  return (
    <div className="pt-6 pb-10 space-y-5">
      {editRain && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(26,26,22,0.45)' }} onClick={() => setEditRain(null)}>
          <div className="bg-white rounded-2xl border-2 p-4 shadow-2xl w-full max-w-xs" style={{ borderColor: '#2563EB' }} onClick={(e) => e.stopPropagation()}>
            <p className="font-display text-base font-semibold text-slate-900 mb-1 flex items-center gap-1.5"><CloudRain size={16} className="text-blue-500" /> Rainfall</p>
            <p className="font-body text-xs text-slate-400 mb-3">Enter what your rain gauge actually caught. This drives ET and the disease models.</p>
            <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Date</label>
            <input type="date" value={editRain.date} max={today} onChange={(e) => changeRainDate(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body mb-3" />
            <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Rainfall</label>
            <div className="flex items-center gap-2">
              <input type="number" step="0.01" min="0" inputMode="decimal" autoFocus value={editRain.draft} onChange={(e) => setEditRain({ ...editRain, draft: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') commitRain() }} className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-base font-body" placeholder="0.00" />
              <span className="font-body text-sm font-semibold text-slate-500">inches</span>
            </div>
            {rainOverrides[editRain.date] != null && (
              <p className="font-body text-[11px] text-slate-400 mt-2">Currently your value. Clear the box and save to go back to the forecast.</p>
            )}
            <div className="flex gap-2 mt-4">
              <button onClick={() => setEditRain(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold font-body text-slate-500 border border-slate-200">Cancel</button>
              <button onClick={commitRain} disabled={savingRain} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body text-white disabled:opacity-50" style={{ backgroundColor: FOREST }}>{savingRain ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">Weather &amp; Agronomics</h2>
          <p className="font-body text-xs text-slate-400 mt-0.5 flex items-center gap-1">
            <MapPin size={11} />{location.address || `${location.lat}, ${location.lng}`}
          </p>
        </div>
      </div>

      {/* Live now */}
      {current && (current.temp || current.wind) && (
        <div className="rounded-2xl p-4 text-white shadow-sm flex items-center justify-between flex-wrap gap-3" style={{ backgroundColor: FOREST }}>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#4ADE80' }} />
            <span className="font-body text-[11px] font-bold uppercase tracking-wide opacity-80">Live now</span>
          </div>
          <div className="flex items-center gap-5">
            <span className="font-display text-2xl font-bold">{current.temp}°</span>
            <span className="font-body text-sm flex items-center gap-1.5"><Wind size={14} />{current.wind} mph {current.windDir}</span>
            <span className="font-body text-sm flex items-center gap-1.5"><Droplets size={14} />{current.humidity}%</span>
          </div>
        </div>
      )}

      {/* Hourly graph — scrub across the day */}
      {state.raw && <HourlyGraph raw={state.raw} forecast={forecast} />}

      {/* Today conditions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat icon={<Thermometer size={15} />} label="High / Low" value={todayRow ? `${Math.round(todayRow.tMax)}° / ${Math.round(todayRow.tMin)}°` : '—'} accent={GOLD} />
        <Stat icon={<Droplets size={15} />} label="Avg Humidity" value={todayRow?.rhMean != null ? `${Math.round(todayRow.rhMean)}%` : '—'} accent={FERN} />
        {canEditRain ? (
          <button type="button" onClick={() => openRainEdit(today, todayRow?.precip)} className="text-left w-full">
            <Stat icon={<CloudRain size={15} />} label={todayRow?.rainManual ? 'Rain today · yours' : 'Rain today · tap to edit'} value={todayRow ? `${todayRow.precip}"` : '—'} accent="#2563EB" />
          </button>
        ) : (
          <Stat icon={<CloudRain size={15} />} label="Rain today" value={todayRow ? `${todayRow.precip}"` : '—'} accent="#2563EB" />
        )}
        <Stat icon={<TrendingUp size={15} />} label={fullSeason ? 'GDD since Jan 1' : 'GDD (last ~90d)'} value={Math.round(summary.gddNow).toLocaleString()} accent={FOREST} />
      </div>

      {/* Year-to-date rainfall tracker */}
      <RainfallYearCard rain={rain} prev={prevRain} canEdit={canEditRain} onEditDay={openRainEdit} />

      {/* Soil temperature + application timing */}
      {soilNow != null && (
        <div>
          <p className="font-body text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Soil Temperature &amp; Application Timing</p>
          <div className="rounded-2xl p-4 text-white shadow-sm mb-3 flex items-center justify-between flex-wrap gap-3" style={{ backgroundColor: FOREST }}>
            <div>
              <p className="font-body text-[11px] font-bold uppercase tracking-wide opacity-70">Soil temp · 2&quot;</p>
              <p className="font-display text-3xl font-bold mt-0.5">{soilNow}°F</p>
            </div>
            <span className="font-body text-xs font-bold px-3 py-1.5 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}>
              {trend === 'rising' ? '↑ Warming' : trend === 'falling' ? '↓ Cooling' : '→ Holding'}
            </span>
          </div>
          <TimingList timings={timings} />
          <p className="font-body text-[10px] text-slate-400 mt-2">Soil temp is a 2-inch estimate from your location. Windows are published transition-zone starting points — pair with your own read and local extension guidance.</p>
        </div>
      )}

      {/* Dollar spot — Smith-Kerns probability model */}
      {dollarSpot.hasData && <DollarSpotCard model={dollarSpot} />}

      {/* Disease risk models */}
      <div>
        <p className="font-body text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Disease Risk Models</p>
        <div className="space-y-2">
          {risks.map((r) => {
            const c = r.score >= 70 ? '#DC2626' : r.score >= 40 ? '#EA580C' : r.score >= 15 ? '#CA8A04' : '#16A34A'
            const prof = profileById(r.id)
            const open = openRisk === r.id
            return (
              <div key={r.id} className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden" style={{ borderLeft: `5px solid ${c}` }}>
                <button onClick={() => prof && setOpenRisk(open ? null : r.id)} className="w-full text-left flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-body text-sm font-bold text-slate-900 flex items-center gap-1.5">{r.label}{prof && <Info size={12} className="text-slate-300 shrink-0" />}</p>
                    <p className="font-body text-[11px] text-slate-500 mt-0.5">{r.desc}</p>
                    {r.source && <p className="font-body text-[10px] text-slate-400 mt-1 italic">Source: {r.source}</p>}
                  </div>
                  <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 text-white font-display font-bold text-sm" style={{ backgroundColor: c }}>{r.score}</div>
                </button>
                {open && prof && (
                  <div className="px-3 pb-3 space-y-2">
                    <div className="flex justify-end">
                      <a href={photoSearchUrl(prof)} target="_blank" rel="noopener noreferrer" className="font-body text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1" style={{ backgroundColor: '#EFF6FF', color: '#2563EB' }}>See photos ↗</a>
                    </div>
                    <p className="font-body text-[12px] text-slate-600 leading-relaxed">{prof.blurb}</p>
                    <div className="rounded-xl p-2.5" style={{ backgroundColor: '#FBF3EC' }}>
                      <p className="font-body text-[10px] font-bold uppercase tracking-wide mb-0.5" style={{ color: '#B45309' }}>Favored by</p>
                      <p className="font-body text-[12px] text-slate-700 leading-relaxed">{prof.favoredBy}</p>
                    </div>
                    <div className="rounded-xl p-2.5" style={{ backgroundColor: '#F0F6F2' }}>
                      <p className="font-body text-[10px] font-bold uppercase tracking-wide mb-0.5" style={{ color: FERN }}>How to manage</p>
                      <p className="font-body text-[12px] text-slate-700 leading-relaxed">{prof.manage}</p>
                    </div>
                    <p className="font-body text-[10px] text-slate-400">More in Turf Performance → Reference.</p>
                  </div>
                )}
              </div>
            )
          })}
          {risks.length === 0 && <div className="bg-white rounded-2xl border border-black/5 p-6 text-center text-slate-400 font-body text-sm">Not enough weather yet to score disease risk.</div>}
        </div>
        <p className="font-body text-[10px] text-slate-400 mt-2">0–100 risk indices built on published university-extension thresholds (source shown on each), computed from Open-Meteo weather + 2&quot; soil temp. Decision-support — pair with scouting and calibrate to your region.</p>
      </div>

      {/* Growing degree days */}
      <div>
        <p className="font-body text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Growing Degree Days</p>
        <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4">
          <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400">Base 50°F · accumulated from Jan 1</p>
          <p className="font-display text-3xl font-bold text-slate-900 mt-0.5">{gddToDate.toLocaleString()} <span className="font-body text-sm font-medium text-slate-400">GDD to date</span></p>
          {gddForecast7 > 0 && <p className="font-body text-[12px] text-slate-500 mt-1">+{gddForecast7} forecast over the next 7 days → {(gddToDate + gddForecast7).toLocaleString()} GDD</p>}
        </div>
      </div>

      {/* Pest watch — transition-zone scouting calendar */}
      <div>
        <p className="font-body text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Pest Watch</p>
        <div className="space-y-2">
          {watch.map((s) => {
            const style = s.tone === 'now'
              ? { dot: '#DC2626', bg: '#FEE2E2', fg: '#B91C1C' }
              : s.tone === 'soon'
                ? { dot: '#CA8A04', bg: '#FEF3DD', fg: '#92660D' }
                : { dot: '#94A3B8', bg: '#F1F5F9', fg: '#64748B' }
            const open = openWatch === s.id
            return (
              <div key={s.id} className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden" style={s.tone === 'now' ? { borderLeft: '5px solid #DC2626' } : {}}>
                <button onClick={() => setOpenWatch(open ? null : s.id)} className="w-full text-left flex items-center gap-3 p-3">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: style.dot }} />
                  <div className="min-w-0 flex-1">
                    <p className="font-body text-sm font-bold text-slate-900 flex items-center gap-1.5">{s.label} <Info size={12} className="text-slate-300 shrink-0" /></p>
                    <p className="font-body text-[11px] text-slate-500 mt-0.5">{s.window}</p>
                  </div>
                  <span className="font-body text-[10px] font-bold px-2.5 py-1 rounded-full shrink-0" style={{ backgroundColor: style.bg, color: style.fg }}>{s.status}</span>
                </button>
                {open && (
                  <div className="px-3 pb-3 space-y-2">
                    <p className="font-body text-[12px] text-slate-600 leading-relaxed">{s.cue}</p>
                    <div className="rounded-xl p-2.5" style={{ backgroundColor: '#EEF4FB' }}>
                      <p className="font-body text-[10px] font-bold uppercase tracking-wide mb-0.5" style={{ color: '#2563EB' }}>How to scout</p>
                      <p className="font-body text-[12px] text-slate-700 leading-relaxed">{s.scout}</p>
                    </div>
                    {s.stage && (
                      <div className="rounded-xl p-2.5" style={{ backgroundColor: '#FBF3EC' }}>
                        <p className="font-body text-[10px] font-bold uppercase tracking-wide mb-0.5" style={{ color: '#B45309' }}>Life stage to target</p>
                        <p className="font-body text-[12px] text-slate-700 leading-relaxed">{s.stage}</p>
                      </div>
                    )}
                    <div className="rounded-xl p-2.5" style={{ backgroundColor: '#F0F6F2' }}>
                      <p className="font-body text-[10px] font-bold uppercase tracking-wide mb-0.5" style={{ color: FERN }}>When to treat</p>
                      <p className="font-body text-[12px] text-slate-700 leading-relaxed">{s.action}</p>
                    </div>
                    {s.products && (
                      <div className="rounded-xl p-2.5 border" style={{ backgroundColor: '#F6F4FB', borderColor: '#E4DCF3' }}>
                        <p className="font-body text-[10px] font-bold uppercase tracking-wide mb-0.5" style={{ color: '#6D48C4' }}>Suggested products</p>
                        <p className="font-body text-[12px] text-slate-700 leading-relaxed">{s.products}</p>
                        <p className="font-body text-[10px] text-slate-400 mt-1">Common labeled options — confirm the product is labeled for your site &amp; pest, follow the label, rotate modes of action, and let a licensed applicator make the call.</p>
                      </div>
                    )}
                    {s.source && <p className="font-body text-[10px] text-slate-400 italic">Source: {s.source}</p>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <p className="font-body text-[10px] text-slate-400 mt-2">Transition-zone (mid-Atlantic) monitoring windows — when to scout and what to look for. Decision-support; confirm with a soap-flush or turf-flap check before treating.</p>
      </div>

      {/* Spray windows */}
      {(() => {
        const rated = forecast.map((d) => ({ ...d, spray: sprayWindow(d) }))
        const firstGood = rated.find((d) => d.spray.level === 'good')
        const todayRated = rated[0]
        return (
          <div>
            <p className="font-body text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Spray Windows</p>
            {todayRated && todayRated.spray.level !== 'good' && (
              <div className="rounded-2xl border p-3 mb-2 flex items-start gap-2" style={{ backgroundColor: SPRAY_STYLES[todayRated.spray.level].bg, borderColor: SPRAY_STYLES[todayRated.spray.level].fg + '40' }}>
                <AlertTriangle size={16} className="shrink-0 mt-0.5" style={{ color: SPRAY_STYLES[todayRated.spray.level].fg }} />
                <p className="font-body text-[12px]" style={{ color: SPRAY_STYLES[todayRated.spray.level].fg }}>
                  Today looks <b>{SPRAY_STYLES[todayRated.spray.level].label.toLowerCase()}</b> for spraying ({todayRated.spray.reasons.join(', ')}).
                  {firstGood && firstGood.date !== todayRated.date ? <> Consider <b>{fmtDay(firstGood.date)}</b> — {firstGood.spray.reasons.join(', ').toLowerCase()}.</> : ''}
                </p>
              </div>
            )}
            <div className="bg-white rounded-2xl border border-black/5 overflow-hidden shadow-sm">
              {rated.map((d, i) => {
                const st = SPRAY_STYLES[d.spray.level]
                return (
                  <div key={d.date} className={`flex items-center gap-3 px-4 py-3 ${i !== 0 ? 'border-t border-black/5' : ''}`}>
                    <span className="font-body text-sm font-semibold text-slate-700 w-28 shrink-0">{fmtDay(d.date)}</span>
                    <span className="font-body text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ backgroundColor: st.bg, color: st.fg }}>{st.label}</span>
                    <span className="font-body text-[11px] text-slate-500 flex-1 truncate">{d.spray.reasons.join(' · ')}</span>
                    <span className="font-body text-[11px] text-slate-400 shrink-0 flex items-center gap-1"><Wind size={11} />{d.windMax}</span>
                  </div>
                )
              })}
            </div>
            <p className="font-body text-[10px] text-slate-400 mt-2">Rated on your <b>6am–noon</b> spray window (wind + rain). Poor = windy (15+ mph) or rain likely; Caution = breezy (10+) or rain possible. A guide — use your judgment on the day.</p>
          </div>
        )
      })()}

      {/* ET & irrigation */}
      {forecast.some((d) => d.et != null) && (
        <div>
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <p className="font-body text-xs font-bold text-slate-400 uppercase tracking-wide">ET &amp; Irrigation</p>
            <div className="flex items-center gap-1.5">
              <span className="font-body text-[11px] text-slate-400">Replace</span>
              <input type="number" value={etPct} onChange={(e) => setEtPct(Math.max(0, Math.min(150, Number(e.target.value) || 0)))} className="w-14 border border-slate-200 rounded-lg px-2 py-1 text-sm font-body text-center" />
              <span className="font-body text-[11px] text-slate-400">% of ET</span>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-black/5 overflow-hidden shadow-sm">
            <div className="flex items-center px-4 py-2 border-b border-black/5 font-body text-[10px] font-bold text-slate-400 uppercase tracking-wide">
              <span className="w-28">Day</span>
              <span className="flex-1 text-right">ET</span>
              <span className="flex-1 text-right">Rain</span>
              <span className="flex-1 text-right">Put back tonight</span>
            </div>
            {forecast.map((d) => {
              const need = irrigationNeed(d, etPct / 100)
              const stress = turfStress(d)
              const sc = SPRAY_STYLES[stress.level === 'high' ? 'poor' : stress.level === 'moderate' ? 'caution' : 'good']
              return (
                <div key={d.date} className="px-4 py-2.5 border-t border-black/5 first:border-t-0">
                  <div className="flex items-center font-body text-sm">
                    <span className="w-28 font-semibold text-slate-700">{fmtDay(d.date)}</span>
                    <span className="flex-1 text-right text-slate-800">{d.et != null ? `${d.et.toFixed(2)}"` : '—'}</span>
                    <span className="flex-1 text-right text-slate-500">{d.precip}"</span>
                    <span className="flex-1 text-right font-bold" style={{ color: FERN }}>{need != null ? `${need.toFixed(2)}"` : '—'}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="font-body text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: sc.bg, color: sc.fg }}>Turf stress: {stress.level}</span>
                    <span className="font-body text-[10px] text-slate-400 truncate">{stress.label}</span>
                  </div>
                </div>
              )
            })}
          </div>
          <p className="font-body text-[10px] text-slate-400 mt-2">“Put back tonight” = ET × {etPct}% minus rain (inches) — a starting point for replacing what the turf lost. Reference ET (FAO) from Open-Meteo; dial the % to your program and cross-check your own ET/soil-moisture readings.</p>
        </div>
      )}

      {/* Forecast */}
      <div>
        <p className="font-body text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">7-Day Forecast</p>
        <div className="bg-white rounded-2xl border border-black/5 overflow-hidden shadow-sm">
          {forecast.map((d, i) => (
            <div key={d.date} className={`flex items-center justify-between px-4 py-3 ${i !== 0 ? 'border-t border-black/5' : ''}`}>
              <span className="font-body text-sm font-semibold text-slate-700 w-32">{fmtDay(d.date)}</span>
              <span className="font-body text-sm text-slate-500 flex items-center gap-1"><CloudRain size={13} className="text-blue-400" />{d.precip}"</span>
              <span className="font-body text-sm font-semibold text-slate-800 w-24 text-right">{Math.round(d.tMax)}° / {Math.round(d.tMin)}°</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent days — raw numbers you can sanity-check against your own readings */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="font-body text-xs font-bold text-slate-400 uppercase tracking-wide">Recent Days (verify against your station)</p>
          {canEditRain && (
            <button onClick={() => changeRainDate(today)} className="font-body text-[11px] font-bold flex items-center gap-1" style={{ color: '#2563EB' }}>
              <CloudRain size={12} /> Log rainfall
            </button>
          )}
        </div>
        <div className="bg-white rounded-2xl border border-black/5 overflow-hidden shadow-sm">
          <div className="flex items-center px-4 py-2 border-b border-black/5 font-body text-[10px] font-bold text-slate-400 uppercase tracking-wide">
            <span className="w-28">Day</span>
            <span className="flex-1 text-right">High / Low</span>
            <span className="flex-1 text-right">Avg RH</span>
            <span className="flex-1 text-right">Rain</span>
          </div>
          {recentDays.map((d) => (
            <div key={d.date} className="flex items-center px-4 py-2.5 border-t border-black/5 first:border-t-0 font-body text-sm">
              <span className="w-28 font-semibold text-slate-700">{fmtDay(d.date)}</span>
              <span className="flex-1 text-right text-slate-800">{d.tMax != null ? `${Math.round(d.tMax)}° / ${Math.round(d.tMin)}°` : '—'}</span>
              <span className="flex-1 text-right text-slate-500">{d.rhMean != null ? `${Math.round(d.rhMean)}%` : '—'}</span>
              {canEditRain ? (
                <button type="button" onClick={() => openRainEdit(d.date, d.precip)} className="flex-1 text-right font-semibold" style={{ color: d.rainManual ? '#2563EB' : '#94A3B8' }}>
                  {d.precip}"{d.rainManual ? ' •' : ''}
                </button>
              ) : (
                <span className="flex-1 text-right text-slate-500">{d.precip}"</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Transparent source note */}
      <div className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm">
        <p className="font-body text-[11px] text-slate-500 leading-relaxed">
          <b>Source:</b> Open-Meteo, using the nearest national-weather-model grid cell to your
          coordinates (<b>{Number(location.lat).toFixed(4)}, {Number(location.lng).toFixed(4)}</b>) —
          modeled data for your location, not a physical on-site station, so expect small differences
          from a sensor on the course. GDD uses base 50°F{fullSeason ? ', accumulated from Jan 1 via the historical archive' : ' (season archive unavailable right now — showing the last ~90 days)'}.
          Cross-check the numbers above against weather.gov or your own station; if you have an on-site
          weather station, we can wire it in as the source for maximum accuracy.
        </p>
      </div>
    </div>
  )
}

// Interactive hour-by-hour graph. Drag/tap across it to read that hour's temp,
// humidity, rain chance and wind. Highlights the 6am–noon spray window.
function fmtHour(h) {
  const ampm = h < 12 ? 'AM' : 'PM'
  const hr = ((h + 11) % 12) + 1
  return `${hr} ${ampm}`
}
function HourlyGraph({ raw, forecast }) {
  const days = (forecast || []).slice(0, 5)
  const [date, setDate] = useState(days[0]?.date)
  const hours = hourlyForDay(raw, date || days[0]?.date)
  const svgRef = useRef(null)
  const isToday = date === localDateISO()
  const [active, setActive] = useState(null)

  // Default the scrubber to the current hour (today) or 9 AM.
  const defaultHour = isToday ? new Date().getHours() : 9
  const activeHour = active != null ? active : defaultHour
  const cur = hours.find((h) => h.hour === activeHour) || hours[Math.min(activeHour, hours.length - 1)] || hours[0]

  if (!hours.length) return null

  const W = 720, H = 190
  const temps = hours.map((h) => h.temp).filter((v) => v != null)
  const tMin = Math.min(...temps), tMax = Math.max(...temps)
  const range = (tMax - tMin) || 1
  const x = (hour) => 12 + (hour / 23) * (W - 24)
  const y = (t) => (H - 26) - ((t - tMin) / range) * (H - 60)
  const line = hours.filter((h) => h.temp != null).map((h) => `${x(h.hour)},${y(h.temp)}`).join(' ')

  const onMove = (e) => {
    const rect = svgRef.current.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width
    setActive(Math.max(0, Math.min(23, Math.round(px * 23))))
  }

  return (
    <div className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p className="font-body text-xs font-bold text-slate-400 uppercase tracking-wide">Hour by Hour</p>
        <div className="flex gap-1.5 overflow-x-auto">
          {days.map((d) => (
            <button key={d.date} onClick={() => { setDate(d.date); setActive(null) }} className="font-body text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap transition" style={date === d.date ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: '#F0F6F2', color: FERN }}>
              {new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })}
            </button>
          ))}
        </div>
      </div>

      {/* Readout for the scrubbed hour */}
      {cur && (
        <div className="flex items-center gap-4 mb-2 flex-wrap">
          <span className="font-display text-lg font-bold text-slate-900 w-16">{fmtHour(cur.hour)}</span>
          <span className="font-body text-sm text-slate-700 flex items-center gap-1"><Thermometer size={13} className="text-amber-500" />{cur.temp != null ? `${Math.round(cur.temp)}°` : '—'}</span>
          <span className="font-body text-sm text-slate-700 flex items-center gap-1"><Droplets size={13} className="text-emerald-500" />{cur.rh != null ? `${Math.round(cur.rh)}%` : '—'}</span>
          <span className="font-body text-sm text-slate-700 flex items-center gap-1"><CloudRain size={13} className="text-blue-400" />{cur.prob != null ? `${Math.round(cur.prob)}%` : '—'}</span>
          <span className="font-body text-sm text-slate-700 flex items-center gap-1"><Wind size={13} className="text-slate-400" />{cur.wind != null ? `${Math.round(cur.wind)} mph` : '—'}</span>
          <span className="font-body text-sm text-slate-700 flex items-center gap-1"><TrendingUp size={13} className="text-violet-500" />{cur.et != null ? `${cur.et.toFixed(3)}" ET` : '—'}</span>
        </div>
      )}

      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full block" style={{ touchAction: 'none' }}
        onPointerDown={onMove} onPointerMove={(e) => { if (e.buttons || e.pointerType === 'touch') onMove(e) }}>
        {/* 6am–noon spray window shading */}
        <rect x={x(6)} y={6} width={x(12) - x(6)} height={H - 26} fill="#3A6B4A" opacity="0.07" />
        <text x={(x(6) + x(12)) / 2} y={16} textAnchor="middle" fontSize="9" fill="#3A6B4A" opacity="0.8">spray window</text>
        {/* temp line */}
        <polyline points={line} fill="none" stroke={GOLD} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {/* scrubber */}
        {cur && cur.temp != null && (
          <>
            <line x1={x(cur.hour)} y1={6} x2={x(cur.hour)} y2={H - 20} stroke="#94A3B8" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={x(cur.hour)} cy={y(cur.temp)} r="5" fill={FOREST} stroke="white" strokeWidth="2" />
          </>
        )}
        {/* x-axis labels */}
        {[0, 6, 12, 18, 23].map((hr) => (
          <text key={hr} x={x(hr)} y={H - 5} textAnchor="middle" fontSize="10" fill="#94A3B8">{fmtHour(hr)}</text>
        ))}
      </svg>
      <p className="font-body text-[10px] text-slate-400 mt-1">Drag across the graph to read any hour. Shaded band is your 6am–noon spray window.</p>
    </div>
  )
}

function Stat({ icon, label, value, accent }) {
  return (
    <div className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm">
      <div className="flex items-center gap-1.5 mb-2" style={{ color: accent }}>{icon}</div>
      <p className="font-display text-2xl font-semibold text-slate-900">{value}</p>
      <p className="font-body text-[11px] text-slate-400 mt-0.5 leading-tight">{label}</p>
    </div>
  )
}

function RiskCard({ title, model, style, detail, note }) {
  return (
    <div className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-1.5">
        <p className="font-body text-sm font-semibold text-slate-800">{title}</p>
        <span className="font-body text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide" style={{ backgroundColor: style.bg, color: style.fg }}>{style.label}</span>
      </div>
      <p className="font-body text-[11px] text-slate-400 mb-1">{model} · {detail}</p>
      <p className="font-body text-xs text-slate-600 leading-snug">{note}</p>
    </div>
  )
}

// Application-timing windows: each shows its status against the current soil temp.
const TIMING_STATUS = {
  now: { bg: '#E8F3EC', fg: '#2C5238', dot: '#3A6B4A', label: 'Apply now' },
  soon: { bg: '#FEF3DD', fg: '#7A5E12', dot: '#C9A84C', label: 'Getting close' },
  later: { bg: '#F1F5F9', fg: '#64748B', dot: '#CBD5E1', label: 'Not yet' },
  passed: { bg: '#F3E0D9', fg: '#8A3520', dot: '#B4553D', label: 'Window passed' },
  unknown: { bg: '#F1F5F9', fg: '#64748B', dot: '#CBD5E1', label: '—' },
}
function TimingList({ timings }) {
  if (!timings || timings.length === 0) {
    return <div className="bg-white rounded-2xl border border-black/5 p-6 text-center text-slate-400 font-body text-sm shadow-sm">No timing windows in season right now.</div>
  }
  return (
    <div className="space-y-2">
      {timings.map((t) => {
        const st = TIMING_STATUS[t.status] || TIMING_STATUS.unknown
        return (
          <div key={t.id} className="bg-white rounded-2xl border border-black/5 p-3.5 shadow-sm">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="font-body text-sm font-semibold text-slate-800 truncate">{t.label}</span>
              <span className="font-body text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 shrink-0" style={{ backgroundColor: st.bg, color: st.fg }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: st.dot }} />{st.label}
              </span>
            </div>
            <p className="font-body text-[11px] text-slate-400">Trigger ~{t.threshold}°F ({t.direction === 'falling' ? 'cooling' : 'warming'}) · {t.note}</p>
            {(() => {
              const active = t.status === 'now' || t.status === 'soon'
              const body = active ? t.control : t.watch
              if (!body) return null
              return (
                <div className="mt-1.5 rounded-lg p-2" style={{ backgroundColor: active ? '#F0F6F2' : '#F8FAFC' }}>
                  <p className="font-body text-[9px] font-bold uppercase tracking-wide mb-0.5" style={{ color: active ? FERN : '#94A3B8' }}>{active ? 'How to control' : 'Watch for'}</p>
                  <p className="font-body text-[11px] text-slate-600 leading-relaxed">{body}</p>
                </div>
              )
            })()}
          </div>
        )
      })}
    </div>
  )
}
