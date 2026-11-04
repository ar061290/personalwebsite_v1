// Eating the academics page's 5 Star (FiveStarMedal.jsx): a nine-frame stop motion over the page, the
// page itself left in view behind it (the frames are cut-outs). Pressing the bar lifts it off its
// ribbon and brings it, turning and growing, to the middle of the screen, where it becomes frame 1:
// the same picture of the bar (the one on the ribbon is frame 1's), now with its dashes. From there:
//   frames 1 → 6 (peeling): CLICK TO PEEL. Every click is a frame.
//   frames 6 → 9 (eating): CLICK TO EAT. The same.
// The words stand beside the bar (under it where there is no room), large; the cursor keeps its "+".
// Frames change in a cut, never a fade, and each is tipped a degree and a half the other way from the
// last (baked into the pictures: src/assets/fivestar), so the bar rocks as it goes. At frame 9 (all
// eaten, a star where it was) the star pops and golden dashes and sparkles fly out of it, then the
// scene fades back into the page, and the bar is back on its ribbon.
// Escape, the × or the browser's back button puts it away early, and the frame it was on is kept:
// pressing the bar again carries on from there, until the page is left or reloaded (or the bar was
// nearly gone, at frame 8). Space and Enter click too.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { holdPage, releasePage } from '../../lib/scrollLock.js'
import f1 from '../../assets/fivestar/frame-1.webp'
import f2 from '../../assets/fivestar/frame-2.webp'
import f3 from '../../assets/fivestar/frame-3.webp'
import f4 from '../../assets/fivestar/frame-4.webp'
import f5 from '../../assets/fivestar/frame-5.webp'
import f6 from '../../assets/fivestar/frame-6.webp'
import f7 from '../../assets/fivestar/frame-7.webp'
import f8 from '../../assets/fivestar/frame-8.webp'
import f9 from '../../assets/fivestar/frame-9.webp'
import barSrc from '../../assets/fivestar/medal-bar.webp'
import './FiveStarFeast.css'

const FRAMES = [
  [f1, 'The 5 Star, still in its wrapper'],
  [f2, 'A corner of the wrapper torn open'],
  [f3, 'The wrapper torn open, the end of the bar showing'],
  [f4, 'The bar half out of its wrapper'],
  [f5, 'The bar most of the way out'],
  [f6, 'The bar out, its wrapper crumpled at one end'],
  [f7, 'A bite taken out of the bar, a few crumbs'],
  [f8, 'Another bite, more crumbs'],
  [f9, 'All gone: a star where the bar was'],
]
const PEELED = 6 // from here, clicks eat
const LAST = 9
const FRAME_W = 656 // the pictures' size (px)
const FRAME_H = 366
const BAR1 = { cx: 304.3, cy: 190.38, long: 533, short: 174 } // frame 1's bar in the picture (px): its centre, its sides
const STAR9 = { cx: 355, cy: 182.3 } // frame 9's star, its centre (px)
const TILT_1 = 1.5 // frame 1's own tilt (deg, clockwise)
const FLY_MS = 640 // the bar's way from its ribbon to the middle
const END_MS = 1300 // frame 9 stays this long (its burst plays out) before the scene fades
const FADE_MS = 520 // the scene's fade out at the end
const AWAY_MS = 300 // ... and when it is put away early
const WORDS_GAP = 40 // px between the stage and the words beside it
const WORDS_ROOM = 250 // px the words need beside the stage; with less, they go under it

// Frame 9's burst, in the picture's px from the star's centre: a golden ring going out, dashes shooting
// out from its points' circle, and sparkles thrown further, turning. [angle (deg), from, to, size, delay (ms)]
const RAYS = Array.from({ length: 12 }, (_, i) => [
  i * 30 - 75,
  100,
  220 + (i % 3) * 22,
  46 - (i % 2) * 12,
  (i % 3) * 45,
])
const SPARKS = Array.from({ length: 10 }, (_, i) => [
  i * 36 - 57,
  60,
  200 + ((i * 37) % 5) * 22,
  26 + ((i * 7) % 4) * 7,
  90 + (i % 3) * 80,
])

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const touchOnly = () => window.matchMedia('(hover: none)').matches

// Where the eating had got to, kept while the visitor stays on the page (cleared by leaving it, see
// FiveStarMedal, or a reload).
let kept = 1
export const forgetFeast = () => {
  kept = 1
}

let warmed = null
/** Fetches and decodes the frames (from the first hover or focus on the bar), so cuts never wait. */
export function warmFeast() {
  warmed ??= Promise.all(
    [barSrc, ...FRAMES.map(([src]) => src)].map((src) => {
      const img = new Image()
      img.decoding = 'async'
      img.src = src
      return img.decode().catch(() => {})
    }),
  )
  return warmed
}

/** The stage: the frames at about their own size, less on a phone (its width) or a short screen. */
function stageBox() {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = Math.min(vw * 0.86, 560, ((vh - 150) * FRAME_W) / FRAME_H)
  const h = (w * FRAME_H) / FRAME_W
  return { w, h, left: (vw - w) / 2, top: (vh - h) / 2, beside: (vw - w) / 2 >= WORDS_ROOM }
}

/** A synthetic pointer move where the pointer is, so the site's cursor reads what is under it again. */
function nudgeCursor(p) {
  if (!p.known) return
  document
    .elementFromPoint(p.x, p.y)
    ?.dispatchEvent(
      new PointerEvent('pointermove', { clientX: p.x, clientY: p.y, pointerType: 'mouse', bubbles: true }),
    )
}

export default function FiveStarFeast({ from, onDone }) {
  // `from`: the bar on the page ({ cx, cy, w, h, rotate }: its centre, unrotated size and tilt), and
  // where the pointer pressed it (`pointer`: { x, y }, or none from a key)
  const rootRef = useRef(null)
  const closeRef = useRef(null)
  const [frame, setFrame] = useState(kept)
  const [phase, setPhase] = useState(reducedMotion() ? 'open' : 'flying') // flying | open | ending | away
  const [box, setBox] = useState(stageBox)
  const frameRef = useRef(frame)
  frameRef.current = frame
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const pointer = useRef(from.pointer ? { ...from.pointer, known: true } : { x: 0, y: 0, known: false })

  useEffect(() => {
    const onResize = () => setBox(stageBox())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // the page holds still under it; focus comes here (Escape, Space, Enter), and goes back after; the
  // cursor drops the bar's "click" now, and reads the page again once the scene has gone
  useEffect(() => {
    const owner = rootRef
    const last = pointer // (read when it is needed: the pointer as it is by then)
    holdPage(owner)
    const before = document.activeElement
    rootRef.current?.focus({ preventScroll: true })
    nudgeCursor(last.current)
    return () => {
      releasePage(owner)
      if (before instanceof HTMLElement) before.focus({ preventScroll: true })
      requestAnimationFrame(() => nudgeCursor(last.current))
    }
  }, [])

  // the flight ends in frame 1 (or wherever the visitor had got to)
  useEffect(() => {
    if (phase !== 'flying') return undefined
    const t = setTimeout(() => setPhase('open'), FLY_MS)
    return () => clearTimeout(t)
  }, [phase])

  const finish = useCallback(
    (how) => {
      setPhase(how)
      const ms = reducedMotion() ? 0 : how === 'ending' ? FADE_MS : AWAY_MS
      setTimeout(onDone, ms)
    },
    [onDone],
  )

  const putAway = useCallback(() => {
    if (phaseRef.current === 'ending' || phaseRef.current === 'away') return
    kept = frameRef.current >= 8 ? 1 : frameRef.current
    finish('away')
  }, [finish])

  // The browser's back button (a phone's back gesture) puts it away rather than leaving the page: the
  // scene has an entry of its own in the history while it is out (the same address), taken back off
  // when it is put away any other way.
  const putAwayRef = useRef(putAway)
  putAwayRef.current = putAway
  // (each scene marks its entry with a token of its own, so an entry left by an earlier one, reached by
  // the forward button or kept over a reload, is never taken for this one's)
  useEffect(() => {
    const token = Math.random().toString(36).slice(2)
    history.pushState({ ...history.state, feast: token }, '')
    const onPop = () => {
      if (history.state?.feast !== token) putAwayRef.current()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (history.state?.feast === token) history.back()
    }
  }, [])

  // the last frame: a beat to see the star (and its burst), then back to the page, and the next one
  // starts afresh
  useEffect(() => {
    if (frame !== LAST || phase !== 'open') return undefined
    kept = 1
    const t = setTimeout(() => finish('ending'), END_MS)
    return () => clearTimeout(t)
  }, [frame, phase, finish])

  const step = () => {
    if (phaseRef.current !== 'open') return false
    const f = frameRef.current
    if (f >= LAST) return false
    frameRef.current = f + 1
    setFrame(f + 1)
    return true
  }

  // the × is a control of its own: a press there is not a bite
  const onControl = (e) => e.target instanceof Element && e.target.closest('button')
  const onPointerDown = (e) => {
    pointer.current = { x: e.clientX, y: e.clientY, known: e.pointerType === 'mouse' }
    if (!e.isPrimary || e.button !== 0 || phase !== 'open' || onControl(e)) return
    e.preventDefault()
    step()
  }
  const onPointerMove = (e) => {
    pointer.current = { x: e.clientX, y: e.clientY, known: e.pointerType === 'mouse' }
  }

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      putAway()
    } else if (e.key === 'Tab') {
      // focus stays in the scene: the scene itself and its ×
      e.preventDefault()
      const stops = [rootRef.current, ...rootRef.current.querySelectorAll('button')]
      const at = stops.indexOf(document.activeElement)
      stops[(at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus({ preventScroll: true })
    } else if ((e.key === ' ' || e.key === 'Enter') && !onControl(e)) {
      e.preventDefault()
      if (!e.repeat) step()
    }
  }
  // the bar's flight: from its place on the ribbon to frame 1's bar, turning from hanging to lying
  const k = box.w / FRAME_W
  const endX = box.left + BAR1.cx * k
  const endY = box.top + BAR1.cy * k
  // (the hanging bar is upright, so its width becomes the lying bar's height, and its height the length)
  const endScale = `${(BAR1.short * k) / from.w}, ${(BAR1.long * k) / from.h}`
  const flyFrom = `translate(${from.cx}px, ${from.cy}px) rotate(${from.rotate}deg) scale(1, 1)` // (the same steps as flyTo, so it turns rather than morphs)
  const flyTo = `translate(${endX}px, ${endY}px) rotate(${-90 + TILT_1}deg) scale(${endScale})`

  const words =
    phase === 'flying' || frame >= LAST ? '' : `${touchOnly() ? 'tap' : 'click'} to ${frame < PEELED ? 'peel' : 'eat'}`
  const wordsAt = box.beside
    ? { left: box.left + box.w + WORDS_GAP, top: box.top + BAR1.cy * k }
    : { left: '50%', top: box.top + box.h + 18 }
  const shown = phase !== 'flying'
  const burst = frame === LAST && shown && !reducedMotion()

  return createPortal(
    <div
      ref={rootRef}
      className={`feast is-${phase}`}
      role="dialog"
      aria-modal="true"
      aria-label="Unwrapping and eating a Cadbury 5 Star: click to peel, then click to eat. Escape puts it away."
      tabIndex={-1}
      data-cursor=""
      data-no-sticker=""
      style={{
        '--fade-ms': `${phase === 'ending' ? FADE_MS : AWAY_MS}ms`,
        '--stage-top': `${box.top}px`,
        '--stage-right': `${box.left + box.w}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="feast__stage" style={{ left: box.left, top: box.top, width: box.w, height: box.h }}>
        {FRAMES.map(([src, alt], i) => (
          <img
            key={src}
            className={`feast__frame${i + 1 === frame && shown ? ' is-on' : ''}${i + 1 === LAST ? ' feast__frame--star' : ''}`}
            src={src}
            alt={i + 1 === frame ? alt : ''}
            aria-hidden={i + 1 === frame ? undefined : 'true'}
            width={FRAME_W}
            height={FRAME_H}
            draggable="false"
          />
        ))}
        {burst && (
          <div
            className="feast__burst"
            aria-hidden="true"
            style={{ left: `${(STAR9.cx / FRAME_W) * 100}%`, top: `${(STAR9.cy / FRAME_H) * 100}%` }}
          >
            <span className="feast__ring" style={{ '--r1': `${230 * k}px` }} />
            {RAYS.map(([a, r0, r1, len, delay], i) => (
              <span
                key={`r${i}`}
                className="feast__ray"
                style={{
                  '--a': `${a}deg`,
                  '--r0': `${r0 * k}px`,
                  '--r1': `${r1 * k}px`,
                  '--len': `${len * k}px`,
                  '--delay': `${delay}ms`,
                }}
              />
            ))}
            {SPARKS.map(([a, r0, r1, size, delay], i) => (
              <svg
                key={`s${i}`}
                className="feast__spark"
                viewBox="-10 -10 20 20"
                style={{
                  '--a': `${a}deg`,
                  '--r0': `${r0 * k}px`,
                  '--r1': `${r1 * k}px`,
                  '--size': `${size * k}px`,
                  '--delay': `${delay}ms`,
                  '--spin': `${i % 2 ? 90 : -90}deg`,
                }}
              >
                <path d="M0 -10C1.2 -3.2 3.2 -1.2 10 0 3.2 1.2 1.2 3.2 0 10-1.2 3.2-3.2 1.2-10 0-3.2-1.2-1.2-3.2 0-10Z" />
              </svg>
            ))}
          </div>
        )}
      </div>
      {phase === 'flying' && (
        <img
          className="feast__flying"
          src={barSrc}
          alt=""
          aria-hidden="true"
          draggable="false"
          style={{ width: from.w, height: from.h, '--fly-from': flyFrom, '--fly-to': flyTo, '--fly-ms': `${FLY_MS}ms` }}
        />
      )}
      <p
        className={`feast__words${box.beside ? '' : ' feast__words--under'}${words ? '' : ' is-quiet'}`}
        style={wordsAt}
        aria-live="polite"
      >
        {/* a new word slides up into place, as the cursor's do */}
        <span key={words || 'none'}>{words}</span>
      </p>
      <button
        ref={closeRef}
        type="button"
        className="feast__close"
        onClick={putAway}
        aria-label="Put it away (Esc)"
        data-cursor=""
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" fill="none" />
        </svg>
      </button>
    </div>,
    document.body,
  )
}
