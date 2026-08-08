// ── Tournament Operations helpers ────────────────────────────────────────────
// Shared logic for the championship volunteer/crew module: badge codes, roster
// stats, check-in status, and the editable default lists (roles, committees,
// shifts). Pure functions so they work on the manager screen and the TV board.

// People roles. Crew are your own staff; volunteers are the outside help the
// PGA/tournament brings in; leads run a committee/station.
export const PERSON_ROLES = ['Volunteer', 'Crew', 'Team Lead', 'Staff']

// A grounds volunteer operation is organised into committees (a.k.a. stations /
// jobs). These are sensible defaults for a championship maintenance crew — all
// editable per tournament.
export const DEFAULT_COMMITTEES = [
  'Bunkers',
  'Hand Watering',
  'Divot Filling',
  'Mowing',
  'Rolling',
  'Course Setup',
  'Squeegee / Water Removal',
  'Moisture Meters',
  'Debris / Blowing',
  'Transportation',
  'Hospitality / Check-in',
]

// Default shifts with a start time (24h "HH:MM"). Championship maintenance runs
// a morning push before play and an evening push after. Editable per tournament.
export const DEFAULT_SHIFTS = [
  { id: 'am', label: 'AM (Morning Maintenance)', start: '04:30' },
  { id: 'pm', label: 'PM (Evening Maintenance)', start: '17:00' },
]

// T-shirt sizes for the roster (uniform ordering for the PGA).
export const SHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL']

// ── Volunteer sign-up form ────────────────────────────────────────────────────
// The public sign-up form is a list of questions the club can fully customise.
// A question's `map` (when set) routes the answer into a real roster field so it
// powers check-in, the job board, etc.; custom questions (map '') are stored as
// Q&A on the person and shown to staff.
export const SIGNUP_FIELD_TYPES = [
  { id: 'text', label: 'Short text' },
  { id: 'textarea', label: 'Long text' },
  { id: 'email', label: 'Email' },
  { id: 'phone', label: 'Phone' },
  { id: 'select', label: 'Pick from a list' },
  { id: 'yesno', label: 'Yes / No' },
]
// Answers to these map straight onto the roster person.
export const SIGNUP_MAPS = ['name', 'email', 'phone', 'org', 'committee', 'shift', 'shirt', 'notes']

export const DEFAULT_SIGNUP_FIELDS = [
  { id: 'name', label: 'Full name', type: 'text', required: true, map: 'name', locked: true },
  { id: 'email', label: 'Email', type: 'email', required: false, map: 'email' },
  { id: 'phone', label: 'Phone', type: 'phone', required: false, map: 'phone' },
  { id: 'org', label: 'Club / organization', type: 'text', required: false, map: 'org' },
  { id: 'committee', label: 'What would you like to help with?', type: 'text', required: false, map: 'committee' },
  { id: 'shift', label: 'Preferred shift', type: 'text', required: false, map: 'shift' },
  { id: 'shirt', label: 'Shirt size', type: 'select', required: false, map: 'shirt', options: [...SHIRT_SIZES] },
  { id: 'availability', label: 'Days available', type: 'text', required: false, map: '' },
  { id: 'notes', label: 'Anything else?', type: 'textarea', required: false, map: '' },
]

export function signupFieldsOf(t) {
  const f = t?.data?.signupForm?.fields
  return Array.isArray(f) && f.length ? f : DEFAULT_SIGNUP_FIELDS
}

// ── Badge codes ──────────────────────────────────────────────────────────────
// Unambiguous alphabet — no O/0/I/1/L so a human can read it off a card too.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export function randomCode(prefix = 'CCC', len = 6) {
  let s = ''
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  return `${prefix}-${s}`
}
// Generate a code guaranteed not to collide with the ones already handed out.
export function uniqueCode(existingCodes = [], prefix = 'CCC') {
  const taken = new Set(existingCodes)
  for (let i = 0; i < 50; i++) {
    const c = randomCode(prefix)
    if (!taken.has(c)) return c
  }
  return randomCode(prefix, 8) // vanishingly unlikely fallback
}

// ── Check-in status ──────────────────────────────────────────────────────────
// A person is 'in' once checked in (and not out), 'out' after checkout, else
// 'waiting'. `late` is a flag on a waiting person past their shift start.
export function personStatus(person, now = new Date()) {
  const d = person?.data || person || {}
  if (d.checkedOutAt) return { key: 'out', label: 'Left', late: false }
  if (d.checkedInAt) return { key: 'in', label: 'Here', late: false }
  return { key: 'waiting', label: 'Not in', late: isLate(person, now) }
}

// Is a not-yet-arrived person past their shift's start time today?
export function isLate(person, now = new Date(), shifts = DEFAULT_SHIFTS) {
  const d = person?.data || person || {}
  const shift = shifts.find((s) => s.id === d.shift)
  if (!shift?.start) return false
  const [h, m] = shift.start.split(':').map(Number)
  const start = new Date(now)
  start.setHours(h || 0, m || 0, 0, 0)
  return now > start
}

// Roll the roster up into the numbers the desk and TV board care about.
export function rosterStats(people = [], now = new Date()) {
  let here = 0, waiting = 0, late = 0, out = 0
  for (const p of people) {
    const st = personStatus(p, now)
    if (st.key === 'in') here++
    else if (st.key === 'out') out++
    else { waiting++; if (st.late) late++ }
  }
  return { total: people.length, here, waiting, late, out }
}

// Everyone assigned to a committee, in name order — for the job board columns.
export function byCommittee(people = [], committees = DEFAULT_COMMITTEES) {
  const map = {}
  for (const c of committees) map[c] = []
  const unassigned = []
  for (const p of people) {
    const c = (p.data || {}).committee
    if (c && map[c]) map[c].push(p)
    else unassigned.push(p)
  }
  for (const c of Object.keys(map)) map[c].sort((a, b) => String(a.name).localeCompare(String(b.name)))
  unassigned.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  return { map, unassigned }
}

// A short "H:MM AM" time for display from an ISO timestamp.
export function shortTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  } catch { return '' }
}

// The tournament's committees / shifts / roles, falling back to defaults when a
// tournament hasn't customised them yet.
export function committeesOf(t) {
  const c = t?.data?.committees
  return Array.isArray(c) && c.length ? c : DEFAULT_COMMITTEES
}
export function shiftsOf(t) {
  const s = t?.data?.shifts
  return Array.isArray(s) && s.length ? s : DEFAULT_SHIFTS
}
export function shiftLabel(t, id) {
  return shiftsOf(t).find((s) => s.id === id)?.label || ''
}

// Generate a QR code as a PNG data URL for a badge/handout. Dynamically imports
// the qrcode library (browser build) so it stays out of the main bundle.
export async function qrDataUrl(text, opts = {}) {
  const QRCode = (await import('qrcode')).default
  return QRCode.toDataURL(String(text), {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: opts.width || 240,
    color: { dark: opts.dark || '#173B2B', light: opts.light || '#FFFFFF' },
  })
}
