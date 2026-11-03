import { useEffect, useRef } from 'react'
import useScrollLerp from '../../lib/useScrollLerp.js'
import Signature from '../Signature/Signature.jsx'
import './ScrapPhoto.css'

// A taped print whose picture reveals from its centre each time it scrolls into
// view (StringTune "reveal on scroll", repeat on) and shears with scroll speed
// (StringTune "lerp"): the print stays still while the picture shifts inside it.
export default function ScrapPhoto({ src, alt, width, height, className = '' }) {
  const rootRef = useRef(null)
  const windowRef = useRef(null)
  useScrollLerp(windowRef)

  useEffect(() => {
    const root = rootRef.current
    // In view while any part of it is on screen (enter: its top passes the
    // viewport bottom; exit: its bottom passes the viewport top), as in StringTune.
    const io = new IntersectionObserver(([entry]) => {
      root.classList.toggle('is-inview', entry.isIntersecting)
    })
    io.observe(root)
    return () => io.disconnect()
  }, [])

  return (
    <figure className={`scrap-photo ${className}`} ref={rootRef}>
      <span className="scrap-photo__tape scrap-photo__tape--left" aria-hidden="true" />
      <span className="scrap-photo__tape scrap-photo__tape--right" aria-hidden="true" />
      <div className="scrap-photo__window" ref={windowRef}>
        <div className="scrap-photo__reveal">
          <img src={src} alt={alt} width={width} height={height} />
        </div>
      </div>
      {/* Signed in ink across the print's corner; it draws itself on the way in. */}
      <Signature className="scrap-photo__signature" />
    </figure>
  )
}
