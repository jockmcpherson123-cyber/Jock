'use client'

// A stylised whole-hole map (green → approach → fairway → tees) drawn from
// above and striped to TODAY'S mow direction for each surface. Purely a
// showcase/at-a-glance piece — the real per-surface detail lives on the badges.
import { holeSVG, holeSVGVertical } from '@/lib/turfArt'
import { directionFor } from '@/lib/mowdir'
import { localDateISO } from '@/lib/dates'

export default function HoleMap({ courseInfo = {}, courseName = '', date, orientation = 'horizontal' }) {
  const d = date || localDateISO()
  const stepFor = (key) => directionFor(courseInfo, courseName, key, d)?.step || null
  const steps = {
    greenStep: stepFor('greens'),
    fairStep: stepFor('fairways'),
    apprStep: stepFor('approaches'),
    teeStep: stepFor('tees'),
  }
  const html = orientation === 'vertical'
    ? holeSVGVertical({ ...steps, width: 240 })
    : holeSVG({ ...steps, width: 680 })
  return <div aria-hidden="true" style={{ lineHeight: 0, width: '100%' }} dangerouslySetInnerHTML={{ __html: html }} />
}
