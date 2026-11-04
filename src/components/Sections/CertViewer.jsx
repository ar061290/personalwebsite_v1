// The certificate behind an award or a course, opened over the page: the "view" button by its year
// (ContentPage.jsx) and the viewer it opens, a native modal <dialog> like the documents' viewer
// (DocViewer.jsx, whose dialog styles it shares): the page behind dimmed and inert, the ×, Escape or a
// press anywhere off the certificates closing it. The certificates are the site's own copies
// (src/assets/certificates, WebP renders of the originals), drawn as large as the screen allows, all
// the same size:
//   1: alone · 2: side by side · 3: two above one · 4: two by two · 5: three above two
// (rows of at most ceil(n / 2), the shorter one centred). On a phone they stack and scroll. A list
// marked `pages` is one document over several pages (counted as pages, not certificates).
//
// With more than one, pressing a certificate brings it forward, like the speaker in a video call: it
// takes most of the screen and the others line up in a column beside it; pressing one of those swaps
// it in, pressing the big one goes back to the grid. Each certificate glides from where it was to
// where it goes (FLIP: measured before and after, then animated back from the old place).
//
// It fades up as it opens and back down as it closes (CertViewer.css). The pictures are decoded before
// it opens (from the moment the button is hovered or focused), so the fade never stalls on them.
// The dialog is mounted on <body>: the button sits inside a line of text, where a dialog can't.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { holdPage, releasePage } from '../../lib/scrollLock.js'
import './CertViewer.css'

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
    <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" fill="none" />
  </svg>
)

const GLIDE = { duration: 460, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' } // a certificate changing place
const DECODE_WAIT = 350 // ms the opening waits, at most, for the pictures to be decoded
const NARROW = '(max-width: 640px)' // phones: stacked, no speaker view

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// anywhere but a certificate itself (the dim area, the gaps between them, the top bar's text)
const isOutside = (target) => !(target instanceof Element && target.closest('.certs__cell img'))

/** Splits n certificates into rows: one row for one or two, else two rows, the longer on top. */
function rowsOf(certs) {
  if (certs.length <= 2) return [certs]
  const top = Math.ceil(certs.length / 2)
  return [certs.slice(0, top), certs.slice(top)]
}

export default function CertViewer({ certs, what }) {
  const buttonRef = useRef(null)
  const dialogRef = useRef(null)
  const gridRef = useRef(null)
  const downOutside = useRef(false) // a press that began off the certificates (a drag ending there is not a close)
  const titleId = useId()
  const [open, setOpen] = useState(false)
  const [focus, setFocus] = useState(null) // the certificate brought forward, or null: the grid
  const rows = rowsOf(certs)
  const perRow = rows[0].length
  const many = certs.length > 1

  // decoded ahead of time: hovering or focusing the button starts it, opening waits a moment for it
  const warm = useRef(null)
  const warmUp = () => {
    warm.current ??= Promise.all(
      certs.map((src) => {
        const img = new Image()
        img.decoding = 'async'
        img.src = src
        return img.decode().catch(() => {})
      }),
    )
    return warm.current
  }

  const show = async () => {
    const dialog = dialogRef.current
    if (!dialog || dialog.open) return
    await Promise.race([warmUp(), new Promise((r) => setTimeout(r, DECODE_WAIT))])
    if (dialog.open) return
    setFocus(null)
    dialog.showModal()
    setOpen(true)
    holdPage(dialogRef)
  }
  // Closing plays the way out first (the panel fades and sinks, the veil lifts: CertViewer.css) and
  // only then closes the dialog; with reduced motion it closes at once.
  const leaving = useRef(0)
  const close = () => {
    const dialog = dialogRef.current
    if (!dialog?.open || leaving.current) return
    if (reducedMotion()) {
      dialog.close()
      return
    }
    dialog.classList.add('is-closing')
    const done = () => {
      clearTimeout(leaving.current)
      leaving.current = 0
      dialog.removeEventListener('animationend', onEnd)
      dialog.classList.remove('is-closing')
      dialog.close()
    }
    const onEnd = (e) => e.target === dialog && done()
    dialog.addEventListener('animationend', onEnd)
    leaving.current = setTimeout(done, 400) // in case the animation never reports its end
  }
  const onClose = () => {
    setOpen(false)
    setFocus(null)
    releasePage(dialogRef)
    buttonRef.current?.focus({ preventScroll: true })
  }
  // leaving the page with it open (the back button): let the page scroll again
  useEffect(() => {
    if (!open) return undefined
    return () => releasePage(dialogRef)
  }, [open])

  // the glide between the grid and the speaker view: where each picture was, just before the change
  const before = useRef(null)
  const pick = (i) => {
    if (!many || window.matchMedia(NARROW).matches) return
    const next = focus === i ? null : i
    if (!reducedMotion() && gridRef.current) {
      before.current = new Map(
        [...gridRef.current.querySelectorAll('img[data-n]')].map((img) => [img.dataset.n, img.getBoundingClientRect()]),
      )
    }
    setFocus(next)
  }
  useLayoutEffect(() => {
    const was = before.current
    before.current = null
    if (!was || !gridRef.current) return
    for (const img of gridRef.current.querySelectorAll('img[data-n]')) {
      const a = was.get(img.dataset.n)
      const b = img.getBoundingClientRect()
      if (!a || !b.width || !b.height) continue
      const dx = a.left + a.width / 2 - (b.left + b.width / 2)
      const dy = a.top + a.height / 2 - (b.top + b.height / 2)
      const s = a.width / b.width
      img.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: 'none' }], GLIDE)
    }
  }, [focus])

  const label = (i) =>
    many ? `${what}: ${certs.pages ? 'page' : 'certificate'} ${i + 1} of ${certs.length}` : `Certificate: ${what}`
  const picture = (src) => {
    const i = certs.indexOf(src)
    return (
      <figure key={src} className={`certs__cell${focus === i ? ' is-focus' : ''}`}>
        <img
          src={src}
          alt={label(i)}
          data-n={i}
          decoding="async"
          draggable="false"
          onClick={() => pick(i)}
          title={many ? (focus === i ? 'back to all' : 'bring forward') : undefined}
        />
      </figure>
    )
  }

  const unit = certs.pages ? 'pages' : 'certificates'
  const count = many ? `${certs.length} ${unit}` : null
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="cpage__view"
        onClick={show}
        onPointerEnter={warmUp}
        onFocus={warmUp}
        aria-haspopup="dialog"
        aria-label={`View ${count ?? 'the certificate'}: ${what}`}
      >
        view
      </button>
      {createPortal(
        <dialog
          ref={dialogRef}
          className="docview docview--certs"
          aria-labelledby={titleId}
          onClose={onClose}
          onCancel={(e) => {
            // Escape: the same way out as the × and a press outside
            e.preventDefault()
            close()
          }}
          onPointerDown={(e) => {
            downOutside.current = isOutside(e.target)
          }}
          onClick={(e) => {
            if (downOutside.current && isOutside(e.target)) close()
          }}
        >
          <div className="docview__frame">
            <div className="docview__top">
              <p className="docview__title" id={titleId}>
                {what}
              </p>
              {count && <p className="docview__count">{count}</p>}
              <button type="button" className="docview__btn" onClick={close} aria-label="Close (Esc)">
                <CloseIcon />
              </button>
            </div>
            {/* the pictures mount once it has been opened (already decoded by then) */}
            {open && focus === null && (
              <div
                ref={gridRef}
                className={`certs${many ? ' is-many' : ''}`}
                style={{ '--rows': rows.length, '--per-row': perRow }}
              >
                {rows.map((row, r) => (
                  <div key={r} className="certs__row">
                    {row.map(picture)}
                  </div>
                ))}
              </div>
            )}
            {open && focus !== null && (
              <div ref={gridRef} className="certs certs--speaker is-many">
                <div className="certs__main">{picture(certs[focus])}</div>
                <div className="certs__side">{certs.filter((_, i) => i !== focus).map(picture)}</div>
              </div>
            )}
          </div>
        </dialog>,
        document.body,
      )}
    </>
  )
}
