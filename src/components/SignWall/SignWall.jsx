// The visitor sign wall, below the footer: a strip of paper (the page's own, light or black)
// signed by the regulars (friends who painted on the live wall) and drawable with akm2's paint
// brush (a new random colour on every stroke). Once most of it is in view it pans by itself
// across a densely signed stretch to its final view, the middle left open for the visitor; once
// it rests there they can draw. When they stop for a moment, a small popup asks for a name
// and a note (both optional). Their signatures live in this browser's localStorage. The canvases
// are transparent, so a theme change needs no redraw: the paper underneath changes and the paint
// keeps its colours.
//
// The visitor can also look along the strip themselves, sideways (wall.js: a trackpad's swipe or
// Shift+wheel, a finger away from home): "← more signatures" at the wall's left edge takes them
// into the dense stretch a step at a time, "back to sign →" glides home again, and with either of
// them focused the arrow keys move along. Taking the pan stops the auto-pan for good.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createWall } from './wall.js'
import { loadMine, MAX_MINE, saveMine } from './store.js'
import './SignWall.css'

const PAN_MS = 1570 // the pan home, once the wall is in view
const SHOWN = 0.8 // of the wall (or the screen) in view before it pans
const IDLE_MS = 1100 // after the last stroke, before the popup asks for a name
const POPUP_W = 280
const POPUP_H = 200
const EDGE = 12

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const finePointer = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches

export default function SignWall({ className = '' }) {
  const rootRef = useRef(null)
  const canvasRef = useRef(null)
  const regularsRef = useRef(null)
  const wallRef = useRef(null)
  const mineRef = useRef([])
  const idleRef = useRef(0)
  const nameRef = useRef(null)
  const leftRef = useRef(null)
  const rightRef = useRef(null)
  const navFocusRef = useRef(null) // 'left' | 'right': the browse button with the focus
  const [labels, setLabels] = useState([])
  const [nav, setNav] = useState({ left: false, right: false }) // which browse buttons show
  const [holding, setHolding] = useState(false) // a phone's "hold to sign" is pressed
  const [popup, setPopup] = useState(null) // { x, y }
  const [toast, setToast] = useState(null) // { x, y, text }
  const [mineCount, setMineCount] = useState(0)
  const [confirmErase, setConfirmErase] = useState(false)
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')

  const openPopup = useCallback(() => {
    const wall = wallRef.current
    const root = rootRef.current
    if (!wall || !root || !wall.hasGroup || wall.drawing) return
    const W = root.clientWidth
    const H = root.clientHeight
    const pw = Math.min(POPUP_W, W - EDGE * 2)
    const b = wall.groupBox()
    const fitsY = (y) => Math.min(Math.max(y, EDGE), H - POPUP_H - EDGE)
    const fitsX = (x) => Math.min(Math.max(x, EDGE), W - pw - EDGE)
    let pos
    if (b.x + b.w + 16 + pw < W - EDGE) pos = { x: b.x + b.w + 16, y: fitsY(b.y + b.h / 2 - POPUP_H / 2) }
    else if (b.x - 16 - pw > EDGE) pos = { x: b.x - 16 - pw, y: fitsY(b.y + b.h / 2 - POPUP_H / 2) }
    else if (b.y + b.h + 12 + POPUP_H < H - EDGE) pos = { x: fitsX(b.x + b.w / 2 - pw / 2), y: b.y + b.h + 12 }
    else if (b.y - 12 - POPUP_H > EDGE) pos = { x: fitsX(b.x + b.w / 2 - pw / 2), y: b.y - 12 - POPUP_H }
    else pos = { x: fitsX(W / 2 - pw / 2), y: H - POPUP_H - EDGE }
    setPopup({ ...pos, w: pw })
  }, [])

  // ---- the wall itself ----
  useEffect(() => {
    const canvas = canvasRef.current
    const root = rootRef.current
    const mine = loadMine()
    mineRef.current = mine
    setMineCount(mine.length)
    const wall = createWall(canvas, {
      regulars: regularsRef.current,
      // a sideways swipe browses the strip anywhere on the wall, buttons and labels included
      surface: root,
      mine,
      reducedMotion: reduced(),
      onLabels: setLabels,
      // the labels, the visitor's canvas and the popup ride the pan (a CSS transform, no render)
      onPan: (x) => root.style.setProperty('--sw-pan', `${x}px`),
      // at rest the wall takes paint: the hint shows, the cursor says so, a finger draws
      onRest: (rest) => {
        root.toggleAttribute('data-resting', rest)
        if (rest) canvas.setAttribute('data-cursor', 'sign')
        else canvas.removeAttribute('data-cursor')
      },
      // (a new object only when a button comes or goes)
      onNav: setNav,
      onStrokeStart: () => {
        clearTimeout(idleRef.current)
        setPopup(null)
      },
      onStrokeEnd: ({ forced }) => {
        clearTimeout(idleRef.current)
        idleRef.current = setTimeout(openPopup, forced ? 0 : IDLE_MS)
      },
    })
    wallRef.current = wall
    wall.resize()

    // Until then the wall waits on its dense stretch; once about 80% of it is in view (80% of the
    // screen, for a wall taller than the screen) it pans home by itself, once, and rests there.
    // Unless the visitor takes the pan first (or along the way): then it stops where it is.
    let progress = 0
    let played = false
    let playRaf = 0
    const play = () => {
      if (played || wall.manual) return
      played = true
      const t0 = performance.now()
      const step = (now) => {
        if (wall.manual) return
        progress = Math.min(1, (now - t0) / PAN_MS)
        wall.setScroll(progress)
        if (progress < 1) playRaf = requestAnimationFrame(step)
      }
      playRaf = requestAnimationFrame(step)
    }
    wall.setScroll(0)
    const onResize = () => {
      wall.resize()
      wall.setScroll(progress)
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(canvas)
    // the regulars' sprites are painted a few screens before the wall comes into view
    const near = new IntersectionObserver(
      (list) => {
        if (list[list.length - 1].isIntersecting) wall.prepare()
      },
      { rootMargin: '0px 0px 300% 0px' },
    )
    near.observe(root)
    const inView = new IntersectionObserver(
      (list) => {
        const e = list[list.length - 1]
        if (e.intersectionRect.height >= SHOWN * Math.min(root.offsetHeight, window.innerHeight)) play()
      },
      { threshold: Array.from({ length: 21 }, (_, i) => i / 20) },
    )
    inView.observe(root)
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(idleRef.current)
      cancelAnimationFrame(playRaf)
      ro.disconnect()
      near.disconnect()
      inView.disconnect()
      window.removeEventListener('resize', onResize)
      wall.destroy()
      wallRef.current = null
    }
  }, [openPopup])

  useEffect(() => {
    if (popup && finePointer()) nameRef.current?.focus({ preventScroll: true })
  }, [popup])

  // A browse button that steps aside while focused (the far left; home) hands the focus to the
  // other one, so the keyboard keeps its place. The browser may already have dropped it by now
  // (a hidden button can't keep focus; with reduced motion there is no fade to wait out), so the
  // button that had it is remembered through that (navFocusRef, kept by onNavBlur).
  useLayoutEffect(() => {
    const at = document.activeElement
    const from = at === leftRef.current ? 'left' : at === rightRef.current ? 'right' : navFocusRef.current
    if (!(from === 'left' ? !nav.left : from === 'right' ? !nav.right : false)) return
    navFocusRef.current = null
    const to = from === 'left' ? nav.right && rightRef.current : nav.left && leftRef.current
    if (to) to.focus({ preventScroll: true })
  }, [nav])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    if (!confirmErase) return
    const t = setTimeout(() => setConfirmErase(false), 3200)
    return () => clearTimeout(t)
  }, [confirmErase])

  // ---- popup actions ----
  const finish = (withWords) => {
    const wall = wallRef.current
    if (!wall) return
    const entry = wall.commit(withWords ? { name, msg } : {})
    const at = popup
    setPopup(null)
    setName('')
    setMsg('')
    if (!entry) return
    let mine = mineRef.current.concat(entry)
    if (mine.length > MAX_MINE) {
      mine = mine.slice(-MAX_MINE)
      wall.setMine(mine)
    }
    mineRef.current = mine
    setMineCount(mine.length)
    const stored = saveMine(mine)
    if (at) setToast({ x: at.x, y: at.y + 24, w: at.w, text: stored ? "you're on the wall." : 'signed, for this visit.' })
  }

  const redo = () => {
    wallRef.current?.discard()
    setPopup(null)
    setName('')
    setMsg('')
  }

  const erase = () => {
    if (!confirmErase) return setConfirmErase(true)
    setConfirmErase(false)
    mineRef.current = []
    setMineCount(0)
    saveMine([])
    wallRef.current?.setMine([])
  }

  const onPopupKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      finish(false)
    }
  }

  // ---- browsing ----
  // with a browse button focused, the arrow keys move along the strip (a smaller step than a press)
  const onNavKey = (e) => {
    const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
    if (!dir || e.altKey || e.ctrlKey || e.metaKey) return
    e.preventDefault()
    wallRef.current?.browse(dir, true)
  }
  // (the focus stays remembered only when the button lost it by being hidden, to nowhere)
  const onNavBlur = (e) => {
    if (e.relatedTarget || getComputedStyle(e.currentTarget).visibility !== 'hidden') navFocusRef.current = null
  }

  // ---- "hold to sign" (phones) ----
  // held: the wall lets a finger paint (and stops the page scrolling under it, [data-signing]);
  // let go, or the press taken away: back to browsing, and the finger's stroke ends
  const setHold = (held) => {
    setHolding(held)
    rootRef.current?.toggleAttribute('data-signing', held)
    wallRef.current?.setSignHeld(held)
  }
  const startHold = (e) => {
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // capture keeps the release coming here; without it the release still lands on the button
    }
    setHold(true)
  }
  const endHold = () => setHold(false)

  return (
    <section ref={rootRef} className={`sign-wall ${className}`} aria-label="Visitor sign wall">
      <p className="sign-wall__hint" aria-hidden="true">
        <span className="sign-wall__hint-fine">drag to sign the wall.</span>
        <span className="sign-wall__hint-touch">hold the button and draw to sign.</span>
      </p>

      <canvas ref={regularsRef} className="sign-wall__canvas sign-wall__canvas--regulars" aria-hidden="true" />
      <canvas
        ref={canvasRef}
        className="sign-wall__canvas sign-wall__canvas--yours"
        role="img"
        aria-label="A wall of painted signatures. Draw on it to add yours."
      />

      <ul className="sign-wall__labels">
        {labels.map((l) => (
          <li
            key={l.id}
            className={`sign-wall__label${l.above ? ' is-above' : ''}${l.mine ? ' is-mine' : ''}`}
            style={{ left: `${l.x}px`, top: `${l.y}px` }}
          >
            <span className="sign-wall__label-name">
              {l.name || (l.mine ? 'you' : 'someone')}
              {l.mine && l.name ? <span className="sign-wall__you"> (you)</span> : null}
              <span className="sign-wall__label-date"> · {when(l.t)}</span>
            </span>
            {l.msg ? <span className="sign-wall__label-msg">“{l.msg}”</span> : null}
          </li>
        ))}
      </ul>

      <header className="sign-wall__bar">
        <p className="sign-wall__title">
          visitors' wall <span className="sign-wall__count">· leave your mark</span>
        </p>
        {mineCount > 0 ? (
          <button type="button" className={`sign-wall__erase${confirmErase ? ' is-confirm' : ''}`} onClick={erase}>
            {confirmErase ? 'sure? erase' : mineCount > 1 ? 'erase mine' : 'erase my mark'}
          </button>
        ) : null}
      </header>

      {/* Both always there, so focus can pass between them; a hidden one is out of reach. */}
      <button
        ref={leftRef}
        type="button"
        className={`sign-wall__nav sign-wall__nav--left${nav.left ? ' is-shown' : ''}`}
        onClick={() => wallRef.current?.browse(-1)}
        onKeyDown={onNavKey}
        onFocus={() => (navFocusRef.current = 'left')}
        onBlur={onNavBlur}
        tabIndex={nav.left ? 0 : -1}
        aria-hidden={!nav.left}
      >
        <span aria-hidden="true">←</span> more signatures
      </button>
      <button
        ref={rightRef}
        type="button"
        className={`sign-wall__nav sign-wall__nav--right${nav.right ? ' is-shown' : ''}`}
        onClick={() => wallRef.current?.home()}
        onKeyDown={onNavKey}
        onFocus={() => (navFocusRef.current = 'right')}
        onBlur={onNavBlur}
        tabIndex={nav.right ? 0 : -1}
        aria-hidden={!nav.right}
      >
        back to sign <span aria-hidden="true">→</span>
      </button>

      {/* Phones: a finger on the wall browses and scrolls; it paints only while this is held
          (one thumb here, another finger drawing). Shown on touch screens at home only. */}
      <button
        type="button"
        className={`sign-wall__hold${holding ? ' is-held' : ''}`}
        aria-pressed={holding}
        onPointerDown={startHold}
        onPointerUp={endHold}
        onPointerCancel={endHold}
        onLostPointerCapture={endHold}
        onContextMenu={(e) => e.preventDefault()}
      >
        <span aria-hidden="true">✎</span> {holding ? 'signing, draw now' : 'hold to sign'}
      </button>

      {popup ? (
        <form
          className="sign-wall__popup"
          style={{ left: `${popup.x}px`, top: `${popup.y}px`, width: `${popup.w}px` }}
          onSubmit={(e) => {
            e.preventDefault()
            finish(true)
          }}
          onKeyDown={onPopupKey}
          aria-label="Sign your mark"
        >
          <p className="sign-wall__popup-title">nice. who left this?</p>
          <label className="sign-wall__field">
            <span>name</span>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder="optional"
              autoComplete="nickname"
              enterKeyHint="next"
            />
          </label>
          <label className="sign-wall__field">
            <span>note</span>
            <input
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              maxLength={80}
              placeholder="a few words, optional"
              autoComplete="off"
              enterKeyHint="done"
            />
          </label>
          <div className="sign-wall__actions">
            <button type="button" className="sign-wall__redo" onClick={redo}>
              redo
            </button>
            <button type="button" className="sign-wall__skip" onClick={() => finish(false)}>
              skip
            </button>
            <button type="submit" className="sign-wall__save">
              save
            </button>
          </div>
        </form>
      ) : null}

      {toast ? (
        <p className="sign-wall__toast" role="status" style={{ left: `${toast.x}px`, top: `${toast.y}px`, width: `${toast.w}px` }}>
          {toast.text}
        </p>
      ) : null}
    </section>
  )
}

function when(t) {
  const d = Date.now() - t
  if (d < 60e3) return 'just now'
  if (d < 3600e3) return `${Math.floor(d / 60e3)}m ago`
  if (d < 86400e3) return `${Math.floor(d / 3600e3)}h ago`
  if (d < 7 * 86400e3) return `${Math.floor(d / 86400e3)}d ago`
  return new Date(t).toLocaleDateString('en', { month: 'short', day: 'numeric' }).toLowerCase()
}
