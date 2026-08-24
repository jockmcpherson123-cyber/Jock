'use client'

// Weekly look-ahead report: next calendar week's planned sprays plus this
// week's collected data (greens speed, clipping yields, mowing/cultural
// practices) and the weather — this week's actuals and next week's forecast.
// Print it, save it as a PDF, or email it to an assistant in one click.
import { useState, useEffect, useMemo, useRef } from 'react'
import * as db from '@/lib/db'
import { Printer, Download, Mail, Loader2, Calendar, Thermometer, Scissors, Gauge, Sprout } from 'lucide-react'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#C9A84C'
const TYPE_COLOR = { Fungicide: '#3A6B4A', Herbicide: '#D97706', Insecticide: '#DC2626', 'Growth Reg': '#7C3AED', Fertilizer: '#2563EB', Biological: '#0D9488', 'Wetting Agent': '#64748B' }
const typeColor = (t) => TYPE_COLOR[t] || '#64748B'

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const fmtLong = (d) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const fmtDay = (isoStr) => (isoStr ? new Date(isoStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '')
const round = (n, p = 0) => { const f = 10 ** p; return Math.round(n * f) / f }
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null)

// Monday of this week, and the Monday–Sunday of NEXT week.
function weekWindows(today = new Date()) {
  const d = new Date(today); d.setHours(0, 0, 0, 0)
  const day = d.getDay() // 0 Sun … 6 Sat
  const thisMon = new Date(d); thisMon.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  const thisSun = new Date(thisMon); thisSun.setDate(thisMon.getDate() + 6)
  const nextMon = new Date(thisMon); nextMon.setDate(thisMon.getDate() + 7)
  const nextSun = new Date(nextMon); nextSun.setDate(nextMon.getDate() + 6)
  return { thisMon, thisSun, nextMon, nextSun, today: d }
}

export default function WeeklyReport({ daily = [], clippings = [], practices = [], speeds = [], areas = {}, courseInfo = {}, onSaveCourse }) {
  const [apps, setApps] = useState([])
  const [fertSheets, setFertSheets] = useState([])
  const [program, setProgram] = useState(null)
  const [loading, setLoading] = useState(true)
  const [course, setCourse] = useState('all')
  const [recipient, setRecipient] = useState(courseInfo.reportRecipient || '')
  const [sender, setSender] = useState(courseInfo.reportSender || courseInfo.directorName || '')
  const [notes, setNotes] = useState(courseInfo.reportNotes || '')
  const [schedule, setSchedule] = useState(Array.isArray(courseInfo.reportSchedule) ? courseInfo.reportSchedule : [])
  const [schedDay, setSchedDay] = useState('Any')
  const [schedText, setSchedText] = useState('')
  const [manual, setManual] = useState(courseInfo.reportManual && typeof courseInfo.reportManual === 'object' ? courseInfo.reportManual : {})
  const [hocRows, setHocRows] = useState(Array.isArray(courseInfo.hocList) ? courseInfo.hocList : [])
  const [editKey, setEditKey] = useState(null) // which inline field is being edited
  const [draft, setDraft] = useState('')       // its working value
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState(null)
  const reportRef = useRef(null)

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(null), 4500) }

  // Persist the notes + schedule draft so they survive a reload.
  const saveDraft = (patch) => { if (onSaveCourse) onSaveCourse(patch) }
  const DAYS = ['Any', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const dayRank = (d) => { const i = DAYS.indexOf(d); return i <= 0 ? 99 : i }
  const addSchedItem = () => {
    const text = schedText.trim()
    if (!text) return
    const next = [...schedule, { id: `s${Date.now()}`, day: schedDay, text }]
    setSchedule(next); setSchedText(''); setSchedDay('Any'); saveDraft({ reportSchedule: next })
  }
  const removeSchedItem = (id) => { const next = schedule.filter((s) => s.id !== id); setSchedule(next); saveDraft({ reportSchedule: next }) }
  const orderedSchedule = [...schedule].sort((a, b) => dayRank(a.day) - dayRank(b.day))

  // Inline editing helpers — one field at a time; commit on blur/Enter.
  const startEdit = (key, current) => { setEditKey(key); setDraft(current ?? '') }
  const cancelEdit = () => setEditKey(null)
  const commitManual = (k) => { const next = { ...manual, [k]: draft }; setManual(next); saveDraft({ reportManual: next }); setEditKey(null) }
  const commitNotes = () => { setNotes(draft); saveDraft({ reportNotes: draft }); setEditKey(null) }
  // Height-of-cut inline edits (shares courseInfo.hocList with Turf Performance).
  const persistHoc = (next) => { setHocRows(next); saveDraft({ hocList: next }) }
  const editHoc = (id, field) => { persistHoc(hocRows.map((r) => (r.id === id ? { ...r, [field]: draft } : r))); setEditKey(null) }
  const addHoc = () => { persistHoc([...hocRows, { id: `h${Date.now()}`, surface: '', height: '' }]) }
  const removeHoc = (id) => persistHoc(hocRows.filter((r) => r.id !== id))
  const seedHoc = () => { persistHoc(allMowed.map((a, i) => ({ id: `h${Date.now()}_${i}`, surface: a, height: hocByArea[a] || '' }))) }
  // Schedule inline edits.
  const editSched = (id) => { const next = schedule.map((s) => (s.id === id ? { ...s, text: draft } : s)); setSchedule(next); saveDraft({ reportSchedule: next }); setEditKey(null) }
  const cycleDay = (id) => { const next = schedule.map((s) => (s.id === id ? { ...s, day: DAYS[(DAYS.indexOf(s.day) + 1) % DAYS.length] } : s)); setSchedule(next); saveDraft({ reportSchedule: next }) }

  useEffect(() => {
    (async () => {
      try {
        const progs = await db.fetchPrograms()
        const active = progs.find((p) => p.status === 'active') || progs[0]
        if (active) { setProgram(active); setApps(await db.fetchApplications(active.id)) }
      } catch (e) { console.error(e) }
      try { setFertSheets(await db.fetchFertSheets()) } catch (e) { console.error(e) }
      setLoading(false)
    })()
  }, [])

  // Courses (e.g. Blue / Gold) come from Settings; areas are named with the
  // course as their first word ("Blue Greens"), so we match by prefix.
  const courseNames = (Array.isArray(courseInfo.courses) ? courseInfo.courses : []).map((c) => c && c.name).filter(Boolean)
  const hasCourses = courseNames.length >= 2
  const inCourse = (area) => course === 'all' || String(area || '').toLowerCase().startsWith(String(course).toLowerCase())
  // "Blue" → "Blue Course", but "Blue Course" stays "Blue Course" (no double word).
  const courseLabel = (c) => (/course/i.test(String(c)) ? String(c) : `${c} Course`)

  const W = useMemo(() => weekWindows(), [])
  const inRange = (dISO, a, b) => dISO && dISO >= iso(a) && dISO <= iso(b)

  // Next week's sprays, grouped by day → area (filtered to the chosen course).
  const sprayDays = useMemo(() => {
    const next = apps.filter((a) => inRange(a.plannedDate, W.nextMon, W.nextSun) && inCourse(a.area))
    const byKey = {}
    next.forEach((a) => {
      const key = `${a.plannedDate}||${a.area}`
      if (!byKey[key]) byKey[key] = { date: a.plannedDate, area: a.area, items: [] }
      byKey[key].items.push(a)
    })
    return Object.values(byKey).sort((x, y) => x.date.localeCompare(y.date) || String(x.area).localeCompare(String(y.area)))
  }, [apps, W, course])

  // Next week's fertility sheets (planned feeds).
  const fertNext = useMemo(() => (
    fertSheets
      .filter((f) => inRange(f.appDate, W.nextMon, W.nextSun) && inCourse(f.area))
      .sort((a, b) => String(a.appDate).localeCompare(String(b.appDate)) || String(a.area).localeCompare(String(b.area)))
  ), [fertSheets, W, course])
  const npk = (an) => { const n = an?.n ?? an?.N, p = an?.p ?? an?.P, k = an?.k ?? an?.K; return [n, p, k].every((x) => x == null || x === '') ? '' : `${n || 0}-${p || 0}-${k || 0}` }

  // Weather split: past rows this week (actuals) and next-week forecast rows.
  const wxThis = daily.filter((r) => inRange(r.date, W.thisMon, W.today))
  const wxNext = daily.filter((r) => inRange(r.date, W.nextMon, W.nextSun))
  const wxSummary = (rows) => {
    const highs = rows.map((r) => r.tMax).filter((n) => n != null)
    const lows = rows.map((r) => r.tMin).filter((n) => n != null)
    const precip = rows.map((r) => r.precip || 0).reduce((a, b) => a + b, 0)
    return { avgHigh: avg(highs), avgLow: avg(lows), precip, n: rows.length }
  }
  const twx = wxSummary(wxThis)
  const nwx = wxSummary(wxNext)

  // This week's collected data (filtered to the chosen course).
  const speedsThis = speeds.filter((s) => inRange(s.date, W.thisMon, W.thisSun) && s.speed != null && inCourse(s.area))
  const clipsThis = clippings.filter((c) => inRange(c.date, W.thisMon, W.thisSun) && c.volume != null && inCourse(c.area))
  // Height of cut — maintained list stored in settings, edited inline here or
  // from Turf Performance (same courseInfo.hocList). Keep a local mirror synced.
  const hocExtKey = JSON.stringify(courseInfo.hocList || [])
  useEffect(() => { setHocRows(Array.isArray(courseInfo.hocList) ? courseInfo.hocList : []) }, [hocExtKey])
  const hocShown = hocRows.filter((r) => !r.surface || inCourse(r.surface))
  const MOWED_SURFACE = /green|collar|tee|approach|fairway|surround|rough/i
  const surfRank = (n) => { const i = ['green', 'collar', 'tee', 'approach', 'fairway', 'surround', 'rough'].findIndex((x) => String(n).toLowerCase().includes(x)); return i < 0 ? 99 : i }
  const allMowed = Object.keys(areas || {}).filter((a) => MOWED_SURFACE.test(a)).sort((a, b) => surfRank(a) - surfRank(b) || a.localeCompare(b))
  const mowRe = /mow|height|hoc|cut/i
  const hocByArea = useMemo(() => {
    const m = {}
    practices.forEach((p) => { if (mowRe.test(p.practice || '') && p.value != null && p.value !== '' && !m[p.area]) m[p.area] = `${p.value}${/["']|in|mm/i.test(String(p.unit)) ? p.unit : (p.unit ? ' ' + p.unit : '"')}` })
    return m
  }, [practices])

  const speedStat = (() => {
    const vals = speedsThis.map((s) => Number(s.speed)).filter((n) => !isNaN(n))
    if (!vals.length) return null
    return { avg: round(avg(vals), 1), min: round(Math.min(...vals), 1), max: round(Math.max(...vals), 1), n: vals.length }
  })()

  const clipStat = (() => {
    if (!clipsThis.length) return null
    const unit = clipsThis[0].unit || 'L'
    const byArea = {}
    clipsThis.forEach((c) => { byArea[c.area] = (byArea[c.area] || 0) + Number(c.volume || 0) })
    return { unit, byArea, total: round(clipsThis.reduce((a, c) => a + Number(c.volume || 0), 0), 1) }
  })()

  // Displayed this-week numbers: logged data wins; otherwise the quick-fill value.
  const mv = (k) => (manual[k] != null && String(manual[k]).trim() !== '' ? String(manual[k]).trim() : null)
  const dStimpAvg = speedStat ? `${speedStat.avg}'` : (mv('stimpAvg') ? `${mv('stimpAvg')}'` : '—')
  const dStimpRange = speedStat ? `${speedStat.min}–${speedStat.max}` : (mv('stimpRange') || '—')
  const dClip = clipStat ? `${clipStat.total}` : (mv('clippings') || '—')
  const dClipUnit = clipStat ? clipStat.unit : (mv('clippings') ? (mv('clipUnit') || 'L') : '')
  const dHigh = twx.n ? `${round(twx.avgHigh)}°` : (mv('wxHigh') ? `${mv('wxHigh')}°` : '—')
  const dLow = twx.n ? `${round(twx.avgLow)}°` : (mv('wxLow') ? `${mv('wxLow')}°` : '—')
  const dPrecip = twx.n ? `${round(twx.precip, 2)}"` : (mv('wxPrecip') ? `${mv('wxPrecip')}"` : '—')

  // ── Output actions ──────────────────────────────────────────────────────
  // Capture the whole report as one image and scale it to fit a single A4 page
  // — the report is meant to print on one sheet.
  async function makePdf() {
    const html2canvas = (await import('html2canvas')).default
    const { jsPDF } = await import('jspdf')
    const canvas = await html2canvas(reportRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: 820 })
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' })
    const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight()
    const m = 16
    let w = pw - m * 2
    let h = canvas.height * (w / canvas.width)
    const availH = ph - m * 2
    if (h > availH) { h = availH; w = canvas.width * (h / canvas.height) }
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', (pw - w) / 2, m, w, h)
    return { blob: pdf.output('blob'), base64: pdf.output('datauristring').split(',')[1] }
  }
  const fileName = () => `Weekly_Report_${iso(W.nextMon)}.pdf`

  async function onDownload() {
    setBusy('pdf')
    try {
      const { blob } = await makePdf()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = fileName(); a.click()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch (e) { console.error(e); showToast('Could not build the PDF') }
    setBusy('')
  }

  function onPrint() { window.print() }

  async function onEmail() {
    if (!recipient) { showToast('Add a recipient email first'); return }
    setBusy('email')
    try {
      if (onSaveCourse && (recipient !== courseInfo.reportRecipient || sender !== courseInfo.reportSender)) {
        onSaveCourse({ reportRecipient: recipient, reportSender: sender })
      }
      const { base64 } = await makePdf()
      const subject = `Weekly Turf & Spray Report${course !== 'all' ? ` (${courseLabel(course)})` : ''} — week of ${fmtLong(W.nextMon)}`
      const res = await fetch('/api/send-report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: recipient, subject, filename: fileName(), pdfBase64: base64, text: emailText() }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.ok) { showToast(`Sent to ${recipient}`) }
      else if (res.status === 501 || j.error === 'email_not_configured') { showToast('Email isn’t set up yet — see the note below the buttons') }
      else { showToast(j.error ? `Could not send: ${j.error}` : 'Could not send the email') }
    } catch (e) { console.error(e); showToast('Could not send the email') }
    setBusy('')
  }
  const emailText = () => {
    const lines = [`Weekly Turf & Spray Report`, `${course !== 'all' ? courseLabel(course) + ' · ' : ''}Week of ${fmtLong(W.nextMon)} – ${fmtLong(W.nextSun)}`, '', 'Planned sprays:']
    if (sprayDays.length === 0) lines.push('  None scheduled.')
    sprayDays.forEach((d) => { lines.push(`  ${fmtDay(d.date)} · ${d.area}: ${d.items.map((i) => i.product).join(', ')}`) })
    if (fertNext.length) { lines.push('', 'Fertility:'); fertNext.forEach((f) => lines.push(`  ${fmtDay(f.appDate)} · ${f.area}: ${f.product || 'Fertilizer'}${npk(f.analysis) ? ` (${npk(f.analysis)})` : ''}`)) }
    if (schedule.length) { lines.push('', 'Schedule:'); orderedSchedule.forEach((s) => lines.push(`  ${s.day !== 'Any' ? s.day + ' — ' : ''}${s.text}`)) }
    if (nwx.n) lines.push('', `Next week forecast: avg high ${round(nwx.avgHigh)}°F / low ${round(nwx.avgLow)}°F, ${round(nwx.precip, 2)}" precip.`)
    if (notes.trim()) lines.push('', 'Notes:', notes.trim())
    lines.push('', 'Full formatted report attached as a PDF.')
    return lines.join('\n')
  }

  if (loading) return <div className="pt-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={26} /></div>

  const club = courseInfo.clubName || 'Golf Club'
  const H = ({ icon: Icon, children }) => (
    <div className="flex items-center gap-1.5 mb-1 mt-3">
      <Icon size={12} style={{ color: FERN }} />
      <h3 className="font-display text-[12px] font-bold" style={{ color: FOREST }}>{children}</h3>
    </div>
  )

  return (
    <div>
      {/* Print rules: only the report prints, sized to one A4 page. */}
      <style>{`@page { size: A4 portrait; margin: 8mm; } @media print { html, body { background: #fff !important; } body * { visibility: hidden !important; } #weekly-report, #weekly-report * { visibility: visible !important; } #weekly-report { position: absolute; left: 0; top: 0; width: 100%; max-width: 100% !important; padding: 0 !important; margin: 0 !important; box-shadow: none !important; border: 0 !important; border-radius: 0 !important; } #weekly-report .avoid-break { break-inside: avoid; } .no-print, .empty-hide-print { display: none !important; } }`}</style>

      {toast && <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 text-white px-4 py-2.5 rounded-full shadow-xl text-sm font-body" style={{ backgroundColor: '#1A1A16' }}>{toast}</div>}

      {/* Course selector (never printed) */}
      {hasCourses && (
        <div className="no-print mb-3 flex flex-wrap gap-2">
          {['all', ...courseNames].map((c) => {
            const on = course === c
            return (
              <button key={c} onClick={() => setCourse(c)} className="font-body text-xs font-bold px-3.5 py-1.5 rounded-full transition" style={on ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>
                {c === 'all' ? 'All courses' : courseLabel(c)}
              </button>
            )
          })}
        </div>
      )}

      {/* Controls (never printed) */}
      <div className="no-print mb-4 flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[180px]">
          <label className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400 block mb-1">Send to (assistant’s email)</label>
          <input type="email" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="assistant@club.org" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
        </div>
        <div className="flex-1 min-w-[140px]">
          <label className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400 block mb-1">From (your name)</label>
          <input value={sender} onChange={(e) => setSender(e.target.value)} placeholder="Jock McPherson" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body" />
        </div>
        <button onClick={onEmail} disabled={busy === 'email'} className="font-body text-sm font-bold px-4 py-2.5 rounded-xl text-white flex items-center gap-1.5 disabled:opacity-50" style={{ backgroundColor: FERN }}>
          {busy === 'email' ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />} Email report
        </button>
        <button onClick={onDownload} disabled={busy === 'pdf'} className="font-body text-sm font-bold px-4 py-2.5 rounded-xl flex items-center gap-1.5 border disabled:opacity-50" style={{ color: FOREST, borderColor: FOREST }}>
          {busy === 'pdf' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} PDF
        </button>
        <button onClick={onPrint} className="font-body text-sm font-bold px-4 py-2.5 rounded-xl flex items-center gap-1.5 border" style={{ color: FOREST, borderColor: '#E2E8F0' }}>
          <Printer size={15} /> Print
        </button>
      </div>

      <p className="no-print mb-3 font-body text-[11px] text-slate-400">Tap any value on the report below to edit it — notes, schedule, the this-week numbers, and heights of cut. Sprays &amp; fertility come from your Annual Program and fert sheets.</p>

      {/* The report sheet */}
      <div id="weekly-report" ref={reportRef} className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 max-w-3xl mx-auto">
        <div className="flex items-start justify-between gap-4 pb-2.5 border-b-2" style={{ borderColor: GOLD }}>
          <div>
            <p className="font-display text-[9px] tracking-[0.22em] uppercase" style={{ color: GOLD }}>{club}</p>
            <h2 className="font-display text-xl font-semibold mt-0.5" style={{ color: FOREST }}>Weekly Turf &amp; Spray Report</h2>
            <p className="font-body text-[12px] text-slate-500 mt-0.5">Week of <b>{fmtLong(W.nextMon)} – {fmtLong(W.nextSun)}, {W.nextSun.getFullYear()}</b>{hasCourses && <span className="font-bold" style={{ color: FERN }}> · {course === 'all' ? 'All courses' : courseLabel(course)}</span>}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="font-body text-[10px] text-slate-400">Prepared {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
            {sender && <p className="font-body text-[10px] text-slate-400">by {sender}</p>}
          </div>
        </div>

        {/* Notes callout (tap to edit) */}
        <div className={`mt-2.5 rounded-lg px-3 py-2 avoid-break ${notes.trim() ? '' : 'empty-hide-print'}`} style={{ backgroundColor: '#FFFDF2', border: '1px solid #EFE3B8' }}>
          <p className="font-body text-[9px] font-bold uppercase tracking-wide mb-0.5" style={{ color: '#92660D' }}>Notes</p>
          {editKey === 'notes' ? (
            <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commitNotes} rows={3} className="w-full border rounded px-2 py-1 text-[12px] font-body resize-y" style={{ borderColor: '#E0D6A8', backgroundColor: '#fff' }} />
          ) : (
            <p onClick={() => startEdit('notes', notes)} className="font-body text-[12px] text-slate-700 whitespace-pre-wrap leading-snug cursor-text">{notes.trim() || <span className="text-slate-300 no-print">Tap to add notes…</span>}</p>
          )}
        </div>

        {/* Sprays next week */}
        <H icon={Calendar}>Planned sprays — next week</H>
        {sprayDays.length === 0 ? (
          <p className="font-body text-[12px] text-slate-400">No sprays scheduled for next week{program ? '' : ' (no active program found)'}.</p>
        ) : (
          <div className="space-y-1.5">
            {sprayDays.map((d) => (
              <div key={`${d.date}-${d.area}`} className="rounded-lg border border-black/5 overflow-hidden avoid-break">
                <div className="flex items-center justify-between px-2.5 py-1" style={{ backgroundColor: '#F0F6F2' }}>
                  <span className="font-body text-[11.5px] font-bold" style={{ color: FOREST }}>{fmtDay(d.date)}</span>
                  <span className="font-body text-[10.5px] font-semibold" style={{ color: FERN }}>{d.area}</span>
                </div>
                <table className="w-full border-collapse">
                  <tbody>
                    {d.items.map((a) => (
                      <tr key={a.id} className="border-t border-black/5">
                        <td className="px-2.5 py-1 align-top" style={{ borderLeft: `3px solid ${typeColor(a.type)}` }}>
                          <span className="font-body text-[12px] font-bold text-slate-800">{a.product}</span>
                          {a.type && <span className="font-body text-[8.5px] font-bold uppercase tracking-wide ml-1.5" style={{ color: typeColor(a.type) }}>{a.type}</span>}
                        </td>
                        <td className="px-2.5 py-1 font-body text-[10.5px] text-slate-500 whitespace-nowrap tabular-nums align-top">{a.rateOzM ? `${a.rateOzM} oz/M` : a.rateOzA ? `${a.rateOzA} oz/A` : ''}</td>
                        <td className="px-2.5 py-1 font-body text-[10.5px] text-slate-500 align-top">{a.target || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        {/* Fertility + Schedule side by side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5">
          <div className="min-w-0 avoid-break">
            <H icon={Sprout}>Fertility &amp; nutrition — next week</H>
            {fertNext.length === 0 ? (
              <p className="font-body text-[12px] text-slate-400">None scheduled.</p>
            ) : (
              <div className="rounded-lg border border-black/5 overflow-hidden">
                <table className="w-full border-collapse">
                  <tbody>
                    {fertNext.map((f) => (
                      <tr key={f.id} className="border-t border-black/5 first:border-t-0">
                        <td className="px-2.5 py-1 align-top" style={{ borderLeft: `3px solid ${typeColor('Fertilizer')}` }}>
                          <span className="font-body text-[12px] font-bold text-slate-800">{f.product || 'Fertilizer'}</span>
                          {npk(f.analysis) && <span className="font-body text-[9px] font-bold ml-1.5" style={{ color: typeColor('Fertilizer') }}>{npk(f.analysis)}</span>}
                          <span className="font-body text-[10px] text-slate-400 ml-1.5">{f.area}</span>
                        </td>
                        <td className="px-2.5 py-1 font-body text-[10px] text-slate-500 whitespace-nowrap tabular-nums text-right align-top">{f.rate ? `${f.rate} lb/M` : ''}</td>
                        <td className="px-2.5 py-1 font-body text-[9px] text-slate-400 text-right whitespace-nowrap align-top">{fmtDay(f.appDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="min-w-0 avoid-break">
            <H icon={Calendar}>Schedule — to get done</H>
            <div className={`rounded-lg border border-black/5 overflow-hidden ${schedule.length ? '' : 'empty-hide-print'}`}>
              {orderedSchedule.map((s) => (
                <div key={s.id} className="flex items-center gap-2 px-2.5 py-1 border-t border-black/5 first:border-t-0">
                  <span className="inline-block w-3.5 h-3.5 rounded border border-slate-300 shrink-0" />
                  <button onClick={() => cycleDay(s.id)} className="font-body text-[9px] font-bold w-8 shrink-0 text-left" style={{ color: FERN }} title="Tap to change day">{s.day !== 'Any' ? s.day : <span className="text-slate-300 no-print">day</span>}</button>
                  {editKey === `sched:${s.id}` ? (
                    <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => editSched(s.id)} onKeyDown={(e) => { if (e.key === 'Enter') editSched(s.id) }} className="flex-1 min-w-0 border rounded px-1.5 py-0.5 text-[12px] font-body" style={{ borderColor: '#E0D6A8' }} />
                  ) : (
                    <span onClick={() => startEdit(`sched:${s.id}`, s.text)} className="font-body text-[12px] text-slate-700 flex-1 min-w-0 cursor-text">{s.text}</span>
                  )}
                  <button onClick={() => removeSchedItem(s.id)} className="no-print text-slate-300 hover:text-red-500 shrink-0 font-bold px-0.5">×</button>
                </div>
              ))}
              {schedule.length === 0 && <p className="font-body text-[11px] text-slate-300 px-2.5 py-1 no-print">No tasks yet.</p>}
            </div>
            <div className="no-print flex gap-1.5 mt-1.5">
              <select value={schedDay} onChange={(e) => setSchedDay(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-body bg-white">
                {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <input value={schedText} onChange={(e) => setSchedText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addSchedItem() }} placeholder="Add a task…" className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm font-body" />
              <button onClick={addSchedItem} className="font-body text-sm font-bold px-3 py-1.5 rounded-lg text-white shrink-0" style={{ backgroundColor: FERN }}>Add</button>
            </div>
          </div>
        </div>

        {/* Weather outlook next week (full width) */}
        <H icon={Thermometer}>Weather outlook — next week</H>
        {nwx.n === 0 ? (
          <p className="font-body text-[12px] text-slate-400">No forecast (set your course location in Settings).</p>
        ) : (
          <div className="flex gap-1 avoid-break">
            {wxNext.map((r) => (
              <div key={r.date} className="flex-1 min-w-0 text-center rounded-lg border border-black/5 py-1" style={{ backgroundColor: '#FCFCFA' }}>
                <p className="font-body text-[8.5px] font-bold uppercase text-slate-400">{new Date(r.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })}</p>
                <p className="font-body text-[11px] font-bold text-slate-700">{round(r.tMax)}°<span className="text-slate-400 font-semibold">/{round(r.tMin)}°</span></p>
                {r.precipProb != null && <p className="font-body text-[8.5px]" style={{ color: r.precipProb >= 50 ? '#2563EB' : '#94A3B8' }}>{round(r.precipProb)}%</p>}
              </div>
            ))}
          </div>
        )}

        {/* This week's data — compact stat band + mowing */}
        <H icon={Gauge}>This week</H>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-1.5 avoid-break">
          {[
            { k: 'stimpAvg', label: 'Stimp avg', display: dStimpAvg, sub: speedStat ? `${speedStat.n}×` : '' },
            { k: 'stimpRange', label: 'Stimp range', display: dStimpRange },
            { k: 'clippings', label: 'Clippings', display: dClip, sub: dClipUnit },
            { k: 'wxHigh', label: 'Avg high', display: dHigh },
            { k: 'wxLow', label: 'Avg low', display: dLow },
            { k: 'wxPrecip', label: 'Precip', display: dPrecip },
          ].map((c) => (
            <div key={c.k} className="rounded-lg border border-black/5 px-2.5 py-1.5" style={{ backgroundColor: '#F8FAF8' }}>
              <p className="font-body text-[8px] font-bold uppercase tracking-wide text-slate-400">{c.label}</p>
              {editKey === `stat:${c.k}` ? (
                <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => commitManual(c.k)} onKeyDown={(e) => { if (e.key === 'Enter') commitManual(c.k) }} className="w-full border rounded px-1 py-0.5 font-body" style={{ borderColor: '#E0D6A8', fontSize: 15 }} />
              ) : (
                <p onClick={() => startEdit(`stat:${c.k}`, manual[c.k] ?? '')} className="font-display font-bold text-slate-900 cursor-text" style={{ fontSize: 16, lineHeight: 1.1 }}>{c.display}{c.sub && <span className="font-body text-[9px] font-normal text-slate-400 ml-1">{c.sub}</span>}</p>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <H icon={Scissors}>Height of cut — by surface</H>
          <div className="no-print flex gap-2">
            {hocRows.length === 0 && allMowed.length > 0 && <button onClick={seedHoc} className="font-body text-[11px] font-bold" style={{ color: FERN }}>Add my surfaces</button>}
            <button onClick={addHoc} className="font-body text-[11px] font-bold" style={{ color: FOREST }}>+ Add</button>
          </div>
        </div>
        <div className={`grid grid-cols-2 md:grid-cols-3 gap-1.5 avoid-break ${hocShown.length ? '' : 'empty-hide-print'}`}>
          {hocShown.map((r) => (
            <div key={r.id} className="rounded-lg border border-black/5 px-2.5 py-1 flex items-center justify-between gap-1.5" style={{ backgroundColor: '#F8FAF8' }}>
              {editKey === `hoc:${r.id}:surface` ? (
                <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => editHoc(r.id, 'surface')} onKeyDown={(e) => { if (e.key === 'Enter') editHoc(r.id, 'surface') }} placeholder="Surface" className="min-w-0 flex-1 border rounded px-1 py-0.5 text-[11px] font-body" style={{ borderColor: '#E0D6A8' }} />
              ) : (
                <span onClick={() => startEdit(`hoc:${r.id}:surface`, r.surface)} className="font-body text-[11px] font-semibold text-slate-600 truncate cursor-text flex-1 min-w-0">{r.surface || <span className="text-slate-300 no-print">Surface</span>}</span>
              )}
              {editKey === `hoc:${r.id}:height` ? (
                <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => editHoc(r.id, 'height')} onKeyDown={(e) => { if (e.key === 'Enter') editHoc(r.id, 'height') }} placeholder="0.105″" className="w-16 border rounded px-1 py-0.5 text-[12px] font-body text-right" style={{ borderColor: '#E0D6A8' }} />
              ) : (
                <span onClick={() => startEdit(`hoc:${r.id}:height`, r.height)} className="font-body text-[13px] font-bold tabular-nums whitespace-nowrap cursor-text" style={{ color: r.height ? FOREST : '#cbd5c9' }}>{r.height || '—'}</span>
              )}
              <button onClick={() => removeHoc(r.id)} className="no-print text-slate-300 hover:text-red-500 shrink-0 font-bold text-xs px-0.5">×</button>
            </div>
          ))}
          {hocShown.length === 0 && <p className="font-body text-[11px] text-slate-300 no-print col-span-full">No surfaces yet — tap “+ Add” or “Add my surfaces”.</p>}
        </div>

        <p className="font-body text-[9px] text-slate-300 mt-3 pt-2 border-t border-black/5">Generated by the {club} turf app · {new Date().toLocaleDateString('en-US')}</p>
      </div>
    </div>
  )
}
