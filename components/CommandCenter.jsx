'use client'

// ── Command Center ────────────────────────────────────────────────────────────
// A wide, edge-to-edge dashboard built to fill a monitor, shop TV or landscape
// iPad — a grid of glanceable widgets you scan across, in the spirit of a farm
// overview screen. Loads its own data and refreshes on a timer.
import { useState, useEffect, useCallback } from 'react'
import { Wind, Droplet, CloudRain, Sprout, Gauge, ClipboardList, ShieldCheck, AlertTriangle, Thermometer, Camera, RefreshCw, Sun, CloudSun, Cloud, CloudDrizzle, CloudSnow, CloudFog, CloudLightning } from 'lucide-react'
import * as db from '@/lib/db'
import { fetchCurrent, fetchWeather, dailyFromForecastBlock, fetchSeasonDaily, fetchBreakdownTemps, sprayWindow, buildRainYear, gddSince, weatherCodeInfo } from '@/lib/weather'
import { fungicideLogByArea } from '@/lib/disease'
import { suppressionMap } from '@/lib/pgr'
import { sheetApplied } from '@/lib/applied'
import { localDateISO } from '@/lib/dates'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#C9A84C'
const BG = '#EEF1EE'
const SPRAY = { good: { bg: '#E8F3EC', fg: FERN, label: 'Favourable' }, caution: { bg: '#FEF3DD', fg: '#92660D', label: 'Marginal' }, poor: { bg: '#FEE2E2', fg: '#DC2626', label: 'Hold' } }
// Little weather picture per forecast day, keyed by weatherCodeInfo().
const CC_WX_ICON = {
  sun: { Icon: Sun, color: '#E0A82E' },
  partly: { Icon: CloudSun, color: '#D9A441' },
  cloud: { Icon: Cloud, color: '#7C8B93' },
  fog: { Icon: CloudFog, color: '#8A97A0' },
  drizzle: { Icon: CloudDrizzle, color: '#4E86B4' },
  rain: { Icon: CloudRain, color: '#3A6187' },
  snow: { Icon: CloudSnow, color: '#6FA0C4' },
  storm: { Icon: CloudLightning, color: '#7B5EA7' },
}
const fmtDay = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })
const fmtDate = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) } catch { return d } }

const PGR_TARGET = 360

export default function CommandCenter() {
  const [data, setData] = useState(null)
  const [wx, setWx] = useState({ current: null, forecast: [], season: [], breakdownTemps: [] })
  const [loading, setLoading] = useState(true)
  const [clock, setClock] = useState('')

  useEffect(() => {
    const t = () => setClock(new Date().toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }))
    t(); const id = setInterval(t, 30000); return () => clearInterval(id)
  }, [])

  const load = useCallback(async () => {
    try {
      const [settings, sheets, products, speeds, scouting] = await Promise.all([
        db.fetchSettings(), db.fetchSheets(), db.fetchProducts(),
        db.fetchGreensSpeeds().catch(() => []), db.fetchScouting().catch(() => []),
      ])
      setData({ areas: settings.areas || {}, location: settings.location, courseInfo: settings.courseInfo || {}, sheets, products, speeds, scouting })
      const loc = settings.location
      if (loc?.lat != null) {
        ;(async () => { try { const c = await fetchCurrent(loc.lat, loc.lng); setWx((w) => ({ ...w, current: c })) } catch { /* ignore */ } })()
        ;(async () => { try { const d = await fetchWeather(loc.lat, loc.lng); setWx((w) => ({ ...w, forecast: dailyFromForecastBlock(d) })) } catch { /* ignore */ } })()
        ;(async () => { try { const s = await fetchSeasonDaily(loc.lat, loc.lng); setWx((w) => ({ ...w, season: s })) } catch { /* ignore */ } })()
        ;(async () => { try { const bt = await fetchBreakdownTemps(loc.lat, loc.lng); setWx((w) => ({ ...w, breakdownTemps: bt })) } catch { /* ignore */ } })()
      }
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [])

  useEffect(() => { load(); const id = setInterval(load, 15 * 60000); return () => clearInterval(id) }, [load])

  if (loading || !data) return <div style={{ minHeight: '100vh', backgroundColor: BG }} className="flex items-center justify-center"><RefreshCw className="animate-spin text-slate-300" size={30} /></div>

  const { areas, sheets, products, speeds, scouting, courseInfo } = data
  const today = localDateISO()
  const year = today.slice(0, 4)

  // ── Derived widgets ──
  const forecast7 = (wx.forecast || []).filter((d) => d.date >= today).slice(0, 7).map((d) => ({ ...d, spray: sprayWindow(d) }))
  const todaySpray = forecast7[0]?.spray || null

  const fungLog = fungicideLogByArea(sheets, products)

  // PGR reapply per area (GDD since last suppression, only areas running a PGR).
  const pgr = (() => {
    if (!wx.season.length) return []
    const supMap = suppressionMap(products)
    if (!Object.keys(supMap).length) return []
    const lastByArea = {}; const hasPGR = {}
    ;(sheets || []).filter((s) => sheetApplied(s) && s.date).forEach((s) => {
      const sup = (s.products || []).filter((p) => supMap[p.product])
      if (!sup.length) return
      if (sup.some((p) => supMap[p.product] === 'pgr')) hasPGR[s.area] = true
      if (!lastByArea[s.area] || s.date > lastByArea[s.area]) lastByArea[s.area] = s.date
    })
    return Object.keys(lastByArea).filter((a) => hasPGR[a]).map((area) => {
      const gdd = gddSince(wx.season, lastByArea[area], 32)
      const pct = gdd != null ? Math.min(100, Math.round((gdd / PGR_TARGET) * 100)) : 0
      const status = gdd == null ? 'ok' : gdd >= PGR_TARGET ? 'due' : gdd >= PGR_TARGET * 0.8 ? 'soon' : 'ok'
      return { area, gdd, pct, status }
    }).sort((a, b) => (b.gdd ?? -1) - (a.gdd ?? -1))
  })()

  const rain = wx.season.length ? buildRainYear(wx.season, wx.forecast, courseInfo?.rainOverrides || {}, today) : null
  const seasonGdd = wx.season.length ? gddSince(wx.season, `${year}-01-01`, 32) : null

  const pending = sheets.filter((s) => s.status === 'pending')
  const approved = sheets.filter((s) => s.status === 'approved')
  const todaySheets = sheets.filter((s) => s.date === today)
  const lowStock = products.filter((p) => p.lowStockThreshold > 0 && (p.stock || 0) <= p.lowStockThreshold)

  // Latest greens-speed reading day → average + range.
  const speedLatest = (() => {
    if (!speeds.length) return null
    const day = speeds[0].date
    const vals = speeds.filter((s) => s.date === day && s.speed != null).map((s) => Number(s.speed))
    if (!vals.length) return null
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length
    return { date: day, avg: Math.round(avg * 100) / 100, min: Math.min(...vals), max: Math.max(...vals), n: vals.length }
  })()

  const advisor = (() => {
    const byArea = {}
    const add = (area, reason, sev) => { if (!area) return; if (!byArea[area]) byArea[area] = { area, reasons: [], sev: 0 }; if (!byArea[area].reasons.includes(reason)) byArea[area].reasons.push(reason); byArea[area].sev = Math.max(byArea[area].sev, sev) }
    pgr.forEach((r) => { if (r.status === 'due') add(r.area, 'PGR due', 3); else if (r.status === 'soon') add(r.area, 'PGR soon', 2) })
    return Object.values(byArea).sort((a, b) => b.sev - a.sev).slice(0, 6)
  })()

  const ccAgo = (since) => (since == null ? '' : since <= 0 ? 'today' : since === 1 ? 'yesterday' : `${since}d ago`)

  return (
    <div style={{ minHeight: '100vh', backgroundColor: BG }} className="px-4 sm:px-6 lg:px-8 py-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
        <div>
          <p className="font-display text-[11px] tracking-[0.25em] uppercase" style={{ color: GOLD }}>{courseInfo?.clubName || 'Golf Club'}</p>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold" style={{ color: FOREST }}>Command Center</h1>
        </div>
        <div className="flex items-center gap-3">
          <p className="font-body text-sm text-slate-500">{clock}</p>
          <button onClick={load} className="w-9 h-9 rounded-full bg-white border border-slate-200 flex items-center justify-center shadow-sm" title="Refresh"><RefreshCw size={16} style={{ color: FERN }} /></button>
        </div>
      </div>

      {/* Widget grid */}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))', gridAutoRows: 'minmax(10px, auto)' }}>

        {/* Current conditions */}
        <Widget title="Now" icon={Thermometer} span={1}>
          {wx.current ? (
            <>
              <div className="flex items-end gap-2">
                <span className="font-display font-bold leading-none" style={{ fontSize: 56, color: FOREST }}>{wx.current.temp}°</span>
              </div>
              <div className="flex gap-4 mt-3 font-body text-sm text-slate-500">
                <span className="flex items-center gap-1.5"><Wind size={15} />{wx.current.wind} mph {wx.current.windDir}</span>
                <span className="flex items-center gap-1.5"><Droplet size={15} />{wx.current.humidity}%</span>
              </div>
            </>
          ) : <Empty text="Set your course location in Settings for live weather." />}
        </Widget>

        {/* Spray window today */}
        <Widget title="Spray Window" icon={Droplet} span={1}>
          {todaySpray ? (
            <>
              <span className="font-body text-xl font-bold px-3 py-1.5 rounded-full inline-block" style={{ backgroundColor: SPRAY[todaySpray.level].bg, color: SPRAY[todaySpray.level].fg }}>{SPRAY[todaySpray.level].label}</span>
              <p className="font-body text-[13px] text-slate-500 mt-2">{todaySpray.reasons.join(' · ')}</p>
              <p className="font-body text-[10px] text-slate-400 mt-1">Rated on your 6am–noon window.</p>
            </>
          ) : <Empty text="Waiting on weather…" />}
        </Widget>

        {/* 7-day forecast (wide) */}
        <Widget title="7-Day Forecast" icon={CloudRain} span={2}>
          {forecast7.length ? (
            <div className="flex justify-between gap-1">
              {forecast7.map((d) => {
                const info = weatherCodeInfo(d.code)
                const wi = CC_WX_ICON[info.key] || CC_WX_ICON.cloud
                const WI = wi.Icon
                return (
                  <div key={d.date} className="flex-1 text-center min-w-0">
                    <p className="font-body text-[11px] font-bold text-slate-400 uppercase">{fmtDay(d.date)}</p>
                    <WI size={24} className="mx-auto my-1" style={{ color: wi.color }} />
                    <p className="font-display text-lg font-bold" style={{ color: FOREST }}>{Math.round(d.tMax)}°</p>
                    <p className="font-body text-[11px] text-slate-400">{Math.round(d.tMin)}°</p>
                    <p className="font-body text-[10px] mt-0.5" style={{ color: '#3A6187' }}>{d.precip}"</p>
                    <span className="inline-block mt-1 w-2.5 h-2.5 rounded-full" style={{ backgroundColor: SPRAY[d.spray.level].fg }} title={SPRAY[d.spray.level].label} />
                  </div>
                )
              })}
            </div>
          ) : <Empty text="Waiting on weather…" />}
        </Widget>

        {/* Spray Advisor */}
        <Widget title="Needs Attention" icon={AlertTriangle} span={2}>
          {advisor.length ? (
            <div className="space-y-1.5">
              {advisor.map((a) => (
                <div key={a.area} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: a.sev >= 3 ? '#DC2626' : '#CA8A04' }} />
                  <span className="font-body text-sm font-bold text-slate-800 truncate">{a.area}</span>
                  <span className="font-body text-[11px] text-slate-400 truncate">{a.reasons.join(' · ')}</span>
                </div>
              ))}
            </div>
          ) : <Empty text="All areas covered — nothing pressing." good />}
        </Widget>

        {/* Recent fungicide sprays — a plain record per area, newest first */}
        <Widget title="Recent Fungicide Sprays" icon={ShieldCheck} span={2}>
          {fungLog.length ? (
            <div className="space-y-3">
              {fungLog.slice(0, 5).map((a) => (
                <div key={a.area}>
                  <p className="font-body text-[13px] font-bold text-slate-700 truncate mb-1">{a.area}</p>
                  <div className="space-y-1.5">
                    {a.sprays.map((s) => (
                      <div key={s.date} className="rounded-md px-2.5 py-1.5" style={{ backgroundColor: '#F4F6F4' }}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-body text-[13px] font-semibold text-slate-700 truncate">{s.products.join(', ')}</span>
                          <span className="font-body text-[11px] tnum text-slate-400 shrink-0">{ccAgo(s.since)}</span>
                        </div>
                        {s.diseases.length > 0 && (
                          <p className="font-body text-[11px] leading-snug mt-0.5" style={{ color: FERN }}>{s.diseases.join(' · ')}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : <Empty text="No fungicide sprays logged yet." />}
        </Widget>

        {/* PGR status */}
        <Widget title="Growth Regulation" icon={Sprout} span={1}>
          {pgr.length ? (
            <div className="space-y-2">
              {pgr.slice(0, 5).map((r) => (
                <div key={r.area}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-body text-[13px] font-semibold text-slate-700 truncate">{r.area}</span>
                    <span className="font-body text-[11px] font-bold" style={{ color: r.status === 'due' ? '#DC2626' : r.status === 'soon' ? '#CA8A04' : FERN }}>{r.status === 'due' ? 'Due' : r.status === 'soon' ? 'Soon' : `${r.pct}%`}</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: '#E6EBE7' }}><div className="h-full rounded-full" style={{ width: `${Math.max(3, r.pct)}%`, backgroundColor: r.status === 'due' ? '#DC2626' : r.status === 'soon' ? '#CA8A04' : FERN }} /></div>
                </div>
              ))}
            </div>
          ) : <Empty text="No PGR program running yet." />}
        </Widget>

        {/* GDD */}
        <Widget title="Growing Degree Days" icon={Thermometer} span={1}>
          {seasonGdd != null ? (
            <>
              <span className="font-display font-bold leading-none" style={{ fontSize: 44, color: FOREST }}>{seasonGdd.toLocaleString()}</span>
              <p className="font-body text-[12px] text-slate-500 mt-1">GDD base 32°F · since Jan 1</p>
            </>
          ) : <Empty text="Waiting on weather…" />}
        </Widget>

        {/* Greens speed */}
        <Widget title="Greens Speed" icon={Gauge} span={1}>
          {speedLatest ? (
            <>
              <div className="flex items-baseline gap-1.5">
                <span className="font-display font-bold leading-none" style={{ fontSize: 44, color: FOREST }}>{speedLatest.avg}</span>
                <span className="font-body text-sm text-slate-400">ft avg</span>
              </div>
              <p className="font-body text-[12px] text-slate-500 mt-1">{speedLatest.min}–{speedLatest.max} ft · {speedLatest.n} greens · {fmtDate(speedLatest.date)}</p>
            </>
          ) : <Empty text="Log a Stimp reading in Turf → Greens Speed." />}
        </Widget>

        {/* Rainfall */}
        <Widget title="Rainfall" icon={CloudRain} span={1}>
          {rain ? (
            <>
              <div className="flex items-baseline gap-1.5">
                <span className="font-display font-bold leading-none" style={{ fontSize: 44, color: FOREST }}>{rain.ytd.toFixed(1)}"</span>
                <span className="font-body text-sm text-slate-400">{rain.year} YTD</span>
              </div>
              <p className="font-body text-[12px] text-slate-500 mt-1">{rain.last30.toFixed(2)}" last 30 days</p>
            </>
          ) : <Empty text="Waiting on weather…" />}
        </Widget>

        {/* Counts */}
        <Widget title="Spray Ops" icon={ClipboardList} span={1}>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Mini n={pending.length} label="Pending" color={pending.length ? '#B45309' : FERN} />
            <Mini n={todaySheets.length} label="Today" color={GOLD} />
            <Mini n={lowStock.length} label="Low stock" color={lowStock.length ? '#DC2626' : FERN} />
          </div>
        </Widget>

        {/* Latest scouting */}
        <Widget title="Latest Scouting" icon={Camera} span={2}>
          {scouting.length ? (
            <div className="flex gap-2 overflow-x-auto">
              {scouting.slice(0, 5).map((s) => (
                <div key={s.id} className="w-28 shrink-0">
                  {s.photo ? <img src={s.photo} alt="" className="w-28 h-20 object-cover rounded-lg border border-slate-200" /> : <div className="w-28 h-20 rounded-lg bg-slate-100" />}
                  <p className="font-body text-[11px] font-bold text-slate-700 truncate mt-1">{s.target || s.kind}</p>
                  <p className="font-body text-[10px] text-slate-400 truncate">{[s.area, fmtDate(s.date)].filter(Boolean).join(' · ')}</p>
                </div>
              ))}
            </div>
          ) : <Empty text="No scouting photos yet." />}
        </Widget>

      </div>
    </div>
  )
}

function Widget({ title, icon: Icon, span = 1, children }) {
  return (
    <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4 flex flex-col" style={{ gridColumn: `span ${span}` }}>
      <div className="flex items-center gap-1.5 mb-2">
        {Icon && <Icon size={13} style={{ color: '#94A3A0' }} />}
        <p className="font-body text-[10px] font-bold text-slate-400 uppercase tracking-wide">{title}</p>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  )
}
function Mini({ n, label, color }) {
  return (
    <div>
      <div className="font-display text-2xl font-bold" style={{ color }}>{n}</div>
      <div className="font-body text-[10px] font-semibold text-slate-400 uppercase">{label}</div>
    </div>
  )
}
function Empty({ text, good }) {
  return <p className="font-body text-[12px]" style={{ color: good ? FERN : '#94A3A0' }}>{text}</p>
}
