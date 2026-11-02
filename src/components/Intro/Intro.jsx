import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  BAR,
  DONE_AT,
  FADE,
  LAYERS,
  LAYER_LEFT,
  REVEAL_AT,
  ROWS,
  clamp01,
  interleave,
  layerTransform,
  lerp,
  round2,
  visibleSlots,
} from './timeline.js'
import { MARK_PARTS, NAME, measureMark } from './wordmark.js'
import { readinessTasks } from './readiness.js'
import './Intro.css'

// Clone of the sofaknows.com loader: loading line → the name repeated down the
// screen → eight layers carrying the stretched name squash in, then stretch out
// to the right and uncover the page. Timings live in timeline.js.
//
// Props
//   onComplete()  called once, after the last layer has left the screen.
//   onReveal()    optional; called when the page underneath becomes visible
//                 (while the layers still cover the viewport).
//   images        optional photo strip for the middle row: URLs or
//                 { src, aspect } objects (aspect defaults to their 0.86 crop),
//                 cycled or trimmed to their 18 figures.

const ROW_KEYS = Array.from({ length: ROWS.perBlock }, (_, i) => i)
const LAYER_KEYS = Array.from({ length: LAYERS }, (_, i) => i)
const REDUCED_FADE = 400

// Their strip always holds exactly 18 figures (photos repeat to fill it), and
// the row cadence depends on that count, so any number of images is cycled or
// trimmed to 18.
const normalize = (images) => {
  const list = (Array.isArray(images) ? images : [])
    .map((img) => (typeof img === 'string' ? { src: img } : img))
    .filter((img) => img && img.src)
    .map((img) => ({ aspect: 0.86, ...img }))
  return list.length ? Array.from({ length: ROWS.strip }, (_, i) => list[i % list.length]) : []
}

const uniqueBySrc = (list) => list.filter((img, i) => list.findIndex((o) => o.src === img.src) === i)

export default function Intro({ onComplete, onReveal, images = [] }) {
  const rootRef = useRef(null)
  const doneRef = useRef(false)
  const callbacks = useRef({ onComplete, onReveal })
  // Snapshot at mount: the strip is part of the choreography, not live data.
  const [pics] = useState(() => normalize(images))

  useEffect(() => {
    callbacks.current = { onComplete, onReveal }
  })

  useLayoutEffect(() => {
    const html = document.documentElement
    html.classList.add('is-intro')
    return () => html.classList.remove('is-intro')
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined

    const q = (sel) => root.querySelector(sel)
    const bg = q('.intro__bg')
    const barWrap = q('.intro__bar')
    const bar = barWrap.firstElementChild
    const rowsEl = q('.intro__rows')
    const layers = [...root.querySelectorAll('.intro__layer')]
    const markParts = [...root.querySelectorAll('.intro__mark-part')]
    const top = [...q('[data-slot="top"]').children]
    const bottom = [...q('[data-slot="bottom"]').children]
    const stripEl = q('[data-slot="strip"]')
    // Without photos the middle row takes the first strip slot and the other
    // slots stay empty, so the text rows keep exactly their original cadence.
    const strip = pics.length
      ? [...stripEl.children]
      : [stripEl.firstElementChild, ...Array(ROWS.strip - 1).fill(null)]
    const seq = interleave(top, strip, bottom)

    let raf = 0
    let disposed = false
    let cancelTasks = () => {}

    // Reset everything the loop mutates, so a re-run effect starts clean.
    seq.forEach((el) => el && (el.style.display = 'none'))
    bar.style.transition = 'none'
    bar.style.transform = `translate3d(${BAR.innerStart}%, 0, 0)`
    barWrap.style.transition = 'none'
    barWrap.style.transform = 'translate3d(0, 0, 0)'
    rowsEl.style.opacity = ''
    bg.style.opacity = ''
    layers.forEach((el) => (el.style.transform = ''))
    root.classList.remove('intro--leaving')

    const setMark = () => {
      const boxes = measureMark()
      if (boxes) markParts.forEach((svg) => svg.setAttribute('viewBox', boxes[svg.dataset.part]))
    }

    const finish = () => {
      if (disposed || doneRef.current) return
      doneRef.current = true
      cancelAnimationFrame(raf)
      document.documentElement.classList.remove('is-intro')
      callbacks.current.onComplete?.()
    }

    // d.js pauses its clock while the tab is hidden; do the same so a
    // backgrounded tab resumes mid-animation instead of skipping to the end.
    let hiddenAt = document.hidden ? performance.now() : 0
    let hiddenFor = 0
    const clock = () => performance.now() - hiddenFor
    const onVisibility = () => {
      const now = performance.now()
      if (document.hidden) hiddenAt = now
      else if (hiddenAt) {
        hiddenFor += now - hiddenAt
        hiddenAt = 0
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    const startTasks = (onDone) => {
      const { tasks, cancel } = readinessTasks({ images: uniqueBySrc(pics), onFonts: setMark })
      cancelTasks = cancel
      tasks.forEach((p) => p.then(() => !disposed && onDone()))
      return tasks.length
    }

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      // One still row, then a short fade once the page is ready.
      root.classList.add('intro--reduced')
      if (top[0]) top[0].style.display = 'block'
      let fadeTimer = 0
      let pending = 0
      pending = startTasks(() => {
        if (--pending > 0) return
        // Reading layout flushes styles, so the fade starts from opacity 1.
        if (root.offsetWidth >= 0) root.classList.add('intro--leaving')
        fadeTimer = window.setTimeout(finish, REDUCED_FADE)
      })
      return () => {
        disposed = true
        clearTimeout(fadeTimer)
        root.classList.remove('intro--reduced')
        cancelTasks()
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }

    // Loader state (class `ms`), rows (class `us`), hand-off (class `gs`/`at`).
    let phase = 'load'
    let loading = false
    let texL = 0
    let no = 0
    let prevNo = 0
    let rowsStart = -1
    let rowsFull = false
    let shown = -1
    let t0 = -1
    let revealed = false
    const lastTf = []

    const show = (count) => {
      if (count === shown) return
      shown = count
      for (let i = 0; i < seq.length; i++) {
        const el = seq[i]
        if (el) el.style.display = i < count ? 'block' : 'none'
      }
    }

    const frame = () => {
      raf = requestAnimationFrame(frame)
      const now = clock()

      if (phase === 'load') {
        // ms.loop: arm the 3.5s transition, start loading, follow progress.
        if (!loading) {
          loading = true
          bar.style.transition = BAR.grow
          texL = startTasks(() => no++)
        }
        if (no !== prevNo) {
          prevNo = no
          bar.style.transform = `translate3d(${round2(lerp(BAR.from, 0, no / texL))}%, 0, 0)`
        }
        if (texL > 0 && no === texL) {
          barWrap.style.transform = `translate3d(${BAR.exitX}%, 0, 0)`
          barWrap.style.transition = BAR.exit
          phase = 'rows'
        }
        return
      }

      if (phase === 'rows') {
        if (!rowsFull) {
          if (rowsStart < 0) rowsStart = now
          const pr = clamp01((now - rowsStart) / ROWS.d)
          show(visibleSlots(pr, seq.length))
          rowsFull = pr === 1
          return
        }
        // The tween fires its callback on the frame after it reaches 1.
        phase = 'out'
        t0 = now
      }

      const t = now - t0
      rowsEl.style.opacity = String(round2(1 - clamp01(t / FADE)))

      if (!revealed && t >= REVEAL_AT) {
        // Fully covered by the layers here, so the white backdrop can go.
        revealed = true
        bg.style.opacity = '0'
        callbacks.current.onReveal?.()
      }

      for (let i = 0; i < layers.length; i++) {
        const v = layerTransform(i, t)
        if (v !== lastTf[i]) {
          layers[i].style.transform = v
          lastTf[i] = v
        }
      }

      if (t >= DONE_AT) finish()
    }

    raf = requestAnimationFrame(frame)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      cancelTasks()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [pics])

  return (
    <div className="intro" ref={rootRef} aria-hidden="true">
      <div className="intro__bg" />

      <div className="intro__z">
        {LAYER_KEYS.map((i) => (
          <div key={i} className="intro__layer" style={{ left: `${LAYER_LEFT[i]}%` }}>
            <svg className="intro__mark" viewBox="0 0 100 1" preserveAspectRatio="none" focusable="false">
              {MARK_PARTS.map((part, j) => (
                <svg
                  key={j}
                  className="intro__mark-part"
                  data-part={j}
                  x={part.x}
                  y="0"
                  width={part.width}
                  height="1"
                  viewBox={part.viewBox}
                  preserveAspectRatio="none"
                  overflow="visible"
                >
                  <text x="0" y="0">
                    {part.text}
                  </text>
                </svg>
              ))}
            </svg>
          </div>
        ))}
      </div>

      <div className="intro__bar">
        <div />
      </div>

      <div className="intro__rows">
        <div className="intro__block" data-slot="top">
          {ROW_KEYS.map((i) => (
            <span key={i}>{NAME}</span>
          ))}
        </div>
        {pics.length > 0 ? (
          <div className="intro__strip" data-slot="strip">
            {pics.map((pic, i) => (
              <figure key={i} className="intro__fig" style={{ aspectRatio: pic.aspect }}>
                <img src={pic.src} alt="" decoding="async" />
              </figure>
            ))}
          </div>
        ) : (
          <div className="intro__block intro__block--mid" data-slot="strip">
            <span>{NAME}</span>
          </div>
        )}
        <div className="intro__block" data-slot="bottom">
          {ROW_KEYS.map((i) => (
            <span key={i}>{NAME}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
