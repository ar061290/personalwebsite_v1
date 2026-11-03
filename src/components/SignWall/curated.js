// The wall's regulars: signatures that are already there, so a visitor never signs an empty wall.
// Each one is generated from a few numbers below (seeded, so it is the same on every visit):
// a cursive line from a Hollerbach-style oscillator (vertical strokes driven at each letter's
// height, a horizontal oscillation that loops wherever it runs backwards), a big looped capital,
// sometimes a pen lift and a second word, an underline or a dot; then sampled into 60 Hz frames
// with the speed of real handwriting (slow in the turns, quick on the straights; the pen's
// pause at the start of a stroke is what lets it drip). Painted by the same brush as visitors.
import { createRng, randomColor } from './brush.js'
import { BRUSH_INK, BRUSH_SIZE, q } from './painter.js'

const TAU = Math.PI * 2

// name, message, date, seed, letters, style ('u' underline, 'd' dot, 's' swoosh, '' none), two words
const SPECS = [
  ['maya k.', 'stretched the melon way too far. sorry', '2026-10-30', 11, 5, 'u', true],
  ['theo', 'hi from lisbon', '2026-10-21', 23, 4, 'd', false],
  ['priya', 'the paper texture!!', '2026-10-12', 37, 5, 's', false],
  ['jonas', '', '2026-09-28', 41, 5, 'u', false],
  ['sana', 'came for the melon, stayed for the eyes', '2026-09-17', 59, 4, '', true],
  ['leo m.', '10/10 would squish again', '2026-09-03', 67, 6, 'u', false],
  ['inès', 'found the chocolate. dark mode!', '2026-08-22', 73, 4, 'd', false],
  ['kabir', 'ok this is fun', '2026-08-09', 89, 5, 's', false],
  ['noor', 'say hi to the stickers for me', '2026-07-26', 97, 3, 'u', false],
  ['felix', '', '2026-07-11', 103, 5, 'd', true],
  ['ava', 'left a drip on purpose', '2026-06-30', 113, 4, 'u', false],
  ['rohan', 'made it to the bottom', '2026-06-14', 127, 5, 's', false],
]

/** The curated entries, in the order they are given a place on the wall. */
export function curatedEntries() {
  return SPECS.map(([name, msg, date, seed, letters, style, two], i) => ({
    id: `c${i}`,
    curated: true,
    name,
    msg,
    t: Date.parse(date + 'T12:00:00'),
    seed: seed * 7919 + 13,
    size: BRUSH_SIZE,
    ink: BRUSH_INK,
    strokes: signature(seed, letters, style, two),
  }))
}

function signature(seed, letters, style, two) {
  const rng = createRng(seed)
  const colorRng = createRng(seed * 31 + 7)
  const xh = 24 + rng() * 7
  const adv = 24 + rng() * 7
  const slant = 0.18 + rng() * 0.25
  const polys = []

  let x = 0
  if (two) {
    // a lone initial, then the surname after a lift
    const first = cursive(rng, { xh, adv, letters: 1 + ((rng() * 2) | 0), capital: true })
    polys.push(first.pts)
    x = first.end + adv * (0.8 + rng() * 0.5)
  }
  const body = cursive(rng, { xh, adv, letters, capital: true, x0: x, exit: true })
  polys.push(body.pts)
  const x0 = 0
  const x1 = body.end

  if (style === 'u') {
    // an underline pulled back under the name, fast and thin
    polys.push(quad(x1 + adv * 0.6, xh * 0.45, (x0 + x1) / 2, xh * (1.05 + rng() * 0.3), x0 - adv * 0.5, xh * 0.6))
  } else if (style === 's') {
    // a rising swoosh through the end of the name
    polys.push(quad(x0 + adv * 0.4, xh * 0.75, x1 * 0.7, xh * 0.9, x1 + adv * 1.6, -xh * 0.9))
  } else if (style === 'd') {
    const dx = x0 + (x1 - x0) * (0.45 + rng() * 0.35)
    polys.push([dx, -xh * 1.6, dx + 3, -xh * 1.65])
  }

  // slant, centre on the origin, then into frames
  for (const p of polys)
    for (let i = 0; i < p.length; i += 2) p[i] -= p[i + 1] * slant
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of polys)
    for (let i = 0; i < p.length; i += 2) {
      minX = Math.min(minX, p[i])
      maxX = Math.max(maxX, p[i])
      minY = Math.min(minY, p[i + 1])
      maxY = Math.max(maxY, p[i + 1])
    }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  return polys.map((p, i) => {
    for (let k = 0; k < p.length; k += 2) {
      p[k] -= cx
      p[k + 1] -= cy
    }
    const dot = p.length <= 4
    const fast = i === polys.length - 1 && polys.length > 1 && !dot
    return {
      c: randomColor(colorRng),
      g: 8 + ((rng() * 20) | 0),
      p: dot ? dotFrames(p, rng) : frames(p, rng, fast ? { v: 26, hold: 1 } : { v: 12, hold: 2 + ((rng() * 6) | 0) }),
    }
  })
}

/** One cursive word: an optional big looped capital, then letters of varying height and loop. */
function cursive(rng, { xh, adv, letters, capital, x0 = 0, exit = false }) {
  const cycles = []
  const pts = []
  let X = x0
  let oval = false
  if (capital) {
    if (rng() < 0.4) {
      // a big round capital (an o, c, g or a): around anticlockwise from its top right,
      // closing at the baseline where the word goes on
      oval = true
      const rx = adv * (0.75 + rng() * 0.3)
      const ry = xh * (1.25 + rng() * 0.35)
      const cx = x0 + rx
      const cy = -ry
      for (let t = 0.25 * Math.PI; t <= 2.1 * Math.PI; t += 0.035) pts.push(cx + rx * Math.cos(t), cy - ry * Math.sin(t))
      const ex = pts[pts.length - 2]
      const ey = pts[pts.length - 1]
      pts.push(...quad(ex, ey, ex + adv * 0.35, ey + xh * 0.1, ex + adv * 0.55, 0).slice(2))
      X = ex + adv * 0.55
    } else {
      cycles.push({ h: 2.5 + rng() * 0.9, a: 0.3 + rng() * 1.9, w: adv * (1.2 + rng() * 0.4) })
    }
  }
  let tall = capital
  for (let i = 0; i < letters; i++) {
    const r = rng()
    const fade = 1 - 0.35 * (i / Math.max(1, letters)) ** 2
    let h
    let a
    if (!tall && r < 0.2) {
      h = 2 + rng() * 0.5 // ascender loop
      a = 1.5 + rng() * 0.6
      tall = true
    } else if (!tall && r < 0.32) {
      h = -(1.2 + rng() * 0.5) // descender loop
      a = 1.4 + rng() * 0.6
      tall = true
    } else {
      h = 0.75 + rng() * 0.35
      a = rng() < 0.3 ? 1.15 + rng() * 0.45 : 0.1 + rng() * 0.55 // an e-loop, or an n/m/u arch
      tall = false
    }
    cycles.push({ h: h * fade, a, w: adv * (0.85 + rng() * 0.35) })
  }

  // lead-in from below the baseline
  if (!oval) pts.push(...quad(x0 - adv * 0.7, xh * 0.35, x0 - adv * 0.3, xh * 0.3, x0, 0))
  for (const c of cycles) {
    const A = (c.a * c.w) / TAU
    for (let t = 0.04; t <= TAU + 1e-6; t += 0.04) {
      pts.push(X + (c.w * t) / TAU + A * Math.sin(t), -c.h * xh * (0.5 - 0.5 * Math.cos(t)))
    }
    X += c.w
  }
  if (exit) pts.push(...quad(X, 0, X + adv * 0.5, xh * 0.15, X + adv * 1.1, -xh * 0.45).slice(2))
  return { pts, end: X }
}

function quad(x0, y0, cx, cy, x1, y1) {
  const out = []
  const n = Math.max(8, Math.ceil((Math.hypot(cx - x0, cy - y0) + Math.hypot(x1 - cx, y1 - cy)) / 2))
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    out.push(u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1)
  }
  return out
}

/**
 * Walks a dense polyline at handwriting speed: ~v px per frame on the straights, slower in tight
 * turns (speed grows with the cube root of the radius of curvature), easing in after `hold`
 * frames of resting tip. Returns [start, frame1, frame2, ...] as the brush replays them.
 */
function frames(poly, rng, { v, hold }) {
  const n = poly.length / 2
  const len = new Float64Array(n)
  for (let i = 1; i < n; i++)
    len[i] = len[i - 1] + Math.hypot(poly[i * 2] - poly[i * 2 - 2], poly[i * 2 + 1] - poly[i * 2 - 1])
  const speed = new Float64Array(n)
  const K = 3
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - K)
    const b = Math.min(n - 1, i + K)
    const ax = poly[i * 2] - poly[a * 2]
    const ay = poly[i * 2 + 1] - poly[a * 2 + 1]
    const bx = poly[b * 2] - poly[i * 2]
    const by = poly[b * 2 + 1] - poly[i * 2 + 1]
    const turn = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by))
    const seg = Math.max(1e-3, len[b] - len[a])
    const R = seg / Math.max(1e-3, turn)
    speed[i] = Math.min(2.6, Math.max(0.4, Math.cbrt(R / 22))) * v
  }
  const total = len[n - 1]
  const out = [q(poly[0]), q(poly[1])]
  for (let i = 0; i < hold; i++) out.push(out[0], out[1])
  let s = 0
  let j = 0
  let f = 0
  const jitter = 0.85 + rng() * 0.3
  while (s < total) {
    while (j < n - 2 && len[j + 1] < s) j++
    s += speed[j] * jitter * Math.min(1, (f + 1) / 6)
    f++
    while (j < n - 2 && len[j + 1] < s) j++
    const t = Math.min(1, Math.max(0, (s - len[j]) / Math.max(1e-6, len[j + 1] - len[j])))
    out.push(q(poly[j * 2] + (poly[j * 2 + 2] - poly[j * 2]) * t), q(poly[j * 2 + 1] + (poly[j * 2 + 3] - poly[j * 2 + 1]) * t))
  }
  return out
}

function dotFrames(p, rng) {
  const out = [q(p[0]), q(p[1])]
  const n = 3 + ((rng() * 4) | 0)
  for (let i = 0; i < n; i++) out.push(q(p[0] + (p[2] - p[0]) * (i / n)), q(p[1] + (p[3] - p[1]) * (i / n)))
  return out
}
