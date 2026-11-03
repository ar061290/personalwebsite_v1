// The giant AADI RAMNANI ✨ banner at the foot of every page: it loops sideways, and a
// circle follows the cursor (or a finger) over it, the name inside it inverted and a
// touch larger. Drag it (mouse or touch) to throw the loop; it eases back to its drift.
// (ytconsultancy.com's footer name was the brief; the live site sat behind a bot check
// and its archived copy has no banner, so this is a reconstruction of "the circle".)
import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import './NameBanner.css'

const WORD = 'AADI RAMNANI'
const SPARK = '✨'

function Track({ copies, trackRef }) {
  return (
    <div className="name-banner__track" ref={trackRef}>
      {Array.from({ length: copies }, (_, i) => (
        <span className="name-banner__item" key={i}>
          <span className="name-banner__word">{WORD}</span>
          <span className="name-banner__spark">{SPARK}</span>
        </span>
      ))}
    </div>
  )
}

export default function NameBanner() {
  const rootRef = useRef(null)
  const baseRef = useRef(null)
  const lensRef = useRef(null)
  const lensInnerRef = useRef(null)
  const lensTrackRef = useRef(null)
  const [copies, setCopies] = useState(4)

  useEffect(() => {
    const root = rootRef.current
    const base = baseRef.current
    const lens = lensRef.current
    const lensInner = lensInnerRef.current
    const lensTrack = lensTrackRef.current
    if (!root || !base || !lens || !lensTrack) return undefined

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    let unit = 1 // one "AADI RAMNANI ✨" in px: the loop's period
    let height = 1
    let offset = 0 // px the loop has travelled
    let velocity = 0 // px/s added by a throw, easing back to nothing
    let drift = 60 // px/s
    let raf = 0
    let last = 0
    let visible = false

    // the circle: where it is heading, where it is, and how big
    const lensState = { r: 0 }
    let tx = 0
    let ty = 0
    let cx = 0
    let cy = 0
    let placed = false
    let over = false
    let drag = null // { id, x, t, moved }
    let leaveTimer = 0

    const measure = () => {
      const item = base.querySelector('.name-banner__item')
      if (!item) return
      unit = item.getBoundingClientRect().width || 1
      height = root.clientHeight || 1
      drift = Math.max(36, Math.min(90, root.clientWidth * 0.045))
      const need = Math.ceil(root.clientWidth / unit) + 2
      setCopies((c) => (c === need ? c : need))
    }

    const radius = () => Math.max(40, height * 0.5)

    const grow = () => {
      gsap.to(lensState, { r: radius(), duration: reduced ? 0 : 0.55, ease: 'expo.out', overwrite: true })
    }
    const shrink = () => {
      gsap.to(lensState, { r: 0, duration: reduced ? 0 : 0.4, ease: 'power3.inOut', overwrite: true })
    }

    const local = (e) => {
      const r = root.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }

    const aim = (e) => {
      const p = local(e)
      tx = p.x
      ty = p.y
      if (!placed) {
        cx = tx
        cy = ty
        placed = true
      }
    }

    const onEnter = (e) => {
      clearTimeout(leaveTimer)
      over = true
      aim(e)
      grow()
      wake()
    }
    const onMove = (e) => {
      if (!over) onEnter(e)
      aim(e)
      if (drag && e.pointerId === drag.id) {
        const now = e.timeStamp
        const dx = e.clientX - drag.x
        const dt = Math.max(1, now - drag.t) / 1000
        if (Math.abs(dx) > 0) {
          offset -= dx
          velocity = -dx / dt
          drag.moved = true
        }
        drag.x = e.clientX
        drag.t = now
      }
    }
    const onLeave = (e) => {
      if (drag && e.pointerId === drag.id) return
      over = false
      // a finger lifts: the circle lingers a moment where it was
      leaveTimer = setTimeout(shrink, e.pointerType === 'touch' ? 260 : 0)
      placed = false
    }
    const onDown = (e) => {
      onEnter(e)
      drag = { id: e.pointerId, x: e.clientX, t: e.timeStamp, moved: false }
      velocity = 0
      if (e.pointerType === 'mouse') root.setPointerCapture?.(e.pointerId)
      gsap.to(lensState, { r: radius() * 0.82, duration: 0.3, ease: 'power3.out', overwrite: true })
    }
    const onUp = (e) => {
      if (!drag || e.pointerId !== drag.id) return
      // released: keep the throw (clamped), then let it ease back into the drift
      velocity = Math.max(-2400, Math.min(2400, velocity))
      if (e.timeStamp - drag.t > 80) velocity = 0
      drag = null
      const inside = e.type !== 'pointercancel' && e.pointerType !== 'touch'
      if (inside) grow()
      else onLeave(e)
    }

    const render = () => {
      // wrap the travel into one period, so the copies never run out
      const x = -(((offset % unit) + unit) % unit)
      const t = `translate3d(${x}px, 0, 0)`
      base.style.transform = t
      lensTrack.style.transform = t
      const r = lensState.r
      lens.style.clipPath = `circle(${r.toFixed(1)}px at ${cx.toFixed(1)}px ${cy.toFixed(1)}px)`
      lens.style.visibility = r > 0.5 ? 'visible' : 'hidden'
      lensInner.style.transformOrigin = `${cx.toFixed(1)}px ${cy.toFixed(1)}px`
    }

    const tick = (now) => {
      raf = 0
      const dt = Math.min(0.05, (now - (last || now)) / 1000)
      last = now
      if (!drag) {
        if (!reduced) offset += drift * dt
        offset += velocity * dt
        velocity *= Math.exp(-dt * 3.2)
        if (Math.abs(velocity) < 1) velocity = 0
      }
      const k = reduced ? 1 : 1 - Math.exp(-dt * 16)
      cx += (tx - cx) * k
      cy += (ty - cy) * k
      render()
      const idle = reduced && !over && lensState.r <= 0.5 && velocity === 0 && !drag
      if (visible && !idle) raf = requestAnimationFrame(tick)
    }
    const wake = () => {
      if (!raf && visible) {
        last = 0
        raf = requestAnimationFrame(tick)
      }
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting
        if (visible) wake()
        else if (raf) {
          cancelAnimationFrame(raf)
          raf = 0
        }
      },
      { rootMargin: '80px 0px' },
    )
    io.observe(root)

    const ro = new ResizeObserver(() => {
      measure()
      render()
    })
    ro.observe(root)
    document.fonts?.ready.then(measure).catch(() => {})
    measure()
    render()

    root.addEventListener('pointerenter', onEnter)
    root.addEventListener('pointermove', onMove)
    root.addEventListener('pointerleave', onLeave)
    root.addEventListener('pointerdown', onDown)
    root.addEventListener('pointerup', onUp)
    root.addEventListener('pointercancel', onUp)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(leaveTimer)
      gsap.killTweensOf(lensState)
      io.disconnect()
      ro.disconnect()
      root.removeEventListener('pointerenter', onEnter)
      root.removeEventListener('pointermove', onMove)
      root.removeEventListener('pointerleave', onLeave)
      root.removeEventListener('pointerdown', onDown)
      root.removeEventListener('pointerup', onUp)
      root.removeEventListener('pointercancel', onUp)
    }
  }, [])

  return (
    <div className="name-banner" ref={rootRef} role="img" aria-label="Aadi Ramnani" data-cursor="">
      <div className="name-banner__row" aria-hidden="true">
        <Track copies={copies} trackRef={baseRef} />
      </div>
      <div className="name-banner__lens" ref={lensRef} aria-hidden="true">
        <div className="name-banner__lens-inner" ref={lensInnerRef}>
          <Track copies={copies} trackRef={lensTrackRef} />
        </div>
      </div>
    </div>
  )
}
