// One page of the site (academics, research, projects, ashwa, drama, leadership),
// typeset from a src/content/*.js object. Besides the usual fields, a section may hang
// stickers, a slideshow, a video (VideoOverlay.jsx) or a pair of reels (section.reels, with
// section.reelsNote) under its label, and an entry may carry a link to its own site (entry.site,
// also beside its title with site.byTitle) and an aside of its own (entry.aside: { video },
// { sticker } or { inference }, the ML internship's figure in InferenceGraphic.jsx) that hangs in the
// left column level with it, rather than under the label for the whole section. A page may also set
// headArt, a figure beside its big title (HEAD_ART below; the research page's lattice, Lattice.jsx).
// An entry with an `id` can be linked to (/page#id), and one with `orgTo` links its grey org line there.
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import ScribbleLink from '../Header/Scribble.jsx'
import { AutoSlideshow, EntrySticker, LogoStickers, ReelCards } from './SectionSide.jsx'
import VideoCard from './VideoOverlay.jsx'
import InferenceGraphic from './InferenceGraphic.jsx'
import Lattice from './Lattice.jsx'
import { useTheme } from '../../lib/theme.js'
import './ContentPage.css'

function EntryLinks({ links }) {
  if (!links?.length) return null
  return (
    <p className="cpage__links">
      {links.map((l, i) =>
        l.to ? (
          <ScribbleLink key={l.label} to={l.to} loop={i}>
            {l.label} →
          </ScribbleLink>
        ) : (
          <ScribbleLink key={l.label} href={l.href} loop={i} target="_blank" rel="noopener noreferrer">
            {l.label} ↗
          </ScribbleLink>
        ),
      )}
    </p>
  )
}

/** The certificate behind an award or a course: a small grey link before its year. */
function ViewLink({ href, what }) {
  return (
    <a className="cpage__view" href={href} target="_blank" rel="noopener noreferrer" aria-label={`View certificate: ${what}`}>
      view ↗
    </a>
  )
}

/**
 * An entry's own site (entry.site): underlined text that still reads as the thing to press. Under the
 * entry's points, and (`byTitle`, site.byTitle) also in its header, straight after the title's last
 * word: a span there, inside the title's line.
 */
function SiteLink({ site, byTitle = false }) {
  if (!site?.href) return null
  const Tag = byTitle ? 'span' : 'p'
  return (
    <Tag className={`cpage__site${byTitle ? ' cpage__site--title' : ''}`}>
      <a href={site.href} target="_blank" rel="noopener noreferrer" data-cursor="visit">
        {site.label}
        <span className="cpage__site-arrow" aria-hidden="true">
          ↗
        </span>
        <span className="cpage__offscreen"> (opens in a new tab)</span>
      </a>
    </Tag>
  )
}

// one column (ContentPage.css's own breakpoint): an entry's sticker moves from the left column into
// the corner of the entry's text
const NARROW = '(max-width: 860px)'
const watchNarrow = (notify) => {
  const mq = window.matchMedia(NARROW)
  mq.addEventListener('change', notify)
  return () => mq.removeEventListener('change', notify)
}
const isNarrow = () => window.matchMedia(NARROW).matches
const useNarrow = () => useSyncExternalStore(watchNarrow, isNarrow, () => false)

/**
 * `sticker`: an aside sticker floated into the text, which wraps round it; `figure`: an aside figure
 * (the inference graphic) drawn under the text, full width (both on phones only).
 */
function Entry({ entry, sticker, figure }) {
  // with site.byTitle the title runs inline in one block with the link after it, so the link follows
  // the title's last word and drops to a line of its own only when there is no room
  const title = <h3 className="cpage__entry-title">{entry.title}</h3>
  const head = (
    <header className="cpage__entry-head">
      {entry.site?.byTitle ? (
        <div className="cpage__entry-name">
          {title}
          <SiteLink site={entry.site} byTitle />
        </div>
      ) : (
        title
      )}
      {(entry.when || entry.view) && (
        <p className="cpage__when">
          {entry.view && <ViewLink href={entry.view} what={entry.title} />}
          {entry.when}
        </p>
      )}
    </header>
  )
  const body = <EntryBody entry={entry} />
  if (figure) {
    return (
      <article className="cpage__entry" id={entry.id}>
        {head}
        {body}
        <div className="cpage__entry-figure">
          <InferenceGraphic figure={figure} />
        </div>
      </article>
    )
  }
  if (sticker) {
    return (
      <article className="cpage__entry" id={entry.id}>
        {head}
        <div className="cpage__entry-row">
          <EntrySticker sticker={sticker} />
          {body}
        </div>
      </article>
    )
  }
  return (
    <article className="cpage__entry" id={entry.id}>
      {head}
      {body}
    </article>
  )
}

function EntryBody({ entry }) {
  return (
    <>
      {(entry.org || entry.place) && (
        <p className="cpage__org">
          {entry.org && entry.orgTo ? (
            <Link className="cpage__org-link" to={entry.orgTo}>
              {entry.org}
            </Link>
          ) : (
            entry.org
          )}
          {entry.org && entry.place ? ' · ' : ''}
          {entry.place}
        </p>
      )}
      {entry.note && <p className="cpage__note">{entry.note}</p>}
      {entry.tags?.length > 0 && (
        <ul className="cpage__tags" aria-label="Built with">
          {entry.tags.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      {entry.grades?.length > 0 && (
        <dl className="cpage__grades">
          {entry.grades.map((g) => (
            <div key={g.k}>
              <dt>{g.k}</dt>
              <dd>{g.v}</dd>
            </div>
          ))}
        </dl>
      )}
      {entry.points?.length > 0 && (
        <ul className="cpage__points">
          {entry.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <EntryLinks links={entry.links} />
      <SiteLink site={entry.site} />
    </>
  )
}

function SectionList({ list }) {
  if (!list?.length) return null
  return (
    <ul className="cpage__list">
      {list.map((item) => (
        <li key={item.title}>
          <span className="cpage__list-title">{item.title}</span>
          {item.org && <span className="cpage__list-org">{item.org}</span>}
          <span className="cpage__list-view">{item.view && <ViewLink href={item.view} what={item.title} />}</span>
          {item.when && <span className="cpage__list-when">{item.when}</span>}
        </li>
      ))}
    </ul>
  )
}

/** The section's label, then whatever the section hangs under it (SectionSide.jsx, VideoOverlay.jsx). */
function SectionHead({ section, index }) {
  return (
    <>
      <h2 className="cpage__section-title">
        <span className="cpage__section-num">{String(index + 1).padStart(2, '0')}</span>
        {section.heading}
      </h2>
      {section.video && <VideoCard video={section.video} />}
      {section.stickers?.length > 0 && <LogoStickers items={section.stickers} />}
      {section.slides?.length > 0 && <AutoSlideshow slides={section.slides} label={section.slidesLabel} />}
      {section.reels?.length > 0 && <ReelCards reels={section.reels} note={section.reelsNote} />}
    </>
  )
}

/** What an entry hangs beside itself in the left column (entry.aside). */
function EntryAside({ aside }) {
  return (
    <>
      {aside.video && <VideoCard video={aside.video} />}
      {aside.sticker && <EntrySticker sticker={aside.sticker} />}
      {aside.inference && <InferenceGraphic figure={aside.inference} />}
    </>
  )
}

/**
 * A section whose entries carry their own asides, laid out in rows: each entry with its aside level
 * with it in the left column, so an aside only stays (sticky) beside its own entry and never drifts
 * down beside the next. The first row's left cell also carries the label and what the section hangs
 * under it. On phones a sticker moves into its entry's text (Entry), the inference figure goes under
 * its entry's text (it explains what was just read, so after it, full width), and a video stays in
 * the cell above its entry.
 */
function RowsSection({ section, index }) {
  const narrow = useNarrow()
  return (
    <section className="cpage__section cpage__section--rows" style={{ '--i': index + 3 }}>
      {section.entries.map((entry, i) => {
        const aside = entry.aside ?? {}
        const sticker = narrow ? aside.sticker : null
        const figure = narrow ? aside.inference : null
        const sideAside = narrow ? { ...aside, sticker: null, inference: null } : aside
        const hasSide = i === 0 || sideAside.video || sideAside.sticker || sideAside.inference
        return (
          <div key={entry.title} className="cpage__row">
            {hasSide && (
              <div className="cpage__row-side">
                <div className="cpage__row-stick">
                  {i === 0 && <SectionHead section={section} index={index} />}
                  <EntryAside aside={sideAside} />
                </div>
              </div>
            )}
            <div className="cpage__row-body">
              <Entry entry={entry} sticker={sticker} figure={figure} />
            </div>
          </div>
        )
      })}
      {section.list?.length > 0 && (
        <div className="cpage__row">
          <div className="cpage__row-body">
            <SectionList list={section.list} />
          </div>
        </div>
      )}
    </section>
  )
}

function Section({ section, index }) {
  if (section.entries?.some((e) => e.aside)) return <RowsSection section={section} index={index} />
  return (
    <section className="cpage__section" style={{ '--i': index + 3 }}>
      <div className="cpage__section-side">
        <SectionHead section={section} index={index} />
      </div>
      <div className="cpage__section-body">
        {section.entries?.map((entry) => (
          <Entry key={entry.title} entry={entry} />
        ))}
        <SectionList list={section.list} />
      </div>
    </section>
  )
}

// a page's head art (page.headArt), by name
const HEAD_ART = { lattice: Lattice }

/**
 * Where the big title's words end, in px from the head's left edge, as --title-end on the head: the
 * head art starts just past it (ContentPage.css, .cpage__art). Measured from the text itself (the
 * title's box is wider than its longest line, which ends wherever its words do), again whenever the
 * title's box changes size and once the web font is in.
 */
function useTitleEnd(headRef, titleRef, enabled) {
  useEffect(() => {
    const head = headRef.current
    const title = titleRef.current
    if (!enabled || !head || !title) return undefined
    const measure = () => {
      const range = document.createRange()
      range.selectNodeContents(title)
      let right = 0
      for (const line of range.getClientRects()) right = Math.max(right, line.right)
      if (right) head.style.setProperty('--title-end', `${Math.ceil(right - head.getBoundingClientRect().left)}px`)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(title)
    let live = true
    document.fonts?.ready.then(() => live && measure())
    document.fonts?.addEventListener?.('loadingdone', measure)
    measure()
    return () => {
      live = false
      ro.disconnect()
      document.fonts?.removeEventListener?.('loadingdone', measure)
      head.style.removeProperty('--title-end')
    }
  }, [headRef, titleRef, enabled])
}

export default function ContentPage({ page }) {
  const theme = useTheme()
  useEffect(() => {
    const before = document.title
    document.title = `${page.title} — aadi ramnani`
    return () => {
      document.title = before
    }
  }, [page.title])

  const HeadArt = HEAD_ART[page.headArt]
  const headRef = useRef(null)
  const titleRef = useRef(null)
  useTitleEnd(headRef, titleRef, Boolean(HeadArt))

  return (
    <main className={`page cpage cpage--${page.slug}`}>
      <header ref={headRef} className={`cpage__head${HeadArt ? ' cpage__head--art' : ''}`}>
        <p className="cpage__kicker" style={{ '--i': 0 }}>
          <span>{page.number}</span>
          {page.kicker ?? 'aadi ramnani'}
        </p>
        <h1 ref={titleRef} className="cpage__title" style={{ '--i': 1 }}>
          {page.title}
        </h1>
        {page.lede && (
          <p className="cpage__lede" style={{ '--i': 2 }}>
            {page.lede}
          </p>
        )}
        {/* beside the title, past its last letter (on phones: small, in the corner above it) */}
        {HeadArt && (
          <div className="cpage__art" style={{ '--i': 2 }}>
            <HeadArt />
          </div>
        )}
      </header>

      {page.stats?.length > 0 && (
        <dl className="cpage__stats" style={{ '--i': 3 }}>
          {page.stats.map((s) => (
            <div key={s.label}>
              <dt>{s.label}</dt>
              <dd>{s.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {page.sections.map((section, i) => (
        <Section key={section.heading} section={section} index={i} />
      ))}

      <p className="cpage__back">
        <ScribbleLink to="/" loop={1}>
          ← back to the {theme === 'dark' ? 'chocolate' : 'melon'}
        </ScribbleLink>
      </p>
    </main>
  )
}
