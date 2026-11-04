// The academics page's medal: a Cadbury 5 Star hung on a ribbon, a flat cut-out
// picture over the page (above its stickers, under the header), drawn as two layers,
// the ribbon and the bar, so the bar can leave it (the bar is the stop motion's own
// first picture of it, so it arrives there unchanged). The bar answers the pointer
// (hover or focus) with a note on what it is, and the cursor's "click"; pressing it
// lifts it off the ribbon to be unwrapped and eaten (FiveStarFeast.jsx), after which
// it is back on its ribbon. The ribbon lets clicks through to the page.
import { useEffect, useId, useRef, useState } from 'react'
import ribbon from '../../assets/fivestar/medal-ribbon.webp'
import barImg from '../../assets/fivestar/medal-bar.webp'
import FiveStarFeast, { forgetFeast, warmFeast } from './FiveStarFeast.jsx'
import './FiveStarMedal.css'

const NOTE =
  'Cadbury 5 Star is a popular Indian milk chocolate bar made with a soft nougat and caramel center coated in smooth milk chocolate launched by Cadbury in 1969.'

/** The swing's tilt (deg), read from its transform (FiveStarMedal.css), so the flight starts as it hangs. */
function tiltOf(el) {
  const t = el ? getComputedStyle(el).transform : 'none'
  const m = t.match(/matrix\(([^)]+)\)/)
  if (!m) return 0
  const [a, b] = m[1].split(',').map(Number)
  return (Math.atan2(b, a) * 180) / Math.PI
}

export default function FiveStarMedal() {
  const noteId = useId()
  const swingRef = useRef(null)
  const barRef = useRef(null)
  const [from, setFrom] = useState(null) // the bar on the page as the feast began; null: no feast

  // leaving the page forgets how far the eating had got (FiveStarFeast keeps it while here)
  useEffect(() => forgetFeast, [])

  // An entry an earlier feast left in the history (reached by the forward button, or kept over a
  // reload) has no scene behind it: step back over it, so no press of back is ever spent on nothing.
  const eatingRef = useRef(false)
  eatingRef.current = Boolean(from)
  useEffect(() => {
    const fold = () => {
      if (history.state?.feast && !eatingRef.current) history.back()
    }
    fold()
    window.addEventListener('popstate', fold)
    return () => window.removeEventListener('popstate', fold)
  }, [])

  const eat = (e) => {
    const bar = barRef.current
    if (!bar || from) return
    const r = bar.getBoundingClientRect()
    setFrom({
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      w: bar.offsetWidth,
      h: bar.offsetHeight,
      rotate: tiltOf(swingRef.current),
      pointer: e.detail ? { x: e.clientX, y: e.clientY } : null, // (a click; a key press has no place)
    })
  }

  return (
    <div className={`fivestar${from ? ' is-eating' : ''}`}>
      <div ref={swingRef} className="fivestar__swing">
        <img className="fivestar__img" src={ribbon} alt="" width="521" height="1383" draggable="false" />
        <img ref={barRef} className="fivestar__bar-img" src={barImg} alt="" draggable="false" />
        <button
          type="button"
          className="fivestar__bar"
          aria-label="Cadbury 5 Star: unwrap it"
          aria-describedby={noteId}
          data-cursor="click"
          onPointerEnter={warmFeast}
          onFocus={warmFeast}
          onClick={eat}
        />
      </div>
      <p id={noteId} className="fivestar__note" role="tooltip">
        <span className="fivestar__note-kicker">cadbury 5 star</span>
        {NOTE}
      </p>
      {from && <FiveStarFeast from={from} onDone={() => setFrom(null)} />}
    </div>
  )
}
