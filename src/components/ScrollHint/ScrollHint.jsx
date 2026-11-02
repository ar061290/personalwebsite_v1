import { useEffect, useState } from 'react'
import './ScrollHint.css'

export default function ScrollHint({ visible }) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const shown = visible && !scrolled
  return (
    <div className={`scroll-hint${shown ? ' is-shown' : ''}`} aria-hidden={!shown}>
      <span className="scroll-hint__label">scroll</span>
      <span className="scroll-hint__line" />
    </div>
  )
}
