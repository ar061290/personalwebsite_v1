import { useEffect, useMemo, useRef, useState } from 'react'
import { setMelon } from '../../lib/melonBus.js'
import { barLayoutTarget, eyesGap } from './framing.js'
import stillUrl from '../../assets/models/chocolate-bar-still.webp'

// Static chocolate bar for browsers without WebGPU (dark theme): a still of the user's GLB rendered
// by the WebGPU hero at rest (same pose, lens and light), framed by the same layout rule. Not
// interactive (hitTest is false); the anchors are the engine's, measured on that render.

// The still: its size (px), the bar's silhouette inside it, the eyes' and the milk drop's anchors
// (px, before eyesGap), all from the render it was made from.
const STILL = {
  w: 951, h: 455,
  box: { x0: 2, y0: 2, x1: 949, y1: 453 },
  eyes: { x: 490.3, y: 108.4 },
  tip: { x: 862.9, y: 452.3 },
}

function layout(w, h) {
  const B = STILL.box
  const L = barLayoutTarget(w, h)
  const k = Math.min(L.width / (B.x1 - B.x0), L.maxHeight / (B.y1 - B.y0))
  const tx = L.cx - (k * (B.x0 + B.x1)) / 2
  const ty = L.cy - (k * (B.y0 + B.y1)) / 2
  return {
    k, tx, ty,
    anchor: { x: tx + k * STILL.eyes.x, y: ty + k * STILL.eyes.y - eyesGap(h) },
    tip: { x: tx + k * STILL.tip.x, y: ty + k * STILL.tip.y },
  }
}

export default function BarFallback({ className = '' }) {
  const boxRef = useRef(null)
  const [size, setSize] = useState(null)
  const geo = useMemo(() => (size ? layout(size.w, size.h) : null), [size])
  const geoRef = useRef(geo)
  geoRef.current = geo

  useEffect(() => {
    const el = boxRef.current
    if (!el) return undefined
    const measure = () => {
      const w = el.clientWidth, h = el.clientHeight
      setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const at = (key) => {
      const g = geoRef.current, el = boxRef.current
      if (!g || !el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left + g[key].x, y: r.top + g[key].y }
    }
    const instance = {
      mode: 'fallback',
      model: 'bar',
      hitTest: () => false,
      isGrabbing: () => false,
      getEyesAnchor: () => at('anchor'),
      getTipAnchor: () => at('tip'),
      wobble() {},
      destroy() {},
    }
    setMelon(instance)
    return () => setMelon(null)
  }, [])

  return (
    <div ref={boxRef} className={`${className} melon-fallback`.trim()} role="img" aria-label="A milk-chocolate bar with a milky filling">
      {geo && (
        <img
          src={stillUrl}
          alt=""
          draggable="false"
          decoding="async"
          style={{
            position: 'absolute',
            left: `${geo.tx}px`,
            top: `${geo.ty}px`,
            width: `${geo.k * STILL.w}px`,
            height: `${geo.k * STILL.h}px`,
            maxWidth: 'none',
          }}
        />
      )}
    </div>
  )
}
