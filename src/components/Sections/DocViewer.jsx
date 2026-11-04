// An entry's documents (entry.docs), each opening in a viewer over the page: underlined links under the
// entry's points, like its site link. A doc is { label, report } or { label, deck }:
//   report  { title, pages: [img urls], pdf, width, height }: the paper's pages one under another,
//           scrolled up and down, with the page you're on counted and the PDF a press away
//   deck    { title, slides } (src/content/cspDeck.js): a presentation, one slide at a time, moved
//           left and right (the arrows, ← → / PageUp PageDown, Home End, a swipe or a sideways scroll),
//           and on screens that allow it, fullscreen
// The viewer is a native modal <dialog>, like the video player's (VideoOverlay.jsx): the page behind is
// dimmed and inert, and the ×, Escape and a press on the dim area around it close it.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { TABLES } from '../../content/cspDeck.js'
import { holdPage, releasePage } from '../../lib/scrollLock.js'
import './DocViewer.css'

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

const Icon = ({ children }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
    {children}
  </svg>
)
const CloseIcon = () => (
  <Icon>
    <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" fill="none" />
  </Icon>
)
const ArrowIcon = ({ back = false }) => (
  <Icon>
    <path
      d={back ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </Icon>
)
const FullscreenIcon = ({ on }) => (
  <Icon>
    <path
      d={on ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'}
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </Icon>
)

/** The links, under the entry's points; each holds its own viewer. */
export default function DocLinks({ docs }) {
  if (!docs?.length) return null
  return (
    <div className="docs">
      {docs.map((doc) => (
        <DocLink key={doc.label} doc={doc} />
      ))}
    </div>
  )
}

function DocLink({ doc }) {
  const linkRef = useRef(null)
  const dialogRef = useRef(null)
  const downOnBackdrop = useRef(false)
  const titleId = useId()
  const [open, setOpen] = useState(false)
  const kind = doc.deck ? 'deck' : 'report'

  const show = () => {
    const dialog = dialogRef.current
    if (!dialog || dialog.open) return
    dialog.showModal()
    setOpen(true)
    holdPage(dialogRef)
  }
  const close = () => dialogRef.current?.close()
  const onClose = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    setOpen(false)
    releasePage(dialogRef)
    linkRef.current?.focus({ preventScroll: true })
  }
  // leaving the page with it open (the back button): let the page scroll again
  useEffect(() => {
    if (!open) return undefined
    return () => releasePage(dialogRef)
  }, [open])

  return (
    <>
      <button ref={linkRef} type="button" className="docs__link" onClick={show} aria-haspopup="dialog" data-cursor="read">
        {doc.label}
        <span className="docs__arrow" aria-hidden="true">
          {kind === 'deck' ? '→' : '↗'}
        </span>
      </button>
      <dialog
        ref={dialogRef}
        className={`docview docview--${kind}`}
        aria-labelledby={titleId}
        onClose={onClose}
        onPointerDown={(e) => {
          downOnBackdrop.current = e.target === e.currentTarget
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget && downOnBackdrop.current) close()
        }}
      >
        {/* mounted only while open: the pages and slides load when first asked for */}
        {open &&
          (kind === 'deck' ? (
            <DeckViewer deck={doc.deck} titleId={titleId} onClose={close} />
          ) : (
            <ReportViewer report={doc.report} titleId={titleId} onClose={close} />
          ))}
      </dialog>
    </>
  )
}

function CloseButton({ onClose, what }) {
  return (
    <button type="button" className="docview__btn" onClick={onClose} aria-label={`Close the ${what} (Esc)`}>
      <CloseIcon />
    </button>
  )
}

/* ── the report: pages one under another ── */

function ReportViewer({ report, titleId, onClose }) {
  const { title, pages, pdf, width, height } = report
  const scrollRef = useRef(null)
  const [page, setPage] = useState(1)

  // the page you're on: the one crossing the middle of the view
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return undefined
    const io = new IntersectionObserver(
      (seen) => {
        for (const e of seen) if (e.isIntersecting) setPage(Number(e.target.dataset.page))
      },
      { root, rootMargin: '-50% 0px -50% 0px' },
    )
    for (const el of root.querySelectorAll('[data-page]')) io.observe(el)
    root.focus({ preventScroll: true })
    return () => io.disconnect()
  }, [])

  return (
    <div className="docview__frame">
      <div className="docview__top">
        <p className="docview__title" id={titleId}>
          {title}
        </p>
        <p className="docview__count" aria-live="polite">
          page {page} of {pages.length}
        </p>
        <a className="docview__pdf" href={pdf} target="_blank" rel="noopener noreferrer">
          pdf ↗<span className="docview__offscreen"> (opens the paper as a PDF in a new tab)</span>
        </a>
        <CloseButton onClose={onClose} what="report" />
      </div>
      <div ref={scrollRef} className="docview__pages" tabIndex={-1}>
        {pages.map((src, i) => (
          <img
            key={src}
            className="docview__page"
            data-page={i + 1}
            src={src}
            alt={i === 0 ? `${title}, page 1` : `Page ${i + 1}`}
            width={width}
            height={height}
            loading={i < 2 ? 'eager' : 'lazy'}
            decoding="async"
            draggable="false"
          />
        ))}
      </div>
    </div>
  )
}

/* ── the deck: one slide at a time, side to side ── */

function DeckViewer({ deck, titleId, onClose }) {
  const { title, slides } = deck
  const frameRef = useRef(null)
  const trackRef = useRef(null)
  const [index, setIndex] = useState(0)
  const [reach, setReach] = useState(0) // the furthest slide shown: those up to it (and two past) load
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => setReach((r) => Math.max(r, index)), [index])
  const [canFullscreen] = useState(() => Boolean(document.fullscreenEnabled))

  const go = useCallback(
    (i, smooth = true) => {
      const track = trackRef.current
      if (!track) return
      const to = clamp(i, 0, slides.length - 1)
      track.scrollTo({ left: to * track.clientWidth, behavior: smooth ? 'smooth' : 'instant' })
      setIndex(to)
    },
    [slides.length],
  )

  // the slide on screen follows the track's scroll (a swipe, a trackpad, the scrollbar)
  const onScroll = () => {
    const track = trackRef.current
    if (track?.clientWidth) setIndex(clamp(Math.round(track.scrollLeft / track.clientWidth), 0, slides.length - 1))
  }

  // a resize (or fullscreen) keeps the same slide in view
  useEffect(() => {
    const track = trackRef.current
    if (!track) return undefined
    let at = 0
    const keep = new ResizeObserver(() => {
      track.scrollTo({ left: at * track.clientWidth, behavior: 'instant' })
    })
    const remember = () => {
      if (track.clientWidth) at = Math.round(track.scrollLeft / track.clientWidth)
    }
    track.addEventListener('scroll', remember, { passive: true })
    keep.observe(track)
    track.focus({ preventScroll: true })
    return () => {
      keep.disconnect()
      track.removeEventListener('scroll', remember)
    }
  }, [])

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === frameRef.current)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else frameRef.current?.requestFullscreen?.().catch(() => {})
  }

  const onKeyDown = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const step = { ArrowRight: 1, PageDown: 1, ArrowLeft: -1, PageUp: -1 }[e.key]
    if (step) go(index + step)
    else if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) go(index + (e.shiftKey ? -1 : 1))
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(slides.length - 1)
    else if (e.key === 'f' || e.key === 'F') toggleFullscreen()
    else return
    e.preventDefault()
    e.stopPropagation() // not also the page's own keys (K is the music's)
  }

  return (
    <div ref={frameRef} className={`docview__frame${fullscreen ? ' is-fullscreen' : ''}`} onKeyDown={onKeyDown}>
      <div className="docview__top">
        <p className="docview__title" id={titleId}>
          {title}
        </p>
        <p className="docview__count" aria-live="polite">
          {index + 1} / {slides.length}
        </p>
        {canFullscreen && (
          <button
            type="button"
            className="docview__btn docview__fs"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? 'Exit fullscreen (f)' : 'Present fullscreen (f)'}
          >
            <FullscreenIcon on={fullscreen} />
          </button>
        )}
        <CloseButton onClose={onClose} what="presentation" />
      </div>

      <div className="deck">
        <div
          ref={trackRef}
          className="deck__track"
          onScroll={onScroll}
          tabIndex={-1}
          aria-roledescription="carousel"
          aria-label={title}
        >
          {slides.map((slide, i) => (
            <section
              key={i}
              className="deck__cell"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${slides.length}`}
              aria-hidden={Math.abs(i - index) > 0 ? 'true' : undefined}
            >
              <Slide slide={slide} n={i + 1} near={i <= reach + 2 || Math.abs(i - index) <= 2} />
            </section>
          ))}
        </div>
        <button
          type="button"
          className="deck__nav deck__nav--prev"
          onClick={() => go(index - 1)}
          disabled={index === 0}
          aria-label="Previous slide (←)"
        >
          <ArrowIcon back />
        </button>
        <button
          type="button"
          className="deck__nav deck__nav--next"
          onClick={() => go(index + 1)}
          disabled={index === slides.length - 1}
          aria-label="Next slide (→)"
        >
          <ArrowIcon />
        </button>
      </div>

      <div className="deck__progress" aria-hidden="true">
        <span style={{ '--p': (index + 1) / slides.length }} />
      </div>
    </div>
  )
}

/* ── one slide ── */

function Bullets({ items }) {
  if (!items?.length) return null
  return (
    <ul className="slide__bullets">
      {items.map((b) => {
        if (typeof b === 'string') return <li key={b}>{b}</li>
        return (
          <li key={b.text}>
            {b.text}
            <ul className="slide__sub">
              {b.sub.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </li>
        )
      })}
    </ul>
  )
}

function SlideTable({ name, mark }) {
  const t = TABLES[name]
  return (
    <figure className={`slide__table slide__table--${name}`}>
      <div className="slide__table-scroll">
        <table>
          <thead>
            <tr>
              {t.head.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r, i) => (
              <tr key={r[0]} className={i === mark ? 'is-marked' : undefined}>
                {r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <figcaption>{t.caption}</figcaption>
    </figure>
  )
}

/** `near`: the slide is shown, has been, or is about to be; only then does it ask for its images. */
function SlideImg({ img, alt, near }) {
  return <img src={near ? img : undefined} alt={alt} decoding="async" draggable="false" />
}

function Media({ media, near }) {
  if (!media) return null
  if (media.table) return <SlideTable name={media.table} mark={media.mark} />
  return (
    <figure className={`slide__media slide__media--${media.fit ?? 'photo'}${media.bare ? ' is-bare' : ''}`}>
      <SlideImg img={media.img} alt={media.alt} near={near} />
    </figure>
  )
}

function Slide({ slide, n, near }) {
  const s = slide
  const cls = `slide slide--${s.kind}${s.subject ? ` subj-${s.subject}` : ''}${s.wide ? ' is-wide' : ''}${s.media ? ' has-media' : ''}`
  const tag = s.subject && s.kind !== 'section' && <p className="slide__tag">{SUBJECT[s.subject]}</p>

  let body
  switch (s.kind) {
    case 'cover':
      body = (
        <div className="slide__split">
          <div className="slide__copy">
            <p className="slide__kicker">{s.kicker}</p>
            <h2 className="slide__rq">{s.title}</h2>
            <p className="slide__people">{s.people}</p>
            <p className="slide__people slide__people--soft">{s.mentor}</p>
          </div>
          <figure className="slide__media slide__media--cover">
            <SlideImg img={s.img} alt={s.alt} near={near} />
          </figure>
        </div>
      )
      break
    case 'questions':
      body = (
        <>
          <h2 className="slide__title">{s.title}</h2>
          <ol className="slide__questions">
            {s.items.map(([key, name, q]) => (
              <li key={key} className={`subj-${key}`}>
                <span className="slide__q-name">{name}</span>
                {q}
              </li>
            ))}
          </ol>
        </>
      )
      break
    case 'section':
      body = (
        <>
          <h2 className="slide__section">{s.title}</h2>
          <p className="slide__section-rq">
            <span>Research question</span>
            {s.rq}
          </p>
        </>
      )
      break
    case 'pair':
      body = (
        <>
          {tag}
          <h2 className="slide__title">{s.title}</h2>
          <div className="slide__pair">
            {s.items.map(([name, what]) => (
              <div key={name}>
                <p className="slide__pair-name">{name}</p>
                <p>{what}</p>
              </div>
            ))}
          </div>
        </>
      )
      break
    case 'columns':
      body = (
        <>
          {tag}
          <h2 className="slide__title">{s.title}</h2>
          <div className="slide__cols" style={{ '--cols': s.cols.length }}>
            {s.cols.map(([name, items]) => (
              <div key={name} className="slide__col">
                <p className="slide__col-name">{name}</p>
                <Bullets items={items} />
              </div>
            ))}
          </div>
          {s.foot && <p className="slide__foot">{s.foot}</p>}
        </>
      )
      break
    case 'gallery':
      body = (
        <>
          {tag}
          <h2 className="slide__title">{s.title}</h2>
          <ul className={`slide__gallery${s.tall ? ' is-tall' : ''}`}>
            {s.imgs.map((g) => (
              <li key={g.label}>
                <SlideImg img={g.img} alt={g.alt} near={near} />
                <span>{g.label}</span>
              </li>
            ))}
          </ul>
        </>
      )
      break
    case 'refs':
      body = (
        <>
          <h2 className="slide__title">{s.title}</h2>
          <ol className="slide__refs">
            {s.refs.map((r) => (
              <li key={r}>
                <a href={r} target="_blank" rel="noopener noreferrer">
                  {r.replace(/^https?:\/\/(www\.)?/, '')}
                </a>
              </li>
            ))}
          </ol>
        </>
      )
      break
    case 'end':
      body = (
        <>
          <h2 className="slide__section">{s.title}</h2>
          <p className="slide__people">{s.sub}</p>
        </>
      )
      break
    default:
      body = s.media ? (
        <>
          {tag}
          <h2 className="slide__title">{s.title}</h2>
          <div className={`slide__split${s.media.table ? ' has-table' : ''}`}>
            {s.bullets && (
              <div className="slide__copy">
                <Bullets items={s.bullets} />
              </div>
            )}
            <Media media={s.media} near={near} />
          </div>
          {s.foot && <p className="slide__foot">{s.foot}</p>}
        </>
      ) : (
        <>
          {tag}
          <h2 className="slide__title">{s.title}</h2>
          <Bullets items={s.bullets} />
          {s.foot && <p className="slide__foot">{s.foot}</p>}
        </>
      )
  }

  return (
    <div className={cls}>
      {body}
      <span className="slide__n" aria-hidden="true">
        {n}
      </span>
    </div>
  )
}

const SUBJECT = {
  physics: 'Physics',
  ess: 'Environmental systems & societies',
  chemistry: 'Chemistry',
  biology: 'Biology',
  cs: 'Computer science',
}
