// The stretched name drawn on the squash layers. sofaknows uses a custom
// "SOFAKNOWS" path logo (viewBox 0 0 1512 872, preserveAspectRatio="none")
// that is squeezed to fill each layer. We draw the name as SVG text in Archivo
// (62.5% width, 900 weight) fitted to its ink box, so it stretches edge to edge
// exactly like their paths. Font size is 1000 user units.

export const NAME = 'AADIRAMNANI'

// Tightened tracking (user units) so letters sit close together like their logo.
export const MARK_TRACKING = -35

// The layers only ever show a left-hand slice of the logo, so what reads on
// screen is a prefix: at rest the top layer shows its left 50%, which on
// sofaknows is "SOFA" + 81% of the "K". A uniform "AADIRAMNANI" would put
// "AADIR" + most of the next "A" there instead. To keep the brief's mapping
// (SOFA → AADI, SOFAK → AADIR, SOFAKNOWS → AADIRAMNANI) the name is set in two
// runs pinned to their glyph edges in the 1512-unit logo: "SOFAK" ends at
// 51.9% and "N" starts at 52.2%. Each run is fitted to its own ink box.
// `viewBox` is the fallback ink box measured in Chrome with the bundled
// Archivo (ascent 687.5, tracking applied); `x`/`width` are % of the mark.
export const MARK_PARTS = [
  { text: 'AADIR', x: 0, width: 51.9, viewBox: '0 -687.5 2218.6 687.5' },
  { text: 'AMNANI', x: 52.2, width: 47.8, viewBox: '0 -687.5 2878.4 687.5' },
]

const fallbackWidth = (part) => Number(part.viewBox.split(' ')[2])

// Measure the real ink boxes once the font is loaded. Returns one viewBox
// string per part, or null if the measurement looks wrong (font missing, no
// TextMetrics, …). Both parts share one ascent so their baselines line up.
export function measureMark() {
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return null
    ctx.font = '900 extra-condensed 1000px Archivo'
    const boxes = MARK_PARTS.map(({ text }) => {
      const m = ctx.measureText(text)
      const left = m.actualBoundingBoxLeft || 0
      return {
        left,
        width: left + m.actualBoundingBoxRight + MARK_TRACKING * (text.length - 1),
        ascent: m.actualBoundingBoxAscent,
        descent: Math.max(0, m.actualBoundingBoxDescent || 0),
      }
    })
    const ascent = Math.max(...boxes.map((b) => b.ascent))
    const descent = Math.max(...boxes.map((b) => b.descent))
    if (!(ascent >= 600 && ascent <= 780)) return null
    // A fallback face (font failed to load) measures far off; keep the defaults then.
    const sane = boxes.every((b, i) => {
      const ref = fallbackWidth(MARK_PARTS[i])
      return b.width > ref * 0.8 && b.width < ref * 1.2
    })
    if (!sane) return null
    return boxes.map(
      (b) => `${round(-b.left)} ${round(-ascent)} ${round(b.width)} ${round(ascent + descent)}`,
    )
  } catch {
    return null
  }
}

const round = (v) => Math.round(v * 10) / 10
