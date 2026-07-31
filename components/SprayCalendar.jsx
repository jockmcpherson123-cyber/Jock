'use client'

// Month calendar for the home dashboard: shows planned sprays (from the annual
// program) and actual spray sheets (past and upcoming) at a glance. Tap a day
// to see what's on it and, for planned work, start a spray sheet from it.
import { useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Calendar as CalIcon, RotateCw } from 'lucide-react'
import { rotationWarnings } from '@/lib/calc'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#C9A84C'
// Clubhouse × Instrument restyle tokens (mirror globals.css / SprayApp.jsx)
const PAPER = '#F9F8F5'
const HAIR = '#E2E0DB'
const INK_2 = '#5B6160'
const INK_3 = '#8A8984'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function ymd(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// Shorten an area name for the tiny calendar labels: drop the equipment suffix
// so "Blue Greens SprayBug 1.67gpm" reads as "Blue Greens".
function shortArea(name) {
  if (!name) return ''
  const stripped = String(name).split(/\s+(?:HD\d|SprayBug|Spray Bug|HD)/i)[0].trim()
  const words = stripped.split(/\s+/)
  return words.slice(0, 2).join(' ')
}
function todayKey() {
  const n = new Date()
  return ymd(n.getFullYear(), n.getMonth(), n.getDate())
}

export default function SprayCalendar({ sheets = [], products = [], programApps = [], onOpenSheet, onCreateFromProgram }) {
  const now = new Date()
  // FRAC/IRAC/HRAC group per product name, for the resistance-code chips.
  const moaOf = {}
  products.forEach((p) => { if (p.moaGroup) moaOf[p.name] = String(p.moaGroup).trim() })
  const [view, setView] = useState({ y: now.getFullYear(), m: now.getMonth() }) // m: 0-based
  const [selected, setSelected] = useState(todayKey())

  // Index sprays and planned applications by date for quick lookup.
  const sheetsByDate = {}
  sheets.forEach((s) => {
    if (!s.date) return
    ;(sheetsByDate[s.date] ||= []).push(s)
  })
  const programByDate = {}
  programApps.forEach((a) => {
    if (!a.plannedDate || a.linkedSheetId) return
    ;(programByDate[a.plannedDate] ||= []).push(a)
  })

  // Build a 6-week (42-cell) grid starting on the Sunday on/before the 1st.
  const first = new Date(view.y, view.m, 1)
  const start = new Date(view.y, view.m, 1 - first.getDay())
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate(), key: ymd(d.getFullYear(), d.getMonth(), d.getDate()) }
  })

  const monthLabel = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const tKey = todayKey()

  const step = (delta) => {
    let m = view.m + delta
    let y = view.y
    if (m < 0) { m = 11; y-- }
    if (m > 11) { m = 0; y++ }
    setView({ y, m })
  }
  const goToday = () => { setView({ y: now.getFullYear(), m: now.getMonth() }); setSelected(tKey) }

  const selSheets = sheetsByDate[selected] || []
  const selPlanned = programByDate[selected] || []
  // Group the selected day's planned applications by area (one sheet per area).
  const plannedByArea = {}
  selPlanned.forEach((a) => { (plannedByArea[a.area] ||= []).push(a) })

  return (
    <section>
      <div className="paper-card overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${HAIR}` }}>
          <div className="flex items-center gap-2">
            <CalIcon size={16} style={{ color: FERN }} />
            <p className="font-display text-base font-semibold" style={{ color: FOREST }}>{monthLabel}</p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={goToday} className="font-body text-[11px] font-semibold px-2.5 py-1 rounded-md mr-1" style={{ color: INK_2, border: `1px solid ${HAIR}` }}>Today</button>
            <button onClick={() => step(-1)} className="p-1.5 rounded-md"><ChevronLeft size={16} style={{ color: INK_2 }} /></button>
            <button onClick={() => step(1)} className="p-1.5 rounded-md"><ChevronRight size={16} style={{ color: INK_2 }} /></button>
          </div>
        </div>

        {/* Weekday labels */}
        <div className="grid grid-cols-7 px-2 pt-2">
          {WEEKDAYS.map((w) => (
            <div key={w} className="text-center font-body text-[10px] font-bold uppercase tracking-wide py-1" style={{ color: INK_3 }}>{w}</div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7 gap-1 p-2">
          {cells.map((c) => {
            const inMonth = c.m === view.m
            const isToday = c.key === tKey
            const isSel = c.key === selected
            const daySheets = sheetsByDate[c.key] || []
            const dayPlanned = programByDate[c.key] || []

            // Build de-duplicated area labels for the day: actual sprays first
            // (green approved / amber pending), then planned (gold).
            const labels = []
            const seen = new Set()
            daySheets.forEach((s) => {
              const a = shortArea(s.area)
              if (a && !seen.has(a)) { seen.add(a); labels.push({ area: a, color: s.status === 'approved' ? FERN : '#D97706' }) }
            })
            dayPlanned.forEach((a) => {
              const nm = shortArea(a.area)
              if (nm && !seen.has(nm)) { seen.add(nm); labels.push({ area: nm, color: GOLD }) }
            })
            const shown = labels.slice(0, 2)
            const extra = labels.length - shown.length

            return (
              <button
                key={c.key}
                onClick={() => setSelected(c.key)}
                className="min-h-[3.25rem] sm:min-h-[4.5rem] rounded-lg flex flex-col items-stretch p-1 text-left transition overflow-hidden"
                style={{
                  backgroundColor: isSel ? '#EAF2EC' : 'transparent',
                  border: isToday ? `1px solid ${GOLD}` : '1px solid transparent',
                  opacity: inMonth ? 1 : 0.4,
                }}
              >
                <span className="font-body text-[11px] font-semibold px-0.5 tnum" style={{ color: isSel ? FOREST : INK_2 }}>{c.d}</span>
                <div className="mt-0.5 space-y-0.5 overflow-hidden">
                  {shown.map((it, i) => (
                    <div key={i} className="flex items-center gap-1 rounded px-0.5" style={{ backgroundColor: `${it.color}18` }}>
                      <span className="w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: it.color }} />
                      <span className="font-body text-[8px] leading-tight truncate" style={{ color: INK_2 }}>{it.area}</span>
                    </div>
                  ))}
                  {extra > 0 && <span className="font-body text-[8px] px-0.5" style={{ color: INK_3 }}>+{extra} more</span>}
                </div>
              </button>
            )
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 px-4 py-2 font-body text-[10px]" style={{ borderTop: `1px solid ${HAIR}`, color: INK_3 }}>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: GOLD }} /> Planned</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#D97706' }} /> Pending</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: FERN }} /> Approved</span>
        </div>
      </div>

      {/* Selected-day detail */}
      <div className="mt-3">
        <p className="eyebrow mb-2">
          {new Date(selected + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>

        {selSheets.length === 0 && selPlanned.length === 0 ? (
          <div className="paper-card p-6 text-center font-body text-sm" style={{ color: INK_3 }}>
            Nothing scheduled for this day.
          </div>
        ) : (
          <div className="space-y-2">
            {/* Actual spray sheets */}
            {selSheets.map((s) => {
              const lines = (s.products || []).filter((p) => p.product)
              const warns = new Set(rotationWarnings(s, sheets, products).map((w) => w.product))
              return (
                <button key={s.id} onClick={() => onOpenSheet?.(s)} className="w-full text-left paper-card p-4">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="font-body text-sm font-semibold truncate" style={{ color: FOREST }}>{s.sheetType} · {s.area}</p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {warns.size > 0 && (
                        <span className="font-body text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wide flex items-center gap-1" style={{ backgroundColor: '#FEE2E2', color: '#B91C1C' }}>
                          <RotateCw size={9} /> Rotation
                        </span>
                      )}
                      <span className="font-body text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wide" style={s.status === 'approved' ? { backgroundColor: '#E8F3EC', color: FERN } : { backgroundColor: '#FEF3DD', color: '#92660D' }}>
                        {s.status}
                      </span>
                    </div>
                  </div>
                  {lines.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {lines.map((p, i) => {
                        const code = moaOf[p.product]
                        const risky = warns.has(p.product)
                        return (
                          <span key={i} className="font-body text-[11px] px-2 py-0.5 rounded-md flex items-center gap-1" style={{ backgroundColor: risky ? '#FEF2F2' : '#EEF4EF', color: risky ? '#B91C1C' : FERN, border: risky ? '1px solid #FECACA' : `1px solid ${HAIR}` }}>
                            {p.product}
                            {code && <span className="font-bold opacity-70" style={{ fontSize: '9px' }}>· {code}</span>}
                          </span>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="font-body text-[11px]" style={{ color: INK_3 }}>No products</p>
                  )}
                </button>
              )
            })}

            {/* Planned from the program (one card per area) */}
            {Object.entries(plannedByArea).map(([area, items]) => (
              <div key={area} className="paper-card p-4 flex items-center justify-between gap-3" style={{ borderColor: '#E8CE92' }}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: GOLD }} />
                    <p className="font-body text-sm font-semibold truncate" style={{ color: FOREST }}>{area}</p>
                    <span className="font-body text-[10px]" style={{ color: INK_3 }}>planned</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map((a, i) => {
                      const code = moaOf[a.product]
                      return (
                        <span key={i} className="font-body text-[11px] px-2 py-0.5 rounded-md flex items-center gap-1" style={{ backgroundColor: '#FBF6E7', color: '#92660D' }}>
                          {a.product}
                          {code && <span className="font-bold opacity-70" style={{ fontSize: '9px' }}>· {code}</span>}
                        </span>
                      )
                    })}
                  </div>
                </div>
                {onCreateFromProgram && (
                  <button onClick={() => onCreateFromProgram(items)} className="font-body text-xs font-bold px-3.5 py-2 rounded-full text-white shrink-0 flex items-center gap-1.5" style={{ backgroundColor: FOREST }}>
                    <Plus size={13} /> Create sheet
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
