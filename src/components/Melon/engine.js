// ─────────────────────────────────────────────────────────────
//  The melon engine: soft body ↔ renderer glue, camera and framing,
//  picking and the hand tool, visibility / resize / sleep handling.
//
//  createMelonEngine(canvas, { onFail, signal }) → Promise<instance>
//  instance: hitTest(x, y), isGrabbing(), getEyesAnchor(), wobble(), destroy()
//  Window events: 'melon:grabstart', 'melon:grabend' (detail: { clientX, clientY, pointerType }).
// ─────────────────────────────────────────────────────────────
import { buildMelon, SHAPE } from './geometry.js'
import { SoftBody } from './softbody.js'
import { Renderer } from './renderer.js'
import { UBO_FLOATS } from './shaders.js'
import { M4, project, rotMat } from './math.js'
import { BACKING, BACKING_DISPLAY, EXPOSURE, KEY_DIR, KEY_INTENSITY, ROSE, STUDIO } from './palette.js'
import { UPRIGHT, VIEW, eyeDirection, eyesGap, layoutTarget } from './framing.js'

// Physics tuning (artifact defaults: firmness 0.40, damping 0.45). Slightly firmer so the
// upright slice snaps back crisply, slightly less edge damping so it stays lively; the
// settle drag replaces the energy the artifact's floor friction used to take out.
// A tip pulled out by half the slice snaps back with ~4 visible overshoots, still in ~1.6 s.
const TUNING = { firmness: 0.42, damping: 0.38, settleRate: 3.0, returnRate: 7, lockRate: 60, pinStiffness: 600, maxReach: 2.0 }
// reduced motion: the artifact's 0.65 damping, and the wobble dies out sooner
const TUNING_REDUCED = { ...TUNING, damping: 0.65, settleRate: 6 }

const GRAB_RADIUS = 0.4
const MAX_RENDER_PIXELS = 2.6e6 // cap for the off-screen crop; beyond it the crop renders at lower res

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' })

// ── the meshes, built in a worker so the main thread (and the intro) stays smooth ──
function buildMeshAsync(signal) {
  return new Promise((resolve, reject) => {
    const local = () => setTimeout(() => {
      if (signal.aborted) return reject(abortError())
      try { resolve(buildMelon()) } catch (err) { reject(err) }
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
    worker.postMessage(null)
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
    const gpuP = initGPU(canvas)
    const meshP = buildMeshAsync(ac.signal)
    meshP.catch(() => {}) // awaited below; don't report an early abort as unhandled
    gpu = await gpuP
    const mesh = await meshP
    if (ac.signal.aborted) throw abortError()
    const renderer = await Renderer.create(gpu.device, gpu.context, gpu.format, mesh.render)
    if (ac.signal.aborted) {
      renderer.destroy()
      throw abortError()
    }
    try {
      return startEngine(canvas, mesh, gpu, renderer, { onFail })
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

function startEngine(canvas, mesh, gpuIn, rendererIn, { onFail }) {
  let gpu = gpuIn
  let renderer = rendererIn
  renderer.backing = BACKING
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  const sim = new SoftBody(mesh.sim, reduced ? TUNING_REDUCED : TUNING)

  const R = mesh.render
  const nV = R.rest.length / 3
  const { skinIdx, skinW } = mesh
  const index = R.index
  const bodyEnd = R.body.first + R.body.count
  const surface = mesh.sim.surface

  // rest-pose sample points: framing uses the visible body, the eyes the rind's top-centre column
  const bodyVerts = new Set()
  for (let t = R.body.first; t < bodyEnd; t++) bodyVerts.add(index[t])
  const fitPts = [], topCol = []
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]
  for (const v of bodyVerts) {
    const p = [R.rest[3 * v], R.rest[3 * v + 1], R.rest[3 * v + 2]]
    for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]) }
    if (v % 3 === 0) fitPts.push(p)
    if (Math.abs(p[0]) < 0.04 && p[2] > SHAPE.Ro - 0.3) topCol.push(p)
  }
  const lookTarget = [0, 1, 2].map((k) => (mn[k] + mx[k]) / 2)
  const eyeDir = eyeDirection()

  // ── uniforms that never change ──
  const ubo = new Float32Array(UBO_FLOATS)
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

  // ── state ──
  let destroyed = false, lost = false, recoveries = 0
  let visible = true, running = false, raf = 0, last = 0, acc = 0
  let asleep = false, quiet = 0, dirty = true, shown = false
  let cssW = 0, cssH = 0, dpr = 1, W = 0, H = 0
  const cam = { view: null, viewProj: null, invViewProj: null, pos: [0, 0, 0], fwd: [0, 0, -1] }
  const anchorLocal = { x: 0, y: 0 }
  const scr = new Float32Array(sim.n * 2) // particles in canvas CSS px (last projection)
  const scrBox = { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  let projDirty = true

  // ── skinning: every render vertex (body, seeds, bubbles) follows its tetrahedron ──
  function skin() {
    const x = sim.x, dyn = renderer.dyn
    for (let v = 0; v < nV; v++) {
      const i4 = 4 * v, o = 6 * v
      const a = 3 * skinIdx[i4], b = 3 * skinIdx[i4 + 1], c = 3 * skinIdx[i4 + 2], d = 3 * skinIdx[i4 + 3]
      const w0 = skinW[i4], w1 = skinW[i4 + 1], w2 = skinW[i4 + 2], w3 = skinW[i4 + 3]
      dyn[o] = x[a] * w0 + x[b] * w1 + x[c] * w2 + x[d] * w3
      dyn[o + 1] = x[a + 1] * w0 + x[b + 1] * w1 + x[c + 1] * w2 + x[d + 1] * w3
      dyn[o + 2] = x[a + 2] * w0 + x[b + 2] * w1 + x[c + 2] * w2 + x[d + 2] * w3
      dyn[o + 3] = 0; dyn[o + 4] = 0; dyn[o + 5] = 0
    }
    for (let t = 0; t < index.length; t += 3) {
      const a = 6 * index[t], b = 6 * index[t + 1], c = 6 * index[t + 2]
      const e1x = dyn[b] - dyn[a], e1y = dyn[b + 1] - dyn[a + 1], e1z = dyn[b + 2] - dyn[a + 2]
      const e2x = dyn[c] - dyn[a], e2y = dyn[c + 1] - dyn[a + 1], e2z = dyn[c + 2] - dyn[a + 2]
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x
      dyn[a + 3] += nx; dyn[a + 4] += ny; dyn[a + 5] += nz
      dyn[b + 3] += nx; dyn[b + 4] += ny; dyn[b + 5] += nz
      dyn[c + 3] += nx; dyn[c + 4] += ny; dyn[c + 5] += nz
    }
    for (let o = 0; o < dyn.length; o += 6) {
      const l = Math.hypot(dyn[o + 3], dyn[o + 4], dyn[o + 5]) || 1
      dyn[o + 3] /= l; dyn[o + 4] /= l; dyn[o + 5] /= l
    }
  }

  // ── camera: fixed upright 3/4 view, distance and lens shift fitted to the layout rules ──
  function computeCamera() {
    const aspect = W / H
    const L = layoutTarget(cssW, cssH)
    const build = (dist) => {
      const eye = lookTarget.map((t, k) => t + eyeDir[k] * dist)
      const view = M4.lookAt(eye, lookTarget, UPRIGHT.up)
      const proj = M4.perspective(VIEW.fov, aspect, dist * 0.2, dist * 6)
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
    // eyes anchor: just above the top-most point of the rind's centre column, at rest
    let top = Infinity, tx = cssW / 2
    for (const p of topCol) {
      const [nx, ny] = project(cam.viewProj, p[0], p[1], p[2])
      const sy = (0.5 - ny * 0.5) * cssH
      if (sy < top) { top = sy; tx = (nx * 0.5 + 0.5) * cssW }
    }
    anchorLocal.x = tx
    anchorLocal.y = top - eyesGap(cssH)
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
  function getRect() {
    if (!rectCache) {
      rectCache = canvas.getBoundingClientRect()
      rectSX = window.scrollX
      rectSY = window.scrollY
    }
    const dx = window.scrollX - rectSX, dy = window.scrollY - rectSY
    if (!dx && !dy) return rectCache
    const r = rectCache
    return { left: r.left - dx, top: r.top - dy, right: r.right - dx, bottom: r.bottom - dy, width: r.width, height: r.height }
  }
  const invalidateRect = () => { rectCache = null }

  // ── particles → CSS px (for hit tests and the render crop) ──
  function projectParticles() {
    if (!cam.viewProj) return
    const M = cam.viewProj, x = sim.x
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let i = 0; i < sim.n; i++) {
      const X = x[3 * i], Y = x[3 * i + 1], Z = x[3 * i + 2]
      const w = M[3] * X + M[7] * Y + M[11] * Z + M[15]
      const sx = ((M[0] * X + M[4] * Y + M[8] * Z + M[12]) / w * 0.5 + 0.5) * cssW
      const sy = (0.5 - (M[1] * X + M[5] * Y + M[9] * Z + M[13]) / w * 0.5) * cssH
      scr[2 * i] = sx; scr[2 * i + 1] = sy
      if (sx < x0) x0 = sx
      if (sx > x1) x1 = sx
      if (sy < y0) y0 = sy
      if (sy > y1) y1 = sy
    }
    scrBox.minX = x0; scrBox.minY = y0; scrBox.maxX = x1; scrBox.maxY = y1
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
  function rayFrom(clientX, clientY) {
    const r = getRect()
    const nx = ((clientX - r.left) / r.width) * 2 - 1, ny = 1 - ((clientY - r.top) / r.height) * 2
    const m = cam.invViewProj
    const un = (x, y, z) => {
      const w = m[3] * x + m[7] * y + m[11] * z + m[15]
      return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w]
    }
    const a = un(nx, ny, 0), b = un(nx, ny, 1)
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const l = Math.hypot(...d)
    return { o: a, d: d.map((v) => v / l) }
  }

  function pick(ray) {
    const dyn = renderer.dyn
    let best = Infinity
    const { o, d } = ray
    for (let t = R.body.first; t < bodyEnd; t += 3) {
      const a = 6 * index[t], b = 6 * index[t + 1], c = 6 * index[t + 2]
      const e1x = dyn[b] - dyn[a], e1y = dyn[b + 1] - dyn[a + 1], e1z = dyn[b + 2] - dyn[a + 2]
      const e2x = dyn[c] - dyn[a], e2y = dyn[c + 1] - dyn[a + 1], e2z = dyn[c + 2] - dyn[a + 2]
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x
      const det = e1x * px + e1y * py + e1z * pz
      if (Math.abs(det) < 1e-12) continue
      const inv = 1 / det
      const tx = o[0] - dyn[a], ty = o[1] - dyn[a + 1], tz = o[2] - dyn[a + 2]
      const uu = (tx * px + ty * py + tz * pz) * inv
      if (uu < 0 || uu > 1) continue
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x
      const vv = (d[0] * qx + d[1] * qy + d[2] * qz) * inv
      if (vv < 0 || uu + vv > 1) continue
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv
      if (tt > 1e-4 && tt < best) best = tt
    }
    return best < Infinity ? [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best] : null
  }

  // forgiving fallback for grabs that land just outside the rounded render surface
  function pickNear(clientX, clientY, maxPx) {
    if (projDirty) projectParticles()
    const r = getRect(), x = sim.x
    const lx = clientX - r.left, ly = clientY - r.top
    let best = -1, bd = maxPx * maxPx
    for (let i = 0; i < sim.n; i++) {
      const d = (scr[2 * i] - lx) ** 2 + (scr[2 * i + 1] - ly) ** 2
      if (d < bd) { bd = d; best = i }
    }
    return best < 0 ? null : [x[3 * best], x[3 * best + 1], x[3 * best + 2]]
  }

  // ── the hand tool ──
  const drag = { active: false, id: -1, type: '', plane: null, twist: 0, twist0: 0, second: null, lastX: 0, lastY: 0 }
  let grabFlag = false, grabFlagTimer = 0

  function emit(type, e) {
    window.dispatchEvent(new CustomEvent(type, { detail: { clientX: e?.clientX ?? drag.lastX, clientY: e?.clientY ?? drag.lastY, pointerType: drag.type } }))
  }

  function applyGrab(clientX, clientY) {
    // keep the target inside the canvas, so the stretched jelly never leaves the hero
    const r = getRect()
    const m = 0.07 * Math.min(r.width, r.height)
    const cx = Math.min(Math.max(clientX, r.left + m), r.right - m)
    const cy = Math.min(Math.max(clientY, r.top + m), r.bottom - m)
    const ray = rayFrom(cx, cy)
    const { p, n } = drag.plane
    const den = ray.d[0] * n[0] + ray.d[1] * n[1] + ray.d[2] * n[2]
    if (Math.abs(den) < 1e-5) return
    const t = ((p[0] - ray.o[0]) * n[0] + (p[1] - ray.o[1]) * n[1] + (p[2] - ray.o[2]) * n[2]) / den
    const q = [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t]
    sim.moveGrab(q, rotMat(cam.fwd, drag.twist))
  }

  function startGrab(e, hit) {
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
    wake()
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
    const hit = pick(rayFrom(e.clientX, e.clientY)) || pickNear(e.clientX, e.clientY, e.pointerType === 'touch' ? 34 : 18)
    if (!hit) return
    e.preventDefault()
    startGrab(e, hit)
  }

  function onPointerMove(e) {
    if (drag.second && e.pointerId === drag.second.id) {
      drag.twist = Math.max(-1.3, Math.min(1.3, drag.twist0 + Math.atan2(e.clientY - drag.lastY, e.clientX - drag.lastX)))
      applyGrab(drag.lastX, drag.lastY)
      return
    }
    if (!drag.active || e.pointerId !== drag.id) return
    drag.lastX = e.clientX
    drag.lastY = e.clientY
    applyGrab(e.clientX, e.clientY)
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
    applyGrab(drag.lastX, drag.lastY)
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
    const s = 1.6 * strength, c = sim.centroid(), x = sim.x, v = sim.v
    for (let i = 0; i < sim.n; i++) {
      const k = 3 * i
      v[k] += 0.5 * s * (x[k] - c[0])
      v[k + 1] += 0.5 * s * (x[k + 1] - c[1])
      v[k + 2] -= s * (x[k + 2] - c[2])
    }
    wake()
  }

  // ── loop ──
  function render() {
    if (!cam.viewProj || !W || !H || lost) return
    skin()
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
    const s = Math.min(1, Math.sqrt(MAX_RENDER_PIXELS / (cw * ch)))
    const iw = Math.max(1, Math.round(cw * s)), ih = Math.max(1, Math.round(ch * s))
    renderer.ensureTargets(iw, ih, W, H)
    const capW = renderer.capW, capH = renderer.capH
    // projection cropped to that rectangle
    const C = new Float32Array(16)
    C[0] = W / cw; C[5] = H / ch; C[10] = 1; C[15] = 1
    C[12] = (W - 2 * x0 - cw) / cw
    C[13] = (ch - H + 2 * y0) / ch
    ubo.set(M4.mul(C, cam.viewProj), 0)
    ubo.set([...cam.pos, 0], 16)
    ubo.set([...cam.fwd, 0], 20)
    ubo.set([capW, capH, 1 / capW, 1 / capH], 28)
    ubo.set([iw / capW, ih / capH, (W * s) / capW, (H * s) / capH], 32)
    renderer.writeUniforms(ubo)
    renderer.draw({ x: x0, y: y0, w: cw, h: ch }, iw, ih)
    if (!shown) {
      shown = true
      canvas.dataset.ready = 'true'
    }
  }

  function stepSim() {
    const ke = sim.step()
    projDirty = true
    if (sim.grabbing) { quiet = 0; return }
    quiet = ke < 1e-6 && sim.maxOffset() < 2e-3 ? quiet + 1 : 0
    if (quiet > 30) {
      // fully settled: snap to the rest pose and stop simulating until something happens
      sim.reset()
      asleep = true
      quiet = 0
    }
  }

  function frame(now) {
    raf = 0
    if (!canRun()) { running = false; return }
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
    invalidateRect()
    if (syncSize()) dirty = true
    let moved = false
    if (!asleep) {
      acc += dt
      let steps = 0
      while (acc >= sim.stepDt && steps < 3) { stepSim(); acc -= sim.stepDt; steps++; moved = true }
      if (steps === 3) acc = Math.min(acc, sim.stepDt)
    }
    if (moved || dirty) {
      render()
      dirty = false
    }
    if (asleep) { running = false; return }
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
    dirty = true
    ensureRunning()
  })
  ro.observe(canvas)
  const onVisibility = () => { if (!document.hidden) ensureRunning() }
  document.addEventListener('visibilitychange', onVisibility)
  // devicePixelRatio changes (zoom, moving to another screen) don't always resize the canvas box
  let dprQuery = null
  const watchDpr = () => {
    dprQuery?.removeEventListener('change', onDpr)
    dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    dprQuery.addEventListener('change', onDpr)
  }
  function onDpr() { dirty = true; ensureRunning(); watchDpr() }
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
      r = await Renderer.create(g.device, g.context, g.format, mesh.render)
    } catch (err) {
      g.device.destroy()
      throw err
    }
    if (destroyed) { r.destroy(); g.device.destroy(); return }
    gpu = g
    renderer = r
    renderer.backing = BACKING
    watchDevice(g.device)
    lost = false
    dirty = true
    ensureRunning()
  }
  watchDevice(gpu.device)

  syncSize()
  ensureRunning()

  const instance = {
    mode: 'webgpu',
    hitTest,
    isGrabbing: () => grabFlag,
    getEyesAnchor() {
      if (destroyed || !cssW) return null
      const r = canvas.getBoundingClientRect()
      return { x: r.left + anchorLocal.x, y: r.top + anchorLocal.y }
    },
    wobble,
    destroy() {
      if (destroyed) return
      if (drag.active) endGrab()
      destroyed = true
      cancelAnimationFrame(raf)
      clearTimeout(grabFlagTimer)
      grabFlag = false
      io.disconnect()
      ro.disconnect()
      introObs?.disconnect()
      dprQuery?.removeEventListener('change', onDpr)
      document.removeEventListener('visibilitychange', onVisibility)
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
      instance, sim, cam, get renderer() { return renderer },
      layout: () => ({ cssW, cssH, dpr, W, H, anchorLocal, scrBox, asleep, running, visible }),
      kick() { cancelAnimationFrame(raf); running = false; dirty = true; wake() },
    }
  }
  return instance
}
