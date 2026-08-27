'use client'

import { useState, useRef, useEffect } from 'react'

// Measure a container's live pixel width so an SVG chart can render at 1:1 —
// filling the full width of whatever card it's in, at a fixed height, with no
// aspect-ratio stretching (marks stay round, text stays crisp). Returns a ref to
// attach to the wrapper and the current width in px.
export function useMeasuredWidth(fallback = 560) {
  const ref = useRef(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(Math.max(80, Math.round(el.clientWidth)))
    update()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}
