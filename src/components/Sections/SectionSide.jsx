// What hangs under a section's label in the left column of a content page:
// logo stickers (die-cut, popped on when they scroll into view) and an automatic
// photo slideshow (no controls: it cross-fades on its own while in view).
import { useEffect, useRef, useState } from 'react'
import './SectionSide.css'

const SLIDE_MS = 2200

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Calls `onChange(visible)` as `ref`'s element enters and leaves the screen. */
function useInView(ref, onChange, threshold = 0.25) {
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const io = new IntersectionObserver(([e]) => onChange(e.isIntersecting), { threshold })
    io.observe(el)
    return () => io.disconnect()
  }, [ref, onChange, threshold])
}

export function LogoStickers({ items }) {
  const ref = useRef(null)
  const [shown, setShown] = useState(false)
  // stuck on once, the first time they come into view
  useInView(ref, (v) => v && setShown(true))

  return (
    <ul ref={ref} className={`side-stickers${shown ? ' is-in' : ''}`}>
      {items.map((s, i) => (
        <li key={s.alt} className="side-sticker" style={{ '--tilt': `${s.tilt ?? 0}deg`, '--n': i }}>
          <img src={s.src} alt={s.alt} draggable="false" loading="lazy" />
        </li>
      ))}
    </ul>
  )
}

export function AutoSlideshow({ slides, label }) {
  const ref = useRef(null)
  // the photo fading in, and the one it fades in over (held fully up underneath,
  // so the change never dips through to the background)
  const [{ index, prev }, setShown] = useState({ index: 0, prev: -1 })
  const [inView, setInView] = useState(false)
  useInView(ref, setInView, 0.15)

  useEffect(() => {
    if (!inView || slides.length < 2 || reducedMotion()) return undefined
    const tick = () => {
      if (!document.hidden) setShown(({ index: i }) => ({ index: (i + 1) % slides.length, prev: i }))
    }
    const timer = setInterval(tick, SLIDE_MS)
    return () => clearInterval(timer)
  }, [inView, slides.length])

  return (
    <figure ref={ref} className="side-slides" role="img" aria-label={label}>
      <div className="side-slides__frame">
        {slides.map((s, i) => (
          <img
            key={s.src}
            className={`side-slides__img${i === index ? ' is-active' : i === prev ? ' is-prev' : ''}`}
            src={s.src}
            alt=""
            draggable="false"
            loading={i === 0 ? 'lazy' : undefined}
            style={s.focus ? { objectPosition: s.focus } : undefined}
          />
        ))}
      </div>
    </figure>
  )
}
