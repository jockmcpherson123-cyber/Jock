'use client'

// Weather tab: live local conditions, a short forecast, GDD accumulation, and
// disease-risk readouts (Dollar Spot, Brown Patch) computed from the weather.
// All from Open-Meteo using the club's saved location — no API key required.
import { useState, useEffect } from 'react'
import { Loader2, CloudRain, Thermometer, Droplets, TrendingUp, AlertTriangle, MapPin } from 'lucide-react'
import { fetchWeather, dailyFromHourly, summarize, fetchSeasonDaily, dailyFromForecastBlock, mergeDaily, gddFromDaily } from '@/lib/weather'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#C9A84C'

const RISK_STYLES = {
  low: { bg: '#E8F3EC', fg: FERN, label: 'Low' },
  moderate: { bg: '#FEF3DD', fg: '#92660D', label: 'Moderate' },
  high: { bg: '#FEE2E2', fg: '#DC2626', label: 'Elevated' },
}

function fmtDay(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function Weather({ location, onGoToSettings }) {
  const [state, setState] = useState({ loading: true, error: null, daily: null, summary: null })

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

        let season = []
        try { season = await fetchSeasonDaily(location.lat, location.lng) } catch { season = [] }
        const merged = mergeDaily(season, dailyFromForecastBlock(data))
        const gdd = gddFromDaily(merged.length ? merged : dailyFromForecastBlock(data))
        const gddNow = gdd.length ? gdd[gdd.length - 1].acc : summary.gddNow
        const fullSeason = merged.length > 0

        if (!cancelled) setState({ loading: false, error: null, daily, summary: { ...summary, gddNow }, fullSeason })
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
  const ds = RISK_STYLES[summary.dollarSpot.level]
  const bp = RISK_STYLES[summary.brownPatch.level]

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

      {/* Today conditions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat icon={<Thermometer size={15} />} label="High / Low" value={todayRow ? `${Math.round(todayRow.tMax)}° / ${Math.round(todayRow.tMin)}°` : '—'} accent={GOLD} />
        <Stat icon={<Droplets size={15} />} label="Avg Humidity" value={todayRow?.rhMean != null ? `${Math.round(todayRow.rhMean)}%` : '—'} accent={FERN} />
        <Stat icon={<CloudRain size={15} />} label="Rain today" value={todayRow ? `${todayRow.precip}"` : '—'} accent="#2563EB" />
        <Stat icon={<TrendingUp size={15} />} label={fullSeason ? 'GDD since Jan 1' : 'GDD (last ~90d)'} value={Math.round(summary.gddNow).toLocaleString()} accent={FOREST} />
      </div>

      {/* Disease risk */}
      <div>
        <p className="font-body text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Disease Pressure</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <RiskCard
            title="Dollar Spot"
            model="Smith-Kerns model"
            style={ds}
            detail={
              summary.dollarSpot.dsi != null
                ? `Index ${summary.dollarSpot.dsi.toFixed(1)} · ${summary.dollarSpot.streak} day${summary.dollarSpot.streak !== 1 ? 's' : ''} favourable`
                : 'Not enough data yet'
            }
            note={summary.dollarSpot.level === 'high' ? 'Elevated — index positive 3+ days running. Consider tightening your fungicide interval.' : summary.dollarSpot.level === 'moderate' ? 'Conditions starting to favour dollar spot — keep an eye on it.' : 'Low pressure right now.'}
          />
          <RiskCard
            title="Brown Patch"
            model="Temp + humidity hours"
            style={bp}
            detail={`${summary.brownPatch.hours} favourable hour${summary.brownPatch.hours !== 1 ? 's' : ''} recently`}
            note={summary.brownPatch.level === 'high' ? 'Warm, very humid conditions — brown patch favourable.' : summary.brownPatch.level === 'moderate' ? 'Some favourable hours — monitor.' : 'Low pressure right now.'}
          />
        </div>
      </div>

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
