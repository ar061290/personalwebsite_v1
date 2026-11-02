// Sticker art manifest: physics die-cut stickers (SVG, lettering already outlined
// so they render identically inside <img>) + the Greek-letter sticker font.
import './stickers.css'

import applied from './applied.svg'
import atom from './atom.svg'
import cradle from './cradle.svg'
import emc2 from './emc2.svg'
import entropy from './entropy.svg'
import fma from './fma.svg'
import heisenberg from './heisenberg.svg'
import potential from './potential.svg'
import prism from './prism.svg'
import righthand from './righthand.svg'
import schrodinger from './schrodinger.svg'

// width/height: display size in CSS px at base scale. Every sticker uses the same
// art-to-px ratio (0.62), so outlines and die-cut borders match across the set.
export const PHYSICS_STICKERS = [
  { id: 'potential', src: potential, width: 160, height: 122, alt: 'I have potential' },
  { id: 'cradle', src: cradle, width: 202, height: 130, alt: "Newton's cradle, click clack" },
  { id: 'schrodinger', src: schrodinger, width: 150, height: 128, alt: "Schrödinger's smiley" },
  { id: 'righthand', src: righthand, width: 136, height: 141, alt: 'Right-hand rule, a × b' },
  { id: 'entropy', src: entropy, width: 145, height: 145, alt: 'Entropy Coffee Co., always increasing' },
  { id: 'applied', src: applied, width: 145, height: 117, alt: 'Applied physics' },
  { id: 'emc2', src: emc2, width: 199, height: 97, alt: "E = mc², it's all relative" },
  { id: 'fma', src: fma, width: 174, height: 107, alt: 'May the F = ma be with you' },
  { id: 'atom', src: atom, width: 154, height: 159, alt: 'Atom: they make up everything' },
  { id: 'heisenberg', src: heisenberg, width: 171, height: 128, alt: 'Heisenberg may have slept here' },
  { id: 'prism', src: prism, width: 202, height: 138, alt: 'Bend it like Snell' },
]

export const GREEK_LETTERS = ['α', 'β', 'γ', 'Δ', 'ε', 'θ', 'λ', 'μ', 'ν', 'ρ', 'σ', 'τ', 'φ', 'ψ', 'ω']

export const GREEK_FONT_FAMILY = "'GFS Didot', serif"

let preloadPromise = null

/**
 * Warm the caches so the first click shows its sticker instantly: loads the Greek
 * font (fonts are otherwise fetched lazily on first use) and decodes every SVG.
 * Idempotent; never rejects.
 */
export function preloadStickers() {
  if (preloadPromise) return preloadPromise
  if (typeof document === 'undefined') return Promise.resolve()

  const font = document.fonts?.load(`64px ${GREEK_FONT_FAMILY}`, GREEK_LETTERS.join('')) ?? Promise.resolve()
  const images = PHYSICS_STICKERS.map(({ src }) => {
    const img = new Image()
    img.src = src
    return img.decode?.() ?? Promise.resolve()
  })
  preloadPromise = Promise.allSettled([font, ...images]).then(() => undefined)
  return preloadPromise
}
