'use client'

// A little illustrated turf tile showing the day's mow direction the way it
// looks on the course — a real green / tee / fairway / approach / rough seen
// from above, striped in the direction of cut. The drawing itself lives in
// lib/turfArt.js (pure SVG string) so it renders identically in previews.
import { turfSVG } from '@/lib/turfArt'

export default function MowPattern({ step, size = 72, kind }) {
  // Fall back to a sensible surface when the kind isn't known: half-and-half
  // steps read as a fairway, straight clock steps as a green.
  const k = kind || (step && step.type === 'circle' ? 'fairway' : 'green')
  return <span aria-hidden="true" style={{ display: 'inline-block', lineHeight: 0 }} dangerouslySetInnerHTML={{ __html: turfSVG({ kind: k, step, size }) }} />
}
