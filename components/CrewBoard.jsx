'use client'

// The live crew board — a read-only, TV-optimized view of today's Whiteboard for
// the shop screen. It fetches today's jobs, then subscribes to Realtime so any
// change made on an iPad shows up here within a second, no refresh needed. Big
// type, high contrast, and it rolls over to the new day on its own overnight.
import { useState, useEffect, useCallback, useRef } from 'react'
import * as db from '@/lib/db'
import { loadTranslations, txGet } from '@/lib/translate'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#C9A84C'

const todayStr = () => new Date().toISOString().slice(0, 10)
const prettyDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

const STATUS = {
  todo: { label: 'To do', bg: 'rgba(255,255,255,0.08)', fg: '#CBD5E1', bd: 'rgba(255,255,255,0.18)' },
  doing: { label: 'Doing', bg: GOLD, fg: FOREST, bd: GOLD },
  done: { label: 'Done', bg: FERN, fg: '#FFFFFF', bd: FERN },
}

export default function CrewBoard() {
  const [date, setDate] = useState(todayStr())
  const [tasks, setTasks] = useState([])
  const [club, setClub] = useState('')
  const [crew, setCrew] = useState({})
  const [tx, setTx] = useState({})
  const [clock, setClock] = useState('')
  const [status, setStatus] = useState('loading') // loading | ok | error
  const [live, setLive] = useState(false)
  const dateRef = useRef(date)
  useEffect(() => { dateRef.current = date }, [date])

  const load = useCallback(async (d) => {
    try {
      const t = await db.fetchCrewTasks(d, d)
      setTasks(t)
      setStatus('ok')
    } catch (e) {
      console.error(e)
      setStatus('error')
    }
  }, [])

  // Club name + crew languages once.
  useEffect(() => { (async () => { try { const s = await db.fetchSettings(); setClub(s.courseInfo?.clubName || ''); setCrew(s.courseInfo?.crew || {}) } catch (e) { console.error(e) } })() }, [])

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

  // Live subscription — refetch the current day on any board change.
  useEffect(() => {
    let unsub = () => {}
    try {
      unsub = db.subscribeCrewTasks(() => load(dateRef.current))
      setLive(true)
    } catch (e) { console.error(e); setLive(false) }
    return () => { try { unsub() } catch (e) { /* noop */ } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const doneCount = tasks.filter((t) => t.status === 'done').length
  const pct = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0

  // Group by assignee — one column per person, Unassigned last.
  const groups = {}
  tasks.forEach((t) => { const k = t.assignee || '__none'; (groups[k] = groups[k] || []).push(t) })
  const groupKeys = Object.keys(groups).sort((a, b) => (a === '__none' ? 1 : b === '__none' ? -1 : a.localeCompare(b)))

  return (
    <div style={{ minHeight: '100vh', background: `radial-gradient(1200px 600px at 50% -10%, #1d3527 0%, ${FOREST} 60%)`, color: '#F3F0E6', fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}>
      <div style={{ maxWidth: 1600, margin: '0 auto', padding: '2.2vw 2.5vw' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, borderBottom: `2px solid ${GOLD}`, paddingBottom: '1.4vw', marginBottom: '1.8vw' }}>
          <div>
            {club && <div style={{ fontSize: 'clamp(12px,1.1vw,20px)', letterSpacing: '0.28em', textTransform: 'uppercase', color: GOLD, fontWeight: 600 }}>{club}</div>}
            <div style={{ fontFamily: 'ui-serif, Georgia, serif', fontSize: 'clamp(30px,3.6vw,64px)', fontWeight: 700, lineHeight: 1.05 }}>Crew Board</div>
            <div style={{ fontSize: 'clamp(14px,1.4vw,26px)', color: '#C7CFC2', marginTop: 4 }}>{prettyDay(date)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'ui-serif, Georgia, serif', fontSize: 'clamp(26px,3vw,52px)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{clock}</div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 'clamp(11px,1vw,18px)', color: live ? '#9FE3B0' : '#C7CFC2' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: live ? '#57D07A' : '#8AA394', boxShadow: live ? '0 0 0 0 rgba(87,208,122,0.7)' : 'none', animation: live ? 'pulse 2s infinite' : 'none', display: 'inline-block' }} />
              {live ? 'LIVE' : 'Connecting…'}
            </div>
          </div>
        </div>

        {/* Progress strip */}
        {status === 'ok' && tasks.length > 0 && (
          <div style={{ marginBottom: '1.8vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'clamp(13px,1.2vw,22px)', color: '#C7CFC2', marginBottom: 8 }}>
              <span><b style={{ color: '#F3F0E6' }}>{tasks.length}</b> jobs · <b style={{ color: '#F3F0E6' }}>{doneCount}</b> done</span>
              <span>{pct}% complete</span>
            </div>
            <div style={{ height: 14, borderRadius: 999, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: GOLD, borderRadius: 999, transition: 'width 0.6s ease' }} />
            </div>
          </div>
        )}

        {/* Board */}
        {status === 'loading' ? (
          <div style={{ textAlign: 'center', padding: '10vh 0', color: '#8AA394', fontSize: 'clamp(16px,1.6vw,28px)' }}>Loading the board…</div>
        ) : status === 'error' ? (
          <div style={{ textAlign: 'center', padding: '8vh 0', color: '#E7C9C9', fontSize: 'clamp(15px,1.5vw,26px)' }}>
            Couldn't load the board.<br />
            <span style={{ fontSize: 'clamp(12px,1.1vw,18px)', color: '#B8C2B0' }}>If this is the first run, a manager needs to sign in on this screen and set up the Whiteboard (run phase13.sql in Supabase).</span>
          </div>
        ) : tasks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '12vh 0', color: '#8AA394', fontSize: 'clamp(18px,2vw,34px)', fontFamily: 'ui-serif, Georgia, serif' }}>No jobs posted yet today.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.4vw', alignItems: 'start' }}>
            {groupKeys.map((k) => {
              const list = groups[k]
              const gdone = list.filter((t) => t.status === 'done').length
              return (
                <div key={k} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 18, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.9vw 1.1vw', background: k === '__none' ? 'rgba(255,255,255,0.05)' : 'rgba(58,107,74,0.35)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <span style={{ fontSize: 'clamp(16px,1.5vw,28px)', fontWeight: 700 }}>{k === '__none' ? 'Unassigned' : k}</span>
                    <span style={{ fontSize: 'clamp(11px,1vw,18px)', color: '#B8C2B0', fontVariantNumeric: 'tabular-nums' }}>{gdone}/{list.length}</span>
                  </div>
                  <div style={{ padding: '0.7vw 0.8vw', display: 'flex', flexDirection: 'column', gap: '0.6vw' }}>
                    {list.map((t) => {
                      const st = STATUS[t.status] || STATUS.todo
                      const lang = crew[k]?.lang
                      const jobText = txGet(tx, lang, t.job) || t.job
                      const tools = (t.equipment || '').split(',').map((s) => s.trim()).filter(Boolean).map((tool) => txGet(tx, lang, tool) || tool)
                      const sub = [t.area, tools.join(', ')].filter(Boolean).join(' · ')
                      return (
                        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0.55vw 0.7vw', borderRadius: 12, background: t.status === 'done' ? 'rgba(58,107,74,0.14)' : 'rgba(0,0,0,0.14)' }}>
                          <span style={{ fontSize: 'clamp(10px,0.85vw,15px)', fontWeight: 800, letterSpacing: '0.03em', textTransform: 'uppercase', padding: '4px 10px', borderRadius: 999, background: st.bg, color: st.fg, border: `1px solid ${st.bd}`, whiteSpace: 'nowrap' }}>{st.label}</span>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 'clamp(15px,1.35vw,24px)', fontWeight: 600, color: t.status === 'done' ? '#8AA394' : '#F3F0E6', textDecoration: t.status === 'done' ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{jobText}</div>
                            {sub && <div style={{ fontSize: 'clamp(11px,1vw,17px)', color: '#8AA394', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      <style>{`@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(87,208,122,0.7) } 70% { box-shadow: 0 0 0 12px rgba(87,208,122,0) } 100% { box-shadow: 0 0 0 0 rgba(87,208,122,0) } }`}</style>
    </div>
  )
}
