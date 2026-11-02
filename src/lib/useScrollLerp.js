import { useEffect } from 'react'

// Writes `--lerp` on an element: the scroll speed in px per 60 Hz frame, eased.
// That is what StringTune's StringLerp exposes (its smooth scroller steps by
// (target − current) × 0.09 a frame). Like StringTune, it only runs on desktop
// (fine pointer) and not with reduced motion; elsewhere --lerp stays 0.
const FOLLOW = 0.18 // fraction of the gap to the current speed closed per 60 Hz frame
const REST = 0.02

export default function useScrollLerp(ref) {
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const desktop = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!desktop || reduced) return undefined

    let raf = 0
    let near = false
    let lerp = 0
    let shown = 0
    let lastY = window.scrollY
    let lastT = performance.now()

    const write = (v) => {
      if (Math.abs(v - shown) < 0.01) return
      shown = v
      el.style.setProperty('--lerp', v.toFixed(2))
    }

    const frame = (now) => {
      const frames = Math.max(0.25, (now - lastT) / (1000 / 60))
      const y = window.scrollY
      const velocity = (y - lastY) / frames
      lastY = y
      lastT = now
      lerp += (velocity - lerp) * (1 - Math.pow(1 - FOLLOW, frames))
      if (Math.abs(lerp) < REST && velocity === 0) {
        lerp = 0
        write(0)
        raf = 0
        return
      }
      write(lerp)
      raf = requestAnimationFrame(frame)
    }

    const wake = () => {
      if (!near || raf) return
      raf = requestAnimationFrame(frame)
    }

    const io = new IntersectionObserver(([entry]) => {
      near = entry.isIntersecting
      if (near) {
        lastY = window.scrollY
        lastT = performance.now()
        wake()
      }
    }, { rootMargin: '50% 0px' })
    io.observe(el)

    // Waking from rest: count the first step as one frame's worth of movement.
    const onScroll = () => {
      if (!raf) lastT = performance.now() - 1000 / 60
      wake()
    }
    window.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      io.disconnect()
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
      el.style.removeProperty('--lerp')
    }
  }, [ref])
}
