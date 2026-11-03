// Light (the watermelon on white paper, the default) and dark (the chocolate bar on black paper)
// themes. The choice lives on <html> as data-theme, set before first paint by the inline script in
// index.html and remembered per browser. Everything that draws (the fluid, the paper, the stickers,
// the hero model, the juice drop, the sign wall) reads it from here and listens for changes.
//
// `instant` on a change says the new look should be taken at once rather than eased into (the
// theme switch pictures the new page inside a view transition, so it must already be final). The
// switch itself (the circle from the button, its ring, the earrings) is src/components/ThemeToggle/.
import { useSyncExternalStore } from 'react'

export const THEME_KEY = 'aadi-theme'
export const THEME_EVENT = 'aadi:themechange'

export const getTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

/** Keeps <meta name="theme-color"> (the browser's own chrome) the colour of the page: --bg. */
export function syncThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]')
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
  if (meta && bg) meta.content = bg
}

/** Applies a theme and tells everyone listening. Remembered for the next visit. */
export function applyTheme(theme, { instant = false } = {}) {
  const next = theme === 'dark' ? 'dark' : 'light'
  document.documentElement.dataset.theme = next
  syncThemeColor()
  try {
    localStorage.setItem(THEME_KEY, next)
  } catch {
    // private mode: the choice lasts this visit
  }
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: { theme: next, instant } }))
}

/** Calls `fn(theme, { instant })` on every change; returns the unsubscribe. */
export function onThemeChange(fn) {
  const handler = (e) => fn(e.detail.theme, { instant: e.detail.instant })
  window.addEventListener(THEME_EVENT, handler)
  return () => window.removeEventListener(THEME_EVENT, handler)
}

const subscribe = (notify) => onThemeChange(notify)

/** The current theme, re-rendering on change. */
export function useTheme() {
  return useSyncExternalStore(subscribe, getTheme, () => 'light')
}
