// The hand-drawn circle that rings a link on hover, after jackiezhang.co.za's nav
// ("Navi Linkie"). Theirs: an open loop that overshoots its own start, drawn on by
// stroke-dashoffset over 0.3 s with cubic-bezier(.44, 0, .56, 1), a 1 px stroke in the
// text's colour; it is only rendered in the hover variant, so it vanishes at once on
// leave. Two loops: "Circle 1" (about, connect) and "Circle 2" (work). Same here,
// alternating per link, sized to the word instead of a fixed box.
import { forwardRef } from 'react'
import { Link } from 'react-router-dom'
import './Scribble.css'

const LOOPS = [
  {
    d: 'M 81.49 16.931 C 81.49 1.676 14.701 -11.069 1.021 14.985 C -12.659 41.038 116.452 46.71 69.49 8.931',
    t: 'translate(7.01 3.931)',
  },
  {
    d: 'M 86.759 4.519 C 80.965 -2.317 -5.485 -4.757 0.275 22.178 C 3.425 36.908 42.214 39.876 66.46 31.45 C 101.924 19.124 86.56 3.488 67.822 1.483',
    t: 'translate(3.837 4.568)',
  },
]

export function ScribbleRing({ loop = 0 }) {
  const { d, t } = LOOPS[loop % LOOPS.length]
  return (
    <svg className="scribble__ring" viewBox="0 0 95 43" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d={d} transform={t} pathLength="1" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/**
 * A link whose label gets ringed on hover and focus (and stays ringed while
 * `current`). `to` makes a router link, `href` a plain anchor.
 */
const ScribbleLink = forwardRef(function ScribbleLink(
  { to, href, loop = 0, current = false, className = '', children, ...rest },
  ref,
) {
  const cls = `scribble-link${current ? ' is-current' : ''} ${className}`.trim()
  const inner = (
    <span className="scribble">
      <span className="scribble__label">{children}</span>
      <ScribbleRing loop={loop} />
    </span>
  )
  if (to !== undefined) {
    return (
      <Link ref={ref} to={to} className={cls} aria-current={current ? 'page' : undefined} {...rest}>
        {inner}
      </Link>
    )
  }
  return (
    <a ref={ref} href={href} className={cls} {...rest}>
      {inner}
    </a>
  )
})

export default ScribbleLink
