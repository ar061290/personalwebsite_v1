import { GREEK_FONT_FAMILY, stickerSrc } from '../../assets/stickers/index.js'
import { getTheme, onThemeChange } from '../../lib/theme.js'

// DOM builders for click-placed stickers, mirroring vegan.ning-h.com's markup:
//
//   .stk-box                  width W, height 2H (positioned/rotated by useStickers)
//     .stk.stk--back          W×H window, clipped
//       .stk__art             slides; holds the back (flat, mirrored silhouette)
//     .stk.stk--front         W×H window, clipped
//       .stk__art             slides; holds the front art
//
// Adding `is-active` slides both windows and their art (Stickers.css), which reads
// as the sticker being peeled down onto the page.

const SVG_NS = 'http://www.w3.org/2000/svg'
const INK = '#0c0c0c'
const PAPER = '#ffffff'

// Backing-paper tone for generated backs (the reference ships a darker, flat
// silhouette image per sticker; Stickers.css produces the same grey for images).
const BACK_TONE = '#d4d4d4'

export const GREEK_BASE_SIZE = 144 // px font-size at scale 1
const GREEK_WEIGHT = 400
const CUT_WIDTH = 0.15 // em; half of this stroke shows outside the glyph as the die-cut edge

export const greekFont = (size) => `${GREEK_WEIGHT} ${size}px ${GREEK_FONT_FAMILY}`

let measureCtx

// Tight ink box of a glyph, so the die-cut sticker hugs it. Falls back to a roomy
// em box while the web font is still loading (it may swap in after placement).
function measureGlyph(letter, fontSize) {
  const font = greekFont(fontSize)
  let fontReady = true
  try {
    fontReady = document.fonts?.check(font, letter) ?? true
  } catch {
    fontReady = false
  }

  measureCtx ??= document.createElement('canvas').getContext('2d')
  if (measureCtx && fontReady) {
    measureCtx.font = font
    const m = measureCtx.measureText(letter)
    const box = {
      left: m.actualBoundingBoxLeft,
      right: m.actualBoundingBoxRight,
      ascent: m.actualBoundingBoxAscent,
      descent: m.actualBoundingBoxDescent,
    }
    if (box.left + box.right > 0 && box.ascent + box.descent > 0) return box
  }

  return { left: fontSize * 0.1, right: fontSize * 0.95, ascent: fontSize * 0.95, descent: fontSize * 0.32 }
}

function face(modifier, content, width, height) {
  const el = document.createElement('div')
  el.className = `stk ${modifier}`
  el.style.width = `${width}px`
  el.style.height = `${height}px`

  const art = document.createElement('div')
  art.className = 'stk__art'
  art.append(content)
  el.append(art)
  return el
}

function stickerBox(front, back, width, height) {
  const el = document.createElement('div')
  el.className = 'stk-box'
  el.append(face('stk--back', back, width, height), face('stk--front', front, width, height))
  return { el, width, height }
}

// Theme switch: placed stickers swap to the other art in place (same size and
// geometry, so the physics never notices). The art is preloaded and decoded
// (useStickers.js), so the new src paints in the same frame — what the theme's
// view transition needs. Greek stickers recolour through CSS (Stickers.css).
let themeListening = false
function listenForTheme() {
  if (themeListening) return
  themeListening = true
  onThemeChange((theme) => {
    for (const img of document.querySelectorAll('img.stk__media[data-src-light]')) {
      const next = theme === 'dark' ? img.dataset.srcDark : img.dataset.srcLight
      if (next && img.getAttribute('src') !== next) img.src = next
    }
  })
}

function image(sticker, isBack) {
  listenForTheme()
  const el = document.createElement('img')
  el.className = isBack ? 'stk__media stk__media--back' : 'stk__media'
  el.dataset.srcLight = sticker.src
  if (sticker.srcDark) el.dataset.srcDark = sticker.srcDark
  el.src = stickerSrc(sticker, getTheme())
  el.alt = ''
  el.decoding = 'sync'
  el.draggable = false
  return el
}

/** Physics sticker from the art manifest: { src, srcDark, width, height } in CSS px at scale 1. */
export function buildImageSticker(sticker, scale) {
  const width = (sticker.width || 160) * scale
  const height = (sticker.height || 160) * scale
  return stickerBox(image(sticker, false), image(sticker, true), width, height)
}

/** Greek letter as a die-cut vinyl sticker: black glyph, thick white border. */
export function buildGreekSticker(letter, scale) {
  const fontSize = GREEK_BASE_SIZE * scale
  const metrics = measureGlyph(letter, fontSize)
  const cut = fontSize * CUT_WIDTH
  const pad = cut / 2 + 2
  const width = metrics.left + metrics.right + pad * 2
  const height = metrics.ascent + metrics.descent + pad * 2

  const glyph = (isBack) => {
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('class', 'stk__media')
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    svg.setAttribute('aria-hidden', 'true')

    const text = document.createElementNS(SVG_NS, 'text')
    text.setAttribute('class', isBack ? 'stk__glyph stk__glyph--back' : 'stk__glyph')
    text.setAttribute('x', pad + metrics.left)
    text.setAttribute('y', pad + metrics.ascent)
    text.setAttribute('fill', isBack ? BACK_TONE : INK)
    text.setAttribute('stroke', isBack ? BACK_TONE : PAPER)
    text.setAttribute('stroke-width', cut)
    text.setAttribute('stroke-linejoin', 'round')
    text.setAttribute('stroke-linecap', 'round')
    text.setAttribute('paint-order', 'stroke')
    text.style.fontFamily = GREEK_FONT_FAMILY
    text.style.fontSize = `${fontSize}px`
    text.style.fontWeight = GREEK_WEIGHT
    text.textContent = letter

    if (isBack) {
      // The back of a sticker flipped up over its top edge is its mirror image.
      const flip = document.createElementNS(SVG_NS, 'g')
      flip.setAttribute('transform', `matrix(1 0 0 -1 0 ${height})`)
      flip.append(text)
      svg.append(flip)
    } else {
      svg.append(text)
    }
    return svg
  }

  return stickerBox(glyph(false), glyph(true), width, height)
}
