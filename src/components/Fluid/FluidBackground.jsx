/*
 * Fluid ink background.
 *
 * Ported from lumina-cursor's SplashCursor
 *   https://github.com/sebastianvasquezechavarria1234/lumina-cursor
 *   MIT License, (c) Sebastian Vasquez Echavarria
 * which is based on WebGL-Fluid-Simulation
 *   https://github.com/PavelDoGreat/WebGL-Fluid-Simulation
 *   MIT License, (c) 2017 Pavel Dobryakov
 *
 * The solver is unchanged; colour and compositing were reworked for rose ink
 * on a white page (see fluidSim.js / shaders.js).
 */
import { useEffect, useRef, useState } from 'react'
import { FLUID_DEFAULTS } from './fluidConfig.js'
import { createFluidSim } from './fluidSim.js'

// Canvases whose context we deliberately lost on unmount; a remount on the
// same element (StrictMode) needs a fresh <canvas> instead.
const retiredCanvases = new WeakSet()

const TAP_MAX_MOVE = 10
const TAP_MAX_MS = 350

/**
 * Full-viewport WebGL fluid that follows the pointer. Renders a bare canvas;
 * the parent positions it (fixed, inset 0, pointer-events none, z-index).
 *
 * @param {string}  className
 * @param {boolean} [active=true]   pauses the sim and ignores input while false
 * @param {number}  [revealSplats=0] random splats fired when `active` turns true
 *                                    (the original has no opening burst, so off)
 * @param {object}  overrides        any FLUID_DEFAULTS key (fluidConfig.js), e.g. CURL={20}
 */
export default function FluidBackground({ className, active = true, revealSplats = 0, ...overrides }) {
  const canvasRef = useRef(null)
  const simRef = useRef(null)
  const configRef = useRef(FLUID_DEFAULTS)
  const activeRef = useRef(active)
  const revealRef = useRef(revealSplats)
  const wasActiveRef = useRef(false)
  const pendingSplatsRef = useRef(0)
  // Bumped to remount the canvas after a context loss.
  const [epoch, setEpoch] = useState(0)

  // Live config, read by the sim every frame (no re-init on prop changes).
  // An explicit `undefined` prop falls back to the default instead of NaN.
  useEffect(() => {
    const config = { ...FLUID_DEFAULTS }
    for (const [key, value] of Object.entries(overrides)) if (value !== undefined) config[key] = value
    configRef.current = config
    revealRef.current = revealSplats
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    // A decorative layer must never take the page down: a driver/GL failure
    // during init just leaves the canvas empty.
    let created
    try {
      created = createFluidSim(canvas, () => configRef.current)
    } catch (err) {
      console.warn('[fluid] init failed:', err)
      return undefined
    }
    const { sim, error } = created
    if (!sim) {
      if (error === 'lost' && retiredCanvases.has(canvas)) setEpoch((n) => n + 1)
      return undefined
    }
    simRef.current = sim
    sim.setActive(activeRef.current)
    flushPendingSplats(simRef, pendingSplatsRef)

    const passive = { passive: true }
    let tap = null
    // Touch goes through touch events where they exist; otherwise (e.g. some
    // desktop browsers with touch screens) pointer events handle it too.
    const viaTouchEvents = (e) => e.pointerType === 'touch' && 'ontouchstart' in window

    const onPointerMove = (e) => {
      if (!viaTouchEvents(e)) sim.pointerMove(e.clientX, e.clientY)
    }
    const onPointerDown = (e) => {
      if (viaTouchEvents(e) || !e.isPrimary || e.button !== 0) return
      sim.pointerDown(e.clientX, e.clientY, { burst: configRef.current.CLICK_INTENSITY > 0 })
    }
    const onPointerUp = (e) => {
      if (!viaTouchEvents(e)) sim.pointerUp()
    }
    // Touch uses touch events (like the original) because pointer events get
    // cancelled as soon as the page starts scrolling.
    const onTouchStart = (e) => {
      const t = e.touches[0]
      if (!t) return
      sim.pointerDown(t.clientX, t.clientY)
      tap = e.touches.length === 1 ? { x: t.clientX, y: t.clientY, time: performance.now() } : null
    }
    const onTouchMove = (e) => {
      const t = e.touches[0]
      if (!t) return
      sim.pointerMove(t.clientX, t.clientY)
      if (tap && Math.hypot(t.clientX - tap.x, t.clientY - tap.y) > TAP_MAX_MOVE) tap = null
    }
    const onTouchEnd = (e) => {
      if (e.touches.length) return
      sim.pointerUp()
      // A tap (not a scroll) bursts, as the original did via the emulated mousedown.
      if (tap && performance.now() - tap.time < TAP_MAX_MS && configRef.current.CLICK_INTENSITY > 0) sim.burst()
      tap = null
    }
    const onMouseOut = (e) => {
      if (!e.relatedTarget) sim.pointerLeave()
    }
    const onVisibility = () => {
      sim.syncVisibility()
      flushPendingSplats(simRef, pendingSplatsRef)
    }
    const onLayoutChange = () => sim.invalidateRect()
    const onContextLost = (e) => {
      e.preventDefault() // allow the browser to restore it
      sim.setActive(false)
    }
    const onContextRestored = () => setEpoch((n) => n + 1)

    window.addEventListener('pointermove', onPointerMove, passive)
    window.addEventListener('pointerdown', onPointerDown, passive)
    window.addEventListener('pointerup', onPointerUp, passive)
    window.addEventListener('touchstart', onTouchStart, passive)
    window.addEventListener('touchmove', onTouchMove, passive)
    window.addEventListener('touchend', onTouchEnd, passive)
    window.addEventListener('touchcancel', onTouchEnd, passive)
    window.addEventListener('mouseout', onMouseOut, passive)
    window.addEventListener('blur', sim.pointerLeave)
    window.addEventListener('resize', onLayoutChange, passive)
    window.addEventListener('scroll', onLayoutChange, { passive: true, capture: true })
    document.addEventListener('visibilitychange', onVisibility)
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('webglcontextrestored', onContextRestored)
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(onLayoutChange) : null
    resizeObserver?.observe(canvas)

    return () => {
      window.removeEventListener('pointermove', onPointerMove, passive)
      window.removeEventListener('pointerdown', onPointerDown, passive)
      window.removeEventListener('pointerup', onPointerUp, passive)
      window.removeEventListener('touchstart', onTouchStart, passive)
      window.removeEventListener('touchmove', onTouchMove, passive)
      window.removeEventListener('touchend', onTouchEnd, passive)
      window.removeEventListener('touchcancel', onTouchEnd, passive)
      window.removeEventListener('mouseout', onMouseOut, passive)
      window.removeEventListener('blur', sim.pointerLeave)
      window.removeEventListener('resize', onLayoutChange, passive)
      window.removeEventListener('scroll', onLayoutChange, { capture: true })
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
      resizeObserver?.disconnect()
      if (simRef.current === sim) simRef.current = null
      sim.destroy()
      retiredCanvases.add(canvas)
    }
  }, [epoch])

  useEffect(() => {
    activeRef.current = active
    simRef.current?.setActive(active)
    if (active && !wasActiveRef.current && revealRef.current > 0) {
      pendingSplatsRef.current = revealRef.current
      flushPendingSplats(simRef, pendingSplatsRef)
    }
    wasActiveRef.current = active
    // Reset so a StrictMode remount replays the reveal on the replacement sim.
    return () => {
      wasActiveRef.current = false
    }
  }, [active])

  return <canvas key={epoch} ref={canvasRef} className={className} aria-hidden="true" />
}

function flushPendingSplats(simRef, pendingRef) {
  const amount = pendingRef.current
  if (amount > 0 && simRef.current?.randomSplats(amount)) pendingRef.current = 0
}
