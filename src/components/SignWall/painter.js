// A signature on the wall is the pen's input, not its pixels: for every stroke its colour, how
// many dripping frames passed before it (`g`), and the brush position at each 60 Hz frame
// (first point = where the tip went down), in reference pixels relative to the entry's origin.
// Replaying that through a brush seeded with the entry's seed repaints it exactly.
import { Brush, createRng } from './brush.js'

export const BRUSH_SIZE = 18
export const BRUSH_INK = 6
const TAIL_CAP = 2400 // frames a finished signature may keep dripping

/** Quantise to the stored resolution (half a reference pixel). */
export const q = (v) => Math.round(v * 2) / 2

export class Painter {
  constructor(entry) {
    this.entry = entry
    this.brush = new Brush({ rng: createRng(entry.seed), size: entry.size, inkAmount: entry.ink })
    this.si = 0 // stroke
    this.fi = -1 // frame within the stroke (-1: still in its gap)
    this.gi = 0 // gap frames done
    this.tail = 0
    this.done = false
  }

  get bounds() {
    return this.brush.bounds
  }

  /** One 60 Hz frame of the replay. Returns false once nothing is left to paint. */
  step(ctx) {
    if (this.done) return false
    const { strokes } = this.entry
    const b = this.brush
    if (this.si >= strokes.length) {
      if (b.hasDrops && this.tail++ < TAIL_CAP) {
        b.render(ctx, b.x, b.y)
        return true
      }
      this.done = true
      return false
    }
    const s = strokes[this.si]
    if (this.fi < 0) {
      if (this.gi < s.g && b.hasDrops) {
        this.gi++
        b.render(ctx, b.x, b.y)
        return true
      }
      b.startStroke(s.p[0], s.p[1], s.c)
      this.fi = 1
    }
    const p = s.p
    if (this.fi * 2 < p.length) b.render(ctx, p[this.fi * 2], p[this.fi * 2 + 1])
    this.fi++
    if (this.fi * 2 >= p.length) {
      b.endStroke()
      this.si++
      this.fi = -1
      this.gi = 0
    }
    return true
  }

  finish(ctx) {
    while (this.step(ctx));
  }
}

/**
 * The visitor's brush while they draw. Steps exactly like a Painter replaying what it records,
 * so the saved signature repaints the way it looked. `entry.strokes` fills in as they go.
 */
export class LivePainter {
  constructor(entry) {
    this.entry = entry
    this.brush = new Brush({ rng: createRng(entry.seed), size: entry.size, inkAmount: entry.ink })
    this.idle = 0
    this.frames = 0
  }

  get bounds() {
    return this.brush.bounds
  }

  get stroking() {
    return this.brush.stroking
  }

  get busy() {
    return this.brush.stroking || this.brush.hasDrops
  }

  /** Tip down at (x, y) (reference px, relative to the entry's origin). */
  down(x, y, color) {
    const b = this.brush
    if (b.stroking) return
    x = q(x)
    y = q(y)
    b.startStroke(x, y, color)
    this.entry.strokes.push({ c: color, g: this.idle, p: [x, y] })
    this.idle = 0
  }

  /** One 60 Hz frame with the pointer at (x, y). */
  step(ctx, x, y) {
    const b = this.brush
    if (b.stroking) {
      x = q(x)
      y = q(y)
      b.render(ctx, x, y)
      this.entry.strokes[this.entry.strokes.length - 1].p.push(x, y)
      this.frames++
    } else if (b.hasDrops) {
      b.render(ctx, b.x, b.y)
      this.idle++
    }
  }

  up() {
    this.brush.endStroke()
  }

  /**
   * Repaints everything recorded so far (after the canvas was cleared) and continues from the
   * very same brush state, mid-stroke included.
   */
  rebuild(ctx) {
    const strokes = this.entry.strokes
    const open = this.brush.stroking
    const idle = this.idle
    this.brush = new Brush({ rng: createRng(this.entry.seed), size: this.entry.size, inkAmount: this.entry.ink })
    const b = this.brush
    for (let i = 0; i < strokes.length; i++) {
      const s = strokes[i]
      for (let k = 0; k < s.g && b.hasDrops; k++) b.render(ctx, b.x, b.y)
      b.startStroke(s.p[0], s.p[1], s.c)
      for (let f = 2; f < s.p.length; f += 2) b.render(ctx, s.p[f], s.p[f + 1])
      if (i < strokes.length - 1 || !open) b.endStroke()
    }
    for (let k = 0; k < idle && b.hasDrops; k++) b.render(ctx, b.x, b.y)
  }
}

// ---- compact storage ------------------------------------------------------------------------
// A stroke is "rrggbb:g:x0,y0,dx,dy,..." in half pixels; a run of k frames without movement is
// "*k" (lingering is what makes the paint drip, so it has to be kept).

export function encodeStroke(s) {
  const p = s.p
  const out = [Math.round(p[0] * 2), Math.round(p[1] * 2)]
  let run = 0
  for (let i = 2; i < p.length; i += 2) {
    const dx = Math.round((p[i] - p[i - 2]) * 2)
    const dy = Math.round((p[i + 1] - p[i - 1]) * 2)
    if (dx === 0 && dy === 0) {
      run++
      continue
    }
    if (run) out.push('*' + run)
    run = 0
    out.push(dx, dy)
  }
  if (run) out.push('*' + run)
  return `${s.c.replace('#', '')}:${s.g}:${out.join(',')}`
}

export function decodeStroke(str) {
  const [c, g, data] = String(str).split(':')
  const t = data.split(',')
  let x = +t[0] / 2
  let y = +t[1] / 2
  const p = [x, y]
  for (let i = 2; i < t.length; i++) {
    if (t[i][0] === '*') {
      for (let k = +t[i].slice(1); k > 0; k--) p.push(x, y)
      continue
    }
    x += +t[i] / 2
    y += +t[i + 1] / 2
    i++
    p.push(x, y)
  }
  if (!/^[0-9a-f]{6}$/i.test(c) || p.some((v) => !Number.isFinite(v))) throw new Error('bad stroke')
  return { c: '#' + c, g: Math.max(0, g | 0), p }
}
