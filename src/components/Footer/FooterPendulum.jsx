// The footer's centre figure: the owner's Pendulum Heroes (src/vendor/pendulum), the watermelon
// slice that opens into a line-art ballistic pendulum in the light theme, the chocolate bar that
// lands on one in the dark.
//
// On the homepage it tells a little story. Once the about section fills the screen, a mini slice
// (or bar) slides down the page from above, on the figure's centre line (SLIDE); as the figure scrolls
// in, the mini grows straight into the figure's own slice/bar at progress 0, landing exactly on it
// (FLIGHT), the figure fades in under it (HANDOFF), and then the figure opens into the pendulum on its
// own clock (MORPH_S), whose physics runs and can be dragged. Scrolling back up runs it backwards. On
// every other page it is simply the finished pendulum, already swinging. With reduced motion there is
// no mini: the figure shows its still, finished drawing (the element's own behaviour).
//
// The elements are loaded only once the footer is near (melon 114 KB, kinder 153 KB plus a 2.4 MB
// model), kinder only once the dark theme has been seen, and neither is ever remounted (kinder never
// frees its WebGL context): the inactive one is hidden. Both paint an opaque paper colour, so they sit
// in a slot that repaints the page's paper tile under them, and blend onto it (multiply on white in
// the light theme, screen on black in the dark). Their progress is set from here (their own
// block-mode scroll mapping never finishes this low on a page); per-frame styles go on the slot and
// the mini only, since the elements re-read their colours whenever their own style changes.
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { clamp01 } from '../../lib/scrollChoreo.js'
import { useTheme } from '../../lib/theme.js'
import { SPRITES } from '../../assets/pendulum/sprites/sprites.js'
import glbUrl from '../../assets/pendulum/kinder-bar.glb?url'
import './FooterPendulum.css'

// The mini's slide: from when the about section's top passes this far down the screen (of its
// height) until the figure starts coming up from below, gliding from just above the screen's top edge
// to this far down it, down the gutter between the photo and the text (where the two sit side by
// side), drifting over to the figure's centre line as it grows into it.
const SLIDE_FROM = 0.2
const SLIDE_TO_Y = 0.62
const MINI_LENGTH = { melon: 46, bar: 60 } // CSS px from the mini's point to its far end
const MINI_TILT = -16 // degrees it is tipped when it appears, straightening as it slides
// u: the slot's way up the screen, from its top at the viewport's bottom (START, of the viewport
// height) to its top just under the header (END_GAP px below it), where the figure is all on screen
const START = 1
const END_GAP = 0
const FLIGHT = [0, 0.4] // the mini grows into the figure's own slice/bar (landing with it all in view)
const HANDOFF = [0.38, 0.44] // the figure fades in under the landed mini
const LIVE_AT = 0.999 // the element runs its physics from here
// Once the mini has landed, the figure opens into the pendulum on its own clock, not the scroll's (a
// slow scroller would otherwise hold it half-way): this long from start to finish, and back (faster)
// if the page is scrolled up past the landing again.
const MORPH_S = 3.6
const UNMORPH_S = 0.9

const seg = ([a, b], v) => clamp01((v - a) / (b - a))
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The element's camera at progress 0 (Pendulum Heroes' element.js / kinder-element.js, empty element
 * with hud="off", so the drawing box is centred): s CSS px per reel px, (ox, oy) the reel origin.
 */
function cameraAtStart(kind, w, h) {
  const pad = Math.max(12, Math.min(48, Math.round(Math.min(w, h) * 0.04)))
  const aw = w - 2 * pad
  const ah = h - 2 * pad
  const camX = w / 2
  const camY = h / 2
  if (kind === 'bar') {
    const s = Math.min(aw / 1355, ah / 698)
    return { s, ox: camX - 625.5 * s, oy: camY - 341 * s }
  }
  const [x0, x1] = w < 640 ? [95, 1180] : [40, 1275]
  const fullS = Math.min(aw / (x1 - x0), ah / 675)
  const s = Math.max(fullS, (0.62 * Math.min(aw, ah)) / 300) // zoomed in on the slice
  return { s, ox: camX - 840 * s, oy: camY - 300 * s }
}

export default function FooterPendulum() {
  const onHome = useLocation().pathname === '/'
  const onHomeRef = useRef(onHome)
  onHomeRef.current = onHome
  const theme = useTheme()
  const kind = theme === 'dark' ? 'bar' : 'melon'
  const sprite = SPRITES[kind]
  const slotRef = useRef(null)
  const miniRef = useRef(null)
  const melonRef = useRef(null)
  const barRef = useRef(null)
  const [near, setNear] = useState(false) // the footer is close enough to load the elements
  const [loaded, setLoaded] = useState({ melon: false, bar: false })
  const [sawDark, setSawDark] = useState(theme === 'dark')
  if (theme === 'dark' && !sawDark) setSawDark(true)

  // load the elements once the footer comes within a screen and a half
  useEffect(() => {
    const slot = slotRef.current
    if (!slot) return undefined
    const io = new IntersectionObserver(([entry]) => entry.isIntersecting && setNear(true), {
      rootMargin: '150% 0px',
    })
    io.observe(slot)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!near) return
    let live = true
    import('../../vendor/pendulum/melon-pendulum.js').then(() => live && setLoaded((l) => ({ ...l, melon: true })))
    return () => {
      live = false
    }
  }, [near])

  useEffect(() => {
    if (!near || !sawDark) return
    let live = true
    import('../../vendor/pendulum/kinder-pendulum.js').then(() => live && setLoaded((l) => ({ ...l, bar: true })))
    return () => {
      live = false
    }
  }, [near, sawDark])

  // every frame the page scrolls (or resizes): where the slot is, where the mini is, what the figure shows
  useEffect(() => {
    const slot = slotRef.current
    if (!slot) return undefined
    let raf = 0
    // the figure's progress, which runs on its own once the mini has landed; it starts where the
    // element is (finished, coming back to the homepage from another page)
    const el0 = kind === 'bar' ? barRef.current : melonRef.current
    let prog = typeof el0?.progress === 'number' ? el0.progress : 0
    let lastP = prog
    let lastLive = prog >= LIVE_AT
    let goal = prog // where it is heading: 1 once landed, 0 before
    let tween = 0 // the frame of that run
    let tweenAt = 0
    let tileAt = ''
    let miniShown = -1

    const showProgress = (el, p) => {
      if (!el || p === lastP) return
      lastP = p
      el.progress = p
      const live = p >= LIVE_AT
      if (live !== lastLive) {
        lastLive = live
        if (live) el.play()
        else el.pause() // the idle sway stays at its first pose, the one the mini was drawn in
      }
      if (live) slot.setAttribute('data-cursor', 'drag')
      else slot.removeAttribute('data-cursor')
    }
    const step = (now) => {
      tween = 0
      const dt = Math.min(0.05, (now - tweenAt) / 1000)
      tweenAt = now
      prog = goal > prog ? Math.min(goal, prog + dt / MORPH_S) : Math.max(goal, prog - dt / UNMORPH_S)
      showProgress(kind === 'bar' ? barRef.current : melonRef.current, prog)
      if (prog !== goal) tween = requestAnimationFrame(step)
    }
    const runTo = (to) => {
      goal = to
      if (!tween && prog !== goal) {
        tweenAt = performance.now()
        tween = requestAnimationFrame(step)
      }
    }
    const showMini = (opacity, x = 0, y = 0, rotate = 0, scale = 1) => {
      const mini = miniRef.current
      if (!mini) return
      if (opacity > 0) mini.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${rotate}deg) scale(${scale})`
      if (opacity !== miniShown) {
        miniShown = opacity
        mini.style.opacity = String(opacity)
      }
    }

    const update = () => {
      raf = 0
      const vh = window.innerHeight
      const r = slot.getBoundingClientRect()
      const el = kind === 'bar' ? barRef.current : melonRef.current

      // the paper tile under the figure lines up with the page's (it repeats from the document's top-left)
      const at = `${-Math.round(r.left + window.scrollX)}px ${-Math.round(r.top + window.scrollY)}px`
      if (at !== tileAt) {
        tileAt = at
        slot.style.backgroundPosition = at
      }

      const reduced = reducedMotion()
      // away from the homepage there is no story to tell: the pendulum, swinging
      if (!onHome) {
        showMini(0)
        slot.style.opacity = '1'
        cancelAnimationFrame(tween)
        tween = 0
        prog = goal = 1
        if (!reduced) showProgress(el, 1)
        if (el?.paused) el.play()
        slot.setAttribute('data-cursor', 'drag')
        return
      }
      if (reduced) {
        showMini(0)
        slot.style.opacity = '1'
        if (el?.hasAttribute('progress')) el.removeAttribute('progress')
        if (el?.paused) el.play() // it only takes a drag while playing
        slot.setAttribute('data-cursor', 'drag')
        return
      }

      const headerH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 64
      const startTop = START * vh
      const u = clamp01((startTop - r.top) / Math.max(1, startTop - headerH - END_GAP))
      // the slide: from the about section's arrival to the figure's
      const about = document.getElementById('about')
      const aboutTop = about ? about.getBoundingClientRect().top : -Infinity
      const slideFrom = window.scrollY + aboutTop - SLIDE_FROM * vh
      const slideTo = window.scrollY + r.top - startTop
      const a = slideTo > slideFrom ? clamp01((window.scrollY - slideFrom) / (slideTo - slideFrom)) : 1

      // the bar's model streams in: until it is ready (or has failed, leaving the line art), the
      // figure would show only paper at the start, so the mini keeps covering it
      const ready = !!el && (kind === 'melon' || el._glState >= 2)
      const flight = seg(FLIGHT, u)
      const handoff = ready ? seg(HANDOFF, u) : 0
      slot.style.opacity = String(handoff)
      runTo(ready && handoff >= 1 ? 1 : 0) // landed: off it goes

      // the mini: gliding down the about section's gutter, then onto the figure's own slice/bar
      const sp = SPRITES[kind]
      const cam = cameraAtStart(kind, r.width, r.height)
      const tx = r.left + cam.ox + sp.hotReel[0] * cam.s
      const ty = r.top + cam.oy + sp.hotReel[1] * cam.s
      const photo = about?.querySelector('.about__photo')?.getBoundingClientRect()
      const text = about?.querySelector('.about__content')?.getBoundingClientRect()
      const gutterX = photo && text && photo.right < text.left ? (photo.right + text.left) / 2 : tx
      const mini = MINI_LENGTH[kind] / sp.lengthPx
      const land = cam.s / sp.reelPx
      const ea = easeInOut(a)
      const ef = easeInOut(flight)
      const slideY = -sp.h * mini + (SLIDE_TO_Y * vh + sp.h * mini) * ea // from just above the top edge
      const x = gutterX + (tx - gutterX) * ef
      const y = slideY + (ty - slideY) * ef
      const scale = Math.exp(Math.log(mini) + (Math.log(land) - Math.log(mini)) * ef)
      const rotate = MINI_TILT * (1 - ea)
      showMini(a > 0 ? 1 - handoff : 0, x, y, rotate, scale)
    }

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    const ro = new ResizeObserver(schedule) // the page changes height on route changes
    ro.observe(document.body)
    ro.observe(slot)
    // the bar's model finishes loading on its own time: keep looking while it streams in
    const poll = setInterval(() => kind === 'bar' && barRef.current?._glState < 2 && schedule(), 250)
    schedule()
    return () => {
      cancelAnimationFrame(raf)
      cancelAnimationFrame(tween)
      clearInterval(poll)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      ro.disconnect()
    }
  }, [kind, loaded, onHome])

  // freeze the idle sway from the very first paint, so the figure's slice/bar sits in the mini's pose
  const hold = (el) => {
    if (!el || el.dataset.held) return
    el.dataset.held = '1'
    if (reducedMotion()) return // its still, finished figure, which moves only while dragged
    if (!onHomeRef.current) {
      el.progress = 1 // off the homepage: already drawn and swinging
      return
    }
    el.progress = 0
    el.pause()
  }
  const setMelon = (el) => {
    melonRef.current = el
    hold(el)
  }
  const setBar = (el) => {
    barRef.current = el
    hold(el)
  }

  return (
    <>
      <div ref={slotRef} className="footer-pendulum" aria-hidden={!loaded[kind] || undefined}>
        {loaded.melon && (
          <melon-pendulum
            ref={setMelon}
            className="footer-pendulum__figure"
            theme="light"
            hud="off"
            hidden={kind !== 'melon' || undefined}
            label="A watermelon slice that opens into the disk of a line-art ballistic pendulum, swinging"
          />
        )}
        {loaded.bar && (
          <kinder-pendulum
            ref={setBar}
            className="footer-pendulum__figure"
            theme="dark"
            hud="off"
            src={glbUrl}
            hidden={kind !== 'bar' || undefined}
            label="A chocolate bar that lands on the platform of a line-art ballistic pendulum, swinging"
          />
        )}
      </div>
      {/* the mini that slides down to it (the homepage only); its point sits on its box's origin */}
      {onHome && (
        <div ref={miniRef} className="footer-pendulum__mini" aria-hidden="true">
          <img
            src={sprite.src}
            alt=""
            width={sprite.w}
            height={sprite.h}
            draggable="false"
            style={{ left: -sprite.hotX, top: -sprite.hotY }}
          />
        </div>
      )}
    </>
  )
}
