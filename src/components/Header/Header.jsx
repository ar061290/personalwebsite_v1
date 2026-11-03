import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import ScribbleLink from './Scribble.jsx'
import { navTarget } from './sectionScroll.js'
import MusicToggle from '../Music/MusicToggle.jsx'
import ThemeToggle from '../ThemeToggle/ThemeToggle.jsx'
import { ELSEWHERE, NAV, RESUME } from '../../content/site.js'
import './Header.css'

const GAP = 28 // px kept clear between the header's groups

/**
 * How the header fits its width: 'wide' (eyes at the centre of the page), 'tight'
 * (eyes centred between the name and the nav) or 'compact' (the nav moves into the menu).
 */
function useHeaderLayout(headerRef, nameRef, navRef, toolsRef) {
  const [layout, setLayout] = useState('wide')
  useLayoutEffect(() => {
    const header = headerRef.current
    if (!header) return undefined
    // Natural widths, the same in every layout: the nav and the resume button stay laid out
    // (out of flow, unseen) when compact, so the choice never flips back and forth.
    const measure = () => {
      const cs = getComputedStyle(header)
      const inner = header.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      const nameW = nameRef.current?.offsetWidth ?? 0
      const navW = navRef.current?.scrollWidth ?? 0
      const tools = toolsRef.current ? [...toolsRef.current.children] : []
      const toolsGap = toolsRef.current ? parseFloat(getComputedStyle(toolsRef.current).columnGap) || 0 : 0
      const toolsW = tools.reduce((w, el) => w + el.offsetWidth, 0) + toolsGap * Math.max(0, tools.length - 1)
      const eyesW = 56
      const right = navW + GAP + toolsW
      let next = 'compact'
      if (right <= (inner - eyesW) / 2 - GAP) next = 'wide'
      else if (nameW + right + eyesW + GAP * 2 <= inner) next = 'tight'
      setLayout(next)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(header)
    // the fonts change the words' widths once they are in
    document.fonts?.ready.then(measure).catch(() => {})
    return () => ro.disconnect()
  }, [headerRef, nameRef, navRef, toolsRef])
  return layout
}

export default function Header() {
  const { pathname } = useLocation()
  const headerRef = useRef(null)
  const nameRef = useRef(null)
  const navRef = useRef(null)
  const toolsRef = useRef(null)
  const layout = useHeaderLayout(headerRef, nameRef, navRef, toolsRef)
  const [open, setOpen] = useState(false)
  const compact = layout === 'compact'
  const menuOpen = open && compact

  // the menu closes on any navigation, and when the header grows out of it
  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!menuOpen) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const html = document.documentElement
    html.classList.add('is-menu-open')
    // on the hero the eyes sit on the melon, in the middle of the menu: hidden while it is open
    // (once docked in the header they stay, above it)
    const onHero = pathname === '/' && window.scrollY < window.innerHeight * 0.45
    html.classList.toggle('is-menu-over-eyes', onHero)
    window.addEventListener('keydown', onKey)
    return () => {
      html.classList.remove('is-menu-open', 'is-menu-over-eyes')
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen, pathname])

  // a soft paper fade under the bar once there is page under it (on home: past the hero)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => {
      const at = pathname === '/' ? window.innerHeight * 0.85 : 8
      setScrolled(window.scrollY > at)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [pathname])

  const current = (item) => !item.section && item.to === pathname
  const close = () => setOpen(false)

  return (
    <header
      ref={headerRef}
      className={`site-header site-header--${layout}${menuOpen ? ' is-open' : ''}${scrolled ? ' is-scrolled' : ''}`}
    >
      <Link ref={nameRef} className="site-header__name" to="/">
        aadi ramnani
      </Link>
      <div className="site-header__eyes-slot" data-eyes-slot="header" aria-hidden="true" />
      <div className="site-header__right">
        <nav ref={navRef} className="site-header__nav" aria-label="Main" aria-hidden={compact || undefined}>
          <ul>
            {NAV.map((item, i) => (
              <li key={item.key}>
                <ScribbleLink
                  to={navTarget(item, pathname)}
                  loop={i}
                  current={current(item)}
                  title={item.title === item.label ? undefined : item.title}
                  tabIndex={compact ? -1 : undefined}
                >
                  {item.label}
                </ScribbleLink>
              </li>
            ))}
          </ul>
        </nav>
        <div ref={toolsRef} className="site-header__tools">
          <a
            className="site-header__resume"
            href={RESUME.href}
            download={RESUME.file}
            data-cursor="download"
            tabIndex={compact ? -1 : undefined}
            aria-hidden={compact || undefined}
          >
            <span>resume</span>
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M6 1.5v7M2.8 5.6 6 8.8l3.2-3.2M2 10.5h8" />
            </svg>
          </a>
          <MusicToggle />
          <ThemeToggle />
        </div>
        <button
          type="button"
          className="site-header__menu"
          aria-expanded={menuOpen}
          aria-controls="site-menu"
          onClick={() => setOpen((v) => !v)}
        >
          {menuOpen ? 'close' : 'menu'}
        </button>
      </div>

      <div id="site-menu" className="site-menu" hidden={!menuOpen}>
        <nav aria-label="Main">
          <ol className="site-menu__list">
            {NAV.map((item, i) => (
              <li key={item.key} style={{ '--i': i }}>
                <ScribbleLink to={navTarget(item, pathname)} loop={i} current={current(item)} onClick={close}>
                  {item.label}
                </ScribbleLink>
                {item.title !== item.label && <span className="site-menu__title">{item.title}</span>}
              </li>
            ))}
          </ol>
        </nav>
        <div className="site-menu__foot">
          <a href={RESUME.href} download={RESUME.file} onClick={close}>
            resume ↓
          </a>
          {ELSEWHERE.filter((l) => l.key !== 'email').map((l) => (
            <a key={l.key} href={l.href} target="_blank" rel="noopener noreferrer">
              {l.label}
            </a>
          ))}
        </div>
      </div>
    </header>
  )
}
