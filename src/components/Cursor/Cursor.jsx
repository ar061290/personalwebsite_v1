import { useEffect, useRef, useSyncExternalStore } from 'react'
import gsap from 'gsap'
import { CustomEase } from 'gsap/CustomEase'
import { isMelonGrabbing, isOverMelon } from '../../lib/melonBus.js'
import './Cursor.css'

// Custom "+ CLICK" cursor, cloned from vegan.ning-h.com (customCursor() in their
// utility.js). Differences are deliberate and documented in specs/cursor-stickers.md:
// the native pointer is hidden, so the "+" tracks the pointer exactly while the
// word trails behind it with the reference's quickTo lag.

gsap.registerPlugin(CustomEase)

// Tailwind's default transition curve, which the reference `.cursor_contain` slides on.
const EASE_STANDARD = CustomEase.create('cursorStandard', 'M0,0 C0.4,0 0.2,1 1,1')

const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)'
const ROOT_CLASS = 'has-custom-cursor'

const DEFAULT_TEXT = 'click'
const MELON_TEXT = 'drag'
const SCROLLED_AT = 40 // px of scroll after which the "click" word is tucked away

// Label offsets, in percent of the label box, relative to the hotspot.
const LABEL_X = 0
const LABEL_X_FLIPPED = -100 // right third of the viewport: word moves left of the "+"
const LABEL_Y = -50 // capitals centred on the "+"
const LABEL_Y_FLIPPED = -170 // bottom 10%: the reference's 170% jump (50 → -120)
const FLIP_X_AT = 0.66
const FLIP_Y_AT = 0.9

const TUCKED_Y = -110 // `.cursor_contain` yPercent when the word is hidden above its mask

const subscribeFinePointer = (onChange) => {
  const query = window.matchMedia?.(FINE_POINTER_QUERY)
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}
const hasFinePointer = () => window.matchMedia?.(FINE_POINTER_QUERY).matches ?? false

// `data-cursor` values may carry their own plus (the reference uses "＋ Click").
const cleanLabel = (value) => (value ?? '').replace(/^[+＋]\s*/, '').trim()

export default function Cursor() {
  // Touch-only devices keep their native behaviour: nothing is rendered.
  const finePointer = useSyncExternalStore(subscribeFinePointer, hasFinePointer, () => false)
  return finePointer ? <CustomCursor /> : null
}

function CustomCursor() {
  const rootRef = useRef(null)
  const presenceRef = useRef(null)
  const plusRef = useRef(null)
  const labelRef = useRef(null)
  const containRef = useRef(null)
  const textRef = useRef(null)

  useEffect(() => {
    const root = rootRef.current
    const presence = presenceRef.current
    const plus = plusRef.current
    const label = labelRef.current
    const contain = containRef.current
    const text = textRef.current
    const html = document.documentElement

    html.classList.add(ROOT_CLASS)

    let pointer = null // { x, y, target }
    let frame = 0
    let present = false
    let flipX = false
    let flipY = false
    let grabbing = false
    let wantedText = DEFAULT_TEXT
    let shownText = DEFAULT_TEXT
    let swap = null

    text.textContent = DEFAULT_TEXT
    gsap.set(label, { xPercent: LABEL_X, yPercent: LABEL_Y })
    gsap.set(contain, { yPercent: 0 })
    gsap.set(presence, { opacity: 0 })

    // Entrance, as on the reference's first load: their `.cursor` (our label) fades in,
    // then the text drops into its mask. The "+" stands in for the hidden native
    // pointer, so it is never held back by the entrance.
    gsap.set(label, { opacity: 0 })
    gsap.set(text, { y: -100 })
    const entrance = gsap
      .timeline({ delay: 0.5 })
      .to(label, { opacity: 1, duration: 0.5, ease: 'power3.out' })
      .to(text, { y: 0, duration: 0.5, ease: 'power3.out' })

    // Reference: gsap.quickTo(cursor, 'x' | 'y', { ease: 'power3' }) at the default 0.5s.
    const xTo = gsap.quickTo(label, 'x', { ease: 'power3' })
    const yTo = gsap.quickTo(label, 'y', { ease: 'power3' })

    const writeText = (value) => {
      if (value === shownText) return
      text.textContent = value
      shownText = value
    }

    // Empty text fades the word out, leaving only the "+"; it fades back in when a
    // word is wanted again. Changing one word for another slides it out and back in.
    const setText = (next) => {
      if (next === wantedText) return
      wantedText = next
      swap?.kill()

      if (!next) {
        swap = gsap.to(contain, { opacity: 0, duration: 0.6, ease: 'power2.out' })
        return
      }

      const faded = gsap.getProperty(contain, 'opacity') < 1
      if (faded || next === shownText) {
        writeText(next)
        gsap.set(contain, { yPercent: 0 })
        swap = gsap.to(contain, { opacity: 1, duration: 0.6, ease: 'power2.out' })
        return
      }

      swap = gsap
        .timeline()
        .to(contain, { yPercent: TUCKED_Y, duration: 0.2, ease: 'power2.in' })
        .call(writeText, [next])
        .to(contain, { yPercent: 0, duration: 0.5, ease: EASE_STANDARD })
    }

    const resolveText = (x, y, target) => {
      if (grabbing || isMelonGrabbing() || isOverMelon(x, y)) return MELON_TEXT
      const tagged = target instanceof Element ? target.closest('[data-cursor]') : null
      if (tagged) return cleanLabel(tagged.getAttribute('data-cursor'))
      // Once the page has scrolled, the word goes and only the "+" stays.
      return window.scrollY > SCROLLED_AT ? '' : DEFAULT_TEXT
    }

    const setPresent = (next) => {
      if (present === next) return
      present = next
      gsap.to(presence, { opacity: next ? 1 : 0, duration: 0.3, ease: 'sine.out', overwrite: true })
    }

    const placePlus = (x, y) => {
      plus.style.transform = `translate3d(${x}px, ${y}px, 0)`
    }

    const update = () => {
      frame = 0
      if (!pointer) return
      const { x, y, target } = pointer

      placePlus(x, y)
      xTo(x)
      yTo(y)

      const right = x > window.innerWidth * FLIP_X_AT
      const bottom = y > window.innerHeight * FLIP_Y_AT
      if (right !== flipX || bottom !== flipY) {
        flipX = right
        flipY = bottom
        gsap.to(label, {
          xPercent: right ? LABEL_X_FLIPPED : LABEL_X,
          yPercent: bottom ? LABEL_Y_FLIPPED : LABEL_Y,
          duration: 0.9,
          ease: 'power3',
          overwrite: 'auto',
        })
      }

      setText(resolveText(x, y, target))
    }

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }

    const onPointerMove = (e) => {
      if (e.pointerType === 'touch') {
        setPresent(false)
        return
      }
      const x = e.clientX
      const y = e.clientY
      pointer = { x, y, target: e.target }

      if (!present) {
        // (Re)entering the window: snap everything to the pointer before showing it.
        placePlus(x, y)
        xTo(x, x)
        yTo(y, y)
        setPresent(true)
      }
      schedule()
    }

    const onPointerDown = (e) => {
      if (e.pointerType === 'touch') setPresent(false)
    }

    // A grab cannot outlive the press; guards against a missed 'melon:grabend'.
    const onPointerUp = () => {
      if (!grabbing) return
      grabbing = false
      schedule()
    }

    const onPointerOut = (e) => {
      if (!e.relatedTarget) setPresent(false)
    }

    // Scrolling moves content under a still pointer, so re-resolve what it is over.
    const onScroll = () => {
      if (!pointer) return
      pointer.target = document.elementFromPoint(pointer.x, pointer.y) ?? pointer.target
      schedule()
    }

    const onGrabStart = () => {
      grabbing = true
      schedule()
    }
    const onGrabEnd = () => {
      grabbing = false
      schedule()
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    window.addEventListener('pointerup', onPointerUp, { passive: true })
    window.addEventListener('pointercancel', onPointerUp, { passive: true })
    window.addEventListener('pointerout', onPointerOut, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('melon:grabstart', onGrabStart)
    window.addEventListener('melon:grabend', onGrabEnd)

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('pointerout', onPointerOut)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('melon:grabstart', onGrabStart)
      window.removeEventListener('melon:grabend', onGrabEnd)
      cancelAnimationFrame(frame)
      entrance.kill()
      swap?.kill()
      xTo.tween.kill()
      yTo.tween.kill()
      gsap.killTweensOf([root, presence, label, contain, text])
      html.classList.remove(ROOT_CLASS)
    }
  }, [])

  return (
    <div className="cursor" ref={rootRef} aria-hidden="true">
      <div className="cursor__presence" ref={presenceRef}>
        <span className="cursor__plus" ref={plusRef} />
        <div className="cursor__label" ref={labelRef}>
          <div className="cursor__clip">
            <div className="cursor_contain" ref={containRef}>
              <p className="cursor_text" ref={textRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
