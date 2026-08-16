'use client'

// The live crew board — a read-only, TV-optimized view of today's Whiteboard for
// the shop screen. It fetches today's jobs, then subscribes to Realtime so any
// change made on an iPad shows up here within a second, no refresh needed. Big
// type, high contrast, and it rolls over to the new day on its own overnight.
import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react'
import * as db from '@/lib/db'
import { loadTranslations, txGet } from '@/lib/translate'
import { fetchCurrent } from '@/lib/weather'
import { localDateISO } from '@/lib/dates'
import { directionForJob, stepLabel, surfaceKind } from '@/lib/mowdir'
import MowPattern from '@/components/MowPattern'
import HoleMap from '@/components/HoleMap'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#C9A84C'

// Local calendar date so the board rolls over at local midnight, not UTC
// midnight (which is early evening in US timezones).
const todayStr = () => localDateISO()
const prettyDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

// `pub` (a club key) turns this into the no-login phone view: it reads today's
// board from the public /api/crew endpoint and polls instead of using Realtime.
export default function CrewBoard({ pub = null }) {
  const [date, setDate] = useState(todayStr())
  // Optional ?course=Blue in the URL gives this TV its own course board.
  const [course] = useState(() => (typeof window !== 'undefined' ? (new URLSearchParams(window.location.search).get('course') || '') : ''))
  const [tasks, setTasks] = useState([])
  const [club, setClub] = useState('')
  const [crew, setCrew] = useState({})
  const [tx, setTx] = useState({})
  const [location, setLocation] = useState(null)
  const [weather, setWeather] = useState(null)
  const [boardMessage, setBoardMessage] = useState('')
  const [courseInfo, setCourseInfo] = useState({})
  const [clock, setClock] = useState('')
  const [status, setStatus] = useState('loading') // loading | ok | error
  const [live, setLive] = useState(false)
  const dateRef = useRef(date)
  useEffect(() => { dateRef.current = date }, [date])

  // The shop TV can't scroll, so shrink the whole board just enough to fit the
  // screen as more rounds/jobs get added — everything always stays on one page.
  const fitWrapRef = useRef(null)
  const fitContentRef = useRef(null)
  useLayoutEffect(() => {
    const fit = () => {
      const wrap = fitWrapRef.current, content = fitContentRef.current
      if (!wrap || !content) return
      const availW = wrap.clientWidth, availH = wrap.clientHeight
      if (!availW || !availH) return
      // Lay the board out WIDER than the screen (availW / scale), then scale it
      // back down to the screen width — so it always fills the full width, and
      // shrinks only as much as needed to fit the height. Converges in a few
      // passes because a wider layout reflows into more/shorter columns.
      content.style.transformOrigin = 'top left'
      let scale = 1
      for (let i = 0; i < 10; i++) {
        content.style.width = Math.round(availW / scale) + 'px'
        const ch = content.scrollHeight
        const target = Math.min(1, availH / (ch || 1))
        if (Math.abs(target - scale) < 0.005) { scale = target; break }
        scale = scale + (target - scale) * 0.7
      }
      content.style.width = Math.round(availW / scale) + 'px'
      if (content.scrollHeight * scale > availH + 1) scale = availH / content.scrollHeight
      scale = Math.max(0.2, Math.min(1, scale))
      content.style.width = Math.round(availW / scale) + 'px'
      content.style.transform = `scale(${scale})`
    }
    fit()
    const ro = new ResizeObserver(fit)
    if (fitWrapRef.current) ro.observe(fitWrapRef.current)
    window.addEventListener('resize', fit)
    const t = setTimeout(fit, 350) // catch late layout (fonts, hole SVG)
    return () => { ro.disconnect(); window.removeEventListener('resize', fit); clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, tx, boardMessage, course])

  const load = useCallback(async (d) => {
    try {
      if (pub) {
        const params = new URLSearchParams({ view: 'board', k: pub, date: d })
        if (course) params.set('course', course)
        const r = await fetch(`/api/crew?${params.toString()}`, { cache: 'no-store' })
        if (r.status === 401) { setStatus('denied'); return }
        if (!r.ok) throw new Error('load failed')
        const j = await r.json()
        setTasks(j.tasks || [])
        setClub(j.club || ''); setCrew(j.crew || {}); setBoardMessage(j.boardMessage || ''); setLocation(j.location || null); setCourseInfo(j.courseInfo || {})
        setStatus('ok')
      } else {
        const t = await db.fetchCrewTasks(d, d)
        setTasks(t)
        setStatus('ok')
      }
    } catch (e) {
      console.error(e)
      setStatus('error')
    }
  }, [pub, course])

  // Club name, crew languages, location + shop message — refreshed every 30s so
  // the TV picks up setting changes (e.g. a new shop message) without a reload.
  useEffect(() => {
    if (pub) return // phone view gets club/crew/message/location from load()
    let cancelled = false
    const pull = async () => {
      try {
        const s = await db.fetchSettings()
        if (cancelled) return
        setClub(s.courseInfo?.clubName || '')
        setCrew(s.courseInfo?.crew || {})
        setLocation(s.location || null)
        setBoardMessage(s.courseInfo?.boardMessage || '')
        setCourseInfo(s.courseInfo || {})
      } catch (e) { console.error(e) }
    }
    pull()
    const id = setInterval(pull, 30000)
    return () => { cancelled = true; clearInterval(id) }
  }, [pub])

  // Live weather for the header, refreshed every 10 minutes.
  useEffect(() => {
    if (location?.lat == null) return
    let cancelled = false
    const pull = async () => { try { const w = await fetchCurrent(location.lat, location.lng); if (!cancelled) setWeather(w) } catch (e) { console.error(e) } }
    pull()
    const id = setInterval(pull, 600000)
    return () => { cancelled = true; clearInterval(id) }
  }, [location])

  // Translate each person's jobs into their language (AI, cached).
  const crewSig = JSON.stringify(crew || {})
  useEffect(() => {
    let cancelled = false
    loadTranslations(tasks, crew).then((m) => { if (!cancelled) setTx(m) }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, crewSig])

  // Load the day, and reload whenever the date rolls over.
  useEffect(() => { load(date) }, [date, load])

  // Live updates. The signed-in TV uses Realtime; the no-login phone view can't,
  // so it polls every 20s instead.
  useEffect(() => {
    if (pub) {
      setLive(true)
      const id = setInterval(() => load(dateRef.current), 20000)
      return () => clearInterval(id)
    }
    let unsub = () => {}
    try {
      unsub = db.subscribeCrewTasks(() => load(dateRef.current))
      setLive(true)
    } catch (e) { console.error(e); setLive(false) }
    return () => { try { unsub() } catch (e) { /* noop */ } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pub])

  // Tick the clock and roll the day over at midnight.
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setClock(now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))
      const t = todayStr()
      if (t !== dateRef.current) setDate(t)
    }
    tick()
    const id = setInterval(tick, 15000)
    return () => clearInterval(id)
  }, [])

  // Scope to this TV's course (its own jobs plus property-wide ones); no course
  // param = whole property.
  const shown = course ? tasks.filter((t) => t.course === course || !t.course) : tasks

  // Group by job (one bubble each), split into rounds — 1st / 2nd / 3rd jobs —
  // so the day's later work shows as its own section on the board.
  const bySlot = {}
  shown.forEach((t) => { const s = t.slot || '1'; const k = t.job || '—'; (bySlot[s] = bySlot[s] || {}); (bySlot[s][k] = bySlot[s][k] || []).push(t) })
  const SLOT_LABELS = { '1': '1st Jobs', '2': '2nd Jobs', '3': '3rd Jobs', '4': '4th Jobs' }
  const slotsPresent = ['1', '2', '3', '4'].filter((k) => bySlot[k] && Object.keys(bySlot[k]).length)

  return (
    <div style={{ height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: `radial-gradient(1200px 600px at 50% -10%, #1d3527 0%, ${FOREST} 60%)`, color: '#F3F0E6', fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}>
      <div style={{ maxWidth: 'none', margin: '0 auto', padding: '2vw 2.4vw', width: '100%', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, borderBottom: `2px solid ${GOLD}`, paddingBottom: '1.4vw', marginBottom: '1.8vw' }}>
          <div>
            {club && <div style={{ fontSize: 'clamp(12px,1.1vw,20px)', letterSpacing: '0.28em', textTransform: 'uppercase', color: GOLD, fontWeight: 600 }}>{club}</div>}
            <div style={{ fontFamily: 'ui-serif, Georgia, serif', fontSize: 'clamp(30px,3.6vw,64px)', fontWeight: 700, lineHeight: 1.05 }}>{course ? `${course} · Crew Board` : 'Crew Board'}</div>
            <div style={{ fontSize: 'clamp(14px,1.4vw,26px)', color: '#C7CFC2', marginTop: 4 }}>{prettyDay(date)}</div>
          </div>
          {weather && weather.temp && (
            <div style={{ textAlign: 'center', color: '#C7CFC2' }}>
              <div style={{ fontFamily: 'ui-serif, Georgia, serif', fontSize: 'clamp(24px,2.6vw,46px)', fontWeight: 700, color: '#F3F0E6', lineHeight: 1 }}>{weather.temp}°<span style={{ fontSize: '0.5em', color: GOLD }}>F</span></div>
              <div style={{ fontSize: 'clamp(10px,0.95vw,17px)', marginTop: 4 }}>{weather.humidity && `${weather.humidity}% hum`}{weather.wind && ` · ${weather.wind} mph ${weather.windDir || ''}`}</div>
            </div>
          )}
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'ui-serif, Georgia, serif', fontSize: 'clamp(26px,3vw,52px)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{clock}</div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 'clamp(11px,1vw,18px)', color: live ? '#9FE3B0' : '#C7CFC2' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: live ? '#57D07A' : '#8AA394', boxShadow: live ? '0 0 0 0 rgba(87,208,122,0.7)' : 'none', animation: live ? 'pulse 2s infinite' : 'none', display: 'inline-block' }} />
              {live ? 'LIVE' : 'Connecting…'}
            </div>
          </div>
        </div>


        {/* Board */}
        {status === 'loading' ? (
          <div style={{ textAlign: 'center', padding: '10vh 0', color: '#8AA394', fontSize: 'clamp(16px,1.6vw,28px)' }}>Loading the board…</div>
        ) : status === 'denied' ? (
          <div style={{ textAlign: 'center', padding: '10vh 0', color: '#E7C9C9', fontSize: 'clamp(15px,1.5vw,26px)' }}>This board link is invalid or expired.<br />Ask for a fresh QR code.</div>
        ) : status === 'error' ? (
          <div style={{ textAlign: 'center', padding: '8vh 0', color: '#E7C9C9', fontSize: 'clamp(15px,1.5vw,26px)' }}>
            Couldn't load the board.<br />
            <span style={{ fontSize: 'clamp(12px,1.1vw,18px)', color: '#B8C2B0' }}>If this is the first run, a manager needs to sign in on this screen and set up the Whiteboard (run phase13.sql in Supabase).</span>
          </div>
        ) : shown.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '12vh 0', color: '#8AA394', fontSize: 'clamp(18px,2vw,34px)', fontFamily: 'ui-serif, Georgia, serif' }}>No jobs posted yet today.</div>
        ) : (
          <div ref={fitWrapRef} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <div ref={fitContentRef} style={{ transformOrigin: 'top left' }}>
          <div style={{ display: 'flex', gap: '1.4vw', alignItems: 'flex-start' }}>
            {/* Jobs — grouped into rounds, in readable columns */}
            <div style={{ flex: '1 1 auto', minWidth: 0 }}>
              {slotsPresent.map((slotKey) => {
              const sGroups = bySlot[slotKey]
              const sKeys = Object.keys(sGroups).sort((a, b) => sGroups[b].length - sGroups[a].length || a.localeCompare(b))
              return (
              <div key={slotKey} style={{ marginBottom: '1.4vw', marginTop: slotsPresent.indexOf(slotKey) > 0 ? '2.4vw' : 0 }}>
                {slotsPresent.length > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '0 0 1vw', padding: '0.6vw 1.1vw', background: 'linear-gradient(90deg, rgba(201,168,76,0.26), rgba(201,168,76,0.03))', borderLeft: `7px solid ${GOLD}`, borderRadius: 12 }}>
                    <span style={{ fontSize: 'clamp(16px,1.6vw,32px)', fontWeight: 900, letterSpacing: '0.14em', textTransform: 'uppercase', color: GOLD }}>{SLOT_LABELS[slotKey]}</span>
                    <span style={{ fontSize: 'clamp(11px,1vw,18px)', fontWeight: 600, color: '#B7C4B4' }}>{Object.keys(sGroups).length} job{Object.keys(sGroups).length !== 1 ? 's' : ''}</span>
                    <div style={{ flex: 1 }} />
                    {slotKey !== '1' && <span style={{ fontSize: 'clamp(11px,1vw,18px)', fontWeight: 700, color: '#B7C4B4' }}>{slotKey === '2' ? 'Afternoon' : 'Later'}</span>}
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.1vw', alignItems: 'start' }}>
                {sKeys.map((jk) => {
              const list = sGroups[jk]
              const langs = [...new Set(list.map((t) => crew[t.assignee]?.lang).filter((l) => l && l !== 'en'))]
              const variants = langs.map((l) => txGet(tx, l, jk)).filter(Boolean)
              // Whole-crew note (group_note) shows once up top; each person's own
              // note (their `notes`, e.g. their greens) shows under their name.
              const groupNoteVal = (list.find((t) => (t.groupNote || '').trim()) || {}).groupNote || ''
              return (
                <div key={jk} style={{ maxWidth: 560, background: '#FBFAF6', borderRadius: 14, overflow: 'hidden', boxShadow: '0 2px 10px rgba(0,0,0,0.28)' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '0.55vw 0.8vw', background: '#E6EDE4', borderBottom: '1px solid #D3DCD2' }}>
                    <div style={{ flex: 1, minWidth: 0, lineHeight: 1.15 }}>
                      <span style={{ fontSize: 'clamp(15px,1.4vw,26px)', fontWeight: 800, color: '#1A2A1F' }}>{jk}</span>
                      {variants.length > 0 && <span style={{ fontSize: 'clamp(12px,1.15vw,21px)', fontWeight: 600, color: '#5E7A67' }}> · {variants.join(' · ')}</span>}
                    </div>
                    <span style={{ fontSize: 'clamp(11px,1vw,17px)', fontWeight: 700, color: '#8A9A8E', fontVariantNumeric: 'tabular-nums' }}>{list.length}</span>
                  </div>
                  {(() => {
                    // Today's mow direction for this surface (auto for greens, "next"
                    // for fairways) — shown with a clock so the crew sees it at a glance.
                    const cn = list[0]?.course || course || ''
                    const dir = directionForJob(courseInfo, cn, jk, date)
                    if (!dir) return null
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0.45vw 0.8vw', background: '#EAF2EC', borderBottom: '1px solid #D3DCD2' }}>
                        <MowPattern step={dir.step} size={88} kind={surfaceKind(dir.surface)} />
                        <div style={{ lineHeight: 1.1 }}>
                          <div style={{ fontSize: 'clamp(10px,0.85vw,15px)', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: FERN }}>Direction of cut</div>
                          <div style={{ fontSize: 'clamp(15px,1.35vw,26px)', fontWeight: 800, color: '#1A2A1F' }}>{stepLabel(dir.step)}</div>
                        </div>
                      </div>
                    )
                  })()}
                  {(() => {
                    if (!groupNoteVal) return null
                    const noteVariants = langs.map((l) => txGet(tx, l, groupNoteVal)).filter((v) => v && v !== groupNoteVal)
                    return (
                      <div style={{ padding: '0.35vw 0.8vw', background: '#FFF7E6', borderBottom: '1px solid #F0E4C8' }}>
                        <div style={{ fontSize: 'clamp(11px,1vw,18px)', color: '#8A5A12', fontWeight: 600 }}>{groupNoteVal}</div>
                        {noteVariants.map((v, i) => <div key={i} style={{ fontSize: 'clamp(11px,1vw,18px)', color: '#A98547', fontStyle: 'italic' }}>{v}</div>)}
                      </div>
                    )
                  })()}
                  <div>
                    {list.map((t) => {
                      const lang = crew[t.assignee]?.lang
                      const tools = (t.equipment || '').split(',').map((s) => s.trim()).filter(Boolean).map((tool) => txGet(tx, lang, tool) || tool)
                      const detail = tools.join(' · ')
                      return (
                        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.4vw 0.7vw', borderLeft: `5px solid ${FERN}`, borderBottom: '1px solid #EFEEE6' }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <span style={{ fontSize: 'clamp(13px,1.2vw,22px)', fontWeight: 600, color: '#23241E' }}>{t.assignee || 'Unassigned'}</span>
                            {detail && <span style={{ fontSize: 'clamp(11px,1vw,18px)', color: '#7C8A80' }}>{'  ·  ' + detail}</span>}
                            {t.notes && <span style={{ fontSize: 'clamp(11px,1vw,18px)', color: FERN, fontWeight: 600 }}>{'  ·  ' + t.notes}</span>}
                          </div>
                          {!course && t.course && <span style={{ fontSize: 'clamp(9px,0.8vw,14px)', fontWeight: 700, color: '#3B5BA5', background: '#E7ECF8', padding: '1px 7px', borderRadius: 999, whiteSpace: 'nowrap' }}>{t.course}</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
                </div>
              </div>
              )
              })}
            </div>
            {/* Vertical hole — a tight column running up the right side */}
            <div style={{ flex: '0 0 clamp(130px, 11vw, 190px)', alignSelf: 'flex-start' }}>
              <div style={{ fontSize: 'clamp(11px,1vw,18px)', letterSpacing: '0.2em', textTransform: 'uppercase', color: GOLD, fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>Today's Cut</div>
              <HoleMap courseInfo={courseInfo} courseName={course} orientation="vertical" />
            </div>
          </div>
          </div>
          </div>
        )}
      </div>
      {boardMessage && (
        <div style={{ flexShrink: 0, background: '#B4232A', color: '#FFF', padding: '0.7vw 2.5vw', fontSize: 'clamp(15px,1.6vw,30px)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 -4px 20px rgba(0,0,0,0.3)' }}>
          <span style={{ fontSize: '1.1em' }}>🔔</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{boardMessage}</span>
        </div>
      )}
      <style>{`@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(87,208,122,0.7) } 70% { box-shadow: 0 0 0 12px rgba(87,208,122,0) } 100% { box-shadow: 0 0 0 0 rgba(87,208,122,0) } }`}</style>
    </div>
  )
}
