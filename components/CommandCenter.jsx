'use client'

// ── Command Centre ────────────────────────────────────────────────────────────
// A wall-TV / landscape-iPad overview for a multi-course property. The top strip
// is shared across the whole property (sprays this week, open jobs, 7-day rain,
// season GDD, live weather); below it each course gets its own card in its own
// colour — live Greens Speed / Height of Cut, plus an editable Moisture Target,
// Today's Focus note and a checkable To-Do list. Blue and Gold stay independent.
// The live data refreshes on a timer; the editable fields persist to settings.
import { useState, useEffect, useCallback, useRef } from 'react'
import { Wind, Droplet, CloudRain, Gauge, Sprout, Thermometer, RefreshCw, Plus, X, ClipboardList, Sun, CloudSun, Cloud, CloudDrizzle, CloudSnow, CloudFog, CloudLightning } from 'lucide-react'
import * as db from '@/lib/db'
import { fetchCurrent, fetchWeather, dailyFromForecastBlock, fetchSeasonDaily, gddSince, weatherCodeInfo } from '@/lib/weather'
import { sheetApplied } from '@/lib/applied'
import { localDateISO } from '@/lib/dates'
import { fmtStimp } from '@/lib/greenspeed'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#C9A84C'
const BLUE = '#2563EB'
const BG = '#EEF1EE'
const INK3 = '#8A8984'

const CC_WX_ICON = {
  sun: { Icon: Sun, color: '#E0A82E' }, partly: { Icon: CloudSun, color: '#D9A441' },
  cloud: { Icon: Cloud, color: '#7C8B93' }, fog: { Icon: CloudFog, color: '#8A97A0' },
  drizzle: { Icon: CloudDrizzle, color: '#4E86B4' }, rain: { Icon: CloudRain, color: '#3A6187' },
  snow: { Icon: CloudSnow, color: '#6FA0C4' }, storm: { Icon: CloudLightning, color: '#7B5EA7' },
}

const tok = (s) => String(s || '').trim().split(/\s+/)[0].toLowerCase()
const uid = () => Math.random().toString(36).slice(2, 9)
const addDaysISO = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const fmtLongDate = (d) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

export default function CommandCentre() {
  const [live, setLive] = useState(null)
  const [wx, setWx] = useState({ current: null, forecast: [], season: [] })
  const [command, setCommand] = useState(null) // editable per-course state
  const [loading, setLoading] = useState(true)
  const [clock, setClock] = useState('')
  const ciRef = useRef({})       // latest full courseInfo, for merge-saves
  const cmdInit = useRef(false)  // only seed editable state once

  useEffect(() => {
    const t = () => setClock(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))
    t(); const id = setInterval(t, 30000); return () => clearInterval(id)
  }, [])

  const load = useCallback(async () => {
    try {
      const today = localDateISO()
      const [settings, sheets, speeds, tasks] = await Promise.all([
        db.fetchSettings(),
        db.fetchSheets().catch(() => []),
        db.fetchGreensSpeeds().catch(() => []),
        db.fetchCrewTasks(addDaysISO(today, -6), addDaysISO(today, 7)).catch(() => []),
      ])
      const courseInfo = settings.courseInfo || {}
      ciRef.current = courseInfo
      if (!cmdInit.current) { setCommand(courseInfo.command || {}); cmdInit.current = true }
      setLive({ areas: settings.areas || {}, courseInfo, sheets, speeds, tasks })
      const loc = settings.location
      if (loc?.lat != null) {
        ;(async () => { try { const c = await fetchCurrent(loc.lat, loc.lng); setWx((w) => ({ ...w, current: c })) } catch { /* ignore */ } })()
        ;(async () => { try { const d = await fetchWeather(loc.lat, loc.lng); setWx((w) => ({ ...w, forecast: dailyFromForecastBlock(d) })) } catch { /* ignore */ } })()
        ;(async () => { try { const s = await fetchSeasonDaily(loc.lat, loc.lng); setWx((w) => ({ ...w, season: s })) } catch { /* ignore */ } })()
      }
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [])

  useEffect(() => { load(); const id = setInterval(load, 10 * 60000); return () => clearInterval(id) }, [load])

  // Persist an updated editable map onto courseInfo.command.
  async function persist(nextCommand) {
    setCommand(nextCommand)
    const ci = { ...(ciRef.current || {}), command: nextCommand }
    ciRef.current = ci
    try { await db.saveSettings({ courseInfo: ci }) } catch (e) { console.error(e) }
  }
  function patchCourse(name, patch) {
    const cur = command || {}
    persist({ ...cur, [name]: { ...(cur[name] || {}), ...patch } })
  }

  if (loading || !live) return <div style={{ minHeight: '100vh', backgroundColor: BG }} className="flex items-center justify-center"><RefreshCw className="animate-spin text-slate-300" size={30} /></div>

  const { areas, courseInfo, sheets, speeds, tasks } = live
  const today = localDateISO()
  const year = today.slice(0, 4)

  // Courses (name + colour). Fall back to a single property-wide card.
  let courses = Array.isArray(courseInfo.courses) ? courseInfo.courses.filter((c) => c && c.name) : []
  const allMode = courses.length === 0
  if (allMode) courses = [{ name: courseInfo.clubName || 'Course', color: FERN, _all: true }]

  // ── Shared property metrics ──
  const weekAgo = addDaysISO(today, -6)
  const spraysThisWeek = (sheets || []).filter((s) => sheetApplied(s) && s.date && s.date >= weekAgo && s.date <= today).length
  const openJobs = (tasks || []).filter((t) => (t.status || 'todo') !== 'done').length
  const rain7 = (wx.season || []).filter((d) => d.date >= weekAgo && d.date <= today).reduce((s, d) => s + (Number(d.precip) || 0), 0)
  const seasonGdd = wx.season.length ? gddSince(wx.season, `${year}-01-01`, 50) : null

  const forecast7 = (wx.forecast || []).filter((d) => d.date >= today)
  const todayCode = forecast7[0]?.code
  const cond = todayCode != null ? weatherCodeInfo(todayCode) : null

  // ── Per-course live metrics ──
  const inCourse = (c, name) => c._all || tok(name) === tok(c.name)
  const courseMetrics = (c) => {
    // Greens speed — latest reading day for this course, averaged.
    const cs = (speeds || []).filter((s) => inCourse(c, s.area) && s.speed != null)
    let speed = null
    if (cs.length) {
      const day = cs.map((s) => s.date).sort().pop()
      const vals = cs.filter((s) => s.date === day).map((s) => Number(s.speed))
      if (vals.length) speed = { avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100, day }
    }
    // Height of cut — from this course's greens area.
    let hoc = ''
    const greensKey = Object.keys(areas).find((k) => inCourse(c, k) && /green/i.test(k) && areas[k]?.hoc)
    if (greensKey) hoc = areas[greensKey].hoc
    const jobs = (tasks || []).filter((t) => (t.status || 'todo') !== 'done' && (c._all || tok(t.course || t.area) === tok(c.name))).length
    return { speed, hoc, jobs }
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: BG }} className="px-4 sm:px-6 lg:px-8 py-5">
      {/* Header */}
      <div className="flex items-end justify-between mb-4 flex-wrap gap-3">
        <div>
          <p className="font-display text-[11px] tracking-[0.25em] uppercase" style={{ color: GOLD }}>{courseInfo.clubName || 'Golf Club'}</p>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold" style={{ color: FOREST }}>Command Centre</h1>
          <p className="font-body text-sm text-slate-500 mt-1">
            {fmtLongDate(new Date())}
            {wx.current?.temp ? <> · <span className="font-semibold" style={{ color: FOREST }}>{wx.current.temp}°F</span>{cond ? `, ${cond.label}` : ''}</> : ''}
            {wx.current?.wind ? ` · ${wx.current.wind} mph ${wx.current.windDir}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-body text-sm text-slate-500 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: FERN }} />Live · {clock}</span>
          <button onClick={load} className="w-9 h-9 rounded-full bg-white border border-slate-200 flex items-center justify-center shadow-sm" title="Refresh"><RefreshCw size={16} style={{ color: FERN }} /></button>
        </div>
      </div>

      {/* Shared property strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <PropTile icon={ClipboardList} label="This week · sprays" value={spraysThisWeek} />
        <PropTile icon={ClipboardList} label="Open jobs" value={openJobs} accent={openJobs ? '#B45309' : FERN} />
        <PropTile icon={CloudRain} label="Rain · 7-day" value={`${rain7.toFixed(2)}"`} />
        <PropTile icon={Thermometer} label="GDD to date" value={seasonGdd != null ? seasonGdd.toLocaleString() : '—'} sub="base 50°F · since Jan 1" />
      </div>
      <p className="font-body text-[11px] text-slate-400 mb-4 flex items-center gap-1.5">
        <span style={{ color: INK3 }}>↑ Shared across the whole property.</span>
        {courses.length > 1 && <span>↓ Each course below is edited on its own — same page, separate sections.</span>}
      </p>

      {/* Per-course cards */}
      <div className={`grid gap-4 ${courses.length > 1 ? 'lg:grid-cols-2' : ''}`}>
        {courses.map((c) => (
          <CourseCard
            key={c.name}
            course={c}
            metrics={courseMetrics(c)}
            state={(command && command[c.name]) || {}}
            onPatch={(patch) => patchCourse(c.name, patch)}
          />
        ))}
      </div>

      {/* 7-day forecast — a wall-glance strip */}
      {forecast7.length > 0 && (
        <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4 mt-4">
          <p className="font-body text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">7-Day Forecast</p>
          <div className="flex justify-between gap-1">
            {forecast7.slice(0, 7).map((d) => {
              const info = weatherCodeInfo(d.code); const wi = CC_WX_ICON[info.key] || CC_WX_ICON.cloud; const WI = wi.Icon
              return (
                <div key={d.date} className="flex-1 text-center min-w-0">
                  <p className="font-body text-[11px] font-bold text-slate-400 uppercase">{new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })}</p>
                  <WI size={24} className="mx-auto my-1" style={{ color: wi.color }} />
                  <p className="font-display text-lg font-bold" style={{ color: FOREST }}>{Math.round(d.tMax)}°</p>
                  <p className="font-body text-[11px] text-slate-400">{Math.round(d.tMin)}°</p>
                  <p className="font-body text-[10px] mt-0.5" style={{ color: '#3A6187' }}>{d.precip}"</p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function PropTile({ icon: Icon, label, value, sub, accent = FOREST }) {
  return (
    <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4">
      <div className="flex items-center gap-1.5 mb-1.5">
        {Icon && <Icon size={13} style={{ color: '#94A3A0' }} />}
        <p className="font-body text-[10px] font-bold text-slate-400 uppercase tracking-wide">{label}</p>
      </div>
      <p className="font-display font-bold leading-none" style={{ fontSize: 34, color: accent }}>{value}</p>
      {sub && <p className="font-body text-[11px] text-slate-400 mt-1">{sub}</p>}
    </div>
  )
}

// One course's card: live stats on top, editable focus + to-do below.
function CourseCard({ course, metrics, state, onPatch }) {
  const color = course.color || FERN
  const todos = Array.isArray(state.todos) ? state.todos : []
  const [draft, setDraft] = useState('')
  const [focus, setFocus] = useState(state.focus || '')
  const [moist, setMoist] = useState(state.moistureTgt || '')
  // Keep local text fields in sync if the saved value changes elsewhere.
  useEffect(() => { setFocus(state.focus || '') }, [state.focus])
  useEffect(() => { setMoist(state.moistureTgt || '') }, [state.moistureTgt])

  const addTodo = () => { const t = draft.trim(); if (!t) return; onPatch({ todos: [...todos, { id: uid(), text: t, done: false }] }); setDraft('') }
  const toggle = (id) => onPatch({ todos: todos.map((x) => (x.id === id ? { ...x, done: !x.done } : x)) })
  const remove = (id) => onPatch({ todos: todos.filter((x) => x.id !== id) })

  return (
    <div className="bg-white rounded-2xl shadow-sm p-5" style={{ border: '1px solid rgba(0,0,0,0.06)', borderTop: `4px solid ${color}` }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
          <h2 className="font-display text-xl font-semibold" style={{ color: FOREST }}>{course.name}</h2>
        </div>
        <span className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-300">Tap to edit</span>
      </div>

      {/* Live stats */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <Stat icon={Gauge} label="Greens speed" value={metrics.speed ? fmtStimp(metrics.speed.avg) : '—'} unit="" />
        <Stat icon={Sprout} label="Height of cut" value={metrics.hoc ? String(metrics.hoc).replace(/\s*in$/i, '') : '—'} unit="in" />
        <EditStat label="Moisture tgt" value={moist} unit="% VWC" onCommit={(v) => { setMoist(v); onPatch({ moistureTgt: v }) }} onChange={setMoist} placeholder="—" />
      </div>

      {/* Today's focus */}
      <div className="mb-4">
        <p className="font-body text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Today's focus</p>
        <textarea
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          onBlur={() => { if (focus !== (state.focus || '')) onPatch({ focus }) }}
          rows={2}
          placeholder="e.g. Roll greens, mow at 0.105. Watch #4 & #7 — wetting agent fading, hand-water hot spots."
          className="w-full rounded-xl px-3 py-2.5 font-body text-[14px] leading-snug resize-none"
          style={{ border: '1px solid #E2E0DB', backgroundColor: '#FBFAF7', color: FOREST }}
        />
      </div>

      {/* To-do */}
      <div>
        <p className="font-body text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">To-do</p>
        <div className="space-y-1.5">
          {todos.map((t) => (
            <div key={t.id} className="flex items-center gap-2.5 rounded-xl px-3 py-2" style={{ backgroundColor: '#F6F5F1' }}>
              <button onClick={() => toggle(t.id)} className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ border: `2px solid ${t.done ? color : '#C9C7C0'}`, backgroundColor: t.done ? color : 'transparent' }}>
                {t.done && <svg width="11" height="11" viewBox="0 0 12 12"><path d="M2 6l2.5 2.5L10 3" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </button>
              <span className="flex-1 font-body text-[14px]" style={{ color: t.done ? '#A6A49E' : FOREST, textDecoration: t.done ? 'line-through' : 'none' }}>{t.text}</span>
              <button onClick={() => remove(t.id)} className="text-slate-300 hover:text-slate-500 shrink-0" title="Remove"><X size={15} /></button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addTodo() }}
            placeholder="Add a task…"
            className="flex-1 rounded-xl px-3 py-2 font-body text-[14px]"
            style={{ border: '1px solid #E2E0DB', backgroundColor: 'white', color: FOREST }}
          />
          <button onClick={addTodo} className="px-4 rounded-xl font-body text-sm font-bold text-white flex items-center gap-1" style={{ backgroundColor: FOREST }}><Plus size={15} />Add</button>
        </div>
      </div>
    </div>
  )
}

function Stat({ icon: Icon, label, value, unit }) {
  return (
    <div className="rounded-xl px-3 py-2.5" style={{ backgroundColor: '#F6F5F1' }}>
      <p className="font-body text-[9px] font-bold text-slate-400 uppercase tracking-wide mb-0.5">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className="font-display text-2xl font-bold" style={{ color: FOREST }}>{value}</span>
        {value !== '—' && <span className="font-body text-[11px] text-slate-400">{unit}</span>}
      </div>
    </div>
  )
}

// A stat you can type into (moisture target) — looks like a Stat until focused.
function EditStat({ label, value, unit, onChange, onCommit, placeholder }) {
  return (
    <div className="rounded-xl px-3 py-2.5" style={{ backgroundColor: '#F1F4F1', outline: '1px dashed #CBD5CB' }}>
      <p className="font-body text-[9px] font-bold text-slate-400 uppercase tracking-wide mb-0.5">{label}</p>
      <div className="flex items-baseline gap-1">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onCommit(e.target.value.trim())}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          inputMode="decimal"
          placeholder={placeholder}
          className="font-display text-2xl font-bold bg-transparent outline-none w-full min-w-0"
          style={{ color: FOREST }}
        />
        <span className="font-body text-[11px] text-slate-400 shrink-0">{unit}</span>
      </div>
    </div>
  )
}
