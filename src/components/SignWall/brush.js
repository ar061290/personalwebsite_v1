// The paint brush of akm2's "Painting" pen (codepen.io/akm2/pen/nKwYYQ), ported faithfully:
// a flat elliptical tip of hairs that translate with the pointer, each drawing a line whose
// width falls as the brush speeds up (ink per pixel), splatter when it moves very fast,
// and drops that run down the wall when it lingers. A new random colour on every stroke.
//
// Differences from the pen, all invisible in the result:
// - Every random number comes from a seeded generator, so a signature stored as its pointer
//   samples (one per 60 Hz frame) replays pixel for pixel later, at any wall size.
// - The brush works in "reference pixels"; the caller sets the canvas transform that maps them
//   to the screen, so a signature keeps its look when the wall is resized.
// - The hairs of one frame share their width and colour, so they are stroked as one path.
// - The bounds of everything painted are tracked (for the name label under the signature).

/** mulberry32: a small, fast, seeded PRNG returning [0, 1). */
export function createRng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SPLASHING_BRUSH_SPEED = 75
const TAU = Math.PI * 2

/** The pen's random colour, re-rolled while it would vanish into either paper (light or black). */
export function randomColor(rng = Math.random) {
  for (let i = 0; i < 24; i++) {
    const r = (rng() * 256) | 0
    const g = (rng() * 256) | 0
    const b = (rng() * 256) | 0
    const L = luminance(r, g, b)
    // contrast >= ~1.45 against #f6f3ed (L≈0.9) and ~1.8 against #100d0c (L≈0.005)
    if (L <= 0.6 && L >= 0.045) return toHex(r, g, b)
  }
  return '#d23c5a'
}

function luminance(r, g, b) {
  const f = (c) => {
    c /= 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

const toHex = (r, g, b) => '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)

export class Brush {
  constructor({ rng, size = 35, inkAmount = 7, color = '#000', splashing = true, dripping = true }) {
    this.rng = rng
    this.x = 0
    this.y = 0
    this.color = color
    this.size = size
    this.inkAmount = inkAmount
    this.splashing = splashing
    this.dripping = dripping
    this.stroking = false
    this._strokeId = 0
    this._latest = null
    this._drops = []
    this._tip = []
    this.bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  }

  get hasDrops() {
    return this._drops.length > 0
  }

  /** Puts the tip down at (x, y). (The pen re-forms the tip where the brush last was.) */
  startStroke(x, y, color) {
    if (this.stroking) return
    this.x = x
    this.y = y
    if (color) this.color = color
    this._resetTip()
    this.stroking = true
    this._strokeId++
  }

  endStroke() {
    this.stroking = false
    this._latest = null
  }

  /** One animation frame of the pen: the brush moves to (x, y). */
  render(ctx, x, y) {
    const rng = this.rng
    const stroking = this.stroking
    if (!this._latest) this._latest = { x: this.x, y: this.y }
    this._latest.x = this.x
    this._latest.y = this.y
    this.x = x
    this.y = y

    const drops = this._drops
    if (drops.length) {
      const sizeSq = this.size * this.size
      for (let i = 0; i < drops.length; i++) {
        const drop = drops[i]
        const dx = this.x - drop.x
        const dy = this.y - drop.y
        if ((stroking && sizeSq > dx * dx + dy * dy && this._strokeId !== drop.strokeId) || drop.life <= 0) {
          drops.splice(i, 1)
          i--
          continue
        }
        renderDrop(ctx, drop, rng, this.bounds)
      }
    }

    if (!stroking) return

    const dx = this.x - this._latest.x
    const dy = this.y - this._latest.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (this.splashing && dist > SPLASHING_BRUSH_SPEED) {
      const maxNum = ((dist - SPLASHING_BRUSH_SPEED) * 0.5) | 0
      ctx.fillStyle = this.color
      ctx.beginPath()
      for (let i = 0, len = (maxNum * rng()) | 0; i < len; i++) {
        const r = (dist - 1) * rng() + 1
        const a = TAU * rng()
        const sr = 5 * rng()
        const sx = this.x + r * Math.sin(a)
        const sy = this.y + r * Math.cos(a)
        ctx.moveTo(sx + sr, sy)
        ctx.arc(sx, sy, sr, 0, TAU, false)
        grow(this.bounds, sx, sy, sr)
      }
      ctx.fill()
    } else if (this.dripping && dist < this.inkAmount * 2 && rng() < 0.05) {
      const size = (this.size + this.inkAmount) * 0.5 * ((0.25 - 0.1) * rng() + 0.1)
      drops.push({
        x: this.x,
        y: this.y,
        px: this.x,
        py: this.y,
        size,
        color: this.color,
        life: size * 1.5,
        xOff: 0,
        strokeId: this._strokeId,
      })
    }

    // The hairs: every one moves by the brush's offset and draws its segment, all at one width.
    let per = dist ? this.inkAmount / dist : 0
    if (per > 1) per = 1
    // (A width of 0 is ignored by canvas, so the pen draws hairline dots while the brush rests.)
    const width = this.inkAmount * per || 1
    const tip = this._tip
    ctx.lineCap = ctx.lineJoin = 'round'
    ctx.strokeStyle = this.color
    ctx.lineWidth = width
    ctx.beginPath()
    for (let i = 0; i < tip.length; i += 2) {
      const hx = tip[i]
      const hy = tip[i + 1]
      ctx.moveTo(hx, hy)
      ctx.lineTo(hx + dx, hy + dy)
      tip[i] = hx + dx
      tip[i + 1] = hy + dy
    }
    ctx.stroke()
    grow(this.bounds, this.x, this.y, this.size * 0.5 + width)
  }

  _resetTip() {
    const rng = this.rng
    const rad = this.size * 0.5
    const a1 = TAU * rng()
    const cv = Math.cos(a1)
    const sv = Math.sin(a1)
    let len = ((rad * rad * Math.PI) / this.inkAmount) | 0
    if (len < 1) len = 1
    const tip = (this._tip = new Array(len * 2))
    for (let i = 0; i < len; i++) {
      const x0 = rad * rng()
      const y0 = x0 * 0.5
      const a0 = TAU * rng()
      const x1 = x0 * Math.sin(a0)
      const y1 = y0 * Math.cos(a0)
      tip[i * 2] = this.x + x1 * cv - y1 * sv
      tip[i * 2 + 1] = this.y + x1 * sv + y1 * cv
    }
  }
}

function renderDrop(ctx, d, rng, bounds) {
  if (rng() < 0.03) d.xOff += 0.06 * rng() - 0.03
  else if (rng() < 0.1) d.xOff *= 0.003
  d.px = d.x
  d.py = d.y
  d.x += d.life * d.xOff
  d.y += d.life * 0.5 * rng()
  d.life -= (0.05 - 0.01) * rng() + 0.01
  const w = d.size + d.life * 0.3
  ctx.lineCap = ctx.lineJoin = 'round'
  ctx.strokeStyle = d.color
  ctx.lineWidth = w
  ctx.beginPath()
  ctx.moveTo(d.px, d.py)
  ctx.lineTo(d.x, d.y)
  ctx.stroke()
  grow(bounds, d.x, d.y, w * 0.5)
}

function grow(b, x, y, r) {
  if (x - r < b.minX) b.minX = x - r
  if (y - r < b.minY) b.minY = y - r
  if (x + r > b.maxX) b.maxX = x + r
  if (y + r > b.maxY) b.maxY = y + r
}
