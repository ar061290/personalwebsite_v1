// What hangs under a section's label in the left column of a content page:
// logo stickers (die-cut, popped on when they scroll into view), an automatic
// photo slideshow (no controls: it cross-fades on its own while in view) and a pair of
// reel prints (ReelCards: portrait stills that open their reels, with a pencilled note pointing at
// them). (The video card that can hang there too is
// VideoOverlay.jsx.) Also the die-cut sticker an entry can hang beside itself (EntrySticker, an
// entry.aside: level with its entry in the left column, or in the corner of its text on phones).
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

/**
 * One die-cut sticker stuck beside an entry (ContentPage's entry.aside.sticker), popped on the first time
 * it comes into view, like the logo stickers. The art carries its own white vinyl margin; the same
 * hard white shadows as theirs tidy its edge.
 */
export function EntrySticker({ sticker }) {
  const ref = useRef(null)
  const [shown, setShown] = useState(false)
  useInView(ref, (v) => v && setShown(true))

  return (
    <figure ref={ref} className={`entry-sticker${shown ? ' is-in' : ''}`} style={{ '--tilt': `${sticker.tilt ?? 0}deg`, ...(sticker.width ? { '--sticker-w': sticker.width } : {}) }}>
      <img src={sticker.src} alt={sticker.alt} draggable="false" loading="lazy" decoding="async" />
    </figure>
  )
}

/** 129 → "2:09" */
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

// the pencilled arrow: one loose stroke that swings out right and curls back down into the prints,
// and a two-line head drawn along its last direction. pathLength 1, so CSS can draw it on.
const ARROW_LINE = 'M5 6c11-4 27-3 35 6 8 9 4 21-4 29-3 3-6 6-8 10'
const ARROW_HEAD = 'M26 42.5 28 51l8.5-4'

/**
 * The section's reels (section.reels, with section.reelsNote), as two portrait prints laid down
 * side by side, a little tilted and overlapping like photos dropped on a desk. Each is a link to its
 * reel; the still is a frame from the middle of the reel. On a computer (a mouse, a wide screen) the
 * reel opens in a popup window of its own, sized and centred over this one: Instagram's real post page
 * (the reel beside its comments, which a signed-in visitor can like and comment on), as Instagram
 * won't let that page sit inside another site. On phones, or if popups are blocked, the link opens
 * Instagram in a new tab (or its app). They settle in, and the note's arrow draws itself on, the first
 * time they come into view.
 */
const POPUP_HERE = '(min-width: 861px) and (hover: hover) and (pointer: fine)'
const POPUP_W = 1100
const POPUP_H = 820

/** The reel in a popup window centred over this one; false if it couldn't open one. */
function openReelWindow(href) {
  const w = Math.min(POPUP_W, window.screen.availWidth - 40)
  const h = Math.min(POPUP_H, window.screen.availHeight - 40)
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2))
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2))
  // (not `noopener` here: with it the call never returns the window, so a blocked popup can't be told)
  const win = window.open(href, 'aadi-reel', `popup,width=${w},height=${h},left=${left},top=${top}`)
  if (!win) return false
  win.opener = null
  win.focus()
  return true
}

export function ReelCards({ reels, note }) {
  const ref = useRef(null)
  const [shown, setShown] = useState(false)
  useInView(ref, (v) => v && setShown(true), 0.2)

  const play = (e, reel) => {
    if (!window.matchMedia(POPUP_HERE).matches || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return
    if (openReelWindow(reel.href)) e.preventDefault()
  }

  return (
    <div ref={ref} className={`side-reels${shown ? ' is-in' : ''}`}>
      {note && (
        <p className="side-reels__note">
          {note}
          <svg className="side-reels__arrow" viewBox="0 0 48 56" aria-hidden="true" focusable="false">
            <path d={ARROW_LINE} pathLength="1" />
            <path className="side-reels__arrow-head" d={ARROW_HEAD} pathLength="1" />
          </svg>
        </p>
      )}
      <ul className="side-reels__cards">
        {reels.map((r, i) => (
          <li key={r.href} className="side-reels__item" style={{ '--tilt': `${i % 2 ? 3.5 : -4}deg`, '--n': i }}>
            <a
              className="side-reel"
              href={r.href}
              target="_blank"
              rel="noopener noreferrer"
              data-cursor="watch"
              onClick={(e) => play(e, r)}
            >
              <span className="side-reel__print">
                <span className="side-reel__frame">
                  <img src={r.thumb} alt={r.alt} draggable="false" loading="lazy" decoding="async" />
                  <span className="side-reel__mark" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="12" height="12" focusable="false">
                      <path d="M7 4.5v15a.8.8 0 0 0 1.2.7l12-7.5a.8.8 0 0 0 0-1.4l-12-7.5A.8.8 0 0 0 7 4.5Z" fill="currentColor" />
                    </svg>
                  </span>
                  {r.length ? (
                    <span className="side-reel__length" aria-hidden="true">
                      {clock(r.length)}
                    </span>
                  ) : null}
                </span>
                <span className="side-reel__caption">
                  {r.label}
                  {/* a word joiner: the arrow never wraps onto a line of its own */}
                  {'⁠'}
                  <span className="side-reel__arrow" aria-hidden="true">
                    ↗
                  </span>
                </span>
                <span className="side-reel__offscreen"> (instagram reel, opens in a new window)</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
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
