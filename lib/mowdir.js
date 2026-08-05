// Mowing DIRECTIONS — the day's mow pattern per surface, and the little rotation
// engine behind it. Sits next to lib/mowing.js (which handles who-mows-which-
// green). Everything lives in the courseInfo blob (no new table).
//
// A "step" is one day's direction. Two kinds:
//   - axis   : straight up-and-back between two clock hours,  {type:'axis', a:12, b:6}  → "12–6"
//   - circle : a half-and-half pass round the outside, clockwise or anti-cw,
//              {type:'circle', dir:'cw'|'acw'} → "Half & half — clockwise"
//
// A surface (Greens, Fairways, Tees, …) has a rotation (an ordered list of
// steps) and a DRIVER that decides which step is "today":
//   - 'day'     : picked automatically from the calendar date (rotates daily,
//                 on its own — nobody presses anything)
//   - 'history' : only moves on when you tap "Apply next" (a stored pointer)
import { localDateISO } from '@/lib/dates'

// The full clock, as the six straight axes (a line has two ends, so 12 hours =
// 6 distinct axes). Used to seed Greens and to offer directions to add.
export const CLOCK_AXES = [
  { a: 12, b: 6 }, { a: 1, b: 7 }, { a: 2, b: 8 },
  { a: 3, b: 9 }, { a: 4, b: 10 }, { a: 5, b: 11 },
]

// Map a surface to the kind of turf art to draw for it (green / tee / fairway /
// approach / rough). Falls back to null so the tile can infer from the step.
export function surfaceKind(surface) {
  const s = String(surface?.key || surface?.label || '').toLowerCase()
  if (/green/.test(s)) return 'green'
  if (/tee/.test(s)) return 'tee'
  if (/fairway|f'?way|fwy/.test(s)) return 'fairway'
  if (/approach|apron/.test(s)) return 'approach'
  if (/rough/.test(s)) return 'rough'
  if (/intermediate|step|collar|surround/.test(s)) return 'approach'
  return null
}

export const axisStep = (a, b) => ({ type: 'axis', a, b })
export const circleStep = (dir) => ({ type: 'circle', dir })

export function stepLabel(step) {
  if (!step) return ''
  if (step.type === 'circle') return `Half & half — ${step.dir === 'acw' ? 'anti-clockwise' : 'clockwise'}`
  if (step.type === 'axis') return `${step.a}–${step.b}`
  return step.label || ''
}

// Short form for tight spots (chips, board headers).
export function stepShort(step) {
  if (!step) return ''
  if (step.type === 'circle') return step.dir === 'acw' ? 'Half & half ↺' : 'Half & half ↻'
  if (step.type === 'axis') return `${step.a}–${step.b}`
  return step.label || ''
}

export const sameStep = (a, b) => a && b && a.type === b.type && a.a === b.a && a.b === b.b && a.dir === b.dir

// Fresh-course defaults: greens run the whole clock automatically, fairways
// alternate half-and-half clockwise / anti-clockwise on the "next when logged"
// driver, tees & approaches do a simple up-down / across.
export function defaultSurfaces() {
  return [
    { key: 'greens', label: 'Greens', driver: 'day', steps: CLOCK_AXES.map((x) => axisStep(x.a, x.b)) },
    { key: 'tees', label: 'Tees', driver: 'day', steps: [axisStep(12, 6), axisStep(3, 9)] },
    { key: 'approaches', label: 'Approaches', driver: 'day', steps: [axisStep(12, 6), axisStep(3, 9)] },
    { key: 'fairways', label: 'Fairways', driver: 'history', steps: [circleStep('cw'), circleStep('acw')] },
  ]
}

// A stable, ever-increasing day counter for an ISO date, so a 'day'-driven
// rotation advances exactly once per calendar day (and never skips or repeats
// across a skipped day — it's the date, not "mows done", that moves it).
function dayNumber(dateISO) {
  const [y, m, d] = String(dateISO || '').split('-').map(Number)
  if (!y) return 0
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86400000)
}

// Read a course's directions config, falling back to sensible defaults.
export function mowDirConfig(courseInfo, courseName) {
  const saved = courseInfo?.mowDirs?.[courseName]
  const surfaces = Array.isArray(saved?.surfaces) && saved.surfaces.length ? saved.surfaces : defaultSurfaces()
  const state = saved?.state || {}
  return { surfaces, state }
}

// Which step (index) is in effect for a surface on a given date.
export function stepIndexFor(surface, state, dateISO) {
  const n = (surface?.steps || []).length
  if (!n) return -1
  if (surface.driver === 'history') {
    const idx = Number(state?.[surface.key]?.index) || 0
    return ((idx % n) + n) % n
  }
  return ((dayNumber(dateISO) % n) + n) % n
}

// Today's direction for a named surface.
export function directionFor(courseInfo, courseName, surfaceKey, dateISO = localDateISO()) {
  const { surfaces, state } = mowDirConfig(courseInfo, courseName)
  const surface = surfaces.find((s) => s.key === surfaceKey)
  if (!surface) return null
  const i = stepIndexFor(surface, state, dateISO)
  if (i < 0) return null
  return { surface, index: i, step: surface.steps[i] }
}

// Match a free-typed job title to a configured surface: "Mow Greens", "Mow
// Greens- Cleanup" and "Greens mow" all land on the greens surface. Longest
// label first so "Approaches" beats a shorter partial. Only mow jobs match.
export function surfaceForJob(surfaces, jobTitle) {
  const j = String(jobTitle || '').toLowerCase()
  if (!j.includes('mow')) return null
  const sorted = [...(surfaces || [])].sort((a, b) => (b.label || '').length - (a.label || '').length)
  return sorted.find((s) => s.label && j.includes(s.label.toLowerCase())) || null
}

// Today's direction for a job title (what the board auto-dumps).
export function directionForJob(courseInfo, courseName, jobTitle, dateISO = localDateISO()) {
  const { surfaces, state } = mowDirConfig(courseInfo, courseName)
  const surface = surfaceForJob(surfaces, jobTitle)
  if (!surface) return null
  const i = stepIndexFor(surface, state, dateISO)
  if (i < 0) return null
  return { surface, index: i, step: surface.steps[i] }
}
