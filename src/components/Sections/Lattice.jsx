// The research page's head art (research.js: headArt: 'lattice'), beside the big title: a few unit
// cells of the oxide interface Aadi simulates, LaAlO3 grown on SrTiO3, drawn as shaded spheres on a
// 2D canvas and slowly turning. A nod to the "illustrative lattice" on his old site, except that this
// one is the real structure in kind (not in scale, nor in any computed detail): illustrative, and
// captioned so.
//
// The structure: perovskites, ABO3. Seen along the growth direction a perovskite is a stack of
// alternating planes, AO then BO2: SrO / TiO2 for the substrate, LaO / AlO2 for the film. Here a
// 2 × 2 patch (3 × 3 reads as a cloud at this size) of three SrTiO3 cells with three LaAlO3 cells on
// top, so the interface (TiO2 under LaO, the conducting kind, where the two-dimensional electron gas
// lives) sits at the middle of the drawing. Atoms by site, three sizes: A big, B and oxygen small,
// each species its own colour from the hero of the theme (PALETTE: the watermelon in light, the
// chocolate bar in dark), so the two crystals read apart. Hairline bonds join each B to its six
// oxygens (the corner-sharing octahedra), and the interface is a thin sheet in the site's accent: the
// one place it is used.
//
// Drawing: every sphere is a sprite (radial gradients: a soft highlight up and to the left, the body,
// a shaded edge, and a soft shadow falling down and to the right onto whatever is behind it), drawn
// per species once per size or theme and stamped with drawImage, scaled by perspective. Spheres are
// painted far to near; the camera always looks down on the stack, so the substrate (bonds, then its
// spheres), then the sheet, then the film is the right order. Farther atoms are laid thinner, so the
// paper shows through them (a fog of paper in either theme). The canvas has no fill of its own.
//
// Motion: a slow turn about the vertical axis (about 40 s a revolution). Pointing at it leans it a
// few degrees toward the pointer; dragging sideways turns it and lets it coast back to its own pace
// (not required: it turns by itself; a tap without a drag still sticks a sticker on, as anywhere).
// It draws only while on screen (IntersectionObserver) and the tab is visible; with reduced motion
// it is a still frame, which a drag still turns. devicePixelRatio is capped at 2. Theme switches are
// taken at once (the theme switch pictures the new page straight after the event).
import { useEffect, useRef } from 'react'
import { getTheme, onThemeChange } from '../../lib/theme.js'
import './Lattice.css'

const TAU = Math.PI * 2

// ── the crystal, in lattice constants ──
const N = 2 // unit cells along each in-plane edge
const STACK = ['sto', 'sto', 'sto', 'lao', 'lao', 'lao'] // unit cells, bottom to top
const SITES = { sto: { A: 'Sr', B: 'Ti' }, lao: { A: 'La', B: 'Al' } }
// sphere radii by site: nothing like the ionic radii (which would fill the cell), sized to read
const RADIUS = { A: 0.25, B: 0.13, O: 0.12 }

// ── the camera ──
const PITCH = 0.36 // looking down on the stack, about 20°
const DIST = 16 // camera distance in lattice constants: a gentle perspective
const AUTO_SPIN = 0.16 // rad/s
const START_YAW = 0.62 // a corner toward the viewer, so the first (or only, reduced) frame has depth
const LEAN_PITCH = 0.07 // how far pointing at it leans it (rad), up/down
const LEAN_YAW = 0.18 // and round
const DRAG_GAIN = 0.011 // rad per CSS px dragged
const FOG = 0.45 // the farthest atoms are laid at 1 - FOG
const MAX_UNIT = 74 // CSS px per lattice constant at most, however big the box
const DPR_CAP = 2

// [highlight, body, shade] per species; `shadow` is the soft shadow a sphere drops behind it, and the
// bonds are the theme's ink (read from the tokens) at `bond` alpha. The site's two heroes: in light
// the watermelon (rind greens, the flesh's pinks, the rind's pale layer, oxygens as its dark seeds);
// in dark the chocolate bar (milk and dark chocolate, caramel, the milky filling, Kinder orange).
const PALETTE = {
  light: {
    Sr: ['#cfe3d4', '#457c59', '#1d4530'], // rind
    La: ['#f6c9d3', '#cb506c', '#7a2338'], // deep flesh
    Ti: ['#ffd9e0', '#f97c95', '#b8475f'], // flesh
    Al: ['#ffffff', '#e6eedf', '#9fb59a'], // the rind's pale inner layer
    O: ['#8a6a70', '#3a1d24', '#1a0c10'], // seeds
    shadow: 'rgba(40, 30, 20, 0.16)',
    bond: 0.26,
    sheet: [0.16, 0.65], // the interface: fill and edge alpha
  },
  dark: {
    Sr: ['#d9a988', '#8a5232', '#3b1f12'], // milk chocolate
    La: ['#f2cf9a', '#c8843a', '#6b3f12'], // caramel
    Ti: ['#ffffff', '#efe4d4', '#9c8f80'], // the milky filling
    Al: ['#ffc9a8', '#e8642c', '#7a2e10'], // Kinder orange
    O: ['#a07860', '#4a2614', '#1f0e06'], // dark chocolate
    shadow: 'rgba(0, 0, 0, 0.5)',
    bond: 0.22,
    sheet: [0.2, 0.75],
  },
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** '#rrggbb' (or a fallback) as 'rgba(r, g, b, a)'. */
function rgba(hex, a, fallback = [128, 128, 128]) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim())
  const n = m ? parseInt(m[1], 16) : null
  const [r, g, b] = n === null ? fallback : [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

/**
 * The atoms and bonds, centred on the origin, z up. Each atom: position, species, radius and `up`
 * (on the film's side of the interface); each bond: two atom indices and `up`.
 */
function buildCrystal() {
  const atoms = []
  const index = new Map()
  const key = (x, y, z) => `${x * 2},${y * 2},${z * 2}` // every position is a multiple of ½
  const add = (x, y, z, sp, site, up) => {
    index.set(key(x, y, z), atoms.length)
    atoms.push({ x, y, z, sp, site, r: RADIUS[site], up })
  }
  STACK.forEach((crystal, c) => {
    const { A, B } = SITES[crystal]
    const up = crystal === 'lao'
    // the AO plane: A on the cell corners, O on the face centres
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) add(i, j, c, A, 'A', up)
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) add(i + 0.5, j + 0.5, c, 'O', 'O', up)
    // the BO2 plane, half a cell up: B in the cell centres, O on the edges between them
    const z = c + 0.5
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) add(i + 0.5, j + 0.5, z, B, 'B', up)
    for (let i = 0; i < N; i++) for (let j = 0; j <= N; j++) add(i + 0.5, j, z, 'O', 'O', up)
    for (let i = 0; i <= N; i++) for (let j = 0; j < N; j++) add(i, j + 0.5, z, 'O', 'O', up)
  })

  // each B to its six oxygens (five on the top plane); a bond across the interface (the top Ti to
  // the oxygen above it, in the first LaO plane) goes with the film, drawn over the sheet
  const bonds = []
  const steps = [
    [0.5, 0, 0],
    [-0.5, 0, 0],
    [0, 0.5, 0],
    [0, -0.5, 0],
    [0, 0, 0.5],
    [0, 0, -0.5],
  ]
  atoms.forEach((a, i) => {
    if (a.site !== 'B') return
    for (const [dx, dy, dz] of steps) {
      const j = index.get(key(a.x + dx, a.y + dy, a.z + dz))
      if (j !== undefined) bonds.push({ a: i, b: j, up: a.up || atoms[j].up })
    }
  })

  // centred: in-plane on the patch's middle, vertically on the stack's
  const zTop = STACK.length - 0.5
  for (const a of atoms) {
    a.x -= N / 2
    a.y -= N / 2
    a.z -= zTop / 2
  }
  // the interface: halfway between the last TiO2 plane and the first LaO plane
  const firstFilm = STACK.indexOf('lao')
  const interfaceZ = firstFilm - 0.25 - zTop / 2
  return { atoms, bonds, interfaceZ }
}

/**
 * Projects (x, y, z) for a camera turned `yaw` about the vertical and looking down at `pitch`:
 * screen x and up, depth (larger is farther) and the perspective scale, in lattice constants.
 */
function project(x, y, z, cosY, sinY, cosP, sinP, out) {
  const xr = x * cosY - y * sinY
  const yr = x * sinY + y * cosY // into the screen, before the pitch
  const depth = yr * cosP - z * sinP
  const s = DIST / (DIST + depth)
  out.x = xr * s
  out.up = (yr * sinP + z * cosP) * s
  out.depth = depth
  out.s = s
}

/**
 * The drawing's extent over every turn and lean, in lattice constants, so the fit never changes
 * as it turns (it would breathe otherwise). Once, at start.
 */
function measureExtent({ atoms }) {
  const p = {}
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let maxDepth = 0
  for (let k = 0; k < 48; k++) {
    const yaw = (k / 48) * TAU
    for (const pitch of [PITCH - LEAN_PITCH, PITCH + LEAN_PITCH]) {
      const cy = Math.cos(yaw)
      const sy = Math.sin(yaw)
      const cp = Math.cos(pitch)
      const sp = Math.sin(pitch)
      for (const a of atoms) {
        project(a.x, a.y, a.z, cy, sy, cp, sp, p)
        const r = a.r * p.s
        minX = Math.min(minX, p.x - r)
        maxX = Math.max(maxX, p.x + r)
        minY = Math.min(minY, p.up - r)
        maxY = Math.max(maxY, p.up + r)
        maxDepth = Math.max(maxDepth, Math.abs(p.depth))
      }
    }
  }
  return { minX, maxX, minY, maxY, maxDepth }
}

/** One species' sphere at radius `r` (device px), with its soft shadow, on a little canvas. */
function makeSprite([hi, body, shade], r, shadow) {
  const pad = Math.ceil(r * 0.5) + 1
  const size = Math.ceil(r * 2 + pad * 2)
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')
  const m = size / 2

  // the shadow it drops behind it, down and to the right, soft-edged
  const sx = m + r * 0.14
  const sy = m + r * 0.24
  const sg = g.createRadialGradient(sx, sy, r * 0.55, sx, sy, r * 1.38)
  sg.addColorStop(0, shadow)
  sg.addColorStop(1, 'rgba(0, 0, 0, 0)')
  g.fillStyle = sg
  g.fillRect(0, 0, size, size)

  // the ball: lit from the upper left, the light falling off to a shaded edge at the lower right
  const bg = g.createRadialGradient(m - r * 0.36, m - r * 0.42, r * 0.04, m - r * 0.12, m - r * 0.16, r * 1.2)
  bg.addColorStop(0, hi)
  bg.addColorStop(0.2, hi)
  bg.addColorStop(0.58, body)
  bg.addColorStop(1, shade)
  g.beginPath()
  g.arc(m, m, r, 0, TAU)
  g.fillStyle = bg
  g.fill()

  // a breath of light bounced back into the shaded edge, so it rounds off instead of going flat
  const rim = g.createRadialGradient(m + r * 0.3, m + r * 0.38, r * 0.5, m, m, r)
  rim.addColorStop(0, 'rgba(255, 255, 255, 0)')
  rim.addColorStop(0.82, 'rgba(255, 255, 255, 0)')
  rim.addColorStop(1, 'rgba(255, 255, 255, 0.12)')
  g.fillStyle = rim
  g.fill()

  return { canvas: c, size, r }
}

export default function Lattice() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx) return undefined

    const crystal = buildCrystal()
    const { atoms, bonds, interfaceZ } = crystal
    const extent = measureExtent(crystal)
    const count = atoms.length
    // where each atom lands this frame
    const px = new Float32Array(count)
    const py = new Float32Array(count)
    const pd = new Float32Array(count)
    const ps = new Float32Array(count)
    // painting order, per side of the interface (re-sorted far to near every frame)
    const below = atoms.map((_, i) => i).filter((i) => !atoms[i].up)
    const above = atoms.map((_, i) => i).filter((i) => atoms[i].up)
    const byDepth = (i, j) => pd[j] - pd[i]
    const bondsBelow = bonds.filter((b) => !b.up)
    const bondsAbove = bonds.filter((b) => b.up)
    const E = N / 2 + 0.5 // the interface sheet's half-width, a little past the atoms
    const sheet = [
      [-E, -E],
      [E, -E],
      [E, E],
      [-E, E],
    ].map(([x, y]) => ({ x, y, z: interfaceZ }))

    let theme = getTheme()
    let colors = null // the tokens this theme draws with
    let sprites = {}
    let dpr = 1
    let width = 0 // backing store, device px
    let height = 0
    let scale = 1 // device px per lattice constant
    let ox = 0 // the origin on the canvas
    let oy = 0

    const readColors = () => {
      const css = getComputedStyle(document.documentElement)
      const pal = PALETTE[theme]
      const ink = css.getPropertyValue('--ink')
      const accent = css.getPropertyValue('--accent')
      colors = {
        pal,
        bond: rgba(ink, pal.bond, theme === 'dark' ? [245, 238, 227] : [12, 12, 12]),
        sheetFill: rgba(accent, pal.sheet[0], [232, 121, 143]),
        sheetEdge: rgba(accent, pal.sheet[1], [232, 121, 143]),
      }
    }

    // a sprite per species, drawn at the largest size it is ever stamped at (the nearest atom), so it
    // is only ever scaled down
    const buildSprites = () => {
      const near = DIST / (DIST - extent.maxDepth)
      sprites = {}
      for (const [sp, site] of [
        ['Sr', 'A'],
        ['La', 'A'],
        ['Ti', 'B'],
        ['Al', 'B'],
        ['O', 'O'],
      ]) {
        sprites[sp] = makeSprite(colors.pal[sp], Math.max(2, RADIUS[site] * scale * near), colors.pal.shadow)
      }
    }

    // the backing store to the box (at the capped devicePixelRatio), and the drawing fitted into it
    const fit = () => {
      dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP)
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
      if (w === width && h === height && sprites.O) return
      canvas.width = width = w
      canvas.height = height = h
      const spanX = extent.maxX - extent.minX
      const spanY = extent.maxY - extent.minY
      scale = Math.min(w / spanX, h / spanY, MAX_UNIT * dpr) * 0.97
      ox = w / 2 - ((extent.minX + extent.maxX) / 2) * scale
      oy = h / 2 + ((extent.minY + extent.maxY) / 2) * scale
      buildSprites()
    }

    // ── the state of the turn ──
    const reduced = reducedMotion()
    let yaw = START_YAW
    let spin = AUTO_SPIN // rad/s: the auto pace, or a drag's coast easing back to it
    let lean = { x: 0, y: 0 } // eased toward `aim`, the pointer's place over the box (-½…½)
    const aim = { x: 0, y: 0 }
    let drag = null // { id, x, t, v }

    const p = {}
    const draw = () => {
      fit()
      const pitch = PITCH + lean.y * LEAN_PITCH * 2
      const turn = yaw + lean.x * LEAN_YAW * 2
      const cosY = Math.cos(turn)
      const sinY = Math.sin(turn)
      const cosP = Math.cos(pitch)
      const sinP = Math.sin(pitch)
      for (let i = 0; i < count; i++) {
        const a = atoms[i]
        project(a.x, a.y, a.z, cosY, sinY, cosP, sinP, p)
        px[i] = ox + p.x * scale
        py[i] = oy - p.up * scale
        pd[i] = p.depth
        ps[i] = p.s
      }
      below.sort(byDepth)
      above.sort(byDepth)

      ctx.clearRect(0, 0, width, height)
      const span = extent.maxDepth * 2 || 1
      const paintBonds = (list) => {
        ctx.beginPath()
        for (const b of list) {
          ctx.moveTo(px[b.a], py[b.a])
          ctx.lineTo(px[b.b], py[b.b])
        }
        ctx.lineWidth = dpr
        ctx.strokeStyle = colors.bond
        ctx.stroke()
      }
      const paintAtoms = (list) => {
        for (const i of list) {
          const sprite = sprites[atoms[i].sp]
          const k = (atoms[i].r * scale * ps[i]) / sprite.r // stamped at this atom's size
          const d = sprite.size * k
          ctx.globalAlpha = 1 - FOG * ((pd[i] + extent.maxDepth) / span)
          ctx.drawImage(sprite.canvas, px[i] - d / 2, py[i] - d / 2, d, d)
        }
        ctx.globalAlpha = 1
      }

      // the substrate, the interface over it, then the film over that
      paintBonds(bondsBelow)
      paintAtoms(below)
      ctx.beginPath()
      sheet.forEach((c, i) => {
        project(c.x, c.y, c.z, cosY, sinY, cosP, sinP, p)
        const x = ox + p.x * scale
        const y = oy - p.up * scale
        if (i) ctx.lineTo(x, y)
        else ctx.moveTo(x, y)
      })
      ctx.closePath()
      ctx.fillStyle = colors.sheetFill
      ctx.fill()
      ctx.lineWidth = dpr
      ctx.strokeStyle = colors.sheetEdge
      ctx.stroke()
      paintBonds(bondsAbove)
      paintAtoms(above)
    }

    // ── the loop: runs only while on screen, in a visible tab, without reduced motion ──
    let raf = 0
    let last = 0
    let inView = false
    const frame = (now) => {
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0) // a long pause resumes, never jumps
      last = now
      if (!drag) {
        spin += (AUTO_SPIN - spin) * (1 - Math.exp(-dt * 1.2))
        yaw += spin * dt
      }
      const ease = 1 - Math.exp(-dt * 4)
      lean = { x: lean.x + (aim.x - lean.x) * ease, y: lean.y + (aim.y - lean.y) * ease }
      draw()
      raf = requestAnimationFrame(frame)
    }
    const sync = () => {
      const run = inView && !document.hidden && !reduced
      if (run && !raf) {
        last = 0
        raf = requestAnimationFrame(frame)
      }
      if (!run && raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    }

    const io = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting
      if (inView && reduced) draw()
      sync()
    })
    io.observe(canvas)
    const ro = new ResizeObserver(() => {
      if (!raf && canvas.clientWidth) draw()
    })
    ro.observe(canvas)
    document.addEventListener('visibilitychange', sync)
    const offTheme = onThemeChange((next) => {
      theme = next
      readColors()
      if (sprites.O) buildSprites()
      if (canvas.clientWidth) draw()
    })

    // ── the pointer: lean toward it; drag sideways to turn ──
    const place = (e) => {
      const r = canvas.getBoundingClientRect()
      return { x: (e.clientX - r.left) / r.width - 0.5, y: (e.clientY - r.top) / r.height - 0.5 }
    }
    const onMove = (e) => {
      if (drag && e.pointerId === drag.id) {
        const now = performance.now()
        const dx = e.clientX - drag.x
        const step = dx * DRAG_GAIN
        yaw += step
        drag.v = drag.v * 0.6 + (step / Math.max(0.008, (now - drag.t) / 1000)) * 0.4
        drag.x = e.clientX
        drag.t = now
        if (!raf) draw() // reduced motion: a still frame, turned by hand
      }
      if (!reduced && e.pointerType !== 'touch') Object.assign(aim, place(e))
    }
    const onDown = (e) => {
      if (e.button !== 0) return
      drag = { id: e.pointerId, x: e.clientX, t: performance.now(), v: 0 }
      canvas.setPointerCapture?.(e.pointerId)
    }
    const onUp = (e) => {
      if (!drag || e.pointerId !== drag.id) return
      // let it coast (a flick turns it faster for a moment), then settle back to its own pace
      if (performance.now() - drag.t < 120) spin = Math.max(-4, Math.min(4, drag.v))
      drag = null
    }
    const onLeave = () => {
      aim.x = 0
      aim.y = 0
    }
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('pointerleave', onLeave)

    readColors()
    if (canvas.clientWidth) draw()

    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
      ro.disconnect()
      offTheme()
      document.removeEventListener('visibilitychange', sync)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return (
    <figure className="lattice">
      <canvas
        ref={canvasRef}
        className="lattice__canvas"
        role="img"
        aria-label="Illustration: a few unit cells of LaAlO3 grown on SrTiO3, atoms as shaded spheres, the interface between the two crystals marked, slowly turning"
        data-cursor="drag"
      />
      <figcaption className="lattice__caption">
        LaAlO<sub>3</sub> / SrTiO<sub>3</sub> · illustrative
      </figcaption>
    </figure>
  )
}
