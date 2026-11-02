// Cold-press watercolour paper: one seamless tile, generated procedurally
// (periodic fBm + domain-warped Worley tooth + fibres, lit as a soft emboss).
//
// Tiling contract: the tile repeats from DOCUMENT (0, 0), i.e. page pixel
// (x, y) sits at tile coords (x mod PAPER_TILE_CSS, y mod PAPER_TILE_CSS).
// paper.css paints it that way, and anything that samples the paper (the juice
// absorption sim) must do the same — see paperUv().
//
// PAPER_URL         1024² colour webp, shown at 512 CSS px (2× density).
// PAPER_HEIGHT_URL  512² grayscale PNG of the same tile, 1 texel per CSS px:
//                   0 = deepest pit, 255 = highest bump (mean ≈ 141). Use it
//                   as porosity / relief. Power-of-two, so REPEAT wrapping works
//                   even in WebGL1.
import paperUrl from './paper.webp'
import paperHeightUrl from './paper-height.png'

export const PAPER_URL = paperUrl
export const PAPER_HEIGHT_URL = paperHeightUrl
/** CSS px per tile edge (both images cover exactly one tile). */
export const PAPER_TILE_CSS = 512
/** Texels per edge of the height map. */
export const PAPER_HEIGHT_SIZE = 512
/** Mean colour of the tile; also the page's --bg. */
export const PAPER_BASE = '#F6F3ED'

/** Document-space CSS px → tile UV in [0, 1). */
export function paperUv(docX, docY) {
  const t = PAPER_TILE_CSS
  return [(((docX % t) + t) % t) / t, (((docY % t) + t) % t) / t]
}

let heightPromise = null
/**
 * Decodes the height map once. Resolves to
 * { width, height, data: Uint8Array (one byte per texel, row-major), image }.
 */
export function loadPaperHeight() {
  if (heightPromise) return heightPromise
  heightPromise = new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = image
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(image, 0, 0)
      const rgba = ctx.getImageData(0, 0, w, h).data
      const data = new Uint8Array(w * h)
      for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4]
      resolve({ width: w, height: h, data, image })
    }
    image.onerror = () => {
      heightPromise = null
      reject(new Error('paper height map failed to load'))
    }
    image.src = PAPER_HEIGHT_URL
  })
  return heightPromise
}
