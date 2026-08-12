// Irrigation symbol catalogue — the legend from the Congressional as-built.
//
// One source of truth for: the on-map legend, the "stamp" palette you tap to
// drop a symbol, and the colour a placed marker shows. Each entry carries a
// small visual spec so we can draw a crisp SVG icon at any size.
//
// shape: 'circle' (full-circle head), 'half' (part-circle head, half filled),
//        'square', 'triangle', 'bowtie', 'diamond'. glyph draws a letter/mark
//        on top (P, W, SH, +, ×, ⚡). fill/stroke are the swatch colours.

export const SYMBOL_GROUPS = [
  {
    key: 'heads', label: 'Sprinkler heads',
    items: [
      { id: 'inf34-376', label: 'Toro INF34-376-6', spec: '75′ · full circle', kind: 'head', shape: 'circle', fill: '#ffffff', stroke: '#111111' },
      { id: 'inf35-376', label: 'Toro INF35-376-6', spec: '75′ · part circle', kind: 'head', shape: 'half', fill: '#111111', stroke: '#111111' },
      { id: 'inf34-346', label: 'Toro INF34-346-6', spec: "65′ · 72′ rad · 28.1 gpm", kind: 'head', shape: 'circle', fill: '#111111', stroke: '#111111' },
      { id: 'inf35-356', label: 'Toro INF35-356-6', spec: "65′ · 72′ · 34.1 gpm", kind: 'head', shape: 'half', fill: '#111111', stroke: '#111111' },
      { id: 'inf34-346b', label: 'Toro INF34-346-6', spec: "65′ · 72′ · 28.1 gpm", kind: 'head', shape: 'circle', fill: '#2f6fed', stroke: '#173a8a' },
      { id: 'inf35-356b', label: 'Toro INF35-356-6', spec: "65′ · 72′ · 34.1 gpm", kind: 'head', shape: 'half', fill: '#2f6fed', stroke: '#173a8a' },
      { id: 'inf34-326', label: 'Toro INF34-326-6', spec: "50′ · 60′ · 18.0 gpm", kind: 'head', shape: 'circle', fill: '#e0a52a', stroke: '#8a6410' },
      { id: 'inf35-326', label: 'Toro INF35-326-6', spec: "50′ · 59′ · 20.5 gpm", kind: 'head', shape: 'half', fill: '#e0a52a', stroke: '#8a6410' },
      { id: 'inf34-306', label: 'Toro INF34-306-6', spec: 'full circle', kind: 'head', shape: 'circle', fill: '#2faa4a', stroke: '#166a2b' },
      { id: 'inf35-306', label: 'Toro INF35-306-6', spec: 'part circle', kind: 'head', shape: 'half', fill: '#2faa4a', stroke: '#166a2b' },
      { id: 'hunter-i20', label: 'Hunter I20', spec: 'rotor', kind: 'head', shape: 'circle', fill: '#0f8f7f', stroke: '#0a5a50', small: true },
      { id: 'toro-t5', label: 'Toro T5', spec: 'rotor', kind: 'head', shape: 'circle', fill: '#e0a52a', stroke: '#8a6410', small: true },
      { id: 'toro-590', label: 'Toro 590GF-6', spec: 'spray', kind: 'head', shape: 'square', fill: '#e11d1d', stroke: '#7a0f0f', small: true },
    ],
  },
  {
    key: 'valves', label: 'Valves',
    items: [
      { id: 'ev-1', label: 'Electric valve 1″', kind: 'valve', shape: 'circle', fill: '#e11d1d', stroke: '#7a0f0f', glyph: '+', glyphColor: '#fff' },
      { id: 'ev-15', label: 'Electric valve 1.5″', kind: 'valve', shape: 'circle', fill: '#111111', stroke: '#000', glyph: '+', glyphColor: '#e11d1d' },
      { id: 'ev-2', label: 'Electric valve 2″', kind: 'valve', shape: 'circle', fill: '#2f6fed', stroke: '#173a8a', glyph: '+', glyphColor: '#fff' },
      { id: 'iso', label: 'D.I. isolation valve', kind: 'valve', shape: 'bowtie', fill: '#111111', stroke: '#111111' },
      { id: 'harco-2', label: '2″ Harco lateral valve', kind: 'valve', shape: 'circle', fill: '#f2d024', stroke: '#8a6410' },
      { id: 'harco-3', label: '3″ Harco lateral valve', kind: 'valve', shape: 'circle', fill: '#e0c000', stroke: '#8a6410' },
      { id: 'harco-4', label: '4″ Harco lateral valve', kind: 'valve', shape: 'square', fill: '#e11d1d', stroke: '#7a0f0f', glyph: '×', glyphColor: '#fff' },
    ],
  },
  {
    key: 'couplers', label: 'Couplers & relief',
    items: [
      { id: 'qc-1', label: '1″ quick coupler valve', kind: 'quick_coupler', shape: 'triangle', fill: '#ff7f0e', stroke: '#a34e00' },
      { id: 'air-relief', label: 'Air relief', kind: 'other', shape: 'square', fill: '#f2d024', stroke: '#111111', glyph: '◣', glyphColor: '#111' },
    ],
  },
  {
    key: 'infra', label: 'Controllers & wiring',
    items: [
      { id: 'ground-assy', label: 'Ground assembly (plate, rod, GEM, surge)', kind: 'controller', shape: 'square', fill: '#ff7f0e', stroke: '#a34e00', glyph: 'P', glyphColor: '#fff' },
      { id: 'lynx-hub', label: 'Toro Remote Lynx smart hub', kind: 'controller', shape: 'square', fill: '#f2d024', stroke: '#111', glyph: 'SH', glyphColor: '#111' },
      { id: 'maxi-splice', label: 'Maxi cable splice', kind: 'other', shape: 'circle', fill: '#ff7f0e', stroke: '#a34e00', glyph: 'CS', glyphColor: '#fff' },
      { id: 'wire-break', label: 'Wire loop break', kind: 'other', shape: 'circle', fill: '#ffffff', stroke: '#e11d1d', glyph: '⚡', glyphColor: '#e11d1d' },
      { id: 'ground-reading', label: 'Ground reading', kind: 'other', shape: 'diamond', fill: '#ffffff', stroke: '#111111' },
    ],
  },
  {
    key: 'source', label: 'Source & connections',
    items: [
      { id: 'weather-station', label: 'Weather station', kind: 'other', shape: 'circle', fill: '#ff7f0e', stroke: '#a34e00', glyph: 'W', glyphColor: '#fff' },
      { id: 'well-head', label: 'Well head', kind: 'other', shape: 'circle', fill: '#ffffff', stroke: '#111111', glyph: 'W', glyphColor: '#111' },
      { id: 'pumpstation', label: 'Pumpstation', kind: 'other', shape: 'square', fill: '#ffffff', stroke: '#111111', glyph: 'P', glyphColor: '#111' },
      { id: 'poc', label: 'Point of connection to existing', kind: 'other', shape: 'circle', fill: '#e11d1d', stroke: '#7a0f0f', glyph: '▼', glyphColor: '#fff' },
    ],
  },
]

// Pipe sizes from the legend (kept here so the legend view is complete).
export const PIPE_ITEMS = [
  { cls: 'Drip line', color: '#2f6fed' },
  { cls: '1.5″ poly', color: '#e83bd0' },
  { cls: '2″ HDPE', color: '#1e1e1e' },
  { cls: '3″ HDPE', color: '#12b2c6' },
  { cls: '4″ HDPE', color: '#57a0ea' },
  { cls: '6″ HDPE', color: '#2170e0' },
  { cls: '8″ HDPE', color: '#1a3fd0' },
  { cls: '10″+ HDPE', color: '#0e2aa8' },
  { cls: '14″+ HDPE', color: '#3d13a2' },
  { cls: '16″ HDPE', color: '#5a12c4' },
]

// Flat lookup by id.
export const SYMBOLS = Object.fromEntries(SYMBOL_GROUPS.flatMap((g) => g.items.map((it) => [it.id, it])))

export const symbolById = (id) => SYMBOLS[id] || null
// The dot colour a placed marker shows on the map (canvas circles).
export const symbolColor = (id) => SYMBOLS[id]?.fill || '#2563EB'

// Build an inline SVG string for a symbol (used in the legend, the palette and
// the map edit panel). `px` is the box size.
export function symbolSvg(sym, px = 22) {
  if (!sym) return ''
  const s = px, c = s / 2, r = s * 0.4
  const stroke = sym.stroke || '#111'
  const fill = sym.fill || '#fff'
  const sw = Math.max(1, s * 0.09)
  let shape = ''
  if (sym.shape === 'circle') {
    shape = `<circle cx="${c}" cy="${c}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
  } else if (sym.shape === 'half') {
    // Part-circle head: left half filled, right half white.
    shape = `<circle cx="${c}" cy="${c}" r="${r}" fill="#ffffff" stroke="${stroke}" stroke-width="${sw}"/>` +
      `<path d="M${c},${c - r} A${r},${r} 0 0 0 ${c},${c + r} Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
  } else if (sym.shape === 'square') {
    const o = s * 0.14, w = s - 2 * o
    shape = `<rect x="${o}" y="${o}" width="${w}" height="${w}" rx="${s * 0.06}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
  } else if (sym.shape === 'diamond') {
    shape = `<path d="M${c},${c - r} L${c + r},${c} L${c},${c + r} L${c - r},${c} Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
  } else if (sym.shape === 'triangle') {
    shape = `<path d="M${c},${c - r} L${c + r},${c + r * 0.8} L${c - r},${c + r * 0.8} Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`
  } else if (sym.shape === 'bowtie') {
    shape = `<path d="M${c - r},${c - r} L${c},${c} L${c - r},${c + r} Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>` +
      `<path d="M${c + r},${c - r} L${c},${c} L${c + r},${c + r} Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
  }
  let glyph = ''
  if (sym.glyph) {
    const fs = sym.glyph.length > 1 ? s * 0.42 : s * 0.6
    glyph = `<text x="${c}" y="${c}" text-anchor="middle" dominant-baseline="central" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="${fs}" fill="${sym.glyphColor || '#111'}">${sym.glyph}</text>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">${shape}${glyph}</svg>`
}
