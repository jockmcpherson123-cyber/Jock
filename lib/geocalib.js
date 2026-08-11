// Field-calibration math for the Course Map.
//
// The irrigation drawing is just a flat image with its own pixel grid. To lay it
// on a real satellite map we need to know where each pixel sits in the world.
// The superintendent gives us that by standing on known irrigation heads and
// capturing GPS — pairs of (pixel on the drawing) ↔ (real latitude/longitude).
//
// From a handful of those pairs we solve for the single best "similarity"
// transform — a uniform scale, a rotation, and a shift — that lines the whole
// drawing up with the ground. A paper/CAD plan is uniformly scaled and rotated
// (never stretched unevenly), so a similarity is the physically correct model,
// and it's robust to the ~10–15 ft noise in each phone-GPS reading: fit many
// points and the random error averages out.

const R = 6378137 // Web-Mercator sphere radius (metres)

// Project lat/lng to Web-Mercator metres — a flat X/Y frame we can do plain
// geometry in over the small area of one golf course.
export function toMerc(lat, lng) {
  const x = (R * Math.PI * lng) / 180
  const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
  return { x, y }
}
export function fromMerc(x, y) {
  const lng = (x / R) * (180 / Math.PI)
  const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI)
  return { lat, lng }
}

// Drawing pixels are y-DOWN (row 0 at the top); the world is y-UP (north).
// Flip y so a proper rotation (no mirror) lines them up.
const src = (p, imageH) => ({ x: p.px, y: imageH - p.py })

// Solve the best scale + rotation + translation mapping drawing pixels to
// Mercator metres, in closed form (least squares). Needs ≥2 points.
// Returns { scale, theta, tx, ty } or null.
export function fitSimilarity(points, imageH) {
  const pts = (points || []).filter((p) => p && p.lat != null && p.lng != null)
  if (pts.length < 2) return null
  const s = pts.map((p) => src(p, imageH))
  const d = pts.map((p) => toMerc(p.lat, p.lng))
  const n = pts.length
  const sc = s.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 })
  const dc = d.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 })
  sc.x /= n; sc.y /= n; dc.x /= n; dc.y /= n
  let a = 0, b = 0, den = 0
  for (let i = 0; i < n; i++) {
    const sx = s[i].x - sc.x, sy = s[i].y - sc.y
    const dx = d[i].x - dc.x, dy = d[i].y - dc.y
    a += sx * dx + sy * dy
    b += sx * dy - sy * dx
    den += sx * sx + sy * sy
  }
  if (den === 0) return null
  const theta = Math.atan2(b, a)
  const scale = Math.sqrt(a * a + b * b) / den
  const cos = Math.cos(theta), sin = Math.sin(theta)
  const tx = dc.x - scale * (cos * sc.x - sin * sc.y)
  const ty = dc.y - scale * (sin * sc.x + cos * sc.y)
  return { scale, theta, tx, ty }
}

// Map one drawing pixel (px,py) to real lat/lng using a fitted transform.
export function pixelToLatLng(px, py, tf, imageH) {
  const x = px, y = imageH - py
  const cos = Math.cos(tf.theta), sin = Math.sin(tf.theta)
  const mx = tf.scale * (cos * x - sin * y) + tf.tx
  const my = tf.scale * (sin * x + cos * y) + tf.ty
  return fromMerc(mx, my)
}

// The three image corners Leaflet's rotated overlay needs: visual top-left
// (pixel 0,0), top-right (W,0), bottom-left (0,H) — each as [lat,lng].
export function imageCornerLatLngs(tf, imageW, imageH) {
  const c = (px, py) => { const { lat, lng } = pixelToLatLng(px, py, tf, imageH); return [lat, lng] }
  return { topLeft: c(0, 0), topRight: c(imageW, 0), bottomLeft: c(0, imageH) }
}

// Per-point error (metres) between where each GPS point lands and where the
// transform predicts its pixel should be — the honest "how good is the fit"
// readout. Returns { residuals:[{...point, errorM}], avgErrorM, maxErrorM }.
export function fitResiduals(points, tf, imageH) {
  const out = (points || []).map((p) => {
    if (!tf || p.lat == null) return { ...p, errorM: null }
    const g = toMerc(p.lat, p.lng)
    const x = p.px, y = imageH - p.py
    const cos = Math.cos(tf.theta), sin = Math.sin(tf.theta)
    const mx = tf.scale * (cos * x - sin * y) + tf.tx
    const my = tf.scale * (sin * x + cos * y) + tf.ty
    const errorM = Math.hypot(mx - g.x, my - g.y)
    return { ...p, errorM }
  })
  const errs = out.map((p) => p.errorM).filter((e) => e != null)
  const avgErrorM = errs.length ? errs.reduce((a, e) => a + e, 0) / errs.length : null
  const maxErrorM = errs.length ? Math.max(...errs) : null
  return { residuals: out, avgErrorM, maxErrorM }
}

export const metresToFeet = (m) => (m == null ? null : m * 3.28084)
