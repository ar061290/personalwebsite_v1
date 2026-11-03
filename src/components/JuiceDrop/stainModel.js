// Capillary wicking model for the juice stain, shared by the WebGL sim
// (stainGL.js mirrors these formulas in GLSL) and the Canvas2D fallback, which
// runs the same model on the CPU (createCpuStain below).
//
// The paper is a grid of cells centred on the impact point. Each cell holds
//   s  mobile water (flows to neighbours; > 1 is surface water = the puddle)
//   b  bound water  (soaked into the fibres; fills up to the cell's capacity)
//   p  pigment suspended in the mobile water (moves with it)
//   d  pigment deposited on the fibres (stays put)
// and static paper properties sampled from the real paper height map in
// DOCUMENT space (so the stain follows the visible grain):
//   kappa  conductivity (pits / capillary channels wick faster)
//   theta  entry threshold: a dry cell only starts to wet once its wet
//          neighbour's water exceeds it (bumps / sized fibres resist), which
//          pins the front unevenly and gives the fingered, fibrous boundary
//   bcap   how much water the fibres of that cell soak up
//   gran   how readily pigment settles there (pits catch more: granulation)
//
// Water flows down the saturation gradient with a conductivity that rises
// steeply with saturation (porous-medium diffusion → sharp wet front). The
// puddle under the drop is the reservoir; it drains as the fibres soak water
// up, so the volume is finite and the front stops at a natural radius
// (≈ STAIN.radius). Growth is roughly √t while the reservoir lasts.
// Pigment rides the flow (upwind) and only part of it is filtered out where
// water soaks into dry fibres, so the rest is pushed to the front and piles
// up there; edge evaporation keeps pulling water (and pigment) outward late in
// the spread: the darker coffee-ring edge.

export const STAIN = {
  // The sim is dimensionless (cells, steps); the scheduler in stainGL.js /
  // the CPU fallback maps steps onto wall time so the radius grows ≈ √t.
  rCellsGpu: 32, // final radius in cells (WebGL)
  rCellsCpu: 20, // final radius in cells (Canvas2D fallback)
  steps: 9000, // steps until the front has stopped, at rCells = 32
  stepsExp: 2.4, // steps ∝ rCells^stepsExp
  spreadSeconds: 3.2, // wall time over which those steps are played
  timeWarp: 1.7, // steps(t) ∝ t^timeWarp (the front itself slows ∝ steps^0.3)
  dryStart: 2.4, // s after impact when the wet sheen starts to go
  drySeconds: 1.6, // wet → dried
  kMax: 0.13, // per-step conductivity at kappa 1 (kappa ≤ 1.5)
  sRef: 1.0, // saturation at which conductivity saturates
  nExp: 2.0, // conductivity ∝ (s/sRef)^nExp below sRef → sharp front
  absorb: 0.02, // per step: how fast dry fibres soak up water
  evapFrac: 0.5, // water a wet cell loses over the whole spread, × bcap
  pigment: 0.3, // pigment per unit of juice
  bcapMean: 0.15,
  volumeFudge: 2.75, // water per final wetted cell, × bcap (mobile + evaporated)
  phi: 0.4, // fraction of pigment filtered out with soaking water
  chi: 1.25, // pigment rides the fastest channels: moves this much faster than the water
  betaTotal: 0.12, // slow adsorption of suspended pigment over the spread (granulation)
  puddleScale: 1.55, // puddle radius / drop radius
}

export const PAPER_MEAN = 141 / 255

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// Same hash/value-noise as the GLSL (noise in document px). Dave Hoskins'
// sine-free hash12, so it behaves the same at large coordinates on any GPU.
const fract = (v) => v - Math.floor(v)
function hash(x, y) {
  let a = fract(x * 0.1031), b = fract(y * 0.1031), c = a
  const k = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33)
  a += k; b += k; c += k
  return fract((a + b) * c)
}
export function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy)
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

/**
 * Paper properties at a document point, from its height h (0..1, mean ≈ 0.553).
 * Returns [kappa, theta, bcap, gran]. GLSL twin: paperProps() in stainGL.js.
 */
export function paperProps(h, docX, docY) {
  // big lazy fingers + mid-scale wobble + fibres running mostly one way
  const n1 = (vnoise(docX / 72, docY / 72) * 0.5 + vnoise(docX / 31 + 7.3, docY / 31 + 1.7) * 0.3 + vnoise(docX / 13 + 2.1, docY / 13 + 4.4) * 0.2 - 0.5) * 2
  const n2 = (vnoise(docX / 15 + 3.1, docY / 15 + 9.2) - 0.5) * 2
  const rx = docX * 0.94 + docY * 0.34, ry = -docX * 0.34 + docY * 0.94
  const fib = (vnoise(rx / 26 + 5.5, ry / 3.2) - 0.5) * 2
  const dh = (h - PAPER_MEAN) * 2
  const kappa = Math.min(1.5, Math.max(0.15, Math.exp(-0.45 * dh + 0.75 * n1 + 0.45 * fib)))
  const theta = Math.min(0.6, Math.max(0.01, 0.12 + 0.1 * dh + 0.06 * n2 - 0.1 * n1 - 0.05 * fib))
  const bcap = STAIN.bcapMean * (1 - 0.25 * dh + 0.06 * n1)
  const gran = Math.min(2.5, Math.max(0.25, 1 - 0.9 * dh + 0.25 * n2))
  return [kappa, theta, bcap, gran]
}

/**
 * Grid and per-step constants for a stain of final radius `radiusPx` (CSS px)
 * from a drop of radius `dropRadiusPx`, simulated with `rCells` cells across
 * the final radius.
 */
export function deriveStain({ radiusPx, dropRadiusPx, rCells }) {
  const cellPx = radiusPx / rCells
  const n = Math.ceil(rCells * 1.34) * 2 + 2
  const rf = rCells
  const r0 = Math.max(1.3, (dropRadiusPx * STAIN.puddleScale) / cellPx)
  const volume = Math.PI * rf * rf * STAIN.bcapMean * STAIN.volumeFudge
  const s0 = volume / (Math.PI * r0 * r0)
  const totalSteps = Math.round(STAIN.steps * Math.pow(rCells / 32, STAIN.stepsExp))
  return {
    n,
    cellPx,
    extentPx: n * cellPx,
    rf,
    r0,
    s0,
    totalSteps,
    kMax: STAIN.kMax,
    sRef: STAIN.sRef,
    nExp: STAIN.nExp,
    absorb: STAIN.absorb,
    evap: (STAIN.evapFrac * STAIN.bcapMean) / totalSteps,
    phi: STAIN.phi,
    chi: STAIN.chi,
    beta: STAIN.betaTotal / totalSteps,
    pigment: STAIN.pigment,
  }
}

/** Steps that should have run `t` seconds after impact (≈ √t growth). */
export function stepsAt(cfg, t) {
  const u = Math.min(1, Math.max(0, t / STAIN.spreadSeconds))
  return Math.round(cfg.totalSteps * Math.pow(u, STAIN.timeWarp))
}

// ---------------------------------------------------------------------------
// CPU implementation (Canvas2D fallback; also handy for offline tuning).

const NB = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 0.5], [-1, 1, 0.5], [1, -1, 0.5], [-1, -1, 0.5],
]

/**
 * @param cfg     deriveStain() result
 * @param origin  document px of the grid's top-left corner
 * @param height  (docX, docY) → paper height 0..1
 */
export function createCpuStain(cfg, origin, height) {
  const { n, cellPx } = cfg
  const N = n * n
  const kap = new Float32Array(N), th = new Float32Array(N), bc = new Float32Array(N), gr = new Float32Array(N)
  const taps = Math.max(1, Math.min(4, Math.round(cellPx)))
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = origin[0] + (x + 0.5) * cellPx, dy = origin[1] + (y + 0.5) * cellPx
      let h = 0
      for (let j = 0; j < taps; j++)
        for (let i = 0; i < taps; i++)
          h += height(dx + ((i + 0.5) / taps - 0.5) * cellPx, dy + ((j + 0.5) / taps - 0.5) * cellPx)
      h /= taps * taps
      const pr = paperProps(h, dx, dy)
      const k = y * n + x
      kap[k] = pr[0]; th[k] = pr[1]; bc[k] = pr[2]; gr[k] = pr[3]
    }
  }
  let s = new Float32Array(N), p = new Float32Array(N)
  let s2 = new Float32Array(N), p2 = new Float32Array(N)
  const b = new Float32Array(N), d = new Float32Array(N)
  const c = n / 2
  const reset = () => {
    s.fill(0); p.fill(0); b.fill(0); d.fill(0)
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const r = Math.hypot(x + 0.5 - c, y + 0.5 - c)
        const w = 1 - smoothstep(cfg.r0 - 0.8, cfg.r0 + 0.8, r)
        s[y * n + x] = cfg.s0 * w
        p[y * n + x] = cfg.s0 * w * cfg.pigment
      }
    }
  }
  reset()

  // Capillary potential: saturated paper and the puddle on top of it pull
  // equally (plus a small head while the puddle is tall), so the puddle is a
  // reservoir that feeds the paper rather than sliding sideways itself.
  const psi = (v) => (v < 1 ? v : 1 + 0.004 * (v - 1))
  const dfun = (v) => {
    const t = Math.min(1, v / cfg.sRef)
    return cfg.kMax * Math.pow(Math.max(t, 0), cfg.nExp)
  }

  function step() {
    const { absorb, evap, phi, beta, chi } = cfg
    for (let y = 1; y < n - 1; y++) {
      for (let x = 1; x < n - 1; x++) {
        const i = y * n + x
        const cs = s[i], cb = b[i]
        const cWet = cb > 1e-3 || cs > 1e-3
        const kc = dfun(cs) * kap[i]
        const pc = psi(cs)
        let ds = 0, dp = 0
        for (let q = 0; q < 8; q++) {
          const j = i + NB[q][1] * n + NB[q][0]
          const ns = s[j]
          const nWet = b[j] > 1e-3 || ns > 1e-3
          if (!cWet && !nWet) continue
          let gate = 1
          if (!cWet) gate = smoothstep(th[i], th[i] * 1.5 + 0.03, ns)
          else if (!nWet) gate = smoothstep(th[j], th[j] * 1.5 + 0.03, cs)
          if (gate <= 0) continue
          const K = NB[q][2] * gate * 0.5 * (kc + dfun(ns) * kap[j])
          const f = K * (psi(ns) - pc)
          ds += f
          dp += f > 0 ? (chi * f * p[j]) / Math.max(ns, 1e-5) : (chi * f * p[i]) / Math.max(cs, 1e-5)
        }
        let s1 = Math.max(0, cs + ds)
        let p1 = Math.max(0, p[i] + dp)
        const water = s1
        const a = Math.min(s1, absorb * Math.max(0, bc[i] - cb))
        s1 -= a
        b[i] = cb + a
        const e = cWet ? Math.min(s1, evap) : 0
        s1 -= e
        const conc = p1 / Math.max(water, 1e-5)
        let dep = phi * a * conc + (beta * gr[i] * p1) / Math.max(1, water)
        if (s1 < 1e-4 && b[i] > 1e-3) dep = p1
        dep = Math.min(dep, p1)
        s2[i] = s1
        p2[i] = p1 - dep
        d[i] += dep
      }
    }
    let t = s; s = s2; s2 = t
    t = p; p = p2; p2 = t
  }

  return {
    cfg,
    reset,
    step,
    get state() {
      return { s, b, p, d, kap, th, bc, gr }
    },
  }
}

// ---------------------------------------------------------------------------
// Composite (shared look). Multiply-blended over the paper: returns the
// transmittance (r, g, b) of the stain at one point.

const A_FLESH = [0.034, 1, 0.746] // absorbance shape of #F97C95 over white
const A_DEEP = [0.197, 1, 0.741] // #CB506C (concentrated juice)
export const LOOK = {
  density: 0.72, // pigment → optical density
  wetBoost: 0.38, // wet juice reads more saturated ("dries lighter")
  wetDarken: 0.03, // wet paper is a touch darker overall
  edgeLine: 0.34, // extra density of the thin edge line
  edgeWidth: 0.34, // its width, in units of the wetted field
  edgeGrain: 0.55, // how much the paper height bends the crisp edge
  granulation: 0.35,
}

// Dark theme: milk soaking into black paper. Screen-blended over the sheet, so
// the stain is emitted colour + coverage: a pale, translucent creamy film
// wherever the paper got wet, whiter where the solids piled up (the rim, the
// pits), more opaque while wet (it dries thinner):
//   alpha = mask·(film + solids·(1 − e^(−dens·density)))·(1 + wetAlpha·wet)
export const MILK = {
  film: 0.4, // coverage of the thin film the milk leaves wherever it wetted
  solids: 0.5, // extra coverage where the solids are dense
  density: 4,
  wetAlpha: 0.08, // wet milk is more opaque
  maxAlpha: 0.88,
  cream: [0.95, 0.93, 0.875], // thin film
  bright: [1.0, 0.99, 0.965], // dense rim
}

/**
 * @param st   bilinear sample of the sim at this point: [s, b, p, d]
 * @param h    paper height here (0..1), full resolution
 * @param dry  0 (wet) → 1 (dried), global
 * @param out  Float32Array(3) receiving the transmittance; with `milk`,
 *             Float32Array(4) receiving straight colour + alpha
 * @param milk dark theme: milk on black paper (see MILK)
 */
export function compositeAt(st, h, dry, out, milk = false) {
  // fibres that have soaked up water, or are under the puddle right now
  const wetted = Math.min(1, st[1] / STAIN.bcapMean + st[0] * 0.8)
  const dh = (h - PAPER_MEAN) * 2
  const edge = 0.5 + LOOK.edgeGrain * 0.5 * dh
  const mask = smoothstep(edge - 0.12, edge + 0.12, wetted)
  // a thin darker line just inside the boundary (pigment left at the front)
  const band = mask * (1 - smoothstep(edge + 0.04, edge + LOOK.edgeWidth, wetted))
  // only the pigment that is in the paper shows here (the puddle on top is drawn by the drop)
  let dens = (st[3] + st[2] / Math.max(1, st[0])) * LOOK.density * mask + LOOK.edgeLine * band
  dens *= Math.max(0.2, 1 - LOOK.granulation * dh)
  const wet = mask * smoothstep(0, 0.55, (1 - dry) * (0.55 + Math.min(1, st[0] * 2)))
  dens *= 1 + LOOK.wetBoost * wet
  const k = smoothstep(0.45, 1.35, dens)
  if (milk) {
    const a = Math.min(MILK.maxAlpha, mask * (MILK.film + MILK.solids * (1 - Math.exp(-dens * MILK.density))) * (1 + MILK.wetAlpha * wet))
    for (let c = 0; c < 3; c++) out[c] = MILK.cream[c] + (MILK.bright[c] - MILK.cream[c]) * k
    out[3] = a
    return out
  }
  const gray = 1 - LOOK.wetDarken * wet
  for (let c = 0; c < 3; c++) {
    const a = (A_FLESH[c] + (A_DEEP[c] - A_FLESH[c]) * k) * dens
    out[c] = Math.exp(-a) * gray
  }
  return out
}

/** Cubic B-spline sample of a cell field at cell coords (gx, gy) (cell centres at integers). */
export function sampleBSpline(a, n, gx, gy) {
  const ix = Math.floor(gx), iy = Math.floor(gy)
  const fx = gx - ix, fy = gy - iy
  const wx = bsw(fx), wy = bsw(fy)
  let v = 0
  for (let j = 0; j < 4; j++) {
    const y = Math.min(n - 1, Math.max(0, iy - 1 + j))
    let r = 0
    for (let i = 0; i < 4; i++) {
      const x = Math.min(n - 1, Math.max(0, ix - 1 + i))
      r += a[y * n + x] * wx[i]
    }
    v += r * wy[j]
  }
  return v
}
function bsw(t) {
  const t2 = t * t, t3 = t2 * t
  return [(1 - t) ** 3 / 6, (3 * t3 - 6 * t2 + 4) / 6, (-3 * t3 + 3 * t2 + 3 * t + 1) / 6, t3 / 6]
}
