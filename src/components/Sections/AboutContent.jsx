// The about-me beside the photo on the home page (fills .about__content).
import ScribbleLink from '../Header/Scribble.jsx'
import about from '../../content/about.js'
import { RESUME } from '../../content/site.js'
import './AboutContent.css'

export default function AboutContent({ className = '' }) {
  return (
    <div className={`about-me ${className}`.trim()}>
      <p className="about-me__kicker">{about.kicker}</p>
      <h2 className="about-me__greeting">{about.greeting}</h2>
      {about.body.map((p) => (
        <p className="about-me__body" key={p}>
          {p}
        </p>
      ))}
      <ul className="about-me__now" aria-label="Now">
        {about.now.map((n, i) => (
          <li key={n.role}>
            <ScribbleLink to={n.to} loop={i}>
              <span className="about-me__role">{n.role}</span>
            </ScribbleLink>
            <span className="about-me__where">{n.where}</span>
          </li>
        ))}
      </ul>
      <p className="about-me__more">
        <ScribbleLink href={RESUME.href} download={RESUME.file} loop={1} data-cursor="download">
          download the resume ↓
        </ScribbleLink>
      </p>
    </div>
  )
}
