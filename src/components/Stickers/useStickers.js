import { useEffect, useRef, useState } from 'react'
import { GREEK_LETTERS, PHYSICS_STICKERS } from '../../assets/stickers/index.js'
import { isMelonGrabbing, isOverMelon } from '../../lib/melonBus.js'
import { buildGreekSticker, buildImageSticker, GREEK_BASE_SIZE, greekFont } from './stickerFactory.js'
import './Stickers.css'

// Click-to-place stickers, cloned from vegan.ning-h.com's initializeSticker()
// (numbers, timings and removal behaviour are theirs; see specs/cursor-stickers.md).
// In the hero they go into one of two layers that sit under the watermelon: the
// first one lands above the fluid background, every later one is a coin flip, and
// they stay. Everywhere else on the site one page-wide layer takes them, and each
// one comes off again after a short while (`lifetime`).

const MAX_STICKERS = 16
const RECENT_MEMORY = 4 // a sticker is not repeated within the last four picks
const TAP_SLOP = 6 // px the pointer may travel between press and release
const IGNORE_SELECTOR =
  'a, button, .site-header, input, textarea, select, label, [contenteditable], [data-no-sticker], dialog'

const random = (min, max) => Math.random() * (max - min) + min

/** Sticker size multiplier for the current viewport width (reference breakpoints). */
export function calculateSizeFactor(width = window.innerWidth) {
  if (width < 576) return 0.6
  if (width < 768) return 0.75
  if (width < 992) return 0.85
  if (width < 1200) return 0.9
  return 1
}

const maxStickers = () =>
  window.innerWidth < 768 ? Math.floor(MAX_STICKERS * 0.75) : MAX_STICKERS

// 50/50 physics art or Greek letter, then a random item of that kind that was
// not among the last few picks.
function createPicker() {
  const recent = []
  const physics = PHYSICS_STICKERS.map((sticker) => ({ key: `p:${sticker.id}`, sticker }))
  const greek = GREEK_LETTERS.map((letter) => ({ key: `g:${letter}`, letter }))

  return function pick() {
    const pool = physics.length && (Math.random() < 0.5 || !greek.length) ? physics : greek
    if (!pool.length) return null

    let options = pool.filter((item) => !recent.includes(item.key))
    if (!options.length) options = pool.filter((item) => item.key !== recent.at(-1))
    if (!options.length) options = pool

    const choice = options[Math.floor(Math.random() * options.length)]
    recent.push(choice.key)
    if (recent.length > RECENT_MEMORY) recent.shift()
    return choice
  }
}

// Decoded art for both themes, held so a theme switch can swap every placed
// sticker's src in the same frame (stickerFactory.js).
const artCache = []

function preloadArt() {
  if (!artCache.length) {
    for (const sticker of PHYSICS_STICKERS) {
      for (const url of [sticker.src, sticker.srcDark]) {
        if (!url) continue
        const img = new Image()
        img.decoding = 'async'
        img.src = url
        img.decode?.().catch(() => {})
        artCache.push(img)
      }
    }
  }
  try {
    document.fonts?.load(greekFont(GREEK_BASE_SIZE), GREEK_LETTERS.join('')).catch(() => {})
  } catch {
    // An unparsable font string only costs us the preload.
  }
}

function createStickerBoard({ underRef, overRef, isEnabled, lifetime = 0, exclude = '', page = false }) {
  const pick = createPicker()
  const placed = [] // oldest first
  const leaving = new Set()
  let sizeFactor = calculateSizeFactor()
  let placedFirst = false
  let press = null
  let resizeTimer = 0

  preloadArt()

  const layer = (over) =>
    (over ? overRef.current : underRef.current) ?? (over ? underRef.current : overRef.current)

  function retire(record) {
    cancelAnimationFrame(record.raf)
    clearTimeout(record.timer)
    clearTimeout(record.life)
    record.el.classList.add('is-removing')
    leaving.add(record)
    record.timer = setTimeout(() => {
      record.el.remove()
      leaving.delete(record)
    }, 300)
  }

  function create(x, y, parent, rect) {
    const choice = pick()
    if (!choice) return

    const rotation = random(-60, 60)
    const scale = random(1, 1.2) * sizeFactor
    const { el, width, height } = choice.sticker
      ? buildImageSticker(choice.sticker, scale)
      : buildGreekSticker(choice.letter, scale)

    // Box is twice the sticker height; the sticker settles in its lower half,
    // hanging from the click point, and rotates about its own centre.
    Object.assign(el.style, {
      width: `${width}px`,
      height: `${height * 2}px`,
      left: `${x - width / 2}px`,
      top: `${y - height}px`,
      transform: `rotate(${rotation}deg) scale(0)`,
      opacity: '0',
    })
    parent.append(el)

    const record = { el, parent, x, y, width, height, layerW: rect.width, layerH: rect.height, raf: 0, timer: 0, life: 0 }
    placed.push(record)
    if (lifetime > 0) {
      record.life = setTimeout(() => {
        const i = placed.indexOf(record)
        if (i >= 0) placed.splice(i, 1)
        retire(record)
      }, lifetime)
    }

    // Commit the scale(0) start state so the pop-in transition always runs.
    void el.offsetWidth
    record.raf = requestAnimationFrame(() => {
      el.style.transition = 'transform 0.3s ease-out, opacity 0.3s ease-out'
      el.style.transform = `rotate(${rotation}deg) scale(1)`
      el.style.opacity = '1'
      record.raf = requestAnimationFrame(() => {
        record.raf = 0
        record.timer = setTimeout(() => {
          record.timer = 0
          el.classList.add('is-active')
        }, 300)
      })
    })
  }

  function place(clientX, clientY) {
    const over = !placedFirst || Math.random() >= 0.5
    const parent = layer(over)
    if (!parent) return

    // The page layer is a zero-height sheet at the document's top-left, so its
    // stickers scroll with the page wherever they land; the hero's layers are
    // boxes, and a click must land inside one.
    const rect = parent.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    if (!page && (x < 0 || y < 0 || x > rect.width || y > rect.height)) return

    placedFirst = true
    while (placed.length >= maxStickers()) retire(placed.shift())
    create(x, y, parent, rect)
  }

  function onPointerDown(e) {
    press = null
    if (!isEnabled() || !e.isPrimary || e.button !== 0 || e.ctrlKey || e.metaKey) return
    // a popup over the page (a certificate, a document, the video, the message form) takes no stickers,
    // and neither does the press that closes it
    if (document.querySelector('dialog[open]')) return

    const target = e.target instanceof Element ? e.target : null
    const scope = page ? document.documentElement : (overRef.current ?? underRef.current)?.parentElement
    if (!target || !scope?.contains(target) || target.closest(IGNORE_SELECTOR)) return
    if (exclude && target.closest(exclude)) return
    if (isMelonGrabbing() || isOverMelon(e.clientX, e.clientY)) return

    press = { id: e.pointerId, x: e.clientX, y: e.clientY }
  }

  function onPointerUp(e) {
    const start = press
    if (!start || e.pointerId !== start.id) return
    press = null
    if (!isEnabled() || isMelonGrabbing()) return
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP) return
    place(e.clientX, e.clientY)
  }

  function onPointerCancel(e) {
    if (press?.id === e.pointerId) press = null
  }

  // Reference: debounced 200ms, refresh the size factor for new stickers and keep
  // existing ones inside the area. We keep each sticker at the same relative spot
  // instead of re-scattering it randomly.
  function onResize() {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      sizeFactor = calculateSizeFactor()
      const rects = new Map()
      for (const record of placed) {
        if (!rects.has(record.parent)) rects.set(record.parent, record.parent.getBoundingClientRect())
        const { width, height } = rects.get(record.parent)
        if (!width || !height || (width === record.layerW && height === record.layerH)) continue

        record.x *= width / record.layerW
        record.y *= height / record.layerH
        record.layerW = width
        record.layerH = height
        record.el.style.left = `${record.x - record.width / 2}px`
        record.el.style.top = `${record.y - record.height}px`
      }
    }, 200)
  }

  window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true })
  window.addEventListener('pointerup', onPointerUp, { capture: true, passive: true })
  window.addEventListener('pointercancel', onPointerCancel, { capture: true, passive: true })
  window.addEventListener('resize', onResize, { passive: true })

  return {
    /** Animate every sticker away (the reference's resetStickers, minus the re-seed). */
    clear() {
      while (placed.length) retire(placed.shift())
    },
    destroy() {
      window.removeEventListener('pointerdown', onPointerDown, { capture: true })
      window.removeEventListener('pointerup', onPointerUp, { capture: true })
      window.removeEventListener('pointercancel', onPointerCancel, { capture: true })
      window.removeEventListener('resize', onResize)
      clearTimeout(resizeTimer)
      for (const record of [...placed, ...leaving]) {
        cancelAnimationFrame(record.raf)
        clearTimeout(record.timer)
        clearTimeout(record.life)
        record.el.remove()
      }
      placed.length = 0
      leaving.clear()
      press = null
    },
  }
}

/**
 * Click in the hero (outside the watermelon and interactive elements) to stick a
 * sticker there, or, with `page`, anywhere else on the site.
 *
 * @param {{ underRef: React.RefObject<HTMLElement>, overRef: React.RefObject<HTMLElement>, enabled?: boolean, lifetime?: number, exclude?: string, page?: boolean }} options
 *   underRef / overRef: absolutely positioned layers below / above the fluid background
 *     (for the page board, both the one page-wide layer).
 *   enabled: clicks are ignored while false (e.g. during the intro).
 *   lifetime: ms after which each sticker comes off again (0: it stays).
 *   exclude: a selector of places that take no stickers.
 *   page: the whole document is the board, the layer a zero-height sheet at its top-left.
 * @returns {{ clear: () => void }} `clear()` animates every sticker away.
 */
export default function useStickers({ underRef, overRef, enabled = true, lifetime = 0, exclude = '', page = false } = {}) {
  const enabledRef = useRef(enabled)
  const boardRef = useRef(null)
  const [api] = useState(() => ({ clear: () => boardRef.current?.clear() }))

  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  useEffect(() => {
    const board = createStickerBoard({ underRef, overRef, isEnabled: () => enabledRef.current, lifetime, exclude, page })
    boardRef.current = board
    return () => {
      board.destroy()
      if (boardRef.current === board) boardRef.current = null
    }
  }, [underRef, overRef, lifetime, exclude, page])

  return api
}
