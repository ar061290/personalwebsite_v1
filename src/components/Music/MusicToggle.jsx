// The music button (four bars), as on the Drama Collective site. music.js owns its
// state classes (is-playing / is-loading / is-blocked), aria-pressed and title; React
// renders it once and leaves those alone. Each route change is a new page: the music
// moves to a new random point.
import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { setupMusic } from './music.js'
import './MusicToggle.css'

export default function MusicToggle({ className = '' }) {
  const buttonRef = useRef(null)
  const apiRef = useRef(null)
  const { pathname } = useLocation()
  const pageRef = useRef(pathname)

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const api = setupMusic({ button: buttonRef.current, reduced })
    apiRef.current = api
    return () => {
      api.dispose()
      apiRef.current = null
    }
  }, [])

  useEffect(() => {
    if (pageRef.current === pathname) return
    pageRef.current = pathname
    apiRef.current?.reposition()
  }, [pathname])

  return (
    <button
      ref={buttonRef}
      className={`icon-btn music-toggle ${className}`.trim()}
      type="button"
      aria-pressed="false"
      aria-label="Music"
      aria-keyshortcuts="K"
      title="Play music (K)"
      data-music-toggle
      data-cursor="music"
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <rect className="bar" x="2.5" y="8" width="2.2" height="9" />
        <rect className="bar" x="6.9" y="3" width="2.2" height="14" />
        <rect className="bar" x="11.3" y="6" width="2.2" height="11" />
        <rect className="bar" x="15.7" y="9" width="2.2" height="8" />
      </svg>
    </button>
  )
}
