import { useEffect, useMemo, useRef, useState } from 'react'
import { setMelon } from '../../lib/melonBus.js'
import { SHAPE, seedLayout } from './geometry.js'
import { VIEW, eyesGap, layoutTarget } from './framing.js'

// Static Rosé slice for browsers without WebGPU: same outline, layering, seeds,
// upright 3/4 pose and framing as the 3D one. Not interactive (hitTest is false).

const { alpha, Ri, rho, Ro, T, skin: SKIN, pale: PALE } = SHAPE
const sa = Math.sin(alpha), ca = Math.cos(alpha)
// slight 3/4 view: the face is foreshortened a touch, the back cap shows to the right and above
const FX = Math.cos(VIEW.yaw), FY = Math.cos(VIEW.pitch)
const DX = T * Math.sin(VIEW.yaw) * Math.cos(VIEW.pitch), DY = -T * Math.sin(VIEW.pitch)

// slice units, SVG axes (y down), origin at the wedge apex; the rind arc is on top
const f = (v) => +v.toFixed(4)
const pt = (c, n, r) => `${f(c[0] + n[0] * r)} ${f(c[1] + n[1] * r)}`
const OUTLINE = (() => {
  const O = [0, 0], n1 = [ca, sa], n2 = [-ca, sa], u1 = [sa, -ca], u2 = [-sa, -ca]
  const C1 = [sa * Ri, -ca * Ri], C2 = [-sa * Ri, -ca * Ri]
  return [
    `M ${pt(O, n2, rho)}`,
    `A ${rho} ${rho} 0 0 0 ${pt(O, n1, rho)}`,
    `L ${pt(C1, n1, rho)}`,
    `A ${rho} ${rho} 0 0 0 ${pt(C1, u1, rho)}`,
    `A ${f(Ro)} ${f(Ro)} 0 0 0 ${pt(C2, u2, rho)}`,
    `A ${rho} ${rho} 0 0 0 ${pt(C2, n2, rho)}`,
    'Z',
  ].join(' ')
})()

// outline samples (front face, already foreshortened); the big arc is kept separately for the rind wall
function outlinePoints() {
  const pts = [], arc = []
  const push = (x, y, into = pts) => into.push([x * FX, y * FY])
  const around = (cx, cy, r, a0, a1, n, into) => {
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n
      push(cx + Math.cos(a) * r, cy + Math.sin(a) * r, into)
    }
  }
  const D = Math.PI / 180
  around(0, 0, rho, (180 - 32) * D, 32 * D, 12) // tip
  around(sa * Ri, -ca * Ri, rho, 32 * D, -58 * D, 10) // right corner
  around(0, 0, Ro, -58 * D, -122 * D, 40, arc) // rind (right → left)
  pts.push(...arc)
  around(-sa * Ri, -ca * Ri, rho, -122 * D, -212 * D, 10) // left corner
  return { pts, arc }
}

function convexHull(points) {
  const P = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower = [], upper = []
  for (const p of P) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

const poly = (pts) => 'M ' + pts.map((p) => `${f(p[0])} ${f(p[1])}`).join(' L ') + ' Z'
const back = (p) => [p[0] + DX, p[1] + DY]

// the slab seen at 3/4: the face swept back to the far cap (hull), the rind wall on top
const WALLS = (() => {
  const { pts, arc } = outlinePoints()
  const hull = convexHull(pts.concat(pts.map(back)))
  const rind = arc.concat(arc.map(back).reverse())
  // stripes across the rind wall, from the near rim to the far one
  const stripes = [-0.62, -0.47, -0.3, -0.13, 0.04, 0.2, 0.37, 0.53].map((th, i) => {
    const w = 0.03 + 0.018 * ((i * 7) % 3)
    const at = (t) => [Ro * Math.sin(t) * FX, -Ro * Math.cos(t) * FY]
    const a = at(th - w), b = at(th + w)
    return poly([a, b, back(b), back(a)])
  })
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const [x, y] of hull) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
  return { hull: poly(hull), rind: poly(rind), rim: 'M ' + arc.map(back).map((p) => `${f(p[0])} ${f(p[1])}`).join(' L '), stripes, box: { x0, x1, y0, y1 } }
})()
const BOX = WALLS.box

const SEEDS = seedLayout()
  .filter((s) => s.face > 0)
  .map((s) => ({ x: s.r * Math.sin(s.th), y: -s.r * Math.cos(s.th), rot: (s.th * 180) / Math.PI, s: s.s }))
const teardrop = (s) => {
  const L = 0.15 * s, W = 0.088 * s
  return `M 0 ${f(L / 2)} C ${f(W * 0.5)} ${f(L * 0.25)} ${f(W * 0.56)} ${f(-L * 0.42)} 0 ${f(-L / 2)} C ${f(-W * 0.56)} ${f(-L * 0.42)} ${f(-W * 0.5)} ${f(L * 0.25)} 0 ${f(L / 2)} Z`
}

// display colours sampled from the WebGPU render
const C = {
  skin: '#3f6549',
  skinInner: '#97b395',
  rindWall: '#43704f',
  stripe: '#21492f',
  pale: '#f4f8e2',
  paleInner: '#efcdc9',
  flesh: '#df7482',
  fleshMid: '#d16b79',
  fleshDeep: '#c5616f',
  wall: '#c24a60',
  seed: '#3b2224',
}

function layout(w, h) {
  const L = layoutTarget(w, h)
  const k = Math.min(L.width / (BOX.x1 - BOX.x0), L.maxHeight / (BOX.y1 - BOX.y0))
  const tx = L.cx - k * (BOX.x0 + BOX.x1) / 2
  const ty = L.cy - k * (BOX.y0 + BOX.y1) / 2
  // top-centre of the rind: between the front and back rims, whichever is higher
  const anchor = { x: tx + k * (DX / 2), y: ty + k * (-Ro * FY + Math.min(0, DY)) - eyesGap(h) }
  return { k, tx, ty, anchor }
}

export default function MelonFallback({ className = '' }) {
  const svgRef = useRef(null)
  const [size, setSize] = useState(null)
  const geo = useMemo(() => (size ? layout(size.w, size.h) : null), [size])
  const geoRef = useRef(geo)
  geoRef.current = geo

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return undefined
    const measure = () => {
      const w = svg.clientWidth, h = svg.clientHeight
      setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(svg)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const instance = {
      mode: 'fallback',
      hitTest: () => false,
      isGrabbing: () => false,
      getEyesAnchor() {
        const g = geoRef.current, svg = svgRef.current
        if (!g || !svg) return null
        const r = svg.getBoundingClientRect()
        return { x: r.left + g.anchor.x, y: r.top + g.anchor.y }
      },
      wobble() {},
      destroy() {},
    }
    setMelon(instance)
    return () => setMelon(null)
  }, [])

  return (
    <svg
      ref={svgRef}
      className={`${className} melon-fallback`.trim()}
      viewBox={size ? `0 0 ${size.w} ${size.h}` : undefined}
      role="img"
      aria-label="A slice of watermelon"
    >
      <defs>
        <clipPath id="melon-fb-clip">
          <path d={OUTLINE} />
        </clipPath>
        <radialGradient id="melon-fb-flesh" cx="0" cy="0" r={Ro - PALE} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={C.fleshDeep} />
          <stop offset="0.7" stopColor={C.fleshMid} />
          <stop offset="1" stopColor={C.flesh} />
        </radialGradient>
        <linearGradient id="melon-fb-wall" x1="0" y1="-1.6" x2="0.4" y2="0.2" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#d65d72" />
          <stop offset="1" stopColor={C.wall} />
        </linearGradient>
        <radialGradient id="melon-fb-pale" cx="0" cy="0" r={Ro - SKIN} gradientUnits="userSpaceOnUse">
          <stop offset={(Ro - PALE - 0.02) / (Ro - SKIN)} stopColor={C.paleInner} />
          <stop offset={(Ro - PALE + 0.07) / (Ro - SKIN)} stopColor={C.pale} />
          <stop offset="1" stopColor={C.pale} />
        </radialGradient>
        <linearGradient id="melon-fb-gloss" x1="-1" y1="-1.8" x2="0.6" y2="0.1" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.32" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {geo && (
        <g transform={`translate(${f(geo.tx)} ${f(geo.ty)}) scale(${f(geo.k)})`}>
          {/* the slab's walls: the face swept back to the far cap, rind on top */}
          <path d={WALLS.hull} fill="url(#melon-fb-wall)" />
          <path d={WALLS.rind} fill={C.rindWall} />
          {WALLS.stripes.map((d, i) => <path key={i} d={d} fill={C.stripe} />)}
          <path d={WALLS.rim} fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="0.018" strokeLinecap="round" />
          {/* the near face */}
          <g transform={`scale(${f(FX)} ${f(FY)})`} clipPath="url(#melon-fb-clip)">
            <rect x="-2" y="-2" width="4" height="2.4" fill={C.skin} />
            <circle r={Ro - 0.025} fill={C.skinInner} />
            <circle r={Ro - SKIN} fill="url(#melon-fb-pale)" />
            <circle r={Ro - PALE} fill="url(#melon-fb-flesh)" />
            {SEEDS.map((s, i) => (
              <g key={i} transform={`translate(${f(s.x)} ${f(s.y)}) rotate(${f(s.rot)})`}>
                <path d={teardrop(s.s)} fill={C.seed} opacity="0.85" />
                <ellipse cx={f(-0.012 * s.s)} cy={f(-0.03 * s.s)} rx={f(0.01 * s.s)} ry={f(0.018 * s.s)} fill="#fff" opacity="0.18" />
              </g>
            ))}
            <path d={OUTLINE} fill="url(#melon-fb-gloss)" />
          </g>
        </g>
      )}
    </svg>
  )
}
