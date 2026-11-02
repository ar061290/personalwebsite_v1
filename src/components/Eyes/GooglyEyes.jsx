import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { getMelonEyesAnchor } from '../../lib/melonBus.js'
import './GooglyEyes.css'

// Geometry and follow logic cloned from the Framer "eyes" component
// (56×36 frame, 24×36 eyes, 16×22 pupils, pupils travel at most 10px).
const MAX_OFFSET = 10
const EYES_H = 36
const HERO_SCALE = 1.6

const clamp01 = (v) => Math.min(1, Math.max(0, v))
const lerp = (a, b, t) => a + (b - a) * t
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

function Eye({ pupilRef }) {
  return (
    <div className="googly__eye">
      <div className="googly__pupil-track">
        <div className="googly__pupil" ref={pupilRef}>
          <span className="googly__glint" />
        </div>
      </div>
    </div>
  )
}

export default function GooglyEyes() {
  const rootRef = useRef(null)
  const pupils = [useRef(null), useRef(null)]
  const { pathname } = useLocation()
  const isHomeRef = useRef(pathname === '/')
  isHomeRef.current = pathname === '/'

  useEffect(() => {
    const root = rootRef.current
    let pointer = null
    let away = isHomeRef.current ? 0 : 1 // 0 = home layout, 1 = header
    let last = performance.now()
    let raf = 0

    const onMove = (e) => {
      pointer = { x: e.clientX, y: e.clientY }
    }

    const heroPoint = () => {
      const anchor = getMelonEyesAnchor()
      // The anchor sits just above the rind; the eyes rest on it.
      if (anchor) return { x: anchor.x, y: anchor.y - (EYES_H * HERO_SCALE) / 2 }
      return { x: window.innerWidth / 2, y: window.innerHeight * 0.2 - window.scrollY }
    }

    const headerPoint = () => {
      const slot = document.querySelector('[data-eyes-slot="header"]')
      if (!slot) return { x: window.innerWidth / 2, y: 32 }
      const r = slot.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }

    const followPointer = () => {
      if (!pointer) return
      for (const ref of pupils) {
        const pupil = ref.current
        if (!pupil) continue
        // Measure the (unmoving) eye rather than the moving pupil.
        const r = pupil.parentElement.getBoundingClientRect()
        const dx = pointer.x - (r.left + r.width / 2)
        const dy = pointer.y - (r.top + r.height / 2)
        const distance = Math.min(MAX_OFFSET, Math.hypot(dx, dy))
        const angle = Math.atan2(dy, dx)
        pupil.style.transform = `translate(${Math.cos(angle) * distance}px, ${Math.sin(angle) * distance}px)`
      }
    }

    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now

      // Off the home page the eyes live in the header; ease between the two.
      const target = isHomeRef.current ? 0 : 1
      away += (target - away) * (1 - Math.exp(-dt * 10))
      if (Math.abs(target - away) < 0.0005) away = target

      const header = headerPoint()
      const hero = heroPoint()

      // On home the eyes ride on the rind as it scrolls up, then dock into
      // the header slot once they reach it.
      const travel = Math.max(1, hero.y + window.scrollY - header.y)
      const docked = easeInOutCubic(clamp01(window.scrollY / travel))
      const homeX = lerp(hero.x, header.x, docked)
      const homeY = Math.max(hero.y, header.y)
      const homeS = lerp(HERO_SCALE, 1, docked)

      const t = easeInOutCubic(away)
      const x = lerp(homeX, header.x, t)
      const y = lerp(homeY, header.y, t)
      const s = lerp(homeS, 1, t)
      root.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${s})`

      followPointer()
      raf = requestAnimationFrame(tick)
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    raf = requestAnimationFrame(tick)
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(raf)
    }
    // pupils are stable refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="googly" ref={rootRef} aria-hidden="true">
      <Eye pupilRef={pupils[0]} />
      <Eye pupilRef={pupils[1]} />
    </div>
  )
}
