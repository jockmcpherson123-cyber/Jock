// Design tokens — the single source of truth for the app's palette.
//
// Every component imports its colors from here instead of re-declaring them,
// so the brand palette stays identical everywhere. Before this module the same
// tokens were copy-pasted into ~25 files, which let values drift out of sync
// (e.g. the gold accent and the darkest ink ended up with two versions each).
// Add or change a color here and it updates across the whole app.

// Brand greens
export const FOREST = '#16291F' // deepest brand green — headers, dark surfaces
export const FERN = '#3A6B4A'   // primary green — buttons, accents, active states

// Accent
export const GOLD = '#C9A84C'   // gold accent — highlights, key figures

// Paper / neutrals
export const PAPER = '#F9F8F5'   // default page/card background
export const PAPER_2 = '#E8E7E2' // slightly darker paper — insets, alt rows
export const HAIR = '#E2E0DB'    // hairline borders and dividers

// Ink (text)
export const INK = '#1A1A16'   // darkest text — warm-neutral near-black (matches --ink in globals.css)
export const INK_2 = '#5B6160' // secondary text
export const INK_3 = '#8A8984' // muted text, captions, placeholders

// Semantic status colors (kept distinct from the GOLD accent)
export const RED = '#B23A2E'   // errors, over-threshold, danger
export const AMBER = '#B7791F' // warnings, caution
export const BLUE = '#2563EB'  // info, water/rain
export const BAND = '#EEF3EE'  // faint green fill for chart bands / soft highlights
