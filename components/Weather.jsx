'use client'

// Weather tab: live local conditions, a short forecast, GDD accumulation, and
// disease-risk readouts (Dollar Spot, Brown Patch) computed from the weather.
// All from Open-Meteo using the club's saved location — no API key required.
import { useState, useEffect, useRef } from 'react'
import { Loader2, CloudRain, Thermometer, Droplets, TrendingUp, AlertTriangle, MapPin, Wind } from 'lucide-react'
import { fetchWeather, dailyFromHourly, summarize, fetchSeasonDaily, dailyFromForecastBlock, mergeDaily, gddFromDaily, fetchCurrent, sprayWindow, hourlyForDay, irrigationNeed, turfStress, fetchBreakdownTemps } from '@/lib/weather'
import { applicationTimings, soilTrend, currentSoilTemp } from '@/lib/soiltiming'
import { diseaseRisks, pestStages } from '@/lib/pests'

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

export default function Weather({ location, onGoToSettings }) {
  const [state, setState] = useState({ loading: true, error: null, daily: null, summary: null })
  const [current, setCurrent] = useState(null)
  const [soilSeries, setSoilSeries] = useState([]) // recent daily soil temps
  const [etPct, setEtPct] = useState(80) // % of ET to replace with irrigation

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

        if (!cancelled) setState({ loading: false, error: null, daily, summary: { ...summary, gddNow }, fullSeason, raw: data })
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

  const { daily, summary, fullSeason } = state
  const today = new Date().toISOString().slice(0, 10)
  const todayRow = daily.find((d) => d.date === today) || daily[daily.length - 1]
  const forecast = daily.filter((d) => d.date >= today).slice(0, 7)
  const recentDays = daily.filter((d) => d.date < today).slice(-7).reverse()

  // Soil temperature (2" / 0–7cm) + trend, and the application-timing windows.
  const soilNow = currentSoilTemp(soilSeries)
  const trend = soilTrend(soilSeries)
  const timings = soilNow != null ? applicationTimings(soilNow, trend) : []

  // Full disease-risk model list + GDD (base 50°F) + GDD-based pest stages.
  const risks = diseaseRisks(daily, soilNow, trend, today)
  const gddToDate = Math.round(summary.gddNow || 0)
  const gddForecast7 = Math.round(daily.filter((d) => d.date > today).slice(0, 7).reduce((s, d) => s + (d.tMax != null && d.tMin != null ? Math.max(0, (d.tMax + d.tMin) / 2 - 50) : 0), 0))
  const stages = pestStages(gddToDate)

  return (
    <div className="pt-6 pb-10 space-y-5">
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
        <Stat icon={<CloudRain size={15} />} label="Rain today" value={todayRow ? `${todayRow.precip}"` : '—'} accent="#2563EB" />
        <Stat icon={<TrendingUp size={15} />} label={fullSeason ? 'GDD since Jan 1' : 'GDD (last ~90d)'} value={Math.round(summary.gddNow).toLocaleString()} accent={FOREST} />
      </div>

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

      {/* Disease risk models */}
      <div>
        <p className="font-body text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Disease Risk Models</p>
        <div className="space-y-2">
          {risks.map((r) => {
            const c = r.score >= 70 ? '#DC2626' : r.score >= 40 ? '#EA580C' : r.score >= 15 ? '#CA8A04' : '#16A34A'
            return (
              <div key={r.id} className="bg-white rounded-2xl border border-black/5 shadow-sm flex items-center gap-3 p-3" style={{ borderLeft: `5px solid ${c}` }}>
                <div className="min-w-0 flex-1">
                  <p className="font-body text-sm font-bold text-slate-900">{r.label}</p>
                  <p className="font-body text-[11px] text-slate-500 mt-0.5">{r.desc}</p>
                </div>
                <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 text-white font-display font-bold text-sm" style={{ backgroundColor: c }}>{r.score}</div>
              </div>
            )
          })}
          {risks.length === 0 && <div className="bg-white rounded-2xl border border-black/5 p-6 text-center text-slate-400 font-body text-sm">Not enough weather yet to score disease risk.</div>}
        </div>
        <p className="font-body text-[10px] text-slate-400 mt-2">General 0–100 models from Open-Meteo weather + 2&quot; soil temp — directional, calibrate thresholds to your region.</p>
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

      {/* Pest stages at this GDD */}
      <div>
        <p className="font-body text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Pest Stages at this GDD</p>
        <div className="space-y-2">
          {stages.map((s) => {
            const dot = s.tone === 'now' ? '#CA8A04' : s.tone === 'soon' ? '#16A34A' : '#94A3B8'
            return (
              <div key={s.id} className="bg-white rounded-2xl border border-black/5 shadow-sm flex items-center gap-3 p-3">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: dot }} />
                <div className="min-w-0">
                  <p className="font-body text-sm font-bold text-slate-900">{s.label}</p>
                  <p className="font-body text-[11px] text-slate-500">{s.status}</p>
                </div>
              </div>
            )
          })}
        </div>
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
        <p className="font-body text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Recent Days (verify against your station)</p>
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
              <span className="flex-1 text-right text-slate-500">{d.precip}"</span>
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
  const isToday = date === new Date().toISOString().slice(0, 10)
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
          </div>
        )
      })}
    </div>
  )
}
