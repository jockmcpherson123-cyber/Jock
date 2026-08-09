'use client'

// ── Tournament Operations ─────────────────────────────────────────────────────
// Run a championship: build the volunteer/crew roster, hand out badge QR codes
// for the PGA to print, check everyone in at the desk (scan or tap), organise
// them onto a job board (TV + printable), and publish a volunteer handbook.
//
// Everything hangs off one "active" tournament. The check-in desk and the TV
// board (/tournament-board) share the same data live via Supabase Realtime.
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Plus, Trash2, Trophy, Users, QrCode, ClipboardList, BookOpen, CheckCircle2,
  Clock, AlertTriangle, Camera, Printer, Upload, Link2, Search, X, Pencil,
  UserCheck, ChevronUp, ChevronDown, Copy, Tv, Download, Image as ImageIcon,
} from 'lucide-react'
import { SearchSelect } from '@/components/pickers'
import { localDateISO } from '@/lib/dates'
import * as db from '@/lib/db'
import {
  PERSON_ROLES, SHIRT_SIZES, SIGNUP_FIELD_TYPES, signupFieldsOf,
  uniqueCode, personStatus, rosterStats, byCommittee, shortTime,
  committeesOf, shiftsOf, shiftLabel, qrDataUrl,
} from '@/lib/tournament'

const FOREST = '#16291F'
const FERN = '#3A6B4A'
const GOLD = '#C9A84C'

// Sponsor tiers (biggest → smallest), like a championship program.
const SPONSOR_TIERS = ['Platinum', 'Gold', 'Silver', 'Bronze', 'Industry Partner']
// Brand-colour presets for the handbook (name → hex). First is the app default.
const BRAND_COLORS = [
  { name: 'Congressional Green', hex: '#16291F' },
  { name: 'Championship Navy', hex: '#1C3A6E' },
  { name: 'Royal Blue', hex: '#1D4ED8' },
  { name: 'Maroon', hex: '#7A1F2B' },
  { name: 'Charcoal', hex: '#26303A' },
  { name: 'Forest Teal', hex: '#0F5257' },
]

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// ── Small shared UI ───────────────────────────────────────────────────────────
function Card({ children, className = '', style }) {
  return <div className={`bg-white rounded-2xl border border-black/5 p-4 shadow-sm ${className}`} style={style}>{children}</div>
}
function Field({ label, children }) {
  return (
    <div>
      <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">{label}</label>
      {children}
    </div>
  )
}
const inputCls = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base font-body bg-white'

function Stat({ n, label, color = FOREST, onClick, active }) {
  return (
    <button onClick={onClick} disabled={!onClick} className="flex-1 rounded-2xl p-3 text-center transition disabled:cursor-default"
      style={{ backgroundColor: active ? color : 'white', border: `1px solid ${active ? color : 'rgba(0,0,0,0.06)'}` }}>
      <div className="font-display text-2xl font-bold" style={{ color: active ? 'white' : color }}>{n}</div>
      <div className="font-body text-[10px] font-bold uppercase tracking-wide mt-0.5" style={{ color: active ? 'rgba(255,255,255,0.85)' : '#94A3B8' }}>{label}</div>
    </button>
  )
}

// Print an HTML body via a hidden iframe (mirrors the spray-sheet print helper).
function printHTML(bodyHtml, { landscape = false } = {}) {
  const iframe = document.createElement('iframe')
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
  document.body.appendChild(iframe)
  const doc = iframe.contentWindow.document
  doc.open()
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:0.5in;size:${landscape ? 'landscape' : 'portrait'}}body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#111}</style></head><body>${bodyHtml}</body></html>`)
  doc.close()
  let fired = false
  const go = () => { if (fired) return; fired = true; try { iframe.contentWindow.focus(); iframe.contentWindow.print() } finally { setTimeout(() => iframe.remove(), 1000) } }
  const imgs = doc.images
  if (imgs && imgs.length) {
    let n = 0
    const done = () => { if (++n >= imgs.length) go() }
    Array.from(imgs).forEach((im) => { if (im.complete) done(); else { im.onload = done; im.onerror = done } })
    setTimeout(go, 3000)
  } else {
    setTimeout(go, 200)
  }
}

// ── QR scanner (camera → jsQR) ────────────────────────────────────────────────
// Opens the rear camera and decodes QR codes from the video frames. Calls
// onScan(text) once per code (debounced), and onClose when the user backs out.
function QrScanner({ onScan, onClose }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const [err, setErr] = useState(null)
  const lastRef = useRef({ code: '', at: 0 })
  const rafRef = useRef(0)
  const streamRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    let jsQR
    ;(async () => {
      try {
        jsQR = (await import('jsqr')).default
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        const v = videoRef.current
        v.srcObject = stream
        v.setAttribute('playsinline', 'true')
        await v.play()
        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        const tick = () => {
          if (cancelled) return
          if (v.readyState === v.HAVE_ENOUGH_DATA) {
            canvas.width = v.videoWidth
            canvas.height = v.videoHeight
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
            try {
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
              const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
              if (hit && hit.data) {
                const now = Date.now()
                if (hit.data !== lastRef.current.code || now - lastRef.current.at > 2500) {
                  lastRef.current = { code: hit.data, at: now }
                  onScan(hit.data)
                }
              }
            } catch { /* frame not ready */ }
          }
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
      } catch (e) {
        setErr(e?.name === 'NotAllowedError' ? 'Camera permission was blocked. Allow camera access in your browser settings, or use manual entry below.' : 'Could not open the camera on this device. Use manual entry below.')
      }
    })()
    return () => {
      cancelled = true
      cancelAnimationFrame(rafRef.current)
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
    }
  }, [onScan])

  return (
    <div className="rounded-2xl overflow-hidden relative" style={{ backgroundColor: '#000' }}>
      <video ref={videoRef} className="w-full block" style={{ maxHeight: '60vh', objectFit: 'cover' }} muted />
      <canvas ref={canvasRef} className="hidden" />
      {/* Reticle */}
      {!err && <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="rounded-2xl" style={{ width: '62%', aspectRatio: '1', border: `3px solid ${GOLD}`, boxShadow: '0 0 0 100vmax rgba(0,0,0,0.35)' }} />
      </div>}
      {err && <div className="absolute inset-0 flex items-center justify-center p-6"><p className="font-body text-sm text-white text-center">{err}</p></div>}
      <button onClick={onClose} className="absolute top-3 right-3 w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)', color: 'white' }} aria-label="Close scanner"><X size={20} /></button>
    </div>
  )
}

// ── Main module ────────────────────────────────────────────────────────────────
export default function Tournament({ courseInfo: courseInfoProp }) {
  const [tournaments, setTournaments] = useState([])
  const [loading, setLoading] = useState(true)
  const [selId, setSelId] = useState(null)
  const [people, setPeople] = useState([])
  const [tab, setTab] = useState('roster')
  const [toast, setToast] = useState(null)
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(null), 2600) }

  // Club identity (for badges, handbook, printouts). Passed in when embedded in
  // Spray Ops; loaded here when Tournament is its own top-level section.
  const [courseInfo, setCourseInfo] = useState(courseInfoProp || {})
  useEffect(() => {
    if (courseInfoProp) { setCourseInfo(courseInfoProp); return }
    let off = false
    ;(async () => { try { const s = await db.fetchSettings(); if (!off && s?.courseInfo) setCourseInfo(s.courseInfo) } catch { /* ignore */ } })()
    return () => { off = true }
  }, [courseInfoProp])

  const selected = tournaments.find((t) => t.id === selId) || null

  const loadTournaments = useCallback(async () => {
    try {
      const list = await db.fetchTournaments()
      setTournaments(list)
      setSelId((cur) => cur || (list.find((t) => t.isActive)?.id) || list[0]?.id || null)
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [])

  useEffect(() => { loadTournaments() }, [loadTournaments])

  const loadPeople = useCallback(async () => {
    if (!selId) { setPeople([]); return }
    try { setPeople(await db.fetchPeople(selId)) } catch (e) { console.error(e) }
  }, [selId])

  useEffect(() => { loadPeople() }, [loadPeople])

  // Live roster (check-ins from other iPads / the desk).
  useEffect(() => {
    if (!selId) return
    const off = db.subscribeTournamentPeople(selId, loadPeople)
    return off
  }, [selId, loadPeople])

  async function saveTournament(patch) {
    const next = { ...selected, ...patch }
    const saved = await db.updateTournament(next)
    setTournaments((list) => list.map((t) => (t.id === saved.id ? saved : t)))
    return saved
  }

  if (loading) return <div className="pt-10 text-center font-body text-slate-400">Loading tournaments…</div>

  if (tournaments.length === 0) {
    return <div className="pt-6 pb-10"><SetupTab tournaments={tournaments} selected={null} onReload={loadTournaments} onSelect={setSelId} showToast={showToast} /></div>
  }

  const TABS = [
    ['roster', 'Roster', Users],
    ['checkin', 'Check-In', UserCheck],
    ['jobs', 'Job Board', ClipboardList],
    ['handbook', 'Handbook', BookOpen],
    ['setup', 'Setup', Trophy],
  ]

  return (
    <div className="pt-6 pb-10">
      {/* Header + tournament switcher */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="min-w-0">
          <p className="font-display text-[10px] tracking-[0.25em] uppercase" style={{ color: GOLD }}>Tournament Operations</p>
          <h2 className="font-display text-2xl font-semibold text-slate-900 truncate">{selected?.name || 'Tournament'}</h2>
          {selected && <p className="font-body text-xs text-slate-500 mt-0.5">{[fmtRange(selected.startDate, selected.endDate), selected.location].filter(Boolean).join(' · ')}</p>}
        </div>
        {tournaments.length > 1 && (
          <div className="w-56">
            <SearchSelect value={selId} options={tournaments.map((t) => ({ value: t.id, label: t.name }))} onPick={setSelId} sort={false} />
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 mb-5 overflow-x-auto pb-1">
        {TABS.map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)} className="font-body text-xs font-bold px-3.5 py-2 rounded-full whitespace-nowrap transition flex items-center gap-1.5"
            style={tab === k ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'roster' && <RosterTab tournament={selected} people={people} onReload={loadPeople} showToast={showToast} courseInfo={courseInfo} />}
      {tab === 'checkin' && <CheckInTab tournament={selected} people={people} onReload={loadPeople} showToast={showToast} />}
      {tab === 'jobs' && <JobsTab tournament={selected} people={people} onReload={loadPeople} showToast={showToast} courseInfo={courseInfo} />}
      {tab === 'handbook' && <HandbookTab tournament={selected} onSave={saveTournament} showToast={showToast} courseInfo={courseInfo} />}
      {tab === 'setup' && <SetupTab tournaments={tournaments} selected={selected} onReload={loadTournaments} onSelect={setSelId} onSave={saveTournament} showToast={showToast} />}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full text-white font-body text-sm shadow-lg" style={{ backgroundColor: FOREST }}>{toast}</div>
      )}
    </div>
  )
}

function fmtRange(a, b) {
  if (!a && !b) return ''
  const f = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' }) } catch { return d } }
  if (a && b && a !== b) return `${f(a)} – ${f(b)}`
  return f(a || b)
}

// ── SETUP ───────────────────────────────────────────────────────────────────
function SetupTab({ tournaments, selected, onReload, onSelect, onSave, showToast }) {
  const [creating, setCreating] = useState(tournaments.length === 0)
  const [draft, setDraft] = useState({ name: '', startDate: localDateISO(), endDate: localDateISO(), location: '' })
  const [busy, setBusy] = useState(false)

  const create = async () => {
    if (!draft.name.trim()) return
    setBusy(true)
    try {
      const t = await db.createTournament({ ...draft, isActive: tournaments.length === 0, data: {} })
      if (tournaments.length === 0) await db.setActiveTournament(t.id)
      await onReload()
      onSelect(t.id)
      setCreating(false)
      setDraft({ name: '', startDate: localDateISO(), endDate: localDateISO(), location: '' })
      showToast('Tournament created')
    } catch (e) { console.error(e); showToast('Could not create tournament') }
    setBusy(false)
  }

  const makeActive = async (id) => { await db.setActiveTournament(id); await onReload(); showToast('Active tournament set') }
  const remove = async (id) => {
    if (!window.confirm('Delete this tournament and everyone on its roster? This cannot be undone.')) return
    await db.deleteTournament(id); await onReload(); showToast('Tournament deleted')
  }

  return (
    <div className="space-y-4">
      {/* Create */}
      <Card>
        <div className="flex items-center justify-between mb-1">
          <p className="font-display text-base font-semibold text-slate-900">New Tournament</p>
          {!creating && <button onClick={() => setCreating(true)} className="font-body text-xs font-bold px-3.5 py-2 rounded-full text-white flex items-center gap-1.5" style={{ backgroundColor: FOREST }}><Plus size={14} /> Add</button>}
        </div>
        {creating && (
          <div className="space-y-3 mt-2">
            <Field label="Tournament name"><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputCls} placeholder="e.g. 2027 U.S. Open" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start date"><input type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} className={inputCls} /></Field>
              <Field label="End date"><input type="date" value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} className={inputCls} /></Field>
            </div>
            <Field label="Location / notes"><input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} className={inputCls} placeholder="Main course" /></Field>
            <div className="flex gap-2">
              {tournaments.length > 0 && <button onClick={() => setCreating(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold font-body text-slate-500 border border-slate-200">Cancel</button>}
              <button onClick={create} disabled={busy || !draft.name.trim()} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>Create Tournament</button>
            </div>
          </div>
        )}
      </Card>

      {/* Existing */}
      {tournaments.length > 0 && (
        <Card>
          <p className="font-display text-base font-semibold text-slate-900 mb-2">All Tournaments</p>
          <div className="space-y-2">
            {tournaments.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="font-body text-sm font-bold text-slate-900 truncate flex items-center gap-2">
                    {t.name}
                    {t.isActive && <span className="font-body text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#E8F3EC', color: FERN }}>ACTIVE</span>}
                  </p>
                  <p className="font-body text-[11px] text-slate-400">{[fmtRange(t.startDate, t.endDate), t.location].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!t.isActive && <button onClick={() => makeActive(t.id)} className="font-body text-[11px] font-bold px-2.5 py-1.5 rounded-full" style={{ backgroundColor: '#F0F6F2', color: FERN }}>Make active</button>}
                  <button onClick={() => remove(t.id)} className="text-red-400 p-1.5"><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Committees / shifts / links for the selected tournament */}
      {selected && <SetupDetails selected={selected} onSave={onSave} showToast={showToast} />}
    </div>
  )
}

function SetupDetails({ selected, onSave, showToast }) {
  const [committees, setCommittees] = useState(committeesOf(selected).join('\n'))
  const [shifts, setShifts] = useState(shiftsOf(selected))
  const [signupOpen, setSignupOpen] = useState(!!selected.signupOpen)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const signupLink = `${origin}/volunteer-signup?t=${selected.id}`
  const boardLink = `${origin}/tournament-board`
  const handbookLink = `${origin}/handbook?t=${selected.id}`

  useEffect(() => {
    setCommittees(committeesOf(selected).join('\n'))
    setShifts(shiftsOf(selected))
    setSignupOpen(!!selected.signupOpen)
  }, [selected.id])

  const copy = (txt) => { try { navigator.clipboard.writeText(txt); showToast('Link copied') } catch { showToast('Copy not available — long-press to copy') } }

  const saveLists = async () => {
    const list = committees.split('\n').map((s) => s.trim()).filter(Boolean)
    const cleanShifts = shifts.map((s) => ({ id: s.id, label: s.label.trim() || s.id, start: s.start || '' })).filter((s) => s.label)
    await onSave({ data: { ...selected.data, committees: list, shifts: cleanShifts } })
    showToast('Saved')
  }
  const setShift = (i, patch) => setShifts((arr) => arr.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const addShift = () => setShifts((arr) => [...arr, { id: `s${Date.now().toString(36)}`, label: '', start: '' }])
  const removeShift = (i) => setShifts((arr) => arr.filter((_, j) => j !== i))

  const toggleSignup = async () => { const v = !signupOpen; setSignupOpen(v); await onSave({ signupOpen: v }); showToast(v ? 'Sign-up form is open' : 'Sign-up form closed') }

  return (
    <>
      <Card>
        <p className="font-display text-base font-semibold text-slate-900 mb-1">Committees / Stations</p>
        <p className="font-body text-xs text-slate-500 mb-2">One per line — these are the jobs you assign people to on the board.</p>
        <textarea value={committees} onChange={(e) => setCommittees(e.target.value)} rows={Math.max(6, committees.split('\n').length)} className={inputCls} style={{ resize: 'vertical' }} />
        <p className="font-display text-base font-semibold text-slate-900 mt-4 mb-2">Shifts</p>
        <div className="space-y-2">
          {shifts.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              <input value={s.label} onChange={(e) => setShift(i, { label: e.target.value })} className={inputCls} placeholder="Shift name (e.g. AM)" />
              <input type="time" value={s.start} onChange={(e) => setShift(i, { start: e.target.value })} className="border border-slate-200 rounded-xl px-2 py-2.5 text-base font-body bg-white shrink-0" />
              <button onClick={() => removeShift(i)} className="text-red-400 p-2 shrink-0"><Trash2 size={15} /></button>
            </div>
          ))}
          <button onClick={addShift} className="font-body text-xs font-bold px-3 py-2 rounded-full" style={{ color: FERN, border: '1px solid #E2E8F0' }}><Plus size={13} className="inline" /> Add shift</button>
        </div>
        <button onClick={saveLists} className="mt-4 font-body text-xs font-bold px-4 py-2.5 rounded-full text-white" style={{ backgroundColor: FOREST }}>Save committees & shifts</button>
      </Card>

      <Card>
        <p className="font-display text-base font-semibold text-slate-900 mb-2">Links & Displays</p>
        <div className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2.5 mb-2">
          <div className="min-w-0">
            <p className="font-body text-sm font-bold text-slate-900">Volunteer sign-up form</p>
            <p className="font-body text-[11px] text-slate-400 truncate">{signupOpen ? 'Open — accepting sign-ups' : 'Closed'}</p>
          </div>
          <button onClick={toggleSignup} className="font-body text-[11px] font-bold px-3 py-1.5 rounded-full shrink-0" style={signupOpen ? { backgroundColor: '#E8F3EC', color: FERN } : { backgroundColor: '#F1F5F9', color: '#64748B' }}>{signupOpen ? 'Open' : 'Closed'}</button>
        </div>
        <LinkRow icon={Link2} label="Sign-up form" href={signupLink} onCopy={() => copy(signupLink)} />
        <LinkRow icon={BookOpen} label="Volunteer handbook" href={handbookLink} onCopy={() => copy(handbookLink)} />
        <LinkRow icon={Tv} label="TV board (check-in + jobs)" href={boardLink} onCopy={() => copy(boardLink)} />
      </Card>

      <SignupFormEditor selected={selected} onSave={onSave} showToast={showToast} />
    </>
  )
}

// Build the questions volunteers answer on the public sign-up form. Fully
// custom: rename, reorder, add/remove, choose a type, mark required. The "Full
// name" question is locked because the roster needs a name.
function SignupFormEditor({ selected, onSave, showToast }) {
  const [fields, setFields] = useState(signupFieldsOf(selected))
  const savedJson = JSON.stringify(signupFieldsOf(selected))
  const dirty = JSON.stringify(fields) !== savedJson
  useEffect(() => { setFields(signupFieldsOf(selected)) }, [selected.id])

  const setF = (i, patch) => setFields((arr) => arr.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  const addField = () => setFields((arr) => [...arr, { id: `q${Date.now().toString(36)}`, label: 'New question', type: 'text', required: false, map: '' }])
  const removeField = (i) => setFields((arr) => arr.filter((_, j) => j !== i))
  const move = (i, dir) => {
    const j = i + dir
    if (j < 1 || j >= fields.length) return // keep the locked name field first
    setFields((arr) => { const n = [...arr];[n[i], n[j]] = [n[j], n[i]]; return n })
  }
  const save = async () => {
    const clean = fields.map((f) => ({
      id: f.id, label: (f.label || '').trim() || 'Question', type: f.type || 'text',
      required: f.map === 'name' ? true : !!f.required, map: f.map || '',
      ...(f.type === 'select' ? { options: (Array.isArray(f.options) ? f.options : String(f.options || '').split(',')).map((o) => String(o).trim()).filter(Boolean) } : {}),
      ...(f.locked ? { locked: true } : {}),
    }))
    await onSave({ data: { ...selected.data, signupForm: { fields: clean } } })
    showToast('Sign-up form saved')
  }

  return (
    <Card>
      <p className="font-display text-base font-semibold text-slate-900 mb-1">Sign-Up Form</p>
      <p className="font-body text-xs text-slate-500 mb-3">The questions volunteers answer. Drag-free reorder with the arrows. Answers to Name, Email, Phone, Shirt, Shift and “help with” flow onto the roster automatically; your own questions are saved with each person.</p>
      <div className="space-y-2">
        {fields.map((f, i) => (
          <div key={f.id} className="rounded-xl border border-slate-100 p-2.5">
            <div className="flex items-center gap-2">
              <input value={f.label} onChange={(e) => setF(i, { label: e.target.value })} disabled={f.locked} className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-body bg-white disabled:bg-slate-50 disabled:text-slate-500" />
              <button onClick={() => move(i, -1)} disabled={i <= 1} className="p-1.5 rounded-lg disabled:opacity-25" style={{ color: FERN }}><ChevronUp size={15} /></button>
              <button onClick={() => move(i, 1)} disabled={i === 0 || i === fields.length - 1} className="p-1.5 rounded-lg disabled:opacity-25" style={{ color: FERN }}><ChevronDown size={15} /></button>
              {!f.locked ? <button onClick={() => removeField(i)} className="text-red-400 p-1.5 shrink-0"><Trash2 size={14} /></button> : <span className="w-7 shrink-0" />}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-2 pl-0.5">
              {f.locked ? (
                <span className="font-body text-[11px] text-slate-400">Always asked · required</span>
              ) : (
                <>
                  <div className="w-40"><SearchSelect value={f.type} options={SIGNUP_FIELD_TYPES.map((t) => ({ value: t.id, label: t.label }))} onPick={(v) => setF(i, { type: v })} sort={false} /></div>
                  <label className="font-body text-[11px] font-semibold text-slate-500 flex items-center gap-1.5"><input type="checkbox" checked={!!f.required} onChange={(e) => setF(i, { required: e.target.checked })} /> Required</label>
                  {f.type === 'select' && (
                    <input value={Array.isArray(f.options) ? f.options.join(', ') : (f.options || '')} onChange={(e) => setF(i, { options: e.target.value.split(',') })} placeholder="Choices, comma-separated" className="flex-1 min-w-[160px] border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] font-body bg-white" />
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-3">
        <button onClick={addField} className="font-body text-xs font-bold px-3 py-2 rounded-full" style={{ color: FERN, border: '1px solid #E2E8F0' }}><Plus size={13} className="inline" /> Add question</button>
        <button onClick={save} disabled={!dirty} className="font-body text-xs font-bold px-4 py-2 rounded-full text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>Save form</button>
      </div>
    </Card>
  )
}

function LinkRow({ icon: Icon, label, href, onCopy }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-100 px-3 py-2.5 mb-2">
      <Icon size={16} style={{ color: FERN }} className="shrink-0" />
      <div className="min-w-0 flex-1"><p className="font-body text-sm font-semibold text-slate-900">{label}</p><p className="font-body text-[11px] text-slate-400 truncate">{href}</p></div>
      <a href={href} target="_blank" rel="noopener noreferrer" className="font-body text-[11px] font-bold px-2.5 py-1.5 rounded-full shrink-0" style={{ backgroundColor: '#F0F6F2', color: FERN }}>Open</a>
      <button onClick={onCopy} className="font-body text-[11px] font-bold px-2.5 py-1.5 rounded-full shrink-0 flex items-center gap-1" style={{ backgroundColor: '#F1F5F9', color: '#64748B' }}><Copy size={12} /> Copy</button>
    </div>
  )
}

// ── ROSTER ──────────────────────────────────────────────────────────────────
function RosterTab({ tournament, people, onReload, showToast, courseInfo }) {
  const [editing, setEditing] = useState(null) // person object or 'new'
  const [importing, setImporting] = useState(false)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('All')
  const [printing, setPrinting] = useState(false)
  const committees = committeesOf(tournament)
  const shifts = shiftsOf(tournament)
  const stats = rosterStats(people)

  const q = search.trim().toLowerCase()
  const filtered = people.filter((p) => {
    if (roleFilter !== 'All' && p.role !== roleFilter) return false
    if (!q) return true
    return p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q) || (p.committee || '').toLowerCase().includes(q) || (p.org || '').toLowerCase().includes(q)
  })

  const remove = async (id) => { if (!window.confirm('Remove this person from the roster?')) return; await db.deletePerson(id); await onReload(); showToast('Removed') }

  const exportCodes = () => {
    const rows = [['Name', 'Code', 'Role', 'Committee', 'Shift', 'Phone', 'Email', 'Org', 'Shirt']]
    people.forEach((p) => rows.push([p.name, p.code, p.role, p.committee, shiftLabel(tournament, p.shift), p.phone, p.email, p.org, p.shirt]))
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(tournament.name || 'tournament').replace(/[^a-z0-9]+/gi, '-')}-badge-codes.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const printBadges = async () => {
    if (filtered.length === 0) { showToast('No one to print'); return }
    setPrinting(true)
    try {
      const cards = await Promise.all(filtered.map(async (p) => {
        const qr = await qrDataUrl(p.code, { width: 300 })
        return `<div style="display:inline-flex;flex-direction:column;align-items:center;justify-content:center;width:2.6in;height:3.4in;border:1px solid #ccc;border-radius:10px;margin:6px;padding:10px;box-sizing:border-box;page-break-inside:avoid;vertical-align:top">
          <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${GOLD};font-weight:bold">${esc(courseInfo.clubName || '')}</div>
          <div style="font-size:12px;color:#173B2B;font-weight:bold;margin-bottom:6px;text-align:center">${esc(tournament.name)}</div>
          <img src="${qr}" style="width:1.7in;height:1.7in" />
          <div style="font-size:15px;font-weight:bold;color:#111;margin-top:8px;text-align:center;line-height:1.1">${esc(p.name)}</div>
          <div style="font-size:11px;color:#555;text-align:center">${esc(p.committee || p.role)}</div>
          <div style="font-size:13px;font-weight:bold;letter-spacing:1px;color:#173B2B;margin-top:4px">${esc(p.code)}</div>
        </div>`
      }))
      printHTML(`<div style="text-align:center">${cards.join('')}</div>`)
    } catch (e) { console.error(e); showToast('Could not build badges') }
    setPrinting(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Stat n={stats.total} label="On roster" />
        <Stat n={stats.here} label="Checked in" color={FERN} />
        <Stat n={people.filter((p) => p.role === 'Volunteer').length} label="Volunteers" color={GOLD} />
        <Stat n={people.filter((p) => p.role === 'Crew').length} label="Crew" />
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => setEditing('new')} className="font-body text-xs font-bold px-3.5 py-2 rounded-full text-white flex items-center gap-1.5" style={{ backgroundColor: FOREST }}><Plus size={14} /> Add person</button>
        <button onClick={() => setImporting(true)} className="font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5 border" style={{ color: FOREST, borderColor: FOREST }}><Upload size={14} /> Import list</button>
        <button onClick={printBadges} disabled={printing} className="font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5 border disabled:opacity-50" style={{ color: FOREST, borderColor: '#E2E8F0' }}><QrCode size={14} /> {printing ? 'Building…' : 'Print badges'}</button>
        <button onClick={exportCodes} className="font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5 border" style={{ color: FOREST, borderColor: '#E2E8F0' }}><Download size={14} /> Export codes</button>
      </div>

      {/* Search + role filter */}
      <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-200 px-3">
        <Search size={16} className="text-slate-400 shrink-0" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, code, committee…" className="flex-1 py-2.5 text-base font-body outline-none bg-transparent" />
        {search && <button onClick={() => setSearch('')}><X size={15} className="text-slate-300" /></button>}
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {['All', ...PERSON_ROLES].map((r) => (
          <button key={r} onClick={() => setRoleFilter(r)} className="font-body text-[11px] font-bold px-3 py-1.5 rounded-full whitespace-nowrap transition" style={roleFilter === r ? { backgroundColor: FERN, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid #E2E8F0' }}>{r}{r !== 'All' ? 's' : ''}</button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <Card><p className="font-body text-sm text-slate-400 text-center py-6">{people.length === 0 ? 'No one on the roster yet. Add people, import a list, or open the sign-up form.' : 'No matches.'}</p></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => {
            const st = personStatus(p)
            return (
              <div key={p.id} className="bg-white rounded-2xl border border-black/5 p-3 shadow-sm flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-body text-sm font-bold text-slate-900 truncate flex items-center gap-2">{p.name}
                    <span className="font-body text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: '#F1F5F9', color: '#64748B' }}>{p.code}</span>
                    {p.data?.source === 'signup' && <span className="font-body text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: '#FEF3DD', color: '#92660D' }}>signed up</span>}
                  </p>
                  <p className="font-body text-[11px] text-slate-400 truncate">{[p.role, p.committee, shiftLabel(tournament, p.shift)].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                <span className="font-body text-[10px] font-bold px-2 py-1 rounded-full shrink-0" style={statusStyle(st)}>{st.label}</span>
                <button onClick={() => setEditing(p)} className="text-slate-300 hover:text-slate-600 p-1.5 shrink-0"><Pencil size={15} /></button>
                <button onClick={() => remove(p.id)} className="text-slate-300 hover:text-red-500 p-1.5 shrink-0"><Trash2 size={15} /></button>
              </div>
            )
          })}
        </div>
      )}

      {editing && <PersonModal person={editing === 'new' ? null : editing} tournament={tournament} people={people} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await onReload() }} showToast={showToast} committees={committees} shifts={shifts} />}
      {importing && <ImportModal tournament={tournament} people={people} onClose={() => setImporting(false)} onDone={async () => { setImporting(false); await onReload() }} showToast={showToast} />}
    </div>
  )
}

function statusStyle(st) {
  if (st.key === 'in') return { backgroundColor: '#E8F3EC', color: FERN }
  if (st.key === 'out') return { backgroundColor: '#F1F5F9', color: '#64748B' }
  if (st.late) return { backgroundColor: '#FEE2E2', color: '#B91C1C' }
  return { backgroundColor: '#FEF3DD', color: '#92660D' }
}

// Add / edit one person.
function PersonModal({ person, tournament, people, onClose, onSaved, showToast, committees, shifts }) {
  const [d, setD] = useState(person || { name: '', role: 'Volunteer', committee: '', shift: '', phone: '', email: '', org: '', shirt: '', emergencyName: '', emergencyPhone: '', notes: '' })
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!d.name.trim()) { showToast('Name is required'); return }
    setBusy(true)
    try {
      if (person) await db.updatePerson({ ...person, ...d })
      else await db.addPerson(tournament.id, { ...d, code: uniqueCode(people.map((p) => p.code)) })
      await onSaved()
      showToast(person ? 'Saved' : 'Added to roster')
    } catch (e) { console.error(e); showToast('Could not save') }
    setBusy(false)
  }

  return (
    <Modal onClose={onClose} title={person ? 'Edit person' : 'Add person'}>
      <div className="space-y-3">
        <Field label="Name"><input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} className={inputCls} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role"><SearchSelect value={d.role} options={PERSON_ROLES} onPick={(v) => setD({ ...d, role: v })} sort={false} /></Field>
          <Field label="Committee / station"><SearchSelect value={d.committee} options={['', ...committees]} onPick={(v) => setD({ ...d, committee: v })} sort={false} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Shift"><SearchSelect value={d.shift} options={[{ value: '', label: '— None —' }, ...shifts.map((s) => ({ value: s.id, label: s.label }))]} onPick={(v) => setD({ ...d, shift: v })} sort={false} /></Field>
          <Field label="Shirt size"><SearchSelect value={d.shirt} options={['', ...SHIRT_SIZES]} onPick={(v) => setD({ ...d, shirt: v })} sort={false} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone"><input value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} className={inputCls} inputMode="tel" /></Field>
          <Field label="Email"><input value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} className={inputCls} inputMode="email" /></Field>
        </div>
        <Field label="Organization / club"><input value={d.org} onChange={(e) => setD({ ...d, org: e.target.value })} className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Emergency contact"><input value={d.emergencyName} onChange={(e) => setD({ ...d, emergencyName: e.target.value })} className={inputCls} /></Field>
          <Field label="Emergency phone"><input value={d.emergencyPhone} onChange={(e) => setD({ ...d, emergencyPhone: e.target.value })} className={inputCls} inputMode="tel" /></Field>
        </div>
        <Field label="Notes"><textarea value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} rows={2} className={inputCls} style={{ resize: 'vertical' }} /></Field>
        {person?.data?.answers?.length > 0 && (
          <div className="rounded-xl p-3" style={{ backgroundColor: '#F8FAF9' }}>
            <p className="font-body text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Sign-up answers</p>
            {person.data.answers.map((a, k) => (
              <p key={k} className="font-body text-[12px] text-slate-600"><span className="font-semibold">{a.label}:</span> {a.value}</p>
            ))}
          </div>
        )}
        {person && <p className="font-body text-[11px] text-slate-400">Badge code: <span className="font-bold">{person.code}</span></p>}
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold font-body text-slate-500 border border-slate-200">Cancel</button>
          <button onClick={save} disabled={busy} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>{person ? 'Save' : 'Add'}</button>
        </div>
      </div>
    </Modal>
  )
}

function Modal({ title, children, onClose, wide = false }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} my-4`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl z-10">
          <p className="font-display text-base font-semibold text-slate-900">{title}</p>
          <button onClick={onClose} className="text-slate-400 p-1"><X size={20} /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

// Import a roster spreadsheet → preview → confirm (assigns badge codes).
function ImportModal({ tournament, people, onClose, onDone, showToast }) {
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const { parseRoster } = await import('@/lib/importXlsx')
      const res = parseRoster(await file.arrayBuffer())
      setPreview({ ...res, fileName: file.name })
    } catch { setPreview({ people: [], count: 0, error: 'Could not read that file. Use a .xlsx or .csv.' }) }
  }

  const confirm = async () => {
    if (!preview?.people?.length) return
    setBusy(true)
    try {
      const taken = people.map((p) => p.code)
      const withCodes = preview.people.map((p) => { const code = uniqueCode(taken); taken.push(code); return { ...p, code } })
      await db.addPeople(tournament.id, withCodes)
      showToast(`Imported ${withCodes.length}`)
      await onDone()
    } catch (e) { console.error(e); showToast('Import failed') }
    setBusy(false)
  }

  return (
    <Modal title="Import roster" onClose={onClose} wide>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />
      {!preview && (
        <div className="text-center py-6">
          <p className="font-body text-sm text-slate-500 mb-4">Upload a spreadsheet from the PGA or your own list. We look for columns like Name (or First/Last), Role, Committee, Shift, Phone, Email, Org, Shirt.</p>
          <button onClick={() => fileRef.current?.click()} className="font-body text-sm font-bold px-5 py-3 rounded-full text-white inline-flex items-center gap-2" style={{ backgroundColor: FOREST }}><Upload size={16} /> Choose file</button>
        </div>
      )}
      {preview?.error && <p className="font-body text-sm text-red-600 py-4">{preview.error}</p>}
      {preview && !preview.error && (
        <div>
          <p className="font-body text-sm text-slate-700 mb-2"><b>{preview.count}</b> people found in <b>{preview.fileName}</b>. Each gets a unique badge code on import.</p>
          <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-100 overscroll-contain">
            {preview.people.slice(0, 200).map((p, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 border-b border-slate-50 last:border-0">
                <span className="font-body text-sm text-slate-800">{p.name}</span>
                <span className="font-body text-[11px] text-slate-400">{[p.role, p.committee].filter(Boolean).join(' · ')}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-3">
            <button onClick={() => setPreview(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold font-body text-slate-500 border border-slate-200">Choose another</button>
            <button onClick={confirm} disabled={busy || !preview.count} className="flex-1 py-2.5 rounded-xl text-sm font-bold font-body text-white disabled:opacity-40" style={{ backgroundColor: FOREST }}>{busy ? 'Importing…' : `Import ${preview.count}`}</button>
          </div>
        </div>
      )}
    </Modal>
  )
}


// ── CHECK-IN ────────────────────────────────────────────────────────────────
function CheckInTab({ tournament, people, onReload, showToast }) {
  // How the desk is scanning: 'scanner' = hardware barcode/QR scanner (types the
  // code + Enter into a focused box), 'camera' = device camera, 'off' = by hand.
  const [mode, setMode] = useState('scanner')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all') // all | here | waiting
  const [banner, setBanner] = useState(null) // { ok, text }
  const [, force] = useState(0)
  const stats = rosterStats(people)

  // Re-tick so "late" flips over as shift start passes.
  useEffect(() => { const id = setInterval(() => force((n) => n + 1), 60000); return () => clearInterval(id) }, [])

  const flash = (ok, text) => { setBanner({ ok, text }); setTimeout(() => setBanner(null), 3500) }

  const doCode = useCallback(async (raw) => {
    try {
      const res = await db.checkInByCode(tournament.id, raw)
      if (res.error) { flash(false, res.error); return }
      if (res.already) { flash(true, `${res.person.name} — already checked in`) }
      else { flash(true, `✓ ${res.person.name} checked in`) }
      await onReload()
    } catch (e) { console.error(e); flash(false, 'Check-in failed') }
  }, [tournament.id, onReload])

  const toggle = async (p) => {
    const st = personStatus(p)
    try {
      if (st.key === 'in') { await db.setCheckIn(p.id, false); showToast(`${p.name} checked out`) }
      else { await db.setCheckIn(p.id, true); showToast(`${p.name} checked in`) }
      await onReload()
    } catch (e) { console.error(e); showToast('Failed') }
  }

  const q = search.trim().toLowerCase()
  const list = people.filter((p) => {
    const st = personStatus(p)
    if (filter === 'here' && st.key !== 'in') return false
    if (filter === 'waiting' && st.key === 'in') return false
    if (!q) return true
    return p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)
  }).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Stat n={stats.here} label="Checked in" color={FERN} active />
        <Stat n={stats.waiting} label="Not in" color={GOLD} />
        <Stat n={stats.late} label="Late" color="#B91C1C" />
        <Stat n={stats.total} label="Total" />
      </div>

      {banner && (
        <div className="rounded-2xl px-4 py-3 font-body text-sm font-bold text-center" style={banner.ok ? { backgroundColor: '#E8F3EC', color: FERN } : { backgroundColor: '#FEE2E2', color: '#B91C1C' }}>{banner.text}</div>
      )}

      {/* How to scan */}
      <div className="flex gap-1.5">
        {[['scanner', 'Barcode scanner', QrCode], ['camera', 'Camera', Camera], ['off', 'By hand', UserCheck]].map(([k, l, Icon]) => (
          <button key={k} onClick={() => setMode(k)} className="flex-1 font-body text-xs font-bold px-3 py-2 rounded-full transition flex items-center justify-center gap-1.5" style={mode === k ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid #E2E8F0' }}><Icon size={14} /> {l}</button>
        ))}
      </div>

      {mode === 'scanner' && <ScannerBox onCode={doCode} />}
      {mode === 'camera' && (
        <div>
          <QrScanner onScan={doCode} onClose={() => setMode('off')} />
          <p className="font-body text-xs text-slate-400 text-center mt-2">Point the camera at a badge QR code. Keep it in the frame — check-ins pop up above.</p>
        </div>
      )}

      {/* Search + filter + tap list */}
      <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-200 px-3">
        <Search size={16} className="text-slate-400 shrink-0" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a name to check in by hand…" className="flex-1 py-2.5 text-base font-body outline-none bg-transparent" />
        {search && <button onClick={() => setSearch('')}><X size={15} className="text-slate-300" /></button>}
      </div>
      <div className="flex gap-1.5">
        {[['all', 'Everyone'], ['here', 'Checked in'], ['waiting', 'Not in']].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className="font-body text-[11px] font-bold px-3 py-1.5 rounded-full transition" style={filter === k ? { backgroundColor: FERN, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid #E2E8F0' }}>{l}</button>
        ))}
      </div>

      <div className="space-y-2">
        {list.map((p) => {
          const st = personStatus(p)
          return (
            <button key={p.id} onClick={() => toggle(p)} className="w-full bg-white rounded-2xl border border-black/5 p-3 shadow-sm flex items-center gap-3 text-left">
              <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: st.key === 'in' ? '#E8F3EC' : '#F1F5F9' }}>
                {st.key === 'in' ? <CheckCircle2 size={20} style={{ color: FERN }} /> : <Clock size={18} style={{ color: st.late ? '#B91C1C' : '#94A3B8' }} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-body text-sm font-bold text-slate-900 truncate">{p.name}</p>
                <p className="font-body text-[11px] text-slate-400 truncate">{[p.committee, shiftLabel(tournament, p.shift), p.checkedInAt && `in ${shortTime(p.checkedInAt)}`].filter(Boolean).join(' · ') || p.code}</p>
              </div>
              <span className="font-body text-[10px] font-bold px-2 py-1 rounded-full shrink-0" style={statusStyle(st)}>{st.key === 'in' ? 'Tap to undo' : st.late ? 'Late' : 'Check in'}</span>
            </button>
          )
        })}
        {list.length === 0 && <Card><p className="font-body text-sm text-slate-400 text-center py-6">No matches.</p></Card>}
      </div>
    </div>
  )
}

// A hardware-scanner-ready box. A barcode/QR scanner acts like a keyboard: it
// "types" the badge code and presses Enter. This input stays focused so scan
// after scan lands here and checks people in hands-free — and you can type a
// code by hand too. It politely gives up focus if you tap another field.
function ScannerBox({ onCode }) {
  const ref = useRef(null)
  const [val, setVal] = useState('')

  const refocus = () => {
    const ae = document.activeElement
    // Don't steal focus from the search box or another field the user tapped.
    if (ae && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName) && ae !== ref.current) return
    ref.current?.focus()
  }
  useEffect(() => { refocus() }, [])

  const submit = () => {
    const c = val.trim()
    setVal('')
    if (c) onCode(c)
    // Keep focus for the next scan.
    setTimeout(() => ref.current?.focus(), 0)
  }

  return (
    <div className="rounded-2xl border-2 p-4 text-center" style={{ borderColor: FERN, backgroundColor: '#F5FAF6' }}>
      <div className="flex items-center justify-center gap-2 mb-2">
        <span className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ backgroundColor: FERN }} />
        <span className="font-body text-sm font-bold" style={{ color: FERN }}>Ready to scan</span>
      </div>
      <input
        ref={ref}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
        onBlur={() => setTimeout(refocus, 200)}
        placeholder="Scan a badge — or type a code + Enter"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        className="w-full text-center border border-slate-200 rounded-xl px-3 py-3 text-lg font-body bg-white tracking-wide"
      />
      <p className="font-body text-[11px] text-slate-400 mt-2">Scans check in automatically. Tip: set your scanner to send an Enter/Return after each code.</p>
    </div>
  )
}

// ── JOB BOARD ───────────────────────────────────────────────────────────────
function JobsTab({ tournament, people, onReload, showToast, courseInfo }) {
  const committees = committeesOf(tournament)
  const { map, unassigned } = byCommittee(people, committees)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  const reassign = async (person, committee) => {
    try { await db.updatePerson({ ...person, committee }); await onReload() } catch (e) { console.error(e); showToast('Failed') }
  }

  const printBoard = () => {
    const now = new Date().toLocaleString()
    const cols = committees.map((c) => {
      const list = (map[c] || [])
      const rows = list.length ? list.map((p) => `<div style="padding:3px 0;border-bottom:1px solid #eee;font-size:13px">${esc(p.name)} <span style="color:#888;font-size:11px">${esc(shiftLabel(tournament, p.shift) || '')}</span></div>`).join('') : '<div style="color:#aaa;font-size:12px;padding:4px 0">—</div>'
      return `<div style="border:1px solid #ccc;border-radius:8px;padding:10px;break-inside:avoid;margin-bottom:10px">
        <div style="font-weight:bold;color:#173B2B;font-size:15px;border-bottom:2px solid ${GOLD};padding-bottom:4px;margin-bottom:6px">${esc(c)} <span style="color:#888;font-weight:normal;font-size:12px">(${list.length})</span></div>${rows}</div>`
    }).join('')
    const body = `<div style="max-width:1000px;margin:0 auto">
      <div style="text-align:center;margin-bottom:12px">
        <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${GOLD};font-weight:bold">${esc(courseInfo.clubName || '')}</div>
        <div style="font-size:22px;font-weight:bold;color:#173B2B">${esc(tournament.name)} — Job Board</div>
        <div style="font-size:11px;color:#888">${esc(fmtRange(tournament.startDate, tournament.endDate))} · Printed ${esc(now)}</div>
      </div>
      <div style="column-count:3;column-gap:12px">${cols}</div>
      ${unassigned.length ? `<div style="margin-top:12px;border-top:1px dashed #ccc;padding-top:8px;font-size:12px;color:#888">Unassigned: ${unassigned.map((p) => esc(p.name)).join(', ')}</div>` : ''}
    </div>`
    printHTML(body, { landscape: true })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button onClick={printBoard} className="font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5 border" style={{ color: FOREST, borderColor: FOREST }}><Printer size={14} /> Print for tables</button>
        <a href={`${origin}/tournament-board`} target="_blank" rel="noopener noreferrer" className="font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5 text-white" style={{ backgroundColor: FOREST }}><Tv size={14} /> Open TV board</a>
      </div>

      {unassigned.length > 0 && (
        <Card style={{ borderColor: GOLD, borderWidth: 1 }}>
          <p className="font-display text-sm font-bold text-slate-900 mb-2 flex items-center gap-1.5"><AlertTriangle size={15} style={{ color: '#92660D' }} /> Unassigned ({unassigned.length})</p>
          <div className="space-y-2">
            {unassigned.map((p) => (
              <div key={p.id} className="flex items-center gap-2">
                <span className="font-body text-sm text-slate-800 min-w-0 flex-1 truncate">{p.name}</span>
                <div className="w-44 shrink-0"><SearchSelect value="" options={committees} onPick={(c) => reassign(p, c)} placeholder="Assign to…" /></div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {committees.map((c) => {
          const list = map[c] || []
          return (
            <Card key={c}>
              <p className="font-display text-sm font-bold text-slate-900 mb-2 pb-2 flex items-center justify-between" style={{ borderBottom: `2px solid ${GOLD}` }}>
                <span>{c}</span>
                <span className="font-body text-xs font-normal text-slate-400">{list.length}</span>
              </p>
              {list.length === 0 ? <p className="font-body text-xs text-slate-300 py-2">No one assigned</p> : (
                <div className="space-y-1.5">
                  {list.map((p) => {
                    const st = personStatus(p)
                    return (
                      <div key={p.id} className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: st.key === 'in' ? FERN : st.late ? '#B91C1C' : '#CBD5E1' }} />
                        <span className="font-body text-sm text-slate-800 min-w-0 flex-1 truncate">{p.name}</span>
                        <span className="font-body text-[10px] text-slate-400 shrink-0">{shiftLabel(tournament, p.shift)}</span>
                        <div className="w-8 shrink-0"><SearchSelect value="" options={committees.filter((x) => x !== c)} onPick={(nc) => reassign(p, nc)} placeholder="→" /></div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>
          )
        })}
      </div>
      <p className="font-body text-[11px] text-slate-400 text-center">Assign or move people with the dropdown on each name. The dot shows who's checked in (green), late (red), or not in yet (grey).</p>
    </div>
  )
}

// ── HANDBOOK ────────────────────────────────────────────────────────────────

// Downscale + JPEG-compress a chosen photo to a data URL so it can live inside
// the handbook JSON (no separate file storage needed) and print sharply without
// bloating the record.
function compressImage(file, maxW = 1400, quality = 0.72, mime = 'image/jpeg') {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new window.Image()
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width)
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const c = document.createElement('canvas')
        c.width = w; c.height = h
        c.getContext('2d').drawImage(img, 0, 0, w, h)
        try { resolve(c.toDataURL(mime, quality)) } catch (e) { reject(e) }
      }
      img.onerror = reject
      img.src = reader.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
// Logos: keep PNG so transparent backgrounds survive; smaller max width.
const compressLogo = (file) => compressImage(file, 700, 0.9, 'image/png')

function waitImgs(el) {
  const imgs = Array.from(el.querySelectorAll('img'))
  return Promise.all(imgs.map((im) => (im.complete ? Promise.resolve() : new Promise((r) => { im.onload = r; im.onerror = r }))))
}

// Build the magazine handbook as a self-contained HTML string (styles scoped
// under .mag). Used for both the browser print and the downloadable PDF: a
// colour cover, a Contents page, then each section as a numbered article with a
// lead photo, drop cap, and a photo gallery.
function buildHandbookHTML(handbook, tournament, clubNameRaw) {
  const sections = handbook.sections || []
  const logo = handbook.logo || ''
  const sponsors = (handbook.sponsors || []).filter((s) => s && s.src)
  const schedule = (handbook.schedule || []).filter((d) => d && (d.day || (d.rows || []).length))
  const accent = handbook.theme?.color || FOREST
  const coverPhoto = handbook.coverPhoto || ''
  const clubName = esc(clubNameRaw || '')
  const paras = (body) => String(body || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p, idx) => `<p${idx === 0 ? ' class="lead"' : ''}>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')
  const figs = (images, cls) => (images || []).map((im) => `<figure class="${cls}"><img src="${im.src}">${im.caption ? `<figcaption>${esc(im.caption)}</figcaption>` : ''}</figure>`).join('')
  const railTab = (label) => `<div class="rail"><span class="rail-label">${esc(label)}</span></div>`

  // ── Cover (optional full-bleed photo behind an accent tint) ──
  const coverBg = coverPhoto
    ? `background-image:linear-gradient(${hexA(accent, 0.78)},${hexA(accent, 0.92)}), url('${coverPhoto}');background-size:cover;background-position:center;`
    : `background:${accent};`
  const cover = `<section class="cover" style="${coverBg}"><div class="cover-inner">
    ${logo ? `<img class="cover-logo" src="${logo}">` : ''}
    <div class="eyebrow">${clubName}</div>
    <div class="cover-rule"></div>
    <h1 class="cover-title">${esc(tournament.name)}</h1>
    <div class="cover-sub">Volunteer Handbook</div>
    <div class="cover-meta">${esc([fmtRange(tournament.startDate, tournament.endDate), tournament.location].filter(Boolean).join('   ·   '))}</div>
  </div></section>`

  // ── Sections: text "articles" (with a side tab) or full-page photos ──
  let artNo = 0
  const tocEntries = []
  const arts = sections.map((s) => {
    if (s.fullPage) {
      const img = (s.images || [])[0]
      tocEntries.push({ label: s.title, num: null })
      const bg = img ? `background-image:linear-gradient(rgba(15,25,20,0.15),rgba(15,25,20,0.6)), url('${img.src}');` : `background:${accent};`
      return `<section class="fullpage" style="${bg}"><div class="fp-caption"><div class="fp-title">${esc(s.title)}</div>${s.body ? `<div class="fp-sub">${esc(s.body)}</div>` : ''}</div></section>`
    }
    artNo += 1
    const nn = String(artNo).padStart(2, '0')
    tocEntries.push({ label: s.title, num: nn })
    const imgs = s.images || []
    const lead = imgs[0] ? figs([imgs[0]], 'lead-fig') : ''
    const gallery = imgs.length > 1 ? `<div class="gallery">${figs(imgs.slice(1), '')}</div>` : ''
    return `<section class="article">${railTab(s.title)}<div class="article-main">
      <div class="art-head"><span class="art-num">${nn}</span><h2 class="art-title">${esc(s.title)}</h2></div>
      ${lead}
      <div class="art-body">${paras(s.body)}</div>
      ${gallery}
    </div></section>`
  }).join('')

  // ── Schedule page ──
  const schedulePage = schedule.length ? `<section class="sched">${railTab('Schedule')}<div class="article-main">
    <div class="art-head"><h2 class="art-title">Schedule</h2></div>
    ${schedule.map((d) => `<div class="sched-day">
      <div class="sched-day-h">${esc(d.day || '')}</div>
      ${(d.rows || []).filter((r) => r && (r.time || r.activity)).map((r) => `<div class="sched-row"><div class="sched-time">${esc(r.time || '')}</div><div class="sched-act">${esc(r.activity || '')}</div></div>`).join('')}
    </div>`).join('')}
  </div></section>` : ''
  if (schedule.length) tocEntries.push({ label: 'Schedule', num: null })

  // ── Tiered sponsors ──
  const tierMeta = { Platinum: { h: '1.5in', cols: 2 }, Gold: { h: '1.25in', cols: 2 }, Silver: { h: '1.05in', cols: 3 }, Bronze: { h: '0.9in', cols: 4 }, 'Industry Partner': { h: '0.78in', cols: 5 } }
  const groups = [...SPONSOR_TIERS.map((t) => ({ tier: t, list: sponsors.filter((s) => s.tier === t) })), { tier: 'Sponsors', list: sponsors.filter((s) => !SPONSOR_TIERS.includes(s.tier)) }].filter((g) => g.list.length)
  const sponsorsPage = groups.length ? `<section class="sponsors">${railTab('Sponsorships')}<div class="article-main">
    <div class="art-head"><h2 class="art-title">With Thanks to Our Sponsors</h2></div>
    ${groups.map((g) => { const m = tierMeta[g.tier] || { h: '1in', cols: 3 }; return `<div class="tier">
      <div class="tier-h">${esc(g.tier)}</div>
      <div class="tier-grid" style="grid-template-columns:repeat(${m.cols},1fr)">${g.list.map((s) => `<div class="sponsor"><div class="sponsor-plate" style="height:${m.h}"><img src="${s.src}"></div>${s.name ? `<div class="sponsor-name">${esc(s.name)}</div>` : ''}</div>`).join('')}</div>
    </div>` }).join('')}
  </div></section>` : ''
  if (groups.length) tocEntries.push({ label: 'Sponsorships', num: null })

  // ── Table of contents ──
  const toc = tocEntries.length >= 3 ? `<section class="toc">${railTab('Contents')}<div class="article-main"><h2 class="toc-h">Contents</h2>${tocEntries.map((e) => `<div class="toc-row"><span class="toc-num">${e.num || '•'}</span><span class="toc-title">${esc(e.label)}</span></div>`).join('')}</div></section>` : ''

  // ── Back cover ──
  const bc = handbook.backCover || {}
  const hasBack = bc.photo || bc.message || bc.presentedByLogo || bc.presentedByText || logo
  const bcStyle = bc.photo ? `background-image:linear-gradient(${hexA(accent, 0.72)},${hexA(accent, 0.9)}), url('${bc.photo}');background-size:cover;background-position:center;` : `background:${accent};`
  const backCover = hasBack ? `<section class="backcover" style="${bcStyle}"><div class="bc-inner">
    ${logo ? `<img class="bc-logo" src="${logo}">` : ''}
    <div class="bc-msg">${esc(bc.message || 'Thank you for volunteering.')}</div>
    ${(bc.presentedByLogo || bc.presentedByText) ? `<div class="bc-presented"><div class="bc-presented-label">Presented by</div>${bc.presentedByLogo ? `<img class="bc-presented-logo" src="${bc.presentedByLogo}">` : ''}${bc.presentedByText ? `<div class="bc-presented-text">${esc(bc.presentedByText)}</div>` : ''}</div>` : ''}
    <div class="bc-name">${esc(tournament.name)}</div>
  </div></section>` : ''

  const style = `<style>
    @page { margin: 0.5in; }
    .mag * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
    .mag { font-family: Georgia, 'Times New Roman', serif; color: #1a2420; }
    .mag .cover { min-height: 9.6in; color: #fff; display: flex; align-items: center; justify-content: center; text-align: center; padding: 0.7in; break-after: page; page-break-after: always; }
    .mag .cover-inner { border: 2px solid ${GOLD}; padding: 0.7in 0.5in; width: 100%; background: ${coverPhoto ? 'rgba(0,0,0,0.12)' : 'transparent'}; }
    .mag .cover-logo { max-height: 1.3in; max-width: 60%; margin: 0 auto 16px; display: block; object-fit: contain; }
    .mag .eyebrow { color: ${GOLD}; letter-spacing: 5px; text-transform: uppercase; font-size: 12px; font-weight: bold; }
    .mag .cover-rule { width: 64px; height: 3px; background: ${GOLD}; margin: 18px auto; }
    .mag .cover-title { font-size: 42px; line-height: 1.08; margin: 8px 0; font-weight: bold; }
    .mag .cover-sub { color: ${GOLD}; letter-spacing: 4px; text-transform: uppercase; font-size: 14px; margin-top: 12px; }
    .mag .cover-meta { color: rgba(255,255,255,0.85); font-size: 13px; margin-top: 24px; }
    /* Side-tab layout shared by articles, schedule, sponsors, TOC */
    .mag .article, .mag .sched, .mag .sponsors, .mag .toc { display: flex; gap: 0; margin-bottom: 26px; page-break-inside: auto; }
    .mag .toc, .mag .sched, .mag .sponsors { break-before: page; page-break-before: always; }
    .mag .toc { break-after: page; page-break-after: always; }
    .mag .rail { flex: 0 0 0.5in; background: ${accent}; border-radius: 5px 0 0 5px; display: flex; align-items: center; justify-content: center; }
    .mag .rail-label { writing-mode: vertical-rl; transform: rotate(180deg); color: #fff; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; font-size: 12px; padding: 12px 0; white-space: nowrap; }
    .mag .article-main { flex: 1 1 auto; min-width: 0; padding: 2px 0 8px 16px; }
    .mag .toc-h { font-size: 26px; color: ${accent}; border-bottom: 3px solid ${GOLD}; padding-bottom: 8px; }
    .mag .toc-row { display: flex; align-items: baseline; gap: 14px; padding: 9px 0; border-bottom: 1px dotted #c3d0c8; }
    .mag .toc-num { color: ${GOLD}; font-weight: bold; font-size: 15px; width: 30px; }
    .mag .toc-title { font-size: 16px; color: #1a2420; }
    .mag .art-head { break-after: avoid; page-break-after: avoid; border-bottom: 2px solid ${GOLD}; margin-bottom: 12px; padding-bottom: 5px; display: flex; align-items: baseline; gap: 12px; }
    .mag .art-num { font-size: 30px; font-weight: bold; color: ${GOLD}; line-height: 1; }
    .mag .art-title { font-size: 22px; color: ${accent}; font-weight: bold; margin: 0; }
    .mag .art-body { font-size: 13px; line-height: 1.6; text-align: justify; }
    .mag .art-body p { margin: 0 0 9px; }
    .mag .art-body p.lead::first-letter { font-size: 46px; font-weight: bold; color: ${accent}; float: left; line-height: 0.82; padding: 5px 8px 0 0; }
    .mag figure { margin: 0 0 12px; break-inside: avoid; page-break-inside: avoid; }
    .mag figure img { width: 100%; height: auto; display: block; border-radius: 4px; }
    .mag figcaption { font-style: italic; color: ${FERN}; font-size: 11px; margin-top: 4px; }
    .mag .lead-fig { margin-bottom: 14px; }
    .mag .gallery { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
    .mag .gallery figure { margin: 0; }
    /* Full-page photo section */
    .mag .fullpage { break-before: page; page-break-before: always; break-after: page; page-break-after: always; height: 9.6in; background-size: cover; background-position: center; border-radius: 6px; overflow: hidden; display: flex; align-items: flex-end; }
    .mag .fp-caption { width: 100%; color: #fff; padding: 0.5in 0.4in 0.4in; background: linear-gradient(transparent, rgba(0,0,0,0.55)); }
    .mag .fp-title { font-size: 30px; font-weight: bold; }
    .mag .fp-sub { font-size: 14px; margin-top: 4px; opacity: 0.9; }
    /* Schedule */
    .mag .sched-day { break-inside: avoid; margin-bottom: 14px; }
    .mag .sched-day-h { font-size: 16px; font-weight: bold; color: ${accent}; text-align: center; margin: 6px 0 8px; }
    .mag .sched-row { display: flex; gap: 12px; padding: 5px 0; border-bottom: 1px dotted #d5ddd8; }
    .mag .sched-time { flex: 0 0 1.4in; text-align: right; font-weight: bold; font-size: 12px; color: #334; }
    .mag .sched-act { flex: 1; font-size: 12.5px; }
    /* Sponsors (tiered) */
    .mag .tier { break-inside: avoid; margin-bottom: 16px; text-align: center; }
    .mag .tier-h { font-size: 13px; font-weight: bold; letter-spacing: 3px; text-transform: uppercase; color: ${accent}; margin-bottom: 8px; }
    .mag .tier-grid { display: grid; gap: 14px; align-items: center; }
    .mag .sponsor { break-inside: avoid; page-break-inside: avoid; }
    .mag .sponsor-plate { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; display: flex; align-items: center; justify-content: center; }
    .mag .sponsor-plate img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .mag .sponsor-name { font-size: 11px; color: #555; margin-top: 5px; }
    .mag .foot { text-align: center; color: #94a3a0; font-size: 10px; margin-top: 22px; }
    .mag .backcover { break-before: page; page-break-before: always; min-height: 9.6in; color: #fff; display: flex; align-items: center; justify-content: center; text-align: center; padding: 0.8in; }
    .mag .bc-logo { max-height: 1.1in; max-width: 55%; margin: 0 auto 22px; display: block; object-fit: contain; }
    .mag .bc-msg { font-size: 26px; line-height: 1.35; max-width: 6in; margin: 0 auto; }
    .mag .bc-presented { margin-top: 36px; }
    .mag .bc-presented-label { color: ${GOLD}; letter-spacing: 3px; text-transform: uppercase; font-size: 11px; font-weight: bold; margin-bottom: 12px; }
    .mag .bc-presented-logo { max-height: 0.9in; max-width: 55%; margin: 0 auto; display: block; object-fit: contain; background: #fff; padding: 8px 12px; border-radius: 6px; }
    .mag .bc-presented-text { font-size: 18px; font-weight: bold; }
    .mag .bc-name { color: rgba(255,255,255,0.7); font-size: 12px; margin-top: 34px; letter-spacing: 2px; text-transform: uppercase; }
  </style>`

  return `${style}<div class="mag">${cover}${toc}${arts}${schedulePage}${sponsorsPage}<div class="foot">${clubName} · ${esc(tournament.name)} · Volunteer Handbook</div>${backCover}</div>`
}

// Hex colour → rgba() string with the given alpha (for photo overlays).
function hexA(hex, a) {
  const h = String(hex || '#16291F').replace('#', '')
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(n.slice(0, 2), 16) || 0
  const g = parseInt(n.slice(2, 4), 16) || 0
  const b = parseInt(n.slice(4, 6), 16) || 0
  return `rgba(${r},${g},${b},${a})`
}

// Hidden file-input button for adding photos to a handbook section.
function PhotoAdder({ onAdd, busy, label = 'Add photo', multiple = true }) {
  const ref = useRef(null)
  return (
    <>
      <input ref={ref} type="file" accept="image/*" multiple={multiple} className="hidden" onChange={async (e) => { const files = Array.from(e.target.files || []); e.target.value = ''; if (files.length) await onAdd(files) }} />
      <button onClick={() => ref.current?.click()} disabled={busy} className="font-body text-[11px] font-bold px-3 py-2 rounded-xl border disabled:opacity-50 flex items-center gap-1" style={{ color: FERN, borderColor: '#E2E8F0' }}><ImageIcon size={13} /> {busy ? 'Adding…' : label}</button>
    </>
  )
}

function HandbookTab({ tournament, onSave, showToast, courseInfo }) {
  const [sections, setSections] = useState(tournament.data?.handbook?.sections || [])
  const [logo, setLogo] = useState(tournament.data?.handbook?.logo || '')
  const [sponsors, setSponsors] = useState(tournament.data?.handbook?.sponsors || [])
  const [backCover, setBackCover] = useState(tournament.data?.handbook?.backCover || {})
  const [schedule, setSchedule] = useState(tournament.data?.handbook?.schedule || [])
  const [themeColor, setThemeColor] = useState(tournament.data?.handbook?.theme?.color || FOREST)
  const [coverPhoto, setCoverPhoto] = useState(tournament.data?.handbook?.coverPhoto || '')
  const [dirty, setDirty] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [imgBusy, setImgBusy] = useState(false)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  useEffect(() => {
    const hb = tournament.data?.handbook || {}
    setSections(hb.sections || []); setLogo(hb.logo || ''); setSponsors(hb.sponsors || []); setBackCover(hb.backCover || {})
    setSchedule(hb.schedule || []); setThemeColor(hb.theme?.color || FOREST); setCoverPhoto(hb.coverPhoto || ''); setDirty(false)
  }, [tournament.id])

  const STARTERS = [
    { title: 'Welcome', body: 'Thank you for volunteering. This handbook covers everything you need for the week.' },
    { title: 'Where to Park & Check In', body: '' },
    { title: 'Daily Schedule & Shifts', body: '' },
    { title: 'What to Wear & Bring', body: '' },
    { title: 'Your Job Explained', body: '' },
    { title: 'Safety & Weather', body: '' },
    { title: 'Radios & Communication', body: '' },
    { title: 'Food & Breaks', body: '' },
    { title: 'Key Contacts', body: '' },
  ]

  const set = (i, patch) => { setSections((arr) => arr.map((s, j) => (j === i ? { ...s, ...patch } : s))); setDirty(true) }
  const add = () => { setSections((arr) => [...arr, { title: 'New section', body: '' }]); setDirty(true) }
  const addStarters = () => { setSections(STARTERS); setDirty(true) }
  const remove = (i) => { setSections((arr) => arr.filter((_, j) => j !== i)); setDirty(true) }
  const move = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= sections.length) return
    setSections((arr) => { const n = [...arr];[n[i], n[j]] = [n[j], n[i]]; return n }); setDirty(true)
  }

  const addImages = async (i, files) => {
    setImgBusy(true)
    try {
      const added = []
      for (const f of files) { try { added.push({ src: await compressImage(f), caption: '' }) } catch (e) { console.error(e) } }
      if (added.length) { setSections((arr) => arr.map((s, j) => (j === i ? { ...s, images: [...(s.images || []), ...added] } : s))); setDirty(true) }
    } finally { setImgBusy(false) }
  }
  const removeImage = (i, idx) => { setSections((arr) => arr.map((s, j) => (j === i ? { ...s, images: (s.images || []).filter((_, k) => k !== idx) } : s))); setDirty(true) }
  const setCaption = (i, idx, caption) => { setSections((arr) => arr.map((s, j) => (j === i ? { ...s, images: (s.images || []).map((im, k) => (k === idx ? { ...im, caption } : im)) } : s))); setDirty(true) }
  const toggleFullPage = (i) => { setSections((arr) => arr.map((s, j) => (j === i ? { ...s, fullPage: !s.fullPage } : s))); setDirty(true) }

  const uploadLogo = async (files) => {
    setImgBusy(true)
    try { if (files[0]) { setLogo(await compressLogo(files[0])); setDirty(true) } } catch (e) { console.error(e) } finally { setImgBusy(false) }
  }
  const uploadCover = async (files) => { setImgBusy(true); try { if (files[0]) { setCoverPhoto(await compressImage(files[0], 1600, 0.75)); setDirty(true) } } catch (e) { console.error(e) } finally { setImgBusy(false) } }
  const addSponsors = async (files) => {
    setImgBusy(true)
    try {
      const added = []
      for (const f of files) { try { added.push({ src: await compressLogo(f), name: '', tier: 'Gold' }) } catch (e) { console.error(e) } }
      if (added.length) { setSponsors((arr) => [...arr, ...added]); setDirty(true) }
    } finally { setImgBusy(false) }
  }
  const removeSponsor = (idx) => { setSponsors((arr) => arr.filter((_, k) => k !== idx)); setDirty(true) }
  const setSponsorField = (idx, patch) => { setSponsors((arr) => arr.map((sp, k) => (k === idx ? { ...sp, ...patch } : sp))); setDirty(true) }

  const setBc = (patch) => { setBackCover((b) => ({ ...b, ...patch })); setDirty(true) }
  const uploadBcPhoto = async (files) => { setImgBusy(true); try { if (files[0]) setBc({ photo: await compressImage(files[0], 1600, 0.75) }) } catch (e) { console.error(e) } finally { setImgBusy(false) } }
  const uploadBcPresented = async (files) => { setImgBusy(true); try { if (files[0]) setBc({ presentedByLogo: await compressLogo(files[0]) }) } catch (e) { console.error(e) } finally { setImgBusy(false) } }

  // Schedule handlers.
  const addDay = () => { setSchedule((arr) => [...arr, { day: 'New day', rows: [{ time: '', activity: '' }] }]); setDirty(true) }
  const setDay = (di, patch) => { setSchedule((arr) => arr.map((d, i) => (i === di ? { ...d, ...patch } : d))); setDirty(true) }
  const removeDay = (di) => { setSchedule((arr) => arr.filter((_, i) => i !== di)); setDirty(true) }
  const addRow = (di) => { setSchedule((arr) => arr.map((d, i) => (i === di ? { ...d, rows: [...(d.rows || []), { time: '', activity: '' }] } : d))); setDirty(true) }
  const setRow = (di, ri, patch) => { setSchedule((arr) => arr.map((d, i) => (i === di ? { ...d, rows: (d.rows || []).map((r, k) => (k === ri ? { ...r, ...patch } : r)) } : d))); setDirty(true) }
  const removeRow = (di, ri) => { setSchedule((arr) => arr.map((d, i) => (i === di ? { ...d, rows: (d.rows || []).filter((_, k) => k !== ri) } : d))); setDirty(true) }

  const handbookData = () => ({
    sections: sections.map((s) => ({ title: (s.title || '').trim(), body: s.body || '', images: (s.images || []).filter((im) => im && im.src), ...(s.fullPage ? { fullPage: true } : {}) }))
      .filter((s) => s.title || s.body || s.images.length),
    logo: logo || '',
    coverPhoto: coverPhoto || '',
    theme: { color: themeColor || FOREST },
    sponsors: sponsors.filter((sp) => sp && sp.src).map((sp) => ({ src: sp.src, name: (sp.name || '').trim(), tier: sp.tier || 'Gold' })),
    schedule: schedule.map((d) => ({ day: (d.day || '').trim(), rows: (d.rows || []).map((r) => ({ time: (r.time || '').trim(), activity: (r.activity || '').trim() })).filter((r) => r.time || r.activity) })).filter((d) => d.day || d.rows.length),
    backCover: {
      photo: backCover.photo || '',
      message: (backCover.message || '').trim(),
      presentedByLogo: backCover.presentedByLogo || '',
      presentedByText: (backCover.presentedByText || '').trim(),
    },
  })

  const save = async () => {
    await onSave({ data: { ...tournament.data, handbook: handbookData() } })
    setDirty(false); showToast('Handbook saved')
  }

  const print = () => {
    printHTML(buildHandbookHTML(handbookData(), tournament, courseInfo.clubName || ''))
    showToast('Tip: turn on "Background graphics" in the print dialog for the colour cover')
  }

  // One-tap professional PDF (for emailing volunteers or sending to a print
  // shop). Renders the same magazine HTML off-screen and saves it as a PDF.
  const downloadPdf = async () => {
    setPdfBusy(true); showToast('Building PDF…')
    let holder
    try {
      const html2pdf = (await import('html2pdf.js')).default
      holder = document.createElement('div')
      Object.assign(holder.style, { position: 'absolute', left: '-10000px', top: '0', width: '816px', background: '#fff' })
      holder.innerHTML = buildHandbookHTML(handbookData(), tournament, courseInfo.clubName || '')
      document.body.appendChild(holder)
      await waitImgs(holder)
      await html2pdf().set({
        margin: [0.5, 0.5, 0.5, 0.5],
        filename: `${(tournament.name || 'tournament').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-handbook.pdf`,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      }).from(holder).save()
      showToast('PDF downloaded')
    } catch (e) { console.error(e); showToast('Could not build the PDF') }
    finally { if (holder) holder.remove(); setPdfBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {sections.length === 0 && <button onClick={addStarters} className="font-body text-xs font-bold px-3.5 py-2 rounded-full text-white flex items-center gap-1.5" style={{ backgroundColor: FOREST }}><Plus size={14} /> Start with a template</button>}
        <button onClick={add} className="font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5 border" style={{ color: FOREST, borderColor: FOREST }}><Plus size={14} /> Add section</button>
        <button onClick={print} disabled={sections.length === 0} className="font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5 border disabled:opacity-40" style={{ color: FOREST, borderColor: '#E2E8F0' }}><Printer size={14} /> Print</button>
        <button onClick={downloadPdf} disabled={sections.length === 0 || pdfBusy} className="font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5 border disabled:opacity-40" style={{ color: FOREST, borderColor: '#E2E8F0' }}><Download size={14} /> {pdfBusy ? 'Building…' : 'Download PDF'}</button>
        <a href={`${origin}/handbook?t=${tournament.id}`} target="_blank" rel="noopener noreferrer" className="font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5 border" style={{ color: FOREST, borderColor: '#E2E8F0' }}><BookOpen size={14} /> Preview</a>
      </div>

      {/* Branding & sponsors */}
      <Card>
        <p className="font-display text-base font-semibold text-slate-900 mb-1">Branding & Sponsors</p>
        <p className="font-body text-xs text-slate-500 mb-3">Set the booklet's brand colour, cover, club logo and sponsors. Transparent PNG logos look best.</p>

        {/* Brand colour */}
        <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Brand colour</label>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {BRAND_COLORS.map((c) => (
            <button key={c.hex} onClick={() => { setThemeColor(c.hex); setDirty(true) }} title={c.name} className="w-8 h-8 rounded-full border-2 transition" style={{ backgroundColor: c.hex, borderColor: themeColor === c.hex ? GOLD : 'transparent', boxShadow: themeColor === c.hex ? '0 0 0 2px white inset' : 'none' }} aria-label={c.name} />
          ))}
          <label className="flex items-center gap-1.5 ml-1 font-body text-[11px] text-slate-500">
            Custom
            <input type="color" value={themeColor} onChange={(e) => { setThemeColor(e.target.value); setDirty(true) }} className="w-8 h-8 rounded border border-slate-200 bg-white p-0.5" />
          </label>
        </div>

        <div className="flex flex-wrap gap-8">
          <div>
            <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Club logo (cover)</label>
            {logo ? (
              <div className="relative w-40">
                <div className="rounded-lg border border-slate-200 p-2 flex items-center justify-center" style={{ backgroundColor: themeColor, height: 88 }}>
                  <img src={logo} alt="Club logo" className="max-h-full max-w-full object-contain" />
                </div>
                <button onClick={() => { setLogo(''); setDirty(true) }} className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-slate-200 shadow flex items-center justify-center text-red-500" aria-label="Remove logo"><X size={13} /></button>
              </div>
            ) : (
              <PhotoAdder onAdd={uploadLogo} busy={imgBusy} label="Add logo" multiple={false} />
            )}
            {logo && <p className="font-body text-[10px] text-slate-400 mt-1 w-40">Use a white or light logo so it stands out on the cover.</p>}
          </div>

          <div>
            <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Cover photo (optional)</label>
            {coverPhoto ? (
              <div className="relative w-40">
                <img src={coverPhoto} alt="Cover" className="w-40 h-24 object-cover rounded-lg border border-slate-200" />
                <button onClick={() => { setCoverPhoto(''); setDirty(true) }} className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-slate-200 shadow flex items-center justify-center text-red-500" aria-label="Remove cover photo"><X size={13} /></button>
              </div>
            ) : (
              <PhotoAdder onAdd={uploadCover} busy={imgBusy} label="Add cover photo" multiple={false} />
            )}
            <p className="font-body text-[10px] text-slate-400 mt-1 w-40">A course or trophy shot behind the title, tinted in your brand colour.</p>
          </div>
        </div>

        <div className="mt-4">
          <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Sponsor logos</label>
          <div className="flex flex-wrap gap-3 items-start">
            {sponsors.map((sp, idx) => (
              <div key={idx} className="w-32">
                <div className="relative">
                  <div className="rounded-lg border border-slate-200 bg-white p-2 flex items-center justify-center" style={{ height: 64 }}>
                    <img src={sp.src} alt="" className="max-h-full max-w-full object-contain" />
                  </div>
                  <button onClick={() => removeSponsor(idx)} className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-slate-200 shadow flex items-center justify-center text-red-500" aria-label="Remove sponsor"><X size={13} /></button>
                </div>
                <input value={sp.name || ''} onChange={(e) => setSponsorField(idx, { name: e.target.value })} placeholder="Sponsor name" className="w-32 mt-1 text-[11px] font-body border border-slate-200 rounded px-1.5 py-1 outline-none" />
                <select value={sp.tier || 'Gold'} onChange={(e) => setSponsorField(idx, { tier: e.target.value })} className="w-32 mt-1 text-[11px] font-body border border-slate-200 rounded px-1 py-1 bg-white">
                  {SPONSOR_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            ))}
            <div className="pt-0.5"><PhotoAdder onAdd={addSponsors} busy={imgBusy} label="Add sponsor" /></div>
          </div>
        </div>
      </Card>

      {/* Back cover */}
      <Card>
        <p className="font-display text-base font-semibold text-slate-900 mb-1">Back Cover</p>
        <p className="font-body text-xs text-slate-500 mb-3">The last page — a closing thank-you, an optional background photo, and a headline “Presented by” sponsor.</p>
        <div className="space-y-3">
          <div>
            <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Closing message</label>
            <textarea value={backCover.message || ''} onChange={(e) => setBc({ message: e.target.value })} rows={2} className={inputCls} style={{ resize: 'vertical' }} placeholder="Thank you for volunteering!" />
          </div>
          <div className="flex flex-wrap gap-8">
            <div>
              <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Background photo</label>
              {backCover.photo ? (
                <div className="relative w-40">
                  <img src={backCover.photo} alt="" className="w-40 h-24 object-cover rounded-lg border border-slate-200" />
                  <button onClick={() => setBc({ photo: '' })} className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-slate-200 shadow flex items-center justify-center text-red-500" aria-label="Remove photo"><X size={13} /></button>
                </div>
              ) : (
                <PhotoAdder onAdd={uploadBcPhoto} busy={imgBusy} label="Add photo" multiple={false} />
              )}
            </div>
            <div>
              <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">“Presented by” sponsor</label>
              {backCover.presentedByLogo ? (
                <div className="relative w-40">
                  <div className="rounded-lg border border-slate-200 bg-white p-2 flex items-center justify-center" style={{ height: 68 }}>
                    <img src={backCover.presentedByLogo} alt="" className="max-h-full max-w-full object-contain" />
                  </div>
                  <button onClick={() => setBc({ presentedByLogo: '' })} className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-slate-200 shadow flex items-center justify-center text-red-500" aria-label="Remove logo"><X size={13} /></button>
                </div>
              ) : (
                <PhotoAdder onAdd={uploadBcPresented} busy={imgBusy} label="Add logo" multiple={false} />
              )}
              <input value={backCover.presentedByText || ''} onChange={(e) => setBc({ presentedByText: e.target.value })} placeholder="…or type a sponsor name" className="w-40 mt-2 text-[12px] font-body border border-slate-200 rounded-lg px-2.5 py-2 outline-none" />
            </div>
          </div>
        </div>
      </Card>

      {/* Schedule */}
      <Card>
        <p className="font-display text-base font-semibold text-slate-900 mb-1">Schedule</p>
        <p className="font-body text-xs text-slate-500 mb-3">A day-by-day timeline (times + activities) that prints on its own page. Leave empty to skip it.</p>
        <div className="space-y-3">
          {schedule.map((d, di) => (
            <div key={di} className="rounded-xl border border-slate-100 p-3">
              <div className="flex items-center gap-2 mb-2">
                <input value={d.day || ''} onChange={(e) => setDay(di, { day: e.target.value })} placeholder="Day (e.g. Sunday, June 19)" className="flex-1 font-body text-sm font-bold border-b border-slate-100 pb-1 outline-none" />
                <button onClick={() => removeDay(di)} className="text-red-400 p-1.5"><Trash2 size={15} /></button>
              </div>
              <div className="space-y-1.5">
                {(d.rows || []).map((r, ri) => (
                  <div key={ri} className="flex items-center gap-2">
                    <input value={r.time || ''} onChange={(e) => setRow(di, ri, { time: e.target.value })} placeholder="3:30 – 4 AM" className="w-28 shrink-0 text-[12px] font-body border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
                    <input value={r.activity || ''} onChange={(e) => setRow(di, ri, { activity: e.target.value })} placeholder="Activity" className="flex-1 min-w-0 text-[12px] font-body border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
                    <button onClick={() => removeRow(di, ri)} className="text-slate-300 hover:text-red-500 p-1 shrink-0"><X size={14} /></button>
                  </div>
                ))}
                <button onClick={() => addRow(di)} className="font-body text-[11px] font-bold px-2.5 py-1.5 rounded-full" style={{ color: FERN, border: '1px solid #E2E8F0' }}><Plus size={12} className="inline" /> Add time</button>
              </div>
            </div>
          ))}
          <button onClick={addDay} className="font-body text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-1.5 border" style={{ color: FOREST, borderColor: FOREST }}><Plus size={14} /> Add day</button>
        </div>
      </Card>

      {sections.length === 0 ? (
        <Card><p className="font-body text-sm text-slate-400 text-center py-6">No handbook yet. Start with a template or add your own sections. Volunteers can read it on their phones from the handbook link (in Setup).</p></Card>
      ) : (
        <div className="space-y-3">
          {sections.map((s, i) => (
            <Card key={i} style={s.fullPage ? { borderColor: GOLD, borderWidth: 1 } : undefined}>
              <div className="flex items-center gap-2 mb-2">
                <input value={s.title} onChange={(e) => set(i, { title: e.target.value })} className="flex-1 font-display text-base font-semibold text-slate-900 border-b border-slate-100 pb-1 outline-none" />
                <button onClick={() => toggleFullPage(i)} title="Print this as a full-page photo" className="font-body text-[10px] font-bold px-2.5 py-1.5 rounded-full shrink-0" style={s.fullPage ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: '#F1F5F9', color: '#64748B' }}>Full-page photo</button>
                <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1.5 rounded-lg disabled:opacity-25" style={{ color: FERN }}><ChevronUp size={16} /></button>
                <button onClick={() => move(i, 1)} disabled={i === sections.length - 1} className="p-1.5 rounded-lg disabled:opacity-25" style={{ color: FERN }}><ChevronDown size={16} /></button>
                <button onClick={() => remove(i)} className="text-red-400 p-1.5"><Trash2 size={15} /></button>
              </div>
              {s.fullPage
                ? <p className="font-body text-[11px] text-slate-500 mb-2">This section prints as a <b>full-page photo</b> using the first photo below, with the title (and any text) overlaid at the bottom.</p>
                : <textarea value={s.body} onChange={(e) => set(i, { body: e.target.value })} rows={4} className={inputCls} style={{ resize: 'vertical' }} placeholder="Write this section…" />}
              <div className="mt-3">
                <label className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5">Photos</label>
                <div className="flex flex-wrap gap-3 items-start">
                  {(s.images || []).map((im, idx) => (
                    <div key={idx} className="w-28">
                      <div className="relative">
                        <img src={im.src} alt="" className="w-28 h-20 object-cover rounded-lg border border-slate-200" />
                        <button onClick={() => removeImage(i, idx)} className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-slate-200 shadow flex items-center justify-center text-red-500" aria-label="Remove photo"><X size={13} /></button>
                        {idx === 0 && <span className="absolute bottom-1 left-1 font-body text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'rgba(0,0,0,0.55)', color: 'white' }}>Lead</span>}
                      </div>
                      <input value={im.caption || ''} onChange={(e) => setCaption(i, idx, e.target.value)} placeholder="Caption" className="w-28 mt-1 text-[11px] font-body border border-slate-200 rounded px-1.5 py-1 outline-none" />
                    </div>
                  ))}
                  <div className="pt-0.5"><PhotoAdder onAdd={(files) => addImages(i, files)} busy={imgBusy} /></div>
                </div>
                {(s.images || []).length > 0 && <p className="font-body text-[10px] text-slate-400 mt-1.5">The first photo prints large under the heading; the rest appear as a gallery.</p>}
              </div>
            </Card>
          ))}
        </div>
      )}

      {dirty && (
        <div className="sticky bottom-4 flex justify-center">
          <button onClick={save} className="font-body text-sm font-bold px-6 py-3 rounded-full text-white shadow-lg" style={{ backgroundColor: FOREST }}>Save handbook</button>
        </div>
      )}
    </div>
  )
}
