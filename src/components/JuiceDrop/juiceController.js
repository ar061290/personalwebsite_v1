// Imperative engine behind <JuiceDrop>: the scroll-scrubbed drop (a small
// Canvas2D sprite) and the stain it leaves (WebGL wicking sim, Canvas2D
// fallback), plus their choreography.
//
// Screen-space path (s = scrollY, H = viewport height, all reversible):
//   s ∈ [dripForm]      a bead swells under the melon's tip and rides up with
//                       the hero (it hangs from the slice).
//   s = sDet            (CHOREO.dripDetach) it pinches off at screen height yDet.
//   s ∈ [sDet, sImp]    it falls: screen y = yDet + (yImp − yDet)·u^2.2, with
//                       u = (s − sDet)/(sImp − sDet). On screen it is nearly
//                       pinned at first and then accelerates down, so it never
//                       moves up while the page scrolls up; relative to the
//                       page it falls at least as fast as the page scrolls.
//                       x drifts from the tip to the marker.
//   s = sImp            the marker (impactRef) has risen to yImp, exactly
//                       where the drop is: impact. yImp = yDet + 8.5vh,
//                       clamped to 50–82% of the viewport, so impact happens
//                       with the marker comfortably on screen.
//   s > sImp            squash, puddle soaks in, stain spreads (time-based).
//   back above sImp − 3vh: the stain fades out (0.5 s) and resets, the drop
//                       scrubs back up the same path and re-forms the bead.
//
// Dark theme (src/lib/theme.js): the same choreography in milk — a white drop
// from the chocolate bar's tip (same getMelonTipAnchor), a creamy bloom
// screened over the black paper. A theme change redraws both canvases at once.

import { CHOREO, clamp01 } from '../../lib/scrollChoreo.js'
import { getMelonTipAnchor } from '../../lib/melonBus.js'
import { loadPaperHeight } from '../../assets/paper/index.js'
import { STAIN, deriveStain, stepsAt } from './stainModel.js'
import { createGlStain } from './stainGL.js'
import { createCpuStainRenderer } from './stainCpu.js'
import { JUICE, MILK, paintDrop } from './dropRenderer.js'
import { getTheme, onThemeChange } from '../../lib/theme.js'

const DPR_CAP = 2
const BOX = { w: 128, h: 168, ox: 64, oy: 108 } // drop canvas (CSS px) and the drop's centre in it
const TIP_FRAC = 0.8 // tip estimate: this far down the hero while the melon has no anchor
const IMPACT_GAP = 0.085 // vh the drop drops on screen before impact
const IMPACT_MIN = 0.5 // impact band, fraction of viewport height
const IMPACT_MAX = 0.82
const MIN_FALL = 0.3 // vh of scrolling the fall takes at the very least
const HYST = 0.03 // vh above the impact before the stain resets
const FALL_EASE = 2.2
const THREAD_VH = 0.028 // the liquid bridge snaps after this much scroll past detach
const REMNANT_VH = 0.07 // the bead left on the tip retracts by here
const SQUASH_S = 0.1
const LENS_IN = [0.05, 0.16]
const SOAK = [0.14, 0.85]
const FADE_OUT_S = 0.5
const FADE_IN_S = 0.6
const MAX_STEPS = { gpu: 240, cpu: 50 }
const FF_STEPS = { gpu: 900, cpu: 160 }

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const lerp = (a, b, t) => a + (b - a) * t

/**
 * @param {object} o
 * @param {HTMLCanvasElement} o.dropCanvas
 * @param {HTMLElement} o.stainHost        absolutely positioned in .home
 * @param {() => HTMLElement|null} o.getImpactEl
 */
export function createJuice({ dropCanvas, stainHost, getImpactEl }) {
  const docEl = document.documentElement
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  let destroyed = false
  let active = false
  let raf = 0
  let clock = null // debug: manual clock (seconds)
  const now = () => (clock ? clock() : performance.now() / 1000)
  let lastT = now()
  let lastScrollT = -1
  let milk = getTheme() === 'dark'

  // ── drop state ──
  const dctx = dropCanvas.getContext('2d')
  let dropDpr = 0
  let dropMode = null
  let dropShown = false
  let prevDocY = null
  let vSmooth = 0
  let e = 1, ev = 0 // stretch spring
  let q = 0, qv = 0 // wobble spring
  let impacted = false
  let tImpact = 0
  let impactPoint = null // marker (doc px) at impact

  // ── stain state ──
  let paper = undefined // undefined = loading, null = failed
  let renderer = null
  let rendererKind = null
  let stainCanvas = null
  let stain = null // { cfg, t0, phase, ff, dry, opacity, target, origin }
  let pendingStart = null
  let reducedShown = false
  let stainTf = ''

  loadPaperHeight().then(
    (p) => {
      paper = p
      wake()
    },
    () => {
      paper = null
      wake()
    },
  )

  function ensureRenderer() {
    if (renderer || paper === undefined) return renderer
    const make = (kind) => {
      const c = document.createElement('canvas')
      c.className = 'juice-stain__canvas'
      stainHost.appendChild(c)
      let r = null
      try {
        r = kind === 'gpu' ? createGlStain(c, paper) : createCpuStainRenderer(c, paper)
      } catch (err) {
        console.warn('[juice] stain init failed:', err)
        r = null
      }
      if (!r) {
        c.remove()
        return null
      }
      stainCanvas = c
      rendererKind = kind
      if (kind === 'gpu') {
        c.addEventListener('webglcontextlost', onContextLost)
      }
      return r
    }
    renderer = make('gpu') || make('cpu')
    return renderer
  }

  function onContextLost(ev) {
    ev.preventDefault?.()
    // Fall back to the CPU stain; replay to wherever we were.
    const was = stain
    try {
      renderer?.destroy()
    } catch {
      /* gone */
    }
    stainCanvas?.removeEventListener('webglcontextlost', onContextLost)
    stainCanvas?.remove()
    renderer = null
    stainCanvas = null
    stain = null
    paper = paper ?? null
    const r = (() => {
      const c = document.createElement('canvas')
      c.className = 'juice-stain__canvas'
      stainHost.appendChild(c)
      const cpu = createCpuStainRenderer(c, paper)
      if (!cpu) c.remove()
      else stainCanvas = c
      return cpu
    })()
    renderer = r
    rendererKind = r ? 'cpu' : null
    if (was && was.phase !== 'fading' && was.phase !== 'none') pendingStart = { instant: true }
    wake()
  }

  // ── layout ──
  function estimateTip(sx, sy, W, H) {
    const hero = document.querySelector('.hero')
    if (hero) {
      const r = hero.getBoundingClientRect()
      return { x: r.left + r.width / 2 + sx, y: r.top + sy + r.height * TIP_FRAC }
    }
    return { x: W / 2 + sx, y: H * TIP_FRAC }
  }

  function layout() {
    const impactEl = getImpactEl()
    if (!impactEl) return null
    const H = window.innerHeight || 1
    const W = docEl.clientWidth || window.innerWidth
    const sx = window.scrollX, sy = window.scrollY
    const m = impactEl.getBoundingClientRect()
    const marker = { x: m.left + m.width / 2 + sx, y: m.top + m.height / 2 + sy }
    let tip = null
    try {
      const a = getMelonTipAnchor()
      if (a && Number.isFinite(a.x) && Number.isFinite(a.y)) tip = { x: a.x + sx, y: a.y + sy }
    } catch {
      tip = null
    }
    if (!tip) tip = estimateTip(sx, sy, W, H)
    const R = clamp(W * 0.0105, 12, 17.5) // the drop as drawn: big enough to notice
    const Rs = clamp(W * 0.0062, 7, 10.5) // the drop the stain is seeded from: sets the spread, keep
    const hang = R * 1.05
    const sDet = CHOREO.dripDetach * H
    const yDet = tip.y + hang - sDet
    let yImp = Math.max(clamp(yDet + IMPACT_GAP * H, IMPACT_MIN * H, IMPACT_MAX * H), yDet + 4)
    let sImp = marker.y - yImp
    if (sImp < sDet + MIN_FALL * H) {
      sImp = sDet + MIN_FALL * H
      yImp = marker.y - sImp
    }
    const maxScroll = docEl.scrollHeight - H
    if (sImp > maxScroll - 1) {
      sImp = Math.max(sDet + 1, maxScroll - 1)
      yImp = marker.y - sImp
    }
    return { H, W, sx, sy, R, Rs, hang, tip, marker, sDet, yDet, yImp, sImp, radius: clamp(W * 0.14, 120, 210) }
  }

  function containingBlock() {
    const cb = stainHost.offsetParent
    if (!cb) return { x: 0, y: 0 }
    const r = cb.getBoundingClientRect()
    return { x: r.left + window.scrollX, y: r.top + window.scrollY }
  }

  // ── stain lifecycle ──
  function startStain(L, t, instant) {
    if (stain && stain.phase === 'fading' && stain.opacity > 0.5) {
      // came straight back down: keep the stain that is there
      stain.phase = stain.resume
      stain.target = 1
      return
    }
    const r = ensureRenderer()
    if (!r) {
      pendingStart = { instant, t }
      return
    }
    pendingStart = null
    const rCells = rendererKind === 'gpu' ? STAIN.rCellsGpu : STAIN.rCellsCpu
    const cfg = deriveStain({ radiusPx: L.radius, dropRadiusPx: L.Rs, rCells })
    const origin = [L.marker.x - cfg.extentPx / 2, L.marker.y - cfg.extentPx / 2]
    const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1)
    const res = rendererKind === 'gpu' ? dpr : r.resolution
    const px = Math.max(1, Math.round(cfg.extentPx * res))
    if (stainCanvas.width !== px) {
      stainCanvas.width = px
      stainCanvas.height = px
    }
    stainHost.style.width = `${cfg.extentPx}px`
    stainHost.style.height = `${cfg.extentPx}px`
    r.start(cfg, origin)
    stain = {
      cfg,
      t0: t,
      phase: instant ? 'ff' : 'spreading',
      resume: 'spreading',
      instant,
      dry: instant ? 1 : 0,
      opacity: instant ? 0 : 1,
      target: 1,
      origin,
      res,
      dirty: true,
    }
    stainHost.style.opacity = String(stain.opacity)
  }

  function fadeStain() {
    if (!stain || stain.phase === 'fading' || stain.phase === 'none') return
    stain.resume = stain.phase === 'ff' ? 'ff' : stain.phase
    stain.phase = 'fading'
    stain.target = 0
  }

  // returns true while it needs more frames
  function updateStain(L, t, dt) {
    if (pendingStart && paper !== undefined) {
      startStain(L, pendingStart.t ?? t, pendingStart.instant)
    }
    if (!stain || !renderer) return !!pendingStart
    const cfg = stain.cfg
    let busy = false
    const kind = rendererKind === 'gpu' ? 'gpu' : 'cpu'

    if (stain.phase === 'ff') {
      const n = Math.min(FF_STEPS[kind], cfg.totalSteps - renderer.stepsDone)
      if (n > 0) renderer.step(n)
      if (renderer.stepsDone >= cfg.totalSteps) {
        stain.phase = 'static'
        stain.dry = 1
        stain.dirty = true
        stain.target = 1
      }
      busy = true
    } else if (stain.phase === 'spreading' || (stain.phase === 'fading' && stain.resume === 'spreading')) {
      const age = t - stain.t0
      const target = Math.min(cfg.totalSteps, stepsAt(cfg, age))
      const n = Math.min(MAX_STEPS[kind], target - renderer.stepsDone)
      if (n > 0) {
        renderer.step(n)
        stain.dirty = true
      }
      const dry = clamp01((age - STAIN.dryStart) / STAIN.drySeconds)
      if (dry !== stain.dry) {
        stain.dry = dry
        stain.dirty = true
      }
      if (renderer.stepsDone >= cfg.totalSteps && dry >= 1) {
        if (stain.phase === 'spreading') stain.phase = 'static'
        else stain.resume = 'static'
      }
      busy = true
    }

    // opacity
    if (stain.phase !== 'ff') {
      const rate = dt / (stain.target > stain.opacity ? (stain.instant ? FADE_IN_S : 0.18) : FADE_OUT_S)
      const o = stain.target > stain.opacity ? Math.min(stain.target, stain.opacity + rate) : Math.max(stain.target, stain.opacity - rate)
      if (o !== stain.opacity) {
        stain.opacity = o
        stainHost.style.opacity = String(o)
        busy = true
      }
      if (stain.phase === 'fading' && o <= 0) {
        renderer.clear()
        stain = null
        stainHost.style.opacity = '0'
        return false
      }
    }

    // keep registered to the marker
    const origin = [L.marker.x - cfg.extentPx / 2, L.marker.y - cfg.extentPx / 2]
    const cb = containingBlock()
    const tf = `translate3d(${origin[0] - cb.x}px, ${origin[1] - cb.y}px, 0)`
    if (tf !== stainTf) {
      stainTf = tf
      stainHost.style.transform = tf
    }
    if (Math.abs(origin[0] - stain.origin[0]) > 0.25 || Math.abs(origin[1] - stain.origin[1]) > 0.25) {
      stain.origin = origin
      stain.dirty = true
    }
    if (stain.dirty && stain.phase !== 'ff') {
      renderer.render(stain.dry, stain.origin, stain.res, milk)
      stain.dirty = false
    }
    return busy
  }

  // ── drop ──
  function sizeDropCanvas() {
    const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1)
    if (dpr === dropDpr) return
    dropDpr = dpr
    dropCanvas.width = Math.round(BOX.w * dpr)
    dropCanvas.height = Math.round(BOX.h * dpr)
  }

  function hideDrop() {
    if (!dropShown) return
    dropShown = false
    dropCanvas.style.visibility = 'hidden'
  }

  function placeDrop(fixed, x, y) {
    if (fixed) {
      if (dropCanvas.style.position !== 'fixed') dropCanvas.style.position = 'fixed'
      dropCanvas.style.transform = `translate3d(${x - BOX.ox}px, ${y - BOX.oy}px, 0)`
    } else {
      const cb = containingBlock()
      if (dropCanvas.style.position !== 'absolute') dropCanvas.style.position = 'absolute'
      dropCanvas.style.transform = `translate3d(${x - cb.x - BOX.ox}px, ${y - cb.y - BOX.oy}px, 0)`
    }
    if (!dropShown) {
      dropShown = true
      dropCanvas.style.visibility = 'visible'
    }
  }

  function draw(d) {
    sizeDropCanvas()
    dctx.setTransform(dropDpr, 0, 0, dropDpr, 0, 0)
    dctx.clearRect(0, 0, BOX.w, BOX.h)
    paintDrop(dctx, d, milk ? MILK : JUICE)
  }

  // returns true while it needs more frames
  function updateDrop(L, t, dt) {
    const s = L.sy
    const H = L.H
    if (impacted) {
      dropMode = 'puddle'
      prevDocY = null
      const age = t - tImpact
      if (age >= SOAK[1]) {
        hideDrop()
        return false
      }
      // squash: flatten and widen in ~0.1 s with a little overshoot
      const k = clamp01(age / SQUASH_S)
      const ease = 1 - Math.pow(1 - k, 3)
      const ring = Math.sin(k * Math.PI) * 0.12
      const sx = lerp(1, 1.75, ease) + ring
      const sy = lerp(1, 0.42, ease) - ring * 0.6
      const lens = smooth(LENS_IN[0], LENS_IN[1], age)
      const soak = smooth(SOAK[0], SOAK[1], age)
      const p = impactPoint || L.marker
      placeDrop(false, p.x, p.y)
      draw({ mode: 'puddle', R: L.R, x: BOX.ox, y: BOX.oy, sx, sy, lens, soak, puddle: STAIN.puddleScale })
      return true
    }

    if (s < L.sDet) {
      // the bead swells under the tip
      const [f0, f1] = CHOREO.dripForm
      const pf = clamp01((s / H - f0) / Math.max(1e-6, Math.min(f1, CHOREO.dripDetach) - f0))
      e = 1; ev = 0; q = 0; qv = 0; vSmooth = 0; prevDocY = null
      if (pf <= 0.001) {
        hideDrop()
        dropMode = null
        return false
      }
      const grow = 1 - Math.pow(1 - pf, 2)
      const sag = pf * pf
      const tipX = L.tip.x - L.sx, tipY = L.tip.y - s
      const sy = 1 + 0.2 * sag
      const sx = 1 / Math.sqrt(sy)
      const x = tipX
      const y = tipY + L.hang * grow * (0.8 + 0.2 * sag)
      placeDrop(true, x, y)
      draw({
        mode: 'bead', R: L.R, grow, sx, sy, m: 0.3 + 0.6 * sag, alpha: 1,
        x: BOX.ox, y: BOX.oy, tipX: BOX.ox + (tipX - x), tipY: BOX.oy + (tipY - y) - 2,
        neckW: L.R * (0.7 - 0.35 * sag),
      })
      dropMode = 'bead'
      return false
    }

    // falling
    const u = clamp01((s - L.sDet) / Math.max(1, L.sImp - L.sDet))
    const y = L.yDet + Math.max(0, L.yImp - L.yDet) * Math.pow(u, FALL_EASE)
    const x = lerp(L.tip.x, L.marker.x, smooth(0, 1, u)) - L.sx
    if (dropMode === 'bead') qv += 4.5 // let-go wobble
    dropMode = 'fall'

    const docY = y + s
    if (prevDocY !== null && dt > 0) {
      const v = (docY - prevDocY) / dt
      vSmooth += (v - vSmooth) * (1 - Math.exp(-dt / 0.06))
    }
    prevDocY = docY
    if (t - lastScrollT > 0.12) vSmooth *= Math.exp(-dt / 0.08)

    const eT = 1 + 0.55 * clamp01(Math.abs(vSmooth) / 2600)
    const w1 = Math.PI * 2 * 4.5, z1 = 0.32
    ev += (-w1 * w1 * (e - eT) - 2 * z1 * w1 * ev) * dt
    e = clamp(e + ev * dt, 0.8, 1.8)
    const w2 = Math.PI * 2 * 6.5, z2 = 0.18
    qv += (-w2 * w2 * q - 2 * z2 * w2 * qv) * dt
    q = clamp(q + qv * dt, -0.25, 0.25)

    const tipX = L.tip.x - L.sx, tipY = L.tip.y - s
    const past = (s - L.sDet) / H
    const thread = 1 - clamp01(past / THREAD_VH)
    const remnant = past > THREAD_VH ? L.R * 0.34 * (1 - smooth(THREAD_VH, REMNANT_VH, past)) : thread > 0 ? L.R * 0.3 : 0
    placeDrop(true, x, y)
    draw({
      mode: 'fall', R: L.R, x: BOX.ox, y: BOX.oy,
      sx: (1 + q) / Math.sqrt(e), sy: Math.sqrt(e) / (1 + q),
      m: 0.12 + 1.1 * clamp01((e - 1) / 0.5),
      alpha: 1, near: smooth(0.7, 1, u),
      thread, remnant: past > THREAD_VH ? remnant : 0,
      tipX: BOX.ox + (tipX - x), tipY: BOX.oy + (tipY - y) - 1,
    })
    const settled = Math.abs(e - eT) < 1e-3 && Math.abs(ev) < 1e-2 && Math.abs(q) < 1e-3 && Math.abs(qv) < 1e-2 && Math.abs(vSmooth) < 5
    return !settled
  }

  // ── frame ──
  function frame() {
    const t = now()
    const dt = clamp(t - lastT, 0, 0.05)
    lastT = t
    const L = layout()
    if (!L) return false
    let busy = false

    if (!active) {
      hideDrop()
      return updateStain(L, t, dt)
    }

    if (reduced?.matches) {
      hideDrop()
      const my = L.marker.y - L.sy
      if (!reducedShown && my < L.H * 0.95 && my > -L.H * 0.5) {
        reducedShown = true
        startStain(L, t, true)
      }
      return updateStain(L, t, dt)
    }

    // impact / un-impact
    if (!impacted && L.sy >= L.sImp) {
      impacted = true
      tImpact = t
      impactPoint = { ...L.marker }
      // landing without having seen the fall (a jump past it, a restored
      // scroll position) shows the stain straight away
      const late = dropMode === null || (L.sy - L.sImp > L.H * 0.9 && dropMode !== 'fall')
      startStain(L, t, late)
      if (late) tImpact = t - SOAK[1]
    } else if (impacted && L.sy < L.sImp - HYST * L.H) {
      impacted = false
      impactPoint = null
      fadeStain()
    }
    if (impacted && impactPoint) {
      // stay registered to the marker if the layout moved
      impactPoint = { ...L.marker }
    }

    busy = updateDrop(L, t, dt) || busy
    busy = updateStain(L, t, dt) || busy
    return busy || t - lastScrollT < 0.15
  }

  function tick() {
    raf = 0
    if (destroyed) return
    let more = false
    try {
      more = frame()
    } catch (err) {
      console.warn('[juice] frame failed:', err)
      more = false
    }
    if (more) wake()
  }

  function wake() {
    if (!raf && !destroyed && !clock) raf = requestAnimationFrame(tick)
  }

  const onScroll = () => {
    lastScrollT = now()
    wake()
  }
  const onResize = () => wake()
  // New look straight away (a theme switch pictures the new page once, inside
  // a view transition): repaint the drop and the stain synchronously.
  const offTheme = onThemeChange((theme) => {
    const next = theme === 'dark'
    if (next === milk) return
    milk = next
    if (stain) stain.dirty = true
    if (destroyed) return
    lastScrollT = now()
    try {
      if (frame() && !clock) wake()
    } catch (err) {
      console.warn('[juice] theme redraw failed:', err)
    }
    if (stain && renderer && stain.phase === 'ff') {
      // mid fast-forward: nothing is shown yet, it renders when done
      return
    }
    if (stain && renderer && stain.dirty) {
      renderer.render(stain.dry, stain.origin, stain.res, milk)
      stain.dirty = false
    }
  })
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onResize)
  reduced?.addEventListener?.('change', onResize)
  let ro = null
  try {
    ro = new ResizeObserver(onResize)
    ro.observe(document.body)
  } catch {
    ro = null
  }

  const api = {
    setActive(v) {
      active = !!v
      wake()
    },
    destroy() {
      destroyed = true
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      offTheme()
      reduced?.removeEventListener?.('change', onResize)
      ro?.disconnect()
      stainCanvas?.removeEventListener('webglcontextlost', onContextLost)
      try {
        renderer?.destroy()
      } catch {
        /* ignore */
      }
      renderer = null
      stainCanvas?.remove()
      stainCanvas = null
      stain = null
      if (window.__juice === api.debug) delete window.__juice
    },
    debug: null,
  }

  if (import.meta.env?.DEV) {
    api.debug = {
      get state() {
        return { active, impacted, tImpact, dropMode, rendererKind, stain: stain && { ...stain, cfg: undefined, steps: renderer?.stepsDone, total: stain.cfg.totalSteps }, layout: layout() }
      },
      /** Drive time by hand (seconds); pass null to go back to real time. */
      setClock(fn) {
        clock = fn
        lastT = now()
        if (!fn) wake()
      },
      frame: () => {
        lastScrollT = now()
        return frame()
      },
      canvases: () => ({ drop: dropCanvas, stain: stainCanvas, stainHost }),
      setActive: (v) => api.setActive(v),
      render() {
        if (stain && renderer) renderer.render(stain.dry, stain.origin, stain.res, milk)
      },
    }
    window.__juice = api.debug
  }

  return api
}
