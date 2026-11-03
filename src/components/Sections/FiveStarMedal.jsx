// The academics page's medal: a Cadbury 5 Star hung on a ribbon, a flat cut-out
// picture over the page (above its stickers, under the header). The bar itself
// answers the pointer (hover, focus or a tap) with a note on what it is; the
// ribbon lets clicks through to the page.
import { useEffect, useId, useRef, useState } from 'react'
import medal from '../../assets/academics/fivestar-medal.webp'
import './FiveStarMedal.css'

const NOTE =
  'Cadbury 5 Star is a popular Indian milk chocolate bar made with a soft nougat and caramel center coated in smooth milk chocolate launched by Cadbury in 1969.'

export default function FiveStarMedal() {
  const noteId = useId()
  const barRef = useRef(null)
  const [open, setOpen] = useState(false) // pinned open by a tap or a click

  // a pinned note closes on a press anywhere else, or Escape
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (!barRef.current?.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`fivestar${open ? ' is-open' : ''}`}>
      <div className="fivestar__swing">
        <img className="fivestar__img" src={medal} alt="" width="521" height="1383" draggable="false" />
        <button
          ref={barRef}
          type="button"
          className="fivestar__bar"
          aria-label="Cadbury 5 Star"
          aria-describedby={noteId}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        />
      </div>
      <p id={noteId} className="fivestar__note" role="tooltip">
        <span className="fivestar__note-kicker">cadbury 5 star</span>
        {NOTE}
      </p>
    </div>
  )
}
