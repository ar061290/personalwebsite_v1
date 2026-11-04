// The footer on every page (id="contact"): contact on the left, the pendulum figure in the
// centre (FooterPendulum.jsx, where the cursor's slice ends up), the pages and the links
// elsewhere on the right, then the looping AADI RAMNANI ✨ banner. Its height is published
// as --footer-h on <html> for the sign wall below it.
import { useLayoutEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import ScribbleLink from '../Header/Scribble.jsx'
import { navTarget } from '../Header/sectionScroll.js'
import NameBanner from './NameBanner.jsx'
import MessageMe from './MessageMe.jsx'
import FooterPendulum from './FooterPendulum.jsx'
import { ELSEWHERE, EMAIL, NAV, PLACE, RESUME } from '../../content/site.js'
import './Footer.css'

export default function Footer() {
  const ref = useRef(null)
  const { pathname } = useLocation()

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const root = document.documentElement
    const publish = () => root.style.setProperty('--footer-h', `${Math.round(el.offsetHeight)}px`)
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => {
      ro.disconnect()
      root.style.removeProperty('--footer-h')
    }
  }, [])

  const year = new Date().getFullYear()

  return (
    <footer className="site-footer" id="contact" ref={ref}>
      <div className="site-footer__top">
        <div className="site-footer__lead">
          <p className="site-footer__kicker">contact</p>
          <p className="site-footer__line">say hello.</p>
          <ScribbleLink className="site-footer__email" href={`mailto:${EMAIL}`} loop={1}>
            {EMAIL}
          </ScribbleLink>
          <div>
            <MessageMe />
          </div>
        </div>

        <div className="site-footer__figure">
          <FooterPendulum />
        </div>

        <div className="site-footer__lists">
          <nav className="site-footer__col" aria-label="Pages">
            <p className="site-footer__kicker">pages</p>
            <ul>
              {NAV.filter((item) => item.key !== 'contact').map((item, i) => (
                <li key={item.key}>
                  <ScribbleLink to={navTarget(item, pathname)} loop={i} current={!item.section && item.to === pathname}>
                    {item.title}
                  </ScribbleLink>
                </li>
              ))}
            </ul>
          </nav>

          <div className="site-footer__col">
            <p className="site-footer__kicker">elsewhere</p>
            <ul>
              {ELSEWHERE.map((link, i) => (
                <li key={link.key}>
                  <ScribbleLink
                    href={link.href}
                    loop={i + 1}
                    {...(link.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  >
                    {link.label}
                  </ScribbleLink>
                </li>
              ))}
              <li>
                <ScribbleLink href={RESUME.href} download={RESUME.file} loop={0} data-cursor="download">
                  resume ↓
                </ScribbleLink>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <NameBanner />

      <div className="site-footer__base">
        <span>© {year} aadi ramnani</span>
        <span>{PLACE}</span>
        <span className="site-footer__hint">
          press <kbd>k</kbd> for music
        </span>
      </div>
    </footer>
  )
}
