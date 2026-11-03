// The theme switch, ported from the Drama Collective site (src/ui/theme.js). The theme itself (the
// data-theme on <html>, the saved choice, the change event everything that draws listens for) is
// src/lib/theme.js; this is how the button switches it.
//
// The switch spreads from the button: the new theme is revealed inside a circle that widens from the
// button's centre until it reaches the farthest corner of the screen, a ring with star glints on its
// edge and ripples trailing inside it, as from a drop in water (./themeRing.js). Where the browser
// has view transitions, the page is pictured as it was and as it now is, and the new picture is
// uncovered through the circle (ThemeToggle.css); elsewhere the colours cross-fade while the ring
// passes over. With reduced motion the theme simply changes.
//
// A switch made by the visitor (a click on the button, or a key on it) also brings the new theme's
// earring down out of the button (`onSwitch`: ./earrings.js). Inside a view transition it is called
// as the new page is pictured, so the earring's canvas is part of the new picture.
//
// Inside the view transition the theme is applied with `instant: true`: the fluid, the paper, the
// hero model and the rest take their new look at once, so nothing is seen easing inside the circle.
// The update callback does not wait for animation frames: while it is pending the browser runs none
// (rendering is suppressed for the transition; measured in Chrome: no requestAnimationFrame in
// 500 ms), so a wait for frames there only delays the reveal. Nor need it: only the old page is a
// still picture; the new one (::view-transition-new) is the live page, so the WebGL and WebGPU
// canvases draw their new look into it on their next frame, while the circle is still a point.

import { readToken } from '../../lib/env.js'
import { applyTheme, getTheme, syncThemeColor } from '../../lib/theme.js'
import { themeRing } from './themeRing.js'

// the circle and its ring, as one: long enough to see the ripples, short enough not to wait on
const DURATION = 1000 // ms
const EASE = 'cubic-bezier(.4, .1, .25, 1)'

/** The current theme's colours for the ring (global.css). */
const ringColours = () => ({
  ink: readToken('--ink'),
  accent: readToken('--accent'),
  rule: readToken('--rule'),
  bg: readToken('--bg'),
  dark: getTheme() === 'dark',
})

/**
 * @param {{ button: HTMLElement, reduced: boolean, onSwitch?: (theme: string) => void }} o
 * @returns {() => void} cleanup
 */
export function setupThemeSwitch({ button, reduced, onSwitch }) {
  const root = document.documentElement
  let fadeTimer = 0
  let ring = null
  let latest = null // the view transition under way, if any

  // `instant`: the canvases take the new look at once rather than easing into it
  const apply = (theme, instant) => applyTheme(theme, { instant })

  // the circle's centre (the button's, wherever the header has put it) and the radius that reaches
  // the farthest corner of the screen from there
  const circle = () => {
    const r = button?.getBoundingClientRect()
    const x = r?.width ? r.left + r.width / 2 : innerWidth - 40
    const y = r?.width ? r.top + r.height / 2 : 32
    return { x, y, radius: Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) }
  }

  // the visitor's switch, told on (never let it stop the switch itself)
  const switched = (theme) => {
    try {
      onSwitch?.(theme)
    } catch (err) {
      console.warn(err)
    }
  }

  const set = (theme) => {
    ring?.stop()
    ring = null
    if (reduced) {
      apply(theme, true)
      switched(theme)
      return
    }
    const { x, y, radius } = circle()
    const from = ringColours()

    if (typeof document.startViewTransition !== 'function') {
      // no view transitions: colours cross-fade for one beat, then normal transitions resume; the
      // ring still spreads over the page, timed by an animation of its own with the same curve
      root.classList.add('theme-fade')
      clearTimeout(fadeTimer)
      fadeTimer = setTimeout(() => root.classList.remove('theme-fade'), 700)
      apply(theme, false)
      switched(theme)
      const made = themeRing({ x, y, radius, from, to: ringColours() })
      const clock = made.canvas.animate([{ opacity: 1 }, { opacity: 1 }], { duration: DURATION, easing: EASE })
      made.run(() => clock.effect?.getComputedTiming().progress ?? null)
      ring = made
      return
    }

    let made = null
    root.classList.add('is-theming')
    const vt = document.startViewTransition(() => {
      // the new page must be pictured exactly as it will stay: no colour easing into it, and the
      // canvases already in their new look (the snap is lifted once the picture is taken)
      root.classList.add('theme-snap')
      apply(theme, true)
      switched(theme)
      made = themeRing({ x, y, radius, from, to: ringColours() })
      ring = made
    })
    vt.ready
      .then(() => {
        root.classList.remove('theme-snap')
        const clip = root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: DURATION, easing: EASE, pseudoElement: '::view-transition-new(root)' },
        )
        made?.run(() => clip.effect?.getComputedTiming().progress ?? null)
      })
      .catch(() => {
        /* skipped (another switch began): its end below tidies up */
      })
    latest = vt
    const end = () => {
      made?.stop()
      if (ring === made) ring = null
      // a switch made again mid-way (by key, or by a second click: onPictureClick below) skips this
      // one: the classes are the new one's to lift
      if (latest === vt) root.classList.remove('is-theming', 'theme-snap')
    }
    vt.finished.then(end, end)
  }

  const onClick = () => set(getTheme() === 'light' ? 'dark' : 'light')

  // While the circle spreads, what shows is the view transition's pictures of the page, not the page,
  // and the browser gives every click on them to <html>, whatever lay under the pointer (in Chrome,
  // letting pointer events through the pictures does not help: the page under them is not
  // hit-tested). So such a click ends the reveal at once and is then passed on to what it was meant
  // for: a second click on the toggle switches back, and a link or a button works as ever, not dead
  // for a second.
  const onPictureClick = (e) => {
    const vt = latest
    if (e.target !== root || !vt || !root.classList.contains('is-theming')) return
    e.stopImmediatePropagation() // it is passed on below, as itself, so is not to be handled as it is
    vt.skipTransition()
    const passOn = () => {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      if (!el || el === root) return
      el.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true, cancelable: true, composed: true, view: window, detail: e.detail,
          screenX: e.screenX, screenY: e.screenY, clientX: e.clientX, clientY: e.clientY,
          ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
          button: e.button, buttons: e.buttons,
        }),
      )
    }
    vt.finished.then(passOn, passOn)
  }

  button?.addEventListener('click', onClick)
  document.addEventListener('click', onPictureClick, true)
  syncThemeColor()

  return () => {
    clearTimeout(fadeTimer)
    ring?.stop()
    root.classList.remove('theme-fade', 'is-theming', 'theme-snap')
    button?.removeEventListener('click', onClick)
    document.removeEventListener('click', onPictureClick, true)
  }
}
