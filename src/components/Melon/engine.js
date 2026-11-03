// ─────────────────────────────────────────────────────────────
//  The melon engine: soft body ↔ renderer glue, camera and framing,
//  picking and the hand tool, frame pacing, visibility / resize / sleep handling.
//
//  createMelonEngine(canvas, { onFail, signal }) → Promise<instance>
//  instance: hitTest(x, y), isGrabbing(), getEyesAnchor(), getTipAnchor(), wobble(), destroy()
//    getEyesAnchor() → client px just above the top-centre of the rind (eyesGap above it)
//    getTipAnchor()  → client px of the tip: the lowest point of the visible rest silhouette
//    Both are REST-pose points (a grab or wobble never moves them), re-read from the canvas rect
//    on every call (so they follow scroll and resize); null before the first layout. They are
//    computed once per layout in computeCamera() from the render body's rest vertices.
//  Window events: 'melon:grabstart', 'melon:grabend' (detail: { clientX, clientY, pointerType }).
//
//  Two models, one per theme (src/lib/theme.js): the jelly melon (light) and the milk-chocolate bar
//  (dark): the user's own GLB (barModel.js: fetched and fitted in the mesh worker, its textures
//  decoded there too; barShaders.js). Each is a "body": its own soft body, meshes, framing and
//  anchors, in the same pipeline (same hand tool, picking, hit test, pacing, sleep, sweep).
//  The theme's model is built first; the other one is built in the background (idle) and kept,
//  GPU buffers included, so a theme change swaps bodies without allocating and draws the new model
//  at once (inside the theme's view transition the new page is pictured as it is). The GLB is only
//  fetched for the dark theme or by that idle prefetch, never on the light theme's critical path.
//  For the bar, getTipAnchor() is where the milk drop forms (its bottom-right corner, under the end
//  that shows the filling) and getEyesAnchor() sits on its top edge, over the middle of the bar.
//  The bar is skinned on the GPU (skinTextured writes per-particle positions and deformation
//  cofactors, its vertex shader blends them): the GLB's own normals turned by the local deformation,
//  so its UV seams never show as creases, and its 15k vertices cost the main thread next to nothing.
//
//  Facet sweep: while the hero scrolls away (FACET_SWEEP, viewport heights), a front of sharp
//  pyramid facets climbs the slice from the tip to the rind and relaxes back to gloss behind it
//  (shaders.js facetSweep; uniforms 76–83). Shading only: silhouette, hit test and anchors are
//  unchanged, and at progress 0 or 1 the shader takes exactly the old path.
//
//  Frame pacing. The solver runs whole substeps (1/300 s) against a real-time accumulator
//  (sim.advance), so every display frame does about the same amount of work at 60, 120 or
//  144 Hz (no 0/1/2-step lumps). The render shows the pose interpolated inside the last
//  substep (sim.lerp(alpha)), so on-screen motion is continuous in time. The solver gets at
//  most a share of the display interval. A machine that can't keep up gets a smooth,
//  uniform slow-down instead of dropped frames or a catch-up spiral. Nothing in the
//  per-frame path allocates.
// ─────────────────────────────────────────────────────────────
import { buildMelon, SHAPE } from './geometry.js'
import { loadBar } from './barModel.js'
import { SoftBody } from './softbody.js'
import { Renderer } from './renderer.js'
import { UBO_FLOATS } from './shaders.js'
import { BAR_LIGHT } from './barShaders.js'
import { M4, project } from './math.js'
import { BACKING, BACKING_DISPLAY, EXPOSURE, KEY_DIR, KEY_INTENSITY, ROSE, STUDIO } from './palette.js'
import { BAR_VIEW, UPRIGHT, VIEW, barLayoutTarget, eyeDirection, eyesGap, layoutTarget } from './framing.js'
import { CHOREO, rangeProgress } from '../../lib/scrollChoreo.js'
import { getTheme, onThemeChange } from '../../lib/theme.js'

// Physics tuning lives in softbody.js: its constructor defaults are the tuned values
// (firmness, damping, settle, memory, reach, follow, fold guard…). The engine only
// overrides what differs for reduced motion.
const TUNING = {}
// reduced motion: the artifact's 0.65 damping, and the wobble dies out sooner
const TUNING_REDUCED = { ...TUNING, damping: 0.65, settleRate: 6 }

const GRAB_RADIUS = 0.4
const MAX_RENDER_PIXELS = 2.6e6 // cap for the off-screen crop; beyond it the crop renders at lower res

// ── frame pacing ──
// The solver may use this share of the display interval per frame, but never less than
// that share of a 60 Hz frame: on a 120/144 Hz screen a heavy frame then halves the frame
// rate (still smooth, still real time) instead of slowing the jelly down.
const SIM_SHARE = 0.65
const SIM_BUDGET_MAX = 20 // ms (low refresh rates)
const MAX_SUBSTEPS = 30 // per frame, hard cap
const MAX_FRAME_DT = 0.1 // s; longer gaps (tab switch, breakpoint) are dropped, not replayed

// ── sleep ── once still, the body glides the last fraction of a pixel to rest and the loop stops
const KE_QUIET = 1e-6 // KE/M per full step counted as "quiet"
const SLEEP_STEPS = 30 // quiet 60 Hz steps (0.5 s) before going to sleep…
const SLEEP_PX = 1.5 // …if no particle is further than this from rest (device px)
const SLEEP_STEPS_LONG = 120 // after 2 s of quiet, a larger residue is glided away too
const SLEEP_PX_LONG = 8
const SLEEP_STEPS_FORCE = 600 // after 10 s of quiet, whatever is left (never stays stuck)

// ── facet sweep ── kodeimmersive's sharp facets, swept tip → rind with lasmentes' front
// (shaders.js facetSweep). Scroll range in viewport heights the canvas has scrolled away: it ends
// where lasmentes' dissolve completes (0.8 × 0.85); it starts once the juice bead has let go of the
// glossy tip (the first tip facets appear ≈ 0.07 vh after the start), so a later dripDetach in
// CHOREO moves the start with it. Owned here, not in scrollChoreo.js.
const FACET_SWEEP = [Math.max(0, (CHOREO.dripDetach ?? 0.06) - 0.06), 0.68]
const FACET_PX = 16 // lattice triangle side, CSS px at the rest framing (lasmentes' cells are 18 px)
const FACET_SLOPE = 0.75 // tan of the peak pyramid facet tilt (≈37°)
const SWEEP_TAU = 0.075 // s; lasmentes eases 0.2 of the gap per 60 Hz frame (τ ≈ 75 ms), made rate-independent

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' })
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

// the model each theme shows
const themeKind = (theme) => (theme === 'dark' ? 'bar' : 'melon')

// ── the meshes, built in a worker so the main thread (and the intro) stays smooth ──
// priority: the fetch priority of the bar's GLB ('high' when it is the page's model, 'low' for the
// idle prefetch)
function buildMeshAsync(signal, kind = 'melon', priority = 'auto') {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError())
    const local = () => setTimeout(() => {
      if (signal.aborted) return reject(abortError())
      try { resolve(kind === 'bar' ? loadBar({ priority }) : buildMelon()) } catch (err) { reject(err) }
    }, 0)
    let worker
    try {
      worker = new Worker(new URL('./melonWorker.js', import.meta.url), { type: 'module' })
    } catch {
      local()
      return
    }
    const stop = () => worker.terminate()
    signal.addEventListener('abort', () => { stop(); reject(abortError()) }, { once: true })
    worker.onmessage = (e) => {
      stop()
      if (e.data?.ok) resolve(e.data.mesh)
      else local()
    }
    worker.onerror = (e) => {
      e.preventDefault?.()
      stop()
      local()
    }
    worker.postMessage(kind === 'bar' ? { kind, priority } : kind)
  })
}

async function initGPU(canvas) {
  if (!navigator.gpu) throw new Error('no-webgpu')
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) throw new Error('no-adapter')
  const device = await adapter.requestDevice()
  const context = canvas.getContext('webgpu')
  if (!context) {
    device.destroy()
    throw new Error('no-context')
  }
  return { adapter, device, context, format: navigator.gpu.getPreferredCanvasFormat() }
}

export async function createMelonEngine(canvas, { onFail, signal } = {}) {
  const ac = new AbortController()
  const forward = () => ac.abort()
  signal?.addEventListener('abort', forward, { once: true })
  if (signal?.aborted) ac.abort()
  let gpu = null
  try {
    // the current theme's model first; the other one follows in the background (startEngine)
    const kind = themeKind(getTheme())
    const gpuP = initGPU(canvas)
    const meshP = buildMeshAsync(ac.signal, kind, 'high')
    meshP.catch(() => {}) // awaited below; don't report an early abort as unhandled
    gpu = await gpuP
    const mesh = await meshP
    if (ac.signal.aborted) throw abortError()
    const renderer = await Renderer.create(gpu.device, gpu.context, gpu.format, { [kind]: mesh.render }, kind)
    if (ac.signal.aborted) {
      renderer.destroy()
      throw abortError()
    }
    try {
      return startEngine(canvas, kind, mesh, gpu, renderer, { onFail })
    } catch (err) {
      renderer.destroy()
      throw err
    }
  } catch (err) {
    ac.abort()
    gpu?.device.destroy()
    throw err
  } finally {
    signal?.removeEventListener('abort', forward)
  }
}

// column-major 4×4 product into out (no allocation)
function mul4(out, a, b) {
  for (let c = 0; c < 4; c++) {
    const b0 = b[4 * c], b1 = b[4 * c + 1], b2 = b[4 * c + 2], b3 = b[4 * c + 3]
    out[4 * c] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3
    out[4 * c + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3
    out[4 * c + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3
    out[4 * c + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3
  }
  return out
}

// row-major 3×3 rotation by `ang` about unit `axis`, into out (same as math.js rotMat)
function rotInto(out, axis, ang) {
  const x = axis[0], y = axis[1], z = axis[2], c = Math.cos(ang), s = Math.sin(ang), t = 1 - c
  out[0] = t * x * x + c; out[1] = t * x * y - s * z; out[2] = t * x * z + s * y
  out[3] = t * x * y + s * z; out[4] = t * y * y + c; out[5] = t * y * z - s * x
  out[6] = t * x * z - s * y; out[7] = t * y * z + s * x; out[8] = t * z * z + c
  return out
}

// clip → world with a column-major inverse viewProj, into out[o..o+2]
function unproject(m, x, y, z, out, o) {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15]
  out[o] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w
  out[o + 1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w
  out[o + 2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w
}

// What differs between the two models: framing, which rest points the anchors come from (each
// test sees a rest point and the body's rest bounds), the constant uniforms. Everything else
// (solver tuning, hand, pacing, sleep, sweep) is shared.
const MODELS = {
  melon: {
    view: VIEW,
    layout: layoutTarget,
    // eyes: the rind's top-centre column; tip: the body near the tip (where the juice drips from)
    isTop: (p) => Math.abs(p[0]) < 0.04 && p[2] > SHAPE.Ro - 0.3,
    isTip: (p) => p[2] < 0.5 * SHAPE.Ro,
    uniforms(ubo) {
      ubo.set([...KEY_DIR, KEY_INTENSITY], 24)
      ubo.set([...ROSE.flesh, 1], 36)
      ubo.set([...ROSE.fleshDeep, 1], 40)
      ubo.set([...ROSE.pale, 1], 44)
      ubo.set([...ROSE.skin, 1], 48)
      ubo.set([...ROSE.stripe, 1], 52)
      ubo.set([...ROSE.seed, 1], 56)
      ubo.set([SHAPE.T, SHAPE.Ro, SHAPE.skin, SHAPE.pale], 60)
      ubo.set([EXPOSURE, 0, 0, 0], 64)
      ubo.set([...STUDIO, 1], 68)
      ubo.set([...BACKING_DISPLAY, 1], 72)
    },
  },
  bar: {
    view: BAR_VIEW,
    layout: barLayoutTarget,
    // eyes: on its far long edge (+z, the top of the picture), over the middle of the bar; tip: its
    // near corner at the filled end (−x is screen right, −z faces the camera), where the milk drop forms
    isTop: (p, mn, mx) => Math.abs(p[0] - (mn[0] + mx[0]) / 2) < 0.05 && p[2] > mx[2] - 0.12,
    isTip: (p, mn) => p[0] < mn[0] + 0.2 && p[2] < mn[2] + 0.12,
    uniforms(ubo, R) {
      const m = R.material
      ubo.set([...BAR_LIGHT.keyDir, BAR_LIGHT.key], 24)
      ubo.set(m.baseColorFactor, 36)
      ubo.set([m.metallic, m.roughness, m.normalScale, 0], 40)
      ubo.set([BAR_LIGHT.exposure, 0, 0, 0], 64)
    },
  },
}

function startEngine(canvas, kind0, mesh0, gpuIn, rendererIn, { onFail }) {
  let gpu = gpuIn
  let renderer = rendererIn
  renderer.backing = BACKING
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

  // ── bodies: one per model, made once and kept (see the header) ──
  function makeBody(kind, mesh) {
    const M = MODELS[kind]
    const sim = new SoftBody(mesh.sim, reduced ? TUNING_REDUCED : TUNING)
    const R = mesh.render
    const nV = R.rest.length / 3
    const index = R.index
    const bodyEnd = R.body.first + R.body.count
    // rest-pose sample points: framing uses the visible body, the eyes and the tip anchors the
    // model's own selections (MODELS)
    const bodyVerts = new Set()
    for (let t = R.body.first; t < bodyEnd; t++) bodyVerts.add(index[t])
    const fitPts = [], topCol = [], tipPts = []
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]
    for (const v of bodyVerts) {
      for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], R.rest[3 * v + k]); mx[k] = Math.max(mx[k], R.rest[3 * v + k]) }
    }
    for (const v of bodyVerts) {
      const p = [R.rest[3 * v], R.rest[3 * v + 1], R.rest[3 * v + 2]]
      if (v % 3 === 0) fitPts.push(p)
      if (M.isTop(p, mn, mx)) topCol.push(p)
      if (M.isTip(p, mn, mx)) tipPts.push(p)
    }
    // ── uniforms that never change ──
    const ubo = new Float32Array(UBO_FLOATS)
    M.uniforms(ubo, R)
    sim.onStep = onStep
    const pose = new Float32Array(sim.x.length) // the pose on screen: the solver's state interpolated inside its last substep
    pose.set(sim.x)
    return {
      kind, mesh, sim, R, nV, index, bodyEnd, bodyVerts, fitPts, topCol, tipPts, mn, mx, ubo, pose,
      skinIdx: mesh.skinIdx, skinW: mesh.skinW, surface: mesh.sim.surface,
      bview: M.view, layout: M.layout,
      lookTarget: [0, 1, 2].map((k) => (mn[k] + mx[k]) / 2),
      eyeDir: eyeDirection(M.view),
      scr: new Float32Array(sim.n * 2), // pose particles in canvas CSS px (last projection)
      restScr: new Float32Array(sim.n * 2), // rest particles in canvas CSS px
      glideFrom: new Float32Array(sim.x.length),
      // skinning scratch (see skin()); a model with its own normals skins them instead (skinTextured)
      ...(R.normal ? normalSkinning(sim) : { skinP: new Float32Array(nV * 3), skinN: new Float32Array(nV * 3) }),
      index3: Uint32Array.from(index, (v) => 3 * v),
    }
  }

  // Per-tet rest frames for skinning a model's own normals (the bar's GLB normals): each frame, every
  // tet's deformation gradient F = Ds·Dm⁻¹ gives the cofactor matrix cof F = det F · F⁻ᵀ (it maps
  // normals); each particle averages its tets' (volume-weighted) and each render vertex blends its
  // four particles' with its skin weights (in the vertex shader). At rest F = I: the file's normals.
  function normalSkinning(s) {
    const tets = s.tets, nT = tets.length / 4, X = s.rest
    const dmInv = new Float64Array(nT * 9), tetW = new Float64Array(nT), partW = new Float64Array(s.n)
    for (let t = 0; t < nT; t++) {
      const a = 3 * tets[4 * t], b = 3 * tets[4 * t + 1], c = 3 * tets[4 * t + 2], d = 3 * tets[4 * t + 3]
      // Dm: columns = rest edges b − a, c − a, d − a
      const m00 = X[b] - X[a], m01 = X[c] - X[a], m02 = X[d] - X[a]
      const m10 = X[b + 1] - X[a + 1], m11 = X[c + 1] - X[a + 1], m12 = X[d + 1] - X[a + 1]
      const m20 = X[b + 2] - X[a + 2], m21 = X[c + 2] - X[a + 2], m22 = X[d + 2] - X[a + 2]
      const c00 = m11 * m22 - m12 * m21, c01 = m12 * m20 - m10 * m22, c02 = m10 * m21 - m11 * m20
      const det = m00 * c00 + m01 * c01 + m02 * c02
      const id = 1 / det, o = 9 * t
      // row-major inverse
      dmInv[o] = c00 * id; dmInv[o + 1] = (m02 * m21 - m01 * m22) * id; dmInv[o + 2] = (m01 * m12 - m02 * m11) * id
      dmInv[o + 3] = c01 * id; dmInv[o + 4] = (m00 * m22 - m02 * m20) * id; dmInv[o + 5] = (m02 * m10 - m00 * m12) * id
      dmInv[o + 6] = c02 * id; dmInv[o + 7] = (m01 * m20 - m00 * m21) * id; dmInv[o + 8] = (m00 * m11 - m01 * m10) * id
      tetW[t] = Math.abs(det) / 6
      for (let k = 0; k < 4; k++) partW[tets[4 * t + k]] += tetW[t]
    }
    for (let i = 0; i < s.n; i++) partW[i] = partW[i] > 0 ? 1 / partW[i] : 0
    return { skinP: null, skinN: null, dmInv, tetW, partW, partC: new Float64Array(s.n * 9), picked: null }
  }

  // the active body's parts, bound as plain locals (the per-frame code reads them directly)
  let body = null, sim, R, nV, skinIdx, skinW, index, bodyEnd, surface, bodyVerts, fitPts, topCol, tipPts
  let mn, mx, lookTarget, eyeDir, bview, layout, ubo, pose, scr, restScr, glideFrom, skinP, skinN, index3
  function bind(b) {
    body = b
    ;({ sim, R, nV, skinIdx, skinW, index, bodyEnd, surface, bodyVerts, fitPts, topCol, tipPts } = b)
    ;({ mn, mx, lookTarget, eyeDir, bview, layout, ubo, pose, scr, restScr, glideFrom, skinP, skinN, index3 } = b)
  }
  const bodies = { melon: null, bar: null }
  bodies[kind0] = makeBody(kind0, mesh0)
  bind(bodies[kind0])
  const H_SUB = sim.stepDt / sim.substeps // one solver substep (s), the same for both models

  // ── state ──
  let destroyed = false, lost = false, recoveries = 0
  let visible = true, running = false, raf = 0, last = 0
  let asleep = false, quiet = 0, dirty = true, shown = false, sizeDirty = true
  let cssW = 0, cssH = 0, dpr = 1, W = 0, H = 0
  const cam = { view: null, viewProj: null, invViewProj: null, pos: [0, 0, 0], fwd: [0, 0, -1] }
  const anchorLocal = { x: 0, y: 0 }
  const tipLocal = { x: 0, y: 0 }
  const scrBox = { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  let restOffPx = 0 // largest particle distance from rest on screen (CSS px, last projection)
  let projDirty = true
  let poseDirty = true // pose changed since the last skin() (a sweep-only frame skips skinning)
  // facet sweep: v = scroll target, l = eased progress (the uniform), t = noise drift clock,
  // pitch = lattice side and dir/off = the rest-space tip → rind coordinate (set by computeCamera)
  const sweep = { v: 0, l: 0, t: 0, pitch: 0.08, dir: [0, 0, 1], off: 0, force: null }

  // pacing state
  let frameIv = 1 / 60 // EMA of the display frame interval (s)
  let subCost = 0 // EMA of solver ms per substep (0 = not measured yet)
  let speed = 1 // sim seconds per wall second (< 1 only when the machine can't keep up)
  let lastSubsteps = 0, lastSimMs = 0
  // glide to rest before sleeping
  let gliding = false, glideT = 0, glideDur = 0.2

  function onStep(ke) {
    quiet = sim.grabbing || drag.active || !(ke < KE_QUIET) ? 0 : quiet + 1
  }

  // ── skinning: every render vertex (body, seeds, bubbles) follows its tetrahedron ──
  // Positions and area-weighted normals are built in compact float32 scratch arrays (stride 3,
  // index pre-multiplied by 3), then interleaved into renderer.dyn: the same float32 roundings as
  // writing dyn directly (bit-identical output), about 1.5× faster.
  function skin(x) {
    const P = skinP, N = skinN
    for (let v = 0; v < nV; v++) {
      const i4 = 4 * v, o = 3 * v
      const a = 3 * skinIdx[i4], b = 3 * skinIdx[i4 + 1], c = 3 * skinIdx[i4 + 2], d = 3 * skinIdx[i4 + 3]
      const w0 = skinW[i4], w1 = skinW[i4 + 1], w2 = skinW[i4 + 2], w3 = skinW[i4 + 3]
      P[o] = x[a] * w0 + x[b] * w1 + x[c] * w2 + x[d] * w3
      P[o + 1] = x[a + 1] * w0 + x[b + 1] * w1 + x[c + 1] * w2 + x[d + 1] * w3
      P[o + 2] = x[a + 2] * w0 + x[b + 2] * w1 + x[c + 2] * w2 + x[d + 2] * w3
    }
    N.fill(0)
    for (let t = 0; t < index3.length; t += 3) {
      const a = index3[t], b = index3[t + 1], c = index3[t + 2]
      const ax = P[a], ay = P[a + 1], az = P[a + 2]
      const e1x = P[b] - ax, e1y = P[b + 1] - ay, e1z = P[b + 2] - az
      const e2x = P[c] - ax, e2y = P[c + 1] - ay, e2z = P[c + 2] - az
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x
      N[a] += nx; N[a + 1] += ny; N[a + 2] += nz
      N[b] += nx; N[b + 1] += ny; N[b + 2] += nz
      N[c] += nx; N[c + 1] += ny; N[c + 2] += nz
    }
    const dyn = renderer.dyn
    for (let k = 0, o = 0; k < P.length; k += 3, o += 6) {
      const nx = N[k], ny = N[k + 1], nz = N[k + 2]
      const l2 = nx * nx + ny * ny + nz * nz
      const il = l2 > 0 ? 1 / Math.sqrt(l2) : 1
      dyn[o] = P[k]; dyn[o + 1] = P[k + 1]; dyn[o + 2] = P[k + 2]
      dyn[o + 3] = nx * il; dyn[o + 4] = ny * il; dyn[o + 5] = nz * il
    }
  }

  // ── skinning a model that brings its own normals (the bar's GLB), on the GPU: per particle its
  // position and the (volume-weighted mean) cofactor of its tets' deformation, 16 floats, into
  // renderer.parts; the vertex shader blends four of them per vertex. The file's normals are turned
  // by the local deformation instead of rebuilt from the triangles, which would crease every UV seam
  // (its vertices are split along its many texture islands) ──
  function skinTextured(x) {
    const { dmInv, tetW, partW, partC } = body
    const tets = sim.tets, nT = tets.length / 4
    partC.fill(0)
    for (let t = 0; t < nT; t++) {
      const a = 3 * tets[4 * t], b = 3 * tets[4 * t + 1], c = 3 * tets[4 * t + 2], d = 3 * tets[4 * t + 3]
      const e00 = x[b] - x[a], e01 = x[c] - x[a], e02 = x[d] - x[a]
      const e10 = x[b + 1] - x[a + 1], e11 = x[c + 1] - x[a + 1], e12 = x[d + 1] - x[a + 1]
      const e20 = x[b + 2] - x[a + 2], e21 = x[c + 2] - x[a + 2], e22 = x[d + 2] - x[a + 2]
      const o = 9 * t
      const q00 = dmInv[o], q01 = dmInv[o + 1], q02 = dmInv[o + 2]
      const q10 = dmInv[o + 3], q11 = dmInv[o + 4], q12 = dmInv[o + 5]
      const q20 = dmInv[o + 6], q21 = dmInv[o + 7], q22 = dmInv[o + 8]
      // F = Ds · Dm⁻¹ (row-major)
      const f00 = e00 * q00 + e01 * q10 + e02 * q20, f01 = e00 * q01 + e01 * q11 + e02 * q21, f02 = e00 * q02 + e01 * q12 + e02 * q22
      const f10 = e10 * q00 + e11 * q10 + e12 * q20, f11 = e10 * q01 + e11 * q11 + e12 * q21, f12 = e10 * q02 + e11 * q12 + e12 * q22
      const f20 = e20 * q00 + e21 * q10 + e22 * q20, f21 = e20 * q01 + e21 * q11 + e22 * q21, f22 = e20 * q02 + e21 * q12 + e22 * q22
      // cof F: row i = row (i+1) × row (i+2), weighted by the tet's rest volume
      const w = tetW[t]
      const c00 = (f11 * f22 - f12 * f21) * w, c01 = (f12 * f20 - f10 * f22) * w, c02 = (f10 * f21 - f11 * f20) * w
      const c10 = (f21 * f02 - f22 * f01) * w, c11 = (f22 * f00 - f20 * f02) * w, c12 = (f20 * f01 - f21 * f00) * w
      const c20 = (f01 * f12 - f02 * f11) * w, c21 = (f02 * f10 - f00 * f12) * w, c22 = (f00 * f11 - f01 * f10) * w
      for (let k = 0; k < 4; k++) {
        const p = 9 * tets[4 * t + k]
        partC[p] += c00; partC[p + 1] += c01; partC[p + 2] += c02
        partC[p + 3] += c10; partC[p + 4] += c11; partC[p + 5] += c12
        partC[p + 6] += c20; partC[p + 7] += c21; partC[p + 8] += c22
      }
    }
    // per particle: position, then the three cofactor rows (vec4 each)
    const out = renderer.parts
    for (let i = 0, p = 0, o = 0; i < sim.n; i++, p += 9, o += 16) {
      const s = partW[i]
      out[o] = x[3 * i]; out[o + 1] = x[3 * i + 1]; out[o + 2] = x[3 * i + 2]
      out[o + 4] = partC[p] * s; out[o + 5] = partC[p + 1] * s; out[o + 6] = partC[p + 2] * s
      out[o + 8] = partC[p + 3] * s; out[o + 9] = partC[p + 4] * s; out[o + 10] = partC[p + 5] * s
      out[o + 12] = partC[p + 6] * s; out[o + 13] = partC[p + 7] * s; out[o + 14] = partC[p + 8] * s
    }
    body.picked = null // the CPU copy of the positions (for picking) is out of date
  }

  // the GPU-skinned model's positions on the CPU, only when a pick needs them (as skin(), into dyn)
  function skinPositions(x) {
    if (body.picked === renderer.dyn) return
    const dyn = renderer.dyn
    for (let v = 0, o = 0; v < nV; v++, o += 6) {
      const i4 = 4 * v
      const a = 3 * skinIdx[i4], b = 3 * skinIdx[i4 + 1], c = 3 * skinIdx[i4 + 2], d = 3 * skinIdx[i4 + 3]
      const w0 = skinW[i4], w1 = skinW[i4 + 1], w2 = skinW[i4 + 2], w3 = skinW[i4 + 3]
      dyn[o] = x[a] * w0 + x[b] * w1 + x[c] * w2 + x[d] * w3
      dyn[o + 1] = x[a + 1] * w0 + x[b + 1] * w1 + x[c + 1] * w2 + x[d + 1] * w3
      dyn[o + 2] = x[a + 2] * w0 + x[b + 2] * w1 + x[c + 2] * w2 + x[d + 2] * w3
    }
    body.picked = dyn
  }

  // ── camera: fixed upright 3/4 view, distance and lens shift fitted to the layout rules ──
  function computeCamera() {
    const aspect = W / H
    const L = layout(cssW, cssH)
    const build = (dist) => {
      const eye = lookTarget.map((t, k) => t + eyeDir[k] * dist)
      const view = M4.lookAt(eye, lookTarget, bview.up ?? UPRIGHT.up)
      const proj = M4.perspective(bview.fov, aspect, dist * 0.2, dist * 6)
      return { eye, view, proj }
    }
    const bounds = (vp) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const p of fitPts) {
        const [nx, ny] = project(vp, p[0], p[1], p[2])
        x0 = Math.min(x0, nx); x1 = Math.max(x1, nx); y0 = Math.min(y0, ny); y1 = Math.max(y1, ny)
      }
      return { x0, y0, x1, y1 }
    }
    let dist = 9, c = null, b = null
    for (let it = 0; it < 4; it++) {
      c = build(dist)
      b = bounds(M4.mul(c.proj, c.view))
      const wpx = ((b.x1 - b.x0) / 2) * cssW, hpx = ((b.y1 - b.y0) / 2) * cssH
      dist *= Math.max(wpx / L.width, hpx / L.maxHeight)
    }
    c = build(dist)
    b = bounds(M4.mul(c.proj, c.view))
    // lens shift: the rest silhouette's centre lands on the layout centre
    const wantX = (L.cx / cssW) * 2 - 1, wantY = 1 - (L.cy / cssH) * 2
    c.proj[8] += (b.x0 + b.x1) / 2 - wantX
    c.proj[9] += (b.y0 + b.y1) / 2 - wantY
    cam.view = c.view
    cam.viewProj = M4.mul(c.proj, c.view)
    cam.invViewProj = M4.invert(cam.viewProj)
    cam.pos = c.eye
    const f = lookTarget.map((t, k) => t - c.eye[k])
    const fl = Math.hypot(...f)
    cam.fwd = f.map((v) => v / fl)
    // facet sweep basis: the rest-space direction that is screen-up (the view's up row),
    // scaled so the body spans a = 0 (tip) … 1 (rind)
    {
      const ux = c.view[1], uy = c.view[5], uz = c.view[9]
      let lo = Infinity, hi = -Infinity
      for (const v of bodyVerts) {
        const d = R.rest[3 * v] * ux + R.rest[3 * v + 1] * uy + R.rest[3 * v + 2] * uz
        if (d < lo) lo = d
        if (d > hi) hi = d
      }
      const span = hi - lo || 1
      sweep.dir = [ux / span, uy / span, uz / span]
      sweep.off = -lo / span
      // lattice side in rest units: FACET_PX at the fitted scale (desktop ≈ 0.079, phone ≈ 0.108)
      const pxPerUnit = (((b.x1 - b.x0) / 2) * cssW) / (mx[0] - mn[0])
      sweep.pitch = clamp(FACET_PX / pxPerUnit, 0.05, 0.12)
    }
    const toLocal = (p) => {
      const [nx, ny] = project(cam.viewProj, p[0], p[1], p[2])
      return [(nx * 0.5 + 0.5) * cssW, (0.5 - ny * 0.5) * cssH]
    }
    // eyes anchor: just above the top-most point of the rind's centre column, at rest
    let top = Infinity, tx = cssW / 2
    for (const p of topCol) {
      const [sx, sy] = toLocal(p)
      if (sy < top) { top = sy; tx = sx }
    }
    anchorLocal.x = tx
    anchorLocal.y = top - eyesGap(cssH)
    // tip anchor: the lowest point of the rest silhouette (the rounded tip), where juice drips from
    let bottom = -Infinity, bx = cssW / 2
    for (const p of tipPts) {
      const [sx, sy] = toLocal(p)
      if (sy > bottom) { bottom = sy; bx = sx }
    }
    tipLocal.x = bx
    tipLocal.y = bottom
    projectInto(sim.rest, restScr)
    projDirty = true
  }

  function syncSize() {
    const w = canvas.clientWidth, h = canvas.clientHeight
    const r = Math.min(window.devicePixelRatio || 1, 2)
    if (w === cssW && h === cssH && r === dpr) return false
    cssW = w; cssH = h; dpr = r
    if (!w || !h) return true
    W = Math.max(1, Math.round(w * r))
    H = Math.max(1, Math.round(h * r))
    canvas.width = W
    canvas.height = H
    computeCamera()
    return true
  }

  // ── canvas rect, cached; adjusted for scroll without forcing layout ──
  let rectCache = null, rectSX = 0, rectSY = 0
  const rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
  function getRect() {
    if (!rectCache) {
      rectCache = canvas.getBoundingClientRect()
      rectSX = window.scrollX
      rectSY = window.scrollY
    }
    const dx = window.scrollX - rectSX, dy = window.scrollY - rectSY, r = rectCache
    rect.left = r.left - dx; rect.right = r.right - dx
    rect.top = r.top - dy; rect.bottom = r.bottom - dy
    rect.width = r.width; rect.height = r.height
    return rect
  }
  const invalidateRect = () => { rectCache = null }

  // ── particles → CSS px (for hit tests, the render crop and the sleep test) ──
  function projectInto(x, out) {
    const M = cam.viewProj
    for (let i = 0; i < sim.n; i++) {
      const X = x[3 * i], Y = x[3 * i + 1], Z = x[3 * i + 2]
      const w = M[3] * X + M[7] * Y + M[11] * Z + M[15]
      out[2 * i] = ((M[0] * X + M[4] * Y + M[8] * Z + M[12]) / w * 0.5 + 0.5) * cssW
      out[2 * i + 1] = (0.5 - (M[1] * X + M[5] * Y + M[9] * Z + M[13]) / w * 0.5) * cssH
    }
  }
  function projectParticles() {
    if (!cam.viewProj) return
    projectInto(pose, scr)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, off2 = 0
    for (let i = 0; i < 2 * sim.n; i += 2) {
      const sx = scr[i], sy = scr[i + 1]
      if (sx < x0) x0 = sx
      if (sx > x1) x1 = sx
      if (sy < y0) y0 = sy
      if (sy > y1) y1 = sy
      const dx = sx - restScr[i], dy = sy - restScr[i + 1], d2 = dx * dx + dy * dy
      if (d2 > off2) off2 = d2
    }
    scrBox.minX = x0; scrBox.minY = y0; scrBox.maxX = x1; scrBox.maxY = y1
    restOffPx = Math.sqrt(off2)
    projDirty = false
  }

  // point in the projected silhouette of the sim mesh's boundary triangles (CSS px, canvas-local)
  function hitLocal(px, py) {
    if (projDirty) projectParticles()
    if (px < scrBox.minX || px > scrBox.maxX || py < scrBox.minY || py > scrBox.maxY) return false
    for (let t = 0; t < surface.length; t += 3) {
      const a = 2 * surface[t], b = 2 * surface[t + 1], c = 2 * surface[t + 2]
      const ax = scr[a], ay = scr[a + 1], bx = scr[b], by = scr[b + 1], cx = scr[c], cy = scr[c + 1]
      if ((px < ax && px < bx && px < cx) || (px > ax && px > bx && px > cx)) continue
      if ((py < ay && py < by && py < cy) || (py > ay && py > by && py > cy)) continue
      const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
      const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
      const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
      const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0
      if (!(neg && pos)) return true
    }
    return false
  }

  function hitTest(clientX, clientY) {
    if (destroyed || lost || !cam.viewProj || !visible) return false
    const r = getRect()
    return hitLocal(clientX - r.left, clientY - r.top)
  }

  // ── picking (from the artifact) ──
  // ray through a client point, into ray (o = ray[0..2], d = ray[3..5]); no allocation
  const ray = new Float64Array(9)
  function rayFrom(clientX, clientY) {
    const r = getRect()
    const nx = ((clientX - r.left) / r.width) * 2 - 1, ny = 1 - ((clientY - r.top) / r.height) * 2
    unproject(cam.invViewProj, nx, ny, 0, ray, 0)
    unproject(cam.invViewProj, nx, ny, 1, ray, 6)
    const dx = ray[6] - ray[0], dy = ray[7] - ray[1], dz = ray[8] - ray[2]
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz)
    ray[3] = dx / l; ray[4] = dy / l; ray[5] = dz / l
    return ray
  }

  function pick(rr) {
    if (body.dmInv) skinPositions(pose) // the bar is skinned on the GPU: its positions, for this pick
    const dyn = renderer.dyn
    let best = Infinity
    const o0 = rr[0], o1 = rr[1], o2 = rr[2], d0 = rr[3], d1 = rr[4], d2 = rr[5]
    for (let t = R.body.first; t < bodyEnd; t += 3) {
      const a = 6 * index[t], b = 6 * index[t + 1], c = 6 * index[t + 2]
      const e1x = dyn[b] - dyn[a], e1y = dyn[b + 1] - dyn[a + 1], e1z = dyn[b + 2] - dyn[a + 2]
      const e2x = dyn[c] - dyn[a], e2y = dyn[c + 1] - dyn[a + 1], e2z = dyn[c + 2] - dyn[a + 2]
      const px = d1 * e2z - d2 * e2y, py = d2 * e2x - d0 * e2z, pz = d0 * e2y - d1 * e2x
      const det = e1x * px + e1y * py + e1z * pz
      if (Math.abs(det) < 1e-12) continue
      const inv = 1 / det
      const tx = o0 - dyn[a], ty = o1 - dyn[a + 1], tz = o2 - dyn[a + 2]
      const uu = (tx * px + ty * py + tz * pz) * inv
      if (uu < 0 || uu > 1) continue
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x
      const vv = (d0 * qx + d1 * qy + d2 * qz) * inv
      if (vv < 0 || uu + vv > 1) continue
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv
      if (tt > 1e-4 && tt < best) best = tt
    }
    return best < Infinity ? [o0 + d0 * best, o1 + d1 * best, o2 + d2 * best] : null
  }

  // forgiving fallback for grabs that land just outside the rounded render surface
  function pickNear(clientX, clientY, maxPx) {
    if (projDirty) projectParticles()
    const r = getRect()
    const lx = clientX - r.left, ly = clientY - r.top
    let best = -1, bd = maxPx * maxPx
    for (let i = 0; i < sim.n; i++) {
      const d = (scr[2 * i] - lx) ** 2 + (scr[2 * i + 1] - ly) ** 2
      if (d < bd) { bd = d; best = i }
    }
    return best < 0 ? null : [pose[3 * best], pose[3 * best + 1], pose[3 * best + 2]]
  }

  // ── the hand tool ──
  // Pointer events only record where the hand is; the frame loop feeds it to the solver once
  // per frame (so a scroll or a twist while holding still moves the target, and the solver's
  // per-substep follower sees one consistent target per frame).
  const drag = { active: false, id: -1, type: '', plane: null, twist: 0, twist0: 0, second: null, lastX: 0, lastY: 0 }
  let grabFlag = false, grabFlagTimer = 0
  const handTarget = new Float64Array(3)
  const handRot = new Float64Array(9)

  function emit(type, e) {
    window.dispatchEvent(new CustomEvent(type, { detail: { clientX: e?.clientX ?? drag.lastX, clientY: e?.clientY ?? drag.lastY, pointerType: drag.type } }))
  }

  function applyGrab(clientX, clientY) {
    // keep the target inside the canvas, so the stretched jelly never leaves the hero
    const r = getRect()
    const m = 0.07 * Math.min(r.width, r.height)
    const cx = Math.min(Math.max(clientX, r.left + m), r.right - m)
    const cy = Math.min(Math.max(clientY, r.top + m), r.bottom - m)
    const rr = rayFrom(cx, cy)
    const p = drag.plane.p, n = drag.plane.n
    const den = rr[3] * n[0] + rr[4] * n[1] + rr[5] * n[2]
    if (Math.abs(den) < 1e-5) return
    const t = ((p[0] - rr[0]) * n[0] + (p[1] - rr[1]) * n[1] + (p[2] - rr[2]) * n[2]) / den
    handTarget[0] = rr[0] + rr[3] * t
    handTarget[1] = rr[1] + rr[4] * t
    handTarget[2] = rr[2] + rr[5] * t
    sim.moveGrab(handTarget, rotInto(handRot, cam.fwd, drag.twist))
  }

  function startGrab(e, hit) {
    wake() // first: a glide in progress hands its pose back to the solver before the patch is taken
    drag.active = true
    drag.id = e.pointerId
    drag.type = e.pointerType
    drag.lastX = e.clientX
    drag.lastY = e.clientY
    drag.twist = 0
    drag.second = null
    drag.plane = { p: hit, n: cam.fwd.slice() }
    sim.beginGrab(hit, GRAB_RADIUS)
    try { canvas.setPointerCapture(e.pointerId) } catch { /* synthetic pointer */ }
    clearTimeout(grabFlagTimer)
    grabFlag = true
    window.addEventListener('wheel', onWheel, { passive: false })
    emit('melon:grabstart', e)
  }

  function endGrab(e) {
    if (!drag.active) return
    sim.endGrab()
    drag.active = false
    drag.id = -1
    drag.second = null
    window.removeEventListener('wheel', onWheel)
    emit('melon:grabend', e)
    // stay "grabbing" until the click that ends this gesture has been dispatched,
    // so click handlers (stickers) can tell a grab from a click
    clearTimeout(grabFlagTimer)
    grabFlagTimer = setTimeout(() => { grabFlag = false }, 0)
    wake()
  }

  function onPointerDown(e) {
    if (drag.active) {
      // a second finger twists the held patch
      if (e.pointerType === 'touch' && e.pointerId !== drag.id && !drag.second) {
        drag.second = { id: e.pointerId }
        drag.twist0 = drag.twist - Math.atan2(e.clientY - drag.lastY, e.clientX - drag.lastX)
        try { canvas.setPointerCapture(e.pointerId) } catch { /* synthetic pointer */ }
        e.preventDefault()
      }
      return
    }
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return
    if (!hitTest(e.clientX, e.clientY)) return // not on the slice: leave the event to the page
    const rr = rayFrom(e.clientX, e.clientY)
    const hit = pick(rr) || pickNear(e.clientX, e.clientY, e.pointerType === 'touch' ? 34 : 18)
    if (!hit) return
    e.preventDefault()
    startGrab(e, hit)
  }

  function onPointerMove(e) {
    if (drag.second && e.pointerId === drag.second.id) {
      drag.twist = Math.max(-1.3, Math.min(1.3, drag.twist0 + Math.atan2(e.clientY - drag.lastY, e.clientX - drag.lastX)))
      return
    }
    if (!drag.active || e.pointerId !== drag.id) return
    drag.lastX = e.clientX
    drag.lastY = e.clientY
  }

  function onPointerEnd(e) {
    if (drag.second && e.pointerId === drag.second.id) { drag.second = null; return }
    if (drag.active && e.pointerId === drag.id) endGrab(e)
  }

  // wheel twists the held patch — only while a grab is active, otherwise the page scrolls
  function onWheel(e) {
    if (!drag.active) return
    e.preventDefault()
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
    drag.twist = Math.max(-1.3, Math.min(1.3, drag.twist + d * 0.004))
  }

  // touch: canvas is touch-action: pan-y; a touch that starts on the slice grabs instead of scrolling
  function onTouchStart(e) {
    if (drag.active) { e.preventDefault(); return }
    const t = e.changedTouches[0]
    if (t && hitTest(t.clientX, t.clientY)) e.preventDefault()
  }

  // a gentle squash-and-rebound (no net motion): used when the page is revealed
  function wobble(strength = 1) {
    if (destroyed || reduced) return
    wake()
    const s = 1.6 * strength, c = sim.centroid(), x = sim.x, v = sim.v
    for (let i = 0; i < sim.n; i++) {
      const k = 3 * i
      v[k] += 0.5 * s * (x[k] - c[0])
      v[k + 1] += 0.5 * s * (x[k + 1] - c[1])
      v[k + 2] -= s * (x[k + 2] - c[2])
    }
  }

  // ── render ──
  const crop = { x: 0, y: 0, w: 0, h: 0 }
  const cropM = new Float32Array(16), mvp = new Float32Array(16)
  let renderScale = 1
  // internal render scale for very large crops: coarse steps with a little hysteresis, so a
  // stretching slice doesn't change its sampling grid every frame (that read as shimmer)
  function cropScale(cw, ch) {
    const raw = Math.sqrt(MAX_RENDER_PIXELS / (cw * ch))
    if (raw >= 1) return (renderScale = 1)
    if (renderScale > raw || raw > renderScale + 1 / 16 + 0.02) renderScale = Math.max(0.25, Math.floor(raw * 16) / 16)
    return renderScale
  }

  function render() {
    if (!cam.viewProj || !W || !H || lost) return
    if (poseDirty) {
      if (body.dmInv) skinTextured(pose)
      else skin(pose)
      poseDirty = false
      renderer.dynDirty = true
    }
    if (projDirty) projectParticles()
    // crop: the slice's screen rectangle (device px), padded and snapped to a coarse grid
    const pad = 0.05 * Math.max(scrBox.maxX - scrBox.minX, scrBox.maxY - scrBox.minY) + 6
    const snap = 16
    const x0 = Math.max(0, Math.floor(((scrBox.minX - pad) * dpr) / snap) * snap)
    const y0 = Math.max(0, Math.floor(((scrBox.minY - pad) * dpr) / snap) * snap)
    const x1 = Math.min(W, Math.ceil(((scrBox.maxX + pad) * dpr) / snap) * snap)
    const y1 = Math.min(H, Math.ceil(((scrBox.maxY + pad) * dpr) / snap) * snap)
    const cw = x1 - x0, ch = y1 - y0
    if (cw < 2 || ch < 2) return
    const s = cropScale(cw, ch)
    const iw = Math.max(1, Math.round(cw * s)), ih = Math.max(1, Math.round(ch * s))
    renderer.ensureTargets(iw, ih, W, H)
    const capW = renderer.capW, capH = renderer.capH
    // projection cropped to that rectangle
    cropM[0] = W / cw; cropM[5] = H / ch; cropM[10] = 1; cropM[15] = 1
    cropM[12] = (W - 2 * x0 - cw) / cw
    cropM[13] = (ch - H + 2 * y0) / ch
    ubo.set(mul4(mvp, cropM, cam.viewProj), 0)
    ubo[16] = cam.pos[0]; ubo[17] = cam.pos[1]; ubo[18] = cam.pos[2]; ubo[19] = 0
    ubo[20] = cam.fwd[0]; ubo[21] = cam.fwd[1]; ubo[22] = cam.fwd[2]; ubo[23] = 0
    ubo[28] = capW; ubo[29] = capH; ubo[30] = 1 / capW; ubo[31] = 1 / capH
    ubo[32] = iw / capW; ubo[33] = ih / capH; ubo[34] = (W * s) / capW; ubo[35] = (H * s) / capH
    ubo[76] = sweep.l; ubo[77] = sweep.t; ubo[78] = sweep.pitch; ubo[79] = FACET_SLOPE
    ubo[80] = sweep.dir[0]; ubo[81] = sweep.dir[1]; ubo[82] = sweep.dir[2]; ubo[83] = sweep.off
    renderer.writeUniforms(ubo)
    crop.x = x0; crop.y = y0; crop.w = cw; crop.h = ch
    renderer.draw(crop, iw, ih)
    if (!shown) {
      shown = true
      canvas.dataset.ready = 'true'
    }
  }

  // ── facet sweep progress: viewport heights the canvas has scrolled away, through FACET_SWEEP ──
  function sweepTarget() {
    if (sweep.force != null) return sweep.force
    return rangeProgress(FACET_SWEEP, -getRect().top / Math.max(1, window.innerHeight))
  }
  // → true when this frame needs a render for the sweep alone
  function stepSweep(dt) {
    const v = sweepTarget(), before = sweep.l
    sweep.v = v
    if (reduced) sweep.l = v
    else {
      sweep.l += (v - sweep.l) * (1 - Math.exp(-dt / SWEEP_TAU))
      if (Math.abs(v - sweep.l) < 4e-4) sweep.l = v
    }
    const mid = sweep.l > 0 && sweep.l < 1
    if (mid && !reduced) sweep.t = (sweep.t + dt) % 1000
    return sweep.l !== before || (mid && !reduced)
  }
  // the loop keeps going while the sweep eases or its front drifts (lasmentes does the same)
  const sweepBusy = () => sweep.l !== sweep.v || (!reduced && sweep.l > 0 && sweep.l < 1)

  // ── loop ──
  // advance the solver by one display frame and interpolate the pose to show
  function simFrame(dt) {
    if (drag.active) applyGrab(drag.lastX, drag.lastY)
    // display interval estimate (hitches ignored) → the solver's share of it
    if (dt > 0) frameIv += (Math.min(dt, 0.05) - frameIv) * 0.1
    const budget = Math.min(SIM_SHARE * Math.max(frameIv, 1 / 60) * 1000, SIM_BUDGET_MAX)
    if (subCost > 0) {
      // the speed this machine can sustain inside the budget; eased, so a slow machine gets a
      // steady slow-motion instead of a jittery mix of fast and slow frames
      const need = (frameIv / H_SUB) * subCost
      const target = Math.min(1, budget / need)
      speed += (target - speed) * (target < speed ? 0.25 : 0.04)
      if (speed > 0.995) speed = 1
    }
    const t0 = performance.now()
    // hard stop at 1.5× budget: catching up after a hitch must not cause the next one
    const n = sim.advance(dt * speed, MAX_SUBSTEPS, 1.5 * budget)
    const ms = performance.now() - t0
    if (n > 0) {
      // robust: a frame the OS preempted (or a GC pause) counts at most 2× the running cost
      const c = ms / n
      subCost = subCost > 0 ? subCost + (Math.min(c, 2 * subCost) - subCost) * 0.05 : Math.min(c, 2)
    }
    lastSubsteps = n
    lastSimMs = ms
    sim.lerp(sim.alpha, pose)
    poseDirty = true
    projectParticles()
    // sleep test: still for a while and (almost) back on its rest pose
    if (quiet >= SLEEP_STEPS && !drag.active) {
      const off = restOffPx * dpr
      if (off < SLEEP_PX || (quiet >= SLEEP_STEPS_LONG && off < SLEEP_PX_LONG) || quiet >= SLEEP_STEPS_FORCE) startGlide(off)
    }
  }

  // the last bit of the way to rest is a short eased blend, then the solver snaps to rest
  // (invisible: the pose on screen already is the rest pose) and the loop stops
  function startGlide(offPx) {
    gliding = true
    glideT = 0
    glideDur = clamp(0.15 + offPx / 60, 0.15, 0.6)
    glideFrom.set(pose)
  }
  function glideFrame(dt) {
    glideT += dt
    const u = Math.min(1, glideT / glideDur), e = u * u * (3 - 2 * u)
    const rest = sim.rest
    for (let i = 0; i < pose.length; i++) pose[i] = glideFrom[i] + (rest[i] - glideFrom[i]) * e
    projDirty = true
    poseDirty = true
    if (u >= 1) {
      gliding = false
      sim.reset()
      pose.set(sim.x)
      quiet = 0
      asleep = true
      dirty = true // draw the rest pose once more before the loop stops
    }
  }

  function frame(now) {
    raf = 0
    if (!canRun()) { running = false; return }
    let dt = (now - last) / 1000
    last = now
    dt = dt > 0 ? Math.min(dt, MAX_FRAME_DT) : 0
    invalidateRect()
    if (sizeDirty) {
      sizeDirty = false
      if (syncSize()) dirty = true
    }
    if (gliding) glideFrame(dt)
    else if (!asleep) simFrame(dt)
    const sweepDraw = stepSweep(dt)
    if (!asleep || dirty || sweepDraw) {
      render()
      dirty = false
    }
    if (asleep && !sweepBusy()) { running = false; return }
    raf = requestAnimationFrame(frame)
  }

  const canRun = () => !destroyed && !lost && visible && !document.hidden
  function ensureRunning() {
    if (running || !canRun()) return
    running = true
    last = performance.now()
    raf = requestAnimationFrame(frame)
  }
  function wake() {
    if (gliding) {
      // hand the pose on screen back to the solver, so nothing jumps
      gliding = false
      sim.x.set(pose)
      sim.prev.set(pose)
      sim.v.fill(0)
    }
    poseDirty = true
    asleep = false
    quiet = 0
    ensureRunning()
  }

  // ── observers ──
  const io = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1].isIntersecting
    if (visible) ensureRunning()
  })
  io.observe(canvas)
  const ro = new ResizeObserver(() => {
    invalidateRect()
    sizeDirty = true
    dirty = true
    ensureRunning()
  })
  ro.observe(canvas)
  const onVisibility = () => { if (!document.hidden) ensureRunning() }
  // textures that arrive after their model was first drawn (see Renderer.addModel)
  function redraw() { dirty = true; ensureRunning() }
  renderer.onTextures = redraw
  document.addEventListener('visibilitychange', onVisibility)
  // scrolling drives the facet sweep: a sleeping loop must pick it up (a frame with nothing to do
  // renders nothing and stops again)
  const onScroll = () => ensureRunning()
  window.addEventListener('scroll', onScroll, { passive: true })
  // devicePixelRatio changes (zoom, moving to another screen) don't always resize the canvas box
  let dprQuery = null
  const watchDpr = () => {
    dprQuery?.removeEventListener('change', onDpr)
    dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    dprQuery.addEventListener('change', onDpr)
  }
  function onDpr() { sizeDirty = true; dirty = true; ensureRunning(); watchDpr() }
  watchDpr()

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerEnd)
  canvas.addEventListener('pointercancel', onPointerEnd)
  canvas.addEventListener('lostpointercapture', onPointerEnd)
  canvas.addEventListener('touchstart', onTouchStart, { passive: false })

  // a little squash when the intro lifts and the slice is first seen
  let introObs = null
  const root = document.documentElement
  if (root.classList.contains('is-intro')) {
    introObs = new MutationObserver(() => {
      if (root.classList.contains('is-intro')) return
      introObs.disconnect()
      introObs = null
      setTimeout(() => wobble(0.8), 120)
    })
    introObs.observe(root, { attributes: true, attributeFilter: ['class'] })
  }

  // ── a lost GPU device gets two attempts at a clean rebuild, then the static fallback ──
  function fail(err) {
    if (destroyed) return
    lost = true
    console.warn('[melon] WebGPU renderer unavailable:', err?.message || err)
    onFail?.(err)
  }
  function watchDevice(device) {
    device.addEventListener?.('uncapturederror', (e) => console.error('[melon] webgpu:', e.error?.message))
    device.lost.then((info) => {
      if (destroyed || info.reason === 'destroyed') return
      lost = true
      if (drag.active) endGrab()
      if (recoveries++ >= 2) return fail(new Error(info.message || 'device lost'))
      restoreGPU().catch(fail)
    })
  }
  async function restoreGPU() {
    const g = await initGPU(canvas)
    if (destroyed) { g.device.destroy(); return }
    let r
    try {
      // every model built so far, so a later theme change still swaps without waiting
      const models = { melon: bodies.melon?.mesh.render, bar: bodies.bar?.mesh.render }
      r = await Renderer.create(g.device, g.context, g.format, models, body.kind)
    } catch (err) {
      g.device.destroy()
      throw err
    }
    if (destroyed) { r.destroy(); g.device.destroy(); return }
    gpu = g
    renderer = r
    renderer.backing = BACKING
    renderer.onTextures = redraw
    watchDevice(g.device)
    lost = false
    dirty = true
    poseDirty = true // the new renderer has a fresh dyn buffer
    ensureRunning()
    if (want !== body.kind) show(want, { instant: true })
  }
  watchDevice(gpu.device)

  // ── the two models: swap on a theme change, build the other one in the background ──
  let want = body.kind // the model the theme asks for (may still be building)
  const building = { melon: null, bar: null }
  const ready = { melon: null, bar: null } // a built mesh waiting for an idle moment to be set up
  const buildAc = new AbortController()
  // idle-time callbacks (the intro is playing while the other model is prepared)
  const idleCancels = new Set()
  const idle = (fn) => {
    let cancel
    const run = () => { idleCancels.delete(cancel); fn() }
    if (window.requestIdleCallback) {
      const id = window.requestIdleCallback(run, { timeout: 2500 })
      cancel = () => window.cancelIdleCallback(id)
    } else {
      const id = setTimeout(run, 1200)
      cancel = () => clearTimeout(id)
    }
    idleCancels.add(cancel)
  }
  function loadModel(kind) {
    if (bodies[kind] || building[kind] || destroyed) return
    building[kind] = buildMeshAsync(buildAc.signal, kind, want === kind ? 'high' : 'low')
      .then((mesh) => new Promise((resolve) => {
        // the solver set-up (~20 ms) runs on the main thread: at an idle moment, unless it is wanted now
        const finish = () => {
          ready[kind] = null
          if (!destroyed && !bodies[kind]) {
            bodies[kind] = makeBody(kind, mesh)
            if (!lost) renderer.addModel(kind, mesh.render)
            if (want === kind) show(kind, { instant: true })
          }
          resolve()
        }
        if (want === kind) finish()
        else {
          ready[kind] = finish
          idle(() => ready[kind]?.())
        }
      }))
      .catch((err) => {
        if (err?.name !== 'AbortError') console.warn(`[melon] could not build the ${kind}:`, err?.message || err)
      })
      .finally(() => { building[kind] = null })
  }

  // Shows the model of `kind`. `instant` (inside the theme's view transition): the new model takes
  // its place at once, drawn before this returns; otherwise it lands with a small squash.
  function show(kind, { instant = false } = {}) {
    want = kind
    if (destroyed) return
    const b = bodies[kind]
    if (!b) {
      // shown as soon as it is built (at once if it only waits for an idle moment)
      if (ready[kind]) ready[kind]()
      else loadModel(kind)
      return
    }
    if (b === body || lost) return // after a lost device, restoreGPU() applies `want`
    if (!renderer.hasModel(kind)) renderer.addModel(kind, b.mesh.render)
    if (drag.active) endGrab()
    gliding = false
    b.sim.reset() // a model always comes back at rest
    bind(b)
    renderer.setModel(kind)
    pose.set(sim.x)
    if (cssW && cssH) computeCamera() // fit, anchors, sweep basis and rest projection of this model
    quiet = 0
    asleep = true
    poseDirty = true
    projDirty = true
    dirty = true
    if (canRun()) {
      render()
      dirty = false
    }
    if (!instant && !reduced) wobble(0.55)
    ensureRunning()
  }
  const offTheme = onThemeChange((theme, { instant }) => show(themeKind(theme), { instant }))

  // the other theme's model: built once the page is idle (the intro is playing), then kept
  idle(() => loadModel(kind0 === 'bar' ? 'melon' : 'bar'))
  // the theme may have changed while the first model was being built
  if (themeKind(getTheme()) !== kind0) show(themeKind(getTheme()), { instant: true })

  sizeDirty = false
  syncSize()
  // a reload part-way down the page starts on the current sweep, not sweeping in
  sweep.l = sweep.v = sweepTarget()
  ensureRunning()

  const instance = {
    mode: 'webgpu',
    hitTest,
    isGrabbing: () => grabFlag,
    get model() { return body.kind },
    // client px just above the top-centre of the rind (the bar: its top edge, over the middle of
    // the bar), at rest pose (follows scroll / resize)
    getEyesAnchor() {
      if (destroyed || !cssW) return null
      const r = canvas.getBoundingClientRect()
      return { x: r.left + anchorLocal.x, y: r.top + anchorLocal.y }
    },
    // client px of the slice's tip (lowest point of the rest silhouette; the bar: its bottom-right
    // corner, where the milk drop forms); follows scroll / resize
    getTipAnchor() {
      if (destroyed || !cssW) return null
      const r = canvas.getBoundingClientRect()
      return { x: r.left + tipLocal.x, y: r.top + tipLocal.y }
    },
    wobble,
    destroy() {
      if (destroyed) return
      if (drag.active) endGrab()
      destroyed = true
      cancelAnimationFrame(raf)
      clearTimeout(grabFlagTimer)
      grabFlag = false
      for (const b of Object.values(bodies)) if (b) b.sim.onStep = null
      offTheme()
      for (const cancel of idleCancels) cancel()
      idleCancels.clear()
      buildAc.abort()
      io.disconnect()
      ro.disconnect()
      introObs?.disconnect()
      dprQuery?.removeEventListener('change', onDpr)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerEnd)
      canvas.removeEventListener('pointercancel', onPointerEnd)
      canvas.removeEventListener('lostpointercapture', onPointerEnd)
      canvas.removeEventListener('touchstart', onTouchStart)
      delete canvas.dataset.ready
      renderer.destroy()
      gpu.device.destroy()
    },
  }
  if (import.meta.env?.DEV) {
    // dev-only handle for inspection; kick() restarts the loop (e.g. after swapping rAF in a background tab)
    window.__melon = {
      instance, cam, get renderer() { return renderer },
      // the active model's solver and on-screen pose (they change with the theme)
      get sim() { return sim }, get pose() { return pose }, get model() { return body.kind },
      bodies, show,
      // facet sweep: setSweep(l) pins the progress (0..1), setSweep(null) hands it back to scroll
      sweep, setSweep(l) { sweep.force = l == null ? null : clamp(l, 0, 1); ensureRunning() },
      layout: () => ({ cssW, cssH, dpr, W, H, anchorLocal, tipLocal, scrBox, asleep, running, visible }),
      pacing: () => ({ frameIv, subCost, speed, lastSubsteps, lastSimMs, quiet, gliding, asleep, restOffPx, renderScale }),
      kick() { cancelAnimationFrame(raf); running = false; dirty = true; wake() },
    }
  }
  return instance
}
