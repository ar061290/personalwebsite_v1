import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SIGNATURE_STROKES, SIGNATURE_VIEWBOX } from './aadiPaths.js'
import './Signature.css'

// A signature that signs itself when it comes into view, as on haoqi.design:
// each stroke is drawn with the stroke-dashoffset trick, one after another.
//
// Driver (triggered, then timed; not scrubbed by scroll):
// - Trigger: an IntersectionObserver on the <svg> itself. It starts drawing
//   once 15% of it is above a line 8% up from the bottom of the viewport.
// - Reset: when less than 15% of it is visible (scrolled back down below that
//   line, or up off the top), it disappears at once and redraws from scratch
//   the next time it comes in, from either direction.
// - Timing: the first stroke starts 0.5 s after the trigger. A stroke takes
//   its length / 720 s, its length measured as if the signature were 320 units
//   wide (the reference's viewBox width), so the pen speed does not depend on
//   the artwork's coordinate system. There is a 30 ms pen lift between
//   strokes; a stroke's optional `pause` (s) replaces that lift before it.
// - Easing per stroke: cubic-bezier(0.65, 0, 0.35, 1).
// Reduced motion: the finished signature is always shown, nothing is drawn.
const FIRST_DELAY = 0.5
const UNITS_PER_SECOND = 720
const REFERENCE_WIDTH = 320
const PEN_LIFT = 0.03
const THRESHOLD = 0.15
const ROOT_MARGIN = '0px 0px -8% 0px'

function viewBoxSize(viewBox) {
  const [, , w, h] = String(viewBox).trim().split(/[\s,]+/).map(Number)
  return { w: w > 0 ? w : REFERENCE_WIDTH, h: h > 0 ? h : REFERENCE_WIDTH / 2 }
}

export default function Signature({ className = '' }) {
  const svgRef = useRef(null)
  const pathRefs = useRef([])
  const [measured, setMeasured] = useState(false)
  const [inView, setInView] = useState(false)
  const { w, h } = viewBoxSize(SIGNATURE_VIEWBOX)

  // Measure every stroke before the first paint, so the finished signature
  // never flashes before it is drawn.
  useLayoutEffect(() => {
    const scale = REFERENCE_WIDTH / w
    let t = FIRST_DELAY
    SIGNATURE_STROKES.forEach((stroke, i) => {
      const path = pathRefs.current[i]
      if (!path) return
      const len = path.getTotalLength()
      const dur = (len * scale) / UNITS_PER_SECOND
      t += stroke.pause ?? (i === 0 ? 0 : PEN_LIFT)
      // One unit of slack so no sliver of the stroke shows before it starts.
      path.style.setProperty('--sig-len', String(Math.ceil(len) + 1))
      path.style.setProperty('--sig-dur', `${dur.toFixed(4)}s`)
      path.style.setProperty('--sig-delay', `${t.toFixed(4)}s`)
      // A zero-length mark (a dot written as a point) needs a round cap to show.
      path.style.strokeLinecap = len < 1 ? 'round' : ''
      t += dur
    })
    setMeasured(true)
  }, [w])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return undefined
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        // Browsers differ on isIntersecting below the threshold, so check the
        // ratio as well: it is drawn only while 15% or more of it is in view.
        setInView(entry.isIntersecting && entry.intersectionRatio >= THRESHOLD - 0.001)
      },
      { threshold: THRESHOLD, rootMargin: ROOT_MARGIN },
    )
    io.observe(svg)
    return () => io.disconnect()
  }, [])

  const drawing = measured && inView

  return (
    <svg
      ref={svgRef}
      className={`signature${drawing ? ' is-drawing' : ''}${className ? ` ${className}` : ''}`}
      viewBox={SIGNATURE_VIEWBOX}
      style={{ aspectRatio: `${w} / ${h}` }}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      {SIGNATURE_STROKES.map((stroke, i) => (
        <path
          key={stroke.id ?? i}
          ref={(el) => {
            pathRefs.current[i] = el
          }}
          className="signature__path"
          d={stroke.d}
          strokeWidth={stroke.width ?? 4}
        />
      ))}
    </svg>
  )
}
