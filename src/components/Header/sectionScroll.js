// Links to a part of a page (about, below the melon; contact, the footer) carry it as
// the location's hash. App.jsx scrolls to it after each navigation: smoothly on the
// same page, at once after a route change.

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Scrolls the window to the element with `id`; true if it was found. */
export function scrollToSection(id, { smooth = true } = {}) {
  const el = document.getElementById(id)
  if (!el) return false
  const top = el.getBoundingClientRect().top + window.scrollY
  window.scrollTo({ top: Math.max(0, top), behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' })
  return true
}

/** Where a nav item points, as a router `to`: its route, plus `#section` for in-page parts. */
export function navTarget(item, pathname) {
  if (!item.section) return item.to
  return { pathname: item.to ?? pathname, hash: `#${item.section}` }
}
