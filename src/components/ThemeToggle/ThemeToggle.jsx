// The dark mode / light mode button, ported from the Drama Collective site: its sun and moon glyphs,
// the circle that reveals the new theme from the button with a ring and ripples on its edge
// (./themeSwitch.js, ./themeRing.js), and the earring that drops out of the button for the theme
// just chosen, the sun for the light and the moon for the dark (./earrings.js, ./earringsScene.js).
// The header places it; everything positions itself from the button wherever it is.
import { useEffect, useRef } from 'react'
import { reducedMotion } from '../../lib/env.js'
import { useTheme } from '../../lib/theme.js'
import { setupEarrings } from './earrings.js'
import { setupThemeSwitch } from './themeSwitch.js'
import './ThemeToggle.css'

/**
 * Resolves once the intro has gone (html.is-intro lifted), or soon if there is none: the earrings'
 * model waits for it, as on the Drama Collective site it waits for the curtain.
 */
function introGone() {
  const root = document.documentElement
  let finish = () => {}
  const promise = new Promise((resolve) => {
    let seen = root.classList.contains('is-intro')
    const observer = new MutationObserver(() => {
      if (root.classList.contains('is-intro')) seen = true
      else if (seen) finish()
    })
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    const grace = setTimeout(() => {
      if (!root.classList.contains('is-intro')) finish()
    }, 800)
    finish = () => {
      observer.disconnect()
      clearTimeout(grace)
      resolve()
    }
  })
  return { promise, cancel: () => finish() }
}

export default function ThemeToggle({ className = '' }) {
  const ref = useRef(null)
  const theme = useTheme()

  useEffect(() => {
    const button = ref.current
    if (!button) return undefined
    const reduced = reducedMotion()
    const intro = introGone()
    const earrings = setupEarrings({ reduced, opened: intro.promise, button })
    const stopSwitch = setupThemeSwitch({ button, reduced, onSwitch: earrings.drop })
    return () => {
      stopSwitch()
      earrings.cleanup()
      intro.cancel()
    }
  }, [])

  return (
    <button
      ref={ref}
      type="button"
      className={`theme-toggle ${className}`.trim()}
      aria-pressed={theme === 'dark'}
      aria-label="Dark mode"
      title={theme === 'dark' ? 'lights on' : 'lights off'}
      data-theme-toggle
    >
      <svg className="theme-toggle__sun" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="3.6" fill="currentColor" />
        <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M10 1.8v2.1M10 16.1v2.1M1.8 10h2.1M16.1 10h2.1M4.2 4.2l1.5 1.5M14.3 14.3l1.5 1.5M4.2 15.8l1.5-1.5M14.3 5.7l1.5-1.5" />
        </g>
      </svg>
      <svg className="theme-toggle__moon" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M15.9 12.6A6.6 6.6 0 0 1 7.4 4.1a6.6 6.6 0 1 0 8.5 8.5Z" fill="currentColor" />
      </svg>
    </button>
  )
}
