'use client'

// Read-only tournament board for a shop / clubhouse TV. Shows live check-in
// numbers and the job board (who's assigned where, and who has arrived),
// updating in real time as people are checked in at the desk.
import { useState, useEffect, useCallback } from 'react'
import * as db from '@/lib/db'
import { personStatus, rosterStats, byCommittee, committeesOf, shiftLabel } from '@/lib/tournament'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#C9A84C'

export default function TournamentBoard() {
  const [tournament, setTournament] = useState(null)
  const [people, setPeople] = useState([])
  const [loading, setLoading] = useState(true)
  const [clock, setClock] = useState('')

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
    tick(); const id = setInterval(tick, 30000); return () => clearInterval(id)
  }, [])

  const loadTournament = useCallback(async () => {
    try {
      const list = await db.fetchTournaments()
      const active = list.find((t) => t.isActive) || list[0] || null
      setTournament(active)
      return active
    } catch (e) { console.error(e); return null }
    finally { setLoading(false) }
  }, [])

  const loadPeople = useCallback(async (tid) => {
    if (!tid) return
    try { setPeople(await db.fetchPeople(tid)) } catch (e) { console.error(e) }
  }, [])

  useEffect(() => { loadTournament().then((t) => t && loadPeople(t.id)) }, [loadTournament, loadPeople])

  useEffect(() => {
    if (!tournament?.id) return
    const off = db.subscribeTournamentPeople(tournament.id, () => loadPeople(tournament.id))
    return off
  }, [tournament?.id, loadPeople])

  if (loading) return <Screen><p style={{ color: 'rgba(255,255,255,0.6)' }}>Loading…</p></Screen>
  if (!tournament) return <Screen><p style={{ color: 'rgba(255,255,255,0.6)' }}>No active tournament. Set one active in the app.</p></Screen>

  const stats = rosterStats(people)
  const committees = committeesOf(tournament)
  const { map } = byCommittee(people, committees)

  return (
    <Screen>
      <div className="flex items-center justify-between mb-6">
        <div>
          <p style={{ color: GOLD }} className="text-sm tracking-[0.3em] uppercase font-bold">Tournament Operations</p>
          <h1 className="text-4xl font-bold text-white">{tournament.name}</h1>
        </div>
        <div className="text-right">
          <p className="text-white text-4xl font-bold tabular-nums">{clock}</p>
        </div>
      </div>

      {/* Big stat tiles */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <BigStat n={stats.here} label="Checked In" color={FERN} />
        <BigStat n={stats.waiting} label="Not In Yet" color={GOLD} />
        <BigStat n={stats.late} label="Late" color="#E5534B" />
        <BigStat n={stats.total} label="Total Roster" color="#334155" />
      </div>

      {/* Job board */}
      <div className="grid grid-cols-3 gap-4">
        {committees.filter((c) => (map[c] || []).length > 0).map((c) => {
          const list = map[c] || []
          const inCount = list.filter((p) => personStatus(p).key === 'in').length
          return (
            <div key={c} className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
              <div className="flex items-center justify-between mb-2 pb-2" style={{ borderBottom: `2px solid ${GOLD}` }}>
                <span className="text-white text-xl font-bold">{c}</span>
                <span className="text-lg font-bold" style={{ color: inCount === list.length ? FERN : GOLD }}>{inCount}/{list.length}</span>
              </div>
              <div className="space-y-1">
                {list.map((p) => {
                  const st = personStatus(p)
                  return (
                    <div key={p.id} className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: st.key === 'in' ? FERN : st.late ? '#E5534B' : 'rgba(255,255,255,0.3)' }} />
                      <span className="text-base truncate" style={{ color: st.key === 'in' ? 'white' : 'rgba(255,255,255,0.55)' }}>{p.name}</span>
                      <span className="text-xs ml-auto shrink-0" style={{ color: 'rgba(255,255,255,0.4)' }}>{shiftLabel(tournament, p.shift)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </Screen>
  )
}

function Screen({ children }) {
  return <div style={{ minHeight: '100vh', backgroundColor: FOREST }} className="p-8">{children}</div>
}

function BigStat({ n, label, color }) {
  return (
    <div className="rounded-2xl p-5 text-center" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
      <div className="text-6xl font-bold" style={{ color }}>{n}</div>
      <div className="text-sm font-bold uppercase tracking-wide mt-1" style={{ color: 'rgba(255,255,255,0.6)' }}>{label}</div>
    </div>
  )
}
