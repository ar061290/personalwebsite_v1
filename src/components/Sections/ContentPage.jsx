// One page of the site (academics, research, projects, ashwa, drama, leadership),
// typeset from a src/content/*.js object.
import { useEffect } from 'react'
import ScribbleLink from '../Header/Scribble.jsx'
import { AutoSlideshow, LogoStickers } from './SectionSide.jsx'
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

function Entry({ entry }) {
  return (
    <article className="cpage__entry">
      <header className="cpage__entry-head">
        <h3 className="cpage__entry-title">{entry.title}</h3>
        {(entry.when || entry.view) && (
          <p className="cpage__when">
            {entry.view && <ViewLink href={entry.view} what={entry.title} />}
            {entry.when}
          </p>
        )}
      </header>
      {(entry.org || entry.place) && (
        <p className="cpage__org">
          {entry.org}
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
    </article>
  )
}

function Section({ section, index }) {
  return (
    <section className="cpage__section" style={{ '--i': index + 3 }}>
      <div className="cpage__section-side">
        <h2 className="cpage__section-title">
          <span className="cpage__section-num">{String(index + 1).padStart(2, '0')}</span>
          {section.heading}
        </h2>
        {section.stickers?.length > 0 && <LogoStickers items={section.stickers} />}
        {section.slides?.length > 0 && <AutoSlideshow slides={section.slides} label={section.slidesLabel} />}
      </div>
      <div className="cpage__section-body">
        {section.entries?.map((entry) => (
          <Entry key={entry.title} entry={entry} />
        ))}
        {section.list?.length > 0 && (
          <ul className="cpage__list">
            {section.list.map((item) => (
              <li key={item.title}>
                <span className="cpage__list-title">{item.title}</span>
                {item.org && <span className="cpage__list-org">{item.org}</span>}
                <span className="cpage__list-view">{item.view && <ViewLink href={item.view} what={item.title} />}</span>
                {item.when && <span className="cpage__list-when">{item.when}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
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

  return (
    <main className={`page cpage cpage--${page.slug}`}>
      <header className="cpage__head">
        <p className="cpage__kicker" style={{ '--i': 0 }}>
          <span>{page.number}</span>
          {page.kicker ?? 'aadi ramnani'}
        </p>
        <h1 className="cpage__title" style={{ '--i': 1 }}>
          {page.title}
        </h1>
        {page.lede && (
          <p className="cpage__lede" style={{ '--i': 2 }}>
            {page.lede}
          </p>
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
