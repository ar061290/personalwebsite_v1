// Literal port of the sofaknows.com loader timeline (their bundle `d.js`).
// Class names in comments (`ms`, `us`, `gs`, `at`, `Ct`) are the minified
// identifiers the values come from. Times are milliseconds.

// d.js `x` (lerp) and `I` (round to 2 decimals).
export const lerp = (a, b, t) => (1 - t) * a + t * b
export const round2 = (v) => Math.round(v * 100) / 100
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

// The easings the intro uses, copied from d.js's table `A`
// (io3 = in-out cubic, io6 = in-out expo).
export const ease = {
  l: (t) => t,
  io3: (t) => (t < 0.5 ? 4 * t * t * t : 0.5 * (2 + (2 * t - 2) ** 3)),
  io6: (t) =>
    t === 0
      ? 0
      : t === 1
        ? 1
        : t < 0.5
          ? 0.5 * 2 ** (10 * (t * 2 - 1))
          : 0.5 * (2 - 2 ** (-10 * (t * 2 - 1))),
}

/* ── 1. Loading line (class `ms`) ─────────────────────────────────────── */
export const BAR = {
  innerStart: -110, // B(this.pr, -110, 0)
  from: -100, // prStart on a hard load (-60 is only used for page transitions)
  grow: '3500ms transform cubic-bezier(0.16, 1, 0.3, 1)', // pt(this.pr, 3500, "0.16, 1, 0.3, 1")
  exitX: 100.4, // B(this.pr_, 100.4, 0)
  exit: '1500ms transform cubic-bezier(0.76, 0, 0.2, 1)', // pt(this.pr_, 1500, "0.76, 0, 0.2, 1")
}

/* ── 2. Repeated name rows (class `us`) ───────────────────────────────── */
export const ROWS = {
  d: 800, // new z({ d: 800, u: ({ pr }) => this._(pr) }) — linear progress
  perBlock: 12, // 12 spans in #lo-co-0 and in #lo-co-2
  strip: 18, // 18 figures in #lo-co-1
}

// `us.setSeq`: top row, strip item, bottom row, strip item, … then leftovers.
export function interleave(top, strip, bottom) {
  const seq = []
  const o = Math.max(top.length, bottom.length)
  let e = 0
  let r = 0
  while (e < o) {
    if (e < top.length) seq.push(top[e])
    if (r < strip.length) seq.push(strip[r++])
    if (e < bottom.length) seq.push(bottom[e])
    if (r < strip.length) seq.push(strip[r++])
    e++
  }
  while (r < strip.length) seq.push(strip[r++])
  return seq
}

// `us._`: how many slots are visible at linear progress `pr`.
export const visibleSlots = (pr, total) => Math.min(total, Math.floor(pr * total))

/* ── 3. Hand-off (class `gs`) and the squash (`at({ intro: true })` → `Ct`) ─ */
export const FADE = 100 // #lo-co and #lo-bg: new z({ d: 100, p: { o: [1, 0] } })
export const LAYERS = 8 // #z > .z-l × 8
export const LAYER_LEFT = [-49, -42, -35, -28, -21, -14, -7, 0] // d.css `#z .z-l:nth-child(n)`

// Ct.shI0 — called with { d: 950, e: "io3", de: 100 }
export const SQUASH_IN = { d: 950, e: 'io3', de: 100, stagger: 80, x: [-200, 50], sx: [3, 1] }
// Ct.shI1 — called with { d: 1500, e: "io6", de: 1000 }
export const SQUASH_OUT = { d: 1500, e: 'io6', de: 1000, stagger: 60, x: [50, 250], sx: [1, 3] }

// `new E(() => this.ga.style.opacity = 1, 80 * this.zL)`: the page swaps its
// content in while the layers cover the whole viewport.
export const REVEAL_AT = SQUASH_IN.stagger * LAYERS // 640

// The shI1 logo tween ({ d: 1500, de: 1000 + 60 * (zL - 1) }) removes #z in its callback.
export const DONE_AT = SQUASH_OUT.de + SQUASH_OUT.stagger * (LAYERS - 1) + SQUASH_OUT.d // 2920

const INITIAL = 'translate(-101%)' // d.css `#z .z-l { transform: translate(-101%) }`
const tf = (x, sx) => `translate3d(${x}%, 0, 0) scaleX(${sx})`

// Transform of layer `i` (DOM order, 0 = first child) `t` ms after the hand-off.
// Layers are driven last-child-first (`for (r = zL - 1, n = 0; r >= 0; r--, n++)`).
// shI0 and shI1 overlap on every layer; d.js runs its raf queue back to front,
// so the earlier-started shI0 writes last and wins until it ends.
export function layerTransform(i, t) {
  const n = LAYERS - 1 - i
  const s0 = SQUASH_IN.de + SQUASH_IN.stagger * n
  const s1 = SQUASH_OUT.de + SQUASH_OUT.stagger * n
  if (t < s0) return INITIAL
  if (t <= s0 + SQUASH_IN.d) {
    const k = ease[SQUASH_IN.e](clamp01((t - s0) / SQUASH_IN.d))
    return tf(lerp(SQUASH_IN.x[0], SQUASH_IN.x[1], k), lerp(SQUASH_IN.sx[0], SQUASH_IN.sx[1], k))
  }
  if (t < s1) return tf(SQUASH_IN.x[1], SQUASH_IN.sx[1])
  const k = ease[SQUASH_OUT.e](clamp01((t - s1) / SQUASH_OUT.d))
  return tf(lerp(SQUASH_OUT.x[0], SQUASH_OUT.x[1], k), lerp(SQUASH_OUT.sx[0], SQUASH_OUT.sx[1], k))
}
