// Mowing route helpers, shared by the Mowing Routes setup and the Workboard's
// "Mow Greens" add-job flow.
//
// A course's greens = practice/putting greens first (they're mowed first), then
// holes 1..N. Route "sets" are hand-built, locked layouts per mower-count, saved
// in courseInfo.mowingSets[course][count].groups (arrays of green ids; a green
// may appear on more than one mower). When no locked set exists for a count, we
// fall back to an even split along the saved order (courseInfo.mowingOrder).

export function greensForCourse(course) {
  const holes = Number(course?.holes) || 0
  const out = []
  ;(course?.practiceGreens || []).forEach((nm) => { const n = String(nm).trim(); if (n) out.push({ id: `p:${n}`, label: n }) })
  for (let i = 1; i <= holes; i++) out.push({ id: String(i), label: `#${i}` })
  return out
}

export function reconcileOrder(saved, allIds) {
  const s = (saved || []).filter((id) => allIds.includes(id))
  return [...s, ...allIds.filter((id) => !s.includes(id))]
}

export function splitEven(arr, n) {
  const out = []
  if (n <= 0) return out
  const base = Math.floor(arr.length / n)
  const rem = arr.length % n
  let i = 0
  for (let k = 0; k < n; k++) { const size = base + (k < rem ? 1 : 0); out.push(arr.slice(i, i + size)); i += size }
  return out
}

// Bring a saved layout up to date with the current greens: keep valid ids (a
// green may be on several mowers — de-dup only WITHIN a mower), drop vanished
// greens, and drop any green on NO mower onto the last one. If the saved layout
// doesn't match the count, start from an even split.
export function reconcileGroups(groups, count, allIds, order) {
  const fallback = () => splitEven(reconcileOrder(order, allIds), count)
  if (!Array.isArray(groups) || groups.length !== count) return fallback()
  const g = groups.map((arr) => [...new Set((arr || []).filter((id) => allIds.includes(id)))])
  const covered = new Set(g.flat())
  const missing = reconcileOrder(order, allIds).filter((id) => !covered.has(id))
  if (missing.length && g.length) g[g.length - 1] = [...g[g.length - 1], ...missing]
  return g
}

// The greens layout for `count` mowers on a course, as GREEN IDS per mower.
export function layoutForCount(courseInfo, courseName, course, count) {
  const greens = greensForCourse(course)
  const allIds = greens.map((g) => g.id)
  const order = reconcileOrder(courseInfo?.mowingOrder?.[courseName], allIds)
  const saved = courseInfo?.mowingSets?.[courseName]?.[count]?.groups
  return reconcileGroups(saved, count, allIds, order)
}

// The same, but each mower's greens as human LABELS (e.g. "Putting Green, #1,
// #2"), listed in the course's mow order so they read the way they're mowed.
export function labelledLayout(courseInfo, courseName, course, count) {
  const greens = greensForCourse(course)
  const labelOf = (id) => greens.find((g) => g.id === id)?.label || id
  const order = reconcileOrder(courseInfo?.mowingOrder?.[courseName], greens.map((g) => g.id))
  const pos = new Map(order.map((id, i) => [id, i]))
  return layoutForCount(courseInfo, courseName, course, count)
    .map((g) => [...g].sort((a, b) => (pos.get(a) ?? 1e9) - (pos.get(b) ?? 1e9)).map(labelOf))
}
