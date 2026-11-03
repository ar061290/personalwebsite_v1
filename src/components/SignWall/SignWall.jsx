// The visitor sign wall, below the footer: a strip of paper (the page's own, light or black)
// that is drawable straight away with akm2's paint brush (a new random colour on every stroke).
// When the visitor stops drawing for a moment, a small popup asks for a name and a note (both
// optional). Their signatures live in this browser's localStorage, beside a curated set of
// regulars so the wall is never empty. The canvas is transparent, so a theme change needs no
// redraw: the paper underneath changes and the paint keeps its colours.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createWall } from './wall.js'
import { loadMine, MAX_MINE, saveMine } from './store.js'
import './SignWall.css'

const IDLE_MS = 1100 // after the last stroke, before the popup asks for a name
const POPUP_W = 280
const POPUP_H = 200
const EDGE = 12

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const finePointer = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches

export default function SignWall({ className = '' }) {
  const rootRef = useRef(null)
  const canvasRef = useRef(null)
  const wallRef = useRef(null)
  const mineRef = useRef([])
  const idleRef = useRef(0)
  const nameRef = useRef(null)
  const [labels, setLabels] = useState([])
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
      mine,
      reducedMotion: reduced(),
      onLabels: setLabels,
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

    const ro = new ResizeObserver(() => wall.resize())
    ro.observe(canvas)
    // the regulars paint themselves in the first time the wall comes into view
    const io = new IntersectionObserver(
      (list) => {
        if (list.some((e) => e.isIntersecting)) {
          wall.reveal()
          io.disconnect()
        }
      },
      { threshold: 0.3 },
    )
    io.observe(root)
    return () => {
      clearTimeout(idleRef.current)
      ro.disconnect()
      io.disconnect()
      wall.destroy()
      wallRef.current = null
    }
  }, [openPopup])

  useEffect(() => {
    if (popup && finePointer()) nameRef.current?.focus({ preventScroll: true })
  }, [popup])

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

  return (
    <section ref={rootRef} className={`sign-wall ${className}`} aria-label="Visitor sign wall">
      <p className="sign-wall__hint" aria-hidden="true">
        <span className="sign-wall__hint-fine">drag to sign the wall.</span>
        <span className="sign-wall__hint-touch">draw here to sign the wall.</span>
      </p>

      <canvas
        ref={canvasRef}
        className="sign-wall__canvas"
        data-cursor="sign"
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
