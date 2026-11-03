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

// Dark theme: the same stickers on milk-cream vinyl with dark-chocolate ink,
// orange-red, caramel and milk-chocolate fills and a soft gloss (generated from
// the light art by a fixed colour map; same geometry, so physics sizes match).
import appliedDark from './dark/applied.svg'
import atomDark from './dark/atom.svg'
import cradleDark from './dark/cradle.svg'
import emc2Dark from './dark/emc2.svg'
import entropyDark from './dark/entropy.svg'
import fmaDark from './dark/fma.svg'
import heisenbergDark from './dark/heisenberg.svg'
import potentialDark from './dark/potential.svg'
import prismDark from './dark/prism.svg'
import righthandDark from './dark/righthand.svg'
import schrodingerDark from './dark/schrodinger.svg'

// width/height: display size in CSS px at base scale. Every sticker uses the same
// art-to-px ratio (0.62), so outlines and die-cut borders match across the set.
export const PHYSICS_STICKERS = [
  { id: 'potential', src: potential, srcDark: potentialDark, width: 160, height: 122, alt: 'I have potential' },
  { id: 'cradle', src: cradle, srcDark: cradleDark, width: 202, height: 130, alt: "Newton's cradle, click clack" },
  { id: 'schrodinger', src: schrodinger, srcDark: schrodingerDark, width: 150, height: 128, alt: "Schrödinger's smiley" },
  { id: 'righthand', src: righthand, srcDark: righthandDark, width: 136, height: 141, alt: 'Right-hand rule, a × b' },
  { id: 'entropy', src: entropy, srcDark: entropyDark, width: 145, height: 145, alt: 'Entropy Coffee Co., always increasing' },
  { id: 'applied', src: applied, srcDark: appliedDark, width: 145, height: 117, alt: 'Applied physics' },
  { id: 'emc2', src: emc2, srcDark: emc2Dark, width: 199, height: 97, alt: "E = mc², it's all relative" },
  { id: 'fma', src: fma, srcDark: fmaDark, width: 174, height: 107, alt: 'May the F = ma be with you' },
  { id: 'atom', src: atom, srcDark: atomDark, width: 154, height: 159, alt: 'Atom: they make up everything' },
  { id: 'heisenberg', src: heisenberg, srcDark: heisenbergDark, width: 171, height: 128, alt: 'Heisenberg may have slept here' },
  { id: 'prism', src: prism, srcDark: prismDark, width: 202, height: 138, alt: 'Bend it like Snell' },
]

/** The art for a theme ('light' | 'dark'). */
export const stickerSrc = (sticker, theme) => (theme === 'dark' && sticker.srcDark) || sticker.src

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
  const images = PHYSICS_STICKERS.flatMap(({ src, srcDark }) =>
    [src, srcDark].filter(Boolean).map((url) => {
      const img = new Image()
      img.src = url
      return img.decode?.() ?? Promise.resolve()
    }),
  )
  preloadPromise = Promise.allSettled([font, ...images]).then(() => undefined)
  return preloadPromise
}
