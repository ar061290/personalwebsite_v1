import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import useStickers from './useStickers.js'

// Stickers for the rest of the site: a click anywhere outside the hero (which has
// its own layers, where stickers stay) sticks one on, and it comes off again
// after LIFETIME. None on the sign wall, where a click is a brush stroke.
const LIFETIME = 2400 // ms
const EXCLUDE = '.hero, .sign-wall, .site-menu, .earring-grab'

export default function PageStickers({ enabled }) {
  const layerRef = useRef(null)
  const stickers = useStickers({
    underRef: layerRef,
    overRef: layerRef,
    enabled,
    lifetime: LIFETIME,
    exclude: EXCLUDE,
    page: true,
  })

  // A new page starts bare.
  const { pathname } = useLocation()
  useEffect(() => {
    stickers.clear()
  }, [pathname, stickers])

  return <div className="sticker-layer--page" ref={layerRef} aria-hidden="true" />
}
